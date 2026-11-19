#!/usr/bin/env python3
"""TheGrefg public Twitch stream OCR watcher.
Only monitors public video content. No Twitch or PSN credentials used.
"""
import os
import re
import json
import time
import threading
import subprocess
import logging
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageEnhance, ImageOps, ImageFilter
import pytesseract

STREAMER = os.environ.get("STREAM_CHANNEL", "thegrefg").lower()
FRAME_SECONDS = max(2, int(os.environ.get("FRAME_SECONDS", "4")))
HTTP_PORT = int(os.environ.get("PORT", "10000"))
# Minimal timer OCR every 15s; full-resolution code OCR only around a giveaway.
TIMER_SCAN_SECONDS = max(5, int(os.environ.get("TIMER_SCAN_SECONDS", "15")))
ACTIVE_SCAN_SECONDS = max(2, int(os.environ.get("ACTIVE_SCAN_SECONDS", "3")))
PRE_EVENT_SECONDS = max(10, int(os.environ.get("PRE_EVENT_SECONDS", "60")))
POST_EVENT_SECONDS = max(20, int(os.environ.get("POST_EVENT_SECONDS", "180")))
TIMER_PATTERN = re.compile(r"(?<![0-9])(?:(\d{1,2})\s*:\s*)?(\d{1,2})\s*:\s*(\d{2})(?![0-9])")
TIMER_CONTEXT = re.compile(r"SORTEO|REGALO|CODIG|CÓDIG|GIVEAWAY|TIMER|COUNTDOWN|PR[ÓO]XIMO|NEXT|DROP", re.I)

FRAMEFILE = "/tmp/gta6_grefg_ocr.jpg"
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

STATE_LOCK = threading.Lock()
STATE = {
    "service": "gta-vi-code-hunter-screen-ocr-v1",
    "channel": STREAMER,
    "state": "starting",
    "online": False,
    "lastFrameAt": None,
    "lastOCRAt": None,
    "lastOCRExcerpt": "",
    "framesProcessed": 0,
    "timerScans": 0,
    "countdownSeconds": None,
    "countdownText": None,
    "nextEventAt": None,
    "windowStartAt": None,
    "windowEndAt": None,
    "windowActive": False,
    "scanMode": "searching_timer",
    "lastTimerAt": None,
    "lastError": None,
    "lastHeartbeat": time.time(),
    "startedAt": datetime.now(timezone.utc).isoformat(),
    "events": deque(maxlen=40),
    "candidates": {},
}
CODE_SEPARATED = re.compile(r"(?<![A-Z0-9])([A-Z0-9]{4})[\s\-:./|]+([A-Z0-9]{4})[\s\-:./|]+([A-Z0-9]{4})(?![A-Z0-9])")
CODE_COMPACT = re.compile(r"(?<![A-Z0-9])([A-Z0-9]{12})(?![A-Z0-9])")
CONTEXT = re.compile(r"CODE|CODIGO|CÓDIGO|CLAVE|PS5|PSN|GTA|CANJEAR|REDEEM|KEY", re.I)
def timestamp():
    return datetime.now(timezone.utc).isoformat()

def put(**changes):
    with STATE_LOCK:
        STATE.update(changes)
        STATE["lastHeartbeat"] = time.time()

def notify(event):
    with STATE_LOCK:
        STATE["events"].appendleft(event)
    logging.info("EVENT %s", json.dumps(event, ensure_ascii=False))

def get_public():
    with STATE_LOCK:
        d = {k:v for k,v in STATE.items() if k not in ("events", "candidates")}
        d["events"] = list(STATE["events"])[:20]
        d["candidates"] = sorted((dict(c) for c in STATE["candidates"].values()), key=lambda x: x["lastSeen"], reverse=True)[:20]
        d["lastHeartbeat"] = timestamp() if time.time()-STATE["lastHeartbeat"]<30 else "stale"
        return d

def discover_url():
    put(state="resolving_twitch_video",lastError=None)
    args = ["streamlink", "--stream-url", f"https://www.twitch.tv/{STREAMER}",
            "720p,720p60,480p,480p60,best"]
    cp = subprocess.run(args, capture_output=True, text=True, timeout=35)
    url = cp.stdout.strip().splitlines()
    if cp.returncode != 0 or not url or not url[-1].startswith("http"):
        raise RuntimeError("Streamlink could not access live video: "+cp.stderr[-550:].replace("\n"," "))
    return url[-1]

def start_video(hls_url):
    try:
        os.remove(FRAMEFILE)
    except FileNotFoundError:
        pass
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin",
        "-user_agent", "Mozilla/5.0 (compatible; GTA-VI-CodeHunter/1.0)",
        "-i", hls_url,
        "-an", "-vf", f"fps=1/{FRAME_SECONDS},scale=1600:-2",
        "-q:v", "3", "-f", "image2", "-update", "1", "-y", FRAMEFILE
    ]
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def recognize(path):
    with Image.open(path) as im:
        im.load()
        im = im.convert("RGB")
        width, height = im.size
        # OCR both the full image and its central/lower overlays.
        full = ImageEnhance.Contrast(ImageOps.grayscale(im)).enhance(2)
        central = full.crop((0, max(0,int(height*.12)), width, min(height,int(height*.90))))
        variants = [(full, 11), (central, 6)]
        readings = []
        for image, mode in variants:
            readings.append(pytesseract.image_to_string(
                image,
                config=f"--psm {mode}"
            ))
        return "\n".join(readings)


