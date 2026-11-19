"""Best-of video batch planner, renderer, and region-aware trial scheduler.

Drafts are rendered from Twitch sources by daily_compilations.py. This service
does not publish videos. Rendering uses ephemeral storage unless the deployment
has a persistent volume; caller must archive approved drafts elsewhere.
"""
from __future__ import annotations
import datetime as dt
import json, os, secrets, threading, time, logging
from pathlib import Path
from zoneinfo import ZoneInfo
from daily_compilations import LANGUAGES, plan_by_language, render_plan, apply_result, cleanup_after_confirmed_upload
from fast_compilations import render_fast_plan
from youtube_long_upload import YoutubeLongUploader

# Initial hypotheses: evening prime time in major regions for each language.
# Per-language audience hour data is not yet present. These are NOT measured peaks.
log=logging.getLogger('gtavi-daily')
REGIONAL_SLOTS={
 'es':('Europe/Madrid',19,30),
 'en':('America/New_York',19,30),
 'ru':('Europe/Moscow',20,0),
 'pt':('America/Sao_Paulo',20,0),
 'de':('Europe/Berlin',19,30),
 'fr':('Europe/Paris',19,30),
 'it':('Europe/Rome',19,30),
 'uk':('Europe/Kyiv',20,0),
 'pl':('Europe/Warsaw',19,30),
}
class DailyManager:
 def __init__(self,fetch_feed,root='/tmp/gtavi-daily',base_url=''):
  self.fetch_feed=fetch_feed
  self.root=Path(root)
  self.base_url=base_url.rstrip('/')
  self.root.mkdir(parents=True,exist_ok=True)
  self.state_path=self.root/'series_state.json'
  self.job_lock=threading.Lock()
  self.status={'status':'idle','last':None,'error':None,'scheduling':'trial_only'}
  self.files={}
  self.uploader=YoutubeLongUploader()
  self.can_render=lambda:True
  self.enabled=os.environ.get('AUTO_DAILY_COMPILATIONS','false').lower() in ('true','yes','1')
  self.last_schedule_check=None
 def state(self):
  try:return json.loads(self.state_path.read_text(encoding='utf-8'))
  except (OSError,ValueError):return {}
 def save_state(self,state):
  path=self.state_path.with_suffix('.tmp')
  path.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
  os.replace(path,self.state_path)
 def candidates(self):
  data=self.fetch_feed()
  if not isinstance(data,dict):raise RuntimeError('candidate_feed_unavailable')
  game=any(x.get('game')=='Grand Theft Auto VI' and x.get('platform')=='twitch' for x in data.get('sources',[]))
  if not game:raise RuntimeError('GTA_VI_Twitch_category_not_confirmed')
  return [{**c,'gameCategoryMatched':bool(c.get('platform')=='twitch')} for c in data.get('candidates',[])]
 def plans(self,day=None,languages=None):
  day=day or dt.datetime.now(dt.timezone.utc).date()
  return plan_by_language(self.candidates(),self.state(),day,languages)
 def plan_summary(self,day=None,languages=None):
  return [{k:v for k,v in x.items() if k not in ('clips','unverifiedSources')} | {
   'numClips':len(x['clips']),'unverifiedSourcesCount':len(x.get('unverifiedSources',[]))}
   for x in self.plans(day,languages)]
 def run_once(self,lang,day=None):
  if lang not in LANGUAGES:raise ValueError('invalid_language')
  pending=self.status.get('last') or {}
  if self.status.get('status') in ('ready_for_upload','upload_failed') and pending.get('outputFile') and Path(pending['outputFile']).is_file():
   return {'status':'pending_upload_not_deleted','last':pending,'reason':'Upload or verification must succeed before generating a replacement'}
  if not self.job_lock.acquire(blocking=False):return {'status':'busy'}
  try:
   self.status={'status':'waiting_for_short','language':lang,'error':None}
   for _ in range(120):
    if self.can_render():break
    time.sleep(10)
   else:raise RuntimeError('short_renderer_busy: retry later')
   day=day or dt.datetime.now(ZoneInfo(REGIONAL_SLOTS[lang][0])).date()
   self.status={'status':'selecting','language':lang,'day':str(day),'last':self.status.get('last'),'error':None}
   plans=self.plans(day,[lang])
   if not plans:
    log.info('Daily compilation skipped: lang=%s insufficient eligible clips',lang)
    self.status.update(status='not_enough_new_clips',note='Need at least 3 eligible unused clips')
    return self.status
   plan=plans[0]
   self.status.update(status='rendering',title=plan['title'],clips=len(plan['clipIds']))
   log.info('Daily compilation start: lang=%s day=%s clips=%d title=%s',lang,day,len(plan['clipIds']),plan['title'])
   # Opt-in, isolated low-CPU path. Keep legacy until an existing job finishes.
   use_fast=os.environ.get('COMPILATION_FAST_MODE','false').lower() in ('true','1','yes')
   log.info('Daily compilation render path=%s', 'stream_copy' if use_fast else 'legacy_transcode')
   if use_fast:
    def update_progress(info):
     self.status['progress']=info
    meta=render_fast_plan(plan,self.root,progress=update_progress)
   else:
    meta=render_plan(plan,self.root)
   zone,hour,minute=REGIONAL_SLOTS[lang]
   slot=dt.datetime.combine(day,dt.time(hour,minute),tzinfo=ZoneInfo(zone))
   meta['suggestedPublishAtUtc']=slot.astimezone(dt.timezone.utc).isoformat()
   meta['suggestedPublishZone']=zone
   token=secrets.token_urlsafe(24)
   self.files[token]=Path(meta['outputFile'])
   meta['previewUrl']=self.base_url+'/daily/video/'+token if self.base_url else None
   self.status={'status':'ready_for_upload','language':lang,'last':meta,'error':None,
       'uploadConfigured':self.uploader.configured}
   log.info('Daily compilation READY: lang=%s file=%s seconds=%s preview=%s',lang,meta['outputFile'],meta.get('durationSeconds'),meta.get('previewUrl'))
   if not self.uploader.configured:
    log.warning('Automatic upload disabled: OAuth refresh credentials not configured on Render; MP4 retained')
    return self.status
   return self.upload_and_cleanup(meta)
  except Exception as e:
   log.exception('Daily compilation FAILED: lang=%s',lang)
   status='upload_failed' if self.status.get('status') in ('ready_for_upload','uploading') else 'failed'
   self.status.update(status=status,error=str(e)[:270])
   return self.status
  finally:
   self.job_lock.release()
 def upload_and_cleanup(self,meta):
  if not self.uploader.configured:raise RuntimeError('youtube_oauth_not_configured')
  # Publish at the region's evening slot if still in the future; otherwise
  # schedule for the following day, never publish at an accidental past time.
  now=dt.datetime.now(dt.timezone.utc)
  slot=dt.datetime.fromisoformat(meta['suggestedPublishAtUtc'])
  if slot<=now+dt.timedelta(minutes=45):
   zone,hour,minute=REGIONAL_SLOTS[meta['language']]
   current=now.astimezone(ZoneInfo(zone))
   date=current.date()+dt.timedelta(days=1)
   slot=dt.datetime.combine(date,dt.time(hour,minute),tzinfo=ZoneInfo(zone)).astimezone(dt.timezone.utc)
  self.status.update(status='uploading',scheduledForUtc=slot.isoformat())
  uploaded=self.uploader.upload(meta,publish_at=slot.isoformat())
  # Save all series metadata before deleting any media.
  state=apply_result(self.state(),meta)
  state['languages'][meta['language']].setdefault('uploads',{})[meta['day']]={
    'videoId':uploaded['videoId'],'watchUrl':uploaded['watchUrl'],
    'scheduledForUtc':slot.isoformat()}
  self.save_state(state)
  cleanup_after_confirmed_upload(meta,uploaded['videoId'],uploaded['confirmation'])
  for key,value in list(self.files.items()):
   if str(value)==meta['outputFile']:self.files.pop(key,None)
  result={k:v for k,v in meta.items() if k not in ('outputFile','previewUrl','skipped','unverifiedSources','chapters')}
  result.update(status='uploaded_scheduled',videoId=uploaded['videoId'],watchUrl=uploaded['watchUrl'],
     scheduledForUtc=slot.isoformat(),temporaryFilesRemoved=True)
  self.status={'status':'uploaded_scheduled','language':meta['language'],'last':result,'error':None}
  log.info('Daily compilation YOUTUBE CONFIRMED, files cleaned: %s %s',meta['id'],uploaded['watchUrl'])
  return self.status
 def retry_pending_upload(self):
  pending=self.status.get('last') or {}
  if not pending.get('outputFile') or not Path(pending['outputFile']).is_file():raise RuntimeError('no_uploaded_ready_draft')
  if not self.job_lock.acquire(blocking=False):return {'status':'busy'}
  try:return self.upload_and_cleanup(pending)
  finally:self.job_lock.release()
 def begin(self,lang,day=None):
  if self.job_lock.locked():return False
  threading.Thread(target=self.run_once,args=(lang,day),daemon=True,name='compilation-'+lang).start()
  return True
 def scheduler(self):
  while self.enabled:
   now=dt.datetime.now(dt.timezone.utc)
   for lang,(zone,hour,minute) in REGIONAL_SLOTS.items():
    here=now.astimezone(ZoneInfo(zone))
    local_day=str(here.date())
    last=self.state().get('languages',{}).get(lang,{}).get('createdDays',{})
    # Render before prime time, leaving time for verification and scheduled upload.
    if self.uploader.configured and here.hour==10 and 0<=here.minute<5 and local_day not in last and not self.job_lock.locked():
     self.run_once(lang,here.date())
   time.sleep(60)
 def bootstrap(self,languages):
  for lang in languages:
   if lang in LANGUAGES:self.run_once(lang)
