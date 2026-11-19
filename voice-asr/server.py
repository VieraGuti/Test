#!/usr/bin/env python3
"""Near real-time Spanish speech transcription for a public Twitch stream.
Vosk offline recognition. No Twitch or PlayStation credentials. No redeem automation.
"""
import json, logging, os, re, subprocess, threading, time, unicodedata
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from vosk import Model, KaldiRecognizer, SetLogLevel
from urllib.request import Request, urlopen

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
SetLogLevel(-1)
CHANNEL = os.environ.get("STREAM_CHANNEL", "thegrefg").lower()
PORT = int(os.environ.get("PORT", "10000"))
MODEL_PATH = os.environ.get("VOSK_MODEL_PATH", "/app/model/vosk-model-small-es-0.42")
SCREEN_STATUS_URL = os.environ.get("SCREEN_STATUS_URL", "https://gta-vi-thegrefg-screen-ocr.onrender.com/status")
GATE_POLL_SECONDS = max(3,int(os.environ.get("GATE_POLL_SECONDS","6")))
_GATE_CACHE = {"value":False,"fetchedAt":0,"event":None}
LOCK = threading.RLock()
STATE = {
    "service":"gta-vi-thegrefg-voice-asr-v1",
    "channel":CHANNEL,"state":"starting","online":False,
    "lastError":None,"startedAt":datetime.now(timezone.utc).isoformat(),
    "lastTranscriptAt":None,"transcriptsProcessed":0,"lastTranscript":"",
    "videoAudioOpenedAt":None,"lastAudioPacketAt":None,
    "events":deque(maxlen=50),"recentTranscripts":deque(maxlen=40),
    "possibleCodes":deque(maxlen=30),
    "lastReleaseCue":None,"lastPuzzleClue":None,"lastLetter":None,
    "puzzleEvents":deque(maxlen=45),
    "trackingEnabled":False, "countdownSeconds":None, "nextEventAt":None,
    "windowStartAt":None, "windowEndAt":None,
    "gateStatus":"waiting_for_timer","gateError":None,
}
SPEECH_TO_CHAR = {
    "a":"A","be":"B","b":"B","ve":"B","ce":"C","c":"C","de":"D","d":"D",
    "e":"E","efe":"F","f":"F","ge":"G","g":"G","hache":"H","h":"H",
    "i":"I","jota":"J","j":"J","ka":"K","k":"K","ele":"L","l":"L",
    "eme":"M","m":"M","ene":"N","n":"N","o":"O","pe":"P","p":"P",
    "cu":"Q","q":"Q","erre":"R","r":"R","ese":"S","s":"S",
    "te":"T","t":"T","u":"U","uve":"V","v":"V",
    "dobleuve":"W","doble":"W","equis":"X","x":"X",
    "ye":"Y","y":"Y","zeta":"Z","z":"Z",
    "cero":"0","uno":"1","una":"1","dos":"2","tres":"3",
    "cuatro":"4","cinco":"5","seis":"6","siete":"7",
    "ocho":"8","nueve":"9"
}
KEYWORDS = re.compile(r"\b(?:codigo|codigos|clave|playstation|psn|regalo|canjear|gta|ganar)\b",re.I)
SPOKEN = deque(maxlen=25)
PUZZLE_PHRASES=("adivinanza","ultima letra","letra que falta","letra final","pista","que letra","que vocal")
RELEASE_PHRASES=("aqui teneis el codigo","aqui teneis el ultimo codigo",
                 "aqui esta el codigo","os doy el codigo","doy el codigo",
                 "ultimo codigo","codigo ya","este codigo","os pongo el codigo",
                 "os dejo el codigo")
LETTER_PATTERN=re.compile(
    r"\bletra\s+(?:que\s+faltaba\s+)?(?:es|era|fue|seria|sera)\s+"
    r"(?:(?:efectivamente|la|el|una|un|pues|finalmente)\s+){0,4}([a-z0-9]+)\b",
    re.I
)
def ts():return datetime.now(timezone.utc).isoformat()
def update(**kwargs):
    with LOCK: STATE.update(kwargs)
def event(info):
    with LOCK:STATE["events"].appendleft(info)
    logging.info("VOICE EVENT %s",json.dumps(info,ensure_ascii=False))
