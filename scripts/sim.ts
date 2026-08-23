// Headless full-race telemetry: prints one JSON line of race metrics.
import { runHeadlessRace } from '../tests/helpers/simHarness';

const maxSeconds = Number(process.argv[2] ?? 480);
const { metrics } = runHeadlessRace({ maxSeconds });
console.log(
  JSON.stringify({
    simSeconds: +metrics.simSeconds.toFixed(0),
    finished: metrics.finished,
    laps: metrics.lapsByCar,
    bestLaps: metrics.bestLaps.map((x) => (x === Infinity ? null : +x.toFixed(1))),
    nan: metrics.nanDetected,
    fallThroughEvents: metrics.fallThroughEvents,
    impacts: metrics.impactCount,
    resets: metrics.autoResets,
  })
);
