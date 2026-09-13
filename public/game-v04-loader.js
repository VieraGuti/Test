(() => {
  // iPhone/Safari guard: keep the game locked to the visual viewport and
  // prevent Safari gesture/double-tap zoom from wrecking the HUD scale.
  const style = document.createElement('style');
  style.textContent = `
    html,body{width:100%;height:100%;min-width:100%;min-height:100%;overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important}
    body{position:fixed!important;inset:0!important;width:100vw!important;height:var(--vast-vvh,100dvh)!important;max-width:100vw!important;max-height:var(--vast-vvh,100dvh)!important}
    #game-root,#hud,.screen,.modal{max-width:100vw!important;max-height:var(--vast-vvh,100dvh)!important}
    #game-root,canvas{touch-action:none!important}
    #heli-nav{position:fixed;z-index:74;left:50%;top:46px;transform:translateX(-50%);display:none;align-items:center;gap:7px;padding:5px 9px;border:1px solid rgba(210,105,53,.38);border-radius:3px;background:rgba(7,9,8,.82);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);pointer-events:none;font:800 9px 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.08em;color:#eee;box-shadow:0 8px 24px rgba(0,0,0,.28)}
    #heli-nav.show{display:flex}
    #heli-nav-arrow{display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(208,107,49,.55);color:#e78a53;font-size:17px;line-height:1;transition:transform .18s linear}
    #heli-nav-copy{display:flex;flex-direction:column;line-height:1.05}
    #heli-nav-copy b{font-size:9px;color:#f1eee7}
    #heli-nav-copy small{margin-top:2px;font-size:6px;color:#a3a69f;letter-spacing:.09em}
    @media (orientation:landscape) and (max-height:520px){#heli-nav{top:43px;padding:4px 7px}#heli-nav-arrow{width:19px;height:19px;font-size:15px}#heli-nav-copy b{font-size:8px}#heli-nav-copy small{font-size:5.5px}}
    @media (orientation:landscape) and (max-height:390px){#heli-nav{top:39px}}
  `;
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

  // iOS Safari exposes pinch as gesture events. Blocking these does not block
  // the Pointer Events used by the joystick/fire/aim multi-touch controls.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((name) => {
    document.addEventListener(name, (e) => e.preventDefault(), { passive: false, capture: true });
  });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false, capture: true });

  // Helicopter crash navigator. The game persists the random crash position,
  // so the HUD can always guide mobile players instead of making them wander.
  const heli = document.createElement('div');
  heli.id = 'heli-nav';
  heli.innerHTML = '<span id="heli-nav-arrow">↑</span><span id="heli-nav-copy"><b>HELICÓPTERO</b><small id="heli-nav-distance">BUSCANDO HUMO…</small></span>';
  document.body.appendChild(heli);

  const wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  const updateHeliNav = () => {
    try {
      const save = JSON.parse(localStorage.getItem('vast_dead_zone_save_v4') || 'null');
      const event = save?.heliEvent;
      if (!event?.active || !Number.isFinite(event.x) || !Number.isFinite(event.z) || !save?.pos) {
        heli.classList.remove('show');
        return;
      }
      const dx = event.x - Number(save.pos.x || 0);
      const dz = event.z - Number(save.pos.z || 0);
      const distance = Math.round(Math.hypot(dx, dz));
      const targetAngle = Math.atan2(-dx, -dz);
      const relative = wrapAngle(targetAngle - Number(save.yaw || 0));
      const deg = relative * 180 / Math.PI;
      const arrow = document.getElementById('heli-nav-arrow');
      const label = document.getElementById('heli-nav-distance');
      if (arrow) arrow.style.transform = `rotate(${deg}deg)`;
      if (label) label.textContent = distance < 12 ? 'CARGAMENTO MUY CERCA' : `${distance} m · SIGUE EL HUMO`;
      heli.classList.add('show');
    } catch {
      heli.classList.remove('show');
    }
  };
  updateHeliNav();
  setInterval(updateHeliNav, 700);

  const paths = Array.from({ length: 9 }, (_, i) => `./v04/part-${String(i + 1).padStart(2, '0')}.txt?v=402`);

  Promise.all(paths.map(async (path) => {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo cargar ${path} (${response.status})`);
    return response.text();
  }))
    .then((parts) => {
      const source = parts.join('');
      const blob = new Blob([source], { type: 'text/javascript' });
      const moduleUrl = URL.createObjectURL(blob);
      return import(moduleUrl).finally(() => setTimeout(() => URL.revokeObjectURL(moduleUrl), 1500));
    })
    .catch((error) => {
      console.error('[VAST v0.4] Error de arranque', error);
      document.getElementById('loading')?.classList.add('hidden');
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:9999;inset:20%;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:#0b0d0c;border:1px solid #713f2b;color:#eee;font:600 14px system-ui';
      box.textContent = 'VAST no pudo cargar esta versión. Recarga la página para reintentar.';
      document.body.appendChild(box);
    });
})();
