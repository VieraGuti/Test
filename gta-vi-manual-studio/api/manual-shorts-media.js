import {get} from '@vercel/blob';
import {Readable} from 'node:stream';
import {authenticated,respond} from '../lib/manual-short-auth.js';
import {readDrafts} from './manual-shorts-drafts.js';

export default async function handler(req,res){
  if(!authenticated(req,res))return;
  if(req.method!=='GET')return respond(res,405,{error:'method_not_allowed'});
  try{
    const id=String(req.query?.id||'');
    const draft=(await readDrafts()).find(x=>x.id===id);
    if(!draft)return respond(res,404,{error:'draft_not_found'});
    const object=await get(draft.pathname,{access:'private'});
    if(!object||object.statusCode!==200)return respond(res,404,{error:'video_missing'});
    res.status(200);
    res.setHeader('Content-Type',draft.contentType||'video/mp4');
    res.setHeader('Content-Disposition','inline');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(draft.size)res.setHeader('Content-Length',String(draft.size));
    const stream=object.stream;
    if(stream?.pipe)stream.pipe(res);else Readable.fromWeb(stream).pipe(res);
  }catch(e){
    if(!res.headersSent)return respond(res,502,{error:'media_stream_failed'});
    res.destroy(e);
  }
}
