"""Isolated renderer smoke test, using original upstream OpenCV clipper.

Public routes return synthetic demo assets only. NEVER downloads streamers,
touches the live worker or uploads to YouTube.
"""
import json
import os
import subprocess
import sys
import threading
import traceback
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

HOME=Path(__file__).resolve().parent
sys.path.insert(0,str(HOME/"upstream"))
from adapter import preview_highlights
from shorts_generator.local.clipper import crop_highlights_local

OUTPUT=HOME/"output"
OUTPUT.mkdir(exist_ok=True)
STATE={"ok":False,"phase":"pending","error":None,"source":"synthetic FFmpeg test pattern (not a streamer clip)",
       "generated_mp4s":0,"published_to_youtube":False,"dependencies":"upstream original OpenCV / FFmpeg"}
ALLOWED={"source.mp4", "short_01.mp4"}

def run(*args):
    result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=160)
    if result.returncode:
        raise RuntimeError("command failed: "+str(args[:2])+": "+result.stderr[-600:])
    return result.stdout.strip()

def media_info(path):
    raw=run("ffprobe","-v","error","-show_entries","stream=codec_type,codec_name,width,height:format=duration,size","-of","json",str(path))
    return json.loads(raw)

def worker():
    try:
        STATE["phase"]="source_creation"
        src=OUTPUT/"source.mp4"
        run("ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
            "-f","lavfi","-i","testsrc2=size=640x360:rate=8",
            "-f","lavfi","-i","sine=frequency=650:sample_rate=44100",
            "-t","33","-c:v","libx264","-preset","ultrafast",
            "-crf","28","-pix_fmt","yuv420p","-c:a","aac","-b:a","96k",str(src))
        transcript={"duration":33, "segments":[
            {"start":3,"end":8,"text":"Test: inicio de un momento con tensión"},
            {"start":10,"end":15,"text":"Test: reacción inesperada"},
            {"start":20,"end":26,"text":"Test: final de la secuencia"}
        ]}
        def fake_llm(prompt):
            if "Choose one: podcast" in prompt:
                return '{"content_type":"commentary","density":"high"}'
            return json.dumps({"highlights":[
                {"title":"PRUEBA TÉCNICA — SELECCIÓN ORIGINAL",
                 "start_time":8,"end_time":20,"score":95,
                 "hook_sentence":"Reacción inesperada","virality_reason":"Demonstration only"},
                {"title":"SUPERPUESTO","start_time":9,"end_time":19,"score":60,
                 "hook_sentence":"duplicado","virality_reason":"Overlap"}
            ]})
        STATE["phase"]="highlight_selection"
        selected=preview_highlights(transcript, fake_llm, num_clips=1,max_clip_seconds=35)
        if len(selected["highlights"])!=1:
            raise RuntimeError("highlight_not_selected")
        STATE["highlights"]=selected["highlights"]
        STATE["phase"]="upstream_crop_and_audio_mux"
        import cv2
        print("OPENCV_DIAG", json.dumps({"file":str(getattr(cv2,"__file__",None)), "version":str(getattr(cv2,"__version__",None)), "hasCascadeClassifier":hasattr(cv2,"CascadeClassifier"), "path":str(getattr(cv2,"__path__",None)), "keys":dir(cv2)[:35]}),flush=True)
        clips=crop_highlights_local(str(src),selected["highlights"],aspect_ratio="9:16",out_dir=str(OUTPUT))
        result=clips[0]
        if not result.get("clip_url"):
            raise RuntimeError("upstream_clipper_failed: "+str(result.get("error")))
        info=media_info(OUTPUT/"short_01.mp4")
        streams=info.get("streams") or []
        video=next((s for s in streams if s.get("codec_type")=="video"),None)
        audio=next((s for s in streams if s.get("codec_type")=="audio"),None)
        if not video or not audio:
            raise RuntimeError("missing_video_or_audio_track")
        w,h=video.get("width",0),video.get("height",0)
        if w<=0 or h<=0 or abs(w/h-9/16)>0.02:
            raise RuntimeError("not_vertical_9_16")
        dur=float(info.get("format",{}).get("duration",0))
        if not 10<dur<14:
            raise RuntimeError("unexpected_output_duration: "+str(dur))
        STATE.update({"phase":"finished","ok":True,"generated_mp4s":1,
                      "duration_seconds":round(dur,2),"resolution":f"{w}x{h}",
                      "audio_codec":audio.get("codec_name"),"video_codec":video.get("codec_name"),
                      "size_bytes":int(info["format"]["size"])})
        print("AI_SHORTS_SMOKE_RESULT", json.dumps(STATE,ensure_ascii=False),flush=True)
    except Exception as e:
        STATE.update({"phase":"failed","error":str(e)[:1000]})
        print("AI_SHORTS_SMOKE_RESULT", json.dumps(STATE,ensure_ascii=False),flush=True)

class Handler(BaseHTTPRequestHandler):
    def send_json(self,data,status=200):
        b=json.dumps(data,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(b)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        if self.path=="/health":
            return self.send_json({"ok":True,"status":STATE["phase"]})
        if self.path=="/report":
            return self.send_json(STATE)
        if self.path=="/":
            return self.send_json({"description":"AI Shorts isolated technical test",
                                   "report":"/report","preview":"/demo/short_01.mp4"})
        if self.path.startswith("/demo/") and self.path.split("/")[-1] in ALLOWED:
            name=self.path.split("/")[-1]
            path=OUTPUT/name
            if not path.exists():
                return self.send_json({"error":"not_ready","phase":STATE["phase"]},503)
            data=path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type","video/mp4")
            self.send_header("Content-Length",str(len(data)))
            self.send_header("Accept-Ranges","none")
            self.send_header("Cache-Control","no-store")
            self.end_headers()
            return self.wfile.write(data)
        return self.send_json({"error":"not_found"},404)

if __name__=="__main__":
    threading.Thread(target=worker,daemon=True).start()
    port=int(os.environ.get("PORT","10000"))
    print("Serving isolated Shorts test on port",port,flush=True)
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()
