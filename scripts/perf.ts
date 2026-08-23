// Perf probe: times the sim step (4 cars + world) at headless, reports per-1k-steps cost.
import { performance } from 'perf_hooks';
import { runHeadlessRace } from '../tests/helpers/simHarness';

const t0 = performance.now();
const { metrics } = runHeadlessRace({ maxSeconds: 60 });
const wall = performance.now() - t0;
const steps = metrics.steps;
console.log(JSON.stringify({
  simSeconds: +metrics.simSeconds.toFixed(0),
  steps,
  wallMs: Math.round(wall),
  usPerStep: +(wall / steps * 1000).toFixed(1),
  realtimeFactor: +(metrics.simSeconds / (wall / 1000)).toFixed(2),
  // budget: at 120Hz we need < 8333 us/step for 1x realtime; for 60fps frames
  // with ~2 substeps/frame we need < ~4000 us per step pair
}, null, 1));
