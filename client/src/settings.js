const STORAGE_KEY = 'vierastrike_fpsarena_settings_v1';

export const DEFAULT_SETTINGS = {
  sensitivity: 0.78,
  moveSpeed: 4.8,
  fov: 76,
  invertY: false,
  hudScale: 1,
  hudOpacity: 0.88,
  hudLayout: {
    joystick: { x: 0.135, y: 0.76, scale: 1 },
    fire: { x: 0.865, y: 0.76, scale: 0.92 },
    health: { x: 0.13, y: 0.105, scale: 1 }
  }
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v)));
}

export function sanitizeSettings(raw = {}) {
  const out = cloneDefaults();
  out.sensitivity = clamp(raw.sensitivity ?? out.sensitivity, 0.3, 1.8);
  out.moveSpeed = clamp(raw.moveSpeed ?? out.moveSpeed, 3.2, 6.2);
  out.fov = clamp(raw.fov ?? out.fov, 65, 95);
  out.invertY = Boolean(raw.invertY ?? out.invertY);
  out.hudScale = clamp(raw.hudScale ?? out.hudScale, 0.72, 1.3);
  out.hudOpacity = clamp(raw.hudOpacity ?? out.hudOpacity, 0.45, 1);

  const srcLayout = raw.hudLayout || {};
  for (const key of Object.keys(out.hudLayout)) {
    const src = srcLayout[key] || {};
    out.hudLayout[key] = {
      x: clamp(src.x ?? out.hudLayout[key].x, 0.03, 0.97),
      y: clamp(src.y ?? out.hudLayout[key].y, 0.03, 0.97),
      scale: clamp(src.scale ?? out.hudLayout[key].scale, 0.6, 1.55)
    };
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return sanitizeSettings(raw);
  } catch {
    return cloneDefaults();
  }
}

export function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function resetSettings() {
  const fresh = cloneDefaults();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}
