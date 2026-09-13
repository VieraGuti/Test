import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SETTINGS_KEY = 'vast_dead_zone_settings_v2';
const SAVE_KEY = 'vast_dead_zone_save_v2';
const BEST_KEY = 'vast_dead_zone_best_v2';
const WORLD_LIMIT = 126;

const settings = Object.assign({ sensitivity: 1, fov: 72, volume: .8, quality: 'medium' }, safeJSON(localStorage.getItem(SETTINGS_KEY), {}));
const saveData = safeJSON(localStorage.getItem(SAVE_KEY), null);
const best = Object.assign({ kills: 0, time: 0, day: 1 }, safeJSON(localStorage.getItem(BEST_KEY), {}));

function safeJSON(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

const ITEM_DEFS = {
  medkit: { name: 'Botiquín', short: 'MED', stack: 2, kind: 'medical', desc: '+45 vida' },
  bandage: { name: 'Venda', short: 'VND', stack: 4, kind: 'medical', desc: 'Detiene sangrado' },
  food: { name: 'Conserva', short: 'COM', stack: 4, kind: 'food', desc: '+38 hambre' },
  water: { name: 'Agua', short: 'H2O', stack: 3, kind: 'drink', desc: '+48 agua' },
  ammo9: { name: '9mm', short: '9MM', stack: 30, kind: 'ammo', desc: 'Munición M9' },
  ammo556: { name: '5.56', short: '556', stack: 30, kind: 'ammo', desc: 'Munición M4A1' },
  shells: { name: 'Cal. 12', short: '12G', stack: 12, kind: 'ammo', desc: 'Munición M870' },
  backpack_small: { name: 'Mochila de asalto', short: 'BAG', stack: 1, kind: 'gear', desc: '18 huecos' },
  backpack_large: { name: 'Mochila militar', short: 'MIL', stack: 1, kind: 'gear', desc: '28 huecos' },
  rifle: { name: 'M4A1', short: 'M4', stack: 1, kind: 'weapon', desc: 'Rifle automático' },
  shotgun: { name: 'M870', short: '870', stack: 1, kind: 'weapon', desc: 'Escopeta de corredera' }
};

const BAG_SLOTS = [10, 18, 28];

let renderer, scene, camera, yawNode, pitchNode, weaponRig, sun, hemi, clock;
let started = false, paused = false, inventoryOpen = false, dead = false;
let isTouch = matchMedia('(pointer: coarse)').matches;
let runTime = saveData?.runTime || 0;
let uiAccumulator = 0, spawnAccumulator = 0, waveAccumulator = 0, autosaveAccumulator = 0;
let currentObjective = saveData?.objective || 0;
let interactTarget = null, activeContainer = null, nextShotAt = 0, reloadingUntil = 0;
let fireHeld = false, aimHeld = false, runHeld = false, jumpQueued = false;
let yaw = saveData?.yaw || 0, pitch = saveData?.pitch || 0, verticalVelocity = 0, grounded = true;
let recoil = 0, recoilSide = 0, noise = 0, screenShake = 0;
let pickedLootIds = new Set(saveData?.pickedLootIds || []);
let savedContainers = saveData?.containers || {};

const obstacles = [], zombies = [], shootables = [], loots = [], containers = [], doors = [], streetLights = [], objectiveBeacons = [];
const keys = new Set();
const raycaster = new THREE.Raycaster();
const tempColor = new THREE.Color();

const player = {
  pos: new THREE.Vector3(saveData?.pos?.x ?? 0, 1.68, saveData?.pos?.z ?? 48),
  hp: saveData?.hp ?? 100,
  hunger: saveData?.hunger ?? 100,
  thirst: saveData?.thirst ?? 100,
  stamina: saveData?.stamina ?? 100,
  bleeding: saveData?.bleeding ?? 0,
  kills: saveData?.kills ?? 0,
  bagLevel: saveData?.bagLevel ?? 0,
  inventory: Object.assign({ medkit: 1, bandage: 1, food: 1, water: 1, ammo9: 30, ammo556: 0, shells: 0 }, saveData?.inventory || {}),
  weapon: saveData?.weapon ?? 0
};

const weapons = [
  { id:'pistol', label:'M9', mode:'SEMI', ammoType:'ammo9', unlocked:true, magSize:15, mag:saveData?.weapons?.[0]?.mag ?? 15, damage:34, head:2.45, rate:.18, automatic:false, spread:.0045, noise:.48, reload:1.2 },
  { id:'rifle', label:'M4A1', mode:'AUTO', ammoType:'ammo556', unlocked:saveData?.weapons?.[1]?.unlocked ?? false, magSize:30, mag:saveData?.weapons?.[1]?.mag ?? 0, damage:26, head:2.7, rate:.095, automatic:true, spread:.008, noise:.78, reload:1.6 },
  { id:'shotgun', label:'M870', mode:'PUMP', ammoType:'shells', unlocked:saveData?.weapons?.[2]?.unlocked ?? false, magSize:6, mag:saveData?.weapons?.[2]?.mag ?? 0, damage:15, head:1.55, rate:.72, automatic:false, spread:.04, pellets:8, noise:1, reload:1.8 }
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
    const len = this.ctx.sampleRate * .38;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/len, 1.55);
  },
  resume(){ this.init(); if(this.ctx?.state === 'suspended') this.ctx.resume(); },
  setVolume(v){ if(this.master) this.master.gain.value = v; },
  burst({gain=.4,duration=.12,low=130,high=2200,tone=70}={}){
    if(!this.ctx) return;
    const now=this.ctx.currentTime;
    const src=this.ctx.createBufferSource(); src.buffer=this.noiseBuffer;
    const filter=this.ctx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=high; filter.Q.value=.7;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(gain,now); g.gain.exponentialRampToValueAtTime(.001,now+duration);
    src.connect(filter); filter.connect(g); g.connect(this.master); src.start(now); src.stop(now+duration);
    const osc=this.ctx.createOscillator(), og=this.ctx.createGain(); osc.type='triangle'; osc.frequency.setValueAtTime(tone,now); osc.frequency.exponentialRampToValueAtTime(low,now+duration*.8);
    og.gain.setValueAtTime(gain*.4,now); og.gain.exponentialRampToValueAtTime(.001,now+duration); osc.connect(og); og.connect(this.master); osc.start(now); osc.stop(now+duration);
  },
  gun(id){ this.resume(); if(id==='shotgun')this.burst({gain:.78,duration:.25,high:900,tone:95,low:42}); else if(id==='rifle')this.burst({gain:.48,duration:.11,high:1900,tone:115,low:65}); else this.burst({gain:.42,duration:.13,high:2450,tone:150,low:78}); },
  click(){ this.resume(); this.burst({gain:.05,duration:.025,high:3200,tone:500,low:340}); },
  pickup(){ if(!this.ctx)return; const now=this.ctx.currentTime; [520,690].forEach((f,i)=>{const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.05,now+i*.05);g.gain.exponentialRampToValueAtTime(.001,now+.13+i*.05);o.connect(g);g.connect(this.master);o.start(now+i*.05);o.stop(now+.16+i*.05)}); },
  groan(strength=.25){ if(!this.ctx||Math.random()>.35)return; const now=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();o.type='sawtooth';o.frequency.setValueAtTime(rand(62,82),now);o.frequency.linearRampToValueAtTime(rand(38,55),now+.45);f.type='lowpass';f.frequency.value=350;g.gain.setValueAtTime(.0001,now);g.gain.linearRampToValueAtTime(.025*strength,now+.05);g.gain.exponentialRampToValueAtTime(.001,now+.48);o.connect(f);f.connect(g);g.connect(this.master);o.start(now);o.stop(now+.5); }
};

function makeTexture(base='#55534d', fleck='#6b675f', size=128){
  const c=document.createElement('canvas'); c.width=c.height=size; const x=c.getContext('2d');
  x.fillStyle=base; x.fillRect(0,0,size,size);
  for(let i=0;i<850;i++){x.globalAlpha=rand(.03,.18);x.fillStyle=Math.random()>.5?fleck:'#222';const s=rand(.3,2.2);x.fillRect(Math.random()*size,Math.random()*size,s,s)}
  x.globalAlpha=1;
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(8,8);t.colorSpace=THREE.SRGBColorSpace;return t;
}

