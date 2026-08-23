import type { AIDriver, CarProgress, TrackData, VehicleControls } from '../types';
import { AI } from '../config';

interface LineData {
  offsets: Float64Array;
}

interface ScNode {
  x: number;
  y: number;
  z: number;
  kappa: number;
  cum: number;
  width: number;
}

const VMAX_CAP = 63;
const CURV_FLOOR = 1e-4;
const CURV_GAIN = 240;
const PULL_RATE = 0.18;
const FLOW_RATE = 0.42;
const LINE_PASSES = 50;
const PROFILE_SAFETY = 0.88;
const FOLLOW_RANGE = 9;
const FOLLOW_HEADWAY_M = 5;
const MAX_PROJECTIONS_PER_UPDATE = 4;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrap(v: number, period: number): number {
  return ((v % period) + period) % period;
}

function isLowGrip(surface: string): boolean {
  return surface === 'gravel' || surface === 'dirt' || surface === 'oil';
}

/** Racing-line offsets: apex-clipping inside pull smoothed by neighbor flow. */
function buildLine(track: TrackData): LineData {
  const pts = track.points;
  const n = pts.length;
  const offsets = new Float64Array(n);
  if (n === 0 || !(track.spacing > 0)) {
    return { offsets };
  }

  let curv = new Float64Array(n);
  for (let i = 0; i < n; i++) curv[i] = pts[i].curvature;
  // single light blur keeps corner peaks sharp for planning elsewhere
  let blurred = new Float64Array(n);
  for (let pass = 0; pass < 1; pass++) {
    for (let i = 0; i < n; i++) {
      blurred[i] =
        (curv[(i - 2 + n) % n] * 0.5 +
          curv[(i - 1 + n) % n] * 0.85 +
          curv[i] +
          curv[(i + 1) % n] * 0.85 +
          curv[(i + 2) % n] * 0.5) /
        3.7;
    }
    const swap = curv;
    curv = blurred;
    blurred = swap;
  }

  const maxOff = new Float64Array(n);
  for (let i = 0; i < n; i++) maxOff[i] = Math.max(pts[i].width * 0.5 - 2.1, 0);

  let cur = new Float64Array(n);
  let next = new Float64Array(n);
  for (let pass = 0; pass < LINE_PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      const k = curv[i];
      const target = clamp(
        Math.sign(k) * Math.abs(k) * CURV_GAIN,
        -maxOff[i],
        maxOff[i]
      );
      let o = cur[i] + PULL_RATE * (target - cur[i]);
      const nb = 0.5 * (cur[(i - 1 + n) % n] + cur[(i + 1) % n]);
      o += FLOW_RATE * (nb - o);
      next[i] = clamp(o, -maxOff[i], maxOff[i]);
    }
    const swap = cur;
    cur = next;
    next = swap;
  }
  offsets.set(cur);

  return { offsets };
}

class AIDriverImpl implements AIDriver {
  private lineTrack: TrackData | null = null;
  private line: LineData | null = null;
  private scNodes: ScNode[] = [];
  private stuckTimer = 0;
  private reverseTimer = 0;
  private reversing = false;
  private lastSteer = 0.6;
  private shift = 0;
  private offRoadTimer = 0;

  constructor(private readonly skill: number) {}

