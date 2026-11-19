#!/usr/bin/env python3
"""Upload a completed, verified long-form GTA VI compilation from Vercel Drive.

Does not receive a Google refresh token. A private server bridge exchanges the
existing project's OAuth authorization for a short-lived access token.
Use from an ephemeral Vercel Sandbox with the drive mounted read/write.

Environment: COMPILATION_UPLOAD_KEY (required), COMPILATION_BRIDGE_URL (optional)
Usage: python upload_compilation_from_drive.py /mnt/gtavi/es-2026-11-19.mp4
"""
from __future__ import annotations
import datetime as dt
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

BRIDGE=os.environ.get('COMPILATION_BRIDGE_URL','https://gta-vi-viral-engine.vercel.app/api/compilation-bridge')
KEY=os.environ.get('COMPILATION_UPLOAD_KEY','')
CHANNEL='UCCv7FqhV_k0asn-Ho8HiP5w'
CHUNK=8*1024*1024
GOOGLE_UPLOAD='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'
LANGUAGE_ZONES={'es':'Europe/Madrid','en':'America/New_York','ru':'Europe/Moscow',
                'pt':'America/Sao_Paulo','de':'Europe/Berlin','fr':'Europe/Paris',
                'it':'Europe/Rome','uk':'Europe/Kyiv','pl':'Europe/Warsaw'}
LANGUAGE_LABELS={'es':'Español','en':'English','ru':'Русский','pt':'Português',
                 'de':'Deutsch','fr':'Français','it':'Italiano','uk':'Українська','pl':'Polski'}

def log(stage,**fields):
    # Never print OAuth tokens, service keys or resumable upload URLs.
    info=' '.join(f'{k}={v}' for k,v in fields.items())
    print(f'COMPILATION_UPLOAD {stage} {info}',flush=True)

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def save_json(path,obj):
    out=Path(path);tmp=out.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,out)

