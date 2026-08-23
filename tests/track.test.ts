import { describe, it, expect } from 'vitest';
import { buildTrack } from '../src/sim/track';

describe('track', () => {
  const track = buildTrack();

  it('is a closed loop of sane length with uniform samples', () => {
    expect(track.length).toBeGreaterThan(900);
    expect(track.length).toBeLessThan(1800);
    expect(track.points.length).toBeGreaterThan(200);
    for (let i = 0; i < track.points.length; i++) {
      const a = track.points[i];
      const b = track.points[(i + 1) % track.points.length];
      const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(Math.abs(seg - track.spacing)).toBeLessThan(0.6);
    }
  });

  it('project/sampleAt round-trips within tolerance all around the lap', () => {
    for (let d = 0; d < track.length; d += 37) {
      const p = track.sampleAt(d);
      const q = track.project(p.x, p.z);
      const diff = Math.abs(q.dist - d);
      const wrapped = Math.min(diff, track.length - diff);
      expect(wrapped).toBeLessThan(2.5);
    }
  });

  it('checkpoints never sit inside the shortcut bypass', () => {
    if (!track.shortcut) return;
    const { enterDist, exitDist } = track.shortcut;
    for (const f of track.checkpointFracs) {
      const cp = f * track.length;
      const insideBypass = cp > enterDist + 8 && cp < exitDist - 8;
      expect(insideBypass).toBe(false);
    }
  });

  it('surfaceAt classifies zones and road edges', () => {
    // on centerline: tarmac
    const mid = track.sampleAt(track.length / 3);
    expect(['tarmac', 'kerb']).toContain(track.surfaceAt(mid.x, mid.z, mid.y));
    // oil zone exists
    const oils = track.surfaceZones.filter((z) => z.surface === 'oil');
    expect(oils.length).toBe(1);
    const o = oils[0];
    expect(track.surfaceAt(o.x, o.z, mid.y)).toBe('oil');
    // far off road: dirt
    const p = track.points[50];
    const farX = p.x + p.lx * (p.width / 2 + 12);
    const farZ = p.z + p.lz * (p.width / 2 + 12);
    const surf = track.surfaceAt(farX, farZ, p.y);
    expect(surf === 'dirt' || surf === 'gravel').toBe(true);
  });

  it('grid slots are staggered behind the start line', () => {
    expect(track.gridSlots.length).toBeGreaterThanOrEqual(8);
    const l = track.length;
    for (let i = 0; i < 4; i++) {
      const d = track.project(track.gridSlots[i].x, track.gridSlots[i].z).dist;
      const distBehindLine = Math.min(l - d, d);
      expect(distBehindLine).toBeGreaterThan(3);
    }
  });

  it('roadbed body builds without NaN vertices', () => {
    // buildRoadbedBody exercised via harness worlds everywhere else;
    // here just assert the track data feeds valid numbers
    for (const p of track.points) {
      expect(Number.isFinite(p.x + p.y + p.z + p.tx + p.tz + p.curvature)).toBe(true);
    }
  });
});
