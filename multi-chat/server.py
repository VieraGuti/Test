#!/usr/bin/env python3
"""Public Twitch multi-channel GTA VI giveaway monitor.

Tracks IRC chat and independently confirms whether channels are streaming.
A giveaway title or an IRC connection does not mean public codes are being posted.
No accounts, credentials, automation of redemption, or giveaway entry.
"""
from __future__ import annotations
import json, logging, os, re, subprocess, threading, time, random, ssl
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from collections import deque, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import websocket

LOG = logging.getLogger("multi-chat")
logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")
PORT=int(os.environ.get("PORT","10000"))
CHANNELS=[x.strip().lower() for x in os.environ.get(
    "STREAM_CHANNELS",
    "thegrefg,rubius,ishowspeed,masxd_07,hutchmf,symfuhny,darkviperau,clix,nickmercs,penta"
).split(",") if re.fullmatch(r"[a-z0-9_]{2,25}",x.strip().lower())][:18]
FIXED_CHANNELS=list(CHANNELS)
DYNAMIC_LIMIT=max(0,min(75,int(os.environ.get("DYNAMIC_LIMIT","60"))))
DISCOVERY_INTERVAL=max(120,int(os.environ.get("DISCOVERY_INTERVAL","180")))
TWITCH_CLIENT_ID=os.environ.get("TWITCH_CLIENT_ID","").strip()
TWITCH_CLIENT_SECRET=os.environ.get("TWITCH_CLIENT_SECRET","").strip()
JOINED_REQUESTS=set()

LOCK=threading.RLock()
EVENTS=deque(maxlen=150)
MESSAGES=deque(maxlen=100)
CHAT_CODES=deque(maxlen=100)
VIEWER_CODES=deque(maxlen=100)
KNOWN={
  "thegrefg": {"reason":"Confirmado por usuario: códigos en pantalla y voz; chat por comprobar","promotion":"reported","codeInChatConfirmed":False},
  "rubius":{"reason":"FossaBot eligió ganadores; método privado en registros previos","promotion":"reported","codeInChatConfirmed":False},
  "ishowspeed":{"reason":"Antecedente de códigos en chat; entrega actual por confirmar","promotion":"historical","codeInChatConfirmed":False},
  "hutchmf":{"reason":"Promete regalar una copia GTA VI por hora; método pendiente","promotion":"announced","codeInChatConfirmed":False},
  "symfuhny":{"reason":"Título de directo anunció regalos cada hora; método pendiente","promotion":"announced","codeInChatConfirmed":False},
  "darkviperau":{"reason":"Título promociona sorteos; no se ha confirmado código público","promotion":"announced","codeInChatConfirmed":False},
  "clix":{"reason":"Título promociona premios PS5; no implica código GTA VI","promotion":"related","codeInChatConfirmed":False},
  "nickmercs":{"reason":"Anuncia grandes giveaways, sin formato confirmado","promotion":"related","codeInChatConfirmed":False},
  "penta":{"reason":"Anterior directo anunció game code giveaways; puede estar desconectado","promotion":"historical","codeInChatConfirmed":False},
  "masxd_07":{"reason":"Antecedente de regalo de código; entrega en chat por comprobar","promotion":"historical","codeInChatConfirmed":False},
}
STATS={
    "service":"gta-vi-multichannel-chat-radar-v1",
    "startedAt":datetime.now(timezone.utc).isoformat(),
    "chatConnected":False,"lastIRCAt":None,"totalMessages":0,
    "discovery":{"state":"not_configured" if not (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET) else "starting",
      "source":"twitch_helix","lastCheckedAt":None,
      "foundLive":0,"monitoredDynamic":0,"maxDynamic":DYNAMIC_LIMIT,
      "error":None,"requiresCredentials":not (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET)},
    "officialMessages":0,"officialCodeCandidates":0,"viewerHints":0,
    "lastError":None,
    "channels":{ch:{
       "name":ch,"chatJoined":False,"live":"checking","lastLiveCheck":None,
       "liveCheckError":None,"lastMessage":None,"messages":0,"officialMessages":0,
       "codeCandidates":0,**KNOWN.get(ch,{"reason":"Canal en observación","promotion":"unverified","codeInChatConfirmed":False})
    } for ch in CHANNELS}
}
CODES_SEPARATED=re.compile(r"(?<![A-Z0-9])([A-Z0-9]{4})[\s\-:./|]+([A-Z0-9]{4})[\s\-:./|]+([A-Z0-9]{4})(?![A-Z0-9])")
CODES_JOINED=re.compile(r"(?<![A-Z0-9])([A-Z0-9]{12})(?![A-Z0-9])")
CONTEXT=re.compile(r"\b(CODIGO|CÓDIGO|CODE|CLAVE|KEY|PSN|PS5|PLAYSTATION|REDEEM|CANJEAR|GTA)\b",re.I)
GIVEAWAY=re.compile(r"\b(CODIGOS?|CÓDIGOS?|CODES?|GIVEAWAY|SORTEOS?|GANADOR|GANASTE|REDEEM|CANJEAR|PREMIO|WINNER|WIN)\b",re.I)
RECENT_VIEWER=defaultdict(lambda:deque(maxlen=22))
SEEN_CODES=set()
SEEN_VIEWER_HINTS=set()

