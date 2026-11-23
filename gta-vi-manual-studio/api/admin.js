// Preserves the current control room, authentication and live metrics.
// Adds the manual Shorts Studio only to authenticated dashboard HTML.
import originalAdmin from './admin-base.js';

export default function handler(req,res){
  if(req.method==='GET'&&!req.query?.view){
    const previousEnd=res.end.bind(res);
    res.end=function(body,...args){
      if(typeof body==='string'&&body.includes('id="shorts"')&&body.includes('</body>')){
        body=body.replace('</body>',
          '<script defer src="/manual-short-ui.js"></script></body>');
      }
      return previousEnd(body,...args);
    };
  }
  return originalAdmin(req,res);
}
