(()=>{
  if(window.__autoShortsUI)return;window.__autoShortsUI=true;
  const $=id=>document.getElementById(id);
  const grid=$('auto-grid'),notice=$('notice'),stats=$('auto-stats');
  if(!grid||!notice||!stats)return;
  let rows=[],filter='all',busy=false;

  const date=s=>{
    const d=new Date(s||0);
    return Number.isFinite(d.valueOf())?d.toLocaleString('es-ES',{
      day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'
    }):'Fecha sin confirmar';
  };
  const escapeTitle=s=>String(s||'Short generado').trim().slice(0,130);
  function el(tag,className,text){
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function addAction(parent,label,url,className){
    if(!url)return;
    const a=el('a',className||'',label);
    a.href=url;a.target='_blank';a.rel='noopener noreferrer';
    parent.append(a);
  }
  function badge(item){
    if(item.videoId){
      const status=String(item.status||'').toLowerCase();
      if(status==='public'||status==='published')return 'PÚBLICO';
      if(status==='private'||status==='uploaded_private')return 'YOUTUBE · PRIVADO';
      if(status==='scheduled')return 'YOUTUBE · PROGRAMADO';
      return 'EN YOUTUBE';
    }
    if(item.previewAvailable)return 'MP4 · LISTO';
    if(item.status==='failed')return 'FALLIDO';
    if(item.status==='processing'||item.status==='working')return 'EDITANDO';
    return 'PENDIENTE DE SUBIDA';
  }
  function itemCard(item){
    const card=el('article','card');
    const frame=el('div','media'),body=el('div','cardbody');
    const poster=el('div','poster');
    const stamp=el('span','mp4tag',item.kind==='double'?'MONTAJE': 'SHORT');
    frame.append(poster,stamp);
    if(item.videoId){
      const img=el('img','');
      img.src='https://i.ytimg.com/vi/'+item.videoId+'/hqdefault.jpg';
      img.alt='';
      img.loading='lazy';
      img.onerror=()=>{img.remove();};
      poster.append(img);
    }
    if(item.previewAvailable){
      const button=el('button','play','▶');
      button.type='button';button.title='Reproducir MP4 original';button.setAttribute('aria-label','Reproducir '+escapeTitle(item.title));
      button.addEventListener('click',()=>{
        const video=el('video','');
        video.controls=true;video.playsInline=true;video.preload='metadata';
        video.src=item.previewUrl;
        video.addEventListener('error',()=>{
          if(!video.error)return;
          const note=el('small','meta','El MP4 dejó de estar disponible. Usa el enlace a YouTube si existe.');
          frame.append(note);
        },{once:true});
        frame.replaceChildren(video,stamp);
        video.play().catch(()=>{});
      });
      poster.append(button);
    }else if(!item.videoId){
      const icon=el('span','', '🎬');
      icon.style.fontSize='48px';poster.append(icon);
    }
    const label=el('span','tag',badge(item));
    const title=el('h3','',escapeTitle(item.title));
    const meta=el('p','meta',date(item.uploadedAt)+(item.creator?' · '+item.creator:''));
    const actions=el('div','actions');
    if(item.previewAvailable){
      const play=el('button','primary','▶ Ver MP4');
      play.type='button';play.addEventListener('click',()=>{
        const btn=frame.querySelector('.play');
        if(btn)btn.click();else frame.querySelector('video')?.play().catch(()=>{});
        frame.scrollIntoView({block:'nearest',behavior:'smooth'});
      });
      actions.append(play);
    }
    if(item.youtubeUrl)addAction(actions,'Abrir en YouTube',item.youtubeUrl,item.previewAvailable?'':'primary');
    if(item.youtubeStudioUrl)addAction(actions,'Gestionar',item.youtubeStudioUrl);
    if(!item.previewAvailable&&!item.videoId){
      const span=el('span','meta','Sin MP4 guardado todavía');actions.append(span);
    }
    body.append(label,title,meta,actions);card.append(frame,body);
    return card;
  }
  function stat(label,value){
    const n=el('div','stat');
    n.append(el('b','',String(value)),el('small','',label));
    return n;
  }
  function render(){
    const out=rows.filter(item=>{
      if(filter==='preview')return item.previewAvailable;
      if(filter==='youtube')return !!item.videoId;
      if(filter==='pending')return !item.videoId;
      return true;
    });
    grid.replaceChildren();
    if(!out.length){
      const empty=el('div','empty');
      empty.append(el('strong','','No hay Shorts en esta categoría.'),
        el('p','','Solo se muestran vídeos registrados realmente por nuestro motor. Prueba otro filtro o actualiza.'));
      grid.append(empty);
      return;
    }
    const frag=document.createDocumentFragment();
    for(const item of out)frag.append(itemCard(item));
    grid.append(frag);
  }
  async function refresh(){
    if(busy)return;
    busy=true;const refreshButton=$('refresh');refreshButton.disabled=true;
    notice.textContent='Consultando los Shorts generados y subidos...';
    try{
      const response=await fetch('/api/automatic-shorts-feed',{
        credentials:'same-origin',cache:'no-store'
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.detail||data.error||'HTTP '+response.status);
      rows=Array.isArray(data.items)?data.items:[];
      const summary=data.summary||{};
      stats.replaceChildren(
        stat('Subidos a YouTube',summary.youtubeVideos||0),
        stat('MP4 reproducibles',summary.previewVideos||0),
        stat('Sin vídeo de YouTube',summary.pending||0)
      );
      if(summary.listFailures){
        notice.textContent='Se han cargado los registros, pero parte del almacenamiento privado no se ha podido comprobar.';
      }else if(!summary.previewVideos&&summary.youtubeVideos){
        notice.textContent='Hay vídeos subidos a YouTube, pero no consta ningún MP4 original conservado para reproducir aquí. Puedes abrirlos desde las tarjetas.';
      }else{
        notice.textContent='Actualizado '+date(data.checkedAt)+' · '+rows.length+' vídeos encontrados · sin contenido simulado.';
      }
      render();
    }catch(error){
      notice.textContent='No se han podido consultar los vídeos: '+String(error?.message||error);
      stats.replaceChildren();
      grid.replaceChildren();
    }finally{busy=false;refreshButton.disabled=false;}
  }
  for(const button of document.querySelectorAll('[data-filter]')){
    button.addEventListener('click',()=>{
      filter=button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));
      render();
    });
  }
  $('refresh').addEventListener('click',refresh);
  refresh();
})();