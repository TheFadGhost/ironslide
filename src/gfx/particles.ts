import * as THREE from 'three';
import { GFX } from '../config';

export type ParticleKind = 'dust' | 'gravel' | 'smoke' | 'spark';

export interface EmitOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  count: number;
  spread: number;
  size: [number, number];
  life: [number, number];
  tintJitter?: number;
}

interface PoolSpec {
  gravity: number;
  drag: number;
  drift: number;
  baseAlpha: number;
  grow: number;
  blending: THREE.Blending;
  colorA: number;
  colorB: number;
  defVx: number;
  defVy: number;
  defVz: number;
}

const PARTICLE_VERT = /* glsl */ `
  attribute float age;
  attribute float life;
  attribute float size;
  attribute float seed;
  attribute float tint;
  uniform float uPixelRatio;
  uniform float uGrow;
  varying float vFade;
  varying float vTint;
  varying float vSeed;
  void main() {
    float t = clamp(age / max(life, 0.001), 0.0, 1.0);
    // fade in over first 10% of life, out across last 60%
    float fadeIn = smoothstep(0.0, 0.1, t);
    float fadeOut = 1.0 - smoothstep(0.4, 1.0, t);
    vFade = fadeIn * fadeOut;
    vTint = tint;
    vSeed = seed;
    float grown = size * mix(1.0, 1.5 + seed * 0.9, t * uGrow);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = grown * uPixelRatio * (300.0 / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uBaseAlpha;
  varying float vFade;
  varying float vTint;
  varying float vSeed;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * vFade * uBaseAlpha;
    if (a < 0.004) discard;
    vec3 col = mix(uColorA, uColorB, vTint) * (0.85 + 0.3 * vSeed);
    gl_FragColor = vec4(col, a);
  }
`;

