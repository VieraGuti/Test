import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js';
import { Client } from 'https://cdn.jsdelivr.net/npm/@colyseus/sdk@0.17.43/+esm';
import { BUY_ITEMS, weaponById } from '/shared/weapons.js';
import { WORLD, SITES, OBSTACLES, DECOR, collides } from '/shared/map.js';

const $=id=>document.getElementById(id),touch=matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0;
const ui={login:$('login'),play:$('play'),name:$('name'),status:$('login-status'),hud:$('hud'),atk:$('atk-score'),def:$('def-score'),round:$('round'),timer:$('timer'),phase:$('phase'),hp:$('hp'),armor:$('armor'),money:$('money'),weapon:$('weapon-name'),ammo:$('ammo'),reserve:$('reserve'),reload:$('reload-state'),bomb:$('bomb-card'),progress:$('action-progress'),feed:$('feed'),buy:$('buy-menu'),buyGrid:$('buy-grid'),score:$('scoreboard'),rows:$('score-rows'),mobile:$('mobile')};
let room,scene,camera,renderer,clock,mySid='',yaw=0,pitch=0,lastInput=0,lastFire=0,firing=false,localInit=false;
const pos=new THREE.Vector3(),keys=new Set(),actors=new Map(),moveTouch={forward:0,right:0};
let bombMesh,viewModel,muzzleFlash,walkPhase=0,shotKick=0,muzzleUntil=0;

function initBuy(){for(const it of Object.values(BUY_ITEMS)){if(it.id==='sidearm')continue;const b=document.createElement('button');b.className='buy-item';b.innerHTML=`<b>${it.name}</b><span>$${it.price}</span><small>${it.id==='armor'?'100 ARMOR':'Weapon'}</small>`;b.onclick=()=>room?.send('buy',{id:it.id});ui.buyGrid.appendChild(b)}}initBuy();
ui.play.onclick=connect;ui.name.onkeydown=e=>{if(e.key==='Enter')connect()};$('close-buy').onclick=()=>ui.buy.classList.add('hidden');$('m-buy').onclick=()=>toggleBuy(true);$('m-reload').onclick=()=>room?.send('reload');

async function connect(){
  ui.play.disabled=true;ui.status.textContent='Conectando…';
  try{
    const proto=location.protocol==='https:'?'wss':'ws',client=new Client(`${proto}://${location.host}`);
    room=await client.joinOrCreate('strike',{name:ui.name.value});mySid=room.sessionId;
    ui.login.classList.add('hidden');ui.hud.classList.remove('hidden');if(touch)ui.mobile.classList.remove('hidden');
    setup3D();bindNet();bindControls();feed('MODO PRUEBA · Dust-style mobile','system');animate();
  }catch(e){ui.status.textContent=`Error: ${e.message||e}`;ui.play.disabled=false}
}

function sandTexture(){
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
  x.fillStyle='#c7a36b';x.fillRect(0,0,256,256);
  for(let i=0;i<4500;i++){const v=150+Math.random()*55|0;x.fillStyle=`rgba(${v+20},${v},${Math.max(80,v-55)},${.02+Math.random()*.08})`;x.fillRect(Math.random()*256,Math.random()*256,1+Math.random()*2,1+Math.random()*2)}
  for(let i=0;i<42;i++){x.strokeStyle='rgba(90,64,38,.06)';x.lineWidth=1;x.beginPath();x.moveTo(0,Math.random()*256);x.lineTo(256,Math.random()*256);x.stroke()}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(22,22);t.colorSpace=THREE.SRGBColorSpace;return t;
}

function labelTexture(text,color='#fff',bg='rgba(80,25,10,.78)'){
  const c=document.createElement('canvas');c.width=256;c.height=128;const x=c.getContext('2d');
  x.fillStyle=bg;x.fillRect(0,0,256,128);x.strokeStyle='rgba(255,255,255,.28)';x.lineWidth=5;x.strokeRect(4,4,248,120);
  x.fillStyle=color;x.font='900 82px system-ui';x.textAlign='center';x.textBaseline='middle';x.fillText(text,128,65);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

function boxMaterial(kind){
  if(kind==='crate')return new THREE.MeshStandardMaterial({color:0x8a5c32,roughness:.88,metalness:.02});
  if(kind==='door')return new THREE.MeshStandardMaterial({color:0x5e351f,roughness:.82,metalness:.05});
  if(kind==='tunnel')return new THREE.MeshStandardMaterial({color:0x8f744f,roughness:.98});
  if(kind==='distant')return new THREE.MeshStandardMaterial({color:0xb39465,roughness:1});
  return new THREE.MeshStandardMaterial({color:0xc8aa78,roughness:.96});
}

function addStructure(o,collider=true){
  const g=new THREE.BoxGeometry(o.w,o.h,o.d),m=new THREE.Mesh(g,boxMaterial(o.kind));
  m.position.set(o.x,o.h/2,o.z);scene.add(m);
  // Add cheap architectural trim so buildings stop looking like raw blocks.
  if(o.kind==='sandstone'||o.kind==='tunnel'||o.kind==='distant'){
    const trim=new THREE.Mesh(new THREE.BoxGeometry(o.w+.12,.18,o.d+.12),new THREE.MeshStandardMaterial({color:0xe0c28d,roughness:1}));
    trim.position.set(o.x,o.h+.05,o.z);scene.add(trim);
  }
  if(o.kind==='crate'){
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(g),new THREE.LineBasicMaterial({color:0x4a2f1d,transparent:true,opacity:.7}));edge.position.copy(m.position);scene.add(edge);
  }
  return m;
}

