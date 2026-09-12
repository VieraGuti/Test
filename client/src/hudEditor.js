const LIMITS = {
  joystick: { minX: 0.08, maxX: 0.40, minY: 0.58, maxY: 0.90 },
  fire: { minX: 0.58, maxX: 0.94, minY: 0.50, maxY: 0.90 },
  health: { minX: 0.08, maxX: 0.42, minY: 0.06, maxY: 0.32 }
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function applyHudLayout(layout = {}, globalScale = 1, opacity = 1) {
  document.documentElement.style.setProperty('--vs-hud-opacity', String(opacity));
  for (const el of document.querySelectorAll('[data-hud-key]')) {
    const key = el.dataset.hudKey;
    const item = layout[key];
    if (!item) continue;
    el.style.left = `${item.x * 100}%`;
    el.style.top = `${item.y * 100}%`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = `translate(-50%, -50%) scale(${(item.scale || 1) * globalScale})`;
    el.style.transformOrigin = 'center center';
  }
}

export class HudEditor {
  constructor({ settings, onChange, onClose }) {
    this.settings = settings;
    this.onChange = onChange;
    this.onClose = onClose;
    this.active = false;
    this.selectedKey = null;
    this.drag = null;
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('vs-hud-editing');
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'hud-editor-toolbar';
    this.toolbar.innerHTML = `
      <div class="hud-edit-title">EDIT HUD</div>
      <div class="hud-edit-sub">Toca un control · arrastra para mover</div>
      <button data-act="minus">−</button>
      <button data-act="plus">＋</button>
      <button data-act="reset">RESET</button>
      <button data-act="done" class="done">GUARDAR</button>
    `;
    document.body.appendChild(this.toolbar);

    const style = document.createElement('style');
    style.id = 'hud-editor-style';
    style.textContent = `
      body.vs-hud-editing [data-hud-key]{outline:2px solid rgba(72,183,255,.95)!important;outline-offset:5px;pointer-events:auto!important;touch-action:none!important;filter:drop-shadow(0 0 8px rgba(72,183,255,.35))}
      body.vs-hud-editing [data-hud-key].hud-selected{outline-color:#ffb65c!important;filter:drop-shadow(0 0 10px rgba(255,182,92,.45))}
      #hud-editor-toolbar{position:fixed;z-index:1000;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:grid;grid-template-columns:auto auto auto auto;gap:7px;align-items:center;padding:9px 10px;border-radius:14px;background:rgba(8,12,18,.94);border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 30px rgba(0,0,0,.4);color:#fff;backdrop-filter:blur(14px)}
      #hud-editor-toolbar .hud-edit-title{grid-column:1/3;font-weight:900;font-size:12px;letter-spacing:.13em}
      #hud-editor-toolbar .hud-edit-sub{grid-column:3/5;font-size:10px;color:#98a4b3;text-align:right}
      #hud-editor-toolbar button{height:31px;min-width:44px;padding:0 10px;border:1px solid rgba(255,255,255,.17);border-radius:9px;background:#161e29;color:#eaf1fa;font-weight:800;font-size:11px}
      #hud-editor-toolbar button.done{background:#17744f;border-color:#2eb87c}
    `;
    document.head.appendChild(style);

    document.addEventListener('pointerdown', this._onPointerDown, true);
    document.addEventListener('pointermove', this._onPointerMove, true);
    document.addEventListener('pointerup', this._onPointerUp, true);
    document.addEventListener('pointercancel', this._onPointerUp, true);

    this.toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.toolbar.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      if (act === 'done') this.stop(true);
      if (act === 'reset') {
        this.onChange?.('reset');
        this.settings = this.onChange?.('get') || this.settings;
        applyHudLayout(this.settings.hudLayout, this.settings.hudScale, this.settings.hudOpacity);
      }
      if ((act === 'minus' || act === 'plus') && this.selectedKey) {
        const item = this.settings.hudLayout[this.selectedKey];
        if (item) {
          item.scale = clamp((item.scale || 1) + (act === 'plus' ? 0.1 : -0.1), 0.6, 1.55);
          applyHudLayout(this.settings.hudLayout, this.settings.hudScale, this.settings.hudOpacity);
          this.onChange?.('layout', this.settings.hudLayout);
        }
      }
    });
  }

  _select(el) {
    for (const node of document.querySelectorAll('[data-hud-key]')) node.classList.remove('hud-selected');
    el.classList.add('hud-selected');
    this.selectedKey = el.dataset.hudKey;
  }

  _onPointerDown(e) {
    if (!this.active) return;
    const el = e.target.closest?.('[data-hud-key]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    this._select(el);
    this.drag = { id: e.pointerId, el, key: el.dataset.hudKey };
    try { el.setPointerCapture(e.pointerId); } catch {}
  }

  _onPointerMove(e) {
    if (!this.active || !this.drag || this.drag.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const key = this.drag.key;
    const limits = LIMITS[key] || { minX: 0.04, maxX: 0.96, minY: 0.05, maxY: 0.95 };
    const x = clamp(e.clientX / innerWidth, limits.minX, limits.maxX);
    const y = clamp(e.clientY / innerHeight, limits.minY, limits.maxY);
    const item = this.settings.hudLayout[key] || { x, y, scale: 1 };
    item.x = x; item.y = y;
    this.settings.hudLayout[key] = item;
    applyHudLayout(this.settings.hudLayout, this.settings.hudScale, this.settings.hudOpacity);
    this.onChange?.('layout', this.settings.hudLayout);
  }

  _onPointerUp(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    this.drag = null;
  }

  stop(save = true) {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('vs-hud-editing');
    for (const node of document.querySelectorAll('[data-hud-key]')) node.classList.remove('hud-selected');
    document.removeEventListener('pointerdown', this._onPointerDown, true);
    document.removeEventListener('pointermove', this._onPointerMove, true);
    document.removeEventListener('pointerup', this._onPointerUp, true);
    document.removeEventListener('pointercancel', this._onPointerUp, true);
    this.toolbar?.remove();
    document.getElementById('hud-editor-style')?.remove();
    if (save) this.onChange?.('save', this.settings.hudLayout);
    this.onClose?.();
  }
}
