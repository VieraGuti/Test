from __future__ import annotations
import os,json,time,threading,tempfile,subprocess,shutil,math,logging,re,base64
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse
import httpx
from PIL import Image,ImageDraw,ImageFont,ImageFilter,ImageEnhance

API=os.environ.get('ENGINE_URL','https://gta-vi-viral-engine.vercel.app').rstrip('/')
ADMIN=os.environ.get('VIRAL_ADMIN_KEY','')
TOKEN=os.environ.get('WORKER_RUN_TOKEN','')
ENABLED=os.environ.get('WORKER_ENABLED','false').lower() in ('1','true','yes')
MAX_SECONDS=max(8,min(70,int(os.environ.get('MAX_CLIP_SECONDS','40'))))
SHORT_WIDTH=1080 if os.environ.get('SHORT_WIDTH')=='1080' else 720
SHORT_HEIGHT=SHORT_WIDTH*16//9
SHORT_FPS=30
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
def transcribe_audio(source,output):
 if os.environ.get('ENABLE_REAL_CAPTIONS','true').lower() not in ('1','true','yes'):return None
 voice=output.with_suffix('.mp3')
 try:
  cmd(['ffmpeg','-nostdin','-v','error','-y','-i',str(source),'-vn','-ac','1','-ar','16000','-b:a','40k','-t',str(MAX_SECONDS),str(voice)],limit=35)
  if not voice.exists() or voice.stat().st_size<1100:return None
  result=api('POST','/api/ai-transcribe',headers={'Content-Type':'audio/mpeg'},content=voice.read_bytes())
  if result.get('ok') and str(result.get('text','')).strip():
   log.info('Transcript extracted, language=%s, segments=%d',result.get('language'),len(result.get('segments') or []))
   return result
 except Exception as exc:
  log.warning('Speech transcription unavailable: %s',str(exc)[:145])
 finally:
  voice.unlink(missing_ok=True)
 return None

def visual_story(source,job,transcript,workdir):
 if os.environ.get('ENABLE_VISUAL_STORY','true').lower() not in ('1','true','yes'):return None
 try:
  total=max(1.0,duration(source))
  seconds=[min(max(0.3,total*ratio),max(0.5,total-0.4)) for ratio in (0.15,0.48,0.83)]
  frames=[]
  for idx,sec in enumerate(seconds):
   image=workdir/f'frame_{idx}.jpg'
   cmd(['ffmpeg','-nostdin','-v','error','-y','-ss',str(round(sec,2)),'-i',str(source),'-vf','scale=320:-2','-frames:v','1','-q:v','6',str(image)],limit=22)
   if not image.exists() or image.stat().st_size<300:continue
   frames.append(base64.b64encode(image.read_bytes()).decode('ascii'))
   image.unlink(missing_ok=True)
  if len(frames)<2:return None
  r=api('POST','/api/ai-visual-story',json={'frames':frames,'creator':job.get('creator'),'sourceTitle':job.get('title'),'transcript':(transcript or {}).get('text','')[:2100]})
  if r.get('ok'):
   log.info('Visual review: frames=%d confidence=%s adultPossible=%s',r.get('framesReviewed',0),r.get('confidence'),r.get('adultPossible'))
   return r
 except Exception as exc:
  log.warning('Visual editorial unavailable: %s',str(exc)[:170])
 return None

def truthful_hook(transcript,fallback):
 if not transcript:return str(fallback or 'GTA VI')[:75]
 segments=transcript.get('segments') or []
 ranked=[]
 for s in segments:
  words=str(s.get('text','')).strip().split()
  if len(words)<3:continue
  t=str(s.get('text','')).strip()
  score=(2 if ('!' in t or '?' in t or '¡' in t or '¿' in t) else 0)+(1 if 5<=len(words)<=15 else 0)
  ranked.append((score,t))
 if ranked:
  return sorted(ranked,key=lambda x:x[0],reverse=True)[0][1][:75]
 return str(transcript.get('text') or fallback).strip()[:75]

def ass_time(seconds):
 n=max(0,int(round(float(seconds)*100)))
 return f'{n//360000}:{(n//6000)%60:02d}:{(n//100)%60:02d}.{n%100:02d}'
def ass_escape(text):
 return re.sub(r'[\r\n]+',' ',str(text or '')).replace('\\','').replace('{','(').replace('}',')').strip()
