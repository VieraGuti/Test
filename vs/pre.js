(() => {
  'use strict';

  const SETTINGS_KEY = 'vierastrike_csmobile_settings_v1';
  const HUD_KEY = 'vierastrike_csmobile_hud_v1';
  const MIGRATION_KEY = 'vierastrike_csmobile_cleanup_v2';

  // MutationObserver guard: the translation layer updates text nodes itself.
  // Deduplicate those updates so translations such as RECARGA -> RECARGAR do not
  // recursively become RECARGARRRRRR... while still allowing dynamic UI text.
  const NativeMutationObserver = window.MutationObserver;
  if (NativeMutationObserver) {
    window.MutationObserver = class VieraSafeMutationObserver extends NativeMutationObserver {
      constructor(callback) {
        const lastValue = new WeakMap();
        super((records, observer) => {
          const safe = [];
          const seenTextNodes = new WeakSet();
          for (const record of records) {
            if (record.type !== 'characterData') {
              safe.push(record);
              continue;
            }
            const target = record.target;
            if (seenTextNodes.has(target)) continue;
            seenTextNodes.add(target);
            const current = target.nodeValue;
            if (lastValue.get(target) === current) continue;
            safe.push(record);
          }
          if (!safe.length) return;
          callback(safe, observer);
          for (const record of safe) {
            if (record.type === 'characterData') lastValue.set(record.target, record.target.nodeValue);
          }
        });
      }
    };
  }

  // One-time cleanup of defaults from the first experimental HUD build.
  try {
    if (!localStorage.getItem(MIGRATION_KEY)) {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      settings.hudScale = 0.86;
      settings.hudOpacity = 0.92;
      settings.graphics = settings.graphics || 'medium';
      settings.brightness = 0.78;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      localStorage.removeItem(HUD_KEY);
      localStorage.setItem(MIGRATION_KEY, '1');
    }
  } catch (_) {}

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function writeSetting(key, value) {
    const current = readSettings();
    current[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  }

  function tuneScene() {
    const game = window.game;
    if (!game || !window.THREE) return;

    const brightness = Number(readSettings().brightness ?? 0.78);
    if (game.renderer) {
      if (THREE.ACESFilmicToneMapping != null) game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      game.renderer.toneMappingExposure = brightness;
    }

    if (game.scene) {
      if (game.scene.background?.isColor) game.scene.background.setHex(0x78b8d3);
      if (game.scene.fog?.color) game.scene.fog.color.setHex(0xc59669);
      game.scene.traverse(obj => {
        if (!obj?.isLight || obj.userData?.vsTunedLight) return;
        obj.userData.vsTunedLight = true;
        if (obj.isAmbientLight) obj.intensity *= 0.68;
        else if (obj.isDirectionalLight) obj.intensity *= 0.70;
        else if (obj.isHemisphereLight) obj.intensity *= 0.62;
      });
    }
  }

  function installBrightnessControl() {
    const extra = document.querySelector('.vs-extra-settings');
    if (!extra || document.getElementById('vs-scene-brightness')) return;
    const actions = extra.querySelector('.vs-settings-actions');
    const row = document.createElement('div');
    row.className = 'vs-settings-row';
    row.innerHTML = '<label>Brillo del mapa</label><div><input id="vs-scene-brightness" type="range" min="0.55" max="1.05" step="0.01"><span id="vs-scene-brightness-val"></span></div>';
    extra.insertBefore(row, actions || null);
    const input = row.querySelector('input');
    const value = row.querySelector('span');
    input.value = String(readSettings().brightness ?? 0.78);
    const apply = () => {
      const v = Number(input.value);
      value.textContent = ` ${Math.round(v * 100)}%`;
      if (window.game?.renderer) window.game.renderer.toneMappingExposure = v;
      writeSetting('brightness', v);
    };
    input.addEventListener('input', apply);
    apply();
  }

  function tidyCredit() {
    const credit = document.getElementById('vs-credit');
    const menu = document.querySelector('.main-menu-container');
    if (!credit || !menu) return;
    credit.textContent = 'VieraStrike · basado en CS:Mobile 3D de Alhysson · SFX adaptados de fatal-funnel-public';
    menu.appendChild(credit);
  }

  document.addEventListener('DOMContentLoaded', () => {
    tuneScene();
    requestAnimationFrame(tuneScene);
    setTimeout(() => {
      tuneScene();
      installBrightnessControl();
      tidyCredit();
    }, 0);
  });
})();