def snapshot(short=False):
    with LOCK:
        d={k:v for k,v in STATE.items() if k not in ("events","recentTranscripts","possibleCodes")}
        if not short:
            d["puzzleEvents"]=list(STATE["puzzleEvents"])
            d["events"]=list(STATE["events"])
            d["recentTranscripts"]=list(STATE["recentTranscripts"])
            d["possibleCodes"]=list(STATE["possibleCodes"])
        return d

def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFKD",text.lower()) if not unicodedata.combining(c))
def maybe_spelled(text):
    normalized=normalize(text)
    words=re.findall(r"[a-z0-9]+",normalized)
    chars=[SPEECH_TO_CHAR.get(w) for w in words]
    # A plausible 12-character code can be dictated one word at a time,
    # but mixed-in narration creates many false positives. Treat as a hint.
    sequences=[]
    start=0
    while start<len(chars):
        if chars[start] is None:
            start+=1;continue
        end=start
        while end<len(chars) and chars[end] is not None:
            end+=1
        if end-start>=10:
            sequence="".join(chars[start:end])
            sequences.append(sequence)
        start=end+1
    return sequences

def handle_transcript(text,is_partial=False):
    text=text.strip()
    if not text:return
    t=ts()
    if is_partial:
        update(lastTranscript=text)
        return
    entry={"time":t,"channel":CHANNEL,"text":text,"kind":"voice_transcription"}
    with LOCK:
        STATE["recentTranscripts"].appendleft(entry)
        STATE["lastTranscript"]=text
        STATE["lastTranscriptAt"]=t
        STATE["transcriptsProcessed"]+=1
        SPOKEN.append((time.time(),text))
    raw=normalize(text)
    if KEYWORDS.search(raw):
        event({"type":"voice_keyword","time":t,"text":text,"channel":CHANNEL})
    # Announce actual on-stream code display, independent of whether a
    # complete redeem key can be reconstructed by speech recognition.
    if "codigo" in raw and any(phrase in raw for phrase in RELEASE_PHRASES):
        cue={"type":"code_release_cue","time":t,"channel":CHANNEL,
             "text":text,"confidence":"spoken_release_announcement"}
        with LOCK:
            previous=STATE.get("lastReleaseCue")
            prevtime=previous.get("time") if previous else None
            if not prevtime or abs((datetime.fromisoformat(t)-datetime.fromisoformat(prevtime)).total_seconds())>40:
                STATE["lastReleaseCue"]=cue
                STATE["puzzleEvents"].appendleft(cue)
                event(cue)
    if any(phrase in raw for phrase in PUZZLE_PHRASES):
        clue={"type":"puzzle_clue","time":t,"channel":CHANNEL,
              "text":text,"status":"speech_clue"}
        with LOCK:
            STATE["lastPuzzleClue"]=clue
            STATE["puzzleEvents"].appendleft(clue)
        event(clue)
    # TheGrefg may leave the final character as a riddle, and confirm
    # the answer later. Only accept explicit "la letra era ..." statements.
    letter_match=LETTER_PATTERN.search(raw)
    if letter_match:
        word=letter_match.group(1)
        letter=SPEECH_TO_CHAR.get(word)
        if letter and len(letter)==1 and letter.isalpha():
            clue={"type":"final_letter_confirmed","time":t,"channel":CHANNEL,
                  "letter":letter,"text":text,"status":"spoken_claim_not_redeemed"}
            with LOCK:
                STATE["lastLetter"]=clue
                STATE["puzzleEvents"].appendleft(clue)
            event(clue)
    # Only extract potential code when a relevant keyword was uttered recently
    # or within this segment. Never advertise uncertain transcript as a valid code.
    phrase=" ".join(msg for moment,msg in SPOKEN if time.time()-moment<22)
    if KEYWORDS.search(normalize(phrase)):
        seen=set()
        for seq in maybe_spelled(phrase):
            if seq in seen:continue
            seen.add(seq)
            if len(seq)>=12:
                value=seq[:12]
                code="-".join(value[n:n+4] for n in (0,4,8))
                info={"type":"voice_spelled_candidate","time":t,"channel":CHANNEL,
                      "code":code,"text":phrase[-230:],
                      "status":"uncertain_manual_check_required"}
                with LOCK:
                    previous=[v["code"] for v in list(STATE["possibleCodes"])[:5]]
                    if code not in previous:
                        STATE["possibleCodes"].appendleft(info)
                        STATE["events"].appendleft(info)
                logging.info("VOICE POSSIBLE CODE %s",code)

