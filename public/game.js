import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const SETTINGS_KEY = 'vast_dead_zone_settings_v1';
const SAVE_KEY = 'vast_dead_zone_best_v1';

const settings = Object.assign({ sensitivity: 1, fov: 72, volume: .8, quality: 'medium' }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
const best = Object.assign({ kills: 0, time: 0, day: 1 }, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'));

let renderer, scene, camera, yawNode, pitchNode, weaponRig, sun, hemi, clock;
let started = false, paused = false, dead = false, isTouch = matchMedia('(pointer: coarse)').matches;
let runTime = 0, uiAccumulator = 0, spawnAccumulator = 0, waveAccumulator = 0;
let currentObjective = 0, interactTarget = null, nextShotAt = 0, reloadingUntil = 0;
let fireHeld = false, aimHeld = false, runHeld = false, jumpQueued = false;
let yaw = 0, pitch = 0, verticalVelocity = 0, grounded = true, recoil = 0, recoilSide = 0;
let noise = 0, screenShake = 0;
const obstacles = [], zombies = [], shootables = [], loots = [], streetLights = [];
const keys = new Set();
const raycaster = new THREE.Raycaster();
const tempV = new THREE.Vector3();
const tempV2 = new THREE.Vector3();
const tempColor = new THREE.Color();

const player = {
  pos: new THREE.Vector3(0, 1.68, 30),
  hp: 100, hunger: 100, thirst: 100, stamina: 100,
  kills: 0,
  inventory: { medkit: 1, food: 1, water: 1 },
  weapon: 0
};

const weapons = [
  { id:'pistol', label:'M9', mode:'SEMI', unlocked:true, magSize:15, mag:15, reserve:45, damage:34, head:2.45, rate:.18, automatic:false, spread:.0045, noise:.48, reload:1.25 },
  { id:'rifle', label:'M4A1', mode:'AUTO', unlocked:false, magSize:30, mag:0, reserve:0, damage:26, head:2.7, rate:.095, automatic:true, spread:.008, noise:.78, reload:1.65 },
  { id:'shotgun', label:'M870', mode:'PUMP', unlocked:false, magSize:6, mag:0, reserve:0, damage:15, head:1.55, rate:.72, automatic:false, spread:.04, pellets:8, noise:1, reload:1.85 }
];

const AudioFX = {
  ctx:null, master:null, noiseBuffer:null,
  init(){
    if(this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * .35;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/len, 1.5);
  },
  resume(){ this.init(); if(this.ctx?.state === 'suspended') this.ctx.resume(); },
  setVolume(v){ if(this.master) this.master.gain.value = v; },
  burst({gain=.4, duration=.12, low=130, high=2200, tone=70}={}){
    if(!this.ctx) return;
    const now=this.ctx.currentTime;
    const src=this.ctx.createBufferSource(); src.buffer=this.noiseBuffer;
    const filter=this.ctx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=high; filter.Q.value=.7;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(gain,now); g.gain.exponentialRampToValueAtTime(.001,now+duration);
    src.connect(filter); filter.connect(g); g.connect(this.master); src.start(now); src.stop(now+duration);
    const osc=this.ctx.createOscillator(); const og=this.ctx.createGain(); osc.type='triangle'; osc.frequency.setValueAtTime(tone,now); osc.frequency.exponentialRampToValueAtTime(low,now+duration*.8); og.gain.setValueAtTime(gain*.45,now); og.gain.exponentialRampToValueAtTime(.001,now+duration); osc.connect(og); og.connect(this.master); osc.start(now); osc.stop(now+duration);
  },
  gun(id){
    this.resume();
    if(id==='shotgun') this.burst({gain:.78,duration:.25,high:900,tone:95,low:42});
    else if(id==='rifle') this.burst({gain:.48,duration:.11,high:1900,tone:115,low:65});
    else this.burst({gain:.42,duration:.13,high:2450,tone:150,low:78});
  },
  click(){ this.resume(); this.burst({gain:.05,duration:.025,high:3200,tone:500,low:340}); },
  pickup(){
    if(!this.ctx) return; const now=this.ctx.currentTime;
    [520,690].forEach((f,i)=>{const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.05,now+i*.05);g.gain.exponentialRampToValueAtTime(.001,now+.13+i*.05);o.connect(g);g.connect(this.master);o.start(now+i*.05);o.stop(now+.16+i*.05)});
  },
  groan(strength=.25){
    if(!this.ctx || Math.random()>.35) return;
    const now=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();
    o.type='sawtooth'; o.frequency.setValueAtTime(rand(62,82),now); o.frequency.linearRampToValueAtTime(rand(38,55),now+.45); f.type='lowpass';f.frequency.value=350;
    g.gain.setValueAtTime(.0001,now);g.gain.linearRampToValueAtTime(.025*strength,now+.05);g.gain.exponentialRampToValueAtTime(.001,now+.48);o.connect(f);f.connect(g);g.connect(this.master);o.start(now);o.stop(now+.5);
  }
};

function makeTexture(base='#55534d', fleck='#6b675f', size=128){
  const c=document.createElement('canvas'); c.width=c.height=size; const x=c.getContext('2d');
  x.fillStyle=base; x.fillRect(0,0,size,size);
  for(let i=0;i<900;i++){x.globalAlpha=rand(.03,.18);x.fillStyle=Math.random()>.5?fleck:'#222';const s=rand(.3,2.2);x.fillRect(Math.random()*size,Math.random()*size,s,s)}
  x.globalAlpha=1;
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(8,8);t.colorSpace=THREE.SRGBColorSpace;return t;
}

function initThree(){
  scene=new THREE.Scene(); scene.background=new THREE.Color(0x88918c); scene.fog=new THREE.FogExp2(0x7f8984,.0135);
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'}); renderer.setSize(innerWidth,innerHeight); renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=.88;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap; $('game-root').appendChild(renderer.domElement);
  camera=new THREE.PerspectiveCamera(settings.fov,innerWidth/innerHeight,.025,150); yawNode=new THREE.Object3D();pitchNode=new THREE.Object3D();yawNode.add(pitchNode);pitchNode.add(camera);scene.add(yawNode);yawNode.position.copy(player.pos);
  hemi=new THREE.HemisphereLight(0xc9d4cf,0x453b31,1.35); scene.add(hemi);
  sun=new THREE.DirectionalLight(0xffe4bf,2.25);sun.position.set(-34,55,18);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-55;sun.shadow.camera.right=55;sun.shadow.camera.top=55;sun.shadow.camera.bottom=-55;sun.shadow.camera.near=.1;sun.shadow.camera.far=130;scene.add(sun);
  buildWorld(); buildWeapon(); applyQuality(settings.quality); clock=new THREE.Clock();
  window.addEventListener('resize',onResize,{passive:true});
}

function addBlock(x,z,w,d,h,material,collision=true,y=0){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y+h/2,z);m.castShadow=h>1;m.receiveShadow=true;scene.add(m);
  if(collision) obstacles.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2}); return m;
}

