import { describe, it, expect } from 'vitest';
import { buildHeadlessWorld } from './helpers/simHarness';
import { createVehicle } from '../src/sim/vehicle';
import { PHYSICS } from '../src/config';

const dt = PHYSICS.fixedDt;

/** Drive a car into a barrier wall head-on at speed; verify containment. */
describe('collision safety', () => {
  it('does not tunnel through a barrier at high speed', () => {
    const { world, track } = buildHeadlessWorld();
    // start on the road on a straight, drive angled into the left wall
    const probe = track.sampleAt(80);
    const startX = probe.x - probe.tx * 30;
    const startZ = probe.z - probe.tz * 30;

    const car = createVehicle({
      id: 0,
      world,
      track,
      spawnX: startX,
      spawnY: probe.y,
      spawnZ: startZ,
      heading: Math.atan2(probe.tx, probe.tz),
    });
    car.addToWorld(world);

    let worstLat = 0;
    for (let i = 0; i < 420; i++) {
      car.applyControls({ throttle: 1, brake: 0, steer: -0.6, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
      const p = track.project(car.state.x, car.state.z);
      if (Number.isFinite(p.lateral)) worstLat = Math.max(worstLat, Math.abs(p.lateral));
    }
    // containment: never beyond the wall line by more than the car's length
    expect(worstLat).toBeLessThan(track.sampleAt(80).width / 2 + 3.5);
  }, 30000);

  it('caps impact impulses so cars never launch skyward', () => {
    const { world, track } = buildHeadlessWorld();
    const probe = track.sampleAt(60);
    const car = createVehicle({
      id: 0,
      world,
      track,
      spawnX: probe.x,
      spawnY: probe.y,
      spawnZ: probe.z,
      heading: Math.atan2(probe.tx, probe.tz),
    });
    car.addToWorld(world);
    let maxVyUp = 0;
    for (let i = 0; i < 900; i++) {
      car.applyControls({ throttle: 1, brake: 0, steer: Math.sin(i / 20) * 0.8, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
      maxVyUp = Math.max(maxVyUp, car.state.vy);
      if (!Number.isFinite(maxVyUp)) break;
    }
    expect(Number.isFinite(maxVyUp)).toBe(true);
    // no absurd launch: upward velocity stays below what gravity alone allows
    expect(maxVyUp).toBeLessThan(18);
  }, 30000);

  it('zero-speed friction math does not divide by zero or produce NaN', () => {
    const { world, track } = buildHeadlessWorld();
    const slot = track.gridSlots[0];
    const car = createVehicle({
      id: 0,
      world,
      track,
      spawnX: slot.x,
      spawnY: slot.y,
      spawnZ: slot.z,
      heading: slot.heading,
    });
    car.addToWorld(world);
    for (let i = 0; i < 240; i++) {
      // alternating full brake / full throttle at standstill-ish speeds
      car.applyControls({
        throttle: i % 2 === 0 ? 1 : 0,
        brake: i % 2 === 1 ? 1 : 0,
        steer: ((i % 10) - 5) / 5,
        handbrake: i % 7 === 0,
      });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
      for (const w of car.state.wheels) {
        expect(Number.isFinite(w.slip)).toBe(true);
        expect(Number.isFinite(w.groundSpeed)).toBe(true);
      }
    }
  });
});
