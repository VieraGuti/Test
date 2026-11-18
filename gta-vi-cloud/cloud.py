from __future__ import annotations
import os,json,time,threading,tempfile,subprocess,shutil,math,logging,re
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse
import httpx
from PIL import Image,ImageDraw,ImageFont

API=os.environ.get('ENGINE_URL','https://gta-vi-viral-engine.vercel.app').rstrip('/')
ADMIN=os.environ.get('VIRAL_ADMIN_KEY','')
TOKEN=os.environ.get('WORKER_RUN_TOKEN','')
ENABLED=os.environ.get('WORKER_ENABLED','false').lower() in ('1','true','yes')
MAX_SECONDS=max(8,min(30,int(os.environ.get('MAX_CLIP_SECONDS','16'))))
AUTO_MONITOR=os.environ.get('AUTO_MONITOR','false').lower() in ('1','true','yes')
AUTO_PROCESS=os.environ.get('AUTO_PROCESS','false').lower() in ('1','true','yes')
POLL_SECONDS=max(30,int(os.environ.get('TWITCH_POLL_SECONDS','30')))
UPLOADS_DAY_LIMIT=max(1,min(95,int(os.environ.get('UPLOADS_DAY_LIMIT','90'))))
CHUNK=2800000
state={'status':'idle','last':None,'error':None,'pollCount':0,'pollAdded':0,'lastPoll':None,'pollError':None,'monitoring':False,'autoProcessing':False}
lock=threading.Lock()
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
log=logging.getLogger('gtavi-worker')
def api(method,path,**kw):
 if not ADMIN:raise RuntimeError('missing_backend_secret')
 headers={'Authorization':'Bearer '+ADMIN,**kw.pop('headers',{})}
 with httpx.Client(timeout=httpx.Timeout(180,connect=20),follow_redirects=False) as c:
  r=c.request(method,API+path,headers=headers,**kw)
  if r.status_code>=400:raise RuntimeError('backend_'+str(r.status_code)+': '+r.text[:180])
  return r.json()
def cmd(args,limit=240):
 p=subprocess.run(args,capture_output=True,text=True,timeout=limit)
 if p.returncode:raise RuntimeError(str(args[0])+' failed: '+(p.stderr or p.stdout)[-240:])
def download(c,target):
 u=c.get('url','')
 host=urlparse(u).hostname
 if not u.startswith('https://'):raise ValueError('bad_url')
 if host in ('twitch.tv','www.twitch.tv','clips.twitch.tv'):
  if '/clip/' not in u and host!='clips.twitch.tv':raise ValueError('not_a_clip')
  command=['TwitchDownloaderCLI','clipdownload','--id',u,'--output',str(target),'--collision','Overwrite']
 elif host in ('youtube.com','www.youtube.com','m.youtube.com','youtu.be'):
  command=['yt-dlp','--no-playlist','-f','bv*[height<=720]+ba/best','--merge-output-format','mp4','-o',str(target),u]
 else:raise ValueError('unsupported_host')
 cmd(command,limit=230)
 if not target.exists() or target.stat().st_size<1000:raise RuntimeError('download_missing_video')
def duration(src):
 p=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(src)],capture_output=True,text=True,timeout=15)
 if p.returncode:raise RuntimeError('ffprobe_failed')
 return float(p.stdout.strip())
def graphic(path,title,creator):
 im=Image.new('RGBA',(540,960),(0,0,0,0));d=ImageDraw.Draw(im)
 font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
 f=ImageFont.truetype(font,25);sm=ImageFont.truetype(font,22)
 def lines(txt):
  out=[];line=''
  for word in str(txt).split():
   nxt=(line+' '+word).strip()
   if d.textbbox((0,0),nxt,font=f)[2]>480 and line:out.append(line);line=word
   else:line=nxt
  if line:out.append(line)
  return out[:3]
 body=lines(title[:90])
 d.rounded_rectangle((12,16,528,45+len(body)*37),radius=12,fill=(8,10,18,210))
 for i,line in enumerate(body):d.text((25,25+i*37),line,font=f,fill='white')
 d.rounded_rectangle((12,873,528,947),radius=12,fill=(8,10,18,210))
 d.text((23,892),str(creator)[:35],font=sm,fill=(245,220,120))
 im.save(path)