function addWindows(building,w,d,h){
  const mat=new THREE.MeshBasicMaterial({color:0x18201f});
  const y=h*.56;
  for(let side of [-1,1]) for(let i=-1;i<=1;i++){
    const p=new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.05),mat);p.position.set(building.position.x+i*w*.23,y,building.position.z+side*(d/2+.011));p.rotation.y=side===1?0:Math.PI;scene.add(p);
  }
}

function buildWorld(){
  const dirt=makeTexture('#514c40','#766e5c');dirt.repeat.set(22,22);const asphalt=makeTexture('#353b39','#555d58');asphalt.repeat.set(12,12);
  const wallTex=makeTexture('#5c625d','#888d84');wallTex.repeat.set(3,2);
  const groundMat=new THREE.MeshStandardMaterial({map:dirt,roughness:1,color:0x8b846f});const ground=new THREE.Mesh(new THREE.PlaneGeometry(170,170),groundMat);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const roadMat=new THREE.MeshStandardMaterial({map:asphalt,roughness:.94,color:0x777a73});
  const road1=new THREE.Mesh(new THREE.PlaneGeometry(16,170),roadMat);road1.rotation.x=-Math.PI/2;road1.position.y=.012;scene.add(road1);
  const road2=new THREE.Mesh(new THREE.PlaneGeometry(170,15),roadMat);road2.rotation.x=-Math.PI/2;road2.rotation.z=Math.PI/2;road2.position.y=.014;scene.add(road2);
  const stripeMat=new THREE.MeshBasicMaterial({color:0xc5b575});
  for(let z=-78;z<78;z+=8){const s=new THREE.Mesh(new THREE.PlaneGeometry(.16,3.8),stripeMat);s.rotation.x=-Math.PI/2;s.position.set(0,.02,z);scene.add(s)}
  const concrete=new THREE.MeshStandardMaterial({map:wallTex,color:0xa7a89d,roughness:.88});const dark=new THREE.MeshStandardMaterial({color:0x343b38,roughness:.8});const rusty=new THREE.MeshStandardMaterial({color:0x704b36,roughness:.85});const metal=new THREE.MeshStandardMaterial({color:0x46504e,roughness:.55});

  const warehouse=addBlock(24,-23,28,20,8,concrete);addWindows(warehouse,28,20,8);addBlock(24,-23,29,21,.45,dark,false,8);
  addBlock(24,-12.65,8,.7,4.8,dark,false,0); addBlock(24,-12.25,5,.2,3.7,new THREE.MeshBasicMaterial({color:0x101716}),false,.2);
  const clinic=addBlock(27,31,19,15,6.4,concrete);addWindows(clinic,19,15,6.4);addBlock(27,31,20,16,.35,dark,false,6.4);
  const motel=addBlock(-31,-29,22,12,5.3,new THREE.MeshStandardMaterial({color:0x706b5e,roughness:.9}));addWindows(motel,22,12,5.3);addBlock(-31,-29,23,13,.3,rusty,false,5.3);

  // Gasolinera y tienda, primer punto de interés.
  const store=addBlock(-27,9,13,9,4.2,new THREE.MeshStandardMaterial({color:0x8a8270,roughness:.9}));addWindows(store,13,9,4.2);
  addBlock(-14,9,12,8,.45,new THREE.MeshStandardMaterial({color:0x8e3428,roughness:.7}),false,4.6);
  for(const x of [-18,-10]){const col=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,4.6,10),metal);col.position.set(x,2.3,6);scene.add(col)}
  for(const x of [-17,-11]){const pump=addBlock(x,7,1.1,.75,1.8,new THREE.MeshStandardMaterial({color:0x822f29,metalness:.15,roughness:.55}),true);const screen=new THREE.Mesh(new THREE.PlaneGeometry(.55,.35),new THREE.MeshBasicMaterial({color:0x152322}));screen.position.set(x,1.3,6.615);scene.add(screen)}

  // Contenedores y barricadas para silueta y cobertura.
  const containerColors=[0x51665f,0x82523d,0x4a5868,0x6e694d];
  [[18,7,0],[27,5,Math.PI/2],[38,-4,0],[-45,18,Math.PI/2],[-42,26,Math.PI/2],[45,18,0]].forEach((p,i)=>{
    const mat=new THREE.MeshStandardMaterial({color:containerColors[i%containerColors.length],roughness:.72,metalness:.2});const c=addBlock(p[0],p[1],6.2,2.6,2.55,mat,true);c.rotation.y=p[2];
  });
  for(let i=0;i<9;i++){const x=rand(-58,58),z=rand(-58,58);if(Math.abs(x)<9||Math.abs(z)<9) continue;addBlock(x,z,rand(1.5,3.5),rand(.5,1),rand(.7,1.2),rusty,true)}

  // Coches abandonados low-poly.
  [[7,19,.2],[-6,-21,-.5],[11,-45,1.1],[-11,43,-1.2],[-50,-3,.7],[48,44,-.6]].forEach(([x,z,r])=>addCar(x,z,r));
  // Árboles secos y postes.
  for(let i=0;i<34;i++){let x=rand(-78,78),z=rand(-78,78);if(Math.abs(x)<14||Math.abs(z)<14) continue;addDeadTree(x,z,rand(.8,1.35))}
  for(let z=-62;z<=62;z+=20){addLamp(-9,z);addLamp(9,z)}
  for(let x=-60;x<=60;x+=24){if(Math.abs(x)<10) continue;addLamp(x,-9)}

  // Cercado del almacén.
  for(let x=10;x<=39;x+=3)addFence(x,-34);for(let z=-33;z<=-14;z+=3)addFence(39,z,Math.PI/2);

  // Loot inicial: suficiente para aprender sin regalarlo todo.
  spawnLoot('water',-25,5.2);spawnLoot('food',-30,5);spawnLoot('ammo',-24,10);spawnLoot('rifle',-29,11.2);spawnLoot('medkit',28,26);spawnLoot('shotgun',24,34);spawnLoot('ammo',20,-16);spawnLoot('water',31,-17);spawnLoot('food',-34,-25);
  createObjectiveBeacon(-27,9);
  for(let i=0;i<7;i++) spawnZombie(randomSpawn(18,48));
}