# Countdown gate shared by screenshot and speech service.
# The background tracker only reads a low-frequency timer; heavier detection
# is on from T-60 seconds through T+180 seconds.
_event_zero_epoch = None
_last_countdown_candidate = None
_last_timer_read_at = 0.0

def countdown_candidates(ocr):
    """Find plausible visible hh:mm:ss or mm:ss overlays, with context scoring."""
    lines = [ln.strip() for ln in ocr.splitlines() if ln.strip()]
    options=[]
    for line in lines:
        for m in TIMER_PATTERN.finditer(line):
            if m.group(1) is not None:
                h, minute, second = int(m.group(1)),int(m.group(2)),int(m.group(3))
                if minute >= 60 or second >= 60: continue
                seconds=h*3600+minute*60+second
            else:
                minute,second=int(m.group(2)),int(m.group(3))
                if second>=60:continue
                seconds=minute*60+second
            if not 0 <= seconds <= 7200:continue
            score=3 if TIMER_CONTEXT.search(line) else 0
            if len(line)<45: score+=1
            if m.group(1) is not None: score+=1
            options.append((score, seconds, line[:120]))
    options.sort(key=lambda x:(-x[0],x[1]))
    return options

def refresh_window():
    global _event_zero_epoch
    current=time.time()
    if _event_zero_epoch is None:
        put(windowActive=False, scanMode="searching_timer",
            countdownSeconds=None, windowStartAt=None, windowEndAt=None)
        return False
    until=_event_zero_epoch-current
    active= -POST_EVENT_SECONDS <= until <= PRE_EVENT_SECONDS
    end=_event_zero_epoch+POST_EVENT_SECONDS
    # Keep the schedule even if the overlay disappears at the moment of giveaway.
    # Beyond the window wait for a new countdown rather than watch forever.
    if until < -POST_EVENT_SECONDS:
        put(windowActive=False,scanMode="waiting_next_timer",
            countdownSeconds=0,windowStartAt=timestamp_from_epoch(_event_zero_epoch-PRE_EVENT_SECONDS),
            windowEndAt=timestamp_from_epoch(end))
        return False
    mode="tracking_codes" if active else "waiting_countdown"
    put(windowActive=active,scanMode=mode,
        countdownSeconds=max(0,int(until)),
        nextEventAt=timestamp_from_epoch(_event_zero_epoch),
        windowStartAt=timestamp_from_epoch(_event_zero_epoch-PRE_EVENT_SECONDS),
        windowEndAt=timestamp_from_epoch(end))
    return active

def timestamp_from_epoch(value):
    return datetime.fromtimestamp(value,timezone.utc).isoformat()

def update_timer(text):
    global _event_zero_epoch,_last_countdown_candidate,_last_timer_read_at
    current=time.time()
    options=countdown_candidates(text)
    _last_timer_read_at=current
    put(timerScans=get_public()["timerScans"]+1,lastTimerAt=timestamp())
    if not options:
        refresh_window()
        return
    score, seconds, raw=options[0]
    proposed=current+seconds
    if _event_zero_epoch is None:
        # Avoid locking onto an unrelated timer until 2 consistent scans, unless <=1min.
        if seconds<=PRE_EVENT_SECONDS:
            _event_zero_epoch=proposed
        elif _last_countdown_candidate is not None and abs(_last_countdown_candidate-proposed)<35:
            _event_zero_epoch=proposed
        _last_countdown_candidate=proposed
    elif abs(_event_zero_epoch-proposed)<42:
        # Smooth OCR jitter; don't drift with every minor glitch.
        _event_zero_epoch=0.85*_event_zero_epoch+0.15*proposed
    else:
        # A new countdown after a completed event; require 2 agreeing scans.
        if _last_countdown_candidate is not None and abs(_last_countdown_candidate-proposed)<35:
            _event_zero_epoch=proposed
            notify({"type":"next_countdown","time":timestamp(),"seconds":seconds,"text":raw})
        _last_countdown_candidate=proposed
    put(countdownText=raw)
    refresh_window()

def codes_from_text(text):
    clean = text.upper().replace("—","-").replace("–","-").replace("_","-")
    # Keep line boundaries; OCR may emit chat or captions unrelated to the code.
    candidates = []
    for line in clean.splitlines():
        if not line.strip():
            continue
        for m in CODE_SEPARATED.finditer(line):
            code = "-".join(m.groups())
            if any(ch.isdigit() for ch in code):
                candidates.append((code,line[:160]))
        if CONTEXT.search(line):
            for m in CODE_COMPACT.finditer(line):
                code = m.group(1)
                if any(ch.isdigit() for ch in code):
                    candidates.append((f"{code[:4]}-{code[4:8]}-{code[8:]}",line[:160]))
    return list(dict(((code,original),None) for code,original in candidates).keys())

