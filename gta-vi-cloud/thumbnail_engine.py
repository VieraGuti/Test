"""Contextual GTA VI compilation thumbnails with low CPU / zero image-API cost.

Inspired by OpenShorts (https://github.com/mutonby/openshorts, MIT):
sample multiple real video frames, rank by image quality, select temporally
diverse frames, and overlay *factual* short hooks in the episode's language.

No AI-generated faces, vehicles, logos or invented gameplay. The thumbnail
reflects what is actually in the user's compiled video. Optional image-model
enhancement can be added later; the reliable local fallback is always available.

Use: python thumbnail_engine.py /mnt/gtavi/es-2026-11-19.mp4
Requires FFmpeg, ffprobe and Pillow. All other dependencies are stdlib.
"""
from __future__ import annotations
import datetime as dt
import json,logging,math,shutil,subprocess,sys,tempfile,urllib.request
from dataclasses import dataclass
from pathlib import Path

log=logging.getLogger("gtavi-thumbnails")
WIDTH,HEIGHT=1280,720
MAX_BYTES=2*1024*1024  # conservative compatibility target
FRAMES_TO_SAMPLE=14
LOCALES={
 "es":("LOS MEJORES","MOMENTOS"),"en":("BEST","MOMENTS"),
 "ru":("ЛУЧШИЕ","МОМЕНТЫ"),"pt":("MELHORES","MOMENTOS"),
 "de":("BESTE","MOMENTE"),"fr":("MEILLEURS","MOMENTS"),
 "it":("MIGLIORI","MOMENTI"),"uk":("НАЙКРАЩІ","МОМЕНТИ"),
 "pl":("NAJLEPSZE","MOMENTY"),
}
FONT_PATHS=(
 "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
 "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
 "/usr/local/share/fonts/DejaVuSans-Bold.ttf",
)

@dataclass
class Sample:
    second:float
    quality:float
    path:Path


def _pil():
    try:
        from PIL import Image,ImageDraw,ImageEnhance,ImageFilter,ImageFont,ImageOps,ImageStat
    except ImportError as exc:
        raise RuntimeError("Pillow_not_installed") from exc
    return Image,ImageDraw,ImageEnhance,ImageFilter,ImageFont,ImageOps,ImageStat


def _duration(path):
    cp=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
                       "-of","default=noprint_wrappers=1:nokey=1",str(path)],
                      capture_output=True,text=True,timeout=25,check=True)
    return float(cp.stdout.strip())


def _seconds(duration,chapters):
    """Spread across real footage and selected clip centers, never just opening."""
    duration=float(duration)
    if duration<2:raise ValueError("thumbnail_source_too_short")
    out=[duration*(i+0.5)/FRAMES_TO_SAMPLE for i in range(FRAMES_TO_SAMPLE)]
    eligible=[ch for ch in chapters if isinstance(ch,dict)]
    for i,ch in enumerate(eligible[:25]):
        try:
            start=float(ch.get("startSeconds") or 0)
            finish=(float(eligible[i+1].get("startSeconds") or duration)
                    if i+1<len(eligible) else duration)
        except (ValueError,TypeError):continue
        if 0<=start<finish<=duration+1:
            out.append(start+min(max(1.5,(finish-start)*0.45),max(1.5,finish-start-0.5)))
    unique={}
    for second in out:
        candidate=min(duration-0.4,max(0.4,round(second,2)))
        unique[round(candidate,1)]=candidate
    # Keep fixed CPU budget, but include at least some chapter-aligned frames.
    values=sorted(unique.values())
    if len(values)>22:
        step=(len(values)-1)/21
        values=[values[round(i*step)] for i in range(22)]
    return values


def _extract_frame(video,second,destination):
    subprocess.run([
        "ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
        "-ss",f"{second:.2f}","-i",str(video),
        "-frames:v","1","-vf","scale=960:-2:flags=bicubic",
        "-q:v","4",str(destination)
    ],check=True,capture_output=True,timeout=32)
    if not destination.is_file() or destination.stat().st_size<2000:
        raise RuntimeError("extracted_thumbnail_frame_empty")


def _quality(image):
    """Approximate OpenShorts frame scoring without OpenCV, YOLO or GPU."""
    Image,_,_,ImageFilter,_,_,ImageStat=_pil()
    small=image.convert("RGB")
    small.thumbnail((240,135))
    gray=small.convert("L")
    lum=ImageStat.Stat(gray)
    mean=float(lum.mean[0])
    contrast=float(lum.stddev[0])
    edges=float(ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).mean[0])
    saturation=float(ImageStat.Stat(small.convert("HSV")).mean[1])
    # Black transitions / white flashes are bad thumbnails.
    exposure_penalty=max(0.0,30-mean)*2.3+max(0.0,mean-205)*1.8
    return contrast*0.55+min(70,edges)*1.35+saturation*0.09-exposure_penalty