function addCar(x,z,r=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=r;const bodyMat=new THREE.MeshStandardMaterial({color:[0x555d58,0x75554a,0x4a555f][Math.floor(Math.random()*3)],roughness:.72,metalness:.28});
  const lower=new THREE.Mesh(new THREE.BoxGeometry(3.3,.65,1.55),bodyMat);lower.position.y=.65;lower.castShadow=true;const top=new THREE.Mesh(new THREE.BoxGeometry(1.9,.62,1.42),bodyMat);top.position.set(-.25,1.22,0);top.castShadow=true;g.add(lower,top);
  const glass=new THREE.MeshStandardMaterial({color:0x192625,roughness:.28,metalness:.2});const wind=new THREE.Mesh(new THREE.PlaneGeometry(1.15,.48),glass);wind.position.set(.73,1.28,0);wind.rotation.set(0,Math.PI/2,0);g.add(wind);
  const tireMat=new THREE.MeshStandardMaterial({color:0x151716,roughness:1});for(const sx of [-1.05,1.05])for(const sz of [-.82,.82]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.18,12),tireMat);w.rotation.x=Math.PI/2;w.position.set(sx,.42,sz);g.add(w)}scene.add(g);
  obstacles.push({minX:x-1.85,maxX:x+1.85,minZ:z-1.35,maxZ:z+1.35});
}
function addDeadTree(x,z,s){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0x504638,roughness:1});const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.14*s,.24*s,3.8*s,7),mat);trunk.position.y=1.9*s;trunk.rotation.z=rand(-.08,.08);g.add(trunk);for(let i=0;i<3;i++){const b=new THREE.Mesh(new THREE.CylinderGeometry(.04*s,.08*s,1.7*s,6),mat);b.position.set(rand(-.35,.35),rand(2.4,3.3)*s,0);b.rotation.z=rand(-1,1);g.add(b)}g.position.set(x,0,z);scene.add(g)}
function addFence(x,z,r=0){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0x555b55,metalness:.55,roughness:.65});for(const px of [-1.45,1.45]){const p=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.2,6),mat);p.position.set(px,1.1,0);g.add(p)}for(let y=.3;y<2.1;y+=.34){const rail=new THREE.Mesh(new THREE.BoxGeometry(2.9,.025,.025),mat);rail.position.y=y;g.add(rail)}g.position.set(x,0,z);g.rotation.y=r;scene.add(g)}
function addLamp(x,z){const g=new THREE.Group(),poleMat=new THREE.MeshStandardMaterial({color:0x343a37,metalness:.55,roughness:.6});const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.1,5.2,8),poleMat);pole.position.y=2.6;const arm=new THREE.Mesh(new THREE.BoxGeometry(1.05,.07,.07),poleMat);arm.position.set(.48,5.05,0);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),new THREE.MeshBasicMaterial({color:0xffc479}));bulb.position.set(.97,4.95,0);g.add(pole,arm,bulb);g.position.set(x,0,z);scene.add(g);if(streetLights.length<8){const l=new THREE.PointLight(0xffa95e,0,12,2);l.position.set(x+.97,4.8,z);scene.add(l);streetLights.push(l)}}
function createObjectiveBeacon(x,z){const mat=new THREE.MeshBasicMaterial({color:0xd87537,transparent:true,opacity:.24,depthWrite:false});const beam=new THREE.Mesh(new THREE.CylinderGeometry(.09,1.2,13,16,1,true),mat);beam.position.set(x,6.5,z);scene.add(beam);beam.userData.beacon=true}

