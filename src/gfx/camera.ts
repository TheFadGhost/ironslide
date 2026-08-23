import * as THREE from 'three';
import { CAMERA } from '../config';
import type { VehicleState } from '../types';

export type CameraMode = 'chase' | 'hood' | 'orbit';

const MAX_ROLL = (3 * Math.PI) / 180;
const SPEED_FOV_REF = 62;
const ORBIT_RADIUS = 9;
const ORBIT_HEIGHT = 3;
const ORBIT_RATE = 0.22;

const _fwd = new THREE.Vector3();
const _planar = new THREE.Vector3();
const _blend = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _eq = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _carQ = new THREE.Quaternion();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Stable semi-implicit spring: acc = (desired-pos)*k - vel*d */
function spring(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  desired: THREE.Vector3,
  k: number,
  d: number,
  dt: number
): void {
  _acc.subVectors(desired, pos).multiplyScalar(k).addScaledVector(vel, -d);
  vel.addScaledVector(_acc, dt);
  pos.addScaledVector(vel, dt);
}

export class CameraRig {
  readonly fx = { chromatic: 0, speedBlur: 0, flash: 0 };
  mode: CameraMode = 'chase';

  private cam: THREE.PerspectiveCamera;
  private state: VehicleState | null = null;
  private t = 0;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private lookPos = new THREE.Vector3();
  private lookVel = new THREE.Vector3();
  private trauma = 0;
  private impactKick = 0;
  private fov: number = CAMERA.fovBase;
  private orbitAngle = 0;
  private carQuat = new THREE.Quaternion();

  constructor(camera: THREE.PerspectiveCamera) {
    this.cam = camera;
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
  }

  cycleMode(): void {
    this.mode = this.mode === 'chase' ? 'hood' : this.mode === 'hood' ? 'orbit' : 'chase';
  }

  setTarget(state: VehicleState): void {
    this.state = state;
  }

  reportImpacts(totalImpulse: number): void {
    if (!(totalImpulse > 0)) return;
    const gain = totalImpulse * CAMERA.shakeFromImpulse;
    this.trauma = clamp(this.trauma + gain, 0, 1);
    this.impactKick = Math.min(CAMERA.fovImpactKick, this.impactKick + totalImpulse * 0.0003);
    this.fx.flash = Math.min(1, this.fx.flash + totalImpulse * 0.00002 + gain * 0.35);
  }

  snapBehind(): void {
    const s = this.state;
    if (!s) return;
    this.computeDesiredChase(_desired, _look, s);
    this.pos.copy(_desired);
    this.vel.set(0, 0, 0);
    this.lookPos.copy(_look);
    this.lookVel.set(0, 0, 0);
    this.carQuat.set(s.qx, s.qy, s.qz, s.qw);
    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(_look);
    const target = this.targetFov(s.speed);
    this.fov = target;
    this.cam.fov = target;
    this.cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    const d = clamp(dt, 0, 0.05);
    this.t += d;
    this.trauma *= Math.exp(-CAMERA.shakeDecay * d);
    if (this.trauma < 1e-4) this.trauma = 0;
    this.impactKick *= Math.exp(-CAMERA.fovRecovery * d);
    if (this.impactKick < 1e-3) this.impactKick = 0;
    this.fx.flash *= Math.exp(-4 * d);

    const s = this.state;
    if (!s) return;

    const chromaT = clamp(this.trauma * 1.1 + (s.speed / SPEED_FOV_REF) * 0.35, 0, 1);
    this.fx.chromatic = damp(this.fx.chromatic, chromaT, 8, d);
    const blurT = clamp((s.speed - 26) / 36, 0, 1) * 0.85;
    this.fx.speedBlur = damp(this.fx.speedBlur, blurT, 6, d);

    if (this.mode === 'chase') this.updateChase(s, d);
    else if (this.mode === 'hood') this.updateHood(s, d);
    else this.updateOrbit(s, d);

    const target = this.targetFov(s.speed);
    this.fov = damp(this.fov, target, 12, d);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }

  private targetFov(speed: number): number {
    const norm = clamp(speed / SPEED_FOV_REF, 0, 1);
    let f = CAMERA.fovBase + CAMERA.fovPerSpeed * Math.pow(norm, 1.25) + this.impactKick;
    if (this.mode === 'hood') f += 6;
    return f;
  }