def pick_diverse(samples,count=2,duration=1):
    """OpenShorts-style: rank by score and reject near-identical timestamps."""
    choices=[]
    gap=max(4.0,float(duration)*0.07)
    for item in sorted(samples,key=lambda s:s.quality,reverse=True):
        if all(abs(item.second-prev.second)>=gap for prev in choices):
            choices.append(item)
        if len(choices)>=count:break
    if not choices and samples:choices=[max(samples,key=lambda s:s.quality)]
    return choices


def _font(size):
    _,_,_,_,ImageFont,_,_=_pil()
    paths=list(FONT_PATHS)
    # Vercel Sandbox minimal images have no system fonts. Download an official
    # OFL-licensed Noto Sans font only once per machine. This supports ES/RU/UK
    # and the other languages without a large system dependency.
    cached=Path(tempfile.gettempdir())/"gtavi-noto-sans-v2.ttf"
    if cached.is_file() and cached.stat().st_size>10000:
        paths.insert(0,str(cached))
    for path in paths:
        try:
            font=ImageFont.truetype(path,int(size))
            if str(path)==str(cached):
                try:font.set_variation_by_axes([100,900])
                except (OSError,ValueError,AttributeError):pass
            return font
        except OSError:pass
    url=("https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/"
         "NotoSans%5Bwdth%2Cwght%5D.ttf")
    req=urllib.request.Request(url,headers={"User-Agent":"GTA-VI-Thumbnails/1.0"})
    with urllib.request.urlopen(req,timeout=25) as response:
        font_data=response.read(4*1024*1024+1)
    if not (10000<len(font_data)<4*1024*1024) or font_data[:4] not in (b"\x00\x01\x00\x00",b"OTTO"):
        raise RuntimeError("noto_font_download_invalid")
    cached.write_bytes(font_data)
    font=ImageFont.truetype(str(cached),int(size))
    try:font.set_variation_by_axes([100,900])
    except (OSError,ValueError,AttributeError):pass
    return font


def _fit_text(draw,text,width,initial,minsize=28):
    size=int(initial)
    while size>=minsize:
        font=_font(size)
        if draw.textbbox((0,0),text,font=font,stroke_width=0)[2]<=width:
            return font
        size-=3
    return _font(minsize)


def _compose(frame_path,destination,lang,episode,variant):
    Image,ImageDraw,ImageEnhance,ImageFilter,ImageFont,ImageOps,ImageStat=_pil()
    with Image.open(frame_path) as img:
        img=ImageOps.fit(img.convert("RGB"),(WIDTH,HEIGHT),method=Image.Resampling.LANCZOS,centering=(.5,.48))
    img=ImageEnhance.Color(img).enhance(1.15)
    img=ImageEnhance.Contrast(img).enhance(1.13)
    if variant==1:
        tint=(5,14,22); accent=(161,247,191); secondary=(255,255,255)
    else:
        tint=(17,11,22); accent=(255,205,105); secondary=(255,255,255)
    base=img.convert("RGBA")
    shade=Image.new("RGBA",(WIDTH,HEIGHT),(0,0,0,0))
    d=ImageDraw.Draw(shade,"RGBA")
    # Left-side dark gradient creates negative space; original action stays
    # visible on the right, and no fake people / gameplay are added.
    for x in range(0,WIDTH,4):
        f=max(0.0,1.0-x/(WIDTH*.79))
        alpha=round(222*(f**1.32))
        d.rectangle((x,0,x+4,HEIGHT),fill=(*tint,alpha))
    for y in range(HEIGHT-150,HEIGHT,3):
        f=(y-(HEIGHT-150))/150
        d.rectangle((0,y,WIDTH,y+3),fill=(0,0,0,round(90*f)))
    base=Image.alpha_composite(base,shade)
    draw=ImageDraw.Draw(base,"RGBA")
    draw.rounded_rectangle((44,40,344,84),radius=13,fill=(0,0,0,185),outline=(*accent,180),width=2)
    draw.text((65,48),"THE RANDOM REEL",font=_font(23),fill=secondary)
    draw.rounded_rectangle((WIDTH-145,36,WIDTH-41,91),radius=13,fill=(0,0,0,190),outline=(*accent,210),width=2)
    langtag=lang.upper()
    badge=_font(30)
    draw.text((WIDTH-93,60),langtag,font=badge,anchor="mm",fill=accent)
    # Two clear hooks; never imply an event that has not been observed.
    line1,line2=LOCALES.get(lang,LOCALES["en"])
    draw.rounded_rectangle((40,232,54,559),radius=6,fill=accent)
    draw.text((76,247),"GTA VI",font=_font(112),fill=secondary,
              stroke_width=3,stroke_fill=(0,0,0,220))
    draw.text((76,378),line1,font=_fit_text(draw,line1,810,63),fill=accent,
              stroke_width=2,stroke_fill=(0,0,0,230))
    draw.text((76,457),line2,font=_fit_text(draw,line2,820,63),fill=secondary,
              stroke_width=2,stroke_fill=(0,0,0,230))
    draw.rounded_rectangle((WIDTH-170,HEIGHT-105,WIDTH-40,HEIGHT-35),
                           radius=16,fill=(0,0,0,200),outline=(*accent,230),width=3)
    ep="#"+str(int(episode))
    draw.text((WIDTH-105,HEIGHT-70),ep,font=_fit_text(draw,ep,118,45),
              fill=accent,anchor="mm")
    out=base.convert("RGB")
    for quality in (90,84,78,70):
        out.save(destination,format="JPEG",quality=quality,optimize=True,subsampling=0)
        if destination.stat().st_size<=MAX_BYTES:break
    if destination.stat().st_size>MAX_BYTES:raise RuntimeError("thumbnail_over_byte_budget")
    return destination.stat().st_size