function addObstacle(minX,maxX,minZ,maxZ, tag='world'){
  const o={minX,maxX,minZ,maxZ,active:true,tag}; obstacles.push(o); return o;
}

function addBlock(x,z,w,d,h,material,collision=true,y=0){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y+h/2,z);m.castShadow=h>1;m.receiveShadow=true;scene.add(m);
  if(collision) addObstacle(x-w/2,x+w/2,z-d/2,z+d/2); return m;
}

function addWall(x,z,w,d,h,material){ return addBlock(x,z,w,d,h,material,true,0); }

function initThree(){
  scene=new THREE.Scene();scene.background=new THREE.Color(0x89918d);scene.fog=new THREE.FogExp2(0x818985,.0087);
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$('game-root').appendChild(renderer.domElement);
  camera=new THREE.PerspectiveCamera(settings.fov,innerWidth/innerHeight,.025,240);yawNode=new THREE.Object3D();pitchNode=new THREE.Object3D();yawNode.add(pitchNode);pitchNode.add(camera);scene.add(yawNode);yawNode.position.copy(player.pos);
  hemi=new THREE.HemisphereLight(0xcbd5d0,0x40372f,1.32);scene.add(hemi);
  sun=new THREE.DirectionalLight(0xffe4bf,2.15);sun.position.set(-34,55,18);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-72;sun.shadow.camera.right=72;sun.shadow.camera.top=72;sun.shadow.camera.bottom=-72;sun.shadow.camera.near=.1;sun.shadow.camera.far=160;scene.add(sun);
  buildWorld();buildWeapon();applyQuality(settings.quality);clock=new THREE.Clock();window.addEventListener('resize',onResize,{passive:true});
}

function buildWorld(){
  const dirt=makeTexture('#514c40','#766e5c'), asphalt=makeTexture('#353b39','#555d58'), wallTex=makeTexture('#626761','#8b9087');
  dirt.repeat.set(32,32);asphalt.repeat.set(18,18);wallTex.repeat.set(3,2);
  const groundMat=new THREE.MeshStandardMaterial({map:dirt,roughness:1,color:0x88816d});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(260,260),groundMat);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const roadMat=new THREE.MeshStandardMaterial({map:asphalt,roughness:.95,color:0x777a73});
  const roadNS=new THREE.Mesh(new THREE.PlaneGeometry(18,255),roadMat);roadNS.rotation.x=-Math.PI/2;roadNS.position.y=.012;scene.add(roadNS);
  const roadEW=new THREE.Mesh(new THREE.PlaneGeometry(255,17),roadMat);roadEW.rotation.x=-Math.PI/2;roadEW.rotation.z=Math.PI/2;roadEW.position.y=.014;scene.add(roadEW);
  const stripeMat=new THREE.MeshBasicMaterial({color:0xc7b978});
  for(let z=-118;z<118;z+=9){const s=new THREE.Mesh(new THREE.PlaneGeometry(.16,4.2),stripeMat);s.rotation.x=-Math.PI/2;s.position.set(0,.02,z);scene.add(s)}

  const concrete=new THREE.MeshStandardMaterial({map:wallTex,color:0xa5a69b,roughness:.9});
  const tan=new THREE.MeshStandardMaterial({color:0x777062,roughness:.92});
  const dark=new THREE.MeshStandardMaterial({color:0x303735,roughness:.8});
  const military=new THREE.MeshStandardMaterial({color:0x596257,roughness:.88});
  const rusty=new THREE.MeshStandardMaterial({color:0x714b37,roughness:.9});
  const red=new THREE.MeshStandardMaterial({color:0x84382f,roughness:.82});

  buildRoom({id:'gas-store',x:-44,z:16,w:17,d:13,h:4.5,mat:tan,door:'south',doorId:'door-gas'});
  addBlock(-31,16,14,9,.42,red,false,4.7);
  for(const x of [-35,-27]){addBlock(x,13,.35,.35,4.7,dark,true);addBlock(x,17,1.1,.8,1.8,red,true)}
  addShelf(-48,17.5,5.4,1.1);addShelf(-41,20,4.4,1.1);
  spawnLoose('water',-47,18,'gas-water');spawnLoose('food',-42,20,'gas-food');spawnLoose('ammo9',-39,17,'gas-9mm');
  spawnContainer('gas-cache','Caja de suministros',-47,12.5,{bandage:2,food:2,water:1,ammo9:24});

  buildRoom({id:'clinic',x:46,z:43,w:26,d:19,h:6,mat:concrete,door:'west',doorId:'door-clinic'});
  addShelf(51,46,7,1.1);addShelf(51,40,7,1.1);addWall(43,43,.3,13,3.1,dark);
  spawnContainer('clinic-med','Armario médico',50,45,{medkit:2,bandage:4,water:1});
  spawnLoose('backpack_small',42,47,'clinic-bag');spawnLoose('bandage',39,40,'clinic-bandage');

  buildPerimeter(55,-55,48,42,military);
  buildRoom({id:'barracks',x:47,z:-55,w:24,d:14,h:5.4,mat:military,door:'south',doorId:'door-barracks'});
  buildRoom({id:'armory',x:70,z:-55,w:15,d:13,h:5,mat:dark,door:'west',doorId:'door-armory'});
  addShelf(47,-57,7,1.1);addShelf(70,-58,6,1.1);
  spawnContainer('mil-rifle','Caja de armas',72,-56,{rifle:1,ammo556:90,bandage:2});
  spawnContainer('mil-gear','Taquilla militar',65,-52,{backpack_large:1,medkit:1,ammo556:45,shells:12});
  spawnLoose('shotgun',45,-52,'mil-shotgun');

  buildRoom({id:'house-a',x:-47,z:-42,w:18,d:15,h:5.2,mat:tan,door:'east',doorId:'door-house-a'});
  buildRoom({id:'house-b',x:-72,z:-19,w:16,d:13,h:4.8,mat:concrete,door:'south',doorId:'door-house-b'});
  buildRoom({id:'barn',x:-69,z:66,w:24,d:20,h:7,mat:rusty,door:'east',doorId:'door-barn'});
  addShelf(-50,-43,5,1);addShelf(-70,-17,4,1);addShelf(-72,68,7,1.2);
  spawnContainer('house-a-food','Despensa',-50,-44,{food:3,water:2,bandage:1});
  spawnContainer('house-b-cache','Cajón viejo',-69,-17,{ammo9:18,food:1,water:1});
  spawnContainer('barn-tools','Cofre del granero',-72,67,{shells:12,food:2,bandage:1});

  [[9,25,.2],[-8,-23,-.5],[12,-70,1.1],[-12,64,-1.2],[-78,-5,.7],[83,50,-.6],[32,4,.4],[-35,4,-.2]].forEach(([x,z,r])=>addCar(x,z,r));
  const containerColors=[0x51665f,0x82523d,0x4a5868,0x6e694d];
  [[24,8,0],[36,6,Math.PI/2],[86,-11,0],[-89,23,Math.PI/2],[-92,30,Math.PI/2],[92,17,0]].forEach((p,i)=>{const mat=new THREE.MeshStandardMaterial({color:containerColors[i%containerColors.length],roughness:.72,metalness:.2});const c=addBlock(p[0],p[1],6.2,2.6,2.55,mat,true);c.rotation.y=p[2]});
  for(let i=0;i<55;i++){let x=rand(-118,118),z=rand(-118,118);if(Math.abs(x)<15||Math.abs(z)<14)continue;if((x>25&&z<-30)||(x>30&&z>28))continue;addDeadTree(x,z,rand(.75,1.35))}
  for(let z=-98;z<=98;z+=22){addLamp(-10,z);addLamp(10,z)}
  for(let x=-96;x<=96;x+=24){if(Math.abs(x)<12)continue;addLamp(x,-10)}

  spawnLoose('water',13,70,'road-water');spawnLoose('food',-16,-73,'road-food');spawnLoose('bandage',18,-12,'road-bandage');

  createObjectiveBeacon(-44,16,0);createObjectiveBeacon(46,43,1);createObjectiveBeacon(60,-55,2);updateBeaconVisibility();
  for(let i=0;i<9;i++)spawnZombie(randomSpawn(24,65));
}