function buildWeapon(){
  if(weaponRig) camera.remove(weaponRig);weaponRig=new THREE.Group();camera.add(weaponRig);weaponRig.position.set(.22,-.19,-.42);
  const w=weapons[player.weapon];const metal=new THREE.MeshStandardMaterial({color:0x282e2d,metalness:.72,roughness:.34});const dark=new THREE.MeshStandardMaterial({color:0x111413,roughness:.65});const grip=new THREE.MeshStandardMaterial({color:0x25201d,roughness:.9});
  const box=(sx,sy,sz,x,y,z,mat=metal)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);m.castShadow=false;weaponRig.add(m);return m};
  const barrel=(rad,len,x,y,z)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,len,10),metal);m.rotation.x=Math.PI/2;m.position.set(x,y,z);weaponRig.add(m);return m};
  if(w.id==='pistol'){box(.115,.105,.34,0,.01,-.08);box(.095,.17,.11,0,-.11,.01,grip).rotation.x=-.16;barrel(.026,.22,0,.025,-.30)}
  else if(w.id==='rifle'){box(.13,.14,.48,0,.01,-.12);box(.11,.19,.18,-.01,-.13,.02,grip).rotation.x=-.16;box(.09,.08,.28,0,.035,.23,dark);barrel(.024,.46,0,.03,-.58);box(.055,.09,.12,0,.13,-.14,dark)}
  else {box(.12,.13,.48,0,.0,-.1);box(.09,.18,.18,0,-.14,.05,grip).rotation.x=-.15;barrel(.036,.72,0,.025,-.68);box(.10,.105,.2,0,-.03,-.43,new THREE.MeshStandardMaterial({color:0x5b3e2d,roughness:.86}))}
  const muzzle=new THREE.PointLight(0xff8a43,0,2.2,2);muzzle.position.set(0,.02,w.id==='shotgun'?-.98:(w.id==='rifle'?-.82:-.43));weaponRig.add(muzzle);weaponRig.userData.muzzle=muzzle;
}

function randomSpawn(min=20,max=55){
  for(let i=0;i<20;i++){const a=Math.random()*Math.PI*2,d=rand(min,max),x=player.pos.x+Math.cos(a)*d,z=player.pos.z+Math.sin(a)*d;if(!collidesAt(x,z,.7)&&Math.abs(x)<78&&Math.abs(z)<78)return new THREE.Vector3(x,0,z)}
  return new THREE.Vector3(rand(-65,65),0,rand(-65,65));
}

function spawnZombie(pos){
  const g=new THREE.Group();g.position.copy(pos);const skin=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(rand(.18,.28),rand(.16,.28),rand(.28,.39)),roughness:.96});const cloth=new THREE.MeshStandardMaterial({color:[0x4d5147,0x51443e,0x3e4a50,0x5b5545][Math.floor(Math.random()*4)],roughness:1});const blood=new THREE.MeshStandardMaterial({color:0x501c17,roughness:.95});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.31,.65,3,7),cloth);torso.position.y=1.12;torso.scale.z=.68;const head=new THREE.Mesh(new THREE.SphereGeometry(.25,9,7),skin);head.position.set(0,1.85,.02);head.scale.set(.88,1.08,.92);
  const jaw=new THREE.Mesh(new THREE.BoxGeometry(.22,.12,.19),skin);jaw.position.set(0,1.72,-.11);g.add(torso,head,jaw);
  const limbs=[];for(const side of [-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.55,2,6),skin);arm.position.set(side*.38,1.2,-.05);arm.rotation.z=side*.12;g.add(arm);const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.105,.7,2,6),cloth);leg.position.set(side*.16,.42,0);g.add(leg);limbs.push(arm,leg)}
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.13,8),blood);stain.position.set(.12,1.25,-.295);stain.rotation.y=Math.PI;g.add(stain);
  const data={group:g,alive:true,hp:rand(72,112),speed:rand(1.2,1.75),wanderAngle:Math.random()*Math.PI*2,wanderUntil:0,heardUntil:0,nextAttack:0,groanAt:rand(1,6),deathT:0,limbs,head,torso};
  [torso,head,jaw,...limbs].forEach(m=>{m.castShadow=true;m.userData.zombie=data;m.userData.hitPart=m===head||m===jaw?'head':'body';shootables.push(m)});
  scene.add(g);zombies.push(data);return data;
}

function spawnLoot(type,x,z){
  const colors={water:0x4e96ad,food:0xb27a42,medkit:0xc9d1c5,ammo:0xb8a36b,rifle:0x6e8b68,shotgun:0x9a6547};const g=new THREE.Group();g.position.set(x,.3,z);const mat=new THREE.MeshStandardMaterial({color:colors[type]||0xffffff,emissive:colors[type]||0xffffff,emissiveIntensity:.22,roughness:.5,metalness:type==='ammo'?.45:.08});
  let mesh;if(type==='water')mesh=new THREE.Mesh(new THREE.CylinderGeometry(.11,.14,.42,9),mat);else if(type==='food')mesh=new THREE.Mesh(new THREE.BoxGeometry(.32,.24,.18),mat);else if(type==='medkit')mesh=new THREE.Mesh(new THREE.BoxGeometry(.4,.25,.32),mat);else if(type==='ammo')mesh=new THREE.Mesh(new THREE.BoxGeometry(.34,.18,.25),mat);else {mesh=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,type==='rifle'?.78:.9),mat);mesh.rotation.y=.45}
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.34,.018,5,18),new THREE.MeshBasicMaterial({color:colors[type]||0xffffff,transparent:true,opacity:.55}));ring.rotation.x=Math.PI/2;ring.position.y=-.2;g.add(mesh,ring);scene.add(g);loots.push({type,group:g,ring,picked:false,phase:Math.random()*6.28});
}

function collidesAt(x,z,r=.42){
  if(x<-81+r||x>81-r||z<-81+r||z>81-r)return true;
  for(const o of obstacles)if(x+r>o.minX&&x-r<o.maxX&&z+r>o.minZ&&z-r<o.maxZ)return true;return false;
}