def call_bridge(action,**fields):
    if not KEY or len(KEY)<32:
        raise RuntimeError('COMPILATION_UPLOAD_KEY_not_configured')
    payload=json.dumps({'action':action,**fields}).encode()
    req=urllib.request.Request(BRIDGE,payload,method='POST',headers={
        'Content-Type':'application/json','X-Compilation-Key':KEY,
        'User-Agent':'GTA-VI-Compilations/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=45) as res:
            result=json.loads(res.read())
    except urllib.error.HTTPError as exc:
        msg=exc.read(450).decode(errors='replace')
        raise RuntimeError(f'bridge_{action}_HTTP_{exc.code}: {msg[:250]}') from None
    if not result.get('ok'):
        raise RuntimeError('bridge_'+action+'_rejected')
    return result

def youtube_request(url,method,headers=None,data=None,timeout=90):
    return urllib.request.urlopen(urllib.request.Request(
        url,data=data,method=method,headers=headers or {}),timeout=timeout)

def minutes(seconds):
    m,s=divmod(max(0,int(seconds)),60)
    h,m=divmod(m,60)
    return f'{h:02d}:{m:02d}:{s:02d}' if h else f'{m:02d}:{s:02d}'

def description(meta):
    lang=str(meta.get('language') or 'es')
    headings={'es':'Mejores momentos de GTA VI con el audio original de cada streamer.',
              'en':'Best GTA VI moments with original streamer audio.',
              'pt':'Melhores momentos de GTA VI com áudio original dos streamers.',
              'ru':'Лучшие моменты GTA VI с оригинальным звуком стримеров.'}
    body=[headings.get(lang,'GTA VI clips compilation with original streamer audio.'),
      '',f'Episodio #{meta.get("episode",1)} · {LANGUAGE_LABELS.get(lang,lang.upper())}',
      'Selección y montaje: The Random Reel','',
      'CAPÍTULOS / CREADORES']
    for ch in meta.get('chapters',[]):
        creator=str(ch.get('creator') or 'Streamer').replace('\n',' ')[:55]
        body.append(f'{minutes(ch.get("startSeconds") or 0)} {creator}')
    body.extend(['','Fuentes originales:'])
    for ch in meta.get('chapters',[]):
        creator=str(ch.get('creator') or 'Streamer').replace('\n',' ')[:55]
        url=str(ch.get('sourceUrl') or '')
        if url.startswith('https://'):
            body.append(f'{creator}: {url}')
    body.extend(['','#GTA6 #GTAVI #Gaming #Shorts'])
    return '\n'.join(body)[:4950]

def publication_time(language):
    zone=ZoneInfo(LANGUAGE_ZONES.get(language,'Europe/Madrid'))
    here=dt.datetime.now(zone)
    local=here.replace(hour=19,minute=30,second=0,microsecond=0)
    if (local-here).total_seconds()<3600:
        local+=dt.timedelta(days=1)
    return local.astimezone(dt.timezone.utc).isoformat().replace('+00:00','Z')

def youtube_session(file_path,meta,access_token):
    size=file_path.stat().st_size
    publish=publication_time(str(meta.get('language') or 'es'))
    body=json.dumps({
        'snippet':{'title':str(meta['title'])[:100],
                   'description':description(meta),
                   'categoryId':'20',
                   'defaultLanguage':str(meta.get('language') or 'es'),
                   'tags':['GTA VI','GTA 6','The Random Reel','streamers','recopilación']},
        'status':{'privacyStatus':'private','publishAt':publish,
                  'selfDeclaredMadeForKids':False}
    },ensure_ascii=False).encode('utf-8')
    req=urllib.request.Request(GOOGLE_UPLOAD,method='POST',data=body,headers={
        'Authorization':'Bearer '+access_token,
        'Content-Type':'application/json; charset=UTF-8',
        'Content-Length':str(len(body)),
        'X-Upload-Content-Type':'video/mp4',
        'X-Upload-Content-Length':str(size)})
    try:
        with urllib.request.urlopen(req,timeout=65) as response:
            location=response.headers.get('Location')
    except urllib.error.HTTPError as e:
        error=e.read(1200).decode(errors='replace')
        raise RuntimeError(f'youtube_start_HTTP_{e.code}: {error[:800]}') from None
    if not location or not location.startswith('https://'):
        raise RuntimeError('youtube_resumable_location_not_returned')
    host=urllib.parse.urlsplit(location).hostname or ''
    if not (host=='www.googleapis.com' or host=='upload.googleapis.com'):
        raise RuntimeError('untrusted_youtube_upload_hostname')
    log('UPLOAD_SESSION_CREATED',bytes=size,publishAt=publish)
    return location,publish

def query_session(upload_url,size,token):
    request=urllib.request.Request(upload_url,method='PUT',data=b'',headers={
        'Authorization':'Bearer '+token,'Content-Length':'0','Content-Range':f'bytes */{size}'})
    try:
        with urllib.request.urlopen(request,timeout=55) as res:
            body=res.read()
            if res.status in (200,201):
                return size,json.loads(body).get('id')
            raise RuntimeError('unexpected_resumable_status_'+str(res.status))
    except urllib.error.HTTPError as e:
        if e.code in (308,):
            r=e.headers.get('Range','')
            match=re.search(r'bytes=(\d+)-(\d+)',r)
            return (int(match.group(2))+1 if match else 0),None
        if e.code==404:
            return None,None
        if e.code==401:return 'refresh',None
        raise RuntimeError('youtube_resume_status_'+str(e.code)) from None

def upload(file_path,meta,checkpoint):
    size=file_path.stat().st_size
    current=call_bridge('token')
    if current.get('channelId')!=CHANNEL:
        raise RuntimeError('unauthorized_youtube_channel')
    token=current['accessToken']
    if checkpoint.exists():
        cp=read_json(checkpoint)
        if cp.get('fileBytes')!=size or cp.get('compilationId')!=meta['id']:
            raise RuntimeError('upload_checkpoint_mismatch')
        url=cp.get('uploadUrl','')
        if not url.startswith('https://'):raise RuntimeError('checkpoint_upload_url_invalid')
        offset,finished=query_session(url,size,token)
        if finished:return finished,cp.get('publishAt')
        if offset is None:
            log('OLD_UPLOAD_SESSION_EXPIRED')
            checkpoint.unlink(missing_ok=True)
            url,publish=youtube_session(file_path,meta,token)
            offset=0
        else:
            publish=cp.get('publishAt')
    else:
        url,publish=youtube_session(file_path,meta,token)
        offset=0
    save_json(checkpoint,{'compilationId':meta['id'],'fileBytes':size,
          'uploadUrl':url,'publishAt':publish,'createdAt':dt.datetime.now(dt.timezone.utc).isoformat()})
    attempts=0
    with file_path.open('rb') as f:
        while offset<size:
            f.seek(offset)
            part=f.read(min(CHUNK,size-offset))
            if not part:raise RuntimeError('unexpected_file_eof')
            end=offset+len(part)-1
            req=urllib.request.Request(url,data=part,method='PUT',headers={
                'Authorization':'Bearer '+token,'Content-Type':'video/mp4',
                'Content-Length':str(len(part)),
                'Content-Range':f'bytes {offset}-{end}/{size}'})
            try:
                with urllib.request.urlopen(req,timeout=150) as response:
                    if response.status in (200,201):
                        obj=json.loads(response.read())
                        video_id=str(obj.get('id') or '')
                        if not re.fullmatch(r'[A-Za-z0-9_-]{11}',video_id):
                            raise RuntimeError('youtube_video_id_missing')
                        return video_id,publish
                    raise RuntimeError('youtube_unexpected_upload_status_'+str(response.status))
            except urllib.error.HTTPError as e:
                if e.code==308:
                    r=e.headers.get('Range','')
                    match=re.search(r'bytes=(\d+)-(\d+)',r)
                    offset=int(match.group(2))+1 if match else offset+len(part)
                    attempts=0
                    log('CHUNK_UPLOADED',bytesSent=offset,totalBytes=size,percent=round(offset*100/size,1))
                    continue
                if e.code==401:
                    token=call_bridge('token')['accessToken']
                elif e.code in (429,500,502,503,504):
                    time.sleep(min(20,2**attempts))
                else:
                    err=e.read(1400).decode(errors='replace')
                    raise RuntimeError(f'youtube_chunk_HTTP_{e.code}: {err[:600]}') from None
                attempts+=1
                if attempts>5:raise RuntimeError('too_many_upload_retries')
                resumable,new_id=query_session(url,size,token)
                if new_id:return new_id,publish
                if resumable is None:raise RuntimeError('youtube_upload_session_expired')
                if resumable=='refresh':
                    token=call_bridge('token')['accessToken']
                    continue
                offset=resumable
            except (TimeoutError,ConnectionError,OSError) as e:
                attempts+=1
                if attempts>5:raise RuntimeError('youtube_upload_connection_failed') from e
                time.sleep(min(15,2**attempts))
                resumable,new_id=query_session(url,size,token)
                if new_id:return new_id,publish
                if resumable is None:raise RuntimeError('upload_session_lost')
                offset=resumable
    resumable,completed=query_session(url,size,token)
    if completed:return completed,publish
    raise RuntimeError('upload_finished_without_youtube_confirmation')

def main():
    if len(sys.argv)!=2:raise SystemExit('Usage: upload_compilation_from_drive.py /path/to/video.mp4')
    movie=Path(sys.argv[1]).resolve()
    if movie.suffix.lower()!='.mp4' or not movie.is_file():raise RuntimeError('confirmed_mp4_required')
    meta=read_json(movie.with_suffix('.json'))
    if meta.get('status')!='rendered_private_draft' or not re.fullmatch(r'[a-z]{2}-\d{4}-\d{2}-\d{2}',str(meta.get('id') or '')):
        raise RuntimeError('verified_compilation_metadata_required')
    if movie.stat().st_size<10000000 or len(meta.get('chapters') or [])<3:
        raise RuntimeError('video_size_or_chapters_invalid')
    receipt_path=movie.with_suffix('.youtube.json')
    if receipt_path.exists():
        prior=read_json(receipt_path)
        if re.fullmatch(r'[A-Za-z0-9_-]{11}',str(prior.get('videoId') or '')):
            log('ALREADY_UPLOADED',videoId=prior['videoId'])
            return
    remote=call_bridge('check',compilationId=meta['id'])
    if remote.get('receipt'):
        log('ALREADY_CONFIRMED_REMOTE',videoId=remote['receipt']['videoId'])
        save_json(receipt_path,remote['receipt'])
        return
    log('START',compilationId=meta['id'],bytes=movie.stat().st_size,chapters=len(meta['chapters']))
    video_id,publish=upload(movie,meta,movie.with_suffix('.upload-state.json'))
    confirmation=call_bridge('receipt',compilationId=meta['id'],videoId=video_id)
    receipt=confirmation['receipt']
    save_json(receipt_path,receipt)
    movie.with_suffix('.upload-state.json').unlink(missing_ok=True)
    log('YOUTUBE_UPLOAD_CONFIRMED',videoId=video_id,
        watchUrl=receipt['youtubeUrl'],privacy=receipt['privacyStatus'],scheduled=publish)

if __name__=='__main__':
    main()
