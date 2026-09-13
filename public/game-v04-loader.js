(() => {
  const paths = Array.from({ length: 9 }, (_, i) => `./v04/part-${String(i + 1).padStart(2, '0')}.txt?v=401`);

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
