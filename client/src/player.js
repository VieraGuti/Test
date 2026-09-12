import * as THREE from 'three';

const PLAYER_RADIUS = 0.4;
const EYE_HEIGHT = 1.7;
const DESKTOP_LOOK_BASE = 0.002;
const TOUCH_LOOK_BASE = 0.0032;
const ACCELERATION = 15;
const DECELERATION = 20;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export class Player {
  constructor(camera, isMobile, settings = {}) {
    this.camera = camera;
    this.isMobile = isMobile;
    this.position = new THREE.Vector3(2, EYE_HEIGHT, 2);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = { w: false, a: false, s: false, d: false };
    this.locked = isMobile || document.pointerLockElement === document.body;
    this.wallBoxes = [];
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.settings = { sensitivity: 0.78, moveSpeed: 4.8, invertY: false, ...settings };
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

  setSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
  }

  clearInput() {
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.velocity.multiplyScalar(0.25);
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
  }

  setWallBoxes(boxes) { this.wallBoxes = boxes; }
  setPosition(x, z) {
    this.position.set(x, EYE_HEIGHT, z);
    this.velocity.set(0, 0, 0);
    this.camera.position.copy(this.position);
  }
  requestPointerLock() { if (!this.isMobile) document.body.requestPointerLock(); else this.locked = true; }
  _onPointerLockChange() { this.locked = document.pointerLockElement === document.body; }
  _onKeyDown(e) { const key = e.key.toLowerCase(); if (key in this.keys) this.keys[key] = true; }
  _onKeyUp(e) { const key = e.key.toLowerCase(); if (key in this.keys) this.keys[key] = false; }

  _applyLook(dx, dy, base) {
    const sensitivity = clamp(Number(this.settings.sensitivity) || 0.78, 0.3, 1.8);
    const ySign = this.settings.invertY ? 1 : -1;
    this.yaw -= dx * base * sensitivity;
    this.pitch += dy * base * sensitivity * ySign;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    this._applyLook(e.movementX, e.movementY, DESKTOP_LOOK_BASE);
  }

  applyTouchLook(dxPixels, dyPixels) {
    this._applyLook(dxPixels, dyPixels, TOUCH_LOOK_BASE);
  }

  update(dt) {
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    forward.applyQuaternion(yawQuat);
    right.applyQuaternion(yawQuat);

    let inputX = 0;
    let inputY = 0;
    if (this.isMobile) {
      inputX = Math.abs(this.touchMoveX) < 0.08 ? 0 : this.touchMoveX;
      inputY = Math.abs(this.touchMoveY) < 0.08 ? 0 : this.touchMoveY;
    } else {
      inputX = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0);
      inputY = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
    }

    const analogMagnitude = Math.min(1, Math.hypot(inputX, inputY));
    const targetVelocity = new THREE.Vector3();
    if (analogMagnitude > 0) {
      targetVelocity.addScaledVector(forward, inputY);
      targetVelocity.addScaledVector(right, inputX);
      if (targetVelocity.lengthSq() > 1) targetVelocity.normalize();
      const speed = clamp(Number(this.settings.moveSpeed) || 4.8, 3.2, 6.2) * analogMagnitude;
      targetVelocity.normalize().multiplyScalar(speed);
    }

    const smoothing = analogMagnitude > 0 ? ACCELERATION : DECELERATION;
    const alpha = 1 - Math.exp(-smoothing * dt);
    this.velocity.lerp(targetVelocity, alpha);
    if (this.velocity.lengthSq() < 0.0004) this.velocity.set(0, 0, 0);

    const delta = this.velocity.clone().multiplyScalar(dt);
    const newX = this.position.x + delta.x;
    if (!this._collides(newX, this.position.z)) this.position.x = newX;
    else this.velocity.x *= 0.15;

    const newZ = this.position.z + delta.z;
    if (!this._collides(this.position.x, newZ)) this.position.z = newZ;
    else this.velocity.z *= 0.15;

    this.camera.position.copy(this.position);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  _collides(x, z) {
    const playerBox = new THREE.Box3(
      new THREE.Vector3(x - PLAYER_RADIUS, 0, z - PLAYER_RADIUS),
      new THREE.Vector3(x + PLAYER_RADIUS, EYE_HEIGHT + 0.3, z + PLAYER_RADIUS)
    );
    for (const wallBox of this.wallBoxes) if (playerBox.intersectsBox(wallBox)) return true;
    return false;
  }

  getState() {
    return { x: this.position.x, y: this.position.y, z: this.position.z, rotY: this.yaw, rotX: this.pitch };
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
