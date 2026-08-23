import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../../src/sim/world';
import { buildTrack, buildRoadbedBodies } from '../../src/sim/track';
import { createVehicle, type Vehicle } from '../../src/sim/vehicle';
import { createAIDriver } from '../../src/sim/ai';
import { RaceManager } from '../../src/sim/race';
import { PHYSICS, RACE } from '../../src/config';
import type { TrackData } from '../../src/types';

export interface RaceMetrics {
  simSeconds: number;
  steps: number;
  finished: boolean;
  allFinished: boolean;
  lapsByCar: number[];
  bestLaps: number[];
  finishTimes: number[];
  nanDetected: boolean;
  fallThroughEvents: number;
  impactCount: number;
  maxImpactImpulse: number;
  gapHistory: number[][];
  wrongWayEvents: number;
  autoResets: number;
  maxHeightAboveTrack: number;
}

export interface HeadlessOpts {
  cars?: number;
  maxSeconds?: number;
  collectGapsEvery?: number;
}

export function buildHeadlessWorld(): { world: CANNON.World; track: TrackData } {
  const world = createPhysicsWorld();
  const track = buildTrack();
  for (const rb of buildRoadbedBodies(track)) {
    world.addBody(rb);
  }
  const net = new CANNON.Body({ mass: 0 });
  net.addShape(new CANNON.Plane());
  net.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  net.position.set(0, -30, 0);
  world.addBody(net);
  for (const spec of track.colliderSpecs) {
    const b = new CANNON.Body({ mass: 0 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(spec.hx, spec.hy, spec.hz)));
    b.position.set(spec.x, spec.y, spec.z);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spec.yaw);
    world.addBody(b);
  }
  return { world, track };
}

export function spawnField(
  world: CANNON.World,
  track: TrackData,
  cars = 4
): Vehicle[] {
  const out: Vehicle[] = [];
  for (let i = 0; i < cars; i++) {
    const slot = track.gridSlots[i];
    const v = createVehicle({
      id: i,
      world,
      track,
      spawnX: slot.x,
      spawnY: slot.y,
      spawnZ: slot.z,
      heading: slot.heading,
    });
    v.addToWorld(world);
    out.push(v);
  }
  return out;
}

