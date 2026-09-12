import * as THREE from 'three';
import { generateMaze, buildMazeMesh, CELL_SIZE } from './maze.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { HUD } from './hud.js';
import { Opponent } from './opponent.js';
import { Network } from './network.js';
import { TouchControls, isMobile } from './touch.js';

const mobile = isMobile();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);
scene.fog = new THREE.Fog(0x111122, mobile ? 15 : 14, mobile ? 60 : 50);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
scene.add(camera);

const ambient = new THREE.AmbientLight(0x667799, mobile ? 1.2 : 0.9);
scene.add(ambient);
const playerLight = new THREE.PointLight(0xffeedd, mobile ? 1.5 : 1.2, mobile ? 25 : 20);
playerLight.position.set(0, 2.5, 0);
scene.add(playerLight);
const staticLights = [];

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let player = null;
let weapon = null;
let hud = null;
let opponent = null;
let network = null;
let mazeGroup = null;
let touchControls = null;
let gameState = 'menu';
let myHealth = 100;
let countdownValue = 3;
let countdownTimer = null;
let myPlayerId = null;
let soloMode = false;
let soloMazeSeed = null;

const menuOverlay = document.getElementById('menu-overlay');
const findMatchBtn = document.getElementById('find-match-btn');
const soloBtn = document.getElementById('solo-btn');
const statusOverlay = document.getElementById('status-overlay');
const statusText = document.getElementById('status-text');
const statusSub = document.getElementById('status-sub');
const rematchBtn = document.getElementById('rematch-btn');

findMatchBtn.addEventListener('click', () => {
  findMatchBtn.disabled = true;
  findMatchBtn.textContent = 'CONNECTING...';
  soloBtn.disabled = true;
  soloMode = false;
  startConnection();
});
soloBtn.addEventListener('click', () => {
  soloMode = true;
  startSoloMode();
});
rematchBtn.addEventListener('click', () => {
  if (soloMode) { startSoloMode(); return; }
  if (network) {
    network.rematch();
    rematchBtn.textContent = 'WAITING...';
    rematchBtn.disabled = true;
  }
});

function startSoloMode() {
  cleanupGame();
  menuOverlay.style.display = 'none';
  soloMazeSeed = Math.floor(Math.random() * 2147483647);
  myPlayerId = 0;
  myHealth = 100;
  gameState = 'solo';

  const mazeW = 12, mazeH = 12;
  const grid = generateMaze(mazeW, mazeH, soloMazeSeed);
  const { group, wallBoxes } = buildMazeMesh(grid);
  mazeGroup = group;
  scene.add(mazeGroup);
  addMazeLights(mazeW, mazeH);

  const spawnX = 1 * CELL_SIZE + CELL_SIZE / 2;
  const spawnZ = 1 * CELL_SIZE + CELL_SIZE / 2;
  player = new Player(camera, mobile);
  player.setWallBoxes(wallBoxes);
  player.setPosition(spawnX, spawnZ);
  weapon = new Weapon(camera, scene, mobile);
  weapon.onShoot = () => {};
  hud = new HUD();
  hud.setHealth(100);

  if (mobile) {
    touchControls = new TouchControls(() => {
      if (gameState === 'solo' || gameState === 'playing') weapon.fire();
    });
    touchControls.enable();
  }

  player.requestPointerLock();
  showStatus('CONTROL TEST', 'Joystick izquierdo · arrastra derecha para mirar · FIRE para disparar', false);
  setTimeout(() => hideStatus(), 1800);
}

