"""Low-CPU GTA VI montage mode for the 512 MiB Render worker.

The fast mode deliberately never decodes or re-encodes video. It groups clips
with matching HEVC/H.264 + AAC stream characteristics and copies compressed
packets into an MP4. Sources that cannot be joined safely remain candidates
for later episodes; they are not silently corrupted by incompatible concat.

Unlike the legacy full-reencode render, target fast episodes are 10–25 minutes.
This is an opt-in strategy: COMPILATION_FAST_MODE=true. Never enable it by
restarting a running legacy compilation without first preserving that job.
"""
from __future__ import annotations
import datetime as dt
import json
import logging
import re
import subprocess
import tempfile
from collections import Counter
from fractions import Fraction
import math
from pathlib import Path
from urllib.parse import urlparse

from daily_compilations import (
    MIN_CLIPS, RIGHTS_OK, _duration, _run, date_of, download_twitch_clip,
    fps_value, is_twitch_clip, media_spec,
)

log=logging.getLogger('gtavi-fast-compilations')
MIN_SECONDS=10*60
MAX_SECONDS=25*60
TARGET_SECONDS=20*60
PROBE_LIMIT=8
MAX_DOWNLOADS=130
MIN_BYTES=1000


def format_key(spec):
    """Strict compatibility key for safe packet-copy concatenation."""
    if spec.get('video') not in ('hevc', 'h264') or spec.get('audio')!='aac':
        return None
    width,height=int(spec.get('width') or 0),int(spec.get('height') or 0)
    if not (640<=width<=1920 and 360<=height<=1080):
        return None
    fps=fps_value(spec)
    if fps not in (30,60):
        return None
    if not spec.get('pix_fmt') or not spec.get('sample_rate') or not spec.get('channels'):
        return None
    return (
        spec['video'],width,height,spec['pix_fmt'],fps,
        str(spec['sample_rate']),int(spec['channels']),
    )


def final_format_compatible(spec,reference):
    """Verify final remux has the same codecs and stream geometry as its sources.

    ffprobe's avg_frame_rate is derived from all concat packet timestamps and
    can drift slightly after remuxing, unlike the nominal rate of each clip.
    Only the frame-rate check allows a bounded tolerance; any codec,
    resolution, pixel-format, sample-rate, or channel change is rejected.
    """
    try:
        expected=(reference[0],reference[1],reference[2],reference[3],
                  str(reference[5]),int(reference[6]))
        actual=(str(spec.get('video') or ''),int(spec.get('width') or 0),
                int(spec.get('height') or 0),str(spec.get('pix_fmt') or ''),
                str(spec.get('sample_rate') or ''),int(spec.get('channels') or 0))
        if spec.get('audio')!='aac' or actual!=expected:
            return False
        fps=float(Fraction(str(spec.get('fps') or '0/1')))
        return math.isfinite(fps) and reference[4]*0.90<=fps<=reference[4]*1.10
    except (TypeError,ValueError,ZeroDivisionError,OverflowError):
        return False


def choose_primary(specs):
    """Use the most common compatible class, breaking ties by total duration."""
    weights=Counter()
    durations=Counter()
    for spec,duration in specs:
        key=format_key(spec)
        if key:
            weights[key]+=1
            durations[key]+=float(duration)
    if not weights:
        return None
    return max(weights,key=lambda k:(weights[k],durations[k],k[1]*k[2]))


def _download_720(url,path):
    """Fast direct 1080p60 Twitch clip download, fallback to 720p.

    Twitch clip playback is usually already HEVC/H264+AAC MP4. yt-dlp
    retrieves the source bitstream; FFmpeg only remuxes it without quality loss.
    """
    if not is_twitch_clip(url):
        raise ValueError('unsupported_twitch_source')
    slug=urlparse(url).path.rstrip('/').split('/')[-1]
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,200}',slug):
        raise ValueError('invalid_twitch_clip_slug')
    path.unlink(missing_ok=True)
    try:
        _run(['yt-dlp','--no-playlist','--no-warnings','--socket-timeout','12',
              '--retries','2','-f','1080/720/best[height<=1080]/best',
              '--merge-output-format','mp4','-o',str(path),url],40)
        if path.is_file() and path.stat().st_size>=MIN_BYTES:return
        raise RuntimeError('yt_dlp_missing_file')
    except (RuntimeError,subprocess.TimeoutExpired,OSError) as exc:
        log.warning('Direct 1080p clip download failed, fallback: %s',str(exc)[:110])
        path.unlink(missing_ok=True)
    for identifier in (url,slug):
        try:
            _run(['TwitchDownloaderCLI','clipdownload','--id',identifier,
                  '--quality','1080p60','--output',str(path),
                  '--collision','Overwrite'],60)
            if path.is_file() and path.stat().st_size>=MIN_BYTES:return
        except (RuntimeError,subprocess.TimeoutExpired,OSError) as exc:
            log.warning('TwitchDownloader fallback failed: %s',str(exc)[:90])
            path.unlink(missing_ok=True)
    raise RuntimeError('all_twitch_download_methods_failed')