  private ensureLine(track: TrackData): void {
    if (this.lineTrack === track && this.line) return;
    this.lineTrack = track;
    this.line = buildLine(track);

    this.scNodes = [];
    const sp = track.shortcutPath;
    let cum = 0;
    for (let i = 0; i < sp.length; i++) {
      if (i > 0) {
        cum += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].z - sp[i - 1].z);
      }
      const a = sp[Math.max(i - 2, 0)];
      const b = sp[Math.min(i + 2, sp.length - 1)];
      const h = Math.atan2(b.x - a.x, b.z - a.z);
      const hPrev = Math.atan2(
        sp[Math.min(i + 2, sp.length - 1)].x - sp[Math.max(i - 2, 0)].x,
        sp[Math.min(i + 2, sp.length - 1)].z - sp[Math.max(i - 2, 0)].z
      );
      void hPrev;
      const spanM = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      // heading change across neighbors gives local path curvature
      const hA = Math.atan2(
        sp[Math.min(i + 1, sp.length - 1)].x - sp[Math.max(i - 1, 0)].x,
        sp[Math.min(i + 1, sp.length - 1)].z - sp[Math.max(i - 1, 0)].z
      );
      let dh = h - hA;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      this.scNodes.push({
        x: sp[i].x,
        y: sp[i].y,
        z: sp[i].z,
        kappa: Math.abs(dh / spanM),
        cum,
        width: sp[i].width ?? 8,
      });
    }
  }

  private findCar(cars: CarProgress[], id: number): CarProgress | null {
    for (const c of cars) {
      if (c.id === id) return c;
    }
    return null;
  }

  /** Shortcut-corridor mode when on/near the dirt path at the mouths. */
  private shortcutControls(
    myDist: number,
    st: VehicleStateLite,
    fwdAbs: number,
    scale: number
  ): VehicleControls | null {
    const track = this.lineTrack;
    if (!track || !track.shortcut || this.scNodes.length < 3) return null;
    const nodes = this.scNodes;

    let idx = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - st.x;
      const dz = nodes[i].z - st.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        idx = i;
      }
    }
    const nearDist = Math.sqrt(bestD2);
    const corridorHalf = nodes[idx].width / 2 + 2.5;

    const L = track.length;
    const scc = track.shortcut;
    const dEnter = Math.abs(wrap(myDist - scc.enterDist + L / 2, L) - L / 2);
    const dExit = Math.abs(wrap(myDist - scc.exitDist + L / 2, L) - L / 2);
    const nearMouth = dEnter < 30 || dExit < 30;
    const interior = idx > 0 && idx < nodes.length - 1;
    if (!interior && !nearMouth) return null;
    if (nearDist > corridorHalf && !nearMouth) return null;

    const spacingGuess =
      nodes.length > 4 ? (nodes[nodes.length - 1].cum - nodes[0].cum) / (nodes.length - 1) || 5 : 5;
    const look = 7 + 0.3 * fwdAbs;
    let ti = idx + Math.max(1, Math.round(look / spacingGuess));
    ti = Math.min(nodes.length - 1, ti);
    const tn = nodes[ti];

    let fx = 2 * (st.qw * st.qy + st.qx * st.qz);
    let fz = 1 - 2 * (st.qx * st.qx + st.qy * st.qy);
    const flen = Math.hypot(fx, fz);
    if (!(flen > 1e-6)) {
      fx = nodes[idx].x - st.x;
      fz = nodes[idx].z - st.z;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
    } else {
      fx /= flen;
      fz /= flen;
    }
    const rx = -fz;
    const rz = fx;
    const toX = tn.x - st.x;
    const toZ = tn.z - st.z;
    const bearing = Math.atan2(toX * rx + toZ * rz, toX * fx + toZ * fz);

    const latA = AI.latAccelBase * 0.55;
    let vAllow = 16;
    for (let k = idx; k <= ti; k++) {
      const kk = Math.max(nodes[k].kappa, CURV_FLOOR);
      vAllow = Math.min(vAllow, Math.sqrt(latA / kk));
    }
    const targetV = Math.max(7, vAllow) * scale;

    const steer = clamp(bearing * (AI.steerP * 1.35) - st.wy * AI.steerD, -1, 1);
    this.lastSteer = steer;

    let throttle: number;
    let brake: number;
    if (fwdAbs < targetV - 0.5) {
      throttle = clamp((targetV - fwdAbs) * 0.5, 0, 1);
      brake = 0;
    } else {
      throttle = 0;
      brake = clamp((fwdAbs - targetV) * 0.42, 0, 1);
    }
    return { throttle, brake, steer, handbrake: false };
  }

  update(
    dt: number,
    cars: CarProgress[],
    myId: number,
    track: TrackData,
    speedScale: number
  ): VehicleControls {
    this.ensureLine(track);

    let scale = speedScale;
    if (!Number.isFinite(scale)) scale = 1;
    const step = Number.isFinite(dt) ? Math.max(dt, 0) : 0;

    const idle: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const me = this.findCar(cars, myId);
    if (!me || !this.line || !this.lineTrack) return idle;

    const st = me.state;
    const fwd = Number.isFinite(st.forwardSpeed) ? st.forwardSpeed : 0;
    const fwdAbs = Math.abs(fwd);

    if (this.reversing) {
      this.reverseTimer -= step;
      if (this.reverseTimer <= 0) {
        this.reversing = false;
        this.stuckTimer = 0;
      }
      return { throttle: 0, brake: 1, steer: clamp(-this.lastSteer, -1, 1), handbrake: false };
    }

    if (fwdAbs < AI.stuckSpeed) this.stuckTimer += step;
    else if (fwdAbs > 3) this.stuckTimer = 0;
    if (this.stuckTimer >= AI.stuckTime) {
      this.reversing = true;
      this.reverseTimer = AI.reverseTime;
      return { throttle: 0, brake: 1, steer: clamp(-this.lastSteer, -1, 1), handbrake: false };
    }

    let lowGripWheels = 0;
    for (const w of st.wheels) {
      if (isLowGrip(w.surface)) lowGripWheels++;
    }
    const careful = lowGripWheels * 2 > st.wheels.length;

    if (track.shortcut && this.scNodes.length >= 3) {
      const scCtrl = this.shortcutControls(me.dist, st, fwdAbs, scale);
      if (scCtrl) return scCtrl;
    }

    const n = track.points.length;
    const spacing = track.spacing;
    if (n === 0 || !(spacing > 0)) return idle;

    const look = AI.lookaheadBase + AI.lookaheadPerSpeed * fwdAbs;
    const selfProj = track.project(st.x, st.z);
    const myLat = selfProj.lateral;

    interface Threat {
      car: CarProgress;
      ds: number;
    }
    const horizon = fwdAbs * AI.avoidLookaheadTime + 8;
    const L = track.length;
    const threats: Threat[] = [];
    for (const other of cars) {
      if (other.id === myId) continue;
      if (other.totalProgress < me.totalProgress - 5) continue;
      if (fwdAbs - Math.abs(other.state.forwardSpeed) <= 0) continue;
      const ds = wrap(other.dist - me.dist + L / 2, L) - L / 2;
      if (ds <= 0 || ds >= horizon) continue;
      threats.push({ car: other, ds });
    }
    threats.sort((a, b) => a.ds - b.ds);

    const sc = track.shortcut;
    let inJunction = false;
    if (sc) {
      const d = me.dist;
      inJunction =
        (d > sc.enterDist - 32 && d < sc.enterDist + 18) ||
        (d > sc.exitDist - 18 && d < sc.exitDist + 32);
    }
    const maxShift = inJunction ? 2.0 : AI.avoidLateralGain;
    let shiftTarget = 0;
    let projected = 0;
    let leadGap = Infinity;
    let leadSpeed = 0;
    for (const t of threats) {
      if (projected >= MAX_PROJECTIONS_PER_UPDATE - 1) break;
      projected++;
      const op = track.project(t.car.state.x, t.car.state.z);
      const latDelta = Math.abs(myLat - op.lateral);
      if (leadGap === Infinity) {
        leadGap = t.ds;
        leadSpeed = Math.max(0, t.car.state.speed);
      }
      if (latDelta < 2.4 && shiftTarget === 0) {
        const urgency = clamp(1 - t.ds / horizon, 0, 1);
        const side = Math.sign(myLat - op.lateral) || ((myId % 2) * 2 - 1);
        shiftTarget = side * maxShift * urgency;
        break;
      }
    }

    const shiftRate = Math.min(1, step * 3);
    this.shift += (shiftTarget - this.shift) * shiftRate;

    // off-road recovery: strays aim straight back to the tarmac
    const hwHere = track.sampleAt(selfProj.dist).width * 0.5;
    if (Math.abs(myLat) > hwHere + 1.2) this.offRoadTimer += step;
    else this.offRoadTimer = Math.max(0, this.offRoadTimer - step * 2);
    const recovering = this.offRoadTimer > 0.35;
    if (recovering && this.offRoadTimer > 3.2 && !this.reversing) {
      // orbiting out there: back out and try again
      this.reversing = true;
      this.reverseTimer = AI.reverseTime + 0.4;
    }

    // corner-speed limit: min curvature allowance over the lookahead window
    // low-grip wheels plan with a factor matching real gravel/oil grip ratios
    const latA = (AI.latAccelBase + this.skill * AI.latAccelSkillScale) * (careful ? 0.55 : 1);
    const iHere = Math.floor(wrap(me.dist, L) / spacing);
    const span = Math.ceil((fwdAbs * 1.6 + 35) / spacing);
    let vAllow = VMAX_CAP;
    for (let k = 0; k <= span; k++) {
      const p = track.points[(iHere + k) % n];
      const kk = Math.abs(p.curvature);
      if (kk < CURV_FLOOR) continue;
      const vCorner = Math.sqrt(latA / kk) * PROFILE_SAFETY;
      if (vCorner < vAllow) vAllow = vCorner;
    }
    if (inJunction) vAllow = Math.min(vAllow, 21);

    // car-following: never ram the leader, hold a headway-based pace
    if (leadGap < FOLLOW_RANGE) {
      const desired = leadSpeed + Math.max(0, leadGap - FOLLOW_HEADWAY_M) * 0.55;
      vAllow = Math.min(vAllow, desired);
    }

    let targetV = vAllow * (0.94 + 0.06 * this.skill) * scale;
    if (recovering) targetV = Math.min(targetV, 7);
    if (!Number.isFinite(targetV) || targetV < 0) targetV = 0;

    const sTarget = me.dist + (recovering ? 5 : look);
    const tp = track.sampleAt(sTarget);
    const fi = sTarget / spacing;
    const oi0 = wrap(Math.floor(fi), n);
    const oi1 = (oi0 + 1) % n;
    const oa = clamp(fi - Math.floor(fi), 0, 1);
    const line = this.line;
    const lineOff = line.offsets[oi0] * (1 - oa) + line.offsets[oi1] * oa;
    const maxOffHere = Math.max(tp.width * 0.5 - 2.1, 0);
    let offTotal: number;
    if (recovering) {
      // aim back inside: negate current lateral offset direction
      const backSide = -Math.sign(myLat || 1);
      offTotal = clamp(backSide * Math.max(1.5, hwHere - 2.2), -maxOffHere, maxOffHere);
    } else {
      offTotal = clamp(lineOff + this.shift, -maxOffHere, maxOffHere);
    }
    const steerGainMul = recovering ? 1.7 : 1;
    let tgtX = tp.x + tp.lx * offTotal;
    let tgtZ = tp.z + tp.lz * offTotal;
    if (recovering && Math.abs(myLat) > hwHere * 1.2) {
      // far stray: projection is unreliable — home on the literal nearest road sample
      let bi = 0;
      let bd = Infinity;
      for (let q = 0; q < n; q++) {
        const P = track.points[q];
        const dd = (P.x - st.x) * (P.x - st.x) + (P.z - st.z) * (P.z - st.z);
        if (dd < bd) {
          bd = dd;
          bi = q;
        }
      }
      tgtX = track.points[bi].x;
      tgtZ = track.points[bi].z;
    }

    const qx = st.qx;
    const qy = st.qy;
    const qz = st.qz;
    const qw = st.qw;
    let fx = 2 * (qw * qy + qx * qz);
    let fz = 1 - 2 * (qx * qx + qy * qy);
    const flen = Math.hypot(fx, fz);
    if (!(flen > 1e-6)) {
      const ti2 = wrap(selfProj.dist / spacing, n);
      fx = track.points[ti2].tx;
      fz = track.points[ti2].tz;
    } else {
      fx /= flen;
      fz /= flen;
    }
    const rx = -fz;
    const rz = fx;

    const toX = tgtX - st.x;
    const toZ = tgtZ - st.z;
    const bearing = Math.atan2(toX * rx + toZ * rz, toX * fx + toZ * fz);
    const steerP = AI.steerP * (careful ? 1.3 : 1) * steerGainMul;
    const steer = clamp(bearing * steerP - st.wy * AI.steerD, -1, 1);
    this.lastSteer = steer;

    let throttle: number;
    let brake: number;
    if (fwd < targetV - 0.5) {
      throttle = clamp((targetV - fwd) * 0.5, 0, 1);
      brake = 0;
    } else {
      throttle = 0;
      brake = clamp((fwd - targetV) * 0.42, 0, 1);
    }
    if (leadGap < 4.5) throttle = Math.min(throttle, 0.25);

    return { throttle, brake, steer, handbrake: false };
  }
}

interface VehicleStateLite {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  wy: number;
}

export function createAIDriver(id: number, skill: number): AIDriver {
  void id;
  return new AIDriverImpl(clamp(skill, 0, 1));
}
