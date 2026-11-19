"""Resumable, memory-bounded YouTube uploader for long compilations.

Requires the channel owner's OAuth refresh token. Credentials are environment
variables only; never store or log the refresh token or access token.
"""
from __future__ import annotations
import datetime as dt
import json
import logging
import os
import re
import time
from pathlib import Path
import httpx

LOG=logging.getLogger('gtavi-youtube')
CHUNK=8*1024*1024  # multiple of 256 KiB
YT_CHANNEL='UCCv7FqhV_k0asn-Ho8HiP5w'
TOKEN_ENDPOINT='https://oauth2.googleapis.com/token'
VIDEO_API='https://www.googleapis.com/youtube/v3/videos'
UPLOAD_API='https://www.googleapis.com/upload/youtube/v3/videos'
CHAPTER_TIME=lambda secs:f"{int(secs)//3600:02d}:{(int(secs)//60)%60:02d}:{int(secs)%60:02d}"
class YoutubeLongUploader:
 def __init__(self,client_id=None,client_secret=None,refresh_token=None,expected_channel=YT_CHANNEL):
  self.client_id=client_id or os.environ.get('YOUTUBE_CLIENT_ID','')
  self.client_secret=client_secret or os.environ.get('YOUTUBE_CLIENT_SECRET','')
  self.refresh_token=refresh_token or os.environ.get('YOUTUBE_REFRESH_TOKEN','')
  self.expected_channel=expected_channel
  self._access_token=None
  self._expires_at=0
 @property
 def configured(self):
  return bool(self.client_id and self.client_secret and self.refresh_token)
 def access_token(self):
  if self._access_token and self._expires_at>time.time()+90:return self._access_token
  if not self.configured:raise RuntimeError('youtube_oauth_refresh_token_not_configured')
  with httpx.Client(timeout=30) as client:
   r=client.post(TOKEN_ENDPOINT,data={'client_id':self.client_id,'client_secret':self.client_secret,
                         'refresh_token':self.refresh_token,'grant_type':'refresh_token'})
   r.raise_for_status()
   obj=r.json()
  token=obj.get('access_token')
  if not token:raise RuntimeError('youtube_token_refresh_failed')
  self._access_token=token
  self._expires_at=time.time()+int(obj.get('expires_in') or 3600)
  return token
 def _headers(self):
  return {'Authorization':'Bearer '+self.access_token()}
 def verify_channel(self):
  with httpx.Client(timeout=30) as client:
   r=client.get('https://www.googleapis.com/youtube/v3/channels',
        params={'part':'id','mine':'true'},headers=self._headers())
   r.raise_for_status();items=r.json().get('items',[])
  if not any(x.get('id')==self.expected_channel for x in items):
   raise RuntimeError('youtube_oauth_wrong_channel')
 def description(self,meta):
  chapters=meta.get('chapters') or []
  lines=['Edited highlights from GTA VI streams. Original streamer audio.',
   'Moments are arranged by language, creator and chapter.',
   '', 'CHAPTERS']
  for ch in chapters:
   lines.append(CHAPTER_TIME(ch.get('startSeconds') or 0)+' '+str(ch.get('creator') or 'Streamer')[:45])
  lines.extend(['','SOURCES'])
  for ch in chapters:
   if ch.get('sourceUrl'):lines.append(str(ch['sourceUrl']))
  lines.extend(['','Source clip rights remain with their respective owners.'])
  text='\n'.join(lines)
  return text[:4900]
 def upload(self,meta,publish_at=None):
  """Upload privately (or schedule a future public release) and confirm ID via videos.list."""
  file=Path(meta['outputFile']).resolve()
  if not file.is_file():raise RuntimeError('compilation_file_not_found')
  size=file.stat().st_size
  if size<100_000:raise RuntimeError('compilation_video_too_small')
  self.verify_channel()
  language=meta['language']
  status={'privacyStatus':'private','selfDeclaredMadeForKids':False}
  if publish_at:
   when=dt.datetime.fromisoformat(str(publish_at).replace('Z','+00:00'))
   if not when.tzinfo:raise ValueError('publishAt_timezone_required')
   if when<=dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=15):
    raise ValueError('publishAt_must_be_in_future')
   status['publishAt']=when.astimezone(dt.timezone.utc).isoformat().replace('+00:00','Z')
  payload={'snippet':{'title':str(meta['title'])[:100],
             'description':self.description(meta),'categoryId':'20','defaultLanguage':language},
           'status':status}
  with httpx.Client(timeout=httpx.Timeout(90,connect=20),follow_redirects=False) as client:
   r=client.post(UPLOAD_API,params={'uploadType':'resumable','part':'snippet,status'},
       json=payload,headers={**self._headers(),'X-Upload-Content-Type':'video/mp4',
                              'X-Upload-Content-Length':str(size)})
   r.raise_for_status()
   upload_url=r.headers.get('Location')
   if not upload_url or not upload_url.startswith('https://www.googleapis.com/'):
    raise RuntimeError('invalid_youtube_upload_session')
   offset=0;video_id=None
   with file.open('rb') as stream:
    while offset<size:
     stream.seek(offset)
     raw=stream.read(min(CHUNK,size-offset))
     if not raw:raise RuntimeError('unexpected_end_of_mp4')
     begin,end=offset,offset+len(raw)-1
     headers={**self._headers(),'Content-Type':'video/mp4',
              'Content-Length':str(len(raw)),'Content-Range':f'bytes {begin}-{end}/{size}'}
     for attempt in range(5):
      try:response=client.put(upload_url,content=raw,headers=headers,timeout=180)
      except (httpx.TimeoutException,httpx.NetworkError):
       response=None
      if response is not None and response.status_code in (200,201):
       video_id=response.json().get('id')
       if not video_id:raise RuntimeError('missing_youtube_video_id')
       offset=size;break
      if response is not None and response.status_code==308:
       rr=response.headers.get('Range','')
       m=re.search(r'bytes=0-(\d+)',rr)
       offset=(int(m.group(1))+1) if m else end+1
       break
      if response is not None and 400<=response.status_code<500:
       raise RuntimeError('youtube_chunk_rejected_http_'+str(response.status_code))
      time.sleep(min(12,2**attempt))
      query=client.put(upload_url,headers={**self._headers(),'Content-Length':'0',
              'Content-Range':f'bytes */{size}'},timeout=30)
      if query.status_code==308:
       m=re.search(r'bytes=0-(\d+)',query.headers.get('Range',''))
       offset=(int(m.group(1))+1) if m else 0
       break
      if query.status_code in (200,201):
       video_id=query.json().get('id');offset=size;break
     else:raise RuntimeError('youtube_resumable_upload_failed')
     LOG.info('Long video uploaded %d/%d bytes (%.1f%%)',offset,size,100*offset/size)
   if not video_id:raise RuntimeError('youtube_upload_not_finalized')
  confirmation=self.confirm(video_id)
  if confirmation.get('platform')!='youtube':
   raise RuntimeError('youtube_confirmation_failed')
  return {'videoId':video_id,'watchUrl':'https://www.youtube.com/watch?v='+video_id,
          'confirmation':confirmation,'publishAt':status.get('publishAt'),
          'privacyStatus':confirmation.get('privacyStatus')}
 def confirm(self,video_id):
  if not re.fullmatch(r'[A-Za-z0-9_-]{11}',str(video_id or '')):
   raise RuntimeError('invalid_youtube_video_id')
  with httpx.Client(timeout=30) as client:
   r=client.get(VIDEO_API,params={'part':'status,snippet','id':video_id},headers=self._headers())
   r.raise_for_status();items=r.json().get('items',[])
  if len(items)!=1 or items[0].get('id')!=video_id:
   raise RuntimeError('youtube_video_not_found_after_upload')
  st=items[0].get('status') or {}
  if st.get('uploadStatus') in ('failed','rejected','deleted'):
   raise RuntimeError('youtube_upload_not_accepted')
  if st.get('uploadStatus') not in ('uploaded','processed'):
   raise RuntimeError('youtube_upload_not_yet_confirmed')
  return {'id':video_id,'platform':'youtube','uploadStatus':st.get('uploadStatus'),
          'privacyStatus':st.get('privacyStatus'),'publishAt':st.get('publishAt')}