/** Full all-AI race. Deterministic. */
export function runHeadlessRace(opts: HeadlessOpts = {}): {
  metrics: RaceMetrics;
  vehicles: Vehicle[];
  track: TrackData;
  race: RaceManager;
} {
  const carCount = opts.cars ?? 4;
  const maxSeconds = opts.maxSeconds ?? 600;
  const { world, track } = buildHeadlessWorld();
  const vehicles = spawnField(world, track, carCount);
  const drivers = vehicles.map((v) => createAIDriver(v.id, [0.85, 0.68, 0.52, 0.75][v.id % 4]));

  const race = new RaceManager(track, vehicles, drivers, 0, RACE.lapsTotal);
  let wrongWayEvents = 0;
  let autoResets = 0;
  race.events.on('wrongWay', ({ on }) => {
    if (on) wrongWayEvents++;
  });
  race.events.on('autoReset', () => autoResets++);

  const metrics: RaceMetrics = {
    simSeconds: 0,
    steps: 0,
    finished: false,
    allFinished: false,
    lapsByCar: new Array(carCount).fill(0),
    bestLaps: new Array(carCount).fill(Infinity),
    finishTimes: new Array(carCount).fill(Infinity),
    nanDetected: false,
    fallThroughEvents: 0,
    impactCount: 0,
    maxImpactImpulse: 0,
    gapHistory: [],
    wrongWayEvents: 0,
    autoResets: 0,
    maxHeightAboveTrack: 0,
  };

  const dt = PHYSICS.fixedDt;
  const totalSteps = Math.floor(maxSeconds / dt);
  const gapEverySteps = Math.max(1, Math.round((opts.collectGapsEvery ?? 2) / dt));
  let leaderIdAtLastLapCheck = 0;

  for (let s = 0; s < totalSteps; s++) {
    race.fixedUpdate(dt, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    for (const v of vehicles) v.fixedUpdate(dt);
    world.step(dt);
    for (const v of vehicles) {
      v.postStep(dt);
      const st = v.state;
      if (!Number.isFinite(st.x) || !Number.isFinite(st.y) || !Number.isFinite(st.z)) {
        metrics.nanDetected = true;
      }
      // fall-through: more than 6m under local roadbed (ignore shortcut corridor,
      // where main-loop elevation comparison is meaningless)
      const proj = track.project(st.x, st.z);
      const sample = track.sampleAt(proj.dist);
      const nearShortcut =
        track.shortcutPath.length > 1 &&
        (() => {
          let best = Infinity;
          const sp = track.shortcutPath;
          for (let i = 0; i < sp.length - 1; i++) {
            const a = sp[i];
            const b = sp[i + 1];
            const abx = b.x - a.x;
            const abz = b.z - a.z;
            const l2 = abx * abx + abz * abz || 1e-9;
            let tt = ((st.x - a.x) * abx + (st.z - a.z) * abz) / l2;
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const dd = Math.hypot(st.x - (a.x + abx * tt), st.z - (a.z + abz * tt));
            if (dd < best) best = dd;
          }
          return best < 14;
        })();
      if (!nearShortcut && st.y < sample.y - 6) metrics.fallThroughEvents++;
      const above = st.y - sample.y;
      if (above > metrics.maxHeightAboveTrack && above < 200) metrics.maxHeightAboveTrack = above;
      const impacts = v.consumeImpacts();
      for (const im of impacts) {
        metrics.impactCount++;
        metrics.maxImpactImpulse = Math.max(metrics.maxImpactImpulse, im.impulse);
      }
    }
    race.postStep(dt);
    metrics.steps++;

    if (s % gapEverySteps === 0) {
      const list = race.progressList();
      metrics.gapHistory.push(list.map((c) => c.totalProgress));
    }

    if (s % 120 === 0) {
      const trackers = vehicles.map((v) => race.trackerFor(v.id));
      trackers.forEach((t, i) => {
        if (!t) return;
        metrics.lapsByCar[i] = t.lap;
        if (Number.isFinite(t.bestLap)) metrics.bestLaps[i] = t.bestLap;
      });
    }

    if (race.phase === 'finished') break;
    void leaderIdAtLastLapCheck;
  }

  metrics.simSeconds = metrics.steps * dt;
  metrics.finished = race.phase === 'finished';
  metrics.allFinished = vehicles.every((v) => race.trackerFor(v.id)?.bestLap !== undefined);
  metrics.wrongWayEvents = wrongWayEvents;
  metrics.autoResets = autoResets;
  for (let i = 0; i < vehicles.length; i++) {
    const t = race.trackerFor(vehicles[i].id);
    metrics.finishTimes[i] = t ? (race.snapshot().cars.find((c) => c.id === vehicles[i].id)?.finishTime ?? Infinity) : Infinity;
  }
  return { metrics, vehicles, track, race };
}

/** Scripted-input determinism run. Returns a checksum of sampled positions. */
export function runScriptedInputs(
  script: Array<{ throttle: number; brake: number; steer: number; handbrake: boolean }>,
  seedCar = 0
): { checksum: number; finalState: { x: number; y: number; z: number } } {
  const { world, track } = buildHeadlessWorld();
  const slot = track.startPoint;
  const car = createVehicle({
    id: seedCar,
    world,
    track,
    spawnX: slot.x,
    spawnY: slot.y,
    spawnZ: slot.z,
    heading: slot.heading,
  });
  car.addToWorld(world);

  const dt = PHYSICS.fixedDt;
  let h = 2166136261;
  for (let i = 0; i < script.length; i++) {
    car.applyControls(script[i]);
    car.fixedUpdate(dt);
    world.step(dt);
    car.postStep(dt);
    const st = car.state;
    // FNV-1a over quantized state
    const vals = [st.x, st.y, st.z, st.qx, st.qy, st.qz, st.qw, st.vx, st.vy, st.vz];
    for (const val of vals) {
      const q = Math.round(val * 1000) | 0;
      h ^= q & 0xff;
      h = Math.imul(h, 16777619);
      h ^= (q >>> 8) & 0xff;
      h = Math.imul(h, 16777619);
      h ^= (q >>> 16) & 0xff;
      h = Math.imul(h, 16777619);
    }
  }
  return {
    checksum: h >>> 0,
    finalState: { x: car.state.x, y: car.state.y, z: car.state.z },
  };
}