function updatePlayer(dt){
  const joy=touchMove;let forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)+joy.y;let right=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joy.x;const len=Math.hypot(forward,right);if(len>1){forward/=len;right/=len}
  const sprinting=(runHeld||keys.has('ShiftLeft'))&&forward>.2&&player.stamina>1;const speed=sprinting?7.3:4.65;
  if(sprinting)player.stamina=clamp(player.stamina-dt*18,0,100);else player.stamina=clamp(player.stamina+dt*12,0,100);
  const sin=Math.sin(yaw),cos=Math.cos(yaw);let dx=(right*cos-forward*sin)*speed*dt,dz=(-right*sin-forward*cos)*speed*dt;
  let nx=player.pos.x+dx,nz=player.pos.z+dz;if(!collidesAt(nx,player.pos.z))player.pos.x=nx;if(!collidesAt(player.pos.x,nz))player.pos.z=nz;
  if(jumpQueued&&grounded){verticalVelocity=5.1;grounded=false;AudioFX.resume();jumpQueued=false}
  verticalVelocity-=12.8*dt;player.pos.y+=verticalVelocity*dt;if(player.pos.y<=1.68){player.pos.y=1.68;verticalVelocity=0;grounded=true}
  const moving=Math.abs(forward)+Math.abs(right)>.12;const bob=moving&&grounded?Math.sin(runTime*(sprinting?13:9))*0.025:0;screenShake=Math.max(0,screenShake-dt*7);
  yawNode.position.set(player.pos.x,player.pos.y+bob+rand(-screenShake,screenShake)*.02,player.pos.z);yawNode.rotation.y=yaw;pitchNode.rotation.x=pitch+rand(-screenShake,screenShake)*.008;
  const targetFov=aimHeld?settings.fov-12:settings.fov;camera.fov=lerp(camera.fov,targetFov,clamp(dt*10,0,1));camera.updateProjectionMatrix();
  recoil=lerp(recoil,0,clamp(dt*12,0,1));recoilSide=lerp(recoilSide,0,clamp(dt*15,0,1));weaponRig.rotation.x=-recoil;weaponRig.rotation.y=recoilSide;weaponRig.position.y=lerp(weaponRig.position.y,-.19+(moving?Math.sin(runTime*8)*.008:0),clamp(dt*9,0,1));
  player.hunger=clamp(player.hunger-dt*.075,0,100);player.thirst=clamp(player.thirst-dt*.105,0,100);if(player.hunger<=0||player.thirst<=0)damagePlayer(dt*2.2,false);
  noise=clamp(noise-dt*.18,0,1);if(sprinting)noise=clamp(noise+dt*.04,0,1);
  if(reloadingUntil&&performance.now()/1000>=reloadingUntil)finishReload();
  if(fireHeld&&weapons[player.weapon].automatic)shoot();
}

function updateZombies(dt){
  const now=runTime;
  for(const z of zombies){
    if(!z.alive){z.deathT+=dt;z.group.rotation.z=lerp(z.group.rotation.z,Math.PI*.48,clamp(dt*4,0,1));z.group.position.y=Math.max(-.7,z.group.position.y-dt*.13);if(z.deathT>7&&!z.group.userData.removed){z.group.userData.removed=true;scene.remove(z.group)}continue}
    const dx=player.pos.x-z.group.position.x,dz=player.pos.z-z.group.position.z,dist=Math.hypot(dx,dz);if(dist<14+noise*28)z.heardUntil=now+rand(3,7);
    let angle,speed;if(dist<18||now<z.heardUntil){angle=Math.atan2(dx,dz);speed=z.speed*(dist<2?0.55:1)}else{if(now>z.wanderUntil){z.wanderUntil=now+rand(2,5);z.wanderAngle+=rand(-1.4,1.4)}angle=z.wanderAngle;speed=z.speed*.32}
    if(dist<1.25){speed=0;if(now>z.nextAttack){z.nextAttack=now+rand(.9,1.25);damagePlayer(rand(7,12),true);AudioFX.groan(1)}}
    const mx=Math.sin(angle)*speed*dt,mz=Math.cos(angle)*speed*dt;const nx=z.group.position.x+mx,nz=z.group.position.z+mz;if(!collidesAt(nx,nz,.34)){z.group.position.x=nx;z.group.position.z=nz}else z.wanderAngle+=1.3;
    z.group.rotation.y=lerpAngle(z.group.rotation.y,angle,clamp(dt*5,0,1));const walk=Math.sin(now*7*z.speed)*.55*(speed>0?.8:0);z.limbs[0].rotation.x=walk;z.limbs[1].rotation.x=-walk;z.limbs[2].rotation.x=-walk;z.limbs[3].rotation.x=walk;
    z.groanAt-=dt;if(z.groanAt<=0&&dist<20){AudioFX.groan(clamp(1-dist/22,.2,1));z.groanAt=rand(3.5,9)}
  }
}
function lerpAngle(a,b,t){let d=((b-a+Math.PI)%(Math.PI*2))-Math.PI;return a+d*t}

function shoot(){
  if(!started||paused||dead)return;const w=weapons[player.weapon],now=performance.now()/1000;if(now<nextShotAt||reloadingUntil)return;if(w.mag<=0){AudioFX.click();toast('Sin munición · RECARGA','bad');nextShotAt=now+.35;return}
  w.mag--;nextShotAt=now+w.rate;noise=clamp(noise+w.noise,0,1);recoil=Math.min(.15,recoil+(w.id==='shotgun'?.105:w.id==='rifle'?.035:.055));recoilSide+=rand(-.018,.018);pitch=clamp(pitch-rand(.004,.012)*(w.id==='rifle'?1.2:1),-1.22,1.22);screenShake=Math.min(.7,screenShake+(w.id==='shotgun'?.45:.18));AudioFX.gun(w.id);
  weaponRig.userData.muzzle.intensity=4.5;setTimeout(()=>{if(weaponRig?.userData?.muzzle)weaponRig.userData.muzzle.intensity=0},35);
  const pellets=w.pellets||1;let hitAny=false,killAny=false;
  for(let p=0;p<pellets;p++){
    const origin=new THREE.Vector3();camera.getWorldPosition(origin);const dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));const rightV=new THREE.Vector3(1,0,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));const upV=new THREE.Vector3(0,1,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));const spread=w.spread*(aimHeld?.55:1)*(1+noise*.2);dir.addScaledVector(rightV,rand(-spread,spread)).addScaledVector(upV,rand(-spread,spread)).normalize();raycaster.set(origin,dir);raycaster.far=w.id==='shotgun'?45:85;
    const hits=raycaster.intersectObjects(shootables.filter(m=>m.userData.zombie?.alive),false);if(hits.length){const h=hits[0],z=h.object.userData.zombie;if(z?.alive){const head=h.object.userData.hitPart==='head';const dmg=w.damage*(head?w.head:1)*rand(.92,1.08);z.hp-=dmg;z.heardUntil=runTime+7;hitAny=true;if(z.hp<=0){killZombie(z,head);killAny=true}else hitFlash(z)}}
  }
  if(hitAny)showHitmarker(killAny);updateAmmoUI();
}
function hitFlash(z){const old=z.torso.material.emissive?.clone?.();if(z.torso.material.emissive){z.torso.material.emissive.set(0x5b130d);z.torso.material.emissiveIntensity=.55;setTimeout(()=>{if(z.alive){z.torso.material.emissive.set(old||0x000000);z.torso.material.emissiveIntensity=0}},80)}}
function killZombie(z,headshot=false){if(!z.alive)return;z.alive=false;player.kills++;noise=clamp(noise+.08,0,1);toast(headshot?'TIRO A LA CABEZA +1':'Zombi abatido +1','good');if(Math.random()<.42){const types=['ammo','food','water','medkit'];spawnLoot(types[Math.floor(Math.random()*types.length)],z.group.position.x+rand(-.4,.4),z.group.position.z+rand(-.4,.4))}if(player.kills===3&&currentObjective<2){setObjective(2)} }

