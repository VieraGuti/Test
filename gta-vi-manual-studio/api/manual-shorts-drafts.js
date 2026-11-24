import {get,head,put} from '@vercel/blob';
import {randomUUID} from 'node:crypto';
import {authenticated,respond,safeTitle} from '../lib/manual-short-auth.js';

const DEFAULT_TAGS=["gaming","GTA 6","GTA VI","GTA6","Grand Theft Auto VI","Rockstar Games","gaming shorts","videojuegos","clips GTA 6","The Random Reel"];
export function shortTags(input){
  const extra=Array.isArray(input)?input:typeof input==='string'?input.split(','):[];
  const seen=new Set(),tags=[];
  let used=0;
  for(const raw of [...DEFAULT_TAGS,...extra]){
    const tag=String(raw).replace(/[\u0000-\u001f\u007f<>]/g,' ').trim().replace(/^#+/,'').trim().slice(0,80);
    if(!tag||seen.has(tag.toLowerCase()))continue;
    const cost=tag.length+(tag.includes(' ')?2:0)+(tags.length?1:0);
    if(used+cost>480)continue;
    seen.add(tag.toLowerCase());tags.push(tag);used+=cost;
  }
  return tags;
}

const KEY='state/manual_shorts_drafts.json';
export async function readDrafts(){
  try{
    const b=await get(KEY,{access:'private'});
    if(!b||b.statusCode!==200)return [];
    const x=JSON.parse(await new Response(b.stream).text());
    return Array.isArray(x)?x:[];
  }catch(e){
    if(e?.name==='BlobNotFoundError'||/not found/i.test(String(e?.message)))return [];
    throw e;
  }
}
export async function writeDrafts(rows){
  await put(KEY,JSON.stringify(rows.slice(0,200)),{
    access:'private',allowOverwrite:true,addRandomSuffix:false,
    contentType:'application/json'
  });
}
export default async function handler(req,res){
  if(!authenticated(req,res))return;
  try{
    if(req.method==='GET'){
      const rows=await readDrafts();
      return respond(res,200,{ok:true,drafts:rows.slice(0,50).map(d=>({
        id:d.id,title:d.title,description:d.description||'',tags:shortTags(d.tags),createdAt:d.createdAt,
        size:d.size,contentType:d.contentType,status:d.status,
        youtubeUrl:d.youtubeUrl||null,lastError:d.lastError||null
      }))});
    }
    if(req.method!=='POST')return respond(res,405,{error:'method_not_allowed'});
    const input=req.body||{};
    if(input.action!=='create')return respond(res,400,{error:'unsupported_action'});
    if(input.licenseAccepted!==true)return respond(res,400,{error:'rights_confirmation_required'});
    const pathname=String(input.pathname||'');
    if(!/^manual-shorts\/[a-zA-Z0-9._-]{4,220}$/.test(pathname))return respond(res,400,{error:'invalid_pathname'});
    const title=safeTitle(input.title);
    if(title.length<9)return respond(res,400,{error:'title_too_short'});
    const description=String(input.description||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,2000);
    const blob=await head(pathname);
    if(!blob||!/^video\/(mp4|webm|quicktime)$/i.test(String(blob.contentType||''))||
       !Number.isFinite(blob.size)||blob.size<1024||blob.size>157286400){
      return respond(res,400,{error:'video_missing_or_invalid'});
    }
    const rows=await readDrafts();
    const existing=rows.find(d=>d.pathname===pathname);
    if(existing)return respond(res,200,{ok:true,draft:existing,reused:true});
    const d={id:randomUUID(),pathname,title,description,tags:shortTags(input.tags),createdAt:new Date().toISOString(),
      status:'draft',size:blob.size,contentType:blob.contentType,
      lastError:null,licenseAccepted:true};
    rows.unshift(d);
    await writeDrafts(rows);
    return respond(res,201,{ok:true,draft:d});
  }catch(e){
    return respond(res,500,{error:'draft_store_failed',detail:String(e?.message||e).slice(0,180)});
  }
}