function addSite(name,s){
  const color=name==='A'?0xd75a30:0x3a79be;
  const disc=new THREE.Mesh(new THREE.CircleGeometry(s.radius,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.18,side:THREE.DoubleSide}));
  disc.rotation.x=-Math.PI/2;disc.position.set(s.x,.025,s.z);scene.add(disc);
  const ring=new THREE.Mesh(new THREE.RingGeometry(s.radius-.16,s.radius,64),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(s.x,.035,s.z);scene.add(ring);
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(3.4,1.7),new THREE.MeshBasicMaterial({map:labelTexture(name,'#fff',name==='A'?'rgba(173,54,30,.9)':'rgba(34,92,157,.9)'),transparent:true}));
  plane.position.set(s.x,2.5,s.z+(name==='A'?-4.8:4.8));scene.add(plane);
}

function addArrow(text,x,y,z,rot=0){
  const p=new THREE.Mesh(new THREE.PlaneGeometry(2.4,1.2),new THREE.MeshBasicMaterial({map:labelTexture(text,'#f5efe3','rgba(100,45,25,.82)'),transparent:true,side:THREE.DoubleSide}));
  p.position.set(x,y,z);p.rotation.y=rot;scene.add(p);
}

function makeViewModel(){
  const g=new THREE.Group();
  const dark=new THREE.MeshStandardMaterial({color:0x1f2427,roughness:.42,metalness:.55});
  const black=new THREE.MeshStandardMaterial({color:0x0c0f10,roughness:.38,metalness:.7});
  const polymer=new THREE.MeshStandardMaterial({color:0x24282a,roughness:.72});
  const skin=new THREE.MeshStandardMaterial({color:0x9b704e,roughness:.9});
  const glove=new THREE.MeshStandardMaterial({color:0x2a2d2a,roughness:.92});
  const receiver=new THREE.Mesh(new THREE.BoxGeometry(.16,.16,.54),dark);receiver.position.set(.06,0,-.34);g.add(receiver);
  const handguard=new THREE.Mesh(new THREE.BoxGeometry(.13,.13,.42),polymer);handguard.position.set(.06,0,-.78);g.add(handguard);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.48,12),black);barrel.rotation.x=Math.PI/2;barrel.position.set(.06,.01,-1.12);g.add(barrel);
  const stock=new THREE.Mesh(new THREE.BoxGeometry(.13,.13,.34),polymer);stock.position.set(.06,.01,.06);stock.rotation.x=-.08;g.add(stock);
  const mag=new THREE.Mesh(new THREE.BoxGeometry(.11,.27,.16),black);mag.position.set(.07,-.18,-.36);mag.rotation.x=-.25;g.add(mag);
  const sight=new THREE.Mesh(new THREE.BoxGeometry(.07,.09,.12),black);sight.position.set(.06,.12,-.41);g.add(sight);
  const grip=new THREE.Mesh(new THREE.BoxGeometry(.08,.21,.09),polymer);grip.position.set(.06,-.17,-.08);grip.rotation.x=-.25;g.add(grip);
  const armR=new THREE.Mesh(new THREE.CapsuleGeometry(.07,.34,4,8),skin);armR.rotation.z=-.45;armR.rotation.x=-.38;armR.position.set(.27,-.28,-.08);g.add(armR);
  const armL=new THREE.Mesh(new THREE.CapsuleGeometry(.065,.31,4,8),skin);armL.rotation.z=.72;armL.rotation.x=-.72;armL.position.set(-.12,-.25,-.56);g.add(armL);
  const gloveR=new THREE.Mesh(new THREE.SphereGeometry(.085,10,8),glove);gloveR.position.set(.16,-.17,-.2);g.add(gloveR);
  const gloveL=new THREE.Mesh(new THREE.SphereGeometry(.08,10,8),glove);gloveL.position.set(.02,-.13,-.65);g.add(gloveL);
  muzzleFlash=new THREE.Mesh(new THREE.ConeGeometry(.07,.25,8),new THREE.MeshBasicMaterial({color:0xffd36a,transparent:true,opacity:.95}));
  muzzleFlash.rotation.x=-Math.PI/2;muzzleFlash.position.set(.06,.01,-1.44);muzzleFlash.visible=false;g.add(muzzleFlash);
  g.position.set(.34,-.26,-.52);g.rotation.y=-.05;return g;
}