function buildRoom({id,x,z,w,d,h,mat,door='south',doorId}){
  const floorMat=new THREE.MeshStandardMaterial({color:0x4b4d48,roughness:1});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(w,d),floorMat);floor.rotation.x=-Math.PI/2;floor.position.set(x,.02,z);floor.receiveShadow=true;scene.add(floor);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(w+.3,.24,d+.3),mat);roof.position.set(x,h+.12,z);roof.castShadow=true;scene.add(roof);
  const t=.28,gap=1.7;
  const horizontal=(zz,side)=>{if(door===side){const seg=(w-gap)/2;addWall(x-(gap/2+seg/2),zz,seg,t,h,mat);addWall(x+(gap/2+seg/2),zz,seg,t,h,mat);addDoor(doorId,x,zz,1.65,2.45,'x',side==='north'?-1:1)}else addWall(x,zz,w,t,h,mat)};
  const vertical=(xx,side)=>{if(door===side){const seg=(d-gap)/2;addWall(xx,z-(gap/2+seg/2),t,seg,h,mat);addWall(xx,z+(gap/2+seg/2),t,seg,h,mat);addDoor(doorId,xx,z,1.65,2.45,'z',side==='west'?-1:1)}else addWall(xx,z,t,d,h,mat)};
  horizontal(z-d/2,'south');horizontal(z+d/2,'north');vertical(x-w/2,'west');vertical(x+w/2,'east');
  const winMat=new THREE.MeshBasicMaterial({color:0x14201f});for(const sx of [-.25,.25]){const p=new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.05),winMat);p.position.set(x+w*sx,2.7,z-d/2-.145);p.rotation.y=Math.PI;scene.add(p)}
  const light=new THREE.PointLight(0xffd8a4,.28,11,2);light.position.set(x,h-1,z);scene.add(light);
}

function buildPerimeter(x,z,w,d,mat){
  const t=.22,h=2.4,gap=4,seg=(w-gap)/2;addWall(x-(gap/2+seg/2),z-d/2,seg,t,h,mat);addWall(x+(gap/2+seg/2),z-d/2,seg,t,h,mat);
  addWall(x,z+d/2,w,t,h,mat);addWall(x-w/2,z,t,d,h,mat);addWall(x+w/2,z,t,d,h,mat);for(let xx=x-w/2;xx<=x+w/2;xx+=5)addFence(xx,z+d/2+.35);
}

function addDoor(id,x,z,width,height,axis='x',swing=1){
  const pivot=new THREE.Group();pivot.position.set(axis==='x'?x-width/2:x,0,axis==='z'?z-width/2:z);scene.add(pivot);
  const mat=new THREE.MeshStandardMaterial({color:0x403d36,roughness:.82,metalness:.15});const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,.12),mat);mesh.position.set(width/2,height/2,0);mesh.castShadow=true;pivot.add(mesh);if(axis==='z')pivot.rotation.y=Math.PI/2;
  const obs=axis==='x'?addObstacle(x-width/2,x+width/2,z-.2,z+.2,'door'):addObstacle(x-.2,x+.2,z-width/2,z+width/2,'door');const data={type:'door',id,pivot,mesh,obs,x,z,width,axis,open:false,swing};doors.push(data);return data;
}

function toggleDoor(d){if(!d)return;if(d.open){if(Math.hypot(player.pos.x-d.x,player.pos.z-d.z)<1.35){toast('Apártate para cerrar la puerta','bad');return}d.open=false;d.obs.active=true;d.pivot.rotation.y=(d.axis==='z'?Math.PI/2:0)}else{d.open=true;d.obs.active=false;d.pivot.rotation.y=(d.axis==='z'?Math.PI/2:0)+d.swing*Math.PI/2}AudioFX.click()}

function addShelf(x,z,w=5,d=1){const mat=new THREE.MeshStandardMaterial({color:0x4a443b,roughness:.95});addBlock(x,z,w,d,.22,mat,true,.6);addBlock(x,z,w,d,.18,mat,false,1.6);for(const sx of [-w/2+.2,w/2-.2])addBlock(x+sx,z,.14,.14,1.65,mat,false,0)}
function addCar(x,z,r=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=r;const bodyMat=new THREE.MeshStandardMaterial({color:[0x555d58,0x75554a,0x4a555f][Math.floor(Math.random()*3)],roughness:.72,metalness:.28});const lower=new THREE.Mesh(new THREE.BoxGeometry(3.3,.65,1.55),bodyMat);lower.position.y=.65;const top=new THREE.Mesh(new THREE.BoxGeometry(1.9,.62,1.42),bodyMat);top.position.set(-.25,1.22,0);g.add(lower,top);const tireMat=new THREE.MeshStandardMaterial({color:0x151716,roughness:1});for(const sx of [-1.05,1.05])for(const sz of [-.82,.82]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.18,12),tireMat);w.rotation.x=Math.PI/2;w.position.set(sx,.42,sz);g.add(w)}scene.add(g);addObstacle(x-1.85,x+1.85,z-1.35,z+1.35,'car')}
function addDeadTree(x,z,s){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0x504638,roughness:1});const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.14*s,.24*s,3.8*s,7),mat);trunk.position.y=1.9*s;trunk.rotation.z=rand(-.08,.08);g.add(trunk);for(let i=0;i<3;i++){const b=new THREE.Mesh(new THREE.CylinderGeometry(.04*s,.08*s,1.7*s,6),mat);b.position.set(rand(-.35,.35),rand(2.4,3.3)*s,0);b.rotation.z=rand(-1,1);g.add(b)}g.position.set(x,0,z);scene.add(g)}
function addFence(x,z,r=0){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0x555b55,metalness:.55,roughness:.65});for(const px of [-1.45,1.45]){const p=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.2,6),mat);p.position.set(px,1.1,0);g.add(p)}for(let y=.3;y<2.1;y+=.34){const rail=new THREE.Mesh(new THREE.BoxGeometry(2.9,.025,.025),mat);rail.position.y=y;g.add(rail)}g.position.set(x,0,z);g.rotation.y=r;scene.add(g)}
function addLamp(x,z){const g=new THREE.Group(),poleMat=new THREE.MeshStandardMaterial({color:0x343a37,metalness:.55,roughness:.6});const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.1,5.2,8),poleMat);pole.position.y=2.6;const arm=new THREE.Mesh(new THREE.BoxGeometry(1.05,.07,.07),poleMat);arm.position.set(.48,5.05,0);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),new THREE.MeshBasicMaterial({color:0xffc479}));bulb.position.set(.97,4.95,0);g.add(pole,arm,bulb);g.position.set(x,0,z);scene.add(g);if(streetLights.length<10){const l=new THREE.PointLight(0xffa95e,0,13,2);l.position.set(x+.97,4.8,z);scene.add(l);streetLights.push(l)}}
function createObjectiveBeacon(x,z,objective){const mat=new THREE.MeshBasicMaterial({color:0xd87537,transparent:true,opacity:.22,depthWrite:false});const beam=new THREE.Mesh(new THREE.CylinderGeometry(.08,1.15,15,16,1,true),mat);beam.position.set(x,7.5,z);beam.userData.objective=objective;scene.add(beam);objectiveBeacons.push(beam)}
function updateBeaconVisibility(){objectiveBeacons.forEach(b=>b.visible=b.userData.objective===currentObjective)}

