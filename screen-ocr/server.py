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
            while proc.poll() is None:
                time.sleep(0.7)
                try: mtime=os.path.getmtime(FRAMEFILE)
                except OSError: continue
                if mtime <= seen_mtime: 
                    if time.time()-no_frames_at>55:
                        raise RuntimeError("No recent video frames for 55 seconds; restarting stream")
                    continue
                seen_mtime=mtime; no_frames_at=time.time()
                put(state="reading_screen",lastFrameAt=timestamp())
                try:
                    text=recognize(FRAMEFILE)
                    process_frame(text)
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
if __name__ == "__main__":
    threading.Thread(target=watcher,daemon=True).start()
    server=ThreadingHTTPServer(("0.0.0.0",HTTP_PORT),Handler)
    logging.info("OCR API listening at :%s for %s",HTTP_PORT,STREAMER)
    server.serve_forever()
