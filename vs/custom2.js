(() => {
  'use strict';

  const SETTINGS_KEY = 'vierastrike_csmobile_settings_v2';
  const HUD_KEY = 'vierastrike_csmobile_hud_v2';

  const PAIRS = [
    ['TACTICAL FPS MULTIPLAYER & ONLINE ROOMS','FPS TÁCTICO MULTIJUGADOR · SALAS ONLINE'],
    ['Multiplayer WebRTC Pronto','Multijugador WebRTC listo'],
    ['JOGAR COM BOTS','JUGAR CON BOTS'],['CRIAR SALA / SERVER','CREAR SALA / SERVIDOR'],['ENTRAR EM SALA','ENTRAR EN SALA'],
    ['Dust II Clássico','Dust II clásico'],['Bombsite A, B, Túneis, Long, Portas Duplas','Bombsites A y B, Túneles, Long, Puertas dobles'],
    ['MODO DE JOGO:','MODO DE JUEGO:'],['Desarme de Bomba (5v5 Clássico)','Desactivación de bomba (5v5 clásico)'],
    ['Mata-Mata em Equipe (TDM Respawn)','Duelo por equipos (TDM con reaparición)'],['DIFICULDADE DOS BOTS:','DIFICULTAD DE LOS BOTS:'],
    ['Recruta (Fácil)','Recluta (Fácil)'],['Veterano (Médio)','Veterano (Medio)'],['Especialista (Difícil - Headshots precisos)','Especialista (Difícil - headshots precisos)'],
    ['QUANTIDADE DE BOTS:','CANTIDAD DE BOTS:'],['NOME DA SALA:','NOMBRE DE LA SALA:'],['LIMITE DE JOGADORES:','LÍMITE DE JUGADORES:'],
    ['Jogadores','Jugadores'],['Jogador','Jugador'],['Desarme de C4 (Defusal 5v5)','Desactivación de C4 (5v5)'],
    ['Team Deathmatch (Mata-Mata)','Duelo por equipos (TDM)'],['COMPLETAR SLOTS COM BOTS:','COMPLETAR HUECOS CON BOTS:'],
    ['Sim (Preencher vagas vazias)','Sí (rellenar huecos vacíos)'],['Não (Apenas humanos)','No (solo humanos)'],
    ['Seu código de sala gerado automaticamente será compartilhado para seus amigos entrarem instantaneamente!','Tu código de sala se genera automáticamente para compartirlo con tus amigos.'],
    ['CRIAR E ABRIR SALA','CREAR Y ABRIR SALA'],['ENTRAR POR CÓDIGO DA SALA','ENTRAR CON CÓDIGO DE SALA'],
    ['Cole ou digite o código de 6 dígitos gerado pelo criador da sala:','Pega o escribe el código generado por el creador de la sala:'],
    ['SALAS PÚBLICAS RECENTES','SALAS PÚBLICAS RECIENTES'],['Atualizar','Actualizar'],['Modo: Desarme','Modo: Desactivación'],['Mata-Mata Insano','TDM intenso'],
    ['Celular:','Móvil:'],['Analógico esquerdo para andar, toque na direita para mirar e botões táteis para atirar/pular/recarregar/comprar.','Joystick izquierdo para moverte, desliza a la derecha para apuntar y usa los botones táctiles para disparar, saltar, recargar y comprar.'],
    ['Olhar & Atirar','Mirar y disparar'],['Recarregar','Recargar'],['Espaço','Espacio'],['Pular','Saltar'],['Agachar','Agacharse'],
    ['Interagir / Desarmar','Interactuar / Desactivar'],['Placar','Marcador'],['SALA MULTIPLAYER','SALA MULTIJUGADOR'],['CÓDIGO DA SALA:','CÓDIGO DE SALA:'],
    ['COUNTER-TERRORISTS','ANTITERRORISTAS'],['TERRORISTS','TERRORISTAS'],['ENTRAR NO TIME CT','UNIRSE A CT'],['ENTRAR NO TIME TR','UNIRSE A TR'],
    ['Aguardando líder iniciar a partida...','Esperando a que el líder inicie la partida...'],['COMEÇAR PARTIDA AGORA','EMPEZAR PARTIDA AHORA'],
    ['CONFIGURAÇÕES & PAUSA','AJUSTES Y PAUSA'],['Sensibilidade de Mira (Touch & Mouse):','Sensibilidad de mira (táctil y ratón):'],
    ['Volume Geral de Efeitos e Vozes:','Volumen general de efectos y voces:'],['Campo de Visão (FOV):','Campo de visión (FOV):'],
    ['Sombras e Qualidade Gráfica:','Sombras y calidad gráfica:'],['Alta (Sombras Suaves & 60 FPS)','Alta (sombras suaves)'],
    ['Média (Bom desempenho mobile)','Media (buen rendimiento móvil)'],['Baixa (Máxima fluidez)','Baja (máxima fluidez)'],
    ['Cor da Mira (Crosshair):','Color de la mira:'],['Verde CS Clássico','Verde clásico'],['Ciano Tático','Cian táctico'],['Vermelho Neon','Rojo neón'],['Amarelo Vibrante','Amarillo'],['Branco Puro','Blanco'],
    ['CONTINUAR JOGO','CONTINUAR'],['SAIR PARA O MENU','SALIR AL MENÚ'],['ESCOLHA SEU LADO','ELIGE TU BANDO'],['Defina sua facção para entrar na batalha','Elige tu equipo para entrar en combate'],
    ['Defenda os Bombsites A e B, elimine os terroristas e desarme qualquer ameaça explosiva.','Defiende los bombsites A y B, elimina a los terroristas y desactiva la bomba.'],
    ['Invada as zonas de ataque, plante o explosivo C4 no local A ou B e proteja até a detonação.','Ataca los bombsites, planta la C4 en A o B y protégela hasta la detonación.'],
    ['JOGAR COMO CT','JUGAR COMO CT'],['JOGAR COMO TR','JUGAR COMO TR'],['ESCOLHA AUTOMÁTICA (EQUILIBRAR)','ELECCIÓN AUTOMÁTICA (EQUILIBRAR)'],
    ['NICKNAME:','NOMBRE:'],['Seu Nick...','Tu nombre...'],['COLETE','ARMADURA'],['GRANA','DINERO'],['TIRO','DISPARO'],['PULAR','SALTAR'],['AGACHA','AGACHAR'],['RECARGA','RECARGAR'],['DESARMAR','DESACTIVAR'],
    ['MENU DE COMPRAS TÁTICO','MENÚ DE COMPRA TÁCTICO'],['Saldo Disponível:','Saldo disponible:'],['Snipers','Francotiradores'],['Equipamentos','Equipamiento'],
    ['Toque ou clique no item para comprar. Atalho: Tecla [B] para abrir/fechar.','Toca o haz clic en un objeto para comprarlo. Atajo: [B].'],
    ['Dano','Daño'],['Kills','Bajas'],['Deaths','Muertes'],['BOMBA DESARMADA','BOMBA DESACTIVADA'],['TERRORISTAS PLANTARAM NO LOCAL','TERRORISTAS PLANTARON EN'],
    ['COUNTER-TERRORISTS VENCERAM','GANAN LOS ANTITERRORISTAS'],['TERRORISTAS VENCERAM','GANAN LOS TERRORISTAS'],['desarmou a C4','desactivó la C4'],['plantou a C4 no Bombsite','plantó la C4 en el bombsite'],
    ['Gerando sala P2P com servidores STUN...','Creando sala P2P con servidores STUN...'],['Sala aberta! Compartilhe o código acima para amigos entrarem.','¡Sala abierta! Comparte el código con tus amigos.'],['PRONTO','LISTO']
  ].sort((a,b)=>b[0].length-a[0].length);

  const translate = s => {
    if (typeof s !== 'string') return s;
    let out = s;
    for (const [a,b] of PAIRS) out = out.split(a).join(b);
    return out.replace(/Erro ao criar sala:/g,'Error al crear la sala:').replace(/Erro ao conectar à sala\.?/g,'Error al conectar con la sala.').replace(/Por favor digite o código da sala/g,'Escribe el código de la sala').replace(/Código (.+) copiado! Envie para seus amigos\./g,'¡Código $1 copiado! Envíalo a tus amigos.');
  };

  function translateTree(root=document.body) {
    if (!root) return;
    const one = n => {
      if (n.nodeType === Node.TEXT_NODE && n.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) {
        const v = translate(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
      }
    };
    if (root.nodeType === Node.TEXT_NODE) return one(root);
    const w = document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n;
    while((n=w.nextNode())) one(n);
    root.querySelectorAll?.('[placeholder],[title]').forEach(el=>{
      if(el.placeholder){const v=translate(el.placeholder);if(v!==el.placeholder)el.placeholder=v;}
      if(el.title){const v=translate(el.title);if(v!==el.title)el.title=v;}
    });
  }

  function setupSpanish() {
    document.documentElement.lang='es'; document.title='VieraStrike — FPS táctico móvil';
    const brand=document.querySelector('.brand-logo h1'); if(brand)brand.innerHTML='VIERA<span>STRIKE</span>';
    const room=document.getElementById('room-name-input'); if(room&&/BRASIL/i.test(room.value))room.value='VIERASTRIKE ESP';
    document.querySelectorAll('[data-code]').forEach(el=>el.dataset.code=String(el.dataset.code).replace(/CS-BR-/g,'VS-'));
    translateTree(document.body);
    new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(translateTree))).observe(document.body,{subtree:true,childList:true});
    setInterval(()=>translateTree(document.body),1800);
    const nativeAlert=window.alert.bind(window);window.alert=m=>nativeAlert(translate(String(m)));
  }

  const read=()=>{try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}catch{return{}}};
  const save=p=>{const s={...read(),...p};localStorage.setItem(SETTINGS_KEY,JSON.stringify(s));return s};
  const hudVisual=s=>{document.documentElement.style.setProperty('--vs-hud-opacity',String(s.hudOpacity??.92));document.documentElement.style.setProperty('--vs-btn-scale',String(s.hudScale??1));};
  function graphics(v){if(!window.game?.renderer)return;const r=window.game.renderer,ratio=v==='low'?.9:v==='medium'?1.15:1.5;r.setPixelRatio(Math.min(window.devicePixelRatio||1,ratio));r.shadowMap.enabled=v!=='low';r.setSize(innerWidth,innerHeight,false);}

  function setupSettings(){
    const body=document.querySelector('#settings-modal .settings-body');if(!body)return;
    const extra=document.createElement('div');extra.className='vs-extra-settings';extra.innerHTML='<div class="vs-settings-row"><label>Opacidad del HUD</label><div><input id="vs-hud-opacity" type="range" min="0.45" max="1" step="0.01"><span id="vs-hud-opacity-val"></span></div></div><div class="vs-settings-row"><label>Escala de botones/HUD</label><div><input id="vs-hud-scale" type="range" min="0.75" max="1.25" step="0.01"><span id="vs-hud-scale-val"></span></div></div><div class="vs-settings-actions"><button id="vs-edit-hud" class="tactical-btn primary-btn">EDITAR HUD</button><button id="vs-reset-settings" class="tactical-btn secondary-btn">RESTABLECER AJUSTES</button></div>';body.appendChild(extra);
    const s=read(),set=(id,v)=>{const e=document.getElementById(id);if(e&&v!=null){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}};
    set('setting-sens',s.sensitivity??1.8);set('setting-vol',s.volume??.8);set('setting-fov',s.fov??75);
    [['setting-sens','sensitivity'],['setting-vol','volume'],['setting-fov','fov']].forEach(([id,k])=>document.getElementById(id)?.addEventListener('input',e=>save({[k]:Number(e.target.value)})));
    const g=document.getElementById('setting-graphics');if(g){g.value=s.graphics||'high';graphics(g.value);g.addEventListener('change',()=>{graphics(g.value);save({graphics:g.value})})}
    const c=document.getElementById('setting-crosshair-color');if(c){c.value=s.crosshair||'#00ff66';document.documentElement.style.setProperty('--accent-green',c.value);c.addEventListener('change',()=>{document.documentElement.style.setProperty('--accent-green',c.value);save({crosshair:c.value})})}
    const op=document.getElementById('vs-hud-opacity'),sc=document.getElementById('vs-hud-scale');op.value=s.hudOpacity??.92;sc.value=s.hudScale??1;
    const render=()=>{const v={hudOpacity:Number(op.value),hudScale:Number(sc.value)};document.getElementById('vs-hud-opacity-val').textContent=` ${Math.round(v.hudOpacity*100)}%`;document.getElementById('vs-hud-scale-val').textContent=` ${Math.round(v.hudScale*100)}%`;hudVisual(v);save(v)};op.oninput=render;sc.oninput=render;render();
    document.getElementById('vs-edit-hud').onclick=startHudEditor;document.getElementById('vs-reset-settings').onclick=()=>{localStorage.removeItem(SETTINGS_KEY);localStorage.removeItem(HUD_KEY);location.reload()};
  }

  const EDIT={joystick:'#joystick-base',fire:'#btn-touch-fire',jump:'#btn-touch-jump',crouch:'#btn-touch-crouch',reload:'#btn-touch-reload',action:'#btn-touch-action',weapons:'#touch-weapon-slots',health:'#hud-bottom-left',ammo:'#hud-bottom-right',radar:'#hud-top-left',score:'#top-bar'};
  let layout={};try{layout=JSON.parse(localStorage.getItem(HUD_KEY)||'{}')}catch{}let selected=null,drag=null;
  const storeHud=()=>localStorage.setItem(HUD_KEY,JSON.stringify(layout));
  function pos(el,p){el.style.position='fixed';el.style.left=`${p.x*100}%`;el.style.top=`${p.y*100}%`;el.style.right='auto';el.style.bottom='auto';el.style.margin='0';el.style.transform=`translate(-50%,-50%) scale(${p.scale||1})`;el.style.zIndex='11020'}
  function mark(){Object.entries(EDIT).forEach(([k,s])=>{const e=document.querySelector(s);if(!e)return;e.dataset.vsEditable=k;if(layout[k])pos(e,layout[k])})}
  function startHudEditor(){document.getElementById('settings-modal')?.classList.add('hidden');window.isUIOpen=false;document.body.classList.add('vs-hud-editing');mark()}
  function stopHudEditor(){document.body.classList.remove('vs-hud-editing');document.querySelectorAll('[data-vs-selected]').forEach(e=>e.removeAttribute('data-vs-selected'));drag=null;storeHud()}
  function setupHud(){const b=document.createElement('div');b.id='vs-hud-toolbar';b.innerHTML='<span>EDITOR HUD</span><button id="vs-size-down">−</button><button id="vs-size-up">+</button><button id="vs-hud-reset">RESET</button><button id="vs-hud-done" class="primary">GUARDAR</button>';document.body.appendChild(b);mark();
    document.addEventListener('pointerdown',e=>{if(!document.body.classList.contains('vs-hud-editing')||e.target.closest('#vs-hud-toolbar'))return;const el=e.target.closest('[data-vs-editable]');if(!el)return;e.preventDefault();e.stopImmediatePropagation();document.querySelectorAll('[data-vs-selected]').forEach(x=>x.removeAttribute('data-vs-selected'));selected=el;el.dataset.vsSelected='1';const k=el.dataset.vsEditable,r=el.getBoundingClientRect();if(!layout[k])layout[k]={x:(r.left+r.width/2)/innerWidth,y:(r.top+r.height/2)/innerHeight,scale:1};pos(el,layout[k]);drag={el,k,id:e.pointerId};try{el.setPointerCapture(e.pointerId)}catch{}},true);
    document.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const p=layout[drag.k];p.x=Math.max(.03,Math.min(.97,e.clientX/innerWidth));p.y=Math.max(.04,Math.min(.96,e.clientY/innerHeight));pos(drag.el,p)},true);
    document.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();drag=null;storeHud()},true);
    const size=d=>{if(!selected)return;const k=selected.dataset.vsEditable,p=layout[k]||(layout[k]={x:.5,y:.5,scale:1});p.scale=Math.max(.6,Math.min(1.6,(p.scale||1)+d));pos(selected,p);storeHud()};
    document.getElementById('vs-size-down').onclick=()=>size(-.08);document.getElementById('vs-size-up').onclick=()=>size(.08);document.getElementById('vs-hud-reset').onclick=()=>{localStorage.removeItem(HUD_KEY);location.reload()};document.getElementById('vs-hud-done').onclick=stopHudEditor;
  }

  const URLS={ak:'/vs-sfx/rifle_762.mp3',m4:'/vs-sfx/suppressed.mp3',deagle:'/vs-sfx/pistol_9mm.mp3',awp:'/vs-sfx/rifle_762.mp3'},buffers={},loading={};
  async function load(name){if(buffers[name]||loading[name]||typeof audio==='undefined')return;loading[name]=1;try{audio.ensureContext();const r=await fetch(URLS[name]),a=await r.arrayBuffer();buffers[name]=await audio.ctx.decodeAudioData(a.slice(0))}catch(e){console.warn('SFX',name,e)}finally{loading[name]=0}}
  function shot(name,rate=1,gain=1){if(typeof audio==='undefined')return false;audio.ensureContext();if(!buffers[name]){load(name);return false}const s=audio.ctx.createBufferSource(),g=audio.ctx.createGain();s.buffer=buffers[name];s.playbackRate.value=rate;g.gain.value=gain;s.connect(g);g.connect(audio.masterGain);s.start();return true}
  function setupAudio(){if(typeof audio==='undefined')return;const ak=audio.playAK47.bind(audio),m4=audio.playM4A1.bind(audio),dg=audio.playDeagle.bind(audio),aw=audio.playAWP.bind(audio);audio.playAK47=()=>{if(!shot('ak',1,.95))ak()};audio.playM4A1=()=>{if(!shot('m4',1,1.05))m4()};audio.playDeagle=()=>{if(!shot('deagle',.82,1.22))dg()};audio.playAWP=()=>{if(shot('awp',.72,1.3))setTimeout(()=>audio.playBoltAction(),500);else aw()};
    audio.speakRadio=function(t){this.playRadioSquelch();if(!('speechSynthesis'in window))return;const M={'The bomb has been planted!':'¡La bomba ha sido plantada!','Bomb has been defused!':'¡Bomba desactivada!','Counter-Terrorists win!':'¡Ganan los antiterroristas!','Terrorists win!':'¡Ganan los terroristas!',"Let's move out!":'¡En marcha!','Fire in the hole!':'¡Granada!'};try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(M[t]||translate(t));u.rate=1.12;u.pitch=.92;u.volume=this.masterVolume;u.lang='es-ES';speechSynthesis.speak(u)}catch{}};
    const prime=()=>Object.keys(URLS).forEach(load);document.addEventListener('pointerdown',prime,{once:true,capture:true});document.addEventListener('keydown',prime,{once:true,capture:true});
  }

  function credit(){const e=document.createElement('div');e.id='vs-credit';e.textContent='VieraStrike · base CS:Mobile 3D por Alhysson · SFX CC0 Free Firearm Sound Library';document.body.appendChild(e)}
  document.addEventListener('DOMContentLoaded',()=>{setupSpanish();setupSettings();setupHud();setupAudio();credit()});
})();
