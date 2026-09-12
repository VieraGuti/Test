const JOYSTICK_SIZE = 116;
const KNOB_SIZE = 46;

export class TouchControls {
  constructor(onShoot, settings = {}) {
    this.moveX = 0;
    this.moveY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.onShoot = onShoot;
    this.active = false;
    this.blocked = false;
    this.movePointer = null;
    this.lookPointer = null;
    this.settings = settings;

    this.container = document.createElement('div');
    this.container.id = 'touch-controls';
    this.container.innerHTML = `
      <div id="joystick-zone"><div id="joystick-base" data-hud-key="joystick"><div id="joystick-knob"></div></div></div>
      <div id="look-zone"></div>
      <button id="shoot-btn" data-hud-key="fire" aria-label="Fire"><span>FIRE</span></button>
    `;
    document.body.appendChild(this.container);

    const style = document.createElement('style');
    style.textContent = `
      #touch-controls{position:fixed;inset:0;pointer-events:none;z-index:110;display:none;touch-action:none;opacity:var(--vs-hud-opacity,.88)}
      #touch-controls.active{display:block}
      #joystick-zone{position:absolute;left:0;bottom:0;width:46%;height:64%;pointer-events:auto;touch-action:none}
      #joystick-base{position:fixed;width:${JOYSTICK_SIZE}px;height:${JOYSTICK_SIZE}px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.055),rgba(255,255,255,.10));border:1px solid rgba(255,255,255,.26);box-shadow:inset 0 0 0 1px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.16);backdrop-filter:blur(2px);pointer-events:none}
      #joystick-base::after{content:'';position:absolute;inset:18px;border-radius:50%;border:1px solid rgba(255,255,255,.10)}
      #joystick-knob{position:absolute;left:50%;top:50%;width:${KNOB_SIZE}px;height:${KNOB_SIZE}px;margin-left:-${KNOB_SIZE/2}px;margin-top:-${KNOB_SIZE/2}px;border-radius:50%;background:rgba(215,228,242,.38);border:1px solid rgba(255,255,255,.50);box-shadow:0 4px 12px rgba(0,0,0,.25)}
      #look-zone{position:absolute;right:0;top:0;width:64%;height:100%;pointer-events:auto;touch-action:none}
      #shoot-btn{position:fixed;width:76px;height:76px;border-radius:50%;background:radial-gradient(circle at 40% 32%,rgba(255,115,92,.86),rgba(166,38,34,.78));border:1px solid rgba(255,180,164,.8);box-shadow:0 8px 20px rgba(65,0,0,.28),inset 0 0 0 1px rgba(255,255,255,.08);color:white;font-size:13px;font-weight:900;letter-spacing:.12em;pointer-events:auto;touch-action:none;z-index:5;text-shadow:0 1px 2px rgba(0,0,0,.4)}
      #shoot-btn:active{transform:translate(-50%,-50%) scale(.91)!important;filter:brightness(1.14)}
      body.vs-ui-open #touch-controls{opacity:.28}
      body.vs-ui-open #touch-controls *{pointer-events:none!important}
    `;
    document.head.appendChild(style);
    this.styleEl = style;

    this.joystickZone = this.container.querySelector('#joystick-zone');
    this.joystickBase = this.container.querySelector('#joystick-base');
    this.joystickKnob = this.container.querySelector('#joystick-knob');
    this.lookZone = this.container.querySelector('#look-zone');
    this.shootBtn = this.container.querySelector('#shoot-btn');

    this._bindEvents();
  }

  setSettings(settings = {}) { this.settings = settings; }

  enable() {
    this.active = true;
    this.container.classList.add('active');
  }

  disable() {
    this.active = false;
    this.container.classList.remove('active');
    this.resetInputs();
  }

  setBlocked(blocked) {
    this.blocked = blocked;
    if (blocked) this.resetInputs();
  }

  resetInputs() {
    this.movePointer = null;
    this.lookPointer = null;
    this.moveX = 0;
    this.moveY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.joystickKnob.style.transform = 'translate(0px, 0px)';
  }

  _bindEvents() {
    this._moveDown = (e) => {
      if (!this.active || this.blocked || document.body.classList.contains('vs-hud-editing')) return;
      if (this.movePointer !== null) return;
      e.preventDefault();
      this.movePointer = e.pointerId;
      try { this.joystickZone.setPointerCapture(e.pointerId); } catch {}
      this._updateJoystick(e);
    };
    this._moveMove = (e) => {
      if (this.movePointer !== e.pointerId || this.blocked) return;
      e.preventDefault();
      this._updateJoystick(e);
    };
    this._moveUp = (e) => {
      if (this.movePointer !== e.pointerId) return;
      this.movePointer = null;
      this.moveX = 0;
      this.moveY = 0;
      this.joystickKnob.style.transform = 'translate(0px, 0px)';
    };
    this.joystickZone.addEventListener('pointerdown', this._moveDown, { passive: false });
    this.joystickZone.addEventListener('pointermove', this._moveMove, { passive: false });
    this.joystickZone.addEventListener('pointerup', this._moveUp, { passive: false });
    this.joystickZone.addEventListener('pointercancel', this._moveUp, { passive: false });

    this._lookDown = (e) => {
      if (!this.active || this.blocked || document.body.classList.contains('vs-hud-editing')) return;
      if (e.target.closest?.('#shoot-btn')) return;
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      this._lastLookX = e.clientX;
      this._lastLookY = e.clientY;
      try { this.lookZone.setPointerCapture(e.pointerId); } catch {}
    };
    this._lookMove = (e) => {
      if (this.lookPointer !== e.pointerId || this.blocked) return;
      e.preventDefault();
      this.lookDX += e.clientX - this._lastLookX;
      this.lookDY += e.clientY - this._lastLookY;
      this._lastLookX = e.clientX;
      this._lastLookY = e.clientY;
    };
    this._lookUp = (e) => {
      if (this.lookPointer !== e.pointerId) return;
      this.lookPointer = null;
    };
    this.lookZone.addEventListener('pointerdown', this._lookDown, { passive: false });
    this.lookZone.addEventListener('pointermove', this._lookMove, { passive: false });
    this.lookZone.addEventListener('pointerup', this._lookUp, { passive: false });
    this.lookZone.addEventListener('pointercancel', this._lookUp, { passive: false });

    this._fireDown = (e) => {
      if (!this.active || this.blocked || document.body.classList.contains('vs-hud-editing')) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.onShoot) this.onShoot();
    };
    this.shootBtn.addEventListener('pointerdown', this._fireDown, { passive: false });
  }

  _updateJoystick(e) {
    const rect = this.joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;
    const maxDist = JOYSTICK_SIZE / 2 - KNOB_SIZE / 4;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }
    this.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.moveX = dx / maxDist;
    this.moveY = -dy / maxDist;
  }

  consumeLook() {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  destroy() {
    this.container.remove();
    this.styleEl.remove();
  }
}

export function isMobile() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints || 0) > 1;
}
