// Foundry Ridge - hand-authored GP circuit. Centripetal Catmull-Rom centerline (plain math),
// uniform ~4 m resample, signed curvature, surface zones, dirt shortcut, barrier colliders.
import * as CANNON from 'cannon-es';
import { RACE } from '../config';
import { Rng } from '../core/rng';
import type { ColliderSpec, GridSlot, Projection, SurfaceId, SurfaceZone, TrackData, TrackPoint } from '../types';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Control points [x, z, elevation], closed loop. dist 0 at start line, heading +Z.
// Layout: straight -> 180 deg left sweeper -> uphill esses -> crest -> downhill
// hairpin (left, R=14) -> chicane -> fast kink -> westbound run -> turnaround -> line.
const CONTROL_POINTS: ReadonlyArray<[number, number, number]> = [
  [0, -100, 0], [0, -36, 0], [0, 36, 0], [0, 100, 0],
  [21, 166, 0.6], [77, 207, 1.7], [147, 207, 2.8], [203, 166, 3.7], [224, 100, 4.1],
  [240, 52, 5.0], [234, -2, 6.2], [246, -46, 7.8], [238, -82, 10.2], [230, -108, 13.4],
  [222, -136, 11.6], [216, -152, 9.0], [210, -162, 7.6],
  [206, -172, 6.8], [196, -176, 6.5], [186, -172, 6.3], [182, -162, 6.0],
  [187, -120, 5.5], [196, -86, 4.9], [183, -52, 4.2], [171, -20, 3.5],
  [140, -32, 2.9], [100, -44, 2.2], [62, -48, 1.6],
  [32, -68, 1.0], [26, -104, 0.5], [32, -138, 0.15],
  [25, -155, 0.08], [8, -162, 0], [-9, -155, 0], [-10, -122, 0],
];

function dist3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function crEval(cps: Vec3[], i: number, u: number): Vec3 {
  const n = cps.length;
  const p0 = cps[(i + n - 1) % n];
  const p1 = cps[i];
  const p2 = cps[(i + 1) % n];
  const p3 = cps[(i + 2) % n];
  const t0 = 0;
  const t1 = t0 + Math.max(Math.sqrt(dist3(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)), 1e-4);
  const t2 = t1 + Math.max(Math.sqrt(dist3(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)), 1e-4);
  const t3 = t2 + Math.max(Math.sqrt(dist3(p2.x, p2.y, p2.z, p3.x, p3.y, p3.z)), 1e-4);
  const s = t1 + (t2 - t1) * u;
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  const a1 = lerp(p0, p1, (s - t0) / Math.max(t1 - t0, 1e-9));
  const a2 = lerp(p1, p2, (s - t1) / Math.max(t2 - t1, 1e-9));
  const a3 = lerp(p2, p3, (s - t2) / Math.max(t3 - t2, 1e-9));
  const b1 = lerp(a1, a2, (s - t0) / Math.max(t2 - t0, 1e-9));
  const b2 = lerp(a2, a3, (s - t1) / Math.max(t3 - t1, 1e-9));
  return lerp(b1, b2, (s - t1) / Math.max(t2 - t1, 1e-9));
}