function spawnLoose(type,x,z,id){
  if(pickedLootIds.has(id))return;
  const def=ITEM_DEFS[type], colors={water:0x4e96ad,food:0xb27a42,medkit:0xcbd5ca,bandage:0xd9d2bd,ammo9:0xb8a36b,ammo556:0x9c9a66,shells:0xa65f47,backpack_small:0x586958,backpack_large:0x465248,rifle:0x6e8b68,shotgun:0x9a6547};
  const g=new THREE.Group();g.position.set(x,.34,z);const color=colors[type]||0xffffff;const mat=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.15,roughness:.58,metalness:def.kind==='ammo'?.35:.05});let mesh;
  if(type==='water')mesh=new THREE.Mesh(new THREE.CylinderGeometry(.11,.14,.42,9),mat);else if(type==='food'||type==='ammo9'||type==='ammo556'||type==='shells')mesh=new THREE.Mesh(new THREE.BoxGeometry(.36,.24,.2),mat);else if(type==='medkit'||type==='bandage')mesh=new THREE.Mesh(new THREE.BoxGeometry(.42,.24,.32),mat);else if(type.startsWith('backpack'))mesh=new THREE.Mesh(new THREE.BoxGeometry(.42,.52,.24),mat);else {mesh=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,type==='rifle'?.86:.92),mat);mesh.rotation.y=.5}
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.34,.018,5,18),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.5}));ring.rotation.x=Math.PI/2;ring.position.y=-.22;g.add(mesh,ring);scene.add(g);const count=type==='ammo9'?12:type==='ammo556'?20:type==='shells'?6:1;loots.push({type:'loot',itemType:type,count,id,group:g,ring,picked:false,phase:Math.random()*6.28});
}

function spawnContainer(id,label,x,z,defaultItems){const items=Object.assign({},savedContainers[id] ?? defaultItems);const g=new THREE.Group();g.position.set(x,.38,z);const base=new THREE.Mesh(new THREE.BoxGeometry(1.05,.65,.72),new THREE.MeshStandardMaterial({color:0x4c514b,roughness:.82,metalness:.25}));const lid=new THREE.Mesh(new THREE.BoxGeometry(1.08,.13,.75),new THREE.MeshStandardMaterial({color:0x62675e,roughness:.78,metalness:.25}));lid.position.y=.39;g.add(base,lid);scene.add(g);addObstacle(x-.55,x+.55,z-.4,z+.4,'container');containers.push({type:'container',id,label,group:g,items,lid})}

function buildWeapon(){
  if(weaponRig)camera.remove(weaponRig);weaponRig=new THREE.Group();camera.add(weaponRig);weaponRig.position.set(.22,-.19,-.42);
  const w=weapons[player.weapon],metal=new THREE.MeshStandardMaterial({color:0x282e2d,metalness:.72,roughness:.34}),dark=new THREE.MeshStandardMaterial({color:0x111413,roughness:.65}),grip=new THREE.MeshStandardMaterial({color:0x25201d,roughness:.9});const box=(sx,sy,sz,x,y,z,mat=metal)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);weaponRig.add(m);return m};const barrel=(rad,len,x,y,z)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,len,10),metal);m.rotation.x=Math.PI/2;m.position.set(x,y,z);weaponRig.add(m);return m};
  if(w.id==='pistol'){box(.115,.105,.34,0,.01,-.08);box(.095,.17,.11,0,-.11,.01,grip).rotation.x=-.16;barrel(.026,.22,0,.025,-.30)}else if(w.id==='rifle'){box(.13,.14,.48,0,.01,-.12);box(.11,.19,.18,-.01,-.13,.02,grip).rotation.x=-.16;box(.09,.08,.28,0,.035,.23,dark);barrel(.024,.46,0,.03,-.58);box(.055,.09,.12,0,.13,-.14,dark)}else{box(.12,.13,.48,0,0,-.1);box(.09,.18,.18,0,-.14,.05,grip).rotation.x=-.15;barrel(.036,.72,0,.025,-.68);box(.10,.105,.2,0,-.03,-.43,new THREE.MeshStandardMaterial({color:0x5b3e2d,roughness:.86}))}
  const muzzle=new THREE.PointLight(0xff8a43,0,2.2,2);muzzle.position.set(0,.02,w.id==='shotgun'?-.98:(w.id==='rifle'?-.82:-.43));weaponRig.add(muzzle);weaponRig.userData.muzzle=muzzle;
}

function randomSpawn(min=25,max=68){for(let i=0;i<24;i++){const a=Math.random()*Math.PI*2,d=rand(min,max),x=player.pos.x+Math.cos(a)*d,z=player.pos.z+Math.sin(a)*d;if(!collidesAt(x,z,.7)&&Math.abs(x)<WORLD_LIMIT-5&&Math.abs(z)<WORLD_LIMIT-5)return new THREE.Vector3(x,0,z)}return new THREE.Vector3(rand(-105,105),0,rand(-105,105))}

function spawnZombie(pos){const g=new THREE.Group();g.position.copy(pos);const skin=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(rand(.18,.28),rand(.16,.28),rand(.28,.39)),roughness:.96}),cloth=new THREE.MeshStandardMaterial({color:[0x4d5147,0x51443e,0x3e4a50,0x5b5545][Math.floor(Math.random()*4)],roughness:1});const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.31,.65,3,7),cloth);torso.position.y=1.12;torso.scale.z=.68;const head=new THREE.Mesh(new THREE.SphereGeometry(.25,9,7),skin);head.position.set(0,1.85,.02);head.scale.set(.88,1.08,.92);const jaw=new THREE.Mesh(new THREE.BoxGeometry(.22,.12,.19),skin);jaw.position.set(0,1.72,-.11);g.add(torso,head,jaw);const limbs=[];for(const side of [-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.55,2,6),skin);arm.position.set(side*.38,1.2,-.05);arm.rotation.z=side*.12;g.add(arm);const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.105,.7,2,6),cloth);leg.position.set(side*.16,.42,0);g.add(leg);limbs.push(arm,leg)}const data={group:g,alive:true,hp:rand(76,115),speed:rand(1.2,1.8),wanderAngle:Math.random()*Math.PI*2,wanderUntil:0,heardUntil:0,nextAttack:0,groanAt:rand(1,6),deathT:0,limbs,head,torso};[torso,head,jaw,...limbs].forEach(m=>{m.castShadow=true;m.userData.zombie=data;m.userData.hitPart=m===head||m===jaw?'head':'body';shootables.push(m)});scene.add(g);zombies.push(data);return data}

function collidesAt(x,z,r=.42){if(x<-WORLD_LIMIT+r||x>WORLD_LIMIT-r||z<-WORLD_LIMIT+r||z>WORLD_LIMIT-r)return true;for(const o of obstacles)if(o.active&&x+r>o.minX&&x-r<o.maxX&&z+r>o.minZ&&z-r<o.maxZ)return true;return false}

function updatePlayer(dt){
  const joy=touchMove;let forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)+joy.y;let right=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joy.x;const len=Math.hypot(forward,right);if(len>1){forward/=len;right/=len}const sprinting=(runHeld||keys.has('ShiftLeft'))&&forward>.2&&player.stamina>1,speed=sprinting?7.35:4.7;if(sprinting)player.stamina=clamp(player.stamina-dt*18,0,100);else player.stamina=clamp(player.stamina+dt*12,0,100);const sin=Math.sin(yaw),cos=Math.cos(yaw),dx=(right*cos-forward*sin)*speed*dt,dz=(-right*sin-forward*cos)*speed*dt,nx=player.pos.x+dx,nz=player.pos.z+dz;if(!collidesAt(nx,player.pos.z))player.pos.x=nx;if(!collidesAt(player.pos.x,nz))player.pos.z=nz;if(jumpQueued&&grounded){verticalVelocity=5.1;grounded=false;jumpQueued=false}verticalVelocity-=12.8*dt;player.pos.y+=verticalVelocity*dt;if(player.pos.y<=1.68){player.pos.y=1.68;verticalVelocity=0;grounded=true}const moving=Math.abs(forward)+Math.abs(right)>.12,bob=moving&&grounded?Math.sin(runTime*(sprinting?13:9))*.025:0;screenShake=Math.max(0,screenShake-dt*7);yawNode.position.set(player.pos.x,player.pos.y+bob+rand(-screenShake,screenShake)*.02,player.pos.z);yawNode.rotation.y=yaw;pitchNode.rotation.x=pitch+rand(-screenShake,screenShake)*.008;const targetFov=aimHeld?settings.fov-12:settings.fov;camera.fov=lerp(camera.fov,targetFov,clamp(dt*10,0,1));camera.updateProjectionMatrix();recoil=lerp(recoil,0,clamp(dt*12,0,1));recoilSide=lerp(recoilSide,0,clamp(dt*15,0,1));weaponRig.rotation.x=-recoil;weaponRig.rotation.y=recoilSide;weaponRig.position.y=lerp(weaponRig.position.y,-.19+(moving?Math.sin(runTime*8)*.008:0),clamp(dt*9,0,1));player.hunger=clamp(player.hunger-dt*.055,0,100);player.thirst=clamp(player.thirst-dt*.078,0,100);if(player.hunger<=0||player.thirst<=0)damagePlayer(dt*2.2,false);if(player.bleeding>0){player.hp=clamp(player.hp-dt*.45*player.bleeding,0,100);if(player.hp<=0)die()}noise=clamp(noise-dt*.18,0,1);if(sprinting)noise=clamp(noise+dt*.04,0,1);if(reloadingUntil&&performance.now()/1000>=reloadingUntil)finishReload();if(fireHeld&&weapons[player.weapon].automatic)shoot();
}