def generate_thumbnails(video,meta,force=False):
    """Generate two variants + stable winner; preserve the source MP4 untouched."""
    video=Path(video).resolve()
    if not video.is_file() or video.suffix.lower()!=".mp4":raise ValueError("missing_compilation_mp4")
    lang=str(meta.get("language") or "en").lower()[:2]
    episode=int(meta.get("episode") or 1)
    prefix=video.with_suffix("")
    winner=Path(str(prefix)+".thumbnail.jpg")
    manifest=Path(str(prefix)+".thumbnail.json")
    if not force and winner.is_file() and manifest.is_file():
        existing=json.loads(manifest.read_text(encoding="utf-8"))
        if existing.get("status")=="ready" and winner.stat().st_size>10000:
            return existing
    duration=float(meta.get("durationSeconds") or 0)
    if duration<=1:duration=_duration(video)
    candidates=[]
    Image,*_=_pil()
    with tempfile.TemporaryDirectory(prefix="gtavi-thumb-") as tmp:
        for i,second in enumerate(_seconds(duration,meta.get("chapters") or [])):
            frame=Path(tmp)/f"frame-{i:02d}.jpg"
            try:
                _extract_frame(video,second,frame)
                with Image.open(frame) as im:
                    score=_quality(im)
                candidates.append(Sample(second=second,quality=score,path=frame))
            except (subprocess.CalledProcessError,subprocess.TimeoutExpired,
                    OSError,RuntimeError) as exc:
                log.warning("Skipped thumbnail sample %.1fs: %s",second,str(exc)[:100])
        picks=pick_diverse(candidates,count=2,duration=duration)
        if not picks:raise RuntimeError("no_usable_video_frames_for_thumbnail")
        outputs=[]
        for i in range(2):
            sample=picks[min(i,len(picks)-1)]
            target=Path(str(prefix)+f".thumb-v{i+1}.jpg")
            size=_compose(sample.path,target,lang,episode,i+1)
            outputs.append({"file":str(target),"sourceSeconds":sample.second,
                            "qualityScore":round(sample.quality,3),"bytes":size})
        # Deterministically pick the sharpest sampled source instead of running
        # an expensive image-rating model. Variant #2 remains for review.
        best=max(outputs,key=lambda x:x["qualityScore"])
        shutil.copy2(best["file"],winner)
    result={"status":"ready","method":"open_source_real_frame_context",
            "language":lang,"episode":episode,"title":str(meta.get("title") or ""),
            "thumbnailFile":str(winner),"variants":outputs,
            "sourceVideo":str(video),"width":WIDTH,"height":HEIGHT,
            "selectedSourceSeconds":best["sourceSeconds"],
            "generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),
            "aiImageCostUsd":0}
    temp=manifest.with_suffix(".json.tmp")
    temp.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    temp.replace(manifest)
    return result


if __name__=="__main__":
    if len(sys.argv)!=2:raise SystemExit("Usage: thumbnail_engine.py /path/to/video.mp4")
    path=Path(sys.argv[1])
    metadata=json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
    print(json.dumps(generate_thumbnails(path,metadata),ensure_ascii=False))
