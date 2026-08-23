import * as CANNON from 'cannon-es';
import { PHYSICS, SURFACES, VEHICLE } from '../config';
import type {
  ImpactEvent,
  SurfaceId,
  VehicleControls,
  VehicleLike,
  VehicleState,
  WheelTelemetry,
} from '../types';
import type { TrackData } from '../types';

export interface VehicleOpts {
  id: number;
  world: CANNON.World;
  track: TrackData;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  heading: number;
}

const FL = 0;
const FR = 1;
const RL = 2;
const RR = 3;
const WHEEL_COUNT = 4;
const REVERSE_INDEX = 0; // gearRatios[0] is reverse
const FIRST_GEAR_INDEX = 2; // gearRatios[1] is N (unused), [2..7] are gears 1..6
const SHIFT_CUT_S = 0.14;
const HANDBRAKE_GRIP_MULT = 0.55;

// cannon-es conventions verified against RaycastVehicle source (0.20):
// forwardWS = surfaceNormal x wheelRightAxis = -Z for an upright car, so a POSITIVE
// engineForce value pushes the car along local -Z. We negate engine force so that
// throttle > 0 thrusts along local +Z. A POSITIVE steeringValue rotates the wheel
// about +Y taking +Z toward +X; with Y-up right-handed axes (right = forward x up),
// +X is the car's LEFT, so positive steeringValue turns LEFT. We store steerAngle
// in input space (positive = RIGHT, matching controls.steer) and negate at the
// RaycastVehicle boundary. setBrake takes an impulse cap (N*s): pass force * dt.

// Static suspension compression at rest: stiffness * compression * mass balances mass*|g|/4.
const STATIC_SAG = Math.abs(PHYSICS.gravity) / (4 * VEHICLE.suspensionStiffness);
// Wheel connection points sit above body origin so the origin IS the center of mass.
const CONN_Y_LIFT = VEHICLE.suspensionRestLength * 0.6;
// Body-origin height above road at rest: suspension length + wheel radius below origin,
// minus the connection lift. Chosen so tires rest with ~60% of travel available.
const RIDE_HEIGHT =
  VEHICLE.suspensionRestLength -
  STATIC_SAG +
  VEHICLE.wheelRadius -
  (VEHICLE.wheelPositions[FL].y + CONN_Y_LIFT);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function torqueFactor(rpm: number): number {
  const ks = VEHICLE.torqueCurveRpm;
  const vs = VEHICLE.torqueCurveVal;
  if (rpm <= ks[0]) return vs[0];
  for (let i = 1; i < ks.length; i++) {
    if (rpm <= ks[i]) {
      const span = ks[i] - ks[i - 1];
      const t = span > 0 ? (rpm - ks[i - 1]) / span : 0;
      return vs[i - 1] + (vs[i] - vs[i - 1]) * t;
    }
  }
  return vs[vs.length - 1];
}

export class Vehicle implements VehicleLike {
  readonly id: number;
  state: VehicleState;

  private readonly chassisBody: CANNON.Body;
  private readonly raycastVehicle: CANNON.RaycastVehicle;
  private readonly track: TrackData;
  private inWorld = false;

  private readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private steerAngle = 0; // rad, positive = right

  private gearIndex: number = FIRST_GEAR_INDEX;
  private rpm: number = VEHICLE.idleRpm;
  private shiftCutTimer = 0;
  private damageAccum = 0;
  private maxContactSlip = 0;

  private impactQueue: ImpactEvent[] = [];
  private readonly wheelSurfaces: SurfaceId[] = ['tarmac', 'tarmac', 'tarmac', 'tarmac'];
  /** Per-wheel projection hints for fast surface lookups. */
  private readonly wheelHints: { idx?: number }[] = [
    {}, {}, {}, {},
  ];

  private readonly fwdAxis = new CANNON.Vec3();
  private readonly rightAxis = new CANNON.Vec3();
  private readonly upAxis = new CANNON.Vec3();
  private readonly tmpA = new CANNON.Vec3();
  private readonly tmpB = new CANNON.Vec3();
  private readonly tmpC = new CANNON.Vec3();
  private readonly tmpD = new CANNON.Vec3();
  private readonly zeroVec = new CANNON.Vec3();

