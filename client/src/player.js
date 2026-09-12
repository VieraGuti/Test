import * as THREE from 'three';

const MOVE_SPEED = 8;
const MOUSE_SENSITIVITY = 0.002;
const PLAYER_RADIUS = 0.4;
const EYE_HEIGHT = 1.7;

export class Player {
  constructor(camera, isMobile) {
    this.camera = camera;
    this.isMobile = isMobile;
    this.position = new THREE.Vector3(2, EYE_HEIGHT, 2);
    this.yaw = 0;
    this.pitch = 0;
    this.keys = { w: false, a: false, s: false, d: false };
    this.locked = isMobile || document.pointerLockElement === document.body;
    this.wallBoxes = [];
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.camera.position.copy(this.position);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    if (!isMobile) {
      document.addEventListener('keydown', this._onKeyDown);
      document.addEventListener('keyup', this._onKeyUp);
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('pointerlockchange', this._onPointerLockChange);
    }
  }
  setWallBoxes(boxes) { this.wallBoxes = boxes; }
  setPosition(x, z) { this.position.set(x, EYE_HEIGHT, z); this.camera.position.copy(this.position); }
  requestPointerLock() { if (!this.isMobile) document.body.requestPointerLock(); else this.locked = true; }
  _onPointerLockChange() { this.locked = document.pointerLockElement === document.body; }
  _onKeyDown(e) { const key=e.key.toLowerCase(); if(key in this.keys)this.keys[key]=true; }
  _onKeyUp(e) { const key=e.key.toLowerCase(); if(key in this.keys)this.keys[key]=false; }
  _onMouseMove(e) {
    if (!this.locked) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, this.pitch));
  }
  applyTouchLook(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    this.pitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, this.pitch));
  }
  update(dt) {
    const forward = new THREE.Vector3(0,0,-1);
    const right = new THREE.Vector3(1,0,0);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
    forward.applyQuaternion(yawQuat); right.applyQuaternion(yawQuat);
    const moveDir = new THREE.Vector3();
    if (this.isMobile) {
      if (Math.abs(this.touchMoveX)>0.1 || Math.abs(this.touchMoveY)>0.1) {
        moveDir.addScaledVector(forward,this.touchMoveY);
        moveDir.addScaledVector(right,this.touchMoveX);
      }
    } else {
      if(this.keys.w)moveDir.add(forward); if(this.keys.s)moveDir.sub(forward); if(this.keys.d)moveDir.add(right); if(this.keys.a)moveDir.sub(right);
    }
    if(moveDir.lengthSq()>0){
      moveDir.normalize().multiplyScalar(MOVE_SPEED*dt);
      const newX=this.position.x+moveDir.x; if(!this._collides(newX,this.position.z))this.position.x=newX;
      const newZ=this.position.z+moveDir.z; if(!this._collides(this.position.x,newZ))this.position.z=newZ;
    }
    this.camera.position.copy(this.position);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch,this.yaw,0,'YXZ'));
  }
  _collides(x,z){
    const playerBox=new THREE.Box3(new THREE.Vector3(x-PLAYER_RADIUS,0,z-PLAYER_RADIUS),new THREE.Vector3(x+PLAYER_RADIUS,EYE_HEIGHT+0.3,z+PLAYER_RADIUS));
    for(const wallBox of this.wallBoxes)if(playerBox.intersectsBox(wallBox))return true;
    return false;
  }
  getState(){return{x:this.position.x,y:this.position.y,z:this.position.z,rotY:this.yaw,rotX:this.pitch};}
  destroy(){document.removeEventListener('keydown',this._onKeyDown);document.removeEventListener('keyup',this._onKeyUp);document.removeEventListener('mousemove',this._onMouseMove);document.removeEventListener('pointerlockchange',this._onPointerLockChange);}
}
