import {get,head,put} from '@vercel/blob';
import {authenticated,respond} from '../lib/manual-short-auth.js';
import {readDrafts,writeDrafts} from './manual-shorts-drafts.js';

export const config={maxDuration:800};
const OAUTH='oauth/youtube_channel.json';

async function blobJson(path){
  const object=await get(path,{access:'private'});
  if(!object||object.statusCode!==200)throw new Error('youtube_account_not_connected');
  return JSON.parse(await new Response(object.stream).text());
}
async function token(){
  const channel=await blobJson(OAUTH);
  let access=channel.accessToken||channel.access_token;
  const expiry=Number(channel.expiresAt||channel.expiry_date||0);
  if(access&&expiry>Date.now()+90000)return access;
  const refresh=channel.refreshToken||channel.refresh_token;
  if(!refresh)throw new Error('youtube_refresh_token_missing');
  const id=process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if(!id||!secret)throw new Error('google_oauth_not_configured');
  const params=new URLSearchParams({
    grant_type:'refresh_token',refresh_token:refresh,
    client_id:id,client_secret:secret
  });
  const reply=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params,signal:AbortSignal.timeout(30000)
  });
  const payload=await reply.json();
  if(!reply.ok||!payload.access_token)throw new Error('youtube_oauth_refresh_failed');
  access=payload.access_token;
  const updated={...channel,accessToken:access,expiresAt:Date.now()+(Number(payload.expires_in||3600)*1000)};
  await put(OAUTH,JSON.stringify(updated),{
    access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json'
  });
  return access;
}
async function sendVideo(draft){
  const blob=await head(draft.pathname);
  const size=Number(blob?.size||0);
  if(size<1024||size>157286400)throw new Error('invalid_video_size');
  const contentType=String(blob.contentType||'video/mp4');
  if(!/^video\/(mp4|webm|quicktime)$/i.test(contentType))throw new Error('unsupported_video_type');
  const access=await token();
  const meta={
    snippet:{title:draft.title,description:draft.description||'',categoryId:'20'},
    status:{privacyStatus:'private',selfDeclaredMadeForKids:false}
  };
  const start=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
    method:'POST',
    headers:{
      Authorization:'Bearer '+access,
      'Content-Type':'application/json; charset=utf-8',
      'X-Upload-Content-Type':contentType,
      'X-Upload-Content-Length':String(size)
    },
    body:JSON.stringify(meta),
    signal:AbortSignal.timeout(45000)
  });
  if(!start.ok)throw new Error('youtube_session_failed_'+start.status);
  const location=start.headers.get('location');
  if(!location)throw new Error('youtube_upload_location_missing');
  const uploadHost=new URL(location);
  if(uploadHost.protocol!=='https:'||
     !(uploadHost.hostname==='www.googleapis.com'||uploadHost.hostname.endsWith('.googleapis.com'))){
    throw new Error('unsafe_youtube_upload_location');
  }
  const source=await get(draft.pathname,{access:'private'});
  if(!source||source.statusCode!==200)throw new Error('private_video_missing');
  const complete=await fetch(location,{
    method:'PUT',
    headers:{'Content-Type':contentType,'Content-Length':String(size)},
    body:source.stream,duplex:'half',
    signal:AbortSignal.timeout(700000)
  });
  let result={};
  try{result=await complete.json()}catch{}
  if(!complete.ok||!(/^[A-Za-z0-9_-]{11}$/.test(String(result.id||'')))){
    throw new Error('youtube_upload_failed_'+complete.status);
  }
  return {videoId:result.id,url:'https://www.youtube.com/watch?v='+result.id};
}
export default async function handler(req,res){
  if(!authenticated(req,res))return;
  if(req.method!=='POST')return respond(res,405,{error:'method_not_allowed'});
  const id=String(req.body?.id||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return respond(res,400,{error:'invalid_draft_id'});
  let rows=await readDrafts();
  let index=rows.findIndex(d=>d.id===id);
  if(index<0)return respond(res,404,{error:'draft_not_found'});
  const draft=rows[index];
  if(draft.status==='uploaded_private')return respond(res,200,{
    ok:true,alreadyUploaded:true,youtubeUrl:draft.youtubeUrl
  });
  if(draft.status==='uploading'&&Date.now()-Date.parse(draft.uploadStartedAt||'')<900000){
    return respond(res,409,{error:'already_uploading'});
  }
  rows[index]={...draft,status:'uploading',uploadStartedAt:new Date().toISOString(),lastError:null};
  await writeDrafts(rows);
  try{
    const done=await sendVideo(draft);
    rows=await readDrafts();
    index=rows.findIndex(d=>d.id===id);
    if(index>=0){
      rows[index]={...rows[index],status:'uploaded_private',
        youtubeUrl:done.url,youtubeVideoId:done.videoId,uploadedAt:new Date().toISOString(),lastError:null};
      await writeDrafts(rows);
    }
    return respond(res,200,{ok:true,privacyStatus:'private',...done});
  }catch(e){
    rows=await readDrafts();
    index=rows.findIndex(d=>d.id===id);
    if(index>=0){
      rows[index]={...rows[index],status:'draft',
        lastError:String(e?.message||e).slice(0,160),uploadStartedAt:null};
      await writeDrafts(rows);
    }
    return respond(res,502,{error:'youtube_upload_failed',detail:String(e?.message||e).slice(0,160)});
  }
}
