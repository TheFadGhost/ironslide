// Minimap: static track path cached to an offscreen canvas, car dots blitted per frame.
import type { TrackData, CarProgress } from '../types';
import { ensureUiStyles, paintHex } from './hud';

const SIZE = 210;
const PAD = 12;
const PLAYER_ID = 0; // player is always car id 0

export function createMinimap(root: HTMLElement): {
  drawStatic(track: TrackData): void;
  drawFrame(cars: CarProgress[]): void;
  setVisible(v: boolean): void;
} {
  ensureUiStyles();
  const wrap = document.createElement('div');
  wrap.className = 'is-panel is-minimap';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.width = SIZE + 'px';
  canvas.style.height = SIZE + 'px';
  wrap.appendChild(canvas);
  root.appendChild(wrap);

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  const off = document.createElement('canvas');
  off.width = SIZE;
  off.height = SIZE;

  let tr: { s: number; ox: number; oy: number } | null = null;

  function toCanvas(x: number, z: number): { cx: number; cy: number } {
    if (!tr) return { cx: 0, cy: 0 };
    return { cx: tr.ox + x * tr.s, cy: tr.oy + z * tr.s };
  }

  function drawStatic(track: TrackData): void {
    const pts = track.points;
    if (pts.length < 2) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const spanX = Math.max(1e-6, maxX - minX);
    const spanZ = Math.max(1e-6, maxZ - minZ);
    const inner = SIZE - PAD * 2;
    const s = Math.min(inner / spanX, inner / spanZ);
    const ox = PAD + (inner - spanX * s) / 2 - minX * s;
    const oy = PAD + (inner - spanZ * s) / 2 - minZ * s;
    tr = { s, ox, oy };

    // render path once to the offscreen buffer
    const octx = off.getContext('2d') as CanvasRenderingContext2D | null;
    if (!octx || !ctx) return;
    octx.clearRect(0, 0, SIZE, SIZE);
    octx.lineJoin = 'round';
    octx.lineCap = 'round';
    octx.strokeStyle = 'rgba(255,255,255,0.5)';
    octx.lineWidth = 3;
    octx.beginPath();
    const first = toCanvas(pts[0].x, pts[0].z);
    octx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const c = toCanvas(pts[i].x, pts[i].z);
      octx.lineTo(c.cx, c.cy);
    }
    octx.closePath();
    octx.stroke();

    // start line tick (accent), perpendicular to travel direction
    const sp = track.startPoint;
    const startC = toCanvas(sp.x, sp.z);
    const px = Math.cos(sp.heading);
    const py = -Math.sin(sp.heading);
    octx.strokeStyle = '#c8452c';
    octx.lineWidth = 2.5;
    octx.beginPath();
    octx.moveTo(startC.cx - px * 9, startC.cy - py * 9);
    octx.lineTo(startC.cx + px * 9, startC.cy + py * 9);
    octx.stroke();
  }

  function drawFrame(cars: CarProgress[]): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!tr) return;
    ctx.drawImage(off, 0, 0);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const c = toCanvas(car.state.x, car.state.z);
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = paintHex(car.id);
      ctx.fill();
      if (car.id === PLAYER_ID) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  function setVisible(v: boolean): void {
    wrap.style.display = v ? '' : 'none';
  }

  return { drawStatic, drawFrame, setVisible };
}
