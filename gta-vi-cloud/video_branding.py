"""Minimal, privacy-friendly streamer on-screen credits.

ASS subtitles are rendered by FFmpeg/libass on the final picture. This module
never creates fake attribution: the streamer name always comes from the
specific source clip. It does not claim that a caption alone grants rights.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path

FONT="DejaVu Sans"
ASS_STYLES="Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"


def clean_creator(value,limit=34):
    """Remove ASS syntax, line breaks and invisible control characters."""
    text=str(value or "").replace("\\","").replace("{","").replace("}","")
    text=re.sub(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e]+"," ",text)
    text=" ".join(text.split()).strip(" @")
    return text[:limit].rstrip() if text else ""


def ass_timestamp(seconds):
    n=max(0,round(float(seconds)*100))
    return f"{n//360000}:{n//6000%60:02d}:{n//100%60:02d}.{n%100:02d}"


def ass_events_header():
    return "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"


def short_positions(canvas_w,canvas_h,source_w=1920,source_h=1080):
    """Actual 16:9/portrait foreground bounds after FFmpeg's fit/center."""
    canvas_w=max(1,int(canvas_w));canvas_h=max(1,int(canvas_h))
    source_w=max(1,int(source_w));source_h=max(1,int(source_h))
    max_fg_h=(round(canvas_h*.75)//2)*2
    scale=min(canvas_w/source_w,max_fg_h/source_h)
    fg_w=min(canvas_w,source_w*scale)
    fg_h=min(max_fg_h,source_h*scale)
    right=(canvas_w+fg_w)/2
    bottom=(canvas_h+fg_h)/2
    unit=canvas_w/720.0
    # Subtitle below visible footage, not at the bottom edge of the Short.
    caption_y=round(min(canvas_h-76*unit,bottom+81*unit))
    # Name is inside the bottom-right edge of the actual streamer footage.
    credit_x=round(min(canvas_w-18*unit,right-19*unit))
    credit_y=round(min(canvas_h-65*unit,bottom-17*unit))
    return {"caption_x":round(canvas_w/2),"caption_y":caption_y,
            "credit_x":credit_x,"credit_y":credit_y,
            "clip_bottom":round(bottom),"clip_right":round(right),
            "clip_height":round(fg_h),"clip_width":round(fg_w)}


def short_credit_tags(position,unit=1):
    x,y=int(position["credit_x"]),int(position["credit_y"])
    shift=round(30*unit)
    return r"{\an3\move("+str(x+shift)+","+str(y)+","+str(x)+","+str(y)+r",0,350)\fad(260,380)\blur0.3}"


def short_caption_tags(position):
    return r"{\an2\pos("+str(int(position["caption_x"]))+","+str(int(position["caption_y"]))+r")\fad(100,150)}"


def ass_credit_style(name="Credit",size=25,margin=35):
    # ASS primary tint is BGR: soft mint with dark semitransparent backing.
    return (f"Style: {name},{FONT},{int(size)},&H00BDF2B2,&H00BDF2B2,"
            f"&H8C0C1C18,&H810F191F,1,0,0,0,100,100,0,0,3,7,0,3,"
            f"{margin},{margin},{margin},1")


def longform_ass(path,chapters,duration,width=1920,height=1080):
    """An animated right-bottom source credit at every change of streamer."""
    width=max(640,int(width));height=max(360,int(height))
    duration=max(0.0,float(duration))
    font=max(16,round(height*.026))
    pad=max(16,round(width*.018))
    x=width-pad
    y=height-max(35,round(height*.04))
    header=(
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"+ASS_STYLES+"\n"
        +ass_credit_style(size=font,margin=pad)+"\n\n"+ass_events_header()
    )
    times=[]
    for ch in chapters:
        name=clean_creator(ch.get("creator"))
        if not name:continue
        try:t=max(0.0,min(duration,float(ch.get("startSeconds") or 0)))
        except (TypeError,ValueError):continue
        times.append((t,name))
    times.sort(key=lambda x:x[0])
    lines=[]
    for i,(start,name) in enumerate(times):
        end=times[i+1][0] if i+1<len(times) else duration
        if end-start<0.35:continue
        transition=round(min(60,30*width/1920))
        tags=(r"{\an3\move("+f"{x+transition},{y},{x},{y},0,420)"
              +r"\fad(320,320)\blur0.4}")
        lines.append(
            f"Dialogue: 0,{ass_timestamp(start)},{ass_timestamp(end)},Credit,,0,0,0,,"
            +tags+"@"+name
        )
    Path(path).write_text(header+"\n".join(lines)+"\n",encoding="utf-8")
    return len(lines)


def video_dimensions(path):
    r=subprocess.run(["ffprobe","-v","error","-select_streams","v:0",
                      "-show_entries","stream=width,height","-of","json",str(path)],
                     capture_output=True,text=True,timeout=20)
    if r.returncode:raise RuntimeError("ffprobe_video_dimensions_failed")
    data=json.loads(r.stdout)["streams"][0]
    return int(data["width"]),int(data["height"])


def burn_longform_credits(video,chapters,duration,timeout=1200):
    """One *optional* full-video encoding pass, not 30 encodes per episode.

    If it fails, leave the original fast-rendered MP4 untouched.
    The caller must decide whether to upload an unbranded draft.
    """
    src=Path(video).resolve()
    if not src.is_file():raise FileNotFoundError(str(src))
    w,h=video_dimensions(src)
    ass=src.with_suffix(".credits.ass")
    count=longform_ass(ass,chapters,duration,w,h)
    if not count:return {"branded":False,"reason":"missing_creator_names"}
    result=src.with_name(src.stem+".credited.mp4")
    if result.exists():raise RuntimeError("credited_output_exists")
    # 1080p/60: superfast H.264 rather than expensive HEVC; copy original audio.
    cmd=["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
         "-i",str(src),"-vf",f"ass={ass.as_posix()}",
         "-map","0:v:0","-map","0:a?","-c:v","libx264","-preset","superfast",
         "-crf","19","-maxrate","12M","-bufsize","24M","-threads","2",
         "-pix_fmt","yuv420p","-c:a","copy",
         "-movflags","+faststart",str(result)]
    try:
        subprocess.run(cmd,check=True,timeout=timeout,capture_output=True,text=True)
        if result.stat().st_size<10000:raise RuntimeError("branded_file_empty")
        return {"branded":True,"outputFile":str(result),"credits":count,
                "fileBytes":result.stat().st_size}
    except Exception:
        result.unlink(missing_ok=True)
        raise
    finally:
        ass.unlink(missing_ok=True)