def create_ass(path,transcript,max_seconds,hook=None,context=None,creator=None):
 scale=SHORT_WIDTH/720.0
 size=lambda n:max(15,round(n*scale))
 header=f"""[Script Info]
ScriptType: v4.00+
PlayResX: {SHORT_WIDTH}
PlayResY: {SHORT_HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,{size(36)},&H00FFFFFF,&H00FFFFFF,&HBA000000,&H90000000,1,0,0,0,100,100,0,0,1,3,1,2,{size(48)},{size(48)},{size(146)},1
Style: Hook,DejaVu Sans,{size(39)},&H00FFFFFF,&H00FFFFFF,&HC0000000,&H8A000000,1,0,0,0,100,100,0,0,1,3,1,8,{size(45)},{size(45)},{size(154)},1
Style: Context,DejaVu Sans,{size(31)},&H00FFFFFF,&H00FFFFFF,&HBC000000,&H8D000000,1,0,0,0,100,100,0,0,1,3,1,8,{size(50)},{size(50)},{size(154)},1
Style: Creator,DejaVu Sans,{size(23)},&H0088E9FF,&H0088E9FF,&HB0000000,&H82000000,1,0,0,0,100,100,0,0,1,2,{size(42)},{size(42)},{size(45)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
 lines=[]
 def add(style,begin,finish,value):
  value=ass_escape(value)
  if value and finish>begin:
   lines.append(f'Dialogue: 0,{ass_time(begin)},{ass_time(finish)},{style},,0,0,0,,{value}')
 add('Hook',0,min(1.5,max_seconds),hook)
 add('Context',min(1.85,max_seconds),min(4.65,max_seconds),context)
 add('Creator',0,max_seconds,creator)
 segments=transcript.get('segments') if isinstance(transcript,dict) else None
 for seg in (segments or [])[:48]:
  try:
   start=max(0,float(seg.get('start',0)));finish=min(max_seconds,float(seg.get('end',start+1)))
  except (ValueError,TypeError):continue
  add('Caption',start,finish,str(seg.get('text') or '')[:95])
 if not lines:return None
 path.write_text(header+'\n'.join(lines)+'\n',encoding='utf-8')
 return path

def render(source,dest,title,creator,transcript=None,context=None):
 end=min(MAX_SECONDS,duration(source))
 if end<1:raise RuntimeError('invalid_source_duration')
 frame=dest.with_name(dest.stem+'_background.jpg')
 ass=dest.with_suffix('.ass')
 hook=truthful_hook(transcript,title)
 try:
  # Generate the blurred background once. The old per-frame blur exhausted the Render timeout.
  cmd(['ffmpeg','-nostdin','-v','error','-y','-ss','0.35','-i',str(source),
   '-vf',f'scale={SHORT_WIDTH}:{SHORT_HEIGHT}:force_original_aspect_ratio=increase,crop={SHORT_WIDTH}:{SHORT_HEIGHT}',
   '-frames:v','1',str(frame)],limit=35)
  bg=Image.open(frame).convert('RGB')
  bg=ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(round(22*SHORT_WIDTH/720)))).enhance(0.53)
  bg.save(frame,quality=85,optimize=True)
  overlay=create_ass(ass,transcript,end,hook,context,creator)
  fgheight=(round(SHORT_HEIGHT*0.75)//2)*2
  graph=(f'[0:v]fps={SHORT_FPS},scale={SHORT_WIDTH}:{fgheight}:force_original_aspect_ratio=decrease:flags=bicubic,'
         'setsar=1,format=yuv420p[fg];'
         '[1:v]format=yuv420p[bg];'
         '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[composed]')
  graph+=(f';[composed]subtitles={overlay}[out]' if overlay else ';[composed]null[out]')
  cmd(['ffmpeg','-nostdin','-v','error','-y','-i',str(source),
   '-loop','1','-framerate',str(SHORT_FPS),'-i',str(frame),
   '-filter_complex',graph,'-map','[out]','-map','0:a?','-t',str(end),
   '-c:v','libx264','-preset','veryfast','-crf','20',
   '-maxrate',('8M' if SHORT_WIDTH==1080 else '5M'),
   '-bufsize',('16M' if SHORT_WIDTH==1080 else '10M'),
   '-threads','2','-r',str(SHORT_FPS),'-pix_fmt','yuv420p',
   '-c:a','aac','-b:a','160k','-ar','48000',
   '-movflags','+faststart',str(dest)],limit=780)
 finally:
  frame.unlink(missing_ok=True)
  ass.unlink(missing_ok=True)
 if not dest.exists() or dest.stat().st_size<35000:raise RuntimeError('render_failed')
 log.info('Video quality: %dx%d / %dfps / H264 CRF20 / AAC160k / %.1fs',SHORT_WIDTH,SHORT_HEIGHT,SHORT_FPS,end)

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
 api('POST','/api/worker-finalize',json={'jobId':job['jobId'],'partCount':n,'kind':job['kind'],'id':job['id'],'title':job.get('title','Highlight | GTA VI'),'creator':job.get('creator'),'platform':job.get('platform'),'language':job.get('language'),'clips':job.get('clips'),'views':job.get('views',0),'ageHint':job.get('ageHint',False),'moderation':{'mode':'sampled_frames_only' if job.get('visualReview') else 'not_scanned','sampled_frames_reviewed':int((job.get('visualReview') or {}).get('framesReviewed') or 0),'visual_scan_completed':False,'adult_possible':bool(job.get('ageHint') or (job.get('visualReview') or {}).get('adultPossible')) if (job.get('visualReview') or job.get('ageHint')) else None}})
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
  # Generate titles after analyzing the actual footage and speech.
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
    transcript=transcribe_audio(raw,out)
    editorial=None
    if transcript and str(transcript.get('text') or '').strip():
     try:
      story=api('POST','/api/ai-editorial-text',json={'creator':job.get('creator'),'sourceTitle':job.get('title'),'transcript':transcript.get('text')})
      if story.get('ok'):
       editorial=story
       log.info('Factual text story generated by %s',story.get('model'))
     except Exception as exc:
      log.warning('Text editorial unavailable: %s',str(exc)[:130])
    visual=visual_story(raw,job,transcript,base)
    job['visualReview']=visual
    if visual and visual.get('confidence') in ('medium','high'):
     editorial=visual
    # Gemini visual review takes priority; Groq speech editorial is fallback.
    verified=visual if (visual or {}).get('confidence') in ('medium','high') and (visual or {}).get('title') else editorial
    if verified and verified.get('confidence') in ('medium','high') and verified.get('title'):
     choice=re.sub(r'\s+',' ',str(verified['title'])).strip()
     choice=re.sub(r'(?i)\s*\|\s*GTA\s*(VI|6)\s*$','',choice).strip(' |:-')
     evidence=str((transcript or {}).get('text') or '')+' '+str((visual or {}).get('context') or '')
     if not re.search(r'(?i)\b(GTA\s*(VI|6)|Grand Theft Auto VI)\b',evidence):
      choice=re.sub(r'(?i)\b(GTA\s*(VI|6)|Grand Theft Auto VI)\b','',choice).strip(' |:-')
     if len(choice)<12:raise RuntimeError('title_context_unverified')
     creator=str(job.get('creator') or 'Streamer')[:24]
     if creator.casefold() not in choice.casefold():choice=creator+': '+choice
     job['title']=choice[:95].rstrip(' |:-')
    elif transcript and len(str(transcript.get('text') or '').split())>=4:
     quote=truthful_hook(transcript,'')
     job['title']=(str(job.get('creator') or 'Streamer')[:24]+': «'+quote[:58]+'»')[:95]
    else:
     raise RuntimeError('title_context_unverified: no transcript or visual story')
    if re.search(r'(?i)(momento\s+[ée]pico|esto\s+es\s+viral|you\s+won.t\s+believe)',job['title']):
     raise RuntimeError('title_is_generic: hold for review')
    log.info('Verified title from transcript/visual analysis: %s',job['title'])
    if editorial and editorial.get('adultPossible'):job['ageHint']=True
    if visual and visual.get('adultPossible'):job['ageHint']=True
    note=(editorial.get('context') or '') if editorial and editorial.get('confidence') in ('medium','high') else None
    render(raw,out,job.get('title','GTA VI'),job.get('creator','Streamer'),transcript,note)
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
   budget=api('GET','/api/upload-budget')
   if int(budget.get('remaining',0))<=0:
    state['processPause']='youtube_daily_upload_quota_guard'
    log.info('YouTube upload budget paused (%s uploads today)',budget.get('uploadedToday'))
    time.sleep(300)
    continue
  except Exception as exc:
   log.warning('Upload budget endpoint unavailable, local limit remains active: %s',str(exc)[:120])
  try:
   # Choose the highest-ranked eligible single or double; never stall if no double exists.
   state['processPause']=None
   run_one('auto')
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
