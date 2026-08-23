import { describe, it, expect } from 'vitest';
import { runScriptedInputs } from './helpers/simHarness';

function makeScript(len: number): Array<{ throttle: number; brake: number; steer: number; handbrake: boolean }> {
  // deterministic varied inputs
  const script = [];
  for (let i = 0; i < len; i++) {
    const phase = Math.floor(i / 200) % 4;
    script.push({
      throttle: phase === 0 || phase === 1 ? 1 : 0,
      brake: phase === 2 ? 0.6 : 0,
      steer: phase === 1 ? Math.sin(i / 30) : phase === 3 ? -Math.cos(i / 25) : 0,
      handbrake: i > 900 && i < 940,
    });
  }
  return script;
}

describe('physics determinism', () => {
  it('produces identical checksums for identical scripted inputs', () => {
    const script = makeScript(1200);
    const a = runScriptedInputs(script);
    const b = runScriptedInputs(script);
    expect(a.checksum).toBe(b.checksum);
    expect(a.finalState.x).toBeCloseTo(b.finalState.x, 6);
    expect(a.finalState.y).toBeCloseTo(b.finalState.y, 6);
    expect(a.finalState.z).toBeCloseTo(b.finalState.z, 6);
  });

  it('different inputs diverge (checksum sensitivity)', () => {
    const script = makeScript(600);
    const a = runScriptedInputs(script);
    const modified = script.map((c, i) => (i === 300 ? { ...c, throttle: c.throttle > 0.5 ? 0 : 1 } : c));
    const b = runScriptedInputs(modified);
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('stays finite over a long chaotic run', () => {
    const res = runScriptedInputs(makeScript(3600));
    expect(Number.isFinite(res.finalState.x)).toBe(true);
    expect(Number.isFinite(res.finalState.y)).toBe(true);
    expect(Number.isFinite(res.finalState.z)).toBe(true);
  });
});
