"""Independent GTA VI daily compilation HTTP worker.

This process does NOT run cloud.py or render Shorts. It uses the existing public
clip catalogue, and writes verified draft files for later YouTube upload.
A persistent disk mounted at COMPILATION_STORAGE_ROOT is recommended for
durable sequential episode numbers. HTTP /status is admin-authenticated.
"""
from __future__ import annotations
import datetime as dt
import json, logging, math, os, re, secrets, threading, time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
import httpx
from daily_compilations import (
  RIGHTS_OK, LANGUAGES, is_eligible, clip_seconds, rank, same_moment,
  apply_result, cleanup_after_confirmed_upload,
)
from daily_runner import REGIONAL_SLOTS
from fast_compilations import render_fast_plan, MIN_SECONDS, MAX_SECONDS, TARGET_SECONDS
from youtube_long_upload import YoutubeLongUploader

logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
log=logging.getLogger('gta-vi-compilations')
FEED=os.environ.get('GTA_VI_FEED_URL','https://gta-vi-viral-engine.vercel.app/api/feed')
SECRET=os.environ.get('COMPILATION_API_TOKEN','')
ROOT=Path(os.environ.get('COMPILATION_STORAGE_ROOT','/tmp/gtavi-compilations'))
ROOT.mkdir(parents=True,exist_ok=True)
STATE_PATH=ROOT/'episodes.json'
RUN_AUTOMATIC=os.environ.get('COMPILATION_SCHEDULER','true').lower() in ('true','1','yes')
AUTO_ON_BOOT=os.environ.get('BOOTSTRAP_COMPILATION_LANG','es').lower().strip()
SOFT_LIMIT=85 # downloading bad clips must not loop forever
MIN_CLIPS=3

