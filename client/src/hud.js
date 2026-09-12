export class HUD {
  constructor(settings = {}) {
    this.settings = settings;
    this.container = document.createElement('div');
    this.container.id = 'hud';
    this.container.innerHTML = `
      <div id="crosshair" aria-hidden="true">
        <div class="ch ch-l"></div><div class="ch ch-r"></div><div class="ch ch-t"></div><div class="ch ch-b"></div><div class="ch-dot"></div>
      </div>
      <div id="health-card" data-hud-key="health">
        <div class="health-label">HP</div>
        <div id="health-text">100</div>
        <div class="health-track"><div id="health-fill"></div></div>
      </div>
      <div id="kill-feed"></div>
      <div id="hit-marker" style="display:none;"><div class="hm hm-1"></div><div class="hm hm-2"></div><div class="hm hm-3"></div><div class="hm hm-4"></div></div>
      <div id="damage-overlay" style="display:none;"></div>
    `;
    document.body.appendChild(this.container);

    const style = document.createElement('style');
    style.textContent = `
      #hud{position:fixed;inset:0;pointer-events:none;z-index:100;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;opacity:var(--vs-hud-opacity,.88)}
      #crosshair{position:absolute;top:50%;left:50%;width:26px;height:26px;transform:translate(-50%,-50%);filter:drop-shadow(0 1px 1px rgba(0,0,0,.7))}
      .ch{position:absolute;background:rgba(245,249,255,.92);border-radius:2px}.ch-l,.ch-r{width:7px;height:1.5px;top:12.25px}.ch-l{left:1px}.ch-r{right:1px}.ch-t,.ch-b{width:1.5px;height:7px;left:12.25px}.ch-t{top:1px}.ch-b{bottom:1px}.ch-dot{position:absolute;width:2.5px;height:2.5px;left:11.75px;top:11.75px;border-radius:50%;background:#fff}
      #health-card{position:fixed;width:118px;min-height:48px;padding:8px 10px 9px;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:linear-gradient(180deg,rgba(12,17,24,.78),rgba(9,13,18,.64));box-shadow:0 8px 24px rgba(0,0,0,.18);backdrop-filter:blur(8px);color:white}
      .health-label{font-size:9px;font-weight:900;letter-spacing:.16em;color:#8793a3;line-height:1}
      #health-text{font-size:22px;font-weight:900;line-height:1.05;margin-top:3px;letter-spacing:-.02em}
      .health-track{height:3px;margin-top:6px;border-radius:4px;background:rgba(255,255,255,.10);overflow:hidden}
      #health-fill{width:100%;height:100%;border-radius:4px;background:#4fda8b;transition:width .18s ease,background .18s ease}
      #kill-feed{position:absolute;top:max(18px,env(safe-area-inset-top));right:max(18px,env(safe-area-inset-right));text-align:right}.kill-msg{color:white;font-size:13px;font-weight:800;text-shadow:0 2px 5px #000;padding:4px 7px;margin-bottom:3px;animation:fadeOut 3s forwards}@keyframes fadeOut{0%{opacity:1}70%{opacity:1}100%{opacity:0}}
      #hit-marker{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.hm{position:absolute;width:11px;height:1.5px;background:white}.hm-1{transform:translate(-13px,-13px) rotate(45deg)}.hm-2{transform:translate(5px,-13px) rotate(-45deg)}.hm-3{transform:translate(-13px,5px) rotate(-45deg)}.hm-4{transform:translate(5px,5px) rotate(45deg)}
      #damage-overlay{position:fixed;inset:0;background:radial-gradient(ellipse at center,transparent 54%,rgba(210,28,28,.45) 100%);pointer-events:none}
      body.vs-ui-open #hud{opacity:.3}
    `;
    document.head.appendChild(style);
    this.styleEl = style;

    this.healthFill = this.container.querySelector('#health-fill');
    this.healthText = this.container.querySelector('#health-text');
    this.killFeed = this.container.querySelector('#kill-feed');
    this.hitMarker = this.container.querySelector('#hit-marker');
    this.damageOverlay = this.container.querySelector('#damage-overlay');
  }

  setSettings(settings = {}) {
    this.settings = settings;
  }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, Math.round(hp)));
    this.healthFill.style.width = pct + '%';
    this.healthText.textContent = pct;
    if (pct > 60) this.healthFill.style.background = '#4fda8b';
    else if (pct > 30) this.healthFill.style.background = '#e8bf52';
    else this.healthFill.style.background = '#ee5e59';
  }

  showHitMarker() {
    this.hitMarker.style.display = 'block';
    setTimeout(() => { this.hitMarker.style.display = 'none'; }, 140);
  }

  showDamage() {
    this.damageOverlay.style.display = 'block';
    setTimeout(() => { this.damageOverlay.style.display = 'none'; }, 220);
  }

  addKillMessage(msg) {
    const div = document.createElement('div');
    div.className = 'kill-msg';
    div.textContent = msg;
    this.killFeed.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }

  destroy() {
    this.container.remove();
    this.styleEl.remove();
  }
}
