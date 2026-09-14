(() => {
  const style = document.createElement('style');
  style.textContent = `html,body{width:100%;height:100%;min-width:100%;min-height:100%;overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important}body{position:fixed!important;inset:0!important;width:100vw!important;height:var(--vast-vvh,100dvh)!important;max-width:100vw!important;max-height:var(--vast-vvh,100dvh)!important}#game-root,#hud,.screen,.modal{max-width:100vw!important;max-height:var(--vast-vvh,100dvh)!important}#game-root,canvas{touch-action:none!important}`;
  document.head.appendChild(style);

  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover,interactive-widget=resizes-content');
  const syncViewport = () => {
    const h = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--vast-vvh', `${Math.round(h)}px`);
    window.scrollTo(0, 0);
  };
  syncViewport();
  window.addEventListener('resize', syncViewport, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(syncViewport, 80), { passive: true });
  window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((name) => document.addEventListener(name, (e) => e.preventDefault(), { passive: false, capture: true }));
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false, capture: true });

  const heli = document.createElement('div');
  heli.id = 'heli-nav';
  heli.innerHTML = '<span id="heli-nav-arrow">↑</span><span id="heli-nav-copy"><b>HELICÓPTERO CAÍDO</b><small id="heli-nav-distance">BUSCANDO HUMO…</small></span>';
  document.body.appendChild(heli);
  const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const updateHeliNav = () => {
    try {
      const save = JSON.parse(localStorage.getItem('vast_dead_zone_save_v4') || 'null');
      const event = save?.heliEvent;
      if (!event?.active || event.looted || !Number.isFinite(event.x) || !Number.isFinite(event.z) || !save?.pos) { heli.classList.remove('show'); return; }
      const dx = event.x - Number(save.pos.x || 0), dz = event.z - Number(save.pos.z || 0);
      const distance = Math.round(Math.hypot(dx, dz));
      const targetAngle = Math.atan2(-dx, -dz), relative = wrapAngle(targetAngle - Number(save.yaw || 0)), deg = relative * 180 / Math.PI;
      const arrow = document.getElementById('heli-nav-arrow'), label = document.getElementById('heli-nav-distance');
      if (arrow) arrow.style.transform = `rotate(${deg}deg)`;
      if (label) label.textContent = distance < 12 ? 'CARGAMENTO MUY CERCA' : `${distance} m · SIGUE EL HUMO`;
      heli.classList.add('show');
    } catch { heli.classList.remove('show'); }
  };
  updateHeliNav(); setInterval(updateHeliNav, 700);

  const partPaths = Array.from({ length: 9 }, (_, i) => `./v04/part-${String(i + 1).padStart(2, '0')}.txt?v=509`);
  const patchPaths = ['./v05/patch-01.txt?v=509','./v05/patch-02.txt?v=509','./v05/patch-03.txt?v=509','./v05/patch-04.txt?v=509','./v05/patch-05.txt?v=509','./v05/patch-06.txt?v=509','./v05/patch-07.txt?v=509','./v05/patch-08.txt?v=509','./v05/patch-09.txt?v=509','./v05/patch-10.txt?v=509','./v05/patch-11.txt?v=509','./v05/patch-12.txt?v=509'];
  const getText = async (path) => { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw new Error(`No se pudo cargar ${path} (${r.status})`); return r.text(); };
  const replaceRequired = (source, from, to, label) => {
    if (!source.includes(from)) { console.warn(`[VAST v0.5] No se aplicó parche: ${label}`); return source; }
    return source.replace(from, to);
  };

  Promise.all([Promise.all(partPaths.map(getText)), Promise.all(patchPaths.map(getText))])
    .then(([parts, patchParts]) => {
      const patch = patchParts.join('');
      let source = parts.join('');
      source = replaceRequired(source,
        "function updatePlayer(dt){const joy=touchMove;",
        "function updatePlayer(dt){if(isTouch)runHeld=Math.hypot(touchMove.x,touchMove.y)>.82;const joy=touchMove;",
        'sprint analógico');
      source = replaceRequired(source,
        "const sprint=(runHeld||keys.has('ShiftLeft'))&&f>.2&&player.stamina>1,speed=sprint?7.1:4.55;if(sprint)player.stamina=clamp(player.stamina-dt*18,0,100);else player.stamina=clamp(player.stamina+dt*11,0,100);",
        "const sprint=(runHeld||keys.has('ShiftLeft'))&&player.stamina>1,speed=sprint?7.1:4.55;if(sprint)player.stamina=clamp(player.stamina-dt*7.5,0,100);else player.stamina=clamp(player.stamina+dt*14,0,100);",
        'stamina prolongada');
      source = replaceRequired(source,
        "const fov=aimHeld?settings.fov-13:settings.fov;",
        "const fov=aimHeld?settings.fov-(player.attachments.reddot?7:5):settings.fov;",
        'ADS con menos zoom');
      source = replaceRequired(source,
        "weaponRig.position.y=lerp(weaponRig.position.y,-.19+(moving?Math.sin(runTime*8)*.008:0),clamp(dt*9,0,1));",
        "const adsX=aimHeld?0:.22,adsY=aimHeld?-.112:-.19+(moving?Math.sin(runTime*8)*.008:0),adsZ=aimHeld?-.54:-.42;weaponRig.position.x=lerp(weaponRig.position.x,adsX,clamp(dt*12,0,1));weaponRig.position.y=lerp(weaponRig.position.y,adsY,clamp(dt*12,0,1));weaponRig.position.z=lerp(weaponRig.position.z,adsZ,clamp(dt*12,0,1));document.body.classList.toggle('ads-active',aimHeld);",
        'alineación física de miras');
      source = replaceRequired(source,
        "bindHold($('aim-btn'),()=>aimHeld=true,()=>aimHeld=false);",
        "$('aim-btn').addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();AudioFX.resume();aimHeld=!aimHeld;$('aim-btn').classList.toggle('pressed',aimHeld)});",
        'mira toggle');
      source = replaceRequired(source,
        "toast(save?'VAST v0.4 · Partida restaurada':'VAST v0.4 · EQUÍPATE, FARMEA, CONSTRUYE');",
        "toast(save?'VAST v0.5.8 · Partida restaurada':'VAST v0.5.8 · FARMING PROCEDURAL + ADS COMPACTO');",
        'mensaje de versión');

      const startup = 'initThree();setupControls();setupMenus();setupProUI();updateAmmoUI();loop();';
      if (!source.includes(startup)) throw new Error('No se encontró el punto de arranque de v0.4');
      source = source.replace(startup, `${patch}\ninitThree();setupControls();setupMenus();setupProUI();setupV05();updateAmmoUI();loop();`);

      const blob = new Blob([source], { type: 'text/javascript' });
      const moduleUrl = URL.createObjectURL(blob);
      return import(moduleUrl).finally(() => setTimeout(() => URL.revokeObjectURL(moduleUrl), 1800));
    })
    .catch((error) => {
      console.error('[VAST v0.5.8] Error de arranque', error);
      document.getElementById('loading')?.classList.add('hidden');
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:9999;inset:18%;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:#0b0d0c;border:1px solid #713f2b;color:#eee;font:600 14px system-ui';
      box.textContent = 'VAST v0.5.8 no pudo cargar. Recarga la página para reintentar.';
      document.body.appendChild(box);
    });
})();
