import {handleUpload} from '@vercel/blob/client';
import {authenticated,respond} from '../lib/manual-short-auth.js';

export default async function handler(req,res){
  if(req.method!=='POST')return respond(res,405,{error:'method_not_allowed'});
  const kind=String(req.body?.type||'');
  // Blob's signed completion callback carries no user cookie. The SDK checks
  // the callback signature; normal token requests require admin login.
  if(kind!=='blob.upload-completed'&&!authenticated(req,res))return;
  try{
    const response=await handleUpload({
      body:req.body,
      request:req,
      onBeforeGenerateToken:async(pathname)=>{
        if(!/^manual-shorts\/[a-z0-9._-]{4,180}$/i.test(String(pathname||''))){
          throw new Error('invalid_video_pathname');
        }
        return {
          allowedContentTypes:['video/mp4','video/webm','video/quicktime'],
          maximumSizeInBytes:157286400,
          addRandomSuffix:true,
          tokenPayload:JSON.stringify({purpose:'manual-short',createdAt:Date.now()})
        };
      },
      onUploadCompleted:async({blob,tokenPayload})=>{
        // Intentionally no public publication: frontend saves verified drafts
        // with a separate, authenticated metadata request.
        if(!String(blob?.pathname||'').startsWith('manual-shorts/'))throw new Error('invalid_completed_path');
      }
    });
    return respond(res,200,response);
  }catch(error){
    return respond(res,400,{error:String(error?.message||error).slice(0,200)});
  }
}