  private computeDesiredChase(outPos: THREE.Vector3, outLook: THREE.Vector3, s: VehicleState): void {
    _carQ.set(s.qx, s.qy, s.qz, s.qw);
    _fwd.set(0, 0, 1).applyQuaternion(_carQ);
    _planar.set(s.vx, 0, s.vz);
    const vl = _planar.length();
    if (vl > 0.5) _planar.divideScalar(vl);
    else {
      _planar.set(_fwd.x, 0, _fwd.z);
      const pl = _planar.length();
      if (pl > 1e-5) _planar.divideScalar(pl);
      else _planar.set(0, 0, 1);
    }
    _blend.copy(_fwd).lerp(_planar, clamp(s.speed / 18, 0, 0.55)).normalize();
    const dist = CAMERA.chaseDistance * (1 + s.speed * 0.006);
    outPos.set(s.x, s.y, s.z).addScaledVector(_blend, -dist);
    outPos.y += CAMERA.chaseHeight;
    outLook.set(s.x, s.y, s.z).addScaledVector(_fwd, CAMERA.lookAhead);
    outLook.x += s.vx * 0.12;
    outLook.z += s.vz * 0.12;
  }

  private updateChase(s: VehicleState, dt: number): void {
    this.computeDesiredChase(_desired, _look, s);
    spring(this.pos, this.vel, _desired, CAMERA.chaseStiffness, CAMERA.chaseDamping, dt);
    spring(this.lookPos, this.lookVel, _look, CAMERA.chaseStiffness * 0.4, CAMERA.chaseDamping * 0.75, dt);

    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.lookPos);

    // cornering roll: lean up-vector into lateral g (yawRate * speed), capped 3deg
    const tilt = clamp(s.wy * s.speed * 0.0045, -MAX_ROLL, MAX_ROLL);
    if (tilt !== 0) {
      _axis.subVectors(this.lookPos, this.pos).normalize();
      _q.setFromAxisAngle(_axis, tilt);
      this.cam.quaternion.premultiply(_q);
    }
    this.applyShake(1);
  }

  private updateHood(s: VehicleState, dt: number): void {
    _carQ.set(s.qx, s.qy, s.qz, s.qw);
    this.carQuat.slerp(_carQ, 1 - Math.exp(-18 * dt));
    _blend.set(0, CAMERA.hoodHeight, CAMERA.hoodForward).applyQuaternion(this.carQuat);
    this.cam.position.set(s.x + _blend.x, s.y + _blend.y, s.z + _blend.z);
    this.cam.quaternion.copy(this.carQuat);
    this.applyShake(0.45);
    this.syncSpringsToCamera();
  }

  private updateOrbit(s: VehicleState, dt: number): void {
    this.orbitAngle += dt * ORBIT_RATE;
    _desired.set(
      s.x + Math.cos(this.orbitAngle) * ORBIT_RADIUS,
      s.y + ORBIT_HEIGHT,
      s.z + Math.sin(this.orbitAngle) * ORBIT_RADIUS
    );
    spring(this.pos, this.vel, _desired, CAMERA.chaseStiffness, CAMERA.chaseDamping, dt);
    _look.set(s.x, s.y + 0.8, s.z);
    spring(this.lookPos, this.lookVel, _look, CAMERA.chaseStiffness * 0.4, CAMERA.chaseDamping * 0.75, dt);
    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.lookPos);
  }

  /** Keeps chase springs continuous while a rigid mode owns the camera. */
  private syncSpringsToCamera(): void {
    this.pos.copy(this.cam.position);
    this.vel.set(0, 0, 0);
    _axis.set(0, 0, -1).applyQuaternion(this.cam.quaternion);
    this.lookPos.copy(this.cam.position).addScaledVector(_axis, 10);
    this.lookVel.set(0, 0, 0);
  }

  /** Deterministic layered-sine jitter, amplitude 0.05 rad at full trauma. */
  private applyShake(scale: number): void {
    if (this.trauma <= 0) return;
    const a = 0.05 * this.trauma * this.trauma * scale;
    const t = this.t;
    const nx = Math.sin(t * 31.7) * 0.62 + Math.sin(t * 47.3 + 1.3) * 0.38;
    const ny = Math.sin(t * 39.1 + 2.1) * 0.58 + Math.sin(t * 53.9 + 0.7) * 0.42;
    const nz = Math.sin(t * 43.7 + 4.2) * 0.5 + Math.sin(t * 61.3 + 2.9) * 0.5;
    _euler.set(nx * a, ny * a, nz * a, 'XYZ');
    _eq.setFromEuler(_euler);
    this.cam.quaternion.multiply(_eq);
  }
}
