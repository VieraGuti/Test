"""Daily language-specific compilation editor. Produces MP4 drafts, not YouTube posts.

Source rights are recorded as provenance, not treated as automatic proof of clearance.
Editing a compilation does not eliminate copyright or monetization risks.
Durable state/storage and a publisher are required to fully automate distribution.
"""
from __future__ import annotations
import argparse, datetime as dt, json, math, os, re, subprocess, tempfile, logging
from collections import Counter
from difflib import SequenceMatcher
import shutil
from pathlib import Path
from urllib.parse import urlparse
import httpx

log=logging.getLogger('gtavi-daily-render')
MIN_SECONDS=15*60
MAX_SECONDS=30*60
TARGET_SECONDS=28*60
MAX_CLIPS=180  # safety bound, not an eight-clip editorial target
MIN_CLIPS=3
TARGET_WIDTH=1280
TARGET_HEIGHT=720
RIGHTS_OK={'owned','authorized','licensed','cleared','approved'}
LANGUAGES={'es':'es','en':'en','ru':'ru','pt':'pt','de':'de','fr':'fr','it':'it','uk':'uk','pl':'pl'}
TITLE_TEMPLATES={
 'es':'Mejores clips de GTA VI de la semana | #{n}',
 'en':'Best GTA VI Clips of the Week | #{n}',
 'ru':'Лучшие моменты GTA VI за неделю | #{n}',
 'pt':'Melhores clipes de GTA VI da semana | #{n}',
 'de':'Die besten GTA VI Clips der Woche | #{n}',
 'fr':'Meilleurs clips GTA VI de la semaine | #{n}',
 'it':'I migliori clip di GTA VI della settimana | #{n}',
 'uk':'Найкращі моменти GTA VI за тиждень | #{n}',
 'pl':'Najlepsze klipy GTA VI tygodnia | #{n}',
}
def language(code):
 raw=str(code or '').strip().lower().replace('_','-').split('-')[0]
 return LANGUAGES.get(raw)
def is_twitch_clip(url):
 try:
  p=urlparse(str(url or ''))
  return p.scheme=='https' and p.hostname in ('www.twitch.tv','twitch.tv','clips.twitch.tv') and (p.hostname=='clips.twitch.tv' or '/clip/' in p.path) and bool(p.path.strip('/'))
 except ValueError:return False
def date_of(item):
 raw=item.get('createdAt') or item.get('publishedAt') or item.get('uploadedAt')
 try:
  x=dt.datetime.fromisoformat(str(raw).replace('Z','+00:00'))
  return x if x.tzinfo else x.replace(tzinfo=dt.timezone.utc)
 except (ValueError,TypeError):return None
def is_eligible(item,day):
 when=date_of(item)
 if not when:return False
 end=dt.datetime.combine(day+dt.timedelta(days=1),dt.time.min,tzinfo=dt.timezone.utc)
 if not (end-dt.timedelta(days=7) <= when < end):return False
 if language(item.get('language')) is None:return False
 if item.get('gameVerified') is False:return False
 if item.get('gameVerified') is not True and item.get('gameCategoryMatched') is not True:return False
 if item.get('ageReviewRequired') or item.get('adultPossible'):return False
 if item.get('approvedForCompilation') is False:return False
 if not str(item.get('mediaPath') or '') and not is_twitch_clip(item.get('url')):return False
 if not str(item.get('id') or ''):return False
 dur=float(item.get('duration') or 0)
 return 7 <= dur <= 90
def rank(item):
 # Editorial quality leads. Popularity is only a tie-breaker.
 return float(item.get('editorialScore') or item.get('score') or 0)*2 + min(15,math.log1p(max(0,float(item.get('views') or 0))))
def clip_seconds(item):
 try:return float(item.get('duration') or 0)
 except (TypeError,ValueError):return 0.0
def same_moment(a,b):
 if str(a.get('creator','')).casefold()!=str(b.get('creator','')).casefold():return False
 x,y=date_of(a),date_of(b)
 if x and y and abs((x-y).total_seconds())<80:return True
 def normalized(c):
  return re.sub(r'[^\w]+',' ',str(c.get('title') or '').casefold()).strip()
 aa,bb=normalized(a),normalized(b)
 return bool(len(aa)>10 and len(bb)>10 and SequenceMatcher(None,aa,bb).ratio()>=0.88)
