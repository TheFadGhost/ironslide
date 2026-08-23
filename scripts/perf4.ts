import { performance } from 'node:perf_hooks';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../src/sim/world';
import { buildTrack, buildRoadbedBodies } from '../src/sim/track';

const track = buildTrack();
const world = createPhysicsWorld();
const bodies = buildRoadbedBodies(track);
for (const b of bodies) {
  b.material = new CANNON.Material('w');
  world.addBody(b);
}
console.log('roadbed bodies:', bodies.length);

// raycast benchmark: 1000 vertical rays over random road positions
const pts = track.points;
let hits = 0;
const t0 = performance.now();
const N = 2000;
for (let i = 0; i < N; i++) {
  const p = pts[(i * 7) % pts.length];
  const from = new CANNON.Vec3(p.x, p.y + 2, p.z);
  const to = new CANNON.Vec3(p.x, p.y - 3, p.z);
  const res = new CANNON.RaycastResult();
  new CANNON.Ray(from, to).intersectWorld(world, { mode: CANNON.Ray.CLOSEST, from, to, result: res });
  if (res.hasHit) hits++;
}
const usPerRay = (performance.now() - t0) / N * 1000;
console.log(`raycast: ${usPerRay.toFixed(0)} us/ray, hits ${hits}/${N}`);
