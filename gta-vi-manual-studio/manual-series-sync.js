/* Correct series statuses from verified private YouTube receipts.
 * Survives the dashboard's 30-second DOM re-render. No fake successes.
 */
(()=>{
  if(window.__manualSeriesReceiptSync)return;
  window.__manualSeriesReceiptSync=true;
  const MAP={'Español':'es','Inglés':'en','Ruso':'ru','Portugués':'pt','Alemán':'de','Francés':'fr','Italiano':'it','Ucraniano':'uk','Polaco':'pl'};
  let receipts={}, lastVerifiedAt='', busy=false,active=false, queued=false;

  function update(){
    const host=document.getElementById('series');
    if(!host)return;
    for(const row of host.querySelectorAll('.record')){
      const code=MAP[row.querySelector('b')?.textContent?.trim()||''];
      if(!code)continue;
      const receipt=Object.values(receipts).filter(x=>
        x && typeof x.compilationId==='string'&&x.compilationId.startsWith(code+'-') &&
        (typeof x.confirmedAt==='string'||x.youtubeUrl||x.youtubeVideoId)
      ).sort((a,b)=>String(b.confirmedAt||'').localeCompare(String(a.confirmedAt||'')))[0];
      if(!receipt)continue; // Unknown statuses must remain pending.
      const isPublic=receipt.privacyStatus==='public';
      const scheduled=receipt.privacyStatus==='private'&&!!receipt.publishAt;
      const label=isPublic?'PUBLICADO':scheduled?'PROGRAMADO':'SUBIDO';
      const desc=isPublic?'Episodio confirmado y público en YouTube':
        scheduled?'Episodio confirmado en YouTube · publicación programada':
          'Episodio confirmado en YouTube';
      const badge=row.querySelector('.pill');
      const small=row.querySelector('small');
      if(small&&small.textContent!==desc)small.textContent=desc;
      if(badge&&(badge.textContent!==label||badge.className!=='pill')){
        badge.textContent=label;badge.className='pill';
      }
    }
  }
  function schedule(){
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;update()});
  }
  async function refresh(){
    if(busy||document.hidden)return;
    busy=true;
    try{
      const res=await fetch('/api/compilations-status',{credentials:'same-origin',cache:'no-store'});
      if(!res.ok)return;
      const data=await res.json();
      if(data && data.receipts && typeof data.receipts==='object'){
        receipts=data.receipts;lastVerifiedAt=new Date().toISOString();schedule();
      }
    }catch{/* leave unverified statuses unchanged */}
    finally{busy=false}
  }
  function install(){
    if(active)return;
    const series=document.getElementById('series');
    if(!series)return;
    active=true;
    const ob=new MutationObserver(schedule);
    ob.observe(series,{childList:true,characterData:true,subtree:true});
    refresh();setInterval(refresh,20000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();