function reload(){
  const w=weapons[player.weapon];if(reloadingUntil||w.mag>=w.magSize||w.reserve<=0)return;AudioFX.resume();reloadingUntil=performance.now()/1000+w.reload;toast('Recargando…');$('fire-mode').textContent='RECARGANDO';
}
function finishReload(){const w=weapons[player.weapon],need=w.magSize-w.mag,take=Math.min(need,w.reserve);w.mag+=take;w.reserve-=take;reloadingUntil=0;updateAmmoUI()}
function switchWeapon(i){const w=weapons[i];if(!w?.unlocked){toast('Aún no tienes esa arma','bad');return}player.weapon=i;reloadingUntil=0;buildWeapon();document.querySelectorAll('.slot[data-slot]').forEach((b,j)=>b.classList.toggle('active',j===i));updateAmmoUI();AudioFX.click()}

function damagePlayer(amount,flash=true){if(dead)return;player.hp=clamp(player.hp-amount,0,100);if(flash){screenShake=.6;$('damage-vignette').style.opacity='.9';setTimeout(()=>$('damage-vignette').style.opacity='0',180)}if(player.hp<=0)die()}
function consume(type){const n=player.inventory[type]||0;if(n<=0){toast('No te queda','bad');return}if(type==='medkit'){if(player.hp>96){toast('Tu vida ya está casi llena');return}player.hp=clamp(player.hp+45,0,100)}if(type==='food')player.hunger=clamp(player.hunger+38,0,100);if(type==='water')player.thirst=clamp(player.thirst+48,0,100);player.inventory[type]--;AudioFX.pickup();toast(type==='medkit'?'Botiquín usado':type==='food'?'Has comido':'Has bebido','good');updateUI(true)}

function updateLoot(dt){
  interactTarget=null;let nearest=2.25;
  for(const l of loots){if(l.picked)continue;l.group.position.y=.32+Math.sin(runTime*2+l.phase)*.045;l.ring.rotation.z+=dt*.65;const d=Math.hypot(player.pos.x-l.group.position.x,player.pos.z-l.group.position.z);if(d<nearest){nearest=d;interactTarget=l}}
  if(interactTarget){$('interact-prompt').classList.remove('hidden');$('interact-text').textContent=lootLabel(interactTarget.type)}else $('interact-prompt').classList.add('hidden');
  if(currentObjective===0&&Math.hypot(player.pos.x+27,player.pos.z-9)<12)setObjective(1);
}
function lootLabel(t){return ({water:'Recoger agua',food:'Recoger comida',medkit:'Recoger botiquín',ammo:'Recoger munición',rifle:'Recoger M4A1',shotgun:'Recoger M870'})[t]||'Recoger'}
function interact(){if(!interactTarget)return;const l=interactTarget;l.picked=true;scene.remove(l.group);if(l.type==='rifle'){const w=weapons[1];w.unlocked=true;w.mag=30;w.reserve+=90;unlockSlot(1);switchWeapon(1);toast('M4A1 CONSEGUIDO','good');setObjective(2)}else if(l.type==='shotgun'){const w=weapons[2];w.unlocked=true;w.mag=6;w.reserve+=24;unlockSlot(2);toast('M870 CONSEGUIDA','good')}else if(l.type==='ammo'){for(const w of weapons)if(w.unlocked)w.reserve+=w.id==='shotgun'?6:w.id==='rifle'?24:18;toast('Munición recogida','good')}else{player.inventory[l.type]=(player.inventory[l.type]||0)+1;toast(lootLabel(l.type).replace('Recoger ','')+' +1','good')}AudioFX.pickup();interactTarget=null;updateUI(true)}
function unlockSlot(i){const b=document.querySelector(`.slot[data-slot="${i}"]`);b?.classList.remove('locked')}

function setObjective(i){currentObjective=i;const o=[['Registra la gasolinera','Busca suministros para sobrevivir'],['Encuentra un rifle','La tienda puede tener armas'],['Mantente con vida','Saquea la zona y evita quedar rodeado']][i];$('objective-text').textContent=o[0];$('objective-sub').textContent=o[1];toast('OBJETIVO ACTUALIZADO')}

