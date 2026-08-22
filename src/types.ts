// Shared type contracts for IRONSLIDE. Frozen interfaces — subsystems code against these.

export type SurfaceId = 'tarmac' | 'kerb' | 'gravel' | 'dirt' | 'oil';

export interface VehicleControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, negative = left, positive = right
  handbrake: boolean;
}

export const ZERO_CONTROLS: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export interface WheelTelemetry {
  contact: boolean;
  surface: SurfaceId;
  slip: number; // combined slip ratio+angle metric, 0 = rolling clean, >1 = sliding hard
  groundSpeed: number; // longitudinal m/s at contact patch (signed)
  skidIntensity: number; // 0..1 visual/audio emission strength
  worldX: number;
  worldY: number;
  worldZ: number;
}

export interface ImpactEvent {
  impulse: number; // N*s
  x: number;
  y: number;
  z: number; // world contact point
  nx: number;
  ny: number;
  nz: number; // world contact normal (pointing away from other body)
}

export interface VehicleState {
  id: number;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number; // angular velocity
  speed: number; // planar speed m/s >= 0
  forwardSpeed: number; // signed m/s along chassis forward (+Z local)
  rpm: number; // 700..7500
  gear: number; // -1 R, 0 N, 1..6
  bodyRoll: number; // rad
  bodyPitch: number; // rad
  damage: number; // 0..1
  upDot: number; // chassis up dot world up, < 0 means flipped
  wheels: WheelTelemetry[]; // FL, FR, RL, RR
}

export interface TrackPoint {
  x: number; y: number; z: number; // centerline position
  tx: number; ty: number; tz: number; // unit tangent (direction of travel)
  lx: number; lz: number; // unit left vector (horizontal): up x tangent normalized
  width: number; // full road width (m)
  dist: number; // arc length from start line
  curvature: number; // signed 1/R, positive = curving left
}

export interface Projection {
  dist: number; // arc length along centerline [0, length)
  lateral: number; // signed meters, positive = left of centerline
  index: number; // nearest sample index
}

export interface GridSlot {
  x: number; y: number; z: number;
  heading: number; // radians, forward = (sin h, 0, cos h)
}

export interface TrackData {
  name: string;
  points: TrackPoint[]; // closed loop, uniform spacing
  spacing: number;
  length: number;
  gridSlots: GridSlot[]; // at least 8
  startPoint: GridSlot;
  project(x: number, z: number): Projection;
  sampleAt(dist: number): TrackPoint; // wraps
  surfaceAt(x: number, z: number, y: number): SurfaceId;
  checkpointFracs: number[]; // fractions of length for interior gates, ordered
  shortcut: { enterDist: number; exitDist: number } | null; // main-loop range bypassed by shortcut
  boundsMin: { x: number; z: number };
  boundsMax: { x: number; z: number };
  /** Static collision shapes for the physics world (road bed excluded — terrain plane covers it). */
  colliderSpecs: ColliderSpec[];
  /** Zones rendered differently / emitting different particles: [{x,z,r,surface}] */
  surfaceZones: SurfaceZone[];
  /** Centerline polyline of the shortcut for mesh building, empty if none */
  shortcutPath: { x: number; y: number; z: number; width: number }[];
}

export interface ColliderSpec {
  kind: 'box';
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number; // half extents
  yaw: number; // rotation around Y
}

export interface SurfaceZone {
  x: number; z: number; r: number;
  surface: SurfaceId;
}

export interface CarProgress {
  id: number;
  state: VehicleState;
  dist: number; // projected arc length [0,length)
  lap: number; // completed laps (starts 0)
  totalProgress: number; // lap * length + dist
  finished: boolean;
  finishTime: number; // s since race start, Infinity while racing
}

export interface AIDriver {
  update(dt: number, cars: CarProgress[], myId: number, track: TrackData, speedScale: number): VehicleControls;
}

export interface VehicleLike {
  readonly id: number;
  state: VehicleState;
  addToWorld(world: unknown): void;
  removeFromWorld(world: unknown): void;
  applyControls(c: VehicleControls): void;
  fixedUpdate(dt: number): void;
  resetTo(x: number, y: number, z: number, heading: number): void;
  consumeImpacts(): ImpactEvent[];
  syncToThree(): void; // no-op headless
}

export interface RaceSnapshot {
  phase: 'countdown' | 'racing' | 'finished';
  time: number; // s since GO (negative during countdown)
  countdown: number; // 3..0 during countdown
  cars: CarProgress[];
  playerFinished: boolean;
  lapsTotal: number;
}
