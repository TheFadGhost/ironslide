import { performance } from 'perf_hooks';
import { buildHeadlessWorld, spawnField } from '../tests/helpers/simHarness';
import { createAIDriver } from '../src/sim/ai';
import { RaceManager } from '../src/sim/race';
import { PHYSICS, RACE } from '../src/config';

const { world, track } = buildHeadlessWorld();
const cars = spawnField(world, track, 4);
const drivers = cars.map((v) => createAIDriver(v.id, [0.85, 0.68, 0.52, 0.75][v.id % 4]));
const race = new RaceManager(track, cars, drivers, 0, RACE.lapsTotal);

// warmup
for (let i = 0; i < 600; i++) {
  race.fixedUpdate(PHYSICS.fixedDt, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  for (const c of cars) c.fixedUpdate(PHYSICS.fixedDt);
  world.step(PHYSICS.fixedDt);
  for (const c of cars) c.postStep(PHYSICS.fixedDt);
  race.postStep(PHYSICS.fixedDt);
}

const N = 2400;
let tAI = 0, tVeh = 0, tStep = 0, tPost = 0, tRacePost = 0;
for (let i = 0; i < N; i++) {
  let a = performance.now();
  race.fixedUpdate(PHYSICS.fixedDt, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  let b = performance.now();
  tAI += b - a;
  a = performance.now();
  for (const c of cars) c.fixedUpdate(PHYSICS.fixedDt);
  b = performance.now();
  tVeh += b - a;
  a = performance.now();
  world.step(PHYSICS.fixedDt);
  b = performance.now();
  tStep += b - a;
  a = performance.now();
  for (const c of cars) c.postStep(PHYSICS.fixedDt);
  b = performance.now();
  tPost += b - a;
  a = performance.now();
  race.postStep(PHYSICS.fixedDt);
  b = performance.now();
  tRacePost += b - a;
}
console.log(JSON.stringify({
  steps: N,
  usPerStep: {
    aiUpdate: +(tAI / N * 1000).toFixed(0),
    vehicleForces: +(tVeh / N * 1000).toFixed(0),
    worldStep: +(tStep / N * 1000).toFixed(0),
    vehicleTelemetry: +(tPost / N * 1000).toFixed(0),
    raceProgress: +(tRacePost / N * 1000).toFixed(0),
    total: +((tAI + tVeh + tStep + tPost + tRacePost) / N * 1000).toFixed(0),
  },
}, null, 1));