  constructor(opts: VehicleOpts) {
    this.id = opts.id;
    this.track = opts.track;

    const he = VEHICLE.chassisHalfExtents;
    const box = new CANNON.Box(new CANNON.Vec3(he.x, he.y, he.z));
    this.chassisBody = new CANNON.Body({ mass: VEHICLE.mass });
    this.chassisBody.addShape(box, new CANNON.Vec3(0, Math.abs(VEHICLE.comYOffset), 0));
    this.chassisBody.angularDamping = 0.18;
    this.chassisBody.linearDamping = 0.01;
    this.chassisBody.allowSleep = false;

    this.raycastVehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    for (let i = 0; i < VEHICLE.wheelPositions.length; i++) {
      const wp = VEHICLE.wheelPositions[i];
      this.raycastVehicle.addWheel({
        radius: VEHICLE.wheelRadius,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(wp.x, wp.y + CONN_Y_LIFT, wp.z),
        suspensionStiffness: VEHICLE.suspensionStiffness,
        suspensionRestLength: VEHICLE.suspensionRestLength,
        maxSuspensionTravel: VEHICLE.maxSuspensionTravel,
        dampingRelaxation: VEHICLE.dampingRelaxation,
        dampingCompression: VEHICLE.dampingCompression,
        frictionSlip: VEHICLE.frictionSlipBase,
        rollInfluence: VEHICLE.rollInfluence,
        useCustomSlidingRotationalSpeed: true,
        customSlidingRotationalSpeed: -30,
        isFrontWheel: i < RL,
      });
    }

    this.chassisBody.addEventListener('collide', this.onCollide);

    const wheels: WheelTelemetry[] = [];
    for (let i = 0; i < WHEEL_COUNT; i++) {
      wheels.push({
        contact: false,
        surface: 'tarmac',
        slip: 0,
        groundSpeed: 0,
        skidIntensity: 0,
        worldX: 0,
        worldY: 0,
        worldZ: 0,
      });
    }
    this.state = {
      id: opts.id,
      x: 0, y: 0, z: 0,
      qx: 0, qy: 0, qz: 0, qw: 1,
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
      speed: 0,
      forwardSpeed: 0,
      rpm: VEHICLE.idleRpm,
      gear: 1,
      bodyRoll: 0,
      bodyPitch: 0,
      damage: 0,
      upDot: 1,
      wheels,
    };

    this.resetTo(opts.spawnX, opts.spawnY, opts.spawnZ, opts.heading);
  }

  addToWorld(world: unknown): void {
    if (this.inWorld) return;
    this.raycastVehicle.addToWorld(world as CANNON.World);
    this.inWorld = true;
  }

  removeFromWorld(world: unknown): void {
    if (!this.inWorld) return;
    this.raycastVehicle.removeFromWorld(world as CANNON.World);
    this.inWorld = false;
  }

  applyControls(c: VehicleControls): void {
    this.controls.throttle = clamp(c.throttle, 0, 1);
    this.controls.brake = clamp(c.brake, 0, 1);
    this.controls.steer = clamp(c.steer, -1, 1);
    this.controls.handbrake = !!c.handbrake;
  }