def _source(clip,index,tmp):
    path=clip.get('mediaPath')
    if path:
        source=Path(str(path)).resolve()
        if not source.is_file() or source.suffix.lower()!='.mp4':
            raise ValueError('local_clip_not_found')
        return source,False
    url=str(clip.get('url') or '')
    source=tmp/('source-%03d.mp4'%index)
    _download_720(url,source)
    return source,True


def _part(source,destination,key):
    cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
         '-i',str(source),'-map','0:v:0','-map','0:a:0',
         '-c','copy','-avoid_negative_ts','make_zero']
    if key[0]=='hevc':
        cmd+=['-tag:v','hvc1']
    cmd+=['-movflags','+faststart',str(destination)]
    _run(cmd,120)


def render_fast_plan(plan,folder,progress=None):
    """Create a real MP4 without CPU-heavy video encoding.

    Preserves source audio/video, requires a 10–25 min verified MP4, and
    skips incompatible formats rather than producing a corrupt compilation.
    """
    outdir=Path(folder);outdir.mkdir(parents=True,exist_ok=True)
    output=outdir/(plan['id']+'.mp4')
    metadata_file=output.with_suffix('.json')
    if output.exists():
        raise RuntimeError('draft_already_exists: refuse_to_overwrite')
    chapters=[];processed=[];skipped=[];used=[];total=0.0
    with tempfile.TemporaryDirectory(prefix='gtavi-fast-') as d:
        tmp=Path(d)
        queue=[]
        source_clips=list(plan.get('clips') or [])[:MAX_DOWNLOADS]
        if progress:progress({'stage':'probing','processed':0,'totalSources':len(source_clips),'durationSeconds':0,'targetSeconds':TARGET_SECONDS})
        for index,clip in enumerate(source_clips):
            if index>=PROBE_LIMIT:break
            try:
                src,ephemeral=_source(clip,index,tmp)
                spec=media_spec(src)
                duration=_duration(src)
                queue.append((index,clip,src,ephemeral,spec,duration))
                log.info('Probe %d/%d: %s %s %sx%s',index+1,PROBE_LIMIT,
                         clip.get('creator',''),spec['video'],spec['width'],spec['height'])
            except (RuntimeError,ValueError,subprocess.TimeoutExpired,OSError) as exc:
                skipped.append({'clipId':str(clip.get('id') or ''),'reason':str(exc)[:110]})
            if progress:progress({'stage':'probing','processed':index+1,'totalSources':len(source_clips),'durationSeconds':0,'targetSeconds':TARGET_SECONDS})
        reference=choose_primary([(q[4],q[5]) for q in queue])
        if reference is None:
            raise RuntimeError('no_compatible_stream_group: source quality unavailable')
        log.info('Fast montage profile: codec=%s %sx%s %sfps, no transcoding',
                 reference[0],reference[1],reference[2],reference[4])

        def process(entry):
            nonlocal total
            index,clip,src,ephemeral,spec,duration=entry
            ident=str(clip.get('id') or '')
            try:
                group=format_key(spec)
                if group!=reference:
                    skipped.append({'clipId':ident,'reason':'reserved_for_other_format'})
                    return
                if total+duration>MAX_SECONDS:
                    skipped.append({'clipId':ident,'reason':'episode_duration_limit'})
                    return
                destination=tmp/('part-%03d.mp4'%index)
                _part(src,destination,reference)
                measured=_duration(destination)
                if measured<=0 or total+measured>MAX_SECONDS:
                    destination.unlink(missing_ok=True)
                    skipped.append({'clipId':ident,'reason':'invalid_or_oversize_stream'})
                    return
                chapters.append({'startSeconds':round(total,2),
                                 'creator':str(clip.get('creator') or 'Streamer'),
                                 'clipId':ident,'sourceUrl':str(clip.get('url') or ''),
                                 'rightsStatus':str(clip.get('rights') or 'unverified')})
                total+=measured;processed.append(destination);used.append(ident)
                log.info('Fast montage COPIED %d clips %.1fs, newest=%s',
                         len(processed),total,ident)
                if progress:progress({'stage':'joining_sources','selected':len(processed),'processed':index+1,'totalSources':len(source_clips),'durationSeconds':round(total,1),'targetSeconds':TARGET_SECONDS})
            except (RuntimeError,ValueError,subprocess.TimeoutExpired,OSError) as exc:
                skipped.append({'clipId':ident,'reason':str(exc)[:110]})
                log.warning('Fast montage ignored damaged clip %s: %s',ident,str(exc)[:110])
            finally:
                if ephemeral:src.unlink(missing_ok=True)

        # Process already-probed clips in their editorial order.
        for entry in queue:
            if total>=TARGET_SECONDS:break
            process(entry)
        # Clean any unprocessed probe downloads before additional sources.
        for _,_,src,ephemeral,_,_ in queue:
            if ephemeral:src.unlink(missing_ok=True)
        for index,clip in enumerate(source_clips[PROBE_LIMIT:],PROBE_LIMIT):
            if total>=TARGET_SECONDS:break
            try:
                src,ephemeral=_source(clip,index,tmp)
                process((index,clip,src,ephemeral,media_spec(src),_duration(src)))
            except (RuntimeError,ValueError,subprocess.TimeoutExpired,OSError) as exc:
                skipped.append({'clipId':str(clip.get('id') or ''),
                                'reason':str(exc)[:110]})
            finally:
                # Never leave orphaned downloaded files after a failed probe.
                tmp.joinpath('source-%03d.mp4'%index).unlink(missing_ok=True)
        if progress:progress({'stage':'finalizing','selected':len(processed),'processed':len(source_clips),'totalSources':len(source_clips),'durationSeconds':round(total,1),'targetSeconds':TARGET_SECONDS})
        if len(processed)<MIN_CLIPS or total<MIN_SECONDS:
            raise RuntimeError('insufficient_matching_clips: %d sources %.1fs'%(len(processed),total))
        concat=tmp/'segments.txt'
        concat.write_text(''.join("file '"+str(f)+"'\n" for f in processed),encoding='utf-8')
        command=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                 '-f','concat','-safe','0','-i',str(concat),'-map','0:v:0',
                 '-map','0:a:0','-c','copy']
        if reference[0]=='hevc':command+=['-tag:v','hvc1']
        command+=['-movflags','+faststart',str(output)]
        try:
            _run(command,240)
            duration=_duration(output)
            if not MIN_SECONDS-2<=duration<=MAX_SECONDS+2:
                raise RuntimeError('bad_final_duration_%.1fs'%duration)
            final_spec=media_spec(output)
            if not final_format_compatible(final_spec,reference):
                log.error('Final stream profile differs from selected source profile: expected=%s actual=%s',reference,final_spec)
                raise RuntimeError('final_format_changed: expected=%s got=%s'%(reference,final_spec))
        except BaseException:
            output.unlink(missing_ok=True)
            raise

    meta={**{k:v for k,v in plan.items() if k not in ('clips','clipIds')},
          'clipIds':used,'chapters':chapters,'skippedClips':skipped,
          'durationSeconds':round(duration,2),'outputFile':str(output),
          'fileBytes':output.stat().st_size,'status':'rendered_private_draft',
          'copyrightReviewNeeded':any(str(c.get('rights') or '').lower() not in RIGHTS_OK
                                     for c in plan.get('clips',[]) if str(c.get('id')) in used),
          'contentReviewNeeded':bool(plan.get('categoryReviewNeeded')),
          'renderMethod':'direct_hevc_h264_stream_copy',
          'createdAt':dt.datetime.now(dt.timezone.utc).isoformat()}
    metadata_file.write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    if progress:progress({'stage':'complete','selected':len(used),'processed':len(source_clips),'totalSources':len(source_clips),'durationSeconds':round(duration,1),'targetSeconds':TARGET_SECONDS})
    return meta