def render(source,dest,title,creator):
 end=min(MAX_SECONDS,duration(source))
 if end<1:raise RuntimeError('invalid_source_duration')
 image=dest.with_suffix('.png');graphic(image,title,creator)
 f='[0:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2:color=black,fps=24[v];[v][1:v]overlay=0:0:shortest=1[out]'
 try:
  cmd(['ffmpeg','-nostdin','-v','error','-y','-i',str(source),'-loop','1','-i',str(image),'-filter_complex',f,'-map','[out]','-map','0:a?','-t',str(end),'-c:v','libx264','-preset','ultrafast','-crf','29','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart',str(dest)],limit=330)
 finally:image.unlink(missing_ok=True)
 if not dest.exists():raise RuntimeError('render_failed')
def merge(parts,output):
 if len(parts)==1:shutil.copy2(parts[0],output);return
 concat=output.with_suffix('.txt')
 concat.write_text(''.join("file '"+str(x.resolve())+"'\n" for x in parts),encoding='utf-8')
 try:cmd(['ffmpeg','-nostdin','-v','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','-movflags','+faststart',str(output)],limit=220)
 finally:concat.unlink(missing_ok=True)
def report_twitch_chat(clip,tmp):
 if os.environ.get('ENABLE_CHAT_SPIKES','false').lower() not in ('1','yes','true'):return
 url=str(clip.get('url') or '')
 if 'twitch.tv' not in url:return
 path=tmp/'chat.json'
 try:
  cmd(['TwitchDownloaderCLI','chatdownload','--id',url,'--output',str(path),'--collision','Overwrite'],limit=75)
  raw=json.loads(path.read_text(encoding='utf-8-sig'))
  events=[]
  for row in raw.get('comments',[])[:10000]:
   t=row.get('content_offset_seconds')
   body=(row.get('message') or {}).get('body','')
   if isinstance(t,(int,float)) and t>=0:events.append({'t':t,'body':str(body)[:250]})
  if events:
   slug=str(clip.get('id') or '').replace('twitch-','')
   api('POST','/api/chat-spikes',json={'platform':'twitch','streamId':slug,'events':events})
   log.info('Chat signal analyzed from %d messages',len(events))
 except Exception as exc:log.warning('Chat unavailable: %s',str(exc)[:90])
 finally:path.unlink(missing_ok=True)

def upload(job,video):
 size=video.stat().st_size
 if size>120000000:raise RuntimeError('trial_file_too_big')
 n=math.ceil(size/CHUNK)
 with video.open('rb') as f:
  for index in range(n):
   api('POST','/api/worker-chunk',headers={'Content-Type':'application/octet-stream','X-Job-Id':job['jobId'],'X-Part':str(index)},content=f.read(CHUNK))
 api('POST','/api/worker-finalize',json={'jobId':job['jobId'],'partCount':n,'kind':job['kind'],'id':job['id'],'title':job.get('title','Highlight | GTA VI'),'moderation':{'mode':'not_scanned_on_free_host','visual_scan_completed':False,'adult_possible':True}})
 result=None
 for retry in range(6):
  try:
   result=api('POST','/api/youtube-upload',json={'id':job['id'],'kind':job['kind']})
   break
  except RuntimeError as e:
   if retry>=5 or not any(x in str(e) for x in ('rendered_mp4_not_ready','rendered_blob_missing','video_blob_not_readable')):
    raise
   time.sleep(min(10,2+retry*2))
 api('POST','/api/worker-queue',json={'jobId':job['jobId'],'status':'uploaded_private'})
 return result.get('watchUrl')