def stream_url():
    update(state="resolving",lastError=None)
    cmd=["streamlink","--stream-url",f"https://www.twitch.tv/{CHANNEL}",
         "audio_only,160p,360p,480p,720p,best"]
    run=subprocess.run(cmd,capture_output=True,text=True,timeout=40)
    lines=run.stdout.strip().splitlines()
    if run.returncode!=0 or not lines or not lines[-1].startswith("http"):
        raise RuntimeError("Twitch audio stream unavailable: "+run.stderr[-500:])
    return lines[-1]


def countdown_gate():
    """Emergency voice mode: capture live speech continuously, independent of OCR."""
    if os.environ.get("FORCE_VOICE_ON", "1") == "1":
        update(trackingEnabled=True,gateStatus="forced_live_voice",
               gateError=None)
        return True
    # Otherwise keep the configurable countdown window:
    """Only activate ASR inside screen OCR's pre/post event window."""
    current=time.time()
    try:
        request=Request(SCREEN_STATUS_URL,headers={"User-Agent":"GTA-VI-CodeHunter-Voice-Gate/1.0","Accept":"application/json"})
        with urlopen(request,timeout=5) as response:
            data=json.load(response)
        if data.get("channel") != CHANNEL:
            raise RuntimeError("Unexpected countdown channel")
        active=bool(data.get("windowActive")) and bool(data.get("online"))
        _GATE_CACHE.update(value=active,fetchedAt=current,event=data.get("nextEventAt"))
        update(trackingEnabled=active,countdownSeconds=data.get("countdownSeconds"),
            nextEventAt=data.get("nextEventAt"),windowStartAt=data.get("windowStartAt"),
            windowEndAt=data.get("windowEndAt"),gateStatus=data.get("scanMode","unknown"),
            gateError=None)
        return active
    except Exception as e:
        # A transient server-to-server request error should not immediately
        # cut a live code read, but do not run indefinitely without a timer.
        grace=bool(_GATE_CACHE["value"] and current-_GATE_CACHE["fetchedAt"]<15)
        update(trackingEnabled=grace,gateStatus="countdown_unavailable",gateError=str(e)[:250])
        return grace

def monitor():
    try:
        update(state="loading_speech_model")
        model=Model(MODEL_PATH)
        logging.info("Vosk Spanish model ready")
    except Exception as e:
        logging.exception("Speech model unavailable")
        update(state="model_error",lastError=str(e),online=False)
        return
    while True:
        # Vosk model stays loaded locally; fetching and transcribing Twitch
        # audio only starts from one minute before until three minutes after.
        if not countdown_gate():
            update(online=False,state="waiting_countdown")
            time.sleep(GATE_POLL_SECONDS)
            continue
        ff=None
        try:
            url=stream_url()
            cmd=["ffmpeg","-hide_banner","-loglevel","error","-nostdin",
                 "-i",url,"-vn","-ac","1","-ar","16000",
                 "-f","s16le","-acodec","pcm_s16le","pipe:1"]
            ff=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
            rec=KaldiRecognizer(model,16000)
            rec.SetWords(False)
            update(state="listening",online=True,lastError=None,videoAudioOpenedAt=ts())
            logging.info("Listening to TheGrefg audio through ffmpeg")
            last_gate_poll=0
            while ff.poll() is None:
                if time.time()-last_gate_poll>=GATE_POLL_SECONDS:
                    last_gate_poll=time.time()
                    if not countdown_gate():
                        update(state="window_closed",online=False)
                        logging.info("Window closed; stopping audio transcription")
                        break
                data=ff.stdout.read(8192)
                if not data:
                    time.sleep(.2)
                    continue
                update(lastAudioPacketAt=ts(),online=True)
                if rec.AcceptWaveform(data):
                    result=json.loads(rec.Result())
                    handle_transcript(result.get("text",""))
                else:
                    result=json.loads(rec.PartialResult())
                    partial=result.get("partial","")
                    if partial:
                        update(lastTranscript=partial)
            if ff.poll() is not None and countdown_gate():
                raise RuntimeError("ffmpeg audio process exited")
        except Exception as e:
            logging.warning("Audio reconnect: %s",e)
            update(state="retrying",online=False,lastError=str(e)[:700])
        finally:
            if ff and ff.poll() is None:
                ff.kill()
                try:ff.wait(timeout=3)
                except Exception:pass
        time.sleep(8)


