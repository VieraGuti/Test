import * as THREE from 'three';

const PLAYER_RADIUS = 0.4;
const EYE_HEIGHT = 1.7;
const DESKTOP_LOOK_BASE = 0.002;
const TOUCH_LOOK_BASE = 0.0032;

// Tactical movement tuning: responsive, but without the instant arcade snap.
const ACCELERATION = 11.5;
const DECELERATION = 16.0;
const TURN_ACCELERATION = 20.0;
const STRAFE_SCALE = 0.88;
const BACKWARD_SCALE = 0.78;
const MOBILE_DEADZONE = 0.035;
const DEFAULT_LOOK_SMOOTHING = 0.18;

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

    // Tiny low-pass filter removes the 'steppy' feeling of mobile browser pointer events.
    // It is deliberately light so aiming still feels immediate.
    this.filteredLookX = 0;
    this.filteredLookY = 0;

    // Reused vectors avoid garbage collection spikes on mobile Safari.
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._targetVelocity = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._yawQuat = new THREE.Quaternion();
    this._upAxis = new THREE.Vector3(0, 1, 0);
    this._cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');

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
    this.filteredLookX = 0;
    this.filteredLookY = 0;
    this.velocity.multiplyScalar(0.18);
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
  }

  setWallBoxes(boxes) { this.wallBoxes = boxes; }

  setPosition(x, z) {
    this.position.set(x, EYE_HEIGHT, z);
    this.velocity.set(0, 0, 0);
    this.filteredLookX = 0;
    this.filteredLookY = 0;
    this.camera.position.copy(this.position);
  }

  requestPointerLock() {
    if (!this.isMobile) document.body.requestPointerLock();
    else this.locked = true;
  }

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
    // Low-pass raw pointer deltas. At the default 0.18, 82% of the newest
    // movement is applied immediately and only 18% carries across a frame.
    const smoothing = clamp(Number(this.settings.lookSmoothing ?? DEFAULT_LOOK_SMOOTHING), 0, 0.55);
    const fresh = 1 - smoothing;
    this.filteredLookX = this.filteredLookX * smoothing + dxPixels * fresh;
    this.filteredLookY = this.filteredLookY * smoothing + dyPixels * fresh;

    if (Math.abs(this.filteredLookX) < 0.001) this.filteredLookX = 0;
    if (Math.abs(this.filteredLookY) < 0.001) this.filteredLookY = 0;
    this._applyLook(this.filteredLookX, this.filteredLookY, TOUCH_LOOK_BASE);
  }

  update(dt) {
    // Camera-relative axes, reused every frame.
    this._forward.set(0, 0, -1);
    this._right.set(1, 0, 0);
    this._yawQuat.setFromAxisAngle(this._upAxis, this.yaw);
    this._forward.applyQuaternion(this._yawQuat);
    this._right.applyQuaternion(this._yawQuat);

    let inputX = 0;
    let inputY = 0;

    if (this.isMobile) {
      inputX = Math.abs(this.touchMoveX) < MOBILE_DEADZONE ? 0 : this.touchMoveX;
      inputY = Math.abs(this.touchMoveY) < MOBILE_DEADZONE ? 0 : this.touchMoveY;
    } else {
      inputX = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0);
      inputY = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
    }

    const inputMagnitude = Math.min(1, Math.hypot(inputX, inputY));
    this._targetVelocity.set(0, 0, 0);

    if (inputMagnitude > 0) {
      const absX = Math.abs(inputX);
      const absY = Math.abs(inputY);
      const axisTotal = Math.max(0.0001, absX + absY);
      const strafeWeight = absX / axisTotal;
      const forwardScale = inputY < 0 ? BACKWARD_SCALE : 1;
      const directionalScale = forwardScale * (1 - strafeWeight) + STRAFE_SCALE * strafeWeight;

      this._targetVelocity
        .addScaledVector(this._forward, inputY)
        .addScaledVector(this._right, inputX);

      const len = this._targetVelocity.length();
      if (len > 1) this._targetVelocity.multiplyScalar(1 / len);

      const baseSpeed = clamp(Number(this.settings.moveSpeed) || 4.8, 3.2, 6.2);
      this._targetVelocity.multiplyScalar(baseSpeed * inputMagnitude * directionalScale);
    }

    let response = inputMagnitude > 0 ? ACCELERATION : DECELERATION;
    if (inputMagnitude > 0 && this.velocity.lengthSq() > 0.04 && this.velocity.dot(this._targetVelocity) < 0) {
      response = TURN_ACCELERATION;
    }

    const alpha = 1 - Math.exp(-response * dt);
    this.velocity.lerp(this._targetVelocity, alpha);

    if (inputMagnitude === 0 && this.velocity.lengthSq() < 0.003) this.velocity.set(0, 0, 0);

    this._delta.copy(this.velocity).multiplyScalar(dt);

    const newX = this.position.x + this._delta.x;
    if (!this._collides(newX, this.position.z)) {
      this.position.x = newX;
    } else {
      this.velocity.x *= 0.08;
    }

    const newZ = this.position.z + this._delta.z;
    if (!this._collides(this.position.x, newZ)) {
      this.position.z = newZ;
    } else {
      this.velocity.z *= 0.08;
    }

    this.camera.position.copy(this.position);
    this._cameraEuler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._cameraEuler);
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