def run_one(kind_override=None):
 with lock:
  if state['status']=='working':return
  state.update(status='working',error=None)
 job=None
 try:
  if not ENABLED:raise RuntimeError('worker_disabled')
  recovered=api('GET','/api/worker-recover')
  if recovered.get('ready'):
   log.info('Retrying already-rendered MP4 job %s',recovered['jobId'])
   result=api('POST','/api/worker-recover',json={'jobId':recovered['jobId']})
   state.update(status='uploaded_private',last={'jobId':recovered['jobId'],'watchUrl':result.get('watchUrl'),'reusedRender':True})
   return
  kind=(kind_override or os.environ.get('JOB_KIND','')).strip().lower()
  kind=kind if kind in ('single','double') else ''
  item=api('GET','/api/worker-queue?claim=1'+('&kind='+kind if kind else ''));job=item.get('job')
  if not job:state.update(status='queue_empty');return
  log.info('Claimed job %s (%s)',job['jobId'],job.get('kind'))
  if os.environ.get('ENABLE_AI_TITLE','true').lower() in ('true','1','yes'):
   try:
    ai=api('POST','/api/ai-title',json={'id':job['id'],'kind':job.get('kind')})
    if ai.get('title') and len(ai['title'])<=100:
     job['title']=ai['title']
     log.info('Title improved using %s',ai.get('provider','AI'))
   except Exception as e:
    log.warning('AI title unavailable; keeping factual original title: %s',str(e)[:110])
  with tempfile.TemporaryDirectory(prefix='gtavi-') as tmp:
   base=Path(tmp);segments=[]
   clips=job.get('clips') or []
   if len(clips) not in (1,2):raise ValueError('invalid_clip_count')
   for i,clip in enumerate(clips):
    raw=base/f'input{i}.mp4';out=base/f'clip{i}.mp4'
    log.info('Downloading source %d/%d',i+1,len(clips))
    download(clip,raw)
    report_twitch_chat(clip,base)
    log.info('Download complete; starting FFmpeg source %d/%d',i+1,len(clips))
    render(raw,out,job.get('title','GTA VI'),job.get('creator','Streamer'))
    log.info('Rendered source %d/%d size=%d',i+1,len(clips),out.stat().st_size)
    raw.unlink(missing_ok=True);segments.append(out)
   result=base/'final.mp4';merge(segments,result)
   url=upload(job,result)
   state.update(status='uploaded_private',last={'jobId':job['jobId'],'watchUrl':url})
   log.info('Private upload completed: %s',job['jobId'])
 except Exception as e:
  state.update(status='failed',error=str(e)[:250])
  log.exception('Processing failed')
  if job:
   try:api('POST','/api/worker-queue',json={'jobId':job['jobId'],'status':'failed','error':str(e)[:140]})
   except Exception:pass
def release_once():
 try:
  state.update(status='reviewing_private_short')
  result=api('POST','/api/shorts-release',json={})
  state.update(status=str(result.get('action','review_done')),last={'review':result.get('action'),'videoId':result.get('videoId'),'reason':result.get('reason')})
  log.info('Shorts review result: %s video=%s reason=%s',result.get('action'),result.get('videoId'),result.get('reason'))
 except Exception as exc:
  state.update(status='review_failed',error=str(exc)[:180])
  log.exception('Shorts review failed')

def monitor_loop():
 state['monitoring']=True
 log.info('Twitch 30s discovery enabled')
 youtube_due=0
 while ENABLED and AUTO_MONITOR:
  started=time.monotonic()
  try:
   result=api('POST','/api/twitch-poll',json={})
   state['lastPoll']=result.get('at')
   state['pollAdded']=int(result.get('added') or 0)
   state['pollCount']=int(state.get('pollCount') or 0)+1
   state['pollError']=None
   if result.get('added'):
    log.info('Twitch discovery: +%s clips, watched %s',result.get('added'),str(result.get('watching'))[:80])
  except Exception as exc:
   state['pollError']=str(exc)[:180]
   log.warning('Twitch 30s discovery failed: %s',state['pollError'])
  if time.time() >= youtube_due:
   try:
    # Uses its existing 2-hour cache. Do not issue a fresh YouTube search every 30 seconds.
    ai=api('GET','/api/youtube-discover')
    log.info('YouTube discovery: %s clips in cached batch',ai.get('count'))
   except Exception as exc:log.warning('YouTube discovery unavailable: %s',str(exc)[:100])
   youtube_due=time.time()+7200
  time.sleep(max(1,POLL_SECONDS-(time.monotonic()-started)))
 state['monitoring']=False

