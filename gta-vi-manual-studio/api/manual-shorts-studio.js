import {hasAdminSession} from '../lib/manual-short-auth.js';

const HTML=String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b1219">
<title>Subir Short · The Random Reel</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,Arial,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:#0b1219;color:#f0f9f6}
header{background:#111f29;border-bottom:1px solid #2d4954;padding:18px max(20px,calc((100% - 1120px)/2))}
main{max-width:1120px;margin:30px auto;padding:0 20px}
a{color:#a4edc3;text-decoration:none}
a:hover{text-decoration:underline}
.logo{display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-weight:900;letter-spacing:.02em}
.brand small{display:block;color:#9db7c4;font-size:11px;letter-spacing:.08em}
h1{font-size:clamp(29px,4vw,43px);letter-spacing:-.04em;margin:35px 0 6px}
p{color:#9eb5bf;line-height:1.65}
#summary{margin-top:25px}
#shorts{margin-top:20px}
.card{background:#152b35;border:1px solid #315461;border-radius:16px;padding:20px;line-height:1.5}
@media(max-width:600px){main{margin:20px auto}header{padding:15px}}
</style>
<script defer src="/manual-short-ui.js"></script>
</head>
<body>
<header><div class="logo"><div class="brand">VIRAL ENGINE<small>THE RANDOM REEL / SHORT STUDIO</small></div><span style="display:flex;gap:15px;flex-wrap:wrap;align-items:center"><a href="/api/automatic-shorts-studio">▶ Ver Shorts generados automáticamente</a><a href="/">← Panel</a></span></div></header>
<main>
<h1>Crear y subir Shorts</h1>
<p>Selecciona un MP4, previsualízalo y guárdalo como borrador. La subida a YouTube es privada y se solicita por separado.</p>
<section id="shorts">
<div class="card"><strong>¿Quieres subir tu propio vídeo?</strong><p>Usa el botón «＋ Subir Short» que aparece arriba para abrir el editor.</p></div>
</section>
<section id="summary" aria-label="Acciones rápidas"></section>
<p><small>No interrumpe la producción automática ni modifica el historial de vídeos publicados.</small></p>
</main>
</body>
</html>`;

export default function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).end('Método no permitido');
  if(!hasAdminSession(req)){
    return res.status(303).setHeader('Location','/').end();
  }
  return res.status(200).setHeader('Content-Type','text/html; charset=utf-8').end(HTML);
}