class Engine:
 def __init__(self):
  self.lock=threading.Lock()
  self.uploader=YoutubeLongUploader()
  self.latest={'status':'idle','message':'Worker ready','updatedAt':self.now()}
  self.history=self.load()
  self.preview_paths={}
 def now(self):return dt.datetime.now(dt.timezone.utc).isoformat()
 def load(self):
  try:return json.loads(STATE_PATH.read_text(encoding='utf-8'))
  except (OSError,ValueError):return {}
 def save(self,history):
  tmp=STATE_PATH.with_suffix('.tmp')
  tmp.write_text(json.dumps(history,ensure_ascii=False,indent=2),encoding='utf-8')
  os.replace(tmp,STATE_PATH)
 def update(self,**changes):
  self.latest.update(changes,updatedAt=self.now())
 def feed(self):
  parsed=urlsplit(FEED)
  if parsed.scheme!='https' or parsed.hostname!='gta-vi-viral-engine.vercel.app' or parsed.path!='/api/feed':
   raise ValueError('feed_url_not_allowlisted')
  hdr={'Accept':'application/json'}
  admin=os.environ.get('VIRAL_ADMIN_KEY','')
  if admin:hdr['Authorization']='Bearer '+admin
  with httpx.Client(timeout=httpx.Timeout(35,connect=10),follow_redirects=False) as client:
   response=client.get(FEED,headers=hdr)
   response.raise_for_status()
   data=response.json()
  if not isinstance(data,dict) or not isinstance(data.get('candidates'),list):
   raise RuntimeError('invalid_candidate_feed')
  # Only clips sourced from streams actually tagged GTA VI qualify;
  # this alone is not proof of the visual content, so retain a review flag.
  matched=any(x.get('game')=='Grand Theft Auto VI' and x.get('platform')=='twitch'
              for x in data.get('sources',[]))
  if not matched:raise RuntimeError('GTA_VI_source_category_not_confirmed')
  return [{**x,'gameCategoryMatched':x.get('platform')=='twitch'}
          for x in data['candidates'] if x.get('platform')=='twitch']
 def choose(self,lang,day):
  end=dt.datetime.combine(day,dt.time.max,tzinfo=dt.timezone.utc)
  history=self.history.get('languages',{}).get(lang,{})
  if str(day) in history.get('createdDays',{}):
   raise RuntimeError('episode_already_prepared_for_today')
  used=set(history.get('usedClipIds',[]))
  candidates=[x for x in self.feed() if x.get('language','').split('-')[0].lower()==lang
             and is_eligible(x,day) and str(x['id']) not in used]
  # Verified viewer engagement / editorial quality first. Source quality is
  # enforced by ffprobe during remux, not invented from catalogue metadata.
  def score(x):
   return rank(x)+min(12.0,math.log1p(max(0,float(x.get('views') or 0))))
  candidates.sort(key=lambda x:(score(x),x.get('createdAt') or ''),reverse=True)
  selected=[];creators=Counter();total=0.0
  for creator_limit in range(1,SOFT_LIMIT+1):
   for item in candidates:
    if item in selected:continue
    creator=str(item.get('creator') or 'Streamer').casefold()
    if creators[creator]>=creator_limit:continue
    seconds=clip_seconds(item)
    if seconds<7 or seconds>90 or total+seconds>MAX_SECONDS:continue
    if any(same_moment(item,old) for old in selected):continue
    selected.append(item);creators[creator]+=1;total+=seconds
    if total>=TARGET_SECONDS or len(selected)>=SOFT_LIMIT:break
   if total>=TARGET_SECONDS or len(selected)>=SOFT_LIMIT:break
  if len(selected)<MIN_CLIPS or total<MIN_SECONDS:
   raise RuntimeError('insufficient_quality_clips_%s_%.0fs'%(lang,total))
  n=int(history.get('lastEpisode',0))+1
  templates={'es':'Mejores clips de GTA VI de la semana | #{n}',
   'en':'Best GTA VI Clips of the Week | #{n}',
   'ru':'Лучшие моменты GTA VI за неделю | #{n}',
   'pt':'Melhores clipes de GTA VI da semana | #{n}',
   'de':'Die besten GTA VI Clips der Woche | #{n}',
   'fr':'Meilleurs clips GTA VI de la semaine | #{n}',
   'it':'I migliori clip di GTA VI della settimana | #{n}',
   'uk':'Найкращі моменти GTA VI за тиждень | #{n}',
   'pl':'Najlepsze klipy GTA VI tygodnia | #{n}'}
  return {'id':'%s-%s'%(lang,day.isoformat()),'day':day.isoformat(),
    'language':lang,'episode':n,'title':templates[lang].format(n=n),
    'clips':selected,'clipIds':[str(x['id']) for x in selected],
    'plannedSeconds':round(total,1),'targetSeconds':TARGET_SECONDS,
    'categoryReviewNeeded':any(x.get('gameVerified') is not True for x in selected),
    'unverifiedSources':[{'id':str(x['id']),'url':x.get('url'),'rights':x.get('rights','unverified')}
      for x in selected if str(x.get('rights') or '').lower() not in RIGHTS_OK]}
 def run(self,lang):
  if lang not in LANGUAGES:raise ValueError('unsupported_language')
  if not self.lock.acquire(blocking=False):return {'status':'busy'}
  try:
   day=dt.datetime.now(ZoneInfo(REGIONAL_SLOTS[lang][0])).date()
   self.update(status='selecting',language=lang,day=str(day),progress=None,error=None)
   plan=self.choose(lang,day)
   self.update(status='rendering',title=plan['title'],episode=plan['episode'],
      selectedSources=len(plan['clips']),plannedSeconds=plan['plannedSeconds'],
      progress={'stage':'starting','processed':0,'totalSources':len(plan['clips']),'durationSeconds':0})
   log.info('Dedicated fast compilation START %s: %d sources, %.0fs target',
       plan['id'],len(plan['clips']),TARGET_SECONDS)
   def progress(data):
    self.update(progress=data,status='rendering')
   meta=render_fast_plan(plan,ROOT,progress)
   meta['suggestedPublishAtUtc']=self.publish_time(lang,day)
   self.history=apply_result(self.history,meta)
   self.save(self.history)
   self.update(status='ready_for_upload',language=lang,progress={'stage':'complete','selected':len(meta['clipIds']),
    'totalSources':len(plan['clips']),'durationSeconds':meta['durationSeconds'],'targetSeconds':TARGET_SECONDS},
    latest={'id':meta['id'],'title':meta['title'],'episode':meta['episode'],
    'durationSeconds':meta['durationSeconds'],'fileBytes':meta['fileBytes'],
    'numClips':len(meta['clipIds']),'skipped':len(meta.get('skippedClips',[])),
    'suggestedPublishAtUtc':meta['suggestedPublishAtUtc'],
    'rightsReviewNeeded':meta['copyrightReviewNeeded'],
    'contentReviewNeeded':meta['contentReviewNeeded']},error=None)
   log.info('Dedicated fast compilation READY %s %.1fs %d clips',plan['id'],meta['durationSeconds'],len(meta['clipIds']))
   if self.uploader.configured:
    try:
     result=self.uploader.upload(meta,publish_at=meta['suggestedPublishAtUtc'])
     cleanup_after_confirmed_upload(meta,result['videoId'],result['confirmation'])
     self.update(status='uploaded_scheduled',youtubeUrl=result['watchUrl'])
     log.info('Dedicated fast compilation YOUTUBE CONFIRMED %s',result['watchUrl'])
    except Exception as exc:
     self.update(status='upload_failed',error=str(exc)[:240])
     log.exception('Compilation upload failed; draft retained')
   else:
    self.update(upload='oauth_not_configured; local draft retained')
   return self.latest
  except Exception as exc:
   if 'episode_already_prepared_for_today' in str(exc):
    self.update(status='ready_for_upload',language=lang,error=None,message='Episode already prepared; checking pending YouTube uploads')
    log.info('Existing episode detected for %s; do not duplicate the render',lang)
    return self.latest
   self.update(status='failed',error=str(exc)[:260])
   log.exception('Dedicated compilation failed: %s',lang)
   return self.latest
  finally:self.lock.release()
 def publish_time(self,lang,day):
  zone,hour,minute=REGIONAL_SLOTS[lang]
  slot=dt.datetime.combine(day,dt.time(hour,minute),tzinfo=ZoneInfo(zone)).astimezone(dt.timezone.utc)
  now=dt.datetime.now(dt.timezone.utc)
  if slot<=now+dt.timedelta(minutes=45):
   slot=(dt.datetime.combine(day+dt.timedelta(days=1),dt.time(hour,minute),tzinfo=ZoneInfo(zone)).astimezone(dt.timezone.utc))
  return slot.isoformat()
 def start(self,lang):
  if self.lock.locked():return False
  threading.Thread(target=self.run,args=(lang,),daemon=True,name='comp-'+lang).start()
  return True
 def schedule_loop(self):
  while True:
   if RUN_AUTOMATIC and not self.lock.locked():
    utc=dt.datetime.now(dt.timezone.utc)
    for lang,(zone,_,_) in REGIONAL_SLOTS.items():
     here=utc.astimezone(ZoneInfo(zone))
     day=str(here.date())
     if here.hour==10 and here.minute==0:
      try:
       if day not in self.history.get('languages',{}).get(lang,{}).get('createdDays',{}):
        self.start(lang)
      except Exception:log.exception('scheduler error for %s',lang)
   time.sleep(60)

