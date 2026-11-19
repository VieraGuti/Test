"""Best-of video batch planner, renderer, and region-aware trial scheduler.

Drafts are rendered from Twitch sources by daily_compilations.py. This service
does not publish videos. Rendering uses ephemeral storage unless the deployment
has a persistent volume; caller must archive approved drafts elsewhere.
"""
from __future__ import annotations
import datetime as dt
import json, os, secrets, threading, time
from pathlib import Path
from zoneinfo import ZoneInfo
from daily_compilations import LANGUAGES, plan_by_language, render_plan, apply_result

# Initial hypotheses: evening prime time in major regions for each language.
# Per-language audience hour data is not yet present. These are NOT measured peaks.
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
  if not self.job_lock.acquire(blocking=False):return {'status':'busy'}
  try:
   day=day or dt.datetime.now(ZoneInfo(REGIONAL_SLOTS[lang][0])).date()
   self.status={'status':'selecting','language':lang,'day':str(day),'last':self.status.get('last'),'error':None}
   plans=self.plans(day,[lang])
   if not plans:
    self.status.update(status='not_enough_new_clips',note='Need at least 3 eligible unused clips')
    return self.status
   plan=plans[0]
   self.status.update(status='rendering',title=plan['title'],clips=len(plan['clipIds']))
   meta=render_plan(plan,self.root)
   zone,hour,minute=REGIONAL_SLOTS[lang]
   slot=dt.datetime.combine(day,dt.time(hour,minute),tzinfo=ZoneInfo(zone))
   meta['suggestedPublishAtUtc']=slot.astimezone(dt.timezone.utc).isoformat()
   meta['suggestedPublishZone']=zone
   state=apply_result(self.state(),meta)
   self.save_state(state)
   token=secrets.token_urlsafe(24)
   self.files[token]=Path(meta['outputFile'])
   meta['previewUrl']=self.base_url+'/daily/video/'+token if self.base_url else None
   self.status={'status':'ready_for_review','language':lang,'last':meta,
       'error':None,'scheduling':'trial_only'}
   return self.status
  except Exception as e:
   self.status.update(status='failed',error=str(e)[:270])
   return self.status
  finally:
   self.job_lock.release()
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
    if here.hour==10 and 0<=here.minute<5 and local_day not in last and not self.job_lock.locked():
     self.run_once(lang,here.date())
   time.sleep(60)
 def bootstrap(self,languages):
  for lang in languages:
   if lang in LANGUAGES:self.run_once(lang)
