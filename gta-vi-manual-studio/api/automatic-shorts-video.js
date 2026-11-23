import {get} from '@vercel/blob';
import {Readable} from 'node:stream';
import {authenticated,respond} from '../lib/manual-short-auth.js';
import {inventory,safePath} from './automatic-shorts-feed.js';

export const config={maxDuration:180};

export default async function handler(req,res){
  if(!authenticated(req,res))return;
  if(req.method!=='GET')return respond(res,405,{error:'method_not_allowed'});
  const key=String(req.query?.key||'');
  if(!key||key.length>250)return respond(res,400,{error:'invalid_video_key'});
  try{
    const data=await inventory();
    const chosen=data.items.find(x=>x.key===key);
    const path=chosen?.storagePath;
    if(!chosen?.previewAvailable||!safePath(path)){
      return respond(res,404,{error:'video_not_retained',
        note:'El MP4 original no consta en el almacenamiento; abre la versión de YouTube si existe.'});
    }
    const video=await get(path,{access:'private'});
    if(video?.statusCode!==200||!video.stream){
      return respond(res,404,{error:'private_video_not_found'});
    }
    const size=Number(video.blob?.size||chosen.mp4Size||0);
    res.status(200);
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Content-Disposition','inline');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Accept-Ranges','none');
    if(size>0)res.setHeader('Content-Length',String(size));
    const stream=video.stream;
    if(stream.pipe)stream.pipe(res);else Readable.fromWeb(stream).pipe(res);
  }catch(error){
    if(!res.headersSent){
      return respond(res,502,{error:'video_preview_unavailable'});
    }
    res.destroy(error);
  }
}
