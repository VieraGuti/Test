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
DYNAMIC_LIMIT=max(0,min(85,int(os.environ.get("DYNAMIC_LIMIT","85"))))
DISCOVERY_INTERVAL=max(90,int(os.environ.get("DISCOVERY_INTERVAL","120")))
TWITCH_CLIENT_ID=os.environ.get("TWITCH_CLIENT_ID","").strip()
TWITCH_CLIENT_SECRET=os.environ.get("TWITCH_CLIENT_SECRET","").strip()
JOINED_REQUESTS=set()
ROTATION_ROUND=0

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
      "error":None,"requiresCredentials":not (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET),
      "monitoringMode":"rotating","rotationRound":0,"rotationPool":0,"rotationSlots":0,
      "connectedChatRooms":0,"totalListed":0,"allLiveDirectory":True},
    "directory":[],
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
    """Conservative PlayStation 12-char candidates; never invent tokens.

    Do not interpret ordinary speech, @usernames, Discord links, UUIDs,
    promotional referral strings, or Twitch commands as redemption keys.
    Direct standalone XXXX-XXXX-XXXX is plausible, but NEVER 'verified'.
    Unhyphenated/spaced keys require an explicit key/redeem context.
    """
    text=str(body).upper()
    text=re.sub(r"[\u200b-\u200d\ufeff]","",text).replace("\u2014","-").replace("\u2013","-")
    text=re.sub(r"(?:HTTPS?://|WWW\.)[^\s<>()\[\]]+"," ",text,flags=re.I)
    text=re.sub(r"(?<![A-Z0-9])(?:[A-F0-9]{8}-)?(?:[A-F0-9]{4}-){3}[A-F0-9]{12}(?![A-Z0-9])"," ",text)
    # No @handle or #hashtag can become a code; @leslieee1010 was a false alert.
    text=re.sub(r"(?<![A-Z0-9])[@#][A-Z0-9_]+"," ",text)
    # Strip IRC action commands, but keep the message for legitimate key posts.
    text=text.replace("\x01ACTION"," ").replace("\x01"," ")
    code_context=re.search(
        r"\b(?:PSN|PS5|PLAYSTATION|PS\s*STORE|REDEEM|CANJEAR|"
        r"C[ÓO]DIGO(?:S)?|CLAVE(?:S)?|VOUCHER|GAME\s*KEY|"
        r"KEY(?:S)?|GTA\s*(?:VI|6)\s*CODE|CODE\s*(?:FOR|DE)\s*GTA)\b",text,re.I)
    codes=set()
    # Require literal hyphens, not spaces in a casual sentence. Do not
    # extract a 12-char substring from a longer dash-separated identifier.
    hyphenated=re.compile(r"(?<![A-Z0-9_@#-])([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})(?![A-Z0-9_-])")
    for m in hyphenated.finditer(text):
        code="-".join(m.groups())
        if not any(ch.isdigit() for ch in code) or not any(ch.isalpha() for ch in code):
            continue
        # Standalone key format, or explicit redemption context.
        outside=(text[:m.start()]+text[m.end():]).strip(" \t\r\n:–—-.,!?🎁🔥")
        if code_context or not outside:
            codes.add(code)
    # A key with spaces or no separators is noisy and is accepted only in
    # the same message as a strong redemption clue.
    if code_context:
        spaced=re.compile(r"(?<![A-Z0-9_@#-])([A-Z0-9]{4})[ \t]+([A-Z0-9]{4})[ \t]+([A-Z0-9]{4})(?![A-Z0-9_-])")
        compact=re.compile(r"(?<![A-Z0-9_@#-])([A-Z0-9]{12})(?![A-Z0-9_-])")
        for m in spaced.finditer(text):
            code="-".join(m.groups())
            if any(ch.isdigit() for ch in code) and any(ch.isalpha() for ch in code):
                codes.add(code)
        for m in compact.finditer(text):
            token=m.group(1)
            if any(ch.isdigit() for ch in token) and any(ch.isalpha() for ch in token):
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
    """List every GTA VI stream Twitch Helix makes discoverable.

    We can list hundreds, but Twitch permits at most 100 concurrent IRC joins
    per user. A set of priority streams stays connected; the remaining slots
    rotate through the rest. We never call the directory "all chats connected".
    """
    global ROTATION_ROUND
    if not (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET):
        LOG.warning("Dynamic discovery disabled: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET not configured")
        return
    oauth=None
    expiry=0
    game_ids=None
    while True:
        try:
            if time.time() >= expiry-90:
                form=urlencode({"client_id":TWITCH_CLIENT_ID,
                                "client_secret":TWITCH_CLIENT_SECRET,
                                "grant_type":"client_credentials"}).encode("ascii")
                grant=twitch_json("https://id.twitch.tv/oauth2/token",
                                  {"Content-Type":"application/x-www-form-urlencoded"},form)
                oauth=grant["access_token"]
                expiry=time.time()+int(grant.get("expires_in",3600))
            headers={"Authorization":"Bearer "+oauth,"Client-Id":TWITCH_CLIENT_ID}
            if not game_ids:
                found=[]
                for name in ("Grand Theft Auto VI","Grand Theft Auto 6"):
                    result=twitch_json("https://api.twitch.tv/helix/games?"+
                                      urlencode({"name":name}),headers)
                    found.extend(result.get("data",[]))
                if not found:
                    result=twitch_json("https://api.twitch.tv/helix/search/categories?"+
                                      urlencode({"query":"Grand Theft Auto VI","first":30}),headers)
                    found=[x for x in result.get("data",[])
                           if "Grand Theft Auto VI" in x.get("name","")
                           or "Grand Theft Auto 6" in x.get("name","")]
                game_ids=list(dict.fromkeys(x["id"] for x in found))
                if not game_ids:
                    raise RuntimeError("Twitch has no GTA VI category available through API")
            discovered=[]
            category_complete=True
            for gameid in game_ids[:3]:
                cursor=None
                for page in range(20):
                    params={"game_id":gameid,"first":100,"type":"live"}
                    if cursor:params["after"]=cursor
                    result=twitch_json("https://api.twitch.tv/helix/streams?"+
                                      urlencode(params),headers)
                    batch=result.get("data",[])
                    discovered.extend(batch)
                    cursor=(result.get("pagination") or {}).get("cursor")
                    if not cursor or not batch:break
                else:
                    category_complete=False
            # Some broadcasters miscategorize GTA VI as GTA V. Inspect at
            # most 4 pages of that category and only include GTA VI titles.
            legacy=[]
            old=twitch_json("https://api.twitch.tv/helix/games?"+
                           urlencode({"name":"Grand Theft Auto V"}),headers).get("data",[])
            if old:
                cursor=None
                for page in range(4):
                    params={"game_id":old[0]["id"],"first":100,"type":"live"}
                    if cursor:params["after"]=cursor
                    data=twitch_json("https://api.twitch.tv/helix/streams?"+
                                     urlencode(params),headers)
                    legacy.extend(v for v in data.get("data",[])
                                  if re.search(r"(?:GTA\s*(?:VI|6)|GRAND\s+THEFT\s+AUTO\s*(?:VI|6))\b",
                                               v.get("title",""),re.I))
                    cursor=(data.get("pagination") or {}).get("cursor")
                    if not cursor:break
            by_name={}
            for item in discovered+legacy:
                ch=(item.get("user_login") or "").lower()
                if re.fullmatch(r"[a-z0-9_]{2,25}",ch):
                    old_item=by_name.get(ch)
                    if not old_item or int(item.get("viewer_count") or 0)>int(old_item.get("viewer_count") or 0):
                        by_name[ch]=item
            ranked=sorted(by_name.values(),key=lambda v:int(v.get("viewer_count") or 0),reverse=True)
            names=[v["user_login"].lower() for v in ranked if v.get("user_login")]
            max_slots=min(DYNAMIC_LIMIT,max(0,95-len(FIXED_CHANNELS)))
            permanent_count=min(max_slots,45)
            stable=names[:permanent_count]
            rest=names[permanent_count:]
            rotation_slots=max_slots-permanent_count
            rotating=[]
            if rotation_slots and rest:
                start=(ROTATION_ROUND*rotation_slots)%len(rest)
                rotating=[rest[(start+i)%len(rest)] for i in range(min(rotation_slots,len(rest)))]
            selected=list(dict.fromkeys(stable+rotating))
            next_rotation=ROTATION_ROUND+1
            now=utc()
            with LOCK:
                previous=set(CHANNELS)
                current=list(dict.fromkeys(FIXED_CHANNELS+selected))
                CHANNELS[:]=current
                for ch in current:
                    if ch not in STATS["channels"]:
                        STATS["channels"][ch]={
                          "name":ch,"chatJoined":False,"live":"checking",
                          "lastLiveCheck":None,"liveCheckError":None,
                          "lastMessage":None,"messages":0,"officialMessages":0,
                          "codeCandidates":0,"reason":"Descubierto en Twitch GTA VI",
                          "promotion":"unverified","codeInChatConfirmed":False}
                    if ch in by_name:
                        item=by_name[ch]
                        STATS["channels"][ch].update(
                          live="live",lastLiveCheck=now,liveCheckError=None,
                          streamTitle=item.get("title","")[:160],
                          viewers=item.get("viewer_count",0),
                          discovery="helix_game_category")
                for ch in previous-set(current):
                    STATS["channels"].pop(ch,None)
                STATS["directory"]=[{
                  "name":v["user_login"].lower(),
                  "title":v.get("title","")[:160],
                  "viewers":int(v.get("viewer_count") or 0),
                  "language":v.get("language",""),
                  "monitored":v["user_login"].lower() in current
                } for v in ranked[:2000] if v.get("user_login")]
                STATS["discovery"].update(
                    state="active",lastCheckedAt=now,
                    foundLive=len(by_name),totalListed=len(by_name),
                    categoryComplete=category_complete,
                    monitoredDynamic=len(selected),maxDynamic=DYNAMIC_LIMIT,
                    currentRooms=len(current),
                    rotationRound=ROTATION_ROUND,rotationPool=len(rest),
                    rotationSlots=rotation_slots,monitoringMode="rotating" if rest else "all_listed",
                    requiresCredentials=False,error=None)
            LOG.info("CATEGORY DISCOVERY found=%s monitored=%s rotating=%s/%s round=%s categoryComplete=%s",
                     len(by_name),len(current),len(rotating),len(rest),
                     ROTATION_ROUND,category_complete)
            ROTATION_ROUND=next_rotation
        except Exception as exc:
            msg=type(exc).__name__+" (check Twitch API permissions or category)"
            LOG.warning("CATEGORY DISCOVERY ERROR %s",msg)
            with LOCK:
                STATS["discovery"].update(state="error",error=msg,lastCheckedAt=utc())
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
            state["discovery"]["connectedChatRooms"]=sum(1 for v in STATS["channels"].values() if v["chatJoined"])
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
