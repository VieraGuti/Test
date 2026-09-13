const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const UPSTREAM_COMMIT = '1ffc8ca70f71273a53fe4ec029611ca6c2a52089';
const UPSTREAM = `https://raw.githubusercontent.com/Alhysson/cs-mobile-3d/${UPSTREAM_COMMIT}`;
const SFX_COMMIT = '29a6bdfd01ad175c389cbd0bac80c30f926ff96b';
const SFX_BASE = `https://raw.githubusercontent.com/euuuuuuan/fatal-funnel-public/${SFX_COMMIT}/apps/game/public/sfx`;
const cache = new Map();
const local = {
  '/vs/custom2.js':['vs/custom2.js','application/javascript; charset=utf-8'],
  '/vs/custom.css':['vs/custom.css','text/css; charset=utf-8']
};
const sfx = new Set(['rifle_762.mp3','rifle_556.mp3','pistol_9mm.mp3','suppressed.mp3']);

const mime = p => ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.mp3':'audio/mpeg','.wav':'audio/wav'})[path.extname(p).toLowerCase()] || 'application/octet-stream';

async function get(url){
  if(cache.has(url)) return cache.get(url);
  const r=await fetch(url);
  if(!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  const b=Buffer.from(await r.arrayBuffer());
  cache.set(url,b);
  return b;
}

function htmlPatch(s){
  return s.replace(/<html lang="pt-BR">/i,'<html lang="es">')
    .replace(/<title>[^<]*<\/title>/i,'<title>VieraStrike — FPS táctico móvil</title>')
    .replace(/<meta name="description"[^>]*>/i,'<meta name="description" content="VieraStrike — FPS táctico 3D para móvil y PC.">')
    .replace(/SALA BRASIL CS/g,'VIERASTRIKE ESP').replace(/CS-BR-DUST2/g,'VS-DUST2').replace(/CS-BR-TDM/g,'VS-TDM')
    .replace('</head>','<link rel="stylesheet" href="/vs/custom.css">\n</head>')
    .replace('</body>','<script src="/vs/custom2.js"></script>\n</body>');
}

http.createServer(async(req,res)=>{
  try{
    const p=decodeURIComponent((req.url||'/').split('?')[0]);
    if(local[p]){const [f,t]=local[p];res.writeHead(200,{'Content-Type':t,'Cache-Control':'no-cache'});return res.end(fs.readFileSync(path.join(__dirname,f)));}
    if(p.startsWith('/vs-sfx/')){const n=path.basename(p);if(!sfx.has(n)){res.writeHead(404);return res.end('Not found');}const b=await get(`${SFX_BASE}/${n}`);res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'public,max-age=86400','Access-Control-Allow-Origin':'*'});return res.end(b);}
    const up=p==='/'?'/index.html':p;if(up.includes('..')){res.writeHead(400);return res.end('Bad request');}
    let b=await get(`${UPSTREAM}${up}`),type=mime(up);if(up==='/index.html'){b=Buffer.from(htmlPatch(b.toString('utf8')));type='text/html; charset=utf-8';}
    res.writeHead(200,{'Content-Type':type,'Cache-Control':up==='/index.html'?'no-cache':'public,max-age=3600','Access-Control-Allow-Origin':'*'});res.end(b);
  }catch(e){console.error(e);res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('No se pudo cargar el recurso del juego.');}
}).listen(PORT,'0.0.0.0',()=>console.log(`VieraStrike CS Mobile ES on ${PORT}`));