def process_loop():
 state['autoProcessing']=True
 log.info('Automatic private uploads enabled, one video at a time')
 last_day=''
 started_today=0
 runs=0
 while ENABLED and AUTO_PROCESS:
  day=time.strftime('%Y-%m-%d',time.gmtime())
  if day!=last_day:
   last_day=day
   started_today=0
  if state.get('status')=='working':
   time.sleep(25)
   continue
  if started_today>=UPLOADS_DAY_LIMIT:
   state['processPause']='daily_private_upload_limit'
   time.sleep(300)
   continue
  try:
   choice='double' if runs>0 and runs%5==0 else 'single'
   state['processPause']=None
   run_one(choice)
   if state.get('status')=='uploaded_private':
    started_today+=1
    runs+=1
    state['uploadedToday']=started_today
   elif state.get('status')=='failed':
    err=str(state.get('error') or '').lower()
    if 'quota' in err or 'uploadlimit' in err:
     state['processPause']='youtube_quota_or_rate_limit'
     log.warning('YouTube quota reached; pausing automatic uploads')
     time.sleep(3600)
   elif state.get('status')=='queue_empty':
    time.sleep(45)
    continue
  except Exception as exc:
   log.exception('Auto-processing loop error: %s',str(exc)[:120])
  time.sleep(20)
 state['autoProcessing']=False

class Server(BaseHTTPRequestHandler):
 def respond(self,code,obj):
  body=json.dumps(obj).encode()
  self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def authorized(self):return bool(TOKEN) and self.headers.get('Authorization')=='Bearer '+TOKEN
 def do_GET(self):
  if self.path=='/health':return self.respond(200,{'ok':True,'enabled':ENABLED,'status':state['status'],'monitoring':state.get('monitoring'),'autoProcessing':state.get('autoProcessing'),'lastPoll':state.get('lastPoll'),'pollAdded':state.get('pollAdded'),'pollError':state.get('pollError'),'uploadedToday':state.get('uploadedToday',0),'processPause':state.get('processPause')})
  if self.path=='/status' and self.authorized():return self.respond(200,state)
  return self.respond(401,{'error':'unauthorized'})
 def do_POST(self):
  if self.path!='/run':return self.respond(404,{'error':'not_found'})
  if not self.authorized():return self.respond(401,{'error':'unauthorized'})
  if not ENABLED:return self.respond(409,{'error':'disabled'})
  if state['status']=='working':return self.respond(409,{'error':'busy'})
  size=int(self.headers.get('Content-Length','0') or 0)
  if size>1024:return self.respond(413,{'error':'body_too_large'})
  try:body=json.loads(self.rfile.read(size)) if size else {}
  except (ValueError,TypeError):return self.respond(400,{'error':'invalid_json'})
  kind=str(body.get('kind') or '').lower()
  if kind not in ('','single','double'):return self.respond(400,{'error':'invalid_kind'})
  threading.Thread(target=run_one,args=(kind,),daemon=True).start()
  return self.respond(202,{'accepted':True,'kind':kind or 'automatic'})
if __name__=='__main__':
 if ENABLED and AUTO_MONITOR:threading.Thread(target=monitor_loop,daemon=True,name='twitch-30s-monitor').start()
 if ENABLED and AUTO_PROCESS:threading.Thread(target=process_loop,daemon=True,name='shorts-auto-processing').start()
 if ENABLED and os.environ.get('AUTOSTART_ONCE')=='true':threading.Thread(target=run_one,daemon=True).start()
 if ENABLED and os.environ.get('AUTOSTART_RELEASE_ONCE')=='true':threading.Thread(target=release_once,daemon=True).start()
 port=int(os.environ.get('PORT','10000'))
 log.info('Cloud worker listening port=%d enabled=%s',port,ENABLED)
 ThreadingHTTPServer(('0.0.0.0',port),Server).serve_forever()