function updateWorldTime(){
  const simHours=8+runTime/300*24;const day=Math.floor(simHours/24)+1,hour=simHours%24;const daylight=clamp(Math.sin((hour-6)/24*Math.PI*2)*1.8+.15,0,1);sun.intensity=.08+daylight*2.2;hemi.intensity=.18+daylight*1.15;renderer.toneMappingExposure=.55+daylight*.42;
  const dayC=new THREE.Color(0x929b95),nightC=new THREE.Color(0x0b1116);tempColor.copy(nightC).lerp(dayC,daylight);scene.background.copy(tempColor);scene.fog.color.copy(tempColor);scene.fog.density=lerp(.020,.0135,daylight);streetLights.forEach(l=>l.intensity=daylight<.35?(1-daylight)*1.45:0);
  const ang=(hour-6)/24*Math.PI*2;sun.position.set(Math.cos(ang)*50,Math.max(5,Math.sin(ang)*60),Math.sin(ang*.7)*35);
  $('day-label').textContent=`DÍA ${day}`;$('day-value').textContent=day;$('clock-label').textContent=`${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor((hour%1)*60)).padStart(2,'0')}`;
}

function spawnDirector(dt){
  spawnAccumulator+=dt;waveAccumulator+=dt;const alive=zombies.filter(z=>z.alive).length;const cap=settings.quality==='low'?13:settings.quality==='high'?22:17;const interval=Math.max(4.5,10-player.kills*.035);
  if(spawnAccumulator>interval&&alive<cap){spawnAccumulator=0;spawnZombie(randomSpawn(24,48))}
  if(waveAccumulator>85){waveAccumulator=0;toast('Algo se mueve entre los edificios…','bad');for(let i=0;i<Math.min(4,cap-alive);i++)spawnZombie(randomSpawn(20,34))}
}

function updateUI(force=false){
  if(!force&&uiAccumulator<.1)return;uiAccumulator=0;$('hp-bar').style.width=player.hp+'%';$('hunger-bar').style.width=player.hunger+'%';$('thirst-bar').style.width=player.thirst+'%';$('stamina-bar').style.width=player.stamina+'%';$('hp-value').textContent=Math.ceil(player.hp);$('hunger-value').textContent=Math.ceil(player.hunger);$('thirst-value').textContent=Math.ceil(player.thirst);$('kills-value').textContent=player.kills;$('noise-value').textContent=Math.round(noise*100)+'%';$('medkit-count').textContent='x'+player.inventory.medkit;$('food-count').textContent='x'+player.inventory.food;$('water-count').textContent='x'+player.inventory.water;
  const nearby=zombies.filter(z=>z.alive&&z.group.position.distanceTo(player.pos)<15).length;$('threat-label').textContent=nearby>4?'AMENAZA CRÍTICA':nearby>1?'AMENAZA ALTA':'AMENAZA BAJA';$('threat-label').style.color=nearby>4?'#dc6452':nearby>1?'#d49a4e':'#9fbc87';updateAmmoUI();
}
function updateAmmoUI(){const w=weapons[player.weapon];$('weapon-name').textContent=w.label;$('ammo-mag').textContent=w.mag;$('ammo-reserve').textContent=w.reserve;$('fire-mode').textContent=reloadingUntil?'RECARGANDO':w.mode;$('pistol-stock').textContent=`${weapons[0].mag}/${weapons[0].reserve}`;$('rifle-stock').textContent=weapons[1].unlocked?`${weapons[1].mag}/${weapons[1].reserve}`:'BLOQ.';$('shotgun-stock').textContent=weapons[2].unlocked?`${weapons[2].mag}/${weapons[2].reserve}`:'BLOQ.'}
function showHitmarker(kill=false){const h=$('hitmarker');h.className=kill?'show kill':'show';clearTimeout(showHitmarker.t);showHitmarker.t=setTimeout(()=>h.className='',110)}
function toast(text,type=''){const stack=$('toast-stack'),el=document.createElement('div');el.className='toast '+type;el.textContent=text;stack.appendChild(el);setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(-4px)';el.style.transition='.25s';setTimeout(()=>el.remove(),260)},2200)}

function die(){dead=true;fireHeld=false;document.exitPointerLock?.();const day=parseInt($('day-value').textContent)||1;$('death-kills').textContent=player.kills;$('death-time').textContent=formatTime(runTime);$('death-day').textContent=day;$('hud').classList.add('hidden');$('death').classList.remove('hidden');$('death').classList.add('show');if(player.kills>best.kills||runTime>best.time){best.kills=Math.max(best.kills,player.kills);best.time=Math.max(best.time,runTime);best.day=Math.max(best.day,day);localStorage.setItem(SAVE_KEY,JSON.stringify(best))}}
function formatTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`}

let touchMove={x:0,y:0},joyPointer=null,joyOrigin={x:0,y:0},lookPointer=null,lookLast={x:0,y:0};
function setupControls(){
  const joy=$('joystick'),stick=$('joy-stick');
  joy.addEventListener('pointerdown',e=>{AudioFX.resume();joyPointer=e.pointerId;joy.setPointerCapture(e.pointerId);const r=joy.getBoundingClientRect();joyOrigin={x:r.left+r.width/2,y:r.top+r.height/2};moveJoy(e);e.preventDefault()});
  joy.addEventListener('pointermove',e=>{if(e.pointerId===joyPointer)moveJoy(e)});const joyUp=e=>{if(e.pointerId!==joyPointer)return;joyPointer=null;touchMove={x:0,y:0};stick.style.transform='translate(-50%,-50%)'};joy.addEventListener('pointerup',joyUp);joy.addEventListener('pointercancel',joyUp);
  function moveJoy(e){let dx=e.clientX-joyOrigin.x,dy=e.clientY-joyOrigin.y;const max=33,l=Math.hypot(dx,dy)||1;if(l>max){dx=dx/l*max;dy=dy/l*max}touchMove={x:dx/max,y:-dy/max};stick.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`}
  const look=$('look-zone');look.addEventListener('pointerdown',e=>{AudioFX.resume();lookPointer=e.pointerId;look.setPointerCapture(e.pointerId);lookLast={x:e.clientX,y:e.clientY};e.preventDefault()});look.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointer||paused)return;const dx=e.clientX-lookLast.x,dy=e.clientY-lookLast.y;lookLast={x:e.clientX,y:e.clientY};rotateLook(dx,dy,.0037)});const lookUp=e=>{if(e.pointerId===lookPointer)lookPointer=null};look.addEventListener('pointerup',lookUp);look.addEventListener('pointercancel',lookUp);
  bindHold($('fire-btn'),()=>{fireHeld=true;const w=weapons[player.weapon];if(!w.automatic)shoot()},()=>fireHeld=false);
  bindHold($('run-btn'),()=>runHeld=true,()=>runHeld=false);bindHold($('aim-btn'),()=>aimHeld=true,()=>aimHeld=false);
  $('reload-btn').addEventListener('pointerdown',e=>{e.stopPropagation();reload()});$('use-btn').addEventListener('pointerdown',e=>{e.stopPropagation();interact()});$('jump-btn').addEventListener('pointerdown',e=>{e.stopPropagation();jumpQueued=true});
  document.querySelectorAll('.slot[data-slot]').forEach((b,i)=>b.addEventListener('pointerdown',e=>{e.stopPropagation();switchWeapon(i)}));document.querySelectorAll('.slot[data-item]').forEach(b=>b.addEventListener('pointerdown',e=>{e.stopPropagation();consume(b.dataset.item)}));
  window.addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='KeyR')reload();if(e.code==='KeyE')interact();if(e.code==='Space'){jumpQueued=true;e.preventDefault()}if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(2);if(e.code==='Escape'&&started)togglePause(true)});
  window.addEventListener('keyup',e=>keys.delete(e.code));document.addEventListener('mousemove',e=>{if(document.pointerLockElement===renderer?.domElement&&!paused)rotateLook(e.movementX,e.movementY,.0022)});renderer.domElement.addEventListener('mousedown',e=>{if(!started||paused)return;AudioFX.resume();if(!isTouch&&document.pointerLockElement!==renderer.domElement){renderer.domElement.requestPointerLock?.();return}if(e.button===0){fireHeld=true;if(!weapons[player.weapon].automatic)shoot()}if(e.button===2)aimHeld=true});window.addEventListener('mouseup',e=>{if(e.button===0)fireHeld=false;if(e.button===2)aimHeld=false});renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
}
function bindHold(el,on,off){el.addEventListener('pointerdown',e=>{e.stopPropagation();el.setPointerCapture?.(e.pointerId);el.classList.add('pressed');AudioFX.resume();on()});const end=e=>{e.stopPropagation();el.classList.remove('pressed');off()};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end)}
function rotateLook(dx,dy,mult){yaw-=dx*mult*settings.sensitivity;pitch=clamp(pitch-dy*mult*settings.sensitivity,-1.28,1.28)}