function updateZombies(dt){const now=runTime;for(const z of zombies){if(!z.alive){z.deathT+=dt;z.group.rotation.z=lerp(z.group.rotation.z,Math.PI*.48,clamp(dt*4,0,1));z.group.position.y=Math.max(-.7,z.group.position.y-dt*.13);if(z.deathT>7&&!z.group.userData.removed){z.group.userData.removed=true;scene.remove(z.group)}continue}const dx=player.pos.x-z.group.position.x,dz=player.pos.z-z.group.position.z,dist=Math.hypot(dx,dz);if(dist<15+noise*32)z.heardUntil=now+rand(3,7);let angle,speed;if(dist<19||now<z.heardUntil){angle=Math.atan2(dx,dz);speed=z.speed*(dist<2?0.55:1)}else{if(now>z.wanderUntil){z.wanderUntil=now+rand(2,5);z.wanderAngle+=rand(-1.4,1.4)}angle=z.wanderAngle;speed=z.speed*.32}if(dist<1.25){speed=0;if(now>z.nextAttack){z.nextAttack=now+rand(.9,1.25);damagePlayer(rand(7,12),true);if(Math.random()<.24&&player.bleeding<2){player.bleeding++;toast('SANGRADO · USA UNA VENDA','bad')}AudioFX.groan(1)}}const mx=Math.sin(angle)*speed*dt,mz=Math.cos(angle)*speed*dt,nx=z.group.position.x+mx,nz=z.group.position.z+mz;if(!collidesAt(nx,nz,.34)){z.group.position.x=nx;z.group.position.z=nz}else z.wanderAngle+=1.3;z.group.rotation.y=lerpAngle(z.group.rotation.y,angle,clamp(dt*5,0,1));const walk=Math.sin(now*7*z.speed)*.55*(speed>0?.8:0);z.limbs[0].rotation.x=walk;z.limbs[1].rotation.x=-walk;z.limbs[2].rotation.x=-walk;z.limbs[3].rotation.x=walk;z.groanAt-=dt;if(z.groanAt<=0&&dist<20){AudioFX.groan(clamp(1-dist/22,.2,1));z.groanAt=rand(3.5,9)}}}
function lerpAngle(a,b,t){let d=((b-a+Math.PI)%(Math.PI*2))-Math.PI;return a+d*t}

function shoot(){if(!started||paused||dead)return;const w=weapons[player.weapon],now=performance.now()/1000;if(now<nextShotAt||reloadingUntil)return;if(w.mag<=0){AudioFX.click();toast('Sin munición · RECARGA','bad');nextShotAt=now+.35;return}w.mag--;nextShotAt=now+w.rate;noise=clamp(noise+w.noise,0,1);recoil=Math.min(.15,recoil+(w.id==='shotgun'?.105:w.id==='rifle'?.035:.055));recoilSide+=rand(-.018,.018);pitch=clamp(pitch-rand(.004,.012)*(w.id==='rifle'?1.2:1),-1.22,1.22);screenShake=Math.min(.7,screenShake+(w.id==='shotgun'?.45:.18));AudioFX.gun(w.id);weaponRig.userData.muzzle.intensity=4.5;setTimeout(()=>{if(weaponRig?.userData?.muzzle)weaponRig.userData.muzzle.intensity=0},35);const pellets=w.pellets||1;let hitAny=false,killAny=false;for(let p=0;p<pellets;p++){const origin=new THREE.Vector3();camera.getWorldPosition(origin);const q=camera.getWorldQuaternion(new THREE.Quaternion()),dir=new THREE.Vector3(0,0,-1).applyQuaternion(q),rightV=new THREE.Vector3(1,0,0).applyQuaternion(q),upV=new THREE.Vector3(0,1,0).applyQuaternion(q);const spread=w.spread*(aimHeld?.55:1)*(1+noise*.2);dir.addScaledVector(rightV,rand(-spread,spread)).addScaledVector(upV,rand(-spread,spread)).normalize();raycaster.set(origin,dir);raycaster.far=w.id==='shotgun'?45:95;const hits=raycaster.intersectObjects(shootables.filter(m=>m.userData.zombie?.alive),false);if(hits.length){const h=hits[0],z=h.object.userData.zombie;if(z?.alive){const head=h.object.userData.hitPart==='head',dmg=w.damage*(head?w.head:1)*rand(.92,1.08);z.hp-=dmg;z.heardUntil=runTime+7;hitAny=true;if(z.hp<=0){killZombie(z,head);killAny=true}else hitFlash(z)}}}if(hitAny)showHitmarker(killAny);updateAmmoUI()}
function hitFlash(z){if(z.torso.material.emissive){z.torso.material.emissive.set(0x5b130d);z.torso.material.emissiveIntensity=.55;setTimeout(()=>{if(z.alive){z.torso.material.emissive.set(0x000000);z.torso.material.emissiveIntensity=0}},80)}}
function killZombie(z,headshot=false){if(!z.alive)return;z.alive=false;player.kills++;noise=clamp(noise+.08,0,1);toast(headshot?'TIRO A LA CABEZA +1':'Zombi abatido +1','good');if(Math.random()<.36){const types=['ammo9','food','water','bandage'];spawnLoose(types[Math.floor(Math.random()*types.length)],z.group.position.x+rand(-.4,.4),z.group.position.z+rand(-.4,.4),'drop-'+Date.now()+'-'+Math.random())}}

function reload(){const w=weapons[player.weapon],reserve=player.inventory[w.ammoType]||0;if(reloadingUntil||w.mag>=w.magSize||reserve<=0)return;AudioFX.resume();reloadingUntil=performance.now()/1000+w.reload;toast('Recargando…');$('fire-mode').textContent='RECARGANDO'}
function finishReload(){const w=weapons[player.weapon],need=w.magSize-w.mag,take=Math.min(need,player.inventory[w.ammoType]||0);w.mag+=take;player.inventory[w.ammoType]-=take;reloadingUntil=0;updateAmmoUI();renderInventory()}
function switchWeapon(i){const w=weapons[i];if(!w?.unlocked){toast('Aún no tienes esa arma','bad');return}player.weapon=i;reloadingUntil=0;buildWeapon();document.querySelectorAll('.slot[data-slot]').forEach((b,j)=>b.classList.toggle('active',j===i));updateAmmoUI();AudioFX.click();renderInventory()}

function damagePlayer(amount,flash=true){if(dead)return;player.hp=clamp(player.hp-amount,0,100);if(flash){screenShake=.6;$('damage-vignette').style.opacity='.9';setTimeout(()=>$('damage-vignette').style.opacity='0',180)}if(player.hp<=0)die()}
function useItem(type){const n=player.inventory[type]||0;if(n<=0){toast('No te queda','bad');return}if(type==='medkit'){if(player.hp>96){toast('Tu vida ya está casi llena');return}player.hp=clamp(player.hp+45,0,100)}else if(type==='bandage'){if(player.bleeding<=0){toast('No estás sangrando');return}player.bleeding=Math.max(0,player.bleeding-1)}else if(type==='food')player.hunger=clamp(player.hunger+38,0,100);else if(type==='water')player.thirst=clamp(player.thirst+48,0,100);else return;player.inventory[type]--;AudioFX.pickup();toast(type==='medkit'?'Botiquín usado':type==='bandage'?'Sangrado tratado':type==='food'?'Has comido':'Has bebido','good');updateUI(true);renderInventory();saveGame()}