  fixedUpdate(dt: number): void {
    if (!(dt > 0)) return;
    const body = this.chassisBody;
    const q = body.quaternion;
    const v = body.velocity;
    const w = body.angularVelocity;
    const ctrl = this.controls;

    // 1. axes and speeds
    this.tmpA.set(0, 0, 1);
    q.vmult(this.tmpA, this.fwdAxis);
    this.tmpA.set(1, 0, 0);
    q.vmult(this.tmpA, this.rightAxis);
    const planarSpeed = Math.hypot(v.x, v.z);
    const forwardSpeed =
      v.x * this.fwdAxis.x + v.y * this.fwdAxis.y + v.z * this.fwdAxis.z;

    // 2. gearbox / reverse mode
    if (this.shiftCutTimer > 0) this.shiftCutTimer = Math.max(0, this.shiftCutTimer - dt);

    const wasReverse = this.gearIndex === REVERSE_INDEX;
    if (!wasReverse && forwardSpeed < 0.6 && ctrl.brake > 0.5 && ctrl.throttle < 0.1) {
      this.gearIndex = REVERSE_INDEX;
    } else if (wasReverse && forwardSpeed > -0.3 && ctrl.throttle > 0.1) {
      this.gearIndex = FIRST_GEAR_INDEX;
    }
    const nowReverse = this.gearIndex === REVERSE_INDEX;

    const circumference = 2 * Math.PI * VEHICLE.wheelRadius;
    const ratioAbs = Math.abs(VEHICLE.gearRatios[this.gearIndex]);
    this.rpm = clamp(
      (Math.abs(forwardSpeed) / circumference) * 60 * ratioAbs * VEHICLE.finalDrive,
      VEHICLE.idleRpm,
      VEHICLE.redlineRpm
    );

    if (!nowReverse) {
      if (this.rpm >= VEHICLE.shiftUpRpm && this.gearIndex < VEHICLE.gearRatios.length - 1) {
        this.gearIndex++;
        this.shiftCutTimer = SHIFT_CUT_S;
      } else if (this.rpm <= VEHICLE.shiftDownRpm && this.gearIndex > FIRST_GEAR_INDEX) {
        this.gearIndex--;
      }
    }

    // 5. per-wheel surface from LAST step's raycast -> frictionSlip per surface (+ handbrake)
    let groundedCount = 0;
    for (let i = 0; i < WHEEL_COUNT; i++) {
      const wi = this.raycastVehicle.wheelInfos[i];
      const rr = wi.raycastResult;
      const hit = wi.isInContact || rr.hasHit;
      if (hit) groundedCount++;
      let surf: SurfaceId = 'tarmac';
      if (hit && rr.hasHit) {
        surf = this.track.surfaceAt(rr.hitPointWorld.x, rr.hitPointWorld.z, rr.hitPointWorld.y);
      }
      this.wheelSurfaces[i] = surf;
      let gripMult = SURFACES[surf].grip;
      if (ctrl.handbrake && i >= RL) gripMult *= HANDBRAKE_GRIP_MULT;
      wi.frictionSlip = VEHICLE.frictionSlipBase * gripMult;
    }

    // 3. engine force at driven (rear) wheels
    const throttleIn = nowReverse ? ctrl.brake : ctrl.throttle;
    const cut = this.shiftCutTimer > 0 ? 0 : 1;
    const dmgFactor = 1 - this.damageAccum * VEHICLE.maxDamagePowerLoss;
    let driveTorque = VEHICLE.peakTorqueNm * torqueFactor(this.rpm) * throttleIn * cut * dmgFactor;
    if (nowReverse) driveTorque *= 0.5;
    const totalForce =
      (driveTorque * ratioAbs * VEHICLE.finalDrive * VEHICLE.drivetrainEfficiency) /
      VEHICLE.wheelRadius;

    // static rear weight share per wheel (front lever arm / wheelbase, split over two tires)
    const fz = Math.abs(VEHICLE.wheelPositions[FL].z);
    const rz = Math.abs(VEHICLE.wheelPositions[RL].z);
    const rearShare = (fz / Math.max(1e-6, fz + rz)) * 0.5;

    for (let i = RL; i <= RR; i++) {
      let f = totalForce * 0.5;
      const cap =
        SURFACES[this.wheelSurfaces[i]].grip * rearShare * VEHICLE.mass * 9.81 * 1.15;
      if (f > cap) f = cap;
      // negate so positive throttle pushes along +Z (cannon applies positive force toward -Z)
      this.raycastVehicle.applyEngineForce(nowReverse ? f : -f, i);
    }
    this.raycastVehicle.applyEngineForce(0, FL);
    this.raycastVehicle.applyEngineForce(0, FR);

    // 4. brakes (impulse caps = force * dt)
    const brakeIn = nowReverse ? ctrl.throttle : ctrl.brake;
    const brakeF = (VEHICLE.brakeTorqueMaxNm / VEHICLE.wheelRadius) * brakeIn;
    const frontImpulse = brakeF * VEHICLE.brakeBiasFront * dt;
    const rearImpulse = brakeF * (1 - VEHICLE.brakeBiasFront) * dt;
    const hbImpulse = ctrl.handbrake ? (VEHICLE.handbrakeTorqueNm / VEHICLE.wheelRadius) * dt : 0;
    this.raycastVehicle.setBrake(frontImpulse, FL);
    this.raycastVehicle.setBrake(frontImpulse, FR);
    this.raycastVehicle.setBrake(rearImpulse + hbImpulse, RL);
    this.raycastVehicle.setBrake(rearImpulse + hbImpulse, RR);

    // steering: lock shrinks with speed; smooth toward target
    const lockT = clamp(planarSpeed / VEHICLE.steerFullLockSpeed, 0, 1);
    const lockDeg =
      VEHICLE.steerLockDegLowSpeed +
      (VEHICLE.steerLockDegHighSpeed - VEHICLE.steerLockDegLowSpeed) * lockT;
    const target = ctrl.steer * ((lockDeg * Math.PI) / 180);
    const rate = Math.abs(ctrl.steer) > 0.05 ? VEHICLE.steerResponseRate : VEHICLE.steerReturnRate;
    const k = 1 - Math.exp(-rate * dt);
    this.steerAngle += (target - this.steerAngle) * k;
    // negate: positive steeringValue turns LEFT physically; steerAngle is input-space (positive = right)
    this.raycastVehicle.setSteeringValue(-this.steerAngle, FL);
    this.raycastVehicle.setSteeringValue(-this.steerAngle, FR);

    // 6. resistances on chassis
    const spSq = planarSpeed * planarSpeed;
    if (planarSpeed > 1e-4) {
      const inv = 1 / planarSpeed;
      const dragF = VEHICLE.dragCoeff * spSq;
      this.tmpB.set(-v.x * inv * dragF, 0, -v.z * inv * dragF);
      body.applyForce(this.tmpB, this.zeroVec);
    }
    if (groundedCount >= 1 && planarSpeed > 0.5) {
      const rollDragAvg =
        (SURFACES[this.wheelSurfaces[FL]].rollDrag +
          SURFACES[this.wheelSurfaces[FR]].rollDrag +
          SURFACES[this.wheelSurfaces[RL]].rollDrag +
          SURFACES[this.wheelSurfaces[RR]].rollDrag) /
        WHEEL_COUNT;
      const rollF = VEHICLE.rollingResistance * rollDragAvg * (VEHICLE.mass / 1280);
      this.tmpB.set((-v.x / planarSpeed) * rollF, 0, (-v.z / planarSpeed) * rollF);
      body.applyForce(this.tmpB, this.zeroVec);
    }
    if (groundedCount >= 2) {
      this.tmpB.set(0, -VEHICLE.downforceCoeff * spSq, 0);
      body.applyForce(this.tmpB, this.zeroVec);
    }

    // 7. yaw stability assist: damp spin when sliding fast, but yield to the
    // driver — active steering into the slide reduces assist so deliberate
    // drifts and counter-steer saves survive
    if (this.maxContactSlip > VEHICLE.yawAssistSlipStart && planarSpeed > 8) {
      const strength = clamp(
        (this.maxContactSlip - VEHICLE.yawAssistSlipStart) / 0.5,
        0,
        1
      );
      const handsOn = Math.min(1, Math.abs(this.steerAngle) / 0.45);
      const tau = clamp(
        -w.y * VEHICLE.yawAssistTorque * strength * (1 - 0.65 * handsOn),
        -VEHICLE.yawAssistTorque,
        VEHICLE.yawAssistTorque
      );
      body.torque.y += tau;
    }
  }