function makeActor(team){
  const g=new THREE.Group(),bodyMat=new THREE.MeshStandardMaterial({color:team==='attackers'?0x80623f:0x40566b,roughness:.9}),gear=new THREE.MeshStandardMaterial({color:0x252b2e,roughness:.95}),skin=new THREE.MeshStandardMaterial({color:0xa47a59,roughness:1});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.28,.55,4,8),bodyMat);torso.position.y=1.0;g.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.22,12,10),skin);head.position.y=1.63;g.add(head);
  const vest=new THREE.Mesh(new THREE.BoxGeometry(.48,.5,.26),gear);vest.position.set(0,1.05,.02);g.add(vest);
  const leg1=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.48,4,8),gear);leg1.position.set(-.14,.43,0);g.add(leg1);
  const leg2=leg1.clone();leg2.position.x=.14;g.add(leg2);return g;
}

function setup3D(){
  scene=new THREE.Scene();scene.background=new THREE.Color(0xaed5e8);scene.fog=new THREE.Fog(0xc2d4d7,55,105);
  camera=new THREE.PerspectiveCamera(76,innerWidth/innerHeight,.05,180);
  renderer=new THREE.WebGLRenderer({antialias:!touch,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,touch?1.25:1.8));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('game').appendChild(renderer.domElement);clock=new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0xe5f2ff,0x7a5b38,2.15));
  const sun=new THREE.DirectionalLight(0xffefd0,2.1);sun.position.set(-28,42,-18);scene.add(sun);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(WORLD.half*2,WORLD.half*2),new THREE.MeshStandardMaterial({map:sandTexture(),color:0xd2ae75,roughness:1}));ground.rotation.x=-Math.PI/2;scene.add(ground);
  for(const o of OBSTACLES)addStructure(o,true);for(const o of DECOR)addStructure(o,false);
  for(const [name,s] of Object.entries(SITES))addSite(name,s);
  addArrow('A →',19,2.2,-19,0);addArrow('← B',-19,2.2,-19,0);addArrow('A →',4,2.2,7,0);addArrow('← B',-4,2.2,7,Math.PI);
  // Mid arch lintel and tunnel ceilings for a more recognisable tactical-map silhouette.
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(10.5,.75,1.3),boxMaterial('sandstone'));lintel.position.set(0,5.15,1);scene.add(lintel);
  const tunnelRoof=new THREE.Mesh(new THREE.BoxGeometry(10.5,.45,25),boxMaterial('tunnel'));tunnelRoof.position.set(-32.5,5.45,-2.5);scene.add(tunnelRoof);
  // Small desert skyline props.
  for(const [x,z,s] of [[-8,39,1],[8,40,.8],[-41,8,.7],[41,10,.75]]){
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.12,.18,2.8,7),new THREE.MeshStandardMaterial({color:0x6e4b2e,roughness:1}));trunk.position.set(x,1.4,z);scene.add(trunk);
    for(let i=0;i<5;i++){const leaf=new THREE.Mesh(new THREE.BoxGeometry(.12,.035,1.5*s),new THREE.MeshStandardMaterial({color:0x4f6d3d,roughness:1}));leaf.position.set(x,2.9,z);leaf.rotation.y=i*Math.PI*2/5;leaf.rotation.x=.5;scene.add(leaf)}
  }
  bombMesh=new THREE.Group();const bombBody=new THREE.Mesh(new THREE.BoxGeometry(.55,.28,.42),new THREE.MeshStandardMaterial({color:0x2a2f2d,roughness:.65}));bombMesh.add(bombBody);const screen=new THREE.Mesh(new THREE.BoxGeometry(.24,.12,.025),new THREE.MeshBasicMaterial({color:0xff5533}));screen.position.set(0,.03,-.225);bombMesh.add(screen);bombMesh.visible=false;scene.add(bombMesh);
  viewModel=makeViewModel();camera.add(viewModel);scene.add(camera);
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
}

