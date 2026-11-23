import {createHmac,timingSafeEqual} from 'node:crypto';

export function hasAdminSession(req) {
  const secret=process.env.DASHBOARD_SESSION_SECRET||'';
  if(secret.length<32)return false;
  const cookies=String(req.headers?.cookie||'');
  const match=cookies.match(/(?:^|;\s*)gta_vi_admin=([^;]+)/);
  if(!match)return false;
  const [payload,signature,...extra]=match[1].split('.');
  if(!payload||!signature||extra.length)return false;
  const expected=createHmac('sha256',secret).update('gta6-admin-v1:'+payload).digest('base64url');
  const a=Buffer.from(signature),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return false;
  try{
    const obj=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return obj.u==='VieraGuti'&&Number.isFinite(obj.e)&&obj.e>Date.now();
  }catch{return false}
}
export function safeRequest(req) {
  const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
  return site!=='cross-site';
}
export function respond(res,status,data){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(data);
}
export function authenticated(req,res){
  if(!safeRequest(req)){respond(res,403,{error:'cross_site_blocked'});return false}
  if(!hasAdminSession(req)){respond(res,401,{error:'admin_login_required'});return false}
  return true;
}
export function safeTitle(input){
  return String(input||'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,95);
}