  postStep(dt: number): void {
    const body = this.chassisBody;
    const q = body.quaternion;
    const v = body.velocity;
    const w = body.angularVelocity;

    this.tmpA.set(0, 0, 1);
    q.vmult(this.tmpA, this.fwdAxis);
    this.tmpA.set(1, 0, 0);
    q.vmult(this.tmpA, this.rightAxis);
    this.tmpA.set(0, 1, 0);
    q.vmult(this.tmpA, this.upAxis);

    const speed = Math.hypot(v.x, v.z);
    const forwardSpeed =
      v.x * this.fwdAxis.x + v.y * this.fwdAxis.y + v.z * this.fwdAxis.z;

    this.maxContactSlip = 0;

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const wi = this.raycastVehicle.wheelInfos[i];
      const rr = wi.raycastResult;
      const contact = !!(wi.isInContact || rr.hasHit);
      const t = this.state.wheels[i];

      if (contact && rr.hasHit) {
        const hp = rr.hitPointWorld;
        t.contact = true;
        t.surface = this.track.surfaceAt(hp.x, hp.z, hp.y, this.wheelHints[i]);
        t.worldX = hp.x;
        t.worldY = hp.y;
        t.worldZ = hp.z;
      } else {
        // airborne: estimate wheel-center position from connection point along suspension
        const connLocal = wi.chassisConnectionPointLocal;
        this.tmpB.set(connLocal.x, connLocal.y, connLocal.z);
        body.pointToWorldFrame(this.tmpB, this.tmpC);
        this.tmpB.set(wi.directionLocal.x, wi.directionLocal.y, wi.directionLocal.z);
        body.vectorToWorldFrame(this.tmpB, this.tmpD);
        const len = wi.isInContact ? wi.suspensionLength : wi.suspensionRestLength;
        this.tmpC.x += this.tmpD.x * len;
        this.tmpC.y += this.tmpD.y * len;
        this.tmpC.z += this.tmpD.z * len;
        t.contact = false;
        t.surface = this.wheelSurfaces[i];
        t.worldX = this.tmpC.x;
        t.worldY = this.tmpC.y;
        t.worldZ = this.tmpC.z;
      }

      let slip = 0;
      let groundSpeedLong = 0;
      if (t.contact) {
        // contact-patch velocity: v + w x r
        const rxp = t.worldX - body.position.x;
        const ryp = t.worldY - body.position.y;
        const rzp = t.worldZ - body.position.z;
        const vcx = v.x + w.y * rzp - w.z * ryp;
        const vcy = v.y + w.z * rxp - w.x * rzp;
        const vcz = v.z + w.x * ryp - w.y * rxp;

        // world axle (includes steering); normalize guarded
        let ax = wi.axleWorld.x;
        let ay = wi.axleWorld.y;
        let az = wi.axleWorld.z;
        const alen = Math.hypot(ax, ay, az);
        if (alen > 1e-6) {
          ax /= alen;
          ay /= alen;
          az /= alen;
        } else {
          ax = this.rightAxis.x;
          ay = this.rightAxis.y;
          az = this.rightAxis.z;
        }

        // wheel forward = chassis fwd projected perpendicular to axle
        let adotf = ax * this.fwdAxis.x + ay * this.fwdAxis.y + az * this.fwdAxis.z;
        let fwx = this.fwdAxis.x - ax * adotf;
        let fwy = this.fwdAxis.y - ay * adotf;
        let fwz = this.fwdAxis.z - az * adotf;
        const flen = Math.hypot(fwx, fwy, fwz);
        if (flen > 1e-6) {
          fwx /= flen;
          fwy /= flen;
          fwz /= flen;
        } else {
          fwx = this.fwdAxis.x;
          fwy = this.fwdAxis.y;
          fwz = this.fwdAxis.z;
        }

        const sideVel = vcx * ax + vcy * ay + vcz * az;
        const longVel = vcx * fwx + vcy * fwy + vcz * fwz;

        // tread speed: cannon accumulates deltaRotation with an m=-1 hack for upAxis=1,
        // so physical forward spin rate is -deltaRotation/dt
        let wheelSurfaceSpeed = forwardSpeed;
        if (dt > 1e-6) {
          const spinRate = -wi.deltaRotation / dt;
          if (Number.isFinite(spinRate)) wheelSurfaceSpeed = spinRate * VEHICLE.wheelRadius;
        }

        const denom = Math.max(4, speed + 2);
        const slipLong = Math.abs(longVel - wheelSurfaceSpeed) / denom;
        const slipLat = Math.abs(sideVel) / denom;
        slip = Math.hypot(slipLong * 0.85, slipLat);
        groundSpeedLong = longVel;
        this.maxContactSlip = Math.max(this.maxContactSlip, slip);
      }

      t.slip = slip;
      t.skidIntensity =
        clamp((slip - 0.28) * 1.6, 0, 1) * clamp(speed / 6, 0, 1);
      t.groundSpeed = groundSpeedLong;
    }