engine=Engine()

class HTTP(BaseHTTPRequestHandler):
 def reply(self,code,payload):
  raw=json.dumps(payload,ensure_ascii=False).encode('utf-8')
  self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8')
  self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)))
  self.end_headers();self.wfile.write(raw)
 def authenticated(self):
  supplied=self.headers.get('Authorization','')
  return bool(SECRET) and secrets.compare_digest(supplied,'Bearer '+SECRET)
 def do_GET(self):
  path=self.path.split('?',1)[0]
  if path=='/health':return self.reply(200,{'ok':True,'role':'compilations_only','status':engine.latest.get('status'),'active':engine.lock.locked()})
  if not self.authenticated():return self.reply(401,{'error':'unauthorized'})
  if path=='/status':return self.reply(200,engine.latest)
  if path=='/series':return self.reply(200,{'languages':engine.history.get('languages',{}),'durableDiskConfigured':str(ROOT).startswith('/var/data/')})
  return self.reply(404,{'error':'not_found'})
 def do_POST(self):
  if not self.authenticated():return self.reply(401,{'error':'unauthorized'})
  if self.path!='/run':return self.reply(404,{'error':'not_found'})
  length=int(self.headers.get('Content-Length','0') or 0)
  if length<0 or length>512:return self.reply(413,{'error':'body_too_large'})
  try: body=json.loads(self.rfile.read(length)) if length else {}
  except ValueError:return self.reply(400,{'error':'invalid_json'})
  language=str(body.get('language') or 'es').lower()
  if language not in LANGUAGES:return self.reply(400,{'error':'invalid_language'})
  if not engine.start(language):return self.reply(409,{'error':'busy'})
  return self.reply(202,{'status':'accepted','language':language})
 def log_message(self,fmt,*args):
  log.info('http '+fmt,*args)

if __name__=='__main__':
 threading.Thread(target=engine.schedule_loop,daemon=True,name='daily-schedule').start()
 if AUTO_ON_BOOT in LANGUAGES and os.environ.get('BOOTSTRAP_COMPILATION_ONCE','false').lower() in ('true','yes','1'):
  engine.start(AUTO_ON_BOOT)
 port=int(os.environ.get('PORT','10000'))
 log.info('Dedicated compilation service listening on %d, scheduler=%s',port,RUN_AUTOMATIC)
 ThreadingHTTPServer(('0.0.0.0',port),HTTP).serve_forever()