def select(items,lang,day,used_ids,max_clips=MAX_CLIPS):
 """Choose diverse clips by quality until roughly 28 minutes, never above 30."""
 candidates=[x for x in items if language(x.get('language'))==lang and is_eligible(x,day) and str(x['id']) not in used_ids]
 candidates.sort(key=lambda x:(rank(x),date_of(x)),reverse=True)
 chosen=[];creators=Counter();seen_ids=set();seconds=0.0
 # Diversity pass: select one per creator first, then 2+, up to a generous
 # ceiling so that a smaller language can still reach 15 minutes.
 for creator_limit in range(1,max_clips+1):
  for c in candidates:
   ident=str(c['id']).casefold()
   if ident in seen_ids:continue
   creator=str(c.get('creator') or 'Streamer').casefold()
   if creators[creator]>=creator_limit:continue
   duration=clip_seconds(c)
   if seconds+duration>MAX_SECONDS+0.001:continue
   if any(same_moment(c,old) for old in chosen):continue
   chosen.append(c);creators[creator]+=1;seen_ids.add(ident);seconds+=duration
   if len(chosen)>=max_clips or seconds>=TARGET_SECONDS:
    return chosen
 return chosen
def plan_by_language(items,state,day,langs=None):
 """Return draft plans. Does not mutate state."""
 if isinstance(day,str):day=dt.date.fromisoformat(day)
 wanted=list(dict.fromkeys(language(x) for x in (langs or LANGUAGES) if language(x)))
 plans=[]
 for lang in wanted:
  history=state.get('languages',{}).get(lang,{})
  if str(day) in history.get('createdDays',{}):continue
  selected=select(items,lang,day,set(history.get('usedClipIds',[])))
  selected_seconds=sum(clip_seconds(x) for x in selected)
  if len(selected)<MIN_CLIPS or not MIN_SECONDS<=selected_seconds<=MAX_SECONDS:continue
  episode=int(history.get('lastEpisode',0))+1
  plans.append({'id':f'{lang}-{day.isoformat()}','day':day.isoformat(),'language':lang,'episode':episode,
    'title':TITLE_TEMPLATES[lang].format(n=episode),
    'clips':selected,'clipIds':[str(x['id']) for x in selected],
    'plannedSeconds':round(selected_seconds,1),'targetSeconds':TARGET_SECONDS,
    'unverifiedSources':[{'id':str(c['id']),'creator':str(c.get('creator') or ''),'rights':str(c.get('rights') or 'unverified'),'url':str(c.get('url') or '')} for c in selected if str(c.get('rights') or '').lower() not in RIGHTS_OK],
    'categoryReviewNeeded':any(x.get('gameVerified') is not True for x in selected),
    'status':'awaiting_render_and_approval'})
 return plans
def _run(cmd,timeout=600):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('ffmpeg_error: '+(p.stderr or '')[-500:])
def _duration(path):
 p=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)],capture_output=True,text=True,timeout=20)
 if p.returncode:raise RuntimeError('ffprobe_error')
 return max(0,float(p.stdout.strip()))
def media_spec(path):
 p=subprocess.run(['ffprobe','-v','error','-show_streams','-of','json',str(path)],
   capture_output=True,text=True,timeout=20)
 if p.returncode:raise RuntimeError('invalid_video_stream')
 streams=json.loads(p.stdout or '{}').get('streams',[])
 v=next((x for x in streams if x.get('codec_type')=='video'),None)
 audio=next((x for x in streams if x.get('codec_type')=='audio'),None)
 if not v:raise RuntimeError('video_stream_missing')
 return {'video':str(v.get('codec_name') or ''),
         'width':int(v.get('width') or 0),'height':int(v.get('height') or 0),
         'fps':str(v.get('avg_frame_rate') or v.get('r_frame_rate') or ''),
         'pix_fmt':str(v.get('pix_fmt') or ''),
         'audio':str((audio or {}).get('codec_name') or ''),
         'sample_rate':str((audio or {}).get('sample_rate') or ''),
         'channels':int((audio or {}).get('channels') or 0)}
def copy_compatible(source,target):
 return (source.get('video')=='h264' and source.get('audio')=='aac' and
         target.get('video')=='h264' and target.get('audio')=='aac' and
         all(source.get(x)==target.get(x) for x in ('width','height','fps','pix_fmt','sample_rate','channels')))
def fps_value(spec):
 try:
  f=str(spec['fps']).split('/')
  n=float(f[0])/float(f[1]) if len(f)==2 else float(f[0])
  return int(round(n)) if 20<=n<=61 else 30
 except (ValueError,TypeError,ZeroDivisionError):return 30
