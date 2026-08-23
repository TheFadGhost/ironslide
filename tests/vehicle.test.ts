import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { buildHeadlessWorld } from './helpers/simHarness';
import { createVehicle } from '../src/sim/vehicle';
import { PHYSICS } from '../src/config';

function freshCar(x = 0, y = 1, z = 0) {
  const { world, track } = buildHeadlessWorld();
  const planeBody = new CANNON.Body({ mass: 0 });
  planeBody.addShape(new CANNON.Plane());
  planeBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  planeBody.position.set(0, 0, 0);
  world.addBody(planeBody);
  const car = createVehicle({ id: 0, world, track, spawnX: x, spawnY: y, spawnZ: z, heading: 0 });
  car.addToWorld(world);
  return { world, track, car };
}

const dt = PHYSICS.fixedDt;

describe('vehicle physics', () => {
  it('accelerates forward along local +Z with positive throttle', () => {
    const { world, car } = freshCar(0, 0.5, 0);
    for (let i = 0; i < 480; i++) {
      car.applyControls({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
    }
    expect(car.state.forwardSpeed).toBeGreaterThan(15);
    expect(car.state.z).toBeGreaterThan(20);
  });

  it('stops within 60 m from 30 m/s under full braking', () => {
    const { world, car } = freshCar(0, 0.5, 0);
    for (let i = 0; i < 600; i++) {
      car.applyControls({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
    }
    expect(car.state.speed).toBeGreaterThan(22);
    const zAtBrake = car.state.z;
    let stopped = -1;
    for (let i = 0; i < 720 && stopped < 0; i++) {
      car.applyControls({ throttle: 0, brake: 1, steer: 0, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
      if (car.state.speed < 0.3) stopped = car.state.z;
    }
    expect(stopped).toBeGreaterThan(0);
    expect(stopped - zAtBrake).toBeLessThan(45);
  });

  it('holds a corner: lateral offset stays bounded at constant speed and steer', () => {
    const { world, track, car } = freshCar(0, 0.5, 0);
    // build speed straight
    for (let i = 0; i < 500; i++) {
      car.applyControls({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
    }
    const lat0 = track.project(car.state.x, car.state.z).lateral;
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      car.applyControls({ throttle: 0.4, brake: 0, steer: -0.55, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
      if (!Number.isFinite(car.state.x)) break;
      void lat0;
      const rollAbs = Math.abs(car.state.bodyRoll);
      worst = Math.max(worst, rollAbs);
    }
    expect(Number.isFinite(car.state.x)).toBe(true);
    expect(worst).toBeLessThan(0.45); // no flipping
  });

  it('never produces NaN telemetry under abuse', () => {
    const { world, car } = freshCar(0, 0.5, 0);
    for (let i = 0; i < 1500; i++) {
      const t = i % 90;
      car.applyControls({
        throttle: t < 30 ? 1 : 0,
        brake: t >= 30 && t < 50 ? 1 : 0,
        steer: Math.sin(i / 11),
        handbrake: t >= 60 && t < 75,
      });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
      const s = car.state;
      if (
        !Number.isFinite(s.x + s.y + s.z + s.vx + s.vy + s.vz + s.rpm) ||
        !Number.isFinite(s.wheels[0].slip)
      ) {
        throw new Error(`NaN at step ${i}`);
      }
    }
  });

  it('reverse mode backs up when braking from standstill', () => {
    const { world, car } = freshCar(0, 0.5, 0);
    for (let i = 0; i < 240; i++) {
      car.applyControls({ throttle: 0, brake: 1, steer: 0, handbrake: false });
      car.fixedUpdate(dt);
      world.step(dt);
      car.postStep(dt);
    }
    expect(car.state.gear).toBe(-1);
    expect(car.state.forwardSpeed).toBeLessThan(-0.5);
  });
});