def utc():
    return datetime.now(timezone.utc).isoformat()

def record_event(typ,channel,text,user="",extra=None):
    item={"type":typ,"channel":channel,"time":utc(),"user":user,"text":text[:390]}
    if extra:item.update(extra)
    with LOCK:EVENTS.appendleft(item)
    if typ in ("official_code","viewer_repeated_code"):
        LOG.info("CODE SIGNAL %s %s %s",channel,typ,item.get("code"))
    return item

def parse(line):
    match=re.match(r"^(?:@(\S+)\s+)?:(\S+)\s+(PRIVMSG|USERNOTICE|NOTICE)\s+#([a-z0-9_]+)(?:\s+:(.*))?$",line,re.I)
    if not match:return None
    raw,prefix,typ,ch,body=match.groups()
    tags={}
    for kv in (raw or "").split(";"):
        if "=" in kv:
            k,v=kv.split("=",1);tags[k]=v
    typ=typ.upper();ch=ch.lower()
    user=str(tags.get("login") if typ=="USERNOTICE" and tags.get("login") else prefix.split("!",1)[0]).lower()
    badges=tags.get("badges","")
    owner=user==ch or re.search(r"(^|,)broadcaster/",badges)!=None
    mod=owner or tags.get("mod")=="1" or re.search(r"(^|,)moderator/",badges)!=None
    announcement=typ=="USERNOTICE" and "announcement" in tags.get("msg-id","")
    return dict(ch=ch,user=user,typ=typ,body=body or "",mod=mod,owner=owner,announcement=announcement,tags=tags)

def extract_codes(body):
    # URLs and UUIDs are NOT PS Store vouchers.  A campaign UUID like
    # .../4479e5e2-9a00-489e-8b0c-345834f37cc7 previously yielded a
    # false 9A00-489E-8B0C "code" and an unnecessary user notification.
    text=re.sub(r"[\u200b-\u200d\ufeff]","",str(body).upper()).replace("—","-").replace("–","-").replace("_","-")
    text=re.sub(r"(?:HTTPS?://|WWW\.)[^\s<>()\[\]]+"," ",text,flags=re.I)
    text=re.sub(r"(?<![A-Z0-9])(?:[A-F0-9]{8}-)?(?:[A-F0-9]{4}-){3}[A-F0-9]{12}(?![A-Z0-9])"," ",text)
    clean=re.sub(r"(?:C[ÓO]DIGOS?|CODES?|CLAVE|KEY|PSN|PS5|PLAYSTATION|REDEEM|CANJEAR)\s*[:#=\-]?\s*"," ",text)
    codes=set()
    for m in CODES_SEPARATED.finditer(clean):
        candidate="-".join(m.groups())
        # Ignore matches embedded in longer hyphenated identifiers.
        left=clean[:m.start()].rstrip()
        right=clean[m.end():].lstrip()
        if (left.endswith("-") and re.search(r"[A-Z0-9]{4,8}-$",left)) or (
            right.startswith("-") and re.match(r"-[A-Z0-9]{4,12}",right)):
            continue
        if any(c.isdigit() for c in candidate) and any(c.isalpha() for c in candidate):
            codes.add(candidate)
    if CONTEXT.search(text):
        for m in CODES_JOINED.finditer(clean):
            token=m.group(1)
            if any(c.isdigit() for c in token) and any(c.isalpha() for c in token):
                codes.add(f"{token[:4]}-{token[4:8]}-{token[8:]}")
    return sorted(codes)