function bindNet(){room.onMessage('event',e=>{if(e.type==='kill')feed(`${e.killer} ${e.headshot?'◉ ':''}${weaponById(e.weapon).name} ${e.victim}`,e.headshot?'head':'');else if(e.text)feed(e.text,'system')});room.onLeave(()=>feed('Desconectado','system'))}

function bindControls(){document.addEventListener('keydown',e=>{if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code))keys.add(e.code);if(e.code==='KeyR')room?.send('reload');if(e.code==='KeyB')toggleBuy();if(e.code==='KeyE'&&!e.repeat)room?.send('use');if(e.code==='Tab'){e.preventDefault();ui.score.classList.remove('hidden')}});document.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='KeyE')room?.send('useStop');if(e.code==='Tab')ui.score.classList.add('hidden')});renderer.domElement.onclick=()=>{if(!touch&&document.pointerLockElement!==renderer.domElement)renderer.domElement.requestPointerLock()};document.addEventListener('mousemove',e=>{if(document.pointerLockElement!==renderer.domElement)return;yaw-=e.movementX*.0022;pitch=Math.max(-1.25,Math.min(1.25,pitch-e.movementY*.0022))});document.addEventListener('mousedown',e=>{if(e.button===0&&document.pointerLockElement===renderer.domElement)firing=true});document.addEventListener('mouseup',e=>{if(e.button===0)firing=false});if(touch)bindTouch()}

function bindTouch(){const zone=$('move-zone'),base=$('move-base'),knob=$('move-knob');let id=null,c={x:0,y:0};zone.onpointerdown=e=>{id=e.pointerId;zone.setPointerCapture(id);const r=base.getBoundingClientRect();c={x:r.left+r.width/2,y:r.top+r.height/2};stick(e)};zone.onpointermove=e=>{if(e.pointerId===id)stick(e)};zone.onpointerup=zone.onpointercancel=e=>{if(e.pointerId!==id)return;id=null;moveTouch.forward=moveTouch.right=0;knob.style.transform='translate(0,0)'};function stick(e){let dx=e.clientX-c.x,dy=e.clientY-c.y,max=42,l=Math.hypot(dx,dy)||1;if(l>max){dx=dx/l*max;dy=dy/l*max}moveTouch.right=dx/max;moveTouch.forward=-dy/max;knob.style.transform=`translate(${dx}px,${dy}px)`}const look=$('look-zone');let lid=null,last={x:0,y:0};look.onpointerdown=e=>{lid=e.pointerId;look.setPointerCapture(lid);last={x:e.clientX,y:e.clientY}};look.onpointermove=e=>{if(e.pointerId!==lid)return;const dx=e.clientX-last.x,dy=e.clientY-last.y;last={x:e.clientX,y:e.clientY};yaw-=dx*.0052;pitch=Math.max(-1.25,Math.min(1.25,pitch-dy*.0052))};look.onpointerup=look.onpointercancel=e=>{if(e.pointerId===lid)lid=null};const f=$('m-fire');f.onpointerdown=e=>{e.preventDefault();firing=true};f.onpointerup=f.onpointercancel=()=>firing=false;const u=$('m-use');u.onpointerdown=e=>{e.preventDefault();room?.send('use')};u.onpointerup=u.onpointercancel=()=>room?.send('useStop')}
function movement(){return touch?moveTouch:{forward:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),right:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)}}

function animate(){requestAnimationFrame(animate);if(!room||!renderer)return;const dt=Math.min(clock.getDelta(),.05),p=room.state.players.get(mySid);if(p){if(!localInit){pos.set(p.x,0,p.z);yaw=p.yaw;pitch=p.pitch;localInit=true}const mv=movement();if(p.alive&&room.state.phase==='live')predict(mv,dt);pos.x+=(p.x-pos.x)*.12;pos.z+=(p.z-pos.z)*.12;camera.position.set(pos.x,1.55,pos.z);const cp=Math.cos(pitch);camera.lookAt(pos.x+Math.sin(yaw)*cp,1.55+Math.sin(pitch),pos.z+Math.cos(yaw)*cp);const speed=Math.min(1,Math.hypot(mv.forward,mv.right));walkPhase+=dt*(3+speed*7);shotKick*=Math.pow(.03,dt);if(viewModel){viewModel.position.x=.34+Math.sin(walkPhase)*.012*speed;viewModel.position.y=-.26+Math.abs(Math.cos(walkPhase*2))*.009*speed-shotKick;viewModel.rotation.x=-shotKick*1.8;viewModel.rotation.z=Math.sin(walkPhase)*.008*speed}if(muzzleFlash)muzzleFlash.visible=performance.now()<muzzleUntil;const now=performance.now();if(now-lastInput>45){room.send('input',{...mv,yaw,pitch});lastInput=now}if(firing&&p.alive&&room.state.phase==='live'&&now-lastFire>30){room.send('shoot',{yaw,pitch});lastFire=now;shotKick=.05;muzzleUntil=now+42}}syncActors();syncBomb();hud();renderer.render(scene,camera)}