VOICE_WATCH_HTML = """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#10253b"><title>Code Hunter · Voz</title><style>body{background:#0a2133;color:#f1faff;font:15px/1.5 system-ui;margin:auto;max-width:750px;padding:18px}h1{font-size:25px}.panel{background:#14324a;border:1px solid #3a5d76;border-radius:12px;padding:14px;margin:13px 0}.entry{border-top:1px solid #426178;padding:9px 0}.muted{font-size:12px;color:#a5c0d0}.alert{color:#74edba;font-weight:800}a{color:#9edafc}button{background:#64e5b5;color:#08301c;font-weight:750;border:0;border-radius:9px;padding:11px}</style></head><body><h1>🎙️ TheGrefg · Voz en directo</h1><p>Transcripción completa reciente. Avisos de código y adivinanza. La voz puede confundir letras y números.</p><p><a href="https://gta-vi-code-hunter.vercel.app/">Volver a Code Hunter</a> · <a href="https://www.twitch.tv/thegrefg">Abrir el directo</a></p><button id="sound">Activar avisos</button><div class="panel"><div id="status">Conectando...</div><div id="cue" class="alert"></div><div id="clue"></div></div><div class="panel"><b>Últimas 30 frases</b><div id="lines"></div></div><p class="muted">Se actualiza cada 5 segundos mientras esta pestaña esté abierta. Sin códigos validados ni canjes automáticos.</p><script>
(()=>{let audio=null,lastCue="";
const $=id=>document.getElementById(id);
const tim=s=>s?new Date(s).toLocaleTimeString("es-ES"):"—";
function alert(){if(navigator.vibrate)navigator.vibrate([150,60,150]);if(audio){let o=audio.createOscillator(),g=audio.createGain();o.frequency.value=970;g.gain.value=.13;o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.2)}}
async function poll(){try{const r=await fetch("/status?ts="+Date.now(),{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);let d=await r.json();let ok=d.online&&d.lastAudioPacketAt&&Date.now()-Date.parse(d.lastAudioPacketAt)<60000;
$("status").textContent=(ok?"● Voz recibiendo":"● Voz no confirmada")+" · "+(d.transcriptsProcessed||0)+" frases · Último audio "+tim(d.lastAudioPacketAt);
let cue=d.lastReleaseCue;$("cue").textContent=cue?"⚡ Anuncio de código a las "+tim(cue.time)+": "+cue.text:"Sin nuevo anuncio de código";
let clue=d.lastPuzzleClue;$("clue").textContent=clue?"PISTA: "+clue.text:"";
const root=$("lines");root.replaceChildren();for(const x of (d.recentTranscripts||[]).slice(0,30)){let row=document.createElement("div");row.className="entry";let t=document.createElement("div");t.className="muted";t.textContent=tim(x.time);let m=document.createElement("div");m.textContent=x.text;row.append(t,m);root.append(row)}
if(cue&&cue.time!==lastCue){lastCue=cue.time;if(Date.now()-Date.parse(cue.time)<15000)alert()}
}catch(e){$("status").textContent="Error: "+String(e)}}
$("sound").onclick=async()=>{try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();await audio.resume();$("sound").textContent="Avisos activos"}catch(e){$("sound").textContent="Audio bloqueado"}};
poll();setInterval(()=>{if(!document.hidden)poll()},5000)})();
</script></body></html>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/watch":
            data=VOICE_WATCH_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type","text/html; charset=utf-8")
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Length",str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path.split("?")[0] not in ("/","/status","/health"):
            self.send_response(404);self.end_headers();return
        data=snapshot(short=self.path.startswith("/health"))
        content=json.dumps(data,ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Content-Length",str(len(content)))
        self.end_headers();self.wfile.write(content)
    def do_HEAD(self):
        self.send_response(200);self.end_headers()
    def do_OPTIONS(self):
        self.send_response(204);self.send_header("Access-Control-Allow-Origin","*");self.end_headers()
    def log_message(self,fmt,*args):pass
if __name__=="__main__":
    threading.Thread(target=monitor,daemon=True).start()
    logging.info("Audio ASR HTTP server running port=%s channel=%s",PORT,CHANNEL)
    ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever()
