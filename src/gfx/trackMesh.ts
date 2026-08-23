import * as THREE from 'three';
import type { TrackData } from '../types';
import { CAR_COLORS } from '../config';

function tarmacTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#33363b';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  // racing groove: darker band through middle
  const grad = g.createLinearGradient(0, 64, 0, 192);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, 'rgba(12,12,14,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 64, 256, 128);
  // white edge lines
  g.fillStyle = 'rgba(235,235,235,0.85)';
  g.fillRect(6, 0, 5, 256);
  g.fillRect(245, 0, 5, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function kerbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c23b2e';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#e8e4da';
  g.fillRect(0, 32, 64, 32);
  g.fillRect(0, 96, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#111' : '#eee';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dirtTexture(baseHex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = baseHex;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * 128, Math.random() * 128, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface TrackMeshHandle {
  group: THREE.Group;
  dispose(): void;
}

export function buildTrackMesh(scene: THREE.Scene, track: TrackData): TrackMeshHandle {
  const group = new THREE.Group();
  const pts = track.points;
  const n = pts.length;

  // ---- main road ribbon ----
  const positions = new Float32Array(n * 6 * 3);
  const uvs = new Float32Array(n * 6 * 2);
  const setV = (i: number, j: number, x: number, y: number, z: number) => {
    positions[(i * 6 + j) * 3] = x;
    positions[(i * 6 + j) * 3 + 1] = y;
    positions[(i * 6 + j) * 3 + 2] = z;
  };
  const setUV = (i: number, j: number, u: number, v: number) => {
    uvs[(i * 6 + j) * 2] = u;
    uvs[(i * 6 + j) * 2 + 1] = v;
  };
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const hw = p.width / 2;
    const qhw = q.width / 2;
    const ax = p.x + p.lx * hw, az = p.z + p.lz * hw;
    const bx = p.x - p.lx * hw, bz = p.z - p.lz * hw;
    const cx = q.x + q.lx * qhw, cz = q.z + q.lz * qhw;
    const dx = q.x - q.lx * qhw, dz = q.z - q.lz * qhw;
    const v0 = p.dist / 6, v1 = (p.dist + track.spacing) / 6;
    setV(i, 0, ax, p.y, az); setUV(i, 0, 0, v0);
    setV(i, 1, bx, p.y, bz); setUV(i, 1, 1, v0);
    setV(i, 2, cx, q.y, cz); setUV(i, 2, 0, v1);
    setV(i, 3, cx, q.y, cz); setUV(i, 3, 0, v1);
    setV(i, 4, bx, p.y, bz); setUV(i, 4, 1, v0);
    setV(i, 5, dx, q.y, dz); setUV(i, 5, 1, v1);
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  roadGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({ map: tarmacTexture(), roughness: 0.94, metalness: 0 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  group.add(road);

  // ---- shortcut ribbon (dirt) ----
  if (track.shortcutPath.length > 1) {
    const sp = track.shortcutPath;
    const m = sp.length;
    const sPos = new Float32Array(m * 6 * 3);
    const sUv = new Float32Array(m * 6 * 2);
    let d = 0;
    for (let i = 0; i < m; i++) {
      const p = sp[i];
      const q = sp[Math.min(i + 1, m - 1)];
      const dxs = q.x - p.x, dzs = q.z - p.z;
      const len = Math.hypot(dxs, dzs) || 1;
      const lx = -dzs / len, lz = dxs / len; // left of travel
      const hw = p.width / 2;
      const o = i * 18, ou = i * 12;
      sPos[o] = p.x + lx * hw; sPos[o + 1] = p.y; sPos[o + 2] = p.z + lz * hw;
      sPos[o + 3] = p.x - lx * hw; sPos[o + 4] = p.y; sPos[o + 5] = p.z - lz * hw;
      sPos[o + 6] = q.x + lx * hw; sPos[o + 7] = q.y; sPos[o + 8] = q.z + lz * hw;
      sPos[o + 9] = q.x + lx * hw; sPos[o + 10] = q.y; sPos[o + 11] = q.z + lz * hw;
      sPos[o + 12] = p.x - lx * hw; sPos[o + 13] = p.y; sPos[o + 14] = p.z - lz * hw;
      sPos[o + 15] = q.x - lx * hw; sPos[o + 16] = q.y; sPos[o + 17] = q.z - lz * hw;
      const v0 = d / 5, v1 = (d + len) / 5;
      d += len;
      sUv[ou] = 0; sUv[ou + 1] = v0;
      sUv[ou + 2] = 1; sUv[ou + 3] = v0;
      sUv[ou + 4] = 0; sUv[ou + 5] = v1;
      sUv[ou + 6] = 0; sUv[ou + 7] = v1;
      sUv[ou + 8] = 1; sUv[ou + 9] = v0;
      sUv[ou + 10] = 1; sUv[ou + 11] = v1;
    }
    const scGeo = new THREE.BufferGeometry();
    scGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scGeo.setAttribute('uv', new THREE.BufferAttribute(sUv, 2));
    scGeo.computeVertexNormals();
    const scMesh = new THREE.Mesh(scGeo, new THREE.MeshStandardMaterial({ map: dirtTexture('#6d5a40'), roughness: 1 }));
    scMesh.receiveShadow = true;
    group.add(scMesh);
  }

  // ---- kerbs on corner edges ----
  const kerbGeoData: number[] = [];
  const kerbUvData: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    if (Math.abs(p.curvature) < 0.008) continue;
    const side = p.curvature > 0 ? 1 : -1; // kerb on inside edge
    const off1 = side * (p.width / 2 - 0.05);
    const off2 = side * (p.width / 2 + 0.85);
    const qoff1 = side * (q.width / 2 - 0.05);
    const qoff2 = side * (q.width / 2 + 0.85);
    const y1 = p.y + 0.03, y2 = q.y + 0.03;
    const a = [p.x + p.lx * off1, y1, p.z + p.lz * off1];
    const b = [p.x + p.lx * off2, y1, p.z + p.lz * off2];
    const cc = [q.x + q.lx * qoff1, y2, q.z + q.lz * qoff1];
    const dd = [q.x + q.lx * qoff2, y2, q.z + q.lz * qoff2];
    kerbGeoData.push(...a, ...cc, ...b, ...cc, ...dd, ...b);
    const v0 = p.dist / 2, v1 = (p.dist + track.spacing) / 2;
    kerbUvData.push(0, v0, 0, v1, 1, v0, 0, v1, 1, v1, 1, v0);
  }
  if (kerbGeoData.length) {
    const kGeo = new THREE.BufferGeometry();
    kGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(kerbGeoData), 3));
    kGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(kerbUvData), 2));
    kGeo.computeVertexNormals();
    const kerbs = new THREE.Mesh(
      kGeo,
      new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.8 })
    );
    kerbs.receiveShadow = true;
    group.add(kerbs);
  }

  // ---- start/finish strip ----
  const st = pts[0];
  const stripLen = 3.2;
  const next = pts[1];
  const fwdX = next.x - st.x, fwdZ = next.z - st.z;
  const fLen = Math.hypot(fwdX, fwdZ) || 1;
  const fx = fwdX / fLen, fz = fwdZ / fLen;
  const hw0 = st.width / 2;
  const stripGeo = new THREE.BufferGeometry();
  const sPosArr = new Float32Array([
    st.x + st.lx * hw0, st.y + 0.02, st.z + st.lz * hw0,
    st.x - st.lx * hw0, st.y + 0.02, st.z - st.lz * hw0,
    st.x + fx * stripLen + st.lx * hw0, next.y + 0.02, st.z + fz * stripLen + st.lz * hw0,
    st.x + fx * stripLen + st.lx * hw0, next.y + 0.02, st.z + fz * stripLen + st.lz * hw0,
    st.x - st.lx * hw0, st.y + 0.02, st.z - st.lz * hw0,
    st.x + fx * stripLen - st.lx * hw0, next.y + 0.02, st.z + fz * stripLen - st.lz * hw0,
  ]);
  stripGeo.setAttribute('position', new THREE.BufferAttribute(sPosArr, 3));
  stripGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), 2));
  stripGeo.computeVertexNormals();
  group.add(new THREE.Mesh(stripGeo, new THREE.MeshBasicMaterial({ map: checkerTexture() })));

  // ---- barrier walls (instanced from colliderSpecs) ----
  if (track.colliderSpecs.length) {
    const bGeo = new THREE.BoxGeometry(0.36, 1.5, 1);
    const bMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
    const inst = new THREE.InstancedMesh(bGeo, bMat, track.colliderSpecs.length);
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);
    const colA = new THREE.Color('#b9b4a6');
    const colB = new THREE.Color('#a33c2f');
    track.colliderSpecs.forEach((spec, i) => {
      quat.setFromAxisAngle(axisY, spec.yaw);
      mtx.compose(
        new THREE.Vector3(spec.x, spec.y + spec.hy, spec.z),
        quat,
        new THREE.Vector3(spec.hx * 2, spec.hy * 2, Math.max(spec.hz * 2, 1))
      );
      inst.setMatrixAt(i, mtx);
      inst.setColorAt(i, i % 12 < 6 ? colA : colB);
    });
    inst.castShadow = false;
    inst.receiveShadow = true;
    group.add(inst);
  }

  scene.add(group);

  void CAR_COLORS;
  return {
    group,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else if (mat) mat.dispose();
      });
      scene.remove(group);
    },
  };
}