export function buildTrack(seed?: number): TrackData {
  const rng = new Rng(seed ?? 20260822);
  const cps: Vec3[] = CONTROL_POINTS.map(([x, zp, el]) => ({ x, y: el, z: zp }));

  // Dense sampling of the closed spline.
  const dense: Vec3[] = [];
  const M = cps.length;
  for (let i = 0; i < M; i++) {
    const q1 = cps[i];
    const q2 = cps[(i + 1) % M];
    const steps = Math.min(160, Math.max(12, Math.ceil(dist3(q1.x, q1.y, q1.z, q2.x, q2.y, q2.z) / 1.2)));
    for (let s = 0; s < steps; s++) dense.push(crEval(cps, i, s / steps));
  }
  const ext = dense.concat([dense[0]]);
  const cum: number[] = [0];
  for (let i = 1; i < ext.length; i++) {
    cum.push(cum[i - 1] + dist3(ext[i - 1].x, ext[i - 1].y, ext[i - 1].z, ext[i].x, ext[i].y, ext[i].z));
  }
  const length = cum[cum.length - 1];

  // Uniform arc-length resample (~4 m).
  const N = Math.max(64, Math.round(length / 4));
  const spacing = length / N;
  const points: TrackPoint[] = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const target = k * spacing;
    while (j < ext.length - 2 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 1e-9 ? (target - cum[j]) / segLen : 0;
    const a = ext[j];
    const b = ext[j + 1];
    points.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      tx: 0, ty: 0, tz: 0, lx: 0, lz: 0,
      width: 13,
      dist: target,
      curvature: 0,
    });
  }

  // Unit 3D tangents and horizontal left vectors (up x tangent).
  for (let i = 0; i < N; i++) {
    const p = points[i];
    const pn = points[(i + 1) % N];
    const pp = points[(i + N - 1) % N];
    const dl = dist3(pp.x, pp.y, pp.z, pn.x, pn.y, pn.z) || 1;
    p.tx = (pn.x - pp.x) / dl;
    p.ty = (pn.y - pp.y) / dl;
    p.tz = (pn.z - pp.z) / dl;
    const hl = Math.hypot(p.tx, p.tz) || 1;
    p.lx = p.tz / hl;
    p.lz = -p.tx / hl;
  }
  // Signed curvature dHeading/ds, positive turning left.
  for (let i = 0; i < N; i++) {
    const hn = points[(i + 1) % N];
    const hp = points[(i + N - 1) % N];
    points[i].curvature =
      wrapAngle(Math.atan2(hn.tx, hn.tz) - Math.atan2(hp.tx, hp.tz)) / (2 * spacing);
  }
  // Width 11..15 m: wide on straights, narrow near hairpin; smoothed circularly.
  let widths = points.map((p) => {
    const t = Math.max(0, Math.min(1, (0.02 - Math.abs(p.curvature)) / 0.0175));
    return 11 + 4 * (t * t * (3 - 2 * t));
  });
  for (let pass = 0; pass < 2; pass++) {
    widths = widths.map((v, i) => (widths[(i + N - 1) % N] + 2 * v + widths[(i + 1) % N]) / 4);
  }
  for (let i = 0; i < N; i++) points[i].width = Math.max(11, Math.min(15, widths[i]));

  const sampleAt = (dRaw: number): TrackPoint => {
    const d = ((dRaw % length) + length) % length;
    const f = d / spacing;
    const i = Math.min(N - 1, Math.floor(f));
    const jj = (i + 1) % N;
    const t = f - Math.floor(f);
    const a = points[i];
    const b = points[jj];
    const tx = a.tx + (b.tx - a.tx) * t;
    const ty = a.ty + (b.ty - a.ty) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const tl = Math.hypot(tx, ty, tz) || 1;
    let lx = a.lx + (b.lx - a.lx) * t;
    let lz = a.lz + (b.lz - a.lz) * t;
    const ll = Math.hypot(lx, lz) || 1;
    lx /= ll;
    lz /= ll;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      tx: tx / tl,
      ty: ty / tl,
      tz: tz / tl,
      lx,
      lz,
      width: a.width + (b.width - a.width) * t,
      dist: d,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
    };
  };

  const project = (x: number, z: number): Projection => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = points[i].x - x;
      const dz = points[i].z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        bi = i;
      }
    }
    let bestSeg = bi;
    let bestT = 0;
    let bestD2 = bd;
    for (const sa of [(bi + N - 1) % N, bi]) {
      const b = (sa + 1) % N;
      const ax = points[sa].x;
      const az = points[sa].z;
      const ex = points[b].x - ax;
      const ez = points[b].z - az;
      const el = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / el));
      const qx = ax + ex * t;
      const qz = az + ez * t;
      const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestSeg = sa;
        bestT = t;
      }
    }
    const a = bestSeg;
    const b = (a + 1) % N;
    const pa = points[a];
    const pb = points[b];
    let lx = pa.lx + (pb.lx - pa.lx) * bestT;
    let lz = pa.lz + (pb.lz - pa.lz) * bestT;
    const ll = Math.hypot(lx, lz) || 1;
    lx /= ll;
    lz /= ll;
    const px = pa.x + (pb.x - pa.x) * bestT;
    const pz = pa.z + (pb.z - pa.z) * bestT;
    return {
      dist: (((a + bestT) * spacing) % length + length) % length,
      lateral: (x - px) * lx + (z - pz) * lz,
      index: bestT < 0.5 ? a : b,
    };
  };

  
  // Shortcut: mouths snapped to nearest main-loop samples. The hairpin apex
  // region (max |curvature|) defines the bypassed range; anchors sit just
  // before entry and just after exit.
  let apexIdx = 0;
  let apexK = 0;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(points[i].curvature);
    if (k > apexK) {
      apexK = k;
      apexIdx = i;
    }
  }
  const enterIdx = (apexIdx - 10 + N) % N;
  const exitIdx = (apexIdx + 12) % N;
  const enterDist = enterIdx * spacing;
  const exitDist = exitIdx * spacing;
  const shortcut = { enterDist, exitDist };

  // Generate the shortcut as a smooth quadratic arc between on-road anchors so
  // it is actually drivable: enter along the travel direction, sweep inside,
  // rejoin aligned with the road.
  const anchorA = points[(enterIdx - 2 + N) % N];
  const anchorB = points[(exitIdx + 2) % N];
  const sideInA = Math.sign(anchorA.curvature) || 1;
  const sideInB = Math.sign(anchorB.curvature) || 1;
  void sideInB;
  const p0x = anchorA.x + anchorA.lx * sideInA * (anchorA.width / 2 - 1.2);
  const p0z = anchorA.z + anchorA.lz * sideInA * (anchorA.width / 2 - 1.2);
  const p0y = anchorA.y;
  const p2x = anchorB.x + anchorB.lx * sideInA * (anchorB.width / 2 - 1.2);
  const p2z = anchorB.z + anchorB.lz * sideInA * (anchorB.width / 2 - 1.2);
  const p2y = anchorB.y;
  // control point: deep inside the hairpin, below both anchors
  const midAx = (points[(enterIdx + 6) % N].x + points[(exitIdx + N - 6) % N].x) / 2;
  const midAz = (points[(enterIdx + 6) % N].z + points[(exitIdx + N - 6) % N].z) / 2;
  const cpx = midAx * 0.55 + ((p0x + p2x) / 2) * 0.45;
  const cpz = midAz * 0.55 + ((p0z + p2z) / 2) * 0.45;
  const cpy = Math.min(p0y, p2y) - 2.2;
  const SC_SAMPLES = 26;
  const scPath: { x: number; y: number; z: number; width: number }[] = [];
  for (let i = 0; i <= SC_SAMPLES; i++) {
    const t = i / SC_SAMPLES;
    const u = 1 - t;
    const x = u * u * p0x + 2 * u * t * cpx + t * t * p2x;
    const z = u * u * p0z + 2 * u * t * cpz + t * t * p2z;
    const yRaw = u * u * p0y + 2 * u * t * cpy + t * t * p2y;
    scPath.push({ x, y: yRaw, z, width: 8 });
  }

  // Surface zones.
  const surfaceZones: SurfaceZone[] = [];
  const gravelOff = (w: number): number => w / 2 + 3.5;
  const gA = points[(exitIdx + 2) % N]; // just past hairpin exit
  surfaceZones.push({
    x: gA.x - gA.lx * gravelOff(gA.width),
    z: gA.z - gA.lz * gravelOff(gA.width),
    r: 6.5,
    surface: 'gravel',
  });
  const gB = sampleAt(exitDist + 55); // outside the chicane
  surfaceZones.push({
    x: gB.x - gB.lx * gravelOff(gB.width),
    z: gB.z - gB.lz * gravelOff(gB.width),
    r: 6.5,
    surface: 'gravel',
  });
  const oilRef = sampleAt(length * 0.27); // mid-sweeper racing line
  surfaceZones.push({
    x: oilRef.x + oilRef.lx * 2 + rng.range(-1, 1),
    z: oilRef.z + oilRef.lz * 2 + rng.range(-1, 1),
    r: 2.5,
    surface: 'oil',
  });

  const surfaceAt = (x: number, z: number, _y: number): SurfaceId => {
    for (const zn of surfaceZones) {
      const dx = x - zn.x;
      const dz = z - zn.z;
      if (dx * dx + dz * dz <= zn.r * zn.r) return zn.surface;
    }
    const pr = project(x, z);
    const sm = sampleAt(pr.dist);
    const al = Math.abs(pr.lateral);
    if (al <= sm.width / 2 - 0.7) return 'tarmac';
    if (al <= sm.width / 2 + 0.9 && Math.abs(sm.curvature) > 0.008) return 'kerb';
    return 'dirt';
  };

  // Barrier walls are continuous vertical ribbons merged into the roadbed
  // body (see buildRoadbedBody) - no boxes, no joints, no corner clipping.
  const colliderSpecs: ColliderSpec[] = [];
  // Start point and grid.
  const p0 = points[0];
  const startPoint: GridSlot = {
    x: p0.x,
    y: p0.y,
    z: p0.z,
    heading: Math.atan2(p0.tx, p0.tz),
  };
  const gridSlots: GridSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const gs = sampleAt(length - (8 + i * 7));
    const lat = i % 2 === 0 ? 2.6 : -2.6;
    gridSlots.push({
      x: gs.x + gs.lx * lat,
      y: gs.y,
      z: gs.z + gs.lz * lat,
      heading: Math.atan2(gs.tx, gs.tz),
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  return {
    name: 'Foundry Ridge',
    points,
    spacing,
    length,
    gridSlots,
    startPoint,
    project,
    sampleAt,
    surfaceAt,
    checkpointFracs: [...RACE.checkpointFracs],
    shortcut,
    boundsMin: { x: minX - 60, z: minZ - 60 },
    boundsMax: { x: maxX + 60, z: maxZ + 60 },
    colliderSpecs,
    surfaceZones,
    shortcutPath: scPath,
  };
}



function distToPath(x: number, z: number, path: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1e-9;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

interface Section { lx: number; ly: number; lz: number; rx: number; ry: number; rz: number }

interface MeshBuilder {
  verts: number[];
  idx: number[];
}

/** Adds an upward-facing quad from corners given in perimeter order. */
function addQuad(
  m: MeshBuilder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number
): void {
  const base = m.verts.length / 3;
  m.verts.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
  // true cross product y-component of (b-a) x (c-a)
  const uy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  if (uy >= 0) m.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  else m.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}

/** Top surface quad between two cross-sections (L=left of travel, R=right). */
function addSectionTop(
  m: MeshBuilder,
  l1x: number, l1y: number, l1z: number,
  r1x: number, r1y: number, r1z: number,
  l2x: number, l2y: number, l2z: number,
  r2x: number, r2y: number, r2z: number
): void {
  addQuad(m, l1x, l1y, l1z, r1x, r1y, r1z, l2x, l2y, l2z, r2x, r2y, r2z);
}

/** Skirt wall hanging down from section edge points, plus slab bottom. */
function addSlab(m: MeshBuilder, sections: { lx: number; ly: number; lz: number; rx: number; ry: number; rz: number }[], depth: number): void {
  for (let i = 0; i < sections.length - 1; i++) {
    const A = sections[i];
    const B = sections[i + 1];
    // left skirt
    addQuad(m, A.lx, A.ly, A.lz, B.lx, B.ly, B.lz, A.lx, A.ly - depth, A.lz, B.lx, B.ly - depth, B.lz);
    // right skirt
    addQuad(m, B.rx, B.ry, B.rz, A.rx, A.ry, A.rz, B.rx, B.ry - depth, B.rz, A.rx, A.ry - depth, A.rz);
    // bottom (faces down)
    addQuad(m, A.rx, A.ry - depth, A.rz, B.rx, B.ry - depth, B.rz, A.lx, A.ly - depth, A.lz, B.lx, B.ly - depth, B.lz);
  }
}

/** Vertical barrier walls along both edges of a run. */
function addWallPair(
  m: MeshBuilder,
  run: Section[],
  height: number,
  gapAt?: (x: number, z: number) => boolean
): void {
  if (run.length < 2) return;
  for (let i = 0; i < run.length - 1; i++) {
    const A = run[i];
    const B = run[i + 1];
    // runoff gaps at marked zones (gravel traps etc.)
    if (gapAt) {
      const mx = (A.lx + A.rx) / 2;
      const mz = (A.lz + A.rz) / 2;
      if (gapAt(mx, mz)) continue;
    }
    // left wall
    addQuad(m,
      A.lx, A.ly + height, A.lz, A.lx, A.ly - 0.3, A.lz,
      B.lx, B.ly + height, B.lz, B.lx, B.ly - 0.3, B.lz);
    // right wall
    addQuad(m,
      A.rx, A.ry - 0.3, A.rz, A.rx, A.ry + height, A.rz,
      B.rx, B.ry - 0.3, B.rz, B.rx, B.ry + height, B.rz);
  }
}
function buildTrimesh(m: MeshBuilder): CANNON.Trimesh {
  return new CANNON.Trimesh(m.verts, m.idx);
}

export function buildRoadbedBody(track: TrackData): CANNON.Body {
  const body = new CANNON.Body({ mass: 0 });
  const m: MeshBuilder = { verts: [], idx: [] };
  const sp = track.shortcutPath;
  const hasSc = sp.length >= 3;

  const nearPath = (x: number, z: number, margin: number): boolean =>
    hasSc && distToPath(x, z, sp) < margin;

  // main driving ribbon, trimmed where the shortcut corridor crosses it
  const pts = track.points;
  const n = pts.length;
  // (main/shoulder/wall assembly happens below in one pass)
  // rebuild main/shoulder runs a second time to attach walls (runs were flushed above)
  {
    let startIdx2 = 0;
    if (hasSc) {
      for (let k2 = 0; k2 < n; k2++) {
        if (nearPath(pts[k2].x, pts[k2].z, 7.5)) {
          startIdx2 = k2;
          break;
        }
      }
    }
    let startSh = startIdx2;
    let run: Section[] = [];
    const flushWithWalls = (): void => {
      if (run.length >= 2) {
        for (let q = 0; q < run.length - 1; q++) {
          addSectionTop(m, run[q].lx, run[q].ly, run[q].lz, run[q].rx, run[q].ry, run[q].rz, run[q + 1].lx, run[q + 1].ly, run[q + 1].lz, run[q + 1].rx, run[q + 1].ry, run[q + 1].rz);
        }
        addSlab(m, run, 0.8);
        addWallPair(m, run, 1.15, (wx, wz) => {
          for (const z of track.surfaceZones) {
            if (z.surface !== 'tarmac' && Math.hypot(wx - z.x, wz - z.z) < z.r + 2.5) return true;
          }
          return false;
        });
        run = [];
      }
    };
    for (let k = 0; k <= n; k++) {
      const idx2 = (startIdx2 + k) % n;
      const p = pts[idx2];
      if (k === n || nearPath(p.x, p.z, 7.5)) {
        flushWithWalls();
      } else {
        run.push({
          lx: p.x + p.lx * (p.width / 2 + 0.45), ly: p.y, lz: p.z + p.lz * (p.width / 2 + 0.45),
          rx: p.x - p.lx * (p.width / 2 + 0.45), ry: p.y, rz: p.z - p.lz * (p.width / 2 + 0.45),
        });
      }
    }
    flushWithWalls();

    // shoulder slab (safety net), no walls
    let shRun: Section[] = [];
    for (let k = 0; k <= n; k++) {
      const idx2 = (startSh + k) % n;
      const p = pts[idx2];
      if (k === n || nearPath(p.x, p.z, 8)) {
        if (shRun.length >= 2) {
          for (let q = 0; q < shRun.length - 1; q++) {
            addSectionTop(m, shRun[q].lx, shRun[q].ly, shRun[q].lz, shRun[q].rx, shRun[q].ry, shRun[q].rz, shRun[q + 1].lx, shRun[q + 1].ly, shRun[q + 1].lz, shRun[q + 1].rx, shRun[q + 1].ry, shRun[q + 1].rz);
          }
          addSlab(m, shRun, 0.9);
        }
        shRun = [];
      } else {
        shRun.push({
          lx: p.x + p.lx * (p.width / 2 + 3.5), ly: p.y - 0.07, lz: p.z + p.lz * (p.width / 2 + 3.5),
          rx: p.x - p.lx * (p.width / 2 + 3.5), ry: p.y - 0.07, rz: p.z - p.lz * (p.width / 2 + 3.5),
        });
      }
    }
  }

  // shortcut corridor walls (lower)
  if (hasSc) {
    const scSections: Section[] = [];
    for (let i = 0; i < sp.length; i++) {
      const a2 = sp[Math.max(i - 1, 0)];
      const b2 = sp[Math.min(i + 1, sp.length - 1)];
      const dx2 = b2.x - a2.x;
      const dz2 = b2.z - a2.z;
      const hl2 = Math.hypot(dx2, dz2) || 1;
      const lxv = dz2 / hl2;
      const lzv = -dx2 / hl2;
      const hw2 = (sp[i].width ?? 8) / 2 + 0.35;
      scSections.push({
        lx: sp[i].x + lxv * hw2, ly: sp[i].y, lz: sp[i].z + lzv * hw2,
        rx: sp[i].x - lxv * hw2, ry: sp[i].y, rz: sp[i].z - lzv * hw2,
      });
    }
    const lWall: Section[] = [];
    const rWall: Section[] = [];
    for (const s of scSections) {
      lWall.push({ lx: s.lx, ly: s.ly + 0.8, lz: s.lz, rx: s.lx, ry: s.ly - 0.3, rz: s.lz });
      rWall.push({ lx: s.rx, ly: s.ry - 0.3, lz: s.rz, rx: s.rx, ry: s.ry + 0.8, rz: s.rz });
    }
    for (let i = 0; i < lWall.length - 1; i++) {
      addQuad(m, lWall[i].lx, lWall[i].ly, lWall[i].lz, lWall[i].rx, lWall[i].ry, lWall[i].rz, lWall[i + 1].lx, lWall[i + 1].ly, lWall[i + 1].lz, lWall[i + 1].rx, lWall[i + 1].ry, lWall[i + 1].rz);
      addQuad(m, rWall[i].lx, rWall[i].ly, rWall[i].lz, rWall[i].rx, rWall[i].ry, rWall[i].rz, rWall[i + 1].lx, rWall[i + 1].ly, rWall[i + 1].lz, rWall[i + 1].rx, rWall[i + 1].ry, rWall[i + 1].rz);
    }
  }

  if (hasSc) {
    // shortcut ribbon with skirts
    const scSections: Section[] = [];
    for (let i = 0; i < sp.length; i++) {
      const a = sp[Math.max(i - 1, 0)];
      const b = sp[Math.min(i + 1, sp.length - 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const hl = Math.hypot(dx, dz) || 1;
      const lxv = dz / hl;
      const lzv = -dx / hl;
      const hw = (sp[i].width ?? 8) / 2;
      scSections.push({
        lx: sp[i].x + lxv * hw, ly: sp[i].y, lz: sp[i].z + lzv * hw,
        rx: sp[i].x - lxv * hw, ry: sp[i].y, rz: sp[i].z - lzv * hw,
      });
    }
    for (let i = 0; i < scSections.length - 1; i++) {
      addSectionTop(m, scSections[i].lx, scSections[i].ly, scSections[i].lz, scSections[i].rx, scSections[i].ry, scSections[i].rz, scSections[i + 1].lx, scSections[i + 1].ly, scSections[i + 1].lz, scSections[i + 1].rx, scSections[i + 1].ry, scSections[i + 1].rz);
    }
    addSlab(m, scSections, 0.8);

    // mouth aprons: flush quads over the trimmed road bites
    const apronAt = (jj: number): void => {
      const jA = (jj - 1 + n) % n;
      const jB = jj % n;
      const pA = pts[jA];
      const pB = pts[jB];
      addSectionTop(
        m,
        pA.x + pA.lx * (pA.width / 2), pA.y, pA.z + pA.lz * (pA.width / 2),
        pA.x - pA.lx * (pA.width / 2), pA.y, pA.z - pA.lz * (pA.width / 2),
        pB.x + pB.lx * (pB.width / 2), pB.y, pB.z + pB.lz * (pB.width / 2),
        pB.x - pB.lx * (pB.width / 2), pB.y, pB.z - pB.lz * (pB.width / 2)
      );
    };
    const nearestMainTo = (px: number, pz: number): number => {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = pts[i].x - px;
        const dz = pts[i].z - pz;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    };
    const jIn = nearestMainTo(sp[0].x, sp[0].z);
    const jOut = nearestMainTo(sp[sp.length - 1].x, sp[sp.length - 1].z);
    apronAt(jIn - 1);
    apronAt(jIn);
    apronAt(jIn + 1);
    apronAt(jOut - 1);
    apronAt(jOut);
    apronAt(jOut + 1);

    // wedge fillers between main shoulder edge and shortcut edge at both mouths
    const wedgePatch = (atStart: boolean): void => {
      const sA = atStart ? sp[0] : sp[sp.length - 1];
      const sB = atStart ? sp[1] : sp[sp.length - 2];
      const jj = nearestMainTo(sA.x, sA.z);
      const mm = pts[jj];
      const sideSign = Math.sign((sA.x - mm.x) * mm.lx + (sA.z - mm.z) * mm.lz) || 1;
      const hwM = mm.width / 2 + 3.5;
      const e1x = mm.x + mm.lx * sideSign * hwM;
      const e1z = mm.z + mm.lz * sideSign * hwM;
      const e1y = mm.y - 0.07;
      const sdx = sB.x - sA.x;
      const sdz = sB.z - sA.z;
      const sl = Math.hypot(sdx, sdz) || 1;
      const sclx = sdz / sl;
      const sclz = -sdx / sl;
      const face = Math.sign(sclx * (mm.x - sA.x) + sclz * (mm.z - sA.z)) || 1;
      const shw = (sB.width ?? 8) / 2 + 1.2;
      const yW = Math.min(mm.y, sA.y) - 0.05;
      addQuad(m, e1x, e1y, e1z, sA.x + sclx * face * shw, yW, sA.z + sclz * face * shw, e1x, e1y - 0.001, e1z + 4, sA.x + sclx * face * shw, yW - 0.001, sA.z + sclz * face * shw + 4);
    };
    wedgePatch(true);
    wedgePatch(false);
  }

  body.addShape(buildTrimesh(m));
  return body;
}
