const JOYSTICK_SIZE = 120;
const KNOB_SIZE = 50;
const TOUCH_SENSITIVITY = 0.012;

export class TouchControls {
  constructor(onShoot) {
    this.moveX = 0;
    this.moveY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.onShoot = onShoot;
    this.active = false;
    this.moveTouch = null;
    this.lookTouch = null;

    this.container = document.createElement('div');
    this.container.id = 'touch-controls';
    this.container.innerHTML = `
      <div id="joystick-zone"><div id="joystick-base"><div id="joystick-knob"></div></div></div>
      <div id="look-zone"></div>
      <button id="shoot-btn">FIRE</button>
    `;
    document.body.appendChild(this.container);

    const style = document.createElement('style');
    style.textContent = `
      #touch-controls{position:fixed;inset:0;pointer-events:none;z-index:110;display:none;touch-action:none}
      #touch-controls.active{display:block}
      #joystick-zone{position:absolute;left:0;bottom:0;width:42%;height:58%;pointer-events:all;touch-action:none}
      #joystick-base{position:absolute;left:max(28px,env(safe-area-inset-left));bottom:max(28px,env(safe-area-inset-bottom));width:${JOYSTICK_SIZE}px;height:${JOYSTICK_SIZE}px;border-radius:50%;background:rgba(255,255,255,.10);border:2px solid rgba(255,255,255,.28)}
      #joystick-knob{position:absolute;left:50%;top:50%;width:${KNOB_SIZE}px;height:${KNOB_SIZE}px;margin-left:-${KNOB_SIZE/2}px;margin-top:-${KNOB_SIZE/2}px;border-radius:50%;background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.5)}
      #look-zone{position:absolute;right:0;top:0;width:60%;height:100%;pointer-events:all;touch-action:none}
      #shoot-btn{position:absolute;right:max(25px,env(safe-area-inset-right));bottom:max(30px,env(safe-area-inset-bottom));width:78px;height:78px;border-radius:50%;background:rgba(222,50,50,.68);border:2px solid rgba(255,120,110,.9);color:white;font-size:14px;font-weight:800;letter-spacing:1px;pointer-events:all;touch-action:none;z-index:4}
      #shoot-btn:active{background:rgba(255,90,80,.92);transform:scale(.96)}
    `;
    document.head.appendChild(style);
    this.styleEl = style;

    this.joystickZone = document.getElementById('joystick-zone');
    this.joystickBase = document.getElementById('joystick-base');
    this.joystickKnob = document.getElementById('joystick-knob');
    this.lookZone = document.getElementById('look-zone');
    this.shootBtn = document.getElementById('shoot-btn');
    this.baseRect = null;
    this.baseCenterX = 0;
    this.baseCenterY = 0;
    this._bindEvents();
  }

  enable() {
    this.active = true;
    this.container.classList.add('active');
    setTimeout(() => {
      this.baseRect = this.joystickBase.getBoundingClientRect();
      this.baseCenterX = this.baseRect.left + this.baseRect.width / 2;
      this.baseCenterY = this.baseRect.top + this.baseRect.height / 2;
    }, 100);
  }
  disable() { this.active=false; this.container.classList.remove('active'); this.moveX=0; this.moveY=0; }

  _bindEvents() {
    this.joystickZone.addEventListener('touchstart',(e)=>{
      e.preventDefault(); if(this.moveTouch!==null)return;
      const touch=e.changedTouches[0]; this.moveTouch=touch.identifier; this._updateJoystick(touch);
    },{passive:false});
    this.joystickZone.addEventListener('touchmove',(e)=>{
      e.preventDefault(); for(const touch of e.changedTouches)if(touch.identifier===this.moveTouch)this._updateJoystick(touch);
    },{passive:false});
    const joystickEnd=(e)=>{for(const touch of e.changedTouches)if(touch.identifier===this.moveTouch){this.moveTouch=null;this.moveX=0;this.moveY=0;this.joystickKnob.style.transform='translate(0px, 0px)';}};
    this.joystickZone.addEventListener('touchend',joystickEnd); this.joystickZone.addEventListener('touchcancel',joystickEnd);

    this.lookZone.addEventListener('touchstart',(e)=>{
      e.preventDefault(); if(this.lookTouch!==null)return;
      const touch=e.changedTouches[0]; this.lookTouch=touch.identifier; this._lastLookX=touch.clientX; this._lastLookY=touch.clientY;
    },{passive:false});
    this.lookZone.addEventListener('touchmove',(e)=>{
      e.preventDefault(); for(const touch of e.changedTouches)if(touch.identifier===this.lookTouch){
        this.lookDX=(touch.clientX-this._lastLookX)*TOUCH_SENSITIVITY;
        this.lookDY=(touch.clientY-this._lastLookY)*TOUCH_SENSITIVITY;
        this._lastLookX=touch.clientX; this._lastLookY=touch.clientY;
      }
    },{passive:false});
    const lookEnd=(e)=>{for(const touch of e.changedTouches)if(touch.identifier===this.lookTouch){this.lookTouch=null;this.lookDX=0;this.lookDY=0;}};
    this.lookZone.addEventListener('touchend',lookEnd); this.lookZone.addEventListener('touchcancel',lookEnd);

    this.shootBtn.addEventListener('touchstart',(e)=>{e.preventDefault();if(this.onShoot)this.onShoot();},{passive:false});
  }

  _updateJoystick(touch) {
    if(!this.baseRect){this.baseRect=this.joystickBase.getBoundingClientRect();this.baseCenterX=this.baseRect.left+this.baseRect.width/2;this.baseCenterY=this.baseRect.top+this.baseRect.height/2;}
    let dx=touch.clientX-this.baseCenterX; let dy=touch.clientY-this.baseCenterY;
    const maxDist=JOYSTICK_SIZE/2-KNOB_SIZE/4; const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist>maxDist){dx=(dx/dist)*maxDist;dy=(dy/dist)*maxDist;}
    this.joystickKnob.style.transform=`translate(${dx}px, ${dy}px)`;
    this.moveX=dx/maxDist;
    this.moveY=-dy/maxDist;
  }

  consumeLook(){const dx=this.lookDX,dy=this.lookDY;this.lookDX=0;this.lookDY=0;return{dx,dy};}
  destroy(){this.container.remove();this.styleEl.remove();}
}

export function isMobile(){const ua=navigator.userAgent||'';return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);}