    const s = this.state;
    s.x = body.position.x;
    s.y = body.position.y;
    s.z = body.position.z;
    s.qx = q.x;
    s.qy = q.y;
    s.qz = q.z;
    s.qw = q.w;
    s.vx = v.x;
    s.vy = v.y;
    s.vz = v.z;
    s.wx = w.x;
    s.wy = w.y;
    s.wz = w.z;
    s.speed = speed;
    s.forwardSpeed = forwardSpeed;
    s.rpm = this.rpm;
    s.gear = this.gearIndex === REVERSE_INDEX ? -1 : this.gearIndex - 1;
    s.bodyRoll = Math.asin(clamp(this.rightAxis.y, -1, 1));
    s.bodyPitch = Math.asin(clamp(this.fwdAxis.y, -1, 1));
    s.damage = this.damageAccum;
    s.upDot = this.upAxis.y;
  }

  consumeImpacts(): ImpactEvent[] {
    const out = this.impactQueue;
    this.impactQueue = [];
    for (let i = 0; i < out.length; i++) {
      this.damageAccum = clamp(
        this.damageAccum + out[i].impulse * VEHICLE.damageFromImpulse,
        0,
        1
      );
    }
    return out;
  }

  resetTo(x: number, y: number, z: number, heading: number): void {
    const body = this.chassisBody;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    body.position.set(x, y + RIDE_HEIGHT, z);
    this.tmpA.set(0, 1, 0);
    body.quaternion.setFromAxisAngle(this.tmpA, heading); // forward = (sin h, 0, cos h)
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.initPosition.set(x, y + RIDE_HEIGHT, z);
    body.wakeUp();

    this.impactQueue.length = 0;
    this.controls.throttle = 0;
    this.controls.brake = 0;
    this.controls.steer = 0;
    this.controls.handbrake = false;
    this.steerAngle = 0;
    this.gearIndex = FIRST_GEAR_INDEX;
    this.shiftCutTimer = 0;
    this.rpm = VEHICLE.idleRpm;
    for (let i = 0; i < WHEEL_COUNT; i++) {
      this.raycastVehicle.applyEngineForce(0, i);
      this.raycastVehicle.setBrake(0, i);
      this.raycastVehicle.setSteeringValue(0, i);
    }
  }

  syncToThree(): void {
    // intentional no-op: gfx reads vehicle.state directly
  }

  /** World-space wheel transform + steering/visual spin for rendering. */
  getWheelVisual(i: number): { x: number; y: number; z: number; steer: number; spin: number } {
    this.raycastVehicle.updateWheelTransform(i);
    const t = this.raycastVehicle.wheelInfos[i].worldTransform;
    this.wheelVisualSpin += this.raycastVehicle.wheelInfos[i].deltaRotation;
    return { x: t.position.x, y: t.position.y, z: t.position.z, steer: this.steerAngle, spin: this.wheelVisualSpin };
  }

  resetDamage(): void {
    this.damageAccum = 0;
  }

  /** Last applied control inputs (for brake lights etc.). */
  getControlsSnapshot(): VehicleControls {
    return { ...this.controls };
  }

  private wheelVisualSpin = 0;

  private onCollide = (e: { contact?: CANNON.ContactEquation | null }): void => {
    const c = e?.contact;
    if (!c) return;
    // ignore kill-floor / non-world bodies so recovery physics never reads
    // as gameplay impacts
    const other = (c.bi === this.chassisBody ? c.bj : c.bi) as unknown as { ironslideNoImpact?: boolean };
    if (other && other.ironslideNoImpact) return;
    const closing = Math.abs(c.getImpactVelocityAlongNormal());
    // momentum transfer proxy (N*s): closing speed x vehicle mass
    const proxy = clamp(closing * VEHICLE.mass, 0, 120000);
    if (proxy < 9000) return; // ~<7 m/s closing = resting/scrape noise
    let px: number;
    let py: number;
    let pz: number;
    let nx: number;
    let ny: number;
    let nz: number;
    if (c.bi === this.chassisBody) {
      px = c.bi.position.x + c.ri.x;
      py = c.bi.position.y + c.ri.y;
      pz = c.bi.position.z + c.ri.z;
      nx = c.ni.x;
      ny = c.ni.y;
      nz = c.ni.z;
    } else {
      px = c.bj.position.x + c.rj.x;
      py = c.bj.position.y + c.rj.y;
      pz = c.bj.position.z + c.rj.z;
      nx = -c.ni.x;
      ny = -c.ni.y;
      nz = -c.ni.z;
    }
    this.impactQueue.push({ impulse: proxy, x: px, y: py, z: pz, nx, ny, nz });
  };
}

export function createVehicle(opts: VehicleOpts): Vehicle {
  return new Vehicle(opts);
}