function inventorySlotsUsed(){let used=0;for(const [type,count] of Object.entries(player.inventory)){if(!count||!ITEM_DEFS[type])continue;used+=Math.ceil(count/ITEM_DEFS[type].stack)}return used}
function inventoryCapacity(){return BAG_SLOTS[player.bagLevel]}
function canAddItem(type,count=1){if(type==='backpack_small'||type==='backpack_large'||type==='rifle'||type==='shotgun')return true;const def=ITEM_DEFS[type];if(!def)return false;const before=inventorySlotsUsed(),old=player.inventory[type]||0,afterForType=Math.ceil((old+count)/def.stack),beforeForType=Math.ceil(old/def.stack);return before-beforeForType+afterForType<=inventoryCapacity()}
function addItem(type,count=1){if(type==='backpack_small'){if(player.bagLevel<1){player.bagLevel=1;toast('Mochila de asalto equipada · 18 huecos','good')}else{toast('Ya llevas una mochila igual o mejor');return false}renderInventory();return true}if(type==='backpack_large'){if(player.bagLevel<2){player.bagLevel=2;toast('Mochila militar equipada · 28 huecos','good')}else{toast('Ya llevas la mejor mochila');return false}renderInventory();return true}if(type==='rifle'){if(!weapons[1].unlocked){weapons[1].unlocked=true;weapons[1].mag=30;unlockSlot(1);toast('M4A1 equipada','good')}else toast('Ya tienes una M4A1');renderInventory();return true}if(type==='shotgun'){if(!weapons[2].unlocked){weapons[2].unlocked=true;weapons[2].mag=6;unlockSlot(2);toast('M870 equipada','good')}else toast('Ya tienes una M870');renderInventory();return true}if(!canAddItem(type,count)){toast('MOCHILA LLENA','bad');return false}player.inventory[type]=(player.inventory[type]||0)+count;renderInventory();return true}

function updateInteractions(dt){interactTarget=null;let nearest=2.35;for(const l of loots){if(l.picked)continue;l.group.position.y=.34+Math.sin(runTime*2+l.phase)*.045;l.ring.rotation.z+=dt*.65;const d=dist2D(player.pos,l.group.position);if(d<nearest){nearest=d;interactTarget=l}}for(const d of doors){const dis=Math.hypot(player.pos.x-d.x,player.pos.z-d.z);if(dis<nearest){nearest=dis;interactTarget=d}}for(const c of containers){const dis=dist2D(player.pos,c.group.position);if(dis<nearest){nearest=dis;interactTarget=c}}if(interactTarget){$('interact-prompt').classList.remove('hidden');$('interact-text').textContent=interactionLabel(interactTarget)}else $('interact-prompt').classList.add('hidden');const gasDist=Math.hypot(player.pos.x+44,player.pos.z-16),clinicDist=Math.hypot(player.pos.x-46,player.pos.z-43),milDist=Math.hypot(player.pos.x-60,player.pos.z+55);if(currentObjective===0&&gasDist<11)setObjective(1);else if(currentObjective===1&&clinicDist<12)setObjective(2);else if(currentObjective===2&&milDist<16)setObjective(3)}
function interactionLabel(t){if(t.type==='door')return t.open?'Cerrar puerta':'Abrir puerta';if(t.type==='container')return 'Registrar '+t.label;return 'Recoger '+(ITEM_DEFS[t.itemType]?.name||t.itemType)}
function interact(){if(!interactTarget)return;if(interactTarget.type==='door'){toggleDoor(interactTarget);return}if(interactTarget.type==='container'){openInventory(interactTarget);return}const l=interactTarget;if(!addItem(l.itemType,l.count||1))return;l.picked=true;pickedLootIds.add(l.id);scene.remove(l.group);AudioFX.pickup();toast((ITEM_DEFS[l.itemType]?.name||l.itemType)+(l.count>1?' +'+l.count:'')+' recogido','good');interactTarget=null;updateUI(true);saveGame()}
function unlockSlot(i){document.querySelector(`.slot[data-slot="${i}"]`)?.classList.remove('locked')}

function setObjective(i){currentObjective=i;const objectives=[['Registra la gasolinera','Busca comida, agua y munición'],['Llega a la clínica','Necesitas medicina y una mochila'],['Explora la base militar','Busca armamento y equipo'],['Mantente con vida','Saquea edificios y evita quedar rodeado']];const o=objectives[i]||objectives[3];$('objective-text').textContent=o[0];$('objective-sub').textContent=o[1];updateBeaconVisibility();toast('OBJETIVO ACTUALIZADO');saveGame()}

function updateWorldTime(){const simHours=8+runTime/360*24,day=Math.floor(simHours/24)+1,hour=simHours%24,daylight=clamp(Math.sin((hour-6)/24*Math.PI*2)*1.8+.15,0,1);sun.intensity=.08+daylight*2.15;hemi.intensity=.18+daylight*1.15;renderer.toneMappingExposure=.55+daylight*.42;const dayC=new THREE.Color(0x929b95),nightC=new THREE.Color(0x0b1116);tempColor.copy(nightC).lerp(dayC,daylight);scene.background.copy(tempColor);scene.fog.color.copy(tempColor);scene.fog.density=lerp(.014,.0087,daylight);streetLights.forEach(l=>l.intensity=daylight<.35?(1-daylight)*1.5:0);const ang=(hour-6)/24*Math.PI*2;sun.position.set(Math.cos(ang)*65,Math.max(5,Math.sin(ang)*72),Math.sin(ang*.7)*45);$('day-label').textContent=`DÍA ${day}`;$('day-value').textContent=day;$('clock-label').textContent=`${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor((hour%1)*60)).padStart(2,'0')}`}
function spawnDirector(dt){spawnAccumulator+=dt;waveAccumulator+=dt;const alive=zombies.filter(z=>z.alive).length,cap=settings.quality==='low'?11:settings.quality==='high'?18:14,interval=Math.max(5.5,11-player.kills*.03);if(spawnAccumulator>interval&&alive<cap){spawnAccumulator=0;spawnZombie(randomSpawn(30,68))}if(waveAccumulator>95){waveAccumulator=0;toast('Se oyen infectados a lo lejos…','bad');for(let i=0;i<Math.min(3,cap-alive);i++)spawnZombie(randomSpawn(26,40))}}

