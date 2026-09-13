(() => {
  'use strict';

  const SETTINGS_KEY = 'vierastrike_csmobile_settings_v1';
  const HUD_KEY = 'vierastrike_csmobile_hud_v1';

  const replacements = [
    ['TACTICAL FPS MULTIPLAYER & ONLINE ROOMS','FPS TÁCTICO MULTIJUGADOR · SALAS ONLINE'],
    ['Multiplayer WebRTC Pronto','Multijugador WebRTC listo'],
    ['JOGAR COM BOTS','JUGAR CON BOTS'],
    ['CRIAR SALA / SERVER','CREAR SALA / SERVIDOR'],
    ['ENTRAR EM SALA','ENTRAR EN SALA'],
    ['Dust II Clássico','Dust II clásico'],
    ['Bombsite A, B, Túneis, Long, Portas Duplas','Bombsites A y B, Túneles, Long, Puertas dobles'],
    ['MODO DE JOGO:','MODO DE JUEGO:'],
    ['Desarme de Bomba (5v5 Clássico)','Desactivación de bomba (5v5 clásico)'],
    ['Mata-Mata em Equipe (TDM Respawn)','Duelo por equipos (TDM con reaparición)'],
    ['DIFICULDADE DOS BOTS:','DIFICULTAD DE LOS BOTS:'],
    ['Recruta (Fácil)','Recluta (Fácil)'],
    ['Veterano (Médio)','Veterano (Medio)'],
    ['Especialista (Difícil - Headshots precisos)','Especialista (Difícil - headshots precisos)'],
    ['QUANTIDADE DE BOTS:','CANTIDAD DE BOTS:'],
    ['NOME DA SALA:','NOMBRE DE LA SALA:'],
    ['LIMITE DE JOGADORES:','LÍMITE DE JUGADORES:'],
    ['Jogadores','Jugadores'],
    ['Jogador','Jugador'],
    ['Desarme de C4 (Defusal 5v5)','Desactivación de C4 (5v5)'],
    ['Team Deathmatch (Mata-Mata)','Duelo por equipos (TDM)'],
    ['COMPLETAR SLOTS COM BOTS:','COMPLETAR HUECOS CON BOTS:'],
    ['Sim (Preencher vagas vazias)','Sí (rellenar huecos vacíos)'],
    ['Não (Apenas humanos)','No (solo humanos)'],
    ['Seu código de sala gerado automaticamente será compartilhado para seus amigos entrarem instantaneamente!','Tu código de sala se genera automáticamente para compartirlo con tus amigos.'],
    ['CRIAR E ABRIR SALA','CREAR Y ABRIR SALA'],
    ['ENTRAR POR CÓDIGO DA SALA','ENTRAR CON CÓDIGO DE SALA'],
    ['Cole ou digite o código de 6 dígitos gerado pelo criador da sala:','Pega o escribe el código generado por el creador de la sala:'],
    ['SALAS PÚBLICAS RECENTES','SALAS PÚBLICAS RECIENTES'],
    ['Atualizar','Actualizar'],
    ['Modo: Desarme','Modo: Desactivación'],
    ['Mata-Mata Insano','TDM intenso'],
    ['Celular:','Móvil:'],
    ['Analógico esquerdo para andar, toque na direita para mirar e botões táteis para atirar/pular/recarregar/comprar.','Joystick izquierdo para moverte, desliza a la derecha para apuntar y usa los botones táctiles para disparar, saltar, recargar y comprar.'],
    ['Olhar & Atirar','Mirar y disparar'],
    ['Recarregar','Recargar'],
    ['Espaço','Espacio'],
    ['Pular','Saltar'],
    ['Agachar','Agacharse'],
    ['Interagir / Desarmar','Interactuar / Desactivar'],
    ['Placar','Marcador'],
    ['SALA MULTIPLAYER','SALA MULTIJUGADOR'],
    ['CÓDIGO DA SALA:','CÓDIGO DE SALA:'],
    ['COUNTER-TERRORISTS','ANTITERRORISTAS'],
    ['TERRORISTS','TERRORISTAS'],
    ['ENTRAR NO TIME CT','UNIRSE A CT'],
    ['ENTRAR NO TIME TR','UNIRSE A TR'],
    ['Aguardando líder iniciar a partida...','Esperando a que el líder inicie la partida...'],
    ['COMEÇAR PARTIDA AGORA','EMPEZAR PARTIDA AHORA'],
    ['CONFIGURAÇÕES & PAUSA','AJUSTES Y PAUSA'],
    ['Sensibilidade de Mira (Touch & Mouse):','Sensibilidad de mira (táctil y ratón):'],
    ['Volume Geral de Efeitos e Vozes:','Volumen general de efectos y voces:'],
    ['Campo de Visão (FOV):','Campo de visión (FOV):'],
    ['Sombras e Qualidade Gráfica:','Sombras y calidad gráfica:'],
    ['Alta (Sombras Suaves & 60 FPS)','Alta (sombras suaves)'],
    ['Média (Bom desempenho mobile)','Media (buen rendimiento móvil)'],
    ['Baixa (Máxima fluidez)','Baja (máxima fluidez)'],
    ['Cor da Mira (Crosshair):','Color de la mira:'],
    ['Verde CS Clássico','Verde clásico'],
    ['Ciano Tático','Cian táctico'],
    ['Vermelho Neon','Rojo neón'],
    ['Amarelo Vibrante','Amarillo'],
    ['Branco Puro','Blanco'],
    ['CONTINUAR JOGO','CONTINUAR'],
    ['SAIR PARA O MENU','SALIR AL MENÚ'],
    ['ESCOLHA SEU LADO','ELIGE TU BANDO'],
    ['Defina sua facção para entrar na batalha','Elige tu equipo para entrar en combate'],
    ['Defenda os Bombsites A e B, elimine os terroristas e desarme qualquer ameaça explosiva.','Defiende los bombsites A y B, elimina a los terroristas y desactiva la bomba.'],
    ['Invada as zonas de ataque, plante o explosivo C4 no local A ou B e proteja até a detonação.','Ataca los bombsites, planta la C4 en A o B y protégela hasta la detonación.'],
    ['JOGAR COMO CT','JUGAR COMO CT'],
    ['JOGAR COMO TR','JUGAR COMO TR'],
    ['ESCOLHA AUTOMÁTICA (EQUILIBRAR)','ELECCIÓN AUTOMÁTICA (EQUILIBRAR)'],
    ['NICKNAME:','NOMBRE:'],
    ['Seu Nick...','Tu nombre...'],
    ['COLETE','ARMADURA'],
    ['GRANA','DINERO'],
    ['TIRO','DISPARO'],
    ['PULAR','SALTAR'],
    ['AGACHA','AGACHAR'],
    ['RECARGA','RECARGAR'],
    ['DESARMAR','DESACTIVAR'],
    ['MENU DE COMPRAS TÁTICO','MENÚ DE COMPRA TÁCTICO'],
    ['Saldo Disponível:','Saldo disponible:'],
    ['Snipers','Francotiradores'],
    ['Equipamentos','Equipamiento'],
    ['Toque ou clique no item para comprar. Atalho: Tecla [B] para abrir/fechar.','Toca o haz clic en un objeto para comprarlo. Atajo: [B].'],
    ['Dano','Daño'],
    ['Kills','Bajas'],
    ['Deaths','Muertes'],
    ['BOMBA DESARMADA','BOMBA DESACTIVADA'],
    ['TERRORISTAS PLANTARAM NO LOCAL','TERRORISTAS PLANTARON EN'],
    ['COUNTER-TERRORISTS VENCERAM','GANAN LOS ANTITERRORISTAS'],
    ['TERRORISTAS VENCERAM','GANAN LOS TERRORISTAS'],
    ['desarmou a C4','desactivó la C4'],
    ['plantou a C4 no Bombsite','plantó la C4 en el bombsite'],
    ['Gerando sala P2P com servidores STUN...','Creando sala P2P con servidores STUN...'],
    ['Sala aberta! Compartilhe o código acima para amigos entrarem.','¡Sala abierta! Comparte el código con tus amigos.'],
    ['PRONTO','LISTO']
  ].sort((a,b) => b[0].length - a[0].length);

  function tr(value) {
    if (typeof value !== 'string') return value;
    let out = value;
    for (const [a,b] of replacements) out = out.split(a).join(b);
    return out
      .replace(/Erro ao criar sala:/g,'Error al crear la sala:')
      .replace(/Erro ao conectar à sala\.?/g,'Error al conectar con la sala.')
      .replace(/Por favor digite o código da sala/g,'Escribe el código de la sala')
      .replace(/Código (.+) copiado! Envie para seus amigos\./g,'¡Código $1 copiado! Envíalo a tus amigos.');
  }

  function translateNode(root = document.body) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(root.parentElement.tagName)) root.nodeValue = tr(root.nodeValue);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document.body) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) n.nodeValue = tr(n.nodeValue);
    }
    if (root.querySelectorAll) root.querySelectorAll('[placeholder],[title]').forEach(el => {
      if (el.placeholder) el.placeholder = tr(el.placeholder);
      if (el.title) el.title = tr(el.title);
    });
  }

  function setupSpanish() {
    document.documentElement.lang = 'es';
    document.title = 'VieraStrike — FPS táctico móvil';
    const brand = document.querySelector('.brand-logo h1');
    if (brand) brand.innerHTML = 'VIERA<span>STRIKE</span>';
    const room = document.getElementById('room-name-input');
    if (room && /BRASIL/i.test(room.value)) room.value = 'VIERASTRIKE ESP';
    document.querySelectorAll('[data-code]').forEach(el => { el.dataset.code = String(el.dataset.code).replace(/CS-BR-/g,'VS-'); });
    translateNode(document.body);
    const observer = new MutationObserver(muts => muts.forEach(m => {
      if (m.type === 'characterData') m.target.nodeValue = tr(m.target.nodeValue);
      m.addedNodes.forEach(translateNode);
    }));
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    const nativeAlert = window.alert.bind(window);
    window.alert = msg => nativeAlert(tr(String(msg)));
  }

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSettings(patch) {
    const s = {...readSettings(), ...patch};
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return s;
  }

  function applyGraphics(value) {
    if (!window.game?.renderer) return;
    const r = window.game.renderer;
    const ratio = value === 'low' ? 0.9 : value === 'medium' ? 1.15 : 1.5;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    r.shadowMap.enabled = value !== 'low';
    r.setSize(window.innerWidth, window.innerHeight, false);
  }

  function applyHudVisuals(s) {
    document.documentElement.style.setProperty('--vs-hud-opacity', String(s.hudOpacity ?? .92));
    document.documentElement.style.setProperty('--vs-btn-scale', String(s.hudScale ?? 1));
  }

  function setupSettings() {
    const body = document.querySelector('#settings-modal .settings-body');
    if (!body) return;

    const extra = document.createElement('div');
    extra.className = 'vs-extra-settings';
    extra.innerHTML = `
      <div class="vs-settings-row"><label>Opacidad del HUD</label><div><input id="vs-hud-opacity" type="range" min="0.45" max="1" step="0.01"><span id="vs-hud-opacity-val"></span></div></div>
      <div class="vs-settings-row"><label>Escala de botones/HUD</label><div><input id="vs-hud-scale" type="range" min="0.75" max="1.25" step="0.01"><span id="vs-hud-scale-val"></span></div></div>
      <div class="vs-settings-actions"><button id="vs-edit-hud" class="tactical-btn primary-btn">EDITAR HUD</button><button id="vs-reset-settings" class="tactical-btn secondary-btn">RESTABLECER AJUSTES</button></div>
    `;
    body.appendChild(extra);

    const s = readSettings();
    const setInput = (id,val) => {
      const el = document.getElementById(id);
      if (el && val != null) { el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); }
    };
    setInput('setting-sens', s.sensitivity ?? 1.8);
    setInput('setting-vol', s.volume ?? .8);
    setInput('setting-fov', s.fov ?? 75);

    const graphics = document.getElementById('setting-graphics');
    if (graphics) {
      graphics.value = s.graphics || 'high';
      applyGraphics(graphics.value);
      graphics.addEventListener('change', () => { applyGraphics(graphics.value); saveSettings({graphics:graphics.value}); });
    }

    const cross = document.getElementById('setting-crosshair-color');
    if (cross) {
      cross.value = s.crosshair || '#00ff66';
      document.documentElement.style.setProperty('--accent-green', cross.value);
      cross.addEventListener('change', () => { document.documentElement.style.setProperty('--accent-green', cross.value); saveSettings({crosshair:cross.value}); });
    }

    [['setting-sens','sensitivity'],['setting-vol','volume'],['setting-fov','fov']].forEach(([id,key]) => {
      document.getElementById(id)?.addEventListener('input', e => saveSettings({[key]:Number(e.target.value)}));
    });

    const op = document.getElementById('vs-hud-opacity');
    const sc = document.getElementById('vs-hud-scale');
    op.value = s.hudOpacity ?? .92;
    sc.value = s.hudScale ?? 1;
    const render = () => {
      const v = {hudOpacity:Number(op.value), hudScale:Number(sc.value)};
      document.getElementById('vs-hud-opacity-val').textContent = ` ${Math.round(v.hudOpacity*100)}%`;
      document.getElementById('vs-hud-scale-val').textContent = ` ${Math.round(v.hudScale*100)}%`;
      applyHudVisuals(v);
      saveSettings(v);
    };
    op.addEventListener('input', render);
    sc.addEventListener('input', render);
    render();

    document.getElementById('vs-edit-hud').addEventListener('click', startHudEditor);
    document.getElementById('vs-reset-settings').addEventListener('click', () => {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(HUD_KEY);
      location.reload();
    });
  }

  const editable = {
    joystick:'#joystick-base', fire:'#btn-touch-fire', jump:'#btn-touch-jump', crouch:'#btn-touch-crouch',
    reload:'#btn-touch-reload', action:'#btn-touch-action', weapons:'#touch-weapon-slots',
    health:'#hud-bottom-left', ammo:'#hud-bottom-right', radar:'#hud-top-left', score:'#top-bar'
  };

  let hudLayout = {};
  try { hudLayout = JSON.parse(localStorage.getItem(HUD_KEY) || '{}'); } catch {}
  let selected = null;
  let dragging = null;

  function positionEl(el,p) {
    el.style.position = 'fixed';
    el.style.left = `${p.x*100}%`;
    el.style.top = `${p.y*100}%`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
    el.style.transform = `translate(-50%,-50%) scale(${p.scale || 1})`;
    el.style.zIndex = '11020';
  }

  function applySavedHud() {
    Object.entries(editable).forEach(([key,sel]) => {
      const el = document.querySelector(sel);
      const p = hudLayout[key];
      if (!el) return;
      el.dataset.vsEditable = key;
      if (p) positionEl(el,p);
    });
  }

  function saveHud() { localStorage.setItem(HUD_KEY, JSON.stringify(hudLayout)); }
  function startHudEditor() {
    document.getElementById('settings-modal')?.classList.add('hidden');
    window.isUIOpen = false;
    document.body.classList.add('vs-hud-editing');
    applySavedHud();
  }
  function stopHudEditor() {
    document.body.classList.remove('vs-hud-editing');
    document.querySelectorAll('[data-vs-selected]').forEach(e => e.removeAttribute('data-vs-selected'));
    dragging = null;
    saveHud();
  }
  function selectEl(el) {
    document.querySelectorAll('[data-vs-selected]').forEach(e => e.removeAttribute('data-vs-selected'));
    selected = el;
    el.setAttribute('data-vs-selected','1');
  }

  function setupHudEditor() {
    const bar = document.createElement('div');
    bar.id = 'vs-hud-toolbar';
    bar.innerHTML = '<span>EDITOR HUD</span><button id="vs-size-down">−</button><button id="vs-size-up">+</button><button id="vs-hud-reset">RESET</button><button id="vs-hud-done" class="primary">GUARDAR</button>';
    document.body.appendChild(bar);
    applySavedHud();

    document.addEventListener('pointerdown', e => {
      if (!document.body.classList.contains('vs-hud-editing') || e.target.closest('#vs-hud-toolbar')) return;
      const el = e.target.closest('[data-vs-editable]');
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      selectEl(el);
      const key = el.dataset.vsEditable;
      const rect = el.getBoundingClientRect();
      if (!hudLayout[key]) hudLayout[key] = {x:(rect.left+rect.width/2)/innerWidth, y:(rect.top+rect.height/2)/innerHeight, scale:1};
      positionEl(el,hudLayout[key]);
      dragging = {el,key,pid:e.pointerId};
      try { el.setPointerCapture(e.pointerId); } catch {}
    }, true);

    document.addEventListener('pointermove', e => {
      if (!dragging || dragging.pid !== e.pointerId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const p = hudLayout[dragging.key];
      p.x = Math.max(.03,Math.min(.97,e.clientX/innerWidth));
      p.y = Math.max(.04,Math.min(.96,e.clientY/innerHeight));
      positionEl(dragging.el,p);
    }, true);

    document.addEventListener('pointerup', e => {
      if (!dragging || dragging.pid !== e.pointerId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dragging = null;
      saveHud();
    }, true);

    const resize = d => {
      if (!selected) return;
      const key = selected.dataset.vsEditable;
      const p = hudLayout[key] || (hudLayout[key] = {x:.5,y:.5,scale:1});
      p.scale = Math.max(.6,Math.min(1.6,(p.scale || 1)+d));
      positionEl(selected,p);
      saveHud();
    };
    document.getElementById('vs-size-down').onclick = () => resize(-.08);
    document.getElementById('vs-size-up').onclick = () => resize(.08);
    document.getElementById('vs-hud-reset').onclick = () => { localStorage.removeItem(HUD_KEY); location.reload(); };
    document.getElementById('vs-hud-done').onclick = stopHudEditor;
  }

  const samples = {
    ak:'/vs-sfx/rifle_762.mp3',
    m4:'/vs-sfx/suppressed.mp3',
    deagle:'/vs-sfx/pistol_9mm.mp3',
    awp:'/vs-sfx/rifle_762.mp3'
  };
  const buffers = {};
  const loading = {};

  async function loadSample(name) {
    if (buffers[name] || loading[name] || typeof audio === 'undefined') return;
    loading[name] = true;
    try {
      audio.ensureContext();
      const res = await fetch(samples[name]);
      const arr = await res.arrayBuffer();
      buffers[name] = await audio.ctx.decodeAudioData(arr.slice(0));
    } catch (e) {
      console.warn('VieraStrike SFX', name, e);
    } finally {
      loading[name] = false;
    }
  }

  function playSample(name,rate=1,gain=1) {
    if (typeof audio === 'undefined') return false;
    audio.ensureContext();
    if (!buffers[name]) { loadSample(name); return false; }
    const src = audio.ctx.createBufferSource();
    const g = audio.ctx.createGain();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    g.gain.value = gain;
    src.connect(g);
    g.connect(audio.masterGain);
    src.start();
    return true;
  }

  function setupAudio() {
    if (typeof audio === 'undefined') return;
    const oldAK = audio.playAK47.bind(audio);
    const oldM4 = audio.playM4A1.bind(audio);
    const oldD = audio.playDeagle.bind(audio);
    const oldA = audio.playAWP.bind(audio);

    audio.playAK47 = () => { if (!playSample('ak',1,.95)) oldAK(); };
    audio.playM4A1 = () => { if (!playSample('m4',1,1.05)) oldM4(); };
    audio.playDeagle = () => { if (!playSample('deagle',.82,1.22)) oldD(); };
    audio.playAWP = () => {
      if (playSample('awp',.72,1.3)) setTimeout(() => audio.playBoltAction(),500);
      else oldA();
    };

    audio.speakRadio = function(text) {
      this.playRadioSquelch();
      if (!('speechSynthesis' in window)) return;
      try {
        speechSynthesis.cancel();
        const map = {
          'The bomb has been planted!':'¡La bomba ha sido plantada!',
          'Bomb has been defused!':'¡Bomba desactivada!',
          'Counter-Terrorists win!':'¡Ganan los antiterroristas!',
          'Terrorists win!':'¡Ganan los terroristas!',
          "Let's move out!":'¡En marcha!',
          'Fire in the hole!':'¡Granada!'
        };
        const u = new SpeechSynthesisUtterance(map[text] || tr(text));
        u.rate = 1.12;
        u.pitch = .92;
        u.volume = this.masterVolume;
        u.lang = 'es-ES';
        speechSynthesis.speak(u);
      } catch (e) { console.warn(e); }
    };

    const prime = () => Object.keys(samples).forEach(loadSample);
    document.addEventListener('pointerdown', prime, {once:true,capture:true});
    document.addEventListener('keydown', prime, {once:true,capture:true});
  }

  function addCredit() {
    const el = document.createElement('div');
    el.id = 'vs-credit';
    el.textContent = 'VieraStrike · base CS:Mobile 3D por Alhysson · SFX CC0 Free Firearm Sound Library';
    document.body.appendChild(el);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupSpanish();
    setupSettings();
    setupHudEditor();
    setupAudio();
    addCredit();
  });
})();