function hash01(n: number): number {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function makeSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

class Pool {
  private readonly scene: THREE.Scene;
  private readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly seed: Float32Array;
  private readonly tint: Float32Array;
  private readonly attrs: THREE.BufferAttribute[];
  private readonly spec: PoolSpec;
  private readonly cap: number;
  private count: number;
  private head: number;
  private seq: number;

  constructor(scene: THREE.Scene, cap: number, tex: THREE.Texture, pixelRatio: number, spec: PoolSpec) {
    this.scene = scene;
    this.spec = spec;
    this.cap = cap;
    this.count = 0;
    this.head = 0;
    this.seq = 0;
    this.attrs = [];
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.seed = new Float32Array(cap);
    this.tint = new Float32Array(cap);

    this.geometry = new THREE.BufferGeometry();
    const mk = (arr: Float32Array, item: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(arr, item);
      a.setUsage(THREE.DynamicDrawUsage);
      this.attrs.push(a);
      return a;
    };
    this.geometry.setAttribute('position', mk(this.pos, 3));
    this.geometry.setAttribute('velocity', mk(this.vel, 3));
    this.geometry.setAttribute('age', mk(this.age, 1));
    this.geometry.setAttribute('life', mk(this.life, 1));
    this.geometry.setAttribute('size', mk(this.size, 1));
    this.geometry.setAttribute('seed', mk(this.seed, 1));
    this.geometry.setAttribute('tint', mk(this.tint, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: pixelRatio },
        uGrow: { value: spec.grow },
        uMap: { value: tex },
        uColorA: { value: new THREE.Color(spec.colorA) },
        uColorB: { value: new THREE.Color(spec.colorB) },
        uBaseAlpha: { value: spec.baseAlpha },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: spec.blending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(n: number, o: EmitOpts, tintBase: number): void {
    const jit = (o.tintJitter ?? 0) * 2;
    const spec = this.spec;
    for (let k = 0; k < n; k++) {
      let slot: number;
      if (this.count < this.cap) {
        slot = this.count++;
      } else {
        slot = this.head;
        this.head = this.head + 1 >= this.cap ? 0 : this.head + 1;
      }
      const q = Math.imul(++this.seq, 0x9e3779b1) | 0;
      const h1 = hash01(q ^ slot);
      const h2 = hash01(q ^ slot ^ 0x68bc21eb);
      const h3 = hash01(q ^ slot ^ 0x02e5be93);
      const h4 = hash01(q ^ slot ^ 0x74882c8e);
      const h5 = hash01(q ^ slot ^ 0x21f0aaad);
      const h6 = hash01(q ^ slot ^ 0x5dcaa17c);
      const h7 = hash01(q ^ slot ^ 0x9e2b5d1f);
      const th = h1 * 6.283185307179586;
      const cy = h2 * 2 - 1;
      const cr = Math.sqrt(Math.max(1 - cy * cy, 0));
      const dx = cr * Math.cos(th);
      const dz = cr * Math.sin(th);
      const spd = o.spread * (0.45 + 0.55 * h3);
      const sc = o.spread * 0.12 * h4;
      const j = slot * 3;
      this.pos[j] = o.x + dx * sc;
      this.pos[j + 1] = o.y + cy * sc * 0.5;
      this.pos[j + 2] = o.z + dz * sc;
      this.vel[j] = (o.vx ?? spec.defVx) + dx * spd;
      this.vel[j + 1] = (o.vy ?? spec.defVy) + cy * spd;
      this.vel[j + 2] = (o.vz ?? spec.defVz) + dz * spd;
      this.age[slot] = 0;
      this.life[slot] = o.life[0] + (o.life[1] - o.life[0]) * h5;
      this.size[slot] = o.size[0] + (o.size[1] - o.size[0]) * h6;
      this.seed[slot] = h3;
      const tv = tintBase + (h7 - 0.5) * jit;
      this.tint[slot] = tv < 0 ? 0 : tv > 1 ? 1 : tv;
    }
    this.geometry.setDrawRange(0, this.count);
    for (let k = 0; k < this.attrs.length; k++) this.attrs[k].needsUpdate = true;
  }

  update(dt: number): void {
    this.geometry.setDrawRange(0, this.count);
    if (dt <= 0 || this.count === 0) return;
    const d = dt > 0.1 ? 0.1 : dt;
    const spec = this.spec;
    const dragF = Math.pow(spec.drag, d * 60);
    const gy = spec.gravity * d;
    const drift = spec.drift;
    let i = 0;
    while (i < this.count) {
      const j = i * 3;
      let vx = this.vel[j];
      let vy = this.vel[j + 1];
      let vz = this.vel[j + 2];
      const age = this.age[i];
      if (drift > 0) {
        const ph = this.seed[i] * 6.2831853;
        vx += Math.sin(ph + age * 2.3) * drift * d;
        vz += Math.cos(ph * 1.618 + age * 1.9) * drift * d;
      }
      vy += gy;
      vx *= dragF;
      vy *= dragF;
      vz *= dragF;
      this.vel[j] = vx;
      this.vel[j + 1] = vy;
      this.vel[j + 2] = vz;
      this.pos[j] += vx * d;
      this.pos[j + 1] += vy * d;
      this.pos[j + 2] += vz * d;
      const na = age + d;
      this.age[i] = na;
      if (na >= this.life[i]) {
        // swap-with-last keeps live particles packed for drawRange
        const last = --this.count;
        if (i !== last) {
          const lj = last * 3;
          this.pos[j] = this.pos[lj];
          this.pos[j + 1] = this.pos[lj + 1];
          this.pos[j + 2] = this.pos[lj + 2];
          this.vel[j] = this.vel[lj];
          this.vel[j + 1] = this.vel[lj + 1];
          this.vel[j + 2] = this.vel[lj + 2];
          this.age[i] = this.age[last];
          this.life[i] = this.life[last];
          this.size[i] = this.size[last];
          this.seed[i] = this.seed[last];
          this.tint[i] = this.tint[last];
        }
      } else {
        i++;
      }
    }
    for (let k = 0; k < this.attrs.length; k++) this.attrs[k].needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class ParticleSystem {
  private readonly dust: Pool;
  private readonly smoke: Pool;
  private readonly spark: Pool;
  private readonly texture: THREE.CanvasTexture;
  private density: number;
  private carry: number;

  constructor(scene: THREE.Scene) {
    this.texture = makeSpriteTexture();
    this.density = 1;
    this.carry = 0;
    const pr = Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      GFX.pixelRatioCap,
    );
    this.dust = new Pool(scene, GFX.particleBudgets.dust, this.texture, pr, {
      gravity: -3,
      drag: 0.92,
      drift: 0.35,
      baseAlpha: 0.62,
      grow: 0,
      blending: THREE.NormalBlending,
      colorA: 0xa58a5f,
      colorB: 0x8b8578,
      defVx: 0,
      defVy: 1.4,
      defVz: 0,
    });
    this.smoke = new Pool(scene, GFX.particleBudgets.smoke, this.texture, pr, {
      gravity: 0.8,
      drag: 0.965,
      drift: 1.5,
      baseAlpha: 0.34,
      grow: 1,
      blending: THREE.NormalBlending,
      colorA: 0x999999,
      colorB: 0x999999,
      defVx: 0,
      defVy: 0.9,
      defVz: 0,
    });
    this.spark = new Pool(scene, GFX.particleBudgets.spark, this.texture, pr, {
      gravity: -22,
      drag: 0.988,
      drift: 0,
      baseAlpha: 0.95,
      grow: 0,
      blending: THREE.AdditiveBlending,
      colorA: 0xffb040,
      colorB: 0xffd27a,
      defVx: 0,
      defVy: 2.4,
      defVz: 0,
    });
  }

  emit(kind: ParticleKind, o: EmitOpts): void {
    this.carry += o.count * this.density;
    const n = Math.floor(this.carry);
    this.carry -= n;
    if (n <= 0) return;
    if (kind === 'smoke') this.smoke.emit(n, o, 0);
    else if (kind === 'spark') this.spark.emit(n, o, 0);
    else this.dust.emit(n, o, kind === 'gravel' ? 1 : 0);
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.smoke.update(dt);
    this.spark.update(dt);
  }

  setDensityScale(s: number): void {
    this.density = s > 0 ? s : 0;
  }

  dispose(): void {
    this.dust.dispose();
    this.smoke.dispose();
    this.spark.dispose();
    this.texture.dispose();
  }
}
