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
CHUNK=2800000
state={'status':'idle','last':None,'error':None}
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
def run_one():
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
  item=api('GET','/api/worker-queue?claim=1');job=item.get('job')
  if not job:state.update(status='queue_empty');return
  log.info('Claimed job %s (%s)',job['jobId'],job.get('kind'))
  with tempfile.TemporaryDirectory(prefix='gtavi-') as tmp:
   base=Path(tmp);segments=[]
   clips=job.get('clips') or []
   if len(clips) not in (1,2):raise ValueError('invalid_clip_count')
   for i,clip in enumerate(clips):
    raw=base/f'input{i}.mp4';out=base/f'clip{i}.mp4'
    log.info('Downloading source %d/%d',i+1,len(clips))
    download(clip,raw)
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
class Server(BaseHTTPRequestHandler):
 def respond(self,code,obj):
  body=json.dumps(obj).encode()
  self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def authorized(self):return bool(TOKEN) and self.headers.get('Authorization')=='Bearer '+TOKEN
 def do_GET(self):
  if self.path=='/health':return self.respond(200,{'ok':True,'enabled':ENABLED,'status':state['status']})
  if self.path=='/status' and self.authorized():return self.respond(200,state)
  return self.respond(401,{'error':'unauthorized'})
 def do_POST(self):
  if self.path!='/run':return self.respond(404,{'error':'not_found'})
  if not self.authorized():return self.respond(401,{'error':'unauthorized'})
  if not ENABLED:return self.respond(409,{'error':'disabled'})
  if state['status']=='working':return self.respond(409,{'error':'busy'})
  threading.Thread(target=run_one,daemon=True).start()
  return self.respond(202,{'accepted':True})
if __name__=='__main__':
 if ENABLED and os.environ.get('AUTOSTART_ONCE')=='true':threading.Thread(target=run_one,daemon=True).start()
 port=int(os.environ.get('PORT','10000'))
 log.info('Cloud worker listening port=%d enabled=%s',port,ENABLED)
 ThreadingHTTPServer(('0.0.0.0',port),Server).serve_forever()