def process_frame(ocr):
    found = codes_from_text(ocr)
    current = timestamp()
    put(lastOCRAt=current,lastOCRExcerpt=ocr[:650],framesProcessed=get_public()["framesProcessed"]+1)
    if get_public()["framesProcessed"] % 20 == 0:
        logging.info("OCR heartbeat frames=%s candidates=%s", get_public()["framesProcessed"],len(get_public()["candidates"]))
    for code,context in found:
        new = False
        with STATE_LOCK:
            entries = STATE["candidates"]
            if code not in entries:
                entries[code] = {"code":code,"firstSeen":current,"lastSeen":current,"hits":0,
                                 "status":"possible_visual_code","context":context,"source":"screen_ocr"}
                new = True
            item = entries[code]
            item["lastSeen"]=current
            item["hits"]+=1
            if item["hits"]>=2:
                item["status"]="seen_in_multiple_frames"
            if len(entries)>120:
                for k in list(entries)[:30]:
                    if k!=code: entries.pop(k,None)
            sample=dict(item)
        if new:
            notify({"type":"ocr_candidate","time":current,"channel":STREAMER,**sample})
        elif sample["hits"]==2:
            notify({"type":"ocr_confirmed_repetition","time":current,"channel":STREAMER,**sample})

def watcher():
    while True:
        proc=None
        try:
            put(state="connecting",online=False)
            url=discover_url()
            proc=start_video(url)
            put(state="capturing",online=True,lastError=None)
            seen_mtime=0
            no_frames_at=time.time()
            last_ocr_at=0.0
            while proc.poll() is None:
                time.sleep(0.7)
                try: mtime=os.path.getmtime(FRAMEFILE)
                except OSError:
                    if time.time()-no_frames_at>55:
                        raise RuntimeError("Twitch video produced no frame in 55 seconds")
                    continue
                if mtime <= seen_mtime: 
                    if time.time()-no_frames_at>55:
                        raise RuntimeError("No recent video frames for 55 seconds; restarting stream")
                    continue
                seen_mtime=mtime; no_frames_at=time.time()
                put(state="reading_screen",lastFrameAt=timestamp())
                active=refresh_window()
                scan_interval=ACTIVE_SCAN_SECONDS if active else TIMER_SCAN_SECONDS
                if time.time()-last_ocr_at < scan_interval:
                    continue
                last_ocr_at=time.time()
                try:
                    text=recognize(FRAMEFILE)
                    update_timer(text)
                    if refresh_window():
                        process_frame(text)
                    else:
                        # This still shows the timer's raw OCR, without expensive
                        # candidate validation outside the giveaway window.
                        put(lastOCRAt=timestamp(),lastOCRExcerpt=text[:650],
                            state="timer_only",online=True)
                    put(state="watching",online=True)
                except Exception as e:
                    put(lastError="OCR error: "+str(e)[:250],state="ocr_error")
            err=proc.stderr.read(1500).decode("utf-8","replace")[-450:] if proc.stderr else ""
            raise RuntimeError("Video decoder exited: "+err)
        except Exception as e:
            logging.warning("Watcher reconnect: %s",e)
            put(state="retrying",online=False,lastError=str(e)[:650])
        finally:
            if proc and proc.poll() is None:
                proc.kill()
                try:proc.wait(timeout=3)
                except Exception:pass
        time.sleep(9)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route=self.path.split("?")[0]
        if route == "/frame":
            try:
                with open(FRAMEFILE,"rb") as src:
                    data=src.read()
                if not data:
                    raise FileNotFoundError()
            except (FileNotFoundError, PermissionError):
                self.send_response(503)
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type","image/jpeg")
            self.send_header("Access-Control-Allow-Origin","*")
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Length",str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if route not in ("/","/health","/status"):
            self.send_response(404)
            self.end_headers()
            return
        payload=get_public()
        if route=="/health":
            payload={k:payload[k] for k in ("service","state","channel","online","framesProcessed","lastFrameAt","lastError","startedAt")}
        data=json.dumps(payload,ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.end_headers()
    def log_message(self, format, *args):
        if self.path.startswith("/health"):return
        return super().log_message(format,*args)
def status_logger():
    while True:
        time.sleep(30)
        data=get_public()
        logging.info("OCR STATUS state=%s online=%s frames=%s timerScans=%s countdown=%s active=%s lastFrame=%s err=%s",
            data.get("state"),data.get("online"),data.get("framesProcessed"),
            data.get("timerScans"),data.get("countdownSeconds"),data.get("windowActive"),
            data.get("lastFrameAt"),data.get("lastError"))

if __name__ == "__main__":
    threading.Thread(target=watcher,daemon=True).start()
    threading.Thread(target=status_logger,daemon=True).start()
    server=ThreadingHTTPServer(("0.0.0.0",HTTP_PORT),Handler)
    logging.info("OCR API listening at :%s for %s",HTTP_PORT,STREAMER)
    server.serve_forever()
