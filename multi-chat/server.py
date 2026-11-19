#!/usr/bin/env python3
"""Public Twitch multi-channel GTA VI giveaway monitor.

Tracks IRC chat and independently confirms whether channels are streaming.
A giveaway title or an IRC connection does not mean public codes are being posted.
No accounts, credentials, automation of redemption, or giveaway entry.
"""
from __future__ import annotations
import json, logging, os, re, subprocess, threading, time, random, ssl
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
LOCK=threading.RLock()
EVENTS=deque(maxlen=150)
MESSAGES=deque(maxlen=100)
CHAT_CODES=deque(maxlen=100)
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
    text=re.sub(r"[\u200b-\u200d\ufeff]","",body.upper()).replace("—","-").replace("–","-").replace("_","-")
    clean=re.sub(r"(?:C[ÓO]DIGOS?|CODES?|CLAVE|KEY|PSN|PS5|PLAYSTATION|REDEEM|CANJEAR)\s*[:#=\-]?\s*"," ",text)
    codes=set()
    for m in CODES_SEPARATED.finditer(clean):
        candidate="-".join(m.groups())
        if any(c.isdigit() for c in candidate):codes.add(candidate)
    if CONTEXT.search(text):
        for m in CODES_JOINED.finditer(clean):
            s=m.group(1)
            if any(c.isdigit() for c in s):codes.add(f"{s[:4]}-{s[4:8]}-{s[8:]}")
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

def irc_worker():
    backoff=1.0
    while True:
        sock=None
        try:
            sock=websocket.create_connection("wss://irc-ws.chat.twitch.tv:443",timeout=35,
                sslopt={"cert_reqs":ssl.CERT_REQUIRED})
            sock.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n")
            sock.send("NICK justinfan"+str(random.randint(10000,89999))+"\r\n")
            for ch in CHANNELS:sock.send("JOIN #"+ch+"\r\n")
            with LOCK:
                STATS["chatConnected"]=True;STATS["lastError"]=None
                for ch in CHANNELS:STATS["channels"][ch]["chatJoined"]=False
            LOG.info("IRC connected, joined %d requested channels: %s",len(CHANNELS),", ".join(CHANNELS))
            backoff=1.0
            while True:
                packet=sock.recv()
                if not packet:raise RuntimeError("IRC closed websocket")
                for line in str(packet).split("\r\n"):
                    if not line:continue
                    if line.startswith("PING "):
                        sock.send(line.replace("PING ","PONG ",1)+"\r\n");continue
                    if " RECONNECT" in line:raise RuntimeError("IRC requested reconnect")
                    if " ROOMSTATE #" in line:
                        for ch in CHANNELS:
                            if " ROOMSTATE #"+ch in line:
                                with LOCK:STATS["channels"][ch]["chatJoined"]=True
                    parsed=parse(line)
                    if parsed:read_chat(parsed)
        except Exception as exc:
            LOG.warning("IRC reconnect %s",str(exc)[:230])
            with LOCK:
                STATS["chatConnected"]=False;STATS["lastError"]=str(exc)[:500]
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
                futures=[pool.submit(check_live_channel,ch) for ch in CHANNELS]
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

if __name__=="__main__":
    LOG.info("Starting Twitch multi chat radar port=%s",PORT)
    threading.Thread(target=irc_worker,daemon=True).start()
    threading.Thread(target=live_worker,daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever()