def read_chat(parsed):
    ch=parsed["ch"]
    if ch not in STATS["channels"]:return
    user=parsed["user"]
    is_official=bool(parsed["mod"] or parsed["announcement"])
    now=utc()
    with LOCK:
        entry=STATS["channels"][ch]
        STATS["lastIRCAt"]=now
        if parsed["typ"]=="PRIVMSG":
            STATS["totalMessages"]+=1
            entry["messages"]+=1
            entry["lastMessage"]=now
        if is_official:
            STATS["officialMessages"]+=1
            entry["officialMessages"]+=1
    if is_official:
        with LOCK:
            MESSAGES.appendleft({"channel":ch,"user":user,"time":now,
               "body":parsed["body"][:450],"kind":parsed["typ"]})
        if GIVEAWAY.search(parsed["body"]):
            record_event("official_giveaway_mention",ch,parsed["body"],user)
    codes=extract_codes(parsed["body"])
    if is_official:
        for code in codes:
            key=(ch,code)
            with LOCK:
                if key in SEEN_CODES:continue
                SEEN_CODES.add(key)
                STATS["officialCodeCandidates"]+=1
                STATS["channels"][ch]["codeCandidates"]+=1
                event={"code":code,"channel":ch,"source":"official_chat","user":user,
                  "time":now,"message":parsed["body"][:350],
                  "confidence":"candidate_unverified"}
                CHAT_CODES.appendleft(event)
            record_event("official_code",ch,parsed["body"],user,{"code":code})
    elif parsed["typ"]=="PRIVMSG":
        for code in codes:
            # A code in a viewer's chat is a *lead* only: allow users to find
            # early public shares, but do not treat it as a verified giveaway.
            if CONTEXT.search(parsed["body"]):
                key=(ch,code,user)
                if key not in SEEN_VIEWER_HINTS:
                    with LOCK:
                        SEEN_VIEWER_HINTS.add(key)
                        VIEWER_CODES.appendleft({
                          "code":code,"channel":ch,"source":"viewer_chat",
                          "user":user,"time":now,"message":parsed["body"][:250],
                          "confidence":"unverified_viewer"})
            
            key=(ch,code)
            hits=RECENT_VIEWER[key]
            epoch=time.time()
            hits.append((epoch,user))
            distinct={u for t,u in hits if epoch-t<=25}
            if len(distinct)>=3 and key not in SEEN_VIEWER_HINTS:
                with LOCK:
                    SEEN_VIEWER_HINTS.add(key)
                    STATS["viewerHints"]+=1
                record_event("viewer_repeated_code",ch,"Code shared by >=3 different chatters",user,
                             {"code":code,"verified":False})

# Twitch official Helix category discovery. Without credentials the original
# static channels remain monitored; never claim whole-category coverage.
def twitch_json(url,headers=None,data=None):
    request=Request(url,data=data,headers=headers or {},method="POST" if data is not None else "GET")
    with urlopen(request,timeout=17) as resp:
        return json.load(resp)