def render_plan(plan,folder):
 """Produce long-form video, copying source bitstreams when compatible.

 Re-encode only clips with different video/audio formats. The majority
 stream format becomes the reference to minimize free-worker CPU time.
 """
 outdir=Path(folder);outdir.mkdir(parents=True,exist_ok=True)
 output=outdir/(plan['id']+'.mp4')
 with tempfile.TemporaryDirectory(prefix='gta6-daily-') as workspace:
  tmp=Path(workspace);sources=[];chapters=[];elapsed=0.0
  for i,clip in enumerate(plan['clips']):
   log.info('Compilation %s downloading clip %d/%d creator=%s',
       plan['id'],i+1,len(plan['clips']),str(clip.get('creator') or '')[:35])
   src=Path(clip.get('mediaPath') or '').resolve() if clip.get('mediaPath') else None
   if not src or not src.is_file():
    url=str(clip.get('url') or '')
    if not is_twitch_clip(url):raise ValueError('supported_clip_url_or_local_mp4_required: '+str(clip['id']))
    src=tmp/('source-%02d.mp4'%i)
    _run(['TwitchDownloaderCLI','clipdownload','--id',url,
          '--output',str(src),'--collision','Overwrite'],180)
   if src.suffix.lower()!='.mp4' or src.stat().st_size<1000:
    raise ValueError('unreadable_mp4: '+str(clip['id']))
   info=media_spec(src)
   sources.append((src,info,clip))
   log.info('Downloaded source %d/%d, video=%s %sx%s fps=%s audio=%s',
       i+1,len(plan['clips']),info['video'],info['width'],info['height'],info['fps'],info['audio'])
  if len(sources)<MIN_CLIPS:raise RuntimeError('insufficient_sources')
  groups=Counter((json.dumps(info,sort_keys=True) for _,info,_ in sources if info['video']=='h264' and info['audio']=='aac'))
  if groups:
   target=json.loads(groups.most_common(1)[0][0])
  else:
   target={'video':'h264','audio':'aac','width':1280,'height':720,'fps':'30/1',
           'pix_fmt':'yuv420p','sample_rate':'48000','channels':2}
  width=min(1920,max(640,target['width'] or 1280))
  height=min(1080,max(360,target['height'] or 720))
  fps=fps_value(target)
  log.info('Compilation %s chosen reference: %sx%s @%s fps, %d original streams reusable',
      plan['id'],width,height,fps,groups.most_common(1)[0][1] if groups else 0)
  pieces=[]
  for i,(src,info,clip) in enumerate(sources):
   target_file=tmp/('part-%02d.mp4'%i)
   if copy_compatible(info,target):
    _run(['ffmpeg','-nostdin','-v','error','-y','-i',str(src),
        '-map','0:v:0','-map','0:a:0','-c','copy','-avoid_negative_ts','make_zero',
        '-movflags','+faststart',str(target_file)],120)
    mode='lossless_stream_copy'
   else:
    vf=f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps},setsar=1,format=yuv420p'
    inputs=['-i',str(src)]
    if not info['audio']:
     inputs+=['-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000']
    command=['ffmpeg','-nostdin','-v','error','-y']+inputs+[
        '-vf',vf,'-map','0:v:0','-map','0:a:0' if info['audio'] else '1:a:0',
        '-c:v','libx264','-preset','ultrafast','-crf','20',
        '-threads','1','-c:a','aac','-b:a','160k','-ar',str(target.get('sample_rate') or '48000'),
        '-ac',str(target.get('channels') or 2),'-movflags','+faststart']
    if not info['audio']:command.append('-shortest')
    command.append(str(target_file))
    _run(command,600)
    mode='optimized_transcode'
   chapters.append({'startSeconds':round(elapsed,2),
     'creator':str(clip.get('creator') or 'Streamer'),
     'sourceUrl':str(clip.get('url') or ''),
     'rightsStatus':str(clip.get('rights') or 'unverified'),
     'originalTitle':str(clip.get('title') or '')[:200]})
   elapsed+=_duration(target_file)
   pieces.append(target_file)
   log.info('Compilation %s processed clip %d/%d mode=%s duration=%.1fs',
       plan['id'],i+1,len(sources),mode,_duration(target_file))
  concat=tmp/'concat.txt'
  concat.write_text(''.join("file '"+str(x)+"'\n" for x in pieces),encoding='utf-8')
  _run(['ffmpeg','-nostdin','-v','error','-y','-f','concat','-safe','0','-i',str(concat),
        '-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',str(output)],240)
  recorded=_duration(output)
  if recorded<sum(_duration(x) for x in pieces)*0.90:
   raise RuntimeError('concat_duration_mismatch')
 meta={**{k:v for k,v in plan.items() if k!='clips'},'chapters':chapters,
   'durationSeconds':round(recorded,2),'outputFile':str(output),
   'status':'rendered_private_draft','copyrightReviewNeeded':bool(plan.get('unverifiedSources')),
   'contentReviewNeeded':bool(plan.get('categoryReviewNeeded')),
   'createdAt':dt.datetime.now(dt.timezone.utc).isoformat()}
 output.with_suffix('.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
 return meta
def cleanup_after_confirmed_upload(meta,video_id,confirmation):
 """Delete local render only after YouTube has confirmed the exact video ID."""
 if not re.fullmatch(r'[A-Za-z0-9_-]{11}',str(video_id or '')):
  raise ValueError('invalid_uploaded_video_id')
 if not isinstance(confirmation,dict) or confirmation.get('platform')!='youtube' or confirmation.get('id')!=video_id:
  raise ValueError('unverified_youtube_upload')
 if confirmation.get('uploadStatus') not in ('uploaded','processed'):
  raise ValueError('youtube_upload_not_confirmed')
 file=Path(str(meta.get('outputFile') or '')).resolve()
 if file.suffix.lower()!='.mp4' or not file.is_file():
  raise ValueError('render_file_unavailable')
 extra=file.with_suffix('.json')
 file.unlink()
 removed_extra=False
 if extra.is_file():
  extra.unlink()
  removed_extra=True
 return {'deletedMp4':True,'deletedMetadata':removed_extra,'videoId':video_id}

def apply_result(state,meta):
 """Persist only after a completed render. Call with durable state storage."""
 state=json.loads(json.dumps(state))
 lang=meta['language'];bucket=state.setdefault('languages',{}).setdefault(lang,{})
 day=meta['day']
 if day in bucket.setdefault('createdDays',{}):raise ValueError('daily_digest_already_exists')
 if int(meta['episode'])!=int(bucket.get('lastEpisode',0))+1:raise ValueError('episode_sequence_conflict')
 bucket['lastEpisode']=int(meta['episode'])
 bucket['createdDays'][day]=meta['id']
 bucket['usedClipIds']=list(dict.fromkeys(bucket.get('usedClipIds',[])+meta['clipIds']))[-1500:]
 return state
def main():
 p=argparse.ArgumentParser(description='Create language-specific daily GTA VI best-of video drafts')
 p.add_argument('--manifest',help='JSON manifest of GTA VI candidates with source URLs or MP4s')
 p.add_argument('--feed-url',help='GTA VI Viral Engine public feed URL (no credentials)')
 p.add_argument('--state',required=True,help='Durable state JSON (persist outside ephemeral Render disk)')
 p.add_argument('--day',default=dt.datetime.now(dt.timezone.utc).date().isoformat())
 p.add_argument('--out',required=True)
 p.add_argument('--languages',default='es,en,ru,pt,de,fr,it,uk,pl')
 p.add_argument('--plan-only',action='store_true')
 args=p.parse_args()
 if bool(args.manifest)==bool(args.feed_url):p.error('Pass exactly one of --manifest or --feed-url')
 if args.feed_url:
  parsed=urlparse(args.feed_url)
  if parsed.scheme!='https' or parsed.hostname!='gta-vi-viral-engine.vercel.app' or parsed.path!='/api/feed':p.error('untrusted feed URL')
  with httpx.Client(timeout=30,follow_redirects=False) as client:
   result=client.get(args.feed_url);result.raise_for_status();data=result.json()
  cat=any(s.get('game')=='Grand Theft Auto VI' and s.get('platform')=='twitch' for s in data.get('sources',[]))
  clips=[{**x,'gameCategoryMatched':cat and x.get('platform')=='twitch'} for x in data.get('candidates',[])]
 else:
  data=json.loads(Path(args.manifest).read_text(encoding='utf-8'))
  clips=data if isinstance(data,list) else data.get('candidates',data.get('clips',[]))
 state=json.loads(Path(args.state).read_text(encoding='utf-8')) if Path(args.state).exists() else {}
 plans=plan_by_language(clips,state,args.day,args.languages.split(','))
 if args.plan_only:
  print(json.dumps([{'id':x['id'],'title':x['title'],'language':x['language'],'clips':x['clipIds']} for x in plans],ensure_ascii=False,indent=2))
  return
 for plan in plans:
  meta=render_plan(plan,args.out)
  state=apply_result(state,meta)
  tmp=Path(args.state).with_suffix('.tmp')
  tmp.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
  os.replace(tmp,args.state)
  print(json.dumps({'id':meta['id'],'title':meta['title'],'file':meta['outputFile'],'status':meta['status']},ensure_ascii=False))
if __name__=='__main__':main()
