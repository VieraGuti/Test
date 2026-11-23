// Preserve the authenticated dashboard and its existing live metrics.
// The direct link is server-rendered, so it exists even if client JS fails.
import originalAdmin from '../lib/admin-base.js';

const DIRECT_LINK='<div style="padding:12px 14px"><a data-manual-shorts-link="1" href="/api/manual-shorts-studio" style="display:block;padding:12px 13px;text-align:center;border-radius:10px;background:#a4edc3;color:#102d23;text-decoration:none;font-weight:900;border:1px solid #beeccd">＋ Subir Short</a></div>';
const EXTRA='<script defer src="/manual-short-ui.js"></script>'+
  '<script defer src="/manual-series-sync.js"></script>';

export default function handler(req,res){
  if(req.method==='GET'&&!req.query?.view){
    const previousEnd=res.end.bind(res);
    res.end=function(body,...args){
      if(typeof body==='string'&&body.includes('id="shorts"')&&body.includes('</body>')){
        if(body.includes('</nav>')&&!body.includes('data-manual-shorts-link')){
          body=body.replace('</nav>','</nav>'+DIRECT_LINK);
        }
        body=body.replace('</body>',EXTRA+'</body>');
      }
      return previousEnd(body,...args);
    };
  }
  return originalAdmin(req,res);
}
