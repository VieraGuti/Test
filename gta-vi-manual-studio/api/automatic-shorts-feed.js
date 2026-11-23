import {get,list} from '@vercel/blob';
import {authenticated,respond} from '../lib/manual-short-auth.js';

const PREFIXES=['renders/','rendered/','shorts/','videos/'];
const MAX_ITEMS=90;
const LIMIT_PER_PREFIX=70;

const text=v=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim();
const idOK=id=>/^[A-Za-z0-9_-]{11}$/.test(String(id||''));
const safePath=p=>{
  const s=String(p||'');
  return s.length<350 && s.endsWith('.mp4') && !s.includes('..') &&
    /^(renders|rendered|shorts|videos)\/[A-Za-z0-9/._-]+\.mp4$/.test(s) ? s : null;
};

async function records(path){
  try{
    const result=await get(path,{access:'private'});
    if(result?.statusCode!==200)return {};
    const json=JSON.parse(await new Response(result.stream).text());
    return json&&typeof json==='object'&&!Array.isArray(json)?json:{};
  }catch(error){
    // A missing state file is expected before the first job.
    if(error?.name==='BlobNotFoundError'||/not found/i.test(String(error?.message||'')))return {};
    throw error;
  }
}

function firstPath(obj){
  if(!obj||typeof obj!=='object')return null;
  for(const v of [obj.renderPath,obj.videoPath,obj.blobPath,obj.outputPath,obj.mediaPath]){
    const p=safePath(v);
    if(p)return p;
  }
  return null;
}

function item({key,job={},upload={},path=null,size=null,origin='upload'}){
  const videoId=text(upload.videoId||upload.youtubeVideoId||upload.idVideo||'');
  const category=text(job.kind||upload.kind||key.split(':')[0]||'single');
  const title=text(upload.title||job.title||job.creator||upload.creator||'Short generado').slice(0,130);
  const rawStatus=text(upload.privacyStatus||upload.visibility||upload.status||
    job.status||(videoId?'uploaded':'generated'));
  const uploadedAt=text(upload.uploadedAt||upload.confirmedAt||job.updatedAt||job.completedAt||
    job.createdAt||upload.createdAt||'');
  const jobId=text(job.jobId||job.jobID||'');
  const sourceId=text(job.id||upload.sourceId||upload.clipId||'');
  return {
    key:text(key).slice(0,250),
    jobId:/^[a-f0-9]{40}$/.test(jobId)?jobId:null,
    title,
    creator:text(job.creator||upload.creator||'').slice(0,70),
    kind:['single','double'].includes(category)?category:'short',
    status:rawStatus.slice(0,50),
    uploadedAt:uploadedAt.slice(0,45),
    videoId:idOK(videoId)?videoId:null,
    youtubeUrl:idOK(videoId)?'https://www.youtube.com/watch?v='+videoId:null,
    youtubeStudioUrl:idOK(videoId)?'https://studio.youtube.com/video/'+videoId+'/edit':null,
    previewAvailable:!!path,
    storagePath:path||null,
    previewUrl:path?'/api/automatic-shorts-video?key='+encodeURIComponent(text(key)):null,
    mp4Size:size!==null&&Number.isFinite(Number(size))?Number(size):null,
    origin
  };
}

export async function inventory(){
  const [jobs,uploads]=await Promise.all([
    records('state/worker_jobs.json'),
    records('state/youtube_uploads.json')
  ]);
  const paths=new Map();
  // The final rendered video may be retained in Blob under any of these
  // known prefixes. Avoid listing unrelated state or source footage.
  const results=await Promise.allSettled(PREFIXES.map(prefix=>
    list({prefix,limit:LIMIT_PER_PREFIX})
  ));
  let listFailures=0;
  for(let i=0;i<results.length;i++){
    const result=results[i];
    if(result.status==='rejected'){listFailures++;continue}
    for(const blob of result.value.blobs||[]){
      const path=safePath(blob.pathname);
      if(path)paths.set(path,{
        path,size:blob.size,uploadedAt:blob.uploadedAt
      });
    }
  }

  const all=[];
  const seen=new Set();
  const byIdentity=new Map();
  for(const [jid,job] of Object.entries(jobs)){
    if(!job||typeof job!=='object'||!['single','double'].includes(job.kind))continue;
    const key=job.kind+':'+text(job.id||jid);
    byIdentity.set(key,{...job,jobId:job.jobId||jid});
  }
  for(const [key,upload] of Object.entries(uploads)){
    if(!upload||typeof upload!=='object'||!idOK(upload.videoId||upload.youtubeVideoId))continue;
    const job=byIdentity.get(key)||{};
    const candidate=firstPath(upload)||firstPath(job);
    const stored=candidate&&paths.get(candidate);
    all.push(item({key,job,upload,path:stored?.path||null,size:stored?.size,origin:'youtube'}));
    seen.add(key);
  }
  for(const [key,job] of byIdentity){
    if(seen.has(key))continue;
    const candidate=firstPath(job);
    const stored=candidate&&paths.get(candidate);
    all.push(item({key,job,path:stored?.path||null,size:stored?.size,origin:'worker'}));
    seen.add(key);
  }
  // MP4 blobs that are not indexed in worker jobs can still be previewed.
  // They are shown as files without guessing a streamer or YouTube status.
  let unmatched=0;
  for(const [path,b] of paths){
    if(all.some(x=>{
      const job=byIdentity.get(x.key),upload=uploads[x.key];
      return firstPath(job)===path||firstPath(upload)===path;
    }))continue;
    unmatched++;
    const key='blob:'+path;
    all.push(item({
      key,job:{title:'MP4 generado · '+path.split('/').pop(),status:'mp4_ready',
        createdAt:b.uploadedAt},
      path,size:b.size,origin:'rendered_blob'
    }));
  }
  all.sort((a,b)=>{
    const ta=Date.parse(a.uploadedAt)||0,tb=Date.parse(b.uploadedAt)||0;
    return tb-ta;
  });
  return {
    items:all.slice(0,MAX_ITEMS),
    summary:{
      youtubeVideos:all.filter(x=>!!x.videoId).length,
      previewVideos:all.filter(x=>x.previewAvailable).length,
      pending:all.filter(x=>!x.videoId).length,
      storedMp4Files:paths.size,
      listFailures
    },
    stateFilesPresent:{jobs:Object.keys(jobs).length,uploads:Object.keys(uploads).length}
  };
}
export {safePath};
export default async function handler(req,res){
  if(!authenticated(req,res))return;
  if(req.method!=='GET')return respond(res,405,{error:'method_not_allowed'});
  try{
    const data=await inventory();
    res.setHeader('Cache-Control','private, max-age=20');
    return res.status(200).json({ok:true,checkedAt:new Date().toISOString(),...data});
  }catch(e){
    return respond(res,503,{ok:false,error:'automatic_shorts_inventory_failed',
      detail:String(e?.message||e).slice(0,160)});
  }
}