def discovery_worker():
    if not (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET):
        LOG.warning("Dynamic discovery disabled: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET not configured")
        return
    oauth=None;expiry=0;game_ids=None
    while True:
        try:
            if time.time() >= expiry-90:
                form=urlencode({"client_id":TWITCH_CLIENT_ID,
                                "client_secret":TWITCH_CLIENT_SECRET,
                                "grant_type":"client_credentials"}).encode("ascii")
                grant=twitch_json("https://id.twitch.tv/oauth2/token",
                                  {"Content-Type":"application/x-www-form-urlencoded"},form)
                oauth=grant["access_token"];expiry=time.time()+int(grant.get("expires_in",3600))
            headers={"Authorization":"Bearer "+oauth,"Client-Id":TWITCH_CLIENT_ID}
            if not game_ids:
                names=["Grand Theft Auto VI","Grand Theft Auto 6"]
                found=[]
                for name in names:
                    result=twitch_json("https://api.twitch.tv/helix/games?"+urlencode({"name":name}),headers)
                    found.extend(result.get("data",[]))
                if not found:
                    result=twitch_json("https://api.twitch.tv/helix/search/categories?"+
                                      urlencode({"query":"Grand Theft Auto VI","first":30}),headers)
                    found=[x for x in result.get("data",[]) if "Grand Theft Auto VI" in x.get("name","") or "Grand Theft Auto 6" in x.get("name","")]
                game_ids=list(dict.fromkeys(x["id"] for x in found))
                if not game_ids:
                    raise RuntimeError("Twitch has no GTA VI category available through API")
            discovered=[];total=0
            for gameid in game_ids[:3]:
                cursor=None
                for page in range(4):
                    params={"game_id":gameid,"first":100,"type":"live"}
                    if cursor:params["after"]=cursor
                    result=twitch_json("https://api.twitch.tv/helix/streams?"+urlencode(params),headers)
                    batch=result.get("data",[]);total+=len(batch);discovered.extend(batch)
                    cursor=(result.get("pagination") or {}).get("cursor")
                    if not cursor or not batch:break
            # Additional streams in another GTA category if the TITLE explicitly
            # contains GTA VI / GTA 6 (do not include all GTA V channels).
            result=twitch_json("https://api.twitch.tv/helix/games?"+
                              urlencode({"name":"Grand Theft Auto V"}),headers)
            old=(result.get("data") or [])
            if old:
                page=twitch_json("https://api.twitch.tv/helix/streams?"+
                                urlencode({"game_id":old[0]["id"],"first":100,"type":"live"}),headers)
                secondary=[x for x in page.get("data",[]) if
                   re.search(r"(?:GTA\s*(?:VI|6)|GRAND\s+THEFT\s+AUTO\s*(?:VI|6))\b",
                             x.get("title",""),re.I)]
                discovered.extend(secondary)
            # Prefer highest-viewer live streams, but cannot follow *every* channel.
            sorted_live=sorted(discovered,key=lambda x:int(x.get("viewer_count") or 0),reverse=True)
            chosen={}
            for v in sorted_live:
                ch=(v.get("user_login") or "").lower()
                if ch and re.fullmatch(r"[a-z0-9_]{2,25}",ch) and ch not in chosen:
                    chosen[ch]=v
                    if len(chosen)>=DYNAMIC_LIMIT:break
            now=utc()
            with LOCK:
                previous=set(CHANNELS)
                current=list(dict.fromkeys(FIXED_CHANNELS+list(chosen)))
                CHANNELS[:]=current
                for ch in current:
                    if ch not in STATS["channels"]:
                        STATS["channels"][ch]={
                          "name":ch,"chatJoined":False,"live":"checking",
                          "lastLiveCheck":None,"liveCheckError":None,
                          "lastMessage":None,"messages":0,"officialMessages":0,
                          "codeCandidates":0,"reason":"Hallado en categoría de GTA VI en Twitch",
                          "promotion":"unverified","codeInChatConfirmed":False}
                    if ch in chosen:
                        STATS["channels"][ch].update(
                          live="live",lastLiveCheck=now,liveCheckError=None,
                          streamTitle=chosen[ch].get("title","")[:160],
                          viewers=chosen[ch].get("viewer_count",0),
                          discovery="helix_game_category")
                for ch in previous-set(current):
                    STATS["channels"].pop(ch,None)
                STATS["discovery"].update(state="active",lastCheckedAt=now,
                    foundLive=total,monitoredDynamic=len(chosen),error=None)
            LOG.info("CATEGORY DISCOVERY live=%s dynamic=%s totalRooms=%s",
                     total,len(chosen),len(current))
        except Exception as exc:
            # Never expose OAuth secrets or tokens in logs / status.
            msg=type(exc).__name__+" (check Twitch API permissions or category)"
            LOG.warning("CATEGORY DISCOVERY ERROR %s",msg)
            with LOCK: STATS["discovery"].update(state="error",error=msg,lastCheckedAt=utc())
            if "HTTPError" in type(exc).__name__:
                oauth=None;expiry=0
        time.sleep(DISCOVERY_INTERVAL)

def irc_worker():
    backoff=1.0
    while True:
        sock=None
        try:
            sock=websocket.create_connection("wss://irc-ws.chat.twitch.tv:443",timeout=25,
                sslopt={"cert_reqs":ssl.CERT_REQUIRED})
            sock.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n")
            sock.send("NICK justinfan"+str(random.randint(10000,89999))+"\r\n")
            # Twitch allows 20 JOIN attempts per 10 seconds for regular users.
            # Joining many channels in one burst previously caused disconnects.
            sock.settimeout(.7)
            requested=set()
            next_join_at=0.0
            with LOCK:
                STATS["chatConnected"]=True
                STATS["lastError"]=None
                for ch in CHANNELS:STATS["channels"][ch]["chatJoined"]=False
            LOG.info("IRC connected; will gradually join %d channels",len(CHANNELS))
            backoff=1.0
            while True:
                with LOCK:
                    pending=set(CHANNELS)
                now=time.monotonic()
                if now>=next_join_at:
                    leftovers=sorted(requested-pending)
                    additions=sorted(pending-requested)
                    if leftovers:
                        ch=leftovers[0]
                        sock.send("PART #"+ch+"\r\n")
                        requested.remove(ch)
                        next_join_at=now+.1
                    elif additions:
                        ch=additions[0]
                        sock.send("JOIN #"+ch+"\r\n")
                        requested.add(ch)
                        # ~1.4 JOIN/s, safely below the 20 per 10 sec cap.
                        next_join_at=now+.7
                try:
                    packet=sock.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                if not packet:raise RuntimeError("IRC closed websocket")
                for line in str(packet).split("\r\n"):
                    if not line:continue
                    if line.startswith("PING "):
                        sock.send(line.replace("PING ","PONG ",1)+"\r\n")
                        continue
                    if " RECONNECT" in line:
                        raise RuntimeError("IRC requested reconnect")
                    if " ROOMSTATE #" in line:
                        m=re.search(r" ROOMSTATE #([a-z0-9_]+)",line)
                        if m:
                            ch=m.group(1)
                            with LOCK:
                                if ch in STATS["channels"]:
                                    STATS["channels"][ch]["chatJoined"]=True
                    parsed=parse(line)
                    if parsed:read_chat(parsed)
        except Exception as exc:
            LOG.warning("IRC reconnect %s",str(exc)[:230])
            with LOCK:
                STATS["chatConnected"]=False
                STATS["lastError"]=str(exc)[:500]
                for ch in CHANNELS:STATS["channels"][ch]["chatJoined"]=False
        finally:
            if sock:
                try:sock.close()
                except Exception:pass
        time.sleep(backoff)
        backoff=min(24,backoff*1.7)