function predict(m,dt){let dx=Math.sin(yaw)*m.forward+Math.cos(yaw)*m.right,dz=Math.cos(yaw)*m.forward-Math.sin(yaw)*m.right,l=Math.hypot(dx,dz);if(l>1){dx/=l;dz/=l}const nx=pos.x+dx*6.2*dt,nz=pos.z+dz*6.2*dt;if(!collides(nx,pos.z))pos.x=nx;if(!collides(pos.x,nz))pos.z=nz}

function syncActors(){const seen=new Set();room.state.players.forEach((p,sid)=>{if(sid===mySid)return;seen.add(sid);let a=actors.get(sid);if(!a){a=makeActor(p.team);actors.set(sid,a);scene.add(a)}a.visible=p.alive;a.position.x+=(p.x-a.position.x)*.28;a.position.z+=(p.z-a.position.z)*.28;a.rotation.y=p.yaw});for(const [sid,a] of actors)if(!seen.has(sid)){scene.remove(a);actors.delete(sid)}}
function syncBomb(){const s=room.state,v=['dropped','planting','planted'].includes(s.bombState);bombMesh.visible=v;if(v){if(s.bombState==='planting'){const p=s.players.get(s.planter);if(p)bombMesh.position.set(p.x,.22,p.z)}else bombMesh.position.set(s.bombX,.22,s.bombZ);bombMesh.rotation.y+=.01}}

function hud(){const s=room.state,p=s.players.get(mySid);if(!p)return;ui.atk.textContent=s.attackersScore;ui.def.textContent=s.defendersScore;ui.round.textContent=`R${Math.max(1,s.round)}`;ui.phase.textContent=s.phase.toUpperCase();const end=s.bombState==='planted'?s.bombExplodesAt:s.phaseEndsAt,sec=Math.max(0,Math.ceil((end-Date.now())/1000));ui.timer.textContent=end?`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`:'--:--';ui.hp.textContent=Math.ceil(p.hp);ui.armor.textContent=Math.ceil(p.armor);ui.money.textContent=Math.floor(p.money);const w=weaponById(p.weapon);ui.weapon.textContent=w.name;ui.ammo.textContent=p.ammo;ui.reserve.textContent=p.reserveAmmo;ui.reload.textContent=p.reloading?'RELOADING…':'';let bt='';if(p.hasBomb)bt='💣 LLEVAS LA BOMBA';else if(s.bombState==='dropped')bt='💣 BOMBA EN EL SUELO';else if(s.bombState==='planting')bt=`PLANTANDO EN ${s.bombSite}`;else if(s.bombState==='planted')bt=`⚠ BOMBA PLANTADA · ${s.bombSite}`;ui.bomb.textContent=bt;ui.bomb.classList.toggle('hidden',!bt);let val=0,txt='';if(s.planter===mySid){val=s.plantProgress;txt='PLANTANDO'}else if(s.defuser===mySid){val=s.defuseProgress;txt='DESACTIVANDO'}ui.progress.classList.toggle('hidden',!txt);if(txt){ui.progress.firstElementChild.style.width=`${val*100}%`;ui.progress.lastElementChild.textContent=`${txt} ${Math.round(val*100)}%`}const rows=[];s.players.forEach(x=>rows.push(x));ui.rows.innerHTML='<div class="score-row"><b>PLAYER</b><b>TEAM</b><b>K</b><b>D</b></div>'+rows.map(x=>`<div class="score-row"><b>${escapeHtml(x.name)}</b><span class="${x.team==='attackers'?'atk':'def'}">${x.team==='attackers'?'ATK':'DEF'}</span><span>${x.kills}</span><span>${x.deaths}</span></div>`).join('');if(s.phase!=='freeze')ui.buy.classList.add('hidden')}
function toggleBuy(force){const open=force??ui.buy.classList.contains('hidden');if(open&&room?.state.phase==='freeze')ui.buy.classList.remove('hidden');else ui.buy.classList.add('hidden')}
function feed(t,c=''){const e=document.createElement('div');e.className=`feed-item ${c}`;e.textContent=t;ui.feed.prepend(e);while(ui.feed.children.length>6)ui.feed.lastChild.remove();setTimeout(()=>e.remove(),6000)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