function updateUI(force=false){if(!force&&uiAccumulator<.1)return;uiAccumulator=0;$('hp-bar').style.width=player.hp+'%';$('hunger-bar').style.width=player.hunger+'%';$('thirst-bar').style.width=player.thirst+'%';$('stamina-bar').style.width=player.stamina+'%';$('hp-value').textContent=Math.ceil(player.hp);$('hunger-value').textContent=Math.ceil(player.hunger);$('thirst-value').textContent=Math.ceil(player.thirst);$('kills-value').textContent=player.kills;$('noise-value').textContent=Math.round(noise*100)+'%';$('medkit-count').textContent='x'+(player.inventory.medkit||0);$('food-count').textContent='x'+(player.inventory.food||0);$('water-count').textContent='x'+(player.inventory.water||0);const nearby=zombies.filter(z=>z.alive&&z.group.position.distanceTo(player.pos)<16).length;$('threat-label').textContent=nearby>4?'AMENAZA CRÍTICA':nearby>1?'AMENAZA ALTA':'AMENAZA BAJA';$('threat-label').style.color=nearby>4?'#dc6452':nearby>1?'#d49a4e':'#9fbc87';$('bleed-status')?.classList.toggle('active',player.bleeding>0);$('bag-status').textContent=`${inventorySlotsUsed()}/${inventoryCapacity()}`;updateAmmoUI()}
function updateAmmoUI(){const w=weapons[player.weapon],reserve=player.inventory[w.ammoType]||0;$('weapon-name').textContent=w.label;$('ammo-mag').textContent=w.mag;$('ammo-reserve').textContent=reserve;$('fire-mode').textContent=reloadingUntil?'RECARGANDO':w.mode;$('pistol-stock').textContent=`${weapons[0].mag}/${player.inventory.ammo9||0}`;$('rifle-stock').textContent=weapons[1].unlocked?`${weapons[1].mag}/${player.inventory.ammo556||0}`:'BLOQ.';$('shotgun-stock').textContent=weapons[2].unlocked?`${weapons[2].mag}/${player.inventory.shells||0}`:'BLOQ.'}
function showHitmarker(kill=false){const h=$('hitmarker');h.className=kill?'show kill':'show';clearTimeout(showHitmarker.t);showHitmarker.t=setTimeout(()=>h.className='',110)}
function toast(text,type=''){const stack=$('toast-stack'),el=document.createElement('div');el.className='toast '+type;el.textContent=text;stack.appendChild(el);setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(-4px)';el.style.transition='.25s';setTimeout(()=>el.remove(),260)},2200)}

function setupProUI(){
  const hud=$('hud');const invBtn=document.createElement('button');invBtn.id='inventory-btn';invBtn.className='glass';invBtn.innerHTML='<span>MOCHILA</span><b id="bag-status">0/10</b>';hud.appendChild(invBtn);const status=document.createElement('div');status.id='status-strip';status.innerHTML='<span id="bleed-status">SANGRADO</span><span class="save-dot">GUARDADO AUTO</span>';hud.appendChild(status);
  const overlay=document.createElement('section');overlay.id='inventory-overlay';overlay.className='hidden';overlay.innerHTML=`<div class="inventory-shell"><header><div><small>VAST: DEAD ZONE</small><h2>INVENTARIO</h2></div><div class="inv-meta"><span id="inv-slots">0/10 HUECOS</span><button id="inventory-close">✕</button></div></header><div class="inventory-body"><aside class="equipment-panel"><small>EQUIPO</small><div class="equip-card"><span>MOCHILA</span><b id="equip-bag">SIN MOCHILA</b></div><div class="equip-card"><span>PRIMARIA</span><b id="equip-primary">VACÍO</b></div><div class="equip-card"><span>SECUNDARIA</span><b>M9</b></div><div class="condition-card"><span>ESTADO</span><b id="equip-condition">ESTABLE</b></div></aside><main class="backpack-panel"><div class="section-title"><span>MOCHILA</span><small>Toca un consumible para usarlo</small></div><div id="inventory-grid" class="inventory-grid"></div></main><aside class="vicinity-panel"><div class="section-title"><span id="vicinity-title">CERCA</span><small id="vicinity-sub">No hay contenedor abierto</small></div><div id="vicinity-grid" class="vicinity-grid"></div></aside></div><footer><span>El tiempo se pausa mientras gestionas el inventario.</span><button id="inventory-close-2">VOLVER A LA ZONA</button></footer></div>`;document.body.appendChild(overlay);invBtn.addEventListener('pointerdown',e=>{e.stopPropagation();openInventory(null)});$('inventory-close').addEventListener('click',closeInventory);$('inventory-close-2').addEventListener('click',closeInventory);renderInventory();if(saveData){$('play-btn').textContent='CONTINUAR EN LA ZONA';const fresh=document.createElement('button');fresh.id='new-game-btn';fresh.textContent='NUEVA PARTIDA';$('play-btn').insertAdjacentElement('afterend',fresh);fresh.addEventListener('click',()=>{if(confirm('¿Borrar la partida guardada y empezar de cero?')){localStorage.removeItem(SAVE_KEY);location.reload()}})}}

function renderInventory(){if(!$('inventory-grid'))return;const grid=$('inventory-grid');grid.innerHTML='';const entries=Object.entries(player.inventory).filter(([t,n])=>n>0&&ITEM_DEFS[t]);for(const [type,count] of entries){const def=ITEM_DEFS[type],card=document.createElement('div');card.className='inv-item '+def.kind;card.innerHTML=`<div class="item-code">${def.short}</div><div class="item-copy"><b>${def.name}</b><span>${def.desc}</span></div><strong>x${count}</strong>`;if(['medkit','bandage','food','water'].includes(type)){const use=document.createElement('button');use.textContent='USAR';use.addEventListener('click',e=>{e.stopPropagation();useItem(type)});card.appendChild(use)}grid.appendChild(card)}const used=inventorySlotsUsed(),cap=inventoryCapacity();$('inv-slots').textContent=`${used}/${cap} HUECOS`;$('bag-status').textContent=`${used}/${cap}`;$('equip-bag').textContent=player.bagLevel===2?'MOCHILA MILITAR':player.bagLevel===1?'MOCHILA DE ASALTO':'SIN MOCHILA';$('equip-primary').textContent=weapons[1].unlocked?'M4A1':weapons[2].unlocked?'M870':'VACÍO';$('equip-condition').textContent=player.bleeding>0?`SANGRADO x${player.bleeding}`:'ESTABLE';$('equip-condition').classList.toggle('danger',player.bleeding>0);renderVicinity();updateAmmoUI()}
function renderVicinity(){if(!$('vicinity-grid'))return;const grid=$('vicinity-grid');grid.innerHTML='';if(!activeContainer){$('vicinity-title').textContent='CERCA';$('vicinity-sub').textContent='Abre una caja o armario';grid.innerHTML='<div class="empty-vicinity">Nada seleccionado</div>';return}$('vicinity-title').textContent=activeContainer.label.toUpperCase();$('vicinity-sub').textContent='Contenido del contenedor';const entries=Object.entries(activeContainer.items).filter(([t,n])=>n>0&&ITEM_DEFS[t]);if(!entries.length){grid.innerHTML='<div class="empty-vicinity">VACÍO</div>';return}for(const [type,count] of entries){const def=ITEM_DEFS[type],card=document.createElement('div');card.className='vicinity-item';card.innerHTML=`<div><b>${def.name}</b><span>${def.desc}</span></div><strong>x${count}</strong>`;const take=document.createElement('button');take.textContent='COGER';take.addEventListener('click',()=>takeFromContainer(type));card.appendChild(take);grid.appendChild(card)}}
function takeFromContainer(type){if(!activeContainer||!activeContainer.items[type])return;const def=ITEM_DEFS[type],amount=def.kind==='ammo'?Math.min(def.stack,activeContainer.items[type]):1;if(!addItem(type,amount))return;activeContainer.items[type]-=amount;if(activeContainer.items[type]<=0)delete activeContainer.items[type];savedContainers[activeContainer.id]=Object.assign({},activeContainer.items);AudioFX.pickup();toast(`${def.name} +${amount}`,'good');renderInventory();saveGame()}
function openInventory(container=null){if(dead||!started)return;activeContainer=container;inventoryOpen=true;paused=true;fireHeld=false;runHeld=false;aimHeld=false;$('inventory-overlay').classList.remove('hidden');document.body.classList.add('inventory-open');$('pause').classList.add('hidden');renderInventory();saveGame()}
function closeInventory(){if(!inventoryOpen)return;inventoryOpen=false;activeContainer=null;paused=false;$('inventory-overlay').classList.add('hidden');document.body.classList.remove('inventory-open');clock.getDelta();AudioFX.resume();saveGame()}

function saveGame(){if(!started||dead)return;for(const c of containers)savedContainers[c.id]=Object.assign({},c.items);const data={version:2,pos:{x:player.pos.x,z:player.pos.z},hp:player.hp,hunger:player.hunger,thirst:player.thirst,stamina:player.stamina,bleeding:player.bleeding,kills:player.kills,bagLevel:player.bagLevel,inventory:player.inventory,weapon:player.weapon,weapons:weapons.map(w=>({unlocked:w.unlocked,mag:w.mag})),runTime,objective:currentObjective,yaw,pitch,pickedLootIds:[...pickedLootIds],containers:savedContainers};localStorage.setItem(SAVE_KEY,JSON.stringify(data))}
function die(){dead=true;fireHeld=false;localStorage.removeItem(SAVE_KEY);const day=parseInt($('day-value').textContent)||1;$('death-kills').textContent=player.kills;$('death-time').textContent=formatTime(runTime);$('death-day').textContent=day;$('hud').classList.add('hidden');$('inventory-overlay').classList.add('hidden');$('death').classList.remove('hidden');$('death').classList.add('show');if(player.kills>best.kills||runTime>best.time){best.kills=Math.max(best.kills,player.kills);best.time=Math.max(best.time,runTime);best.day=Math.max(best.day,day);localStorage.setItem(BEST_KEY,JSON.stringify(best))}}
function formatTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`}

let touchMove={x:0,y:0},joyPointer=null,joyOrigin={x:0,y:0},lookPointer=null,lookLast={x:0,y:0};
function setupControls(){const joy=$('joystick'),stick=$('joy-stick');joy.addEventListener('pointerdown',e=>{if(paused)return;AudioFX.resume();joyPointer=e.pointerId;joy.setPointerCapture(e.pointerId);const r=joy.getBoundingClientRect();joyOrigin={x:r.left+r.width/2,y:r.top+r.height/2};moveJoy(e);e.preventDefault()});joy.addEventListener('pointermove',e=>{if(e.pointerId===joyPointer)moveJoy(e)});const joyUp=e=>{if(e.pointerId!==joyPointer)return;joyPointer=null;touchMove={x:0,y:0};stick.style.transform='translate(-50%,-50%)'};joy.addEventListener('pointerup',joyUp);joy.addEventListener('pointercancel',joyUp);function moveJoy(e){let dx=e.clientX-joyOrigin.x,dy=e.clientY-joyOrigin.y;const max=33,l=Math.hypot(dx,dy)||1;if(l>max){dx=dx/l*max;dy=dy/l*max}touchMove={x:dx/max,y:-dy/max};stick.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`}const look=$('look-zone');look.addEventListener('pointerdown',e=>{if(paused)return;AudioFX.resume();lookPointer=e.pointerId;look.setPointerCapture(e.pointerId);lookLast={x:e.clientX,y:e.clientY};e.preventDefault()});look.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointer||paused)return;const dx=e.clientX-lookLast.x,dy=e.clientY-lookLast.y;lookLast={x:e.clientX,y:e.clientY};rotateLook(dx,dy,.0037)});const lookUp=e=>{if(e.pointerId===lookPointer)lookPointer=null};look.addEventListener('pointerup',lookUp);look.addEventListener('pointercancel',lookUp);bindHold($('fire-btn'),()=>{fireHeld=true;if(!weapons[player.weapon].automatic)shoot()},()=>fireHeld=false);bindHold($('run-btn'),()=>runHeld=true,()=>runHeld=false);bindHold($('aim-btn'),()=>aimHeld=true,()=>aimHeld=false);$('reload-btn').addEventListener('pointerdown',e=>{e.stopPropagation();reload()});$('use-btn').addEventListener('pointerdown',e=>{e.stopPropagation();interact()});$('jump-btn').addEventListener('pointerdown',e=>{e.stopPropagation();jumpQueued=true});document.querySelectorAll('.slot[data-slot]').forEach((b,i)=>b.addEventListener('pointerdown',e=>{e.stopPropagation();switchWeapon(i)}));document.querySelectorAll('.slot[data-item]').forEach(b=>b.addEventListener('pointerdown',e=>{e.stopPropagation();useItem(b.dataset.item)}));window.addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='KeyR')reload();if(e.code==='KeyE')interact();if(e.code==='KeyI'||e.code==='Tab'){e.preventDefault();inventoryOpen?closeInventory():openInventory(null)}if(e.code==='Space'){jumpQueued=true;e.preventDefault()}if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(2);if(e.code==='Escape'&&started){if(inventoryOpen)closeInventory();else togglePause(true)}});window.addEventListener('keyup',e=>keys.delete(e.code))}
function bindHold(el,on,off){el.addEventListener('pointerdown',e=>{if(paused)return;e.stopPropagation();el.setPointerCapture?.(e.pointerId);el.classList.add('pressed');AudioFX.resume();on()});const end=e=>{e.stopPropagation();el.classList.remove('pressed');off()};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end)}
function rotateLook(dx,dy,mult){yaw-=dx*mult*settings.sensitivity;pitch=clamp(pitch-dy*mult*settings.sensitivity,-1.28,1.28)}