async function startConnection() {
  network = new Network();
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${window.location.host}`;
  try { await network.connect(wsUrl); }
  catch (e) {
    findMatchBtn.disabled = false;
    findMatchBtn.textContent = 'FIND MATCH';
    soloBtn.disabled = false;
    alert('Could not connect to server.');
    return;
  }

  network.on('waiting', () => {
    soloMode = true;
    startSoloMode();
    showStatus('EXPLORING SOLO', 'Waiting for opponent to join...', false);
    setTimeout(() => hideStatus(), 2500);
  });
  network.on('start', (msg) => { soloMode = false; setupGame(msg); });
  network.on('go', () => {
    gameState = 'playing'; hideStatus();
    network.startPositionUpdates(() => player.getState());
    if (player && document.pointerLockElement === document.body) player.locked = true;
  });
  network.on('opponent_position', (msg) => opponent?.setPosition(msg.x,msg.y,msg.z,msg.rotY));
  network.on('hit', () => { hud?.showHitMarker(); hud?.addKillMessage('HIT!'); opponent?.showHit(); });
  network.on('damaged', (msg) => { myHealth = msg.health; hud?.setHealth(myHealth); hud?.showDamage(); });
  network.on('kill', (msg) => {
    gameState = 'ended'; network.stopPositionUpdates();
    if (!mobile) document.exitPointerLock();
    const isWinner = msg.winner === myPlayerId;
    showStatus(isWinner ? 'VICTORY' : 'DEFEATED', isWinner ? 'You eliminated your opponent!' : 'You were eliminated.', true);
  });
  network.on('rematch_vote', () => { statusSub.textContent = 'Opponent wants a rematch!'; });
  network.on('opponent_left', () => {
    gameState = 'ended'; network.stopPositionUpdates();
    if (!mobile) document.exitPointerLock();
    showStatus('OPPONENT LEFT', 'Your opponent disconnected.', false);
    setTimeout(resetToMenu, 3000);
  });
  network.on('disconnected', () => { if (gameState !== 'menu') resetToMenu(); });
  network.join();
}

function setupGame(msg) {
  cleanupGame();
  menuOverlay.style.display = 'none';
  myPlayerId = msg.playerId;
  myHealth = 100;
  gameState = 'countdown';
  const grid = generateMaze(msg.mazeWidth, msg.mazeHeight, msg.seed);
  const { group, wallBoxes } = buildMazeMesh(grid);
  mazeGroup = group; scene.add(mazeGroup);
  addMazeLights(msg.mazeWidth, msg.mazeHeight);
  player = new Player(camera, mobile);
  player.setWallBoxes(wallBoxes);
  player.setPosition(msg.spawnX, msg.spawnZ);
  weapon = new Weapon(camera, scene, mobile);
  weapon.onShoot = (origin, direction) => { if (gameState === 'playing') network.shoot(origin, direction); };
  hud = new HUD(); hud.setHealth(100);
  opponent = new Opponent(scene);
  if (mobile) {
    touchControls = new TouchControls(() => { if (gameState === 'playing') weapon.fire(); });
    touchControls.enable();
  }
  countdownValue = 3;
  showStatus(String(countdownValue), 'Opponent found! Get ready!', false);
  countdownTimer = setInterval(() => {
    countdownValue--;
    if (countdownValue > 0) statusText.textContent = String(countdownValue);
    else { statusText.textContent = 'GO!'; clearInterval(countdownTimer); }
  }, 1000);
}

function addMazeLights(mazeW, mazeH) {
  for (const l of staticLights) scene.remove(l);
  staticLights.length = 0;
  for (let gz=1; gz<mazeH; gz+=4) for (let gx=1; gx<mazeW; gx+=4) {
    const light = new THREE.PointLight(0x6688aa, mobile ? 0.8 : 0.6, mobile ? 18 : 16);
    light.position.set(gx*CELL_SIZE+CELL_SIZE/2,2.5,gz*CELL_SIZE+CELL_SIZE/2);
    scene.add(light); staticLights.push(light);
  }
}
function showStatus(text, sub, showRematch) {
  statusOverlay.classList.add('active'); statusText.textContent=text; statusSub.textContent=sub||'';
  rematchBtn.style.display=showRematch?'block':'none'; rematchBtn.disabled=false; rematchBtn.textContent='REMATCH';
  statusOverlay.classList.toggle('has-pointer', !!showRematch);
}
function hideStatus(){statusOverlay.classList.remove('active','has-pointer');}
function cleanupGame(){
  if(mazeGroup){scene.remove(mazeGroup);mazeGroup=null;} if(player){player.destroy();player=null;} if(weapon){weapon.destroy();weapon=null;}
  if(hud){hud.destroy();hud=null;} if(opponent){opponent.destroy();opponent=null;} if(touchControls){touchControls.destroy();touchControls=null;}
  if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;} for(const l of staticLights)scene.remove(l); staticLights.length=0; hideStatus();
}
function resetToMenu(){cleanupGame();if(network){network.disconnect();network=null;}gameState='menu';soloMode=false;menuOverlay.style.display='flex';findMatchBtn.disabled=false;findMatchBtn.textContent='FIND MATCH';soloBtn.disabled=false;hideStatus();}

if(!mobile){
  document.addEventListener('click',()=>{if(player&&['playing','solo','countdown'].includes(gameState)&&!document.pointerLockElement)document.body.requestPointerLock();});
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===document.body&&gameState==='playing')hideStatus();});
}

let lastTime=performance.now();
function gameLoop(){
  requestAnimationFrame(gameLoop);
  const now=performance.now(); const dt=Math.min((now-lastTime)/1000,0.1); lastTime=now;
  if(touchControls&&player&&touchControls.active){
    player.touchMoveX=touchControls.moveX; player.touchMoveY=touchControls.moveY;
    const look=touchControls.consumeLook(); player.applyTouchLook(look.dx,look.dy);
  }
  if(player&&['playing','countdown','solo'].includes(gameState)){
    if(gameState!=='countdown')player.update(dt); playerLight.position.copy(camera.position);
  }
  if(weapon)weapon.update(dt); if(opponent)opponent.update(dt); renderer.render(scene,camera);
}
gameLoop();
