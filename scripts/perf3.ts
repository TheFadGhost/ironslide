import { performance } from 'perf_hooks';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../src/sim/world';
import { buildTrack, buildRoadbedBodies } from '../src/sim/track';
import { createVehicle } from '../src/sim/vehicle';
import { PHYSICS } from '../src/config';

const track = buildTrack();
const dt = PHYSICS.fixedDt;

function bench(name: string, build: () => CANNON.World): void {
  const world = build();
  // warmup
  for (let i = 0; i < 300; i++) world.step(dt);
  const N = 1200;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) world.step(dt);
  const us = (performance.now() - t0) / N * 1000;
  console.log(`${name}: ${us.toFixed(0)} us/step`);
}

// 1. empty world
bench('empty', () => createPhysicsWorld());

// 2. roadbed only
bench('roadbed-only', () => {
  const w = createPhysicsWorld();
  for (const rb of buildRoadbedBodies(track)) w.addBody(rb);
  return w;
});

// 3. roadbed + net
bench('roadbed+net', () => {
  const w = createPhysicsWorld();
  for (const rb of buildRoadbedBodies(track)) w.addBody(rb);
  const net = new CANNON.Body({ mass: 0 });
  net.addShape(new CANNON.Plane());
  net.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  net.position.set(0, -30, 0);
  w.addBody(net);
  return w;
});

// 4. full (boxes + net)
bench('full-static', () => {
  const w = createPhysicsWorld();
  for (const rb of buildRoadbedBodies(track)) w.addBody(rb);
  const net = new CANNON.Body({ mass: 0 });
  net.addShape(new CANNON.Plane());
  net.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  net.position.set(0, -30, 0);
  w.addBody(net);
  for (const spec of track.colliderSpecs) {
    const b = new CANNON.Body({ mass: 0 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(spec.hx, spec.hy, spec.hz)));
    b.position.set(spec.x, spec.y, spec.z);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spec.yaw);
    w.addBody(b);
  }
  return w;
});

// 5. full-static + 1 car
bench('full+1car', () => {
  const w = createPhysicsWorld();
  for (const rb of buildRoadbedBodies(track)) w.addBody(rb);
  const net = new CANNON.Body({ mass: 0 });
  net.addShape(new CANNON.Plane());
  net.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  net.position.set(0, -30, 0);
  w.addBody(net);
  for (const spec of track.colliderSpecs) {
    const b = new CANNON.Body({ mass: 0 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(spec.hx, spec.hy, spec.hz)));
    b.position.set(spec.x, spec.y, spec.z);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spec.yaw);
    w.addBody(b);
  }
  const slot = track.gridSlots[0];
  const car = createVehicle({ id: 0, world: w, track, spawnX: slot.x, spawnY: slot.y, spawnZ: slot.z, heading: slot.heading });
  car.addToWorld(w);
  car.applyControls({ throttle: 1, brake: 0, steer: 0, handbrake: false });
  return w;
});

console.log('colliderSpecs:', track.colliderSpecs.length);
