import * as THREE from 'three';
import { GFX } from '../config';

const SKID_VERT = /* glsl */ `
  attribute float aAlpha;
  attribute float aBirth;
  attribute float aIntensity;
  uniform float uTime;
  varying float vAlpha;
  varying float vIntensity;
  void main() {
    float age = uTime - aBirth;
    vAlpha = aAlpha * (1.0 - clamp(age / 9.0, 0.0, 1.0));
    vIntensity = aIntensity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKID_FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vIntensity;
  void main() {
    vec3 col = mix(vec3(0.106), vec3(0.031), vIntensity);
    gl_FragColor = vec4(col, vAlpha);
  }
`;

export class SkidMarkSystem {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly birth: Float32Array;
  private readonly inten: Float32Array;
  private readonly cap: number;
  private cursor: number;
  private time: number;
  private lastPx: number;
  private lastPz: number;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const cap = GFX.skidCapacity;
    this.cap = cap;
    this.cursor = 0;
    this.time = 0;
    this.lastPx = 1;
    this.lastPz = 0;
    this.pos = new Float32Array(cap * 18);
    this.alpha = new Float32Array(cap * 6);
    this.birth = new Float32Array(cap * 6);
    this.inten = new Float32Array(cap * 6);
    this.birth.fill(-1000);

    this.geometry = new THREE.BufferGeometry();
    const mk = (arr: Float32Array, item: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(arr, item);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.geometry.setAttribute('position', mk(this.pos, 3));
    this.geometry.setAttribute('aAlpha', mk(this.alpha, 1));
    this.geometry.setAttribute('aBirth', mk(this.birth, 1));
    this.geometry.setAttribute('aIntensity', mk(this.inten, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  addSegment(wheelId: 0 | 1 | 2 | 3, ax: number, ay: number, az: number, bx: number, by: number, bz: number, intensity: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let px = this.lastPx;
    let pz = this.lastPz;
    if (lenSq > 1e-8) {
      const inv = 1 / Math.sqrt(lenSq);
      px = -dz * inv;
      pz = dx * inv;
      this.lastPx = px;
      this.lastPz = pz;
    }
    const hw = 0.17;
    const ay2 = ay + 0.02;
    const by2 = by + 0.02;
    const s = this.cursor * 18;
    const p = this.pos;
    // tris (aL,bL,bR)(aL,bR,aR) wind CCW seen from +Y
    p[s] = ax + px * hw;
    p[s + 1] = ay2;
    p[s + 2] = az + pz * hw;
    p[s + 3] = bx + px * hw;
    p[s + 4] = by2;
    p[s + 5] = bz + pz * hw;
    p[s + 6] = bx - px * hw;
    p[s + 7] = by2;
    p[s + 8] = bz - pz * hw;
    p[s + 9] = ax + px * hw;
    p[s + 10] = ay2;
    p[s + 11] = az + pz * hw;
    p[s + 12] = bx - px * hw;
    p[s + 13] = by2;
    p[s + 14] = bz - pz * hw;
    p[s + 15] = ax - px * hw;
    p[s + 16] = ay2;
    p[s + 17] = az - pz * hw;
    const ci = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
    const al = 0.25 + ci * 0.4;
    const bt = this.time;
    const b = this.cursor * 6;
    for (let v = 0; v < 6; v++) {
      this.alpha[b + v] = al;
      this.birth[b + v] = bt;
      this.inten[b + v] = ci;
    }
    const pa = this.geometry.attributes;
    (pa.position as THREE.BufferAttribute).needsUpdate = true;
    (pa.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (pa.aBirth as THREE.BufferAttribute).needsUpdate = true;
    (pa.aIntensity as THREE.BufferAttribute).needsUpdate = true;
    this.cursor = this.cursor + 1 >= this.cap ? 0 : this.cursor + 1;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
