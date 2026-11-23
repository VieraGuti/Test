import {hasAdminSession} from '../lib/manual-short-auth.js';
const HTML=String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b1219">
<title>Shorts generados · The Random Reel</title>
<style>
:root{color-scheme:dark;font:14px/1.5 Inter,system-ui,Arial,sans-serif;--bg:#091118;--card:#13212b;--border:#2b4350;--ink:#e9f5f9;--muted:#9cb6c2;--mint:#a4edc3}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);margin:0}
a{color:var(--mint);text-decoration:none}
a:hover{text-decoration:underline}
button{font:inherit;cursor:pointer}
header{border-bottom:1px solid #273d47;background:#0e1a23;padding:15px max(18px,calc((100% - 1250px)/2))}
.brand{display:flex;justify-content:space-between;gap:12px;align-items:center}
.brand b{letter-spacing:.06em;font-size:15px}
.brand small{display:block;color:var(--muted);letter-spacing:.1em;font-size:10px}
main{max-width:1250px;margin:0 auto;padding:24px 18px 70px}
.eyebrow{font-size:11px;letter-spacing:.17em;color:#9dddba;font-weight:800}
h1{font-size:clamp(27px,4vw,42px);line-height:1.05;letter-spacing:-.045em;margin:9px 0}
.desc{color:var(--muted);margin:10px 0 21px;max-width:740px}
.toolbar{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin:24px 0}
.tabs{display:flex;gap:8px;flex-wrap:wrap}
.tabs button{padding:9px 14px;border:1px solid #3b5360;background:#152630;color:#b9cdd5;border-radius:9px;font-weight:750}
.tabs button[aria-pressed=true]{background:#b0f1cc;color:#142d24;border-color:#b0f1cc}
#refresh{background:#203540;color:#e2f5f7;border:1px solid #52717b;border-radius:9px;padding:9px 12px}
.info{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 16px}
.stat{padding:12px 14px;border-radius:11px;border:1px solid #314853;background:var(--card);min-width:155px}
.stat b{display:block;font-size:19px;line-height:1.2}
.stat small{color:var(--muted);font-size:11px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:17px}
.card{background:#14242e;border:1px solid #304957;border-radius:15px;overflow:hidden;display:flex;flex-direction:column}
.media{min-height:170px;background:linear-gradient(140deg,#152e30,#101823);aspect-ratio:9/12;max-height:330px;display:grid;place-items:center;position:relative;overflow:hidden}
.media video,.media iframe{width:100%;height:100%;object-fit:contain;border:0;display:block;background:#000}
.poster{width:100%;height:100%;display:grid;place-items:center;background:#09151d}
.poster img{width:100%;height:100%;object-fit:cover;opacity:.67}
.poster .play{position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);border:1px solid #b3e5ce;background:#0a282cdb;color:#e5fff2;border-radius:100px;width:54px;height:54px;font-size:21px}
.media .mp4tag{position:absolute;top:9px;left:9px;background:#0d242add;color:#b8efd0;border:1px solid #427665;border-radius:8px;font-size:10px;padding:4px 7px;font-weight:800}
.cardbody{padding:14px;display:flex;flex-direction:column;flex:1;gap:8px}
.card h3{margin:0;font-size:14px;line-height:1.4;min-height:39px}
.meta{color:#95adba;font-size:11px}
.tag{color:#a8dec6;background:#1e3a33;display:inline-flex;font-size:10px;font-weight:750;padding:4px 8px;border-radius:8px;align-self:start}
.actions{margin-top:auto;display:flex;flex-wrap:wrap;gap:7px}
.actions a,.actions button{background:#1e3641;border:1px solid #416775;color:#eaf6f8;border-radius:9px;padding:9px 11px;font-size:11px;font-weight:800;text-decoration:none}
.actions .primary{background:var(--mint);color:#0c271f;border-color:var(--mint)}
#notice{color:#afc5d0;font-size:12px;margin:12px 0 22px;min-height:18px}
.empty{border:1px dashed #455e68;border-radius:15px;padding:35px;text-align:center;background:#11232b}
.empty strong{display:block;font-size:17px;margin-bottom:5px}
.empty p{color:var(--muted);max-width:570px;margin:0 auto}
.fine{color:#7d9aa6;font-size:11px;margin-top:23px}
@media(max-width:600px){.stat{min-width:120px}.media{max-height:290px}.toolbar{align-items:flex-start}}
</style>
<script defer src="/automatic-shorts-ui.js"></script>
</head>
<body>
<header><div class="brand"><div><b>VIRAL ENGINE</b><small>THE RANDOM REEL · SHORTS REALES</small></div><a href="/">← Panel principal</a></div></header>
<main>
  <div class="eyebrow">CONTROL ROOM / REVISIÓN</div>
  <h1>Shorts generados por nuestro motor</h1>
  <p class="desc">Aquí aparecen los vídeos reales procesados por Render y registrados en YouTube. Reprodúcelos aquí cuando el MP4 siga almacenado, o ábrelos en YouTube si ya están subidos.</p>
  <div class="info" id="auto-stats"></div>
  <div class="toolbar"><div class="tabs" role="group" aria-label="Filtrar Shorts">
    <button type="button" data-filter="all" aria-pressed="true">Todos</button>
    <button type="button" data-filter="preview" aria-pressed="false">MP4 disponibles</button>
    <button type="button" data-filter="youtube" aria-pressed="false">En YouTube</button>
    <button type="button" data-filter="pending" aria-pressed="false">Sin subir</button>
  </div><button type="button" id="refresh">↻ Actualizar</button></div>
  <div id="notice" role="status" aria-live="polite">Leyendo las subidas reales...</div>
  <div id="auto-grid" class="grid"></div>
  <p class="fine">No se generan registros simulados. Los vídeos que ya no conservan su MP4 se abren en YouTube. Los archivos privados solo son visibles después de iniciar sesión.</p>
</main>
</body>
</html>`;
export default function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).end('method_not_allowed');
  if(!hasAdminSession(req)){
    res.setHeader('Location','/');
    return res.status(303).end();
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.status(200).end(HTML);
}