function setupMenus(){
  $('play-btn').addEventListener('click',startGame);$('pause-btn').addEventListener('pointerdown',()=>togglePause(true));$('resume-btn').addEventListener('click',()=>togglePause(false));$('resume-btn-2').addEventListener('click',()=>togglePause(false));$('restart-btn').addEventListener('click',()=>location.reload());$('retry-btn').addEventListener('click',()=>location.reload());
  const sens=$('sensitivity'),fov=$('fov'),vol=$('volume');sens.value=settings.sensitivity;fov.value=settings.fov;vol.value=settings.volume;$('sens-out').textContent=Number(settings.sensitivity).toFixed(2);$('fov-out').textContent=settings.fov;$('volume-out').textContent=Math.round(settings.volume*100)+'%';
  sens.addEventListener('input',()=>{settings.sensitivity=+sens.value;$('sens-out').textContent=settings.sensitivity.toFixed(2);saveSettings()});fov.addEventListener('input',()=>{settings.fov=+fov.value;$('fov-out').textContent=settings.fov;saveSettings()});vol.addEventListener('input',()=>{settings.volume=+vol.value;$('volume-out').textContent=Math.round(settings.volume*100)+'%';AudioFX.setVolume(settings.volume);saveSettings()});document.querySelectorAll('[data-quality]').forEach(b=>{b.classList.toggle('active',b.dataset.quality===settings.quality);b.addEventListener('click',()=>{settings.quality=b.dataset.quality;document.querySelectorAll('[data-quality]').forEach(x=>x.classList.toggle('active',x===b));applyQuality(settings.quality);saveSettings()})});
}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function applyQuality(q){if(!renderer)return;const d=devicePixelRatio||1;renderer.setPixelRatio(q==='low'?1:q==='high'?Math.min(d,1.7):Math.min(d,1.28));renderer.shadowMap.enabled=q!=='low';scene.fog.density=q==='low'?.017:.0135}
function togglePause(v){if(dead)return;paused=v;$('pause').classList.toggle('hidden',!v);if(v){fireHeld=false;document.exitPointerLock?.()}else{clock.getDelta();AudioFX.resume()}}

async function startGame(){
  AudioFX.resume();$('loading').classList.remove('hidden');$('boot').classList.remove('show');$('boot').classList.add('hidden');
  try{if(screen.orientation?.lock)await screen.orientation.lock('landscape').catch(()=>{});if(document.documentElement.requestFullscreen&&isTouch)await document.documentElement.requestFullscreen().catch(()=>{})}catch{}
  setTimeout(()=>{$('loading').classList.add('hidden');$('hud').classList.remove('hidden');started=true;clock.getDelta();toast('Has entrado en la Zona Muerta');updateUI(true)},420);
}

function onResize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);applyQuality(settings.quality)}

function loop(){requestAnimationFrame(loop);if(!renderer)return;let dt=Math.min(clock.getDelta(),.05);if(started&&!paused&&!dead){runTime+=dt;uiAccumulator+=dt;updatePlayer(dt);updateZombies(dt);updateLoot(dt);spawnDirector(dt);updateWorldTime();updateUI();}
  renderer.render(scene,camera);
}

initThree();setupControls();setupMenus();updateAmmoUI();loop();