def check_live_channel(ch):
    # streamlink probes actual Twitch playlist; errors are unknown unless
    # the plugin explicitly reports no playable streams.
    command=["streamlink","--stream-url",f"https://www.twitch.tv/{ch}","160p,360p,480p,best"]
    try:
        cp=subprocess.run(command,capture_output=True,text=True,timeout=22)
        err=(cp.stderr or "")[-450:]
        ok=(cp.returncode==0 and cp.stdout.strip().startswith("http"))
        if ok:return ch,"live",None
        if "No playable streams found" in err or "No streams found" in err:
            return ch,"offline",None
        return ch,"unknown",err or f"streamlink exit {cp.returncode}"
    except Exception as exc:
        return ch,"unknown",str(exc)[:350]

def live_worker():
    while True:
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                # Helix already verified newly discovered channels as LIVE.
                # Avoid probing 60+ HLS playlists from Render's 0.15 CPU.
                futures=[pool.submit(check_live_channel,ch) for ch in FIXED_CHANNELS]
                for f in as_completed(futures):
                    ch,live,error=f.result()
                    with LOCK:
                        d=STATS["channels"][ch]
                        d["live"]=live;d["lastLiveCheck"]=utc()
                        d["liveCheckError"]=error
                    LOG.info("LIVE STATUS %s %s%s",ch,live,
                             (" "+str(error)[:90]) if error else "")
        except Exception as exc:
            LOG.warning("Liveness scan error: %s",exc)
        time.sleep(120)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?",1)[0] not in ("/","/status","/health"):
            self.send_response(404);self.end_headers();return
        with LOCK:
            state=json.loads(json.dumps(STATS))
            state["officialChatCodes"]=list(CHAT_CODES)[:55]
            state["viewerCodeLeads"]=list(VIEWER_CODES)[:60]
            state["recentOfficialMessages"]=list(MESSAGES)[:65]
            state["events"]=list(EVENTS)[:80]
            state["lastUpdatedAt"]=utc()
        if self.path.startswith("/health"):
            state={"service":state["service"],"chatConnected":state["chatConnected"],
                   "channels":len(CHANNELS),"messages":state["totalMessages"]}
        data=json.dumps(state,ensure_ascii=False).encode("utf-8")
        self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.end_headers()
    def do_HEAD(self):
        self.send_response(200);self.end_headers()
    def log_message(self,*args):
        pass

def heartbeat():
    while True:
        time.sleep(30)
        with LOCK:
            names=[x for x,d in STATS["channels"].items() if d["chatJoined"]]
            active=[x for x,d in STATS["channels"].items() if d["live"]=="live"]
            msg=STATS["totalMessages"]
            mods=STATS["officialMessages"]
            code=STATS["officialCodeCandidates"]
            ok=STATS["chatConnected"]
        LOG.info("CHAT HEARTBEAT connected=%s joined=%s live=%s messages=%s official=%s codeCandidates=%s",
                 ok,len(names),",".join(active),msg,mods,code)

if __name__=="__main__":
    LOG.info("Starting Twitch multi chat radar port=%s",PORT)
    threading.Thread(target=irc_worker,daemon=True).start()
    threading.Thread(target=live_worker,daemon=True).start()
    threading.Thread(target=discovery_worker,daemon=True).start()
    threading.Thread(target=heartbeat,daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever()
