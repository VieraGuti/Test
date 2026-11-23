(() => {
  if(window.__manualShortStudio)return;
  window.__manualShortStudio=true;
  function start(){
    const shorts=document.getElementById('shorts'),summary=document.getElementById('summary');
    if(!shorts||!summary)return;
    const style=document.createElement('style');
    style.textContent='.ms-open,.ms-save{background:#a4edc3;color:#103226;font-weight:800;border:0;border-radius:10px;padding:11px 16px;cursor:pointer}.ms-open:hover,.ms-save:hover{background:#c3f6d5}.ms-open:disabled,.ms-save:disabled{opacity:.5;cursor:not-allowed}.ms-open.ms-side{display:block;width:calc(100% - 28px);margin:14px}.ms-cta{margin:12px 0;padding:18px;background:linear-gradient(100deg,#1d3d34,#16252c);border:1px solid #3a6356;border-radius:13px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}.ms-cta strong{display:block;font-size:15px}.ms-cta small{display:block;color:#c1d7d1}.ms-modal{position:fixed;inset:0;z-index:100000;background:#000d;display:none;overflow:auto;padding:20px;align-items:flex-start;justify-content:center;backdrop-filter:blur(8px)}.ms-modal.active{display:flex}.ms-panel{background:#111e2b;color:#edf8fa;border:1px solid #3c5b67;max-width:1050px;width:100%;margin:auto;border-radius:20px;padding:22px;box-shadow:0 30px 95px #000b}.ms-top{display:flex;justify-content:space-between;align-items:start;gap:15px;margin-bottom:16px}.ms-top h2{margin:0;font-size:25px}.ms-top p{color:#a5bdc8;margin:4px 0}.ms-cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}.ms-field{display:block;margin:0 0 14px;font-size:12px;font-weight:700;color:#b9d4d9}.ms-field input,.ms-field textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;border:1px solid #3d5968;border-radius:9px;background:#0a141f;color:#fff;padding:11px;font:inherit}.ms-field textarea{min-height:100px;resize:vertical}.ms-drop{display:flex;flex-direction:column;gap:5px;padding:22px;align-items:center;text-align:center;border:2px dashed #47778a;border-radius:13px;cursor:pointer;background:#102632}.ms-drop:hover{border-color:#a4edc3}.ms-drop input{display:none}.ms-preview{display:block;margin-top:12px;border:1px solid #314957;border-radius:12px;background:#04080c;width:100%;max-height:380px;aspect-ratio:16/9;object-fit:contain}.ms-detail,.ms-msg,.ms-foot{font-size:12px;color:#a6c0ce}.ms-msg.error{color:#ffaaa1}.ms-msg.good{color:#a4edc3}.ms-check{display:flex;align-items:flex-start;gap:9px;font-size:12px;color:#cbd9df;margin:10px 0}.ms-controls{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}.ms-secondary{background:#1c3440;color:#e3f2f4;border:1px solid #476776;border-radius:9px;padding:9px 11px;cursor:pointer}.ms-progress{width:100%;accent-color:#a4edc3}.ms-drafts{margin-top:24px;border-top:1px solid #365465;padding-top:15px}.ms-item{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid #294657;padding:11px 0}.ms-item strong{display:block;font-size:13px}.ms-item small{font-size:11px;color:#9bb4c1}.ms-actions{display:flex;flex-wrap:wrap;gap:7px}.ms-actions button,.ms-actions a{display:inline-flex;padding:8px 10px;font-size:11px;font-weight:750;background:#1c3440;color:#e3f2f4;text-decoration:none;border:1px solid #456271;border-radius:8px;cursor:pointer}.ms-actions button:disabled{opacity:.5}@media(max-width:760px){.ms-cols{grid-template-columns:1fr}.ms-panel{padding:14px}.ms-modal{padding:8px}.ms-cta{align-items:start}}';
    document.head.appendChild(style);
    const openButton=()=>{
      const b=document.createElement('button');b.type='button';b.className='ms-open';b.textContent='＋ Subir Short';b.addEventListener('click',open);return b;
    };
    function addBanner(target){
      const bar=document.createElement('div');bar.className='ms-cta';
      const words=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent='Sube y revisa tus propios Shorts';detail.textContent='Selecciona un MP4 · Guarda un borrador · Envíalo a YouTube privado';
      words.append(title,detail);bar.append(words,openButton());target.prepend(bar);
    }
    if(!document.getElementById('series'))addBanner(shorts); // avoid duplicate upload banners in live dashboard
    const nav=document.querySelector('aside nav');
    if(nav&&!document.querySelector('[data-manual-shorts-link]')){const b=openButton();b.classList.add('ms-side');nav.insertAdjacentElement('afterend',b);}
    const modal=document.createElement('div');modal.className='ms-modal';modal.id='ms-modal';
    modal.innerHTML=[
      '<div class="ms-panel" role="dialog" aria-modal="true" aria-label="Subir Short">',
      '<div class="ms-top"><div><h2>Subir Short</h2><p>Revisa el vídeo antes de enviarlo. Todo se guarda privado por defecto.</p></div><button class="ms-secondary" type="button" id="ms-close">Cerrar ✕</button></div>',
      '<div class="ms-cols"><div><label class="ms-drop"><strong id="ms-file-name">＋ Seleccionar o arrastrar vídeo</strong><span>MP4 · MOV · WebM, hasta 150 MB</span><input type="file" id="ms-file" accept="video/mp4,video/webm,video/quicktime"></label>',
      '<video controls playsinline preload="metadata" class="ms-preview" id="ms-preview"></video><p class="ms-detail" id="ms-detail">Elige un archivo para ver su duración y resolución.</p></div>',
      '<div><label class="ms-field">Título del Short<input type="text" id="ms-title" maxlength="95" placeholder="Ej.: Rubius escapa de una persecución inesperada"></label>',
      '<label class="ms-field">Descripción<textarea id="ms-description" maxlength="2000" placeholder="Qué ocurre y quién es el creador original"></textarea></label>',
      '<label class="ms-check"><input type="checkbox" id="ms-rights"><span>Confirmo que tengo los derechos o permisos necesarios para usar y publicar este vídeo.</span></label>',
      '<div class="ms-controls"><button class="ms-save" id="ms-save" type="button">Guardar borrador privado</button><button class="ms-secondary" id="ms-studio" type="button">Abrir YouTube Studio</button></div>',
      '<progress class="ms-progress" id="ms-progress" max="100" value="0" hidden></progress><p class="ms-msg" id="ms-msg" role="status"></p>',
      '<p class="ms-foot">Ningún archivo se publica automáticamente. El envío a YouTube requiere otro clic y queda en <b>privado</b>.</p></div></div>',
      '<section class="ms-drafts"><div class="ms-controls"><h3 style="margin:4px 12px 4px 0">Borradores manuales</h3><button class="ms-secondary" id="ms-refresh">Actualizar</button></div><div id="ms-list">Sin cargar</div></section>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    const $=id=>document.getElementById(id);
    let file=null,url=null,busy=false;
    function message(v,error=false,success=false){
      const n=$('ms-msg');n.textContent=v;n.className='ms-msg'+(error?' error':success?' good':'');
    }
    function open(){modal.classList.add('active');document.body.style.overflow='hidden';loadDrafts();}
    function close(){modal.classList.remove('active');document.body.style.overflow='';}
    $('ms-close').addEventListener('click',close);
    modal.addEventListener('click',e=>{if(e.target===modal)close()});
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('active'))close()});
    $('ms-studio').addEventListener('click',()=>window.open('https://studio.youtube.com/','_blank','noopener'));
    $('ms-refresh').addEventListener('click',loadDrafts);
    function chosen(f){
      if(!f)return;
      if(!/\.(mp4|mov|webm)$/i.test(f.name)&&!/^video\/(mp4|webm|quicktime)$/.test(f.type)){message('Formato inválido. Selecciona MP4, MOV o WebM.',true);return;}
      if(f.size<1024||f.size>157286400){message('Tamaño no admitido (1 KB a 150 MB).',true);return;}
      file=f;
      if(url)URL.revokeObjectURL(url);
      url=URL.createObjectURL(f);
      $('ms-preview').src=url;
      $('ms-file-name').textContent=f.name;
      $('ms-detail').textContent=(f.size/1048576).toFixed(1)+' MB · Leyendo duración...';
      if(!$('ms-title').value)$('ms-title').value=f.name.replace(/\.(mp4|mov|webm)$/i,'').replace(/[_-]/g,' ').trim().slice(0,95);
      message('Vídeo seleccionado. Puedes previsualizarlo antes de guardarlo.');
    }
    $('ms-file').addEventListener('change',e=>chosen(e.target.files?.[0]));
    $('ms-preview').addEventListener('loadedmetadata',()=>{
      const v=$('ms-preview'),seconds=Number(v.duration);
      $('ms-detail').textContent=(file?(file.size/1048576).toFixed(1)+' MB · ':'')+
        (Number.isFinite(seconds)?seconds.toFixed(1)+' s · ':'')+v.videoWidth+' × '+v.videoHeight+
        (v.videoWidth>v.videoHeight?' · Se recomienda 9:16':' · Formato vertical');
    });
    const drop=$('ms-file').closest('label');
    ['dragover','dragenter'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.style.borderColor='#a4edc3'}));
    ['dragleave','drop'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.style.borderColor=''}));
    drop.addEventListener('drop',e=>chosen(e.dataTransfer?.files?.[0]));
    async function json(url,options={}){
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.detail||data.error||'HTTP '+response.status);
      return data;
    }
    const post=(path,body)=>json(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    $('ms-save').addEventListener('click',async()=>{
      if(busy)return;
      if(!file)return message('Primero selecciona un vídeo.',true);
      const title=$('ms-title').value.trim();
      if(title.length<9)return message('Escribe un título descriptivo de al menos 9 caracteres.',true);
      if(!$('ms-rights').checked)return message('Confirma los derechos de uso del vídeo.',true);
      busy=true;$('ms-save').disabled=true;$('ms-progress').hidden=false;$('ms-progress').value=0;
      message('Preparando carga privada...');
      try{
        const module=await import('https://esm.sh/@vercel/blob@2.3.1/client?bundle');
        const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'-').slice(-90);
        const blob=await module.upload('manual-shorts/'+Date.now()+'-'+safe,file,{
          access:'private',handleUploadUrl:'/api/manual-shorts-upload',multipart:true,
          onUploadProgress:({percentage})=>{
            if(Number.isFinite(Number(percentage))){
              $('ms-progress').value=Math.max(0,Math.min(100,Number(percentage)));
              message('Subiendo vídeo privado: '+Math.round(Number(percentage))+' %');
            }
          }
        });
        const result=await post('/api/manual-shorts-drafts',{
          action:'create',pathname:blob.pathname,title,description:$('ms-description').value,licenseAccepted:true
        });
        message('Borrador guardado. Ahora puedes enviarlo a YouTube en privado.',false,true);
        await loadDrafts();
      }catch(e){message('No se pudo guardar: '+String(e.message||e),true);}
      finally{busy=false;$('ms-save').disabled=false;$('ms-progress').hidden=true;}
    });
    async function loadDrafts(){
      const area=$('ms-list');area.textContent='Cargando borradores...';
      try{
        const data=await json('/api/manual-shorts-drafts');
        const rows=data.drafts||[];
        area.replaceChildren();
        if(!rows.length){area.textContent='Todavía no tienes borradores manuales.';return;}
        for(const d of rows){
          const box=document.createElement('div');box.className='ms-item';
          const left=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');
          title.textContent=d.title;
          detail.textContent=(Number(d.size||0)/1048576).toFixed(1)+' MB · '+(d.status==='uploaded_private'?'YouTube privado':'Borrador')+' · '+new Date(d.createdAt).toLocaleString('es-ES');
          left.append(title,detail);box.append(left);
          const actions=document.createElement('div');actions.className='ms-actions';
          const preview=document.createElement('button');preview.textContent='▶ Ver';
          preview.onclick=()=>{
            if(url){URL.revokeObjectURL(url);url=null;}
            file=null;$('ms-preview').src='/api/manual-shorts-media?id='+encodeURIComponent(d.id);
            $('ms-title').value=d.title;$('ms-description').value=d.description||'';
            message('Previsualizando borrador: '+d.title);
            $('ms-preview').play().catch(()=>{});
            modal.scrollTo({top:0,behavior:'smooth'});
          };
          actions.append(preview);
          if(d.youtubeUrl){
            const link=document.createElement('a');link.href=d.youtubeUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir en YouTube';actions.append(link);
          }else{
            const send=document.createElement('button');send.textContent='↑ Enviar privado a YouTube';
            send.disabled=d.status==='uploading';
            send.onclick=async()=>{
              if(!confirm('¿Enviar este vídeo a YouTube como PRIVADO? No estará disponible públicamente.'))return;
              send.disabled=true;message('Enviando a YouTube en privado. Mantén abierta esta ventana...');
              try{
                const reply=await post('/api/manual-shorts-publish',{id:d.id});
                message('YouTube confirmó el vídeo privado: '+reply.url,false,true);
                await loadDrafts();
              }catch(e){message('Error de YouTube: '+String(e.message||e),true);await loadDrafts();}
            };
            actions.append(send);
          }
          box.append(actions);area.append(box);
        }
      }catch(e){area.textContent='No se pudieron cargar los borradores: '+String(e.message||e);}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();