function setupMenus(){$('play-btn').addEventListener('click',startGame);$('pause-btn').addEventListener('pointerdown',()=>togglePause(true));$('resume-btn').addEventListener('click',()=>togglePause(false));$('resume-btn-2').addEventListener('click',()=>togglePause(false));$('restart-btn').addEventListener('click',()=>{localStorage.removeItem(SAVE_KEY);location.reload()});$('retry-btn').addEventListener('click',()=>location.reload());const sens=$('sensitivity'),fov=$('fov'),vol=$('volume');sens.value=settings.sensitivity;fov.value=settings.fov;vol.value=settings.volume;$('sens-out').textContent=Number(settings.sensitivity).toFixed(2);$('fov-out').textContent=settings.fov;$('volume-out').textContent=Math.round(settings.volume*100)+'%';sens.addEventListener('input',()=>{settings.sensitivity=+sens.value;$('sens-out').textContent=settings.sensitivity.toFixed(2);saveSettings()});fov.addEventListener('input',()=>{settings.fov=+fov.value;$('fov-out').textContent=settings.fov;saveSettings()});vol.addEventListener('input',()=>{settings.volume=+vol.value;$('volume-out').textContent=Math.round(settings.volume*100)+'%';AudioFX.setVolume(settings.volume);saveSettings()});document.querySelectorAll('[data-quality]').forEach(b=>{b.classList.toggle('active',b.dataset.quality===settings.quality);b.addEventListener('click',()=>{settings.quality=b.dataset.quality;document.querySelectorAll('[data-quality]').forEach(x=>x.classList.toggle('active',x===b));applyQuality(settings.quality);saveSettings()})})}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function applyQuality(q){if(!renderer)return;const d=devicePixelRatio||1;renderer.setPixelRatio(q==='low'?1:q==='high'?Math.min(d,1.7):Math.min(d,1.28));renderer.shadowMap.enabled=q!=='low'}
function togglePause(v){if(dead||inventoryOpen)return;paused=v;$('pause').classList.toggle('hidden',!v);if(v){fireHeld=false;saveGame()}else{clock.getDelta();AudioFX.resume()}}
async function startGame(){AudioFX.resume();$('loading').classList.remove('hidden');$('boot').classList.remove('show');$('boot').classList.add('hidden');try{if(screen.orientation?.lock)await screen.orientation.lock('landscape').catch(()=>{});if(document.documentElement.requestFullscreen&&isTouch)await document.documentElement.requestFullscreen().catch(()=>{})}catch{}setTimeout(()=>{$('loading').classList.add('hidden');$('hud').classList.remove('hidden');started=true;clock.getDelta();toast(saveData?'Partida recuperada':'Has entrado en la Zona Muerta');updateUI(true);renderInventory();saveGame()},420)}
function onResize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);applyQuality(settings.quality)}
function loop(){requestAnimationFrame(loop);if(!renderer)return;const dt=Math.min(clock.getDelta(),.05);if(started&&!paused&&!dead){runTime+=dt;uiAccumulator+=dt;autosaveAccumulator+=dt;updatePlayer(dt);updateZombies(dt);updateInteractions(dt);spawnDirector(dt);updateWorldTime();updateUI();if(autosaveAccumulator>10){autosaveAccumulator=0;saveGame()}}renderer.render(scene,camera)}

window.addEventListener('pagehide',()=>saveGame());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveGame()});
initThree();setupProUI();setupControls();setupMenus();weapons.forEach((w,i)=>{if(w.unlocked)unlockSlot(i)});setObjective(currentObjective);updateAmmoUI();loop();
