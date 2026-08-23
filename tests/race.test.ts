import { describe, it, expect } from 'vitest';
import { runHeadlessRace } from './helpers/simHarness';
import { RaceManager } from '../src/sim/race';
import { buildTrack } from '../src/sim/track';
import type { CarProgress, TrackData, VehicleLike, VehicleState } from '../src/types';
import { RACE } from '../src/config';

function nullVehicle(id: number, x: number, z: number): VehicleLike {
  const state: VehicleState = {
    id,
    x, y: 0, z,
    qx: 0, qy: 0, qz: 0, qw: 1,
    vx: 10, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    speed: 10,
    forwardSpeed: 10,
    rpm: 3000,
    gear: 3,
    bodyRoll: 0,
    bodyPitch: 0,
    damage: 0,
    upDot: 1,
    wheels: [],
  };
  const controls = { value: { throttle: 0, brake: 0, steer: 0, handbrake: false } };
  return {
    id,
    state,
    addToWorld() {},
    removeFromWorld() {},
    applyControls(c) {
      controls.value = c;
    },
    fixedUpdate() {},
    resetTo(nx, _ny, nz) {
      state.x = nx;
      state.z = nz;
    },
    consumeImpacts() {
      return [];
    },
    syncToThree() {},
  };
}

describe('race logic', () => {
  it('awards a lap only after crossing interior checkpoints in order', () => {
    const track: TrackData = buildTrack();
    const L = track.length;
    const v = nullVehicle(0, 0, 0);
    const race = new RaceManager(track, [v], [null], 0, RACE.lapsTotal);
    race.phase = 'racing';

    // teleport-style forward jumps are impossible via postStep deltas, so
    // simulate by feeding small forward steps around the whole loop
    const startP = track.sampleAt(L - 20);
    v.resetTo(startP.x, startP.y, startP.z, 0);
    (race as unknown as { trackers: Array<{ prevRawDist: number }> }).trackers[0].prevRawDist =
      L - 20;

    let laps = 0;
    race.events.on('lapCompleted', () => laps++);
    for (let s = 0; s < L / 4 + 40; s++) {
      const cur = track.project(v.state.x, v.state.z);
      const nextD = cur.dist + 4;
      const np = track.sampleAt(nextD);
      v.resetTo(np.x, np.y, np.z, 0);
      race.postStep(1 / 60);
    }
    expect(laps).toBeGreaterThanOrEqual(1);
  });

  it('rejects a backwards line crossing as a lap', () => {
    const track: TrackData = buildTrack();
    const L = track.length;
    const v = nullVehicle(0, 0, 0);
    const race = new RaceManager(track, [v], [null], 0, RACE.lapsTotal);
    race.phase = 'racing';
    let laps = 0;
    race.events.on('lapCompleted', () => laps++);

    // sit just past the line going backwards through it
    const before = track.sampleAt(3);
    v.resetTo(before.x, before.y, before.z, 0);
    (race as unknown as { trackers: Array<{ prevRawDist: number }> }).trackers[0].prevRawDist = 3;

    const after = track.sampleAt(L - 3); // crossed line backwards
    v.resetTo(after.x, after.y, after.z, 0);
    race.postStep(1 / 60);
    expect(laps).toBe(0);
  });

  it('rubber-bands AI speed toward the player within bounds', () => {
    const track: TrackData = buildTrack();
    const mk = (id: number, progress: number) =>
      nullVehicle(id, track.sampleAt(progress % track.length).x, track.sampleAt(progress % track.length).z);
    void mk;
    const player = mk(0, 400);
    const aiFarBehind = mk(1, 100);
    const aiAhead = mk(2, 800);
    const race = new RaceManager(track, [player, aiFarBehind, aiAhead], [null, null, null], 0);
    race.phase = 'racing';
    const speeds = (
      race as unknown as { computeRubberBands(progress: CarProgress[]): number[] }
    ).computeRubberBands(race.progressList());
    // behind-player AI boosted, ahead-player AI slowed, both within +-band
    expect(speeds[1]).toBeGreaterThan(1);
    expect(speeds[2]).toBeLessThan(1);
    expect(Math.abs(speeds[1] - 1)).toBeLessThanOrEqual(0.08);
    expect(Math.abs(speeds[2] - 1)).toBeLessThanOrEqual(0.08);
    const snap = race.snapshot();
    expect(snap.cars.length).toBe(3);
    // leader is the furthest car
    expect(snap.cars[0].id).toBe(2);
  });

  it('full headless race completes with sane lap times', () => {
    const { metrics } = runHeadlessRace({ maxSeconds: 480 });
    expect(metrics.finished).toBe(true);
    expect(metrics.nanDetected).toBe(false);
    const realLaps = metrics.bestLaps.filter((x) => Number.isFinite(x));
    expect(realLaps.length).toBeGreaterThan(0);
    for (const lap of realLaps) {
      expect(lap).toBeGreaterThan(45);
      expect(lap).toBeLessThan(240);
    }
  }, 600000);
});
