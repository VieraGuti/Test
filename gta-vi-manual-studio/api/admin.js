// Keep the original dashboard, live metrics, login, and all existing API routes.
// Gallery and manual actions are linked server-side so they work even if JS fails.
import originalAdmin from '../lib/admin-base.js';

const DIRECT_LINKS='<div style="padding:12px 14px;display:grid;gap:8px">'+
  '<a data-auto-shorts-link="1" href="/api/automatic-shorts-studio" style="display:block;padding:12px 13px;text-align:center;border-radius:10px;background:#a4edc3;color:#102d23;text-decoration:none;font-weight:900;border:1px solid #beeccd">▶ Ver Shorts generados</a>'+
  '<a data-manual-shorts-link="1" href="/api/manual-shorts-studio" style="display:block;padding:9px 12px;text-align:center;border-radius:10px;background:#1a313b;color:#cee9dc;text-decoration:none;font-weight:800;border:1px solid #44645d">＋ Subir mi propio Short</a></div>';
const AUTO_CTA='<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;padding:17px 19px;margin:0 0 16px;background:#19312b;border:1px solid #42685b;border-radius:14px">'+
  '<div><strong style="display:block;font-size:15px">Tus Shorts ya generados</strong><small style="display:block;color:#b2cebd">Reproduce MP4 guardados, revisa trabajos y abre vídeos en YouTube</small></div>'+
  '<a href="/api/automatic-shorts-studio" style="padding:11px 15px;background:#a4edc3;color:#102d23;border-radius:10px;text-decoration:none;font-weight:850">▶ Ver vídeos</a></div>';
const EXTRA='<script defer src="/manual-short-ui.js"></script>'+
  '<script defer src="/manual-series-sync.js"></script>';

export default function handler(req,res){
  if(req.method==='GET'&&!req.query?.view){
    const previousEnd=res.end.bind(res);
    res.end=function(body,...args){
      if(typeof body==='string'&&body.includes('id="shorts"')&&body.includes('</body>')){
        if(body.includes('</nav>')&&!body.includes('data-auto-shorts-link')){
          body=body.replace('</nav>','</nav>'+DIRECT_LINKS);
        }
        body=body.replace('<section class="section" id="shorts">',
          '<section class="section" id="shorts">'+AUTO_CTA);
        body=body.replace('</body>',EXTRA+'</body>');
      }
      return previousEnd(body,...args);
    };
  }
  return originalAdmin(req,res);
}
