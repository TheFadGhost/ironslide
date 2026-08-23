import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_COLORS } from '../config';
import { Rng } from '../core/rng';
import type { TrackData } from '../types';

const SEED = 1337;
const TERRAIN_SIZE = 2600;
const TERRAIN_SEG = 128;
const NOISE_AMP = 14; // total peak-to-valley; ~7m amplitude about mean
const TREE_TARGET = 420;
const ROCK_TARGET = 130;
const MOUNTAIN_COUNT = 14;
const TIRE_MAX = 24;
const BOARD_MAX = 10;
const BRANDS = ['AXLE&CO', 'GRIPPAINT', 'TORQUEHAUS', 'SLIDEWRIGHT'] as const;

function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) ^ SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  return (vnoise(x, y) + vnoise(x * 2.13 + 31.7, y * 2.13 - 47.9) * 0.5) / 1.5;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface NearHit {
  d: number;
  y: number;
  halfW: number;
}

interface RefPoint {
  x: number;
  z: number;
  y: number;
  hw: number;
}

type NearestFn = (x: number, z: number) => NearHit;

function nearestFrom(pts: RefPoint[]): NearestFn {
  const n = pts.length;
  return (x: number, z: number): NearHit => {
    let bd = Infinity;
    let by = 0;
    let bw = 8;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        by = p.y;
        bw = p.hw;
      }
    }
    return { d: Math.sqrt(bd), y: by, halfW: bw };
  };
}

function paintGeo(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function bannerTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#23262c';
  g.fillRect(0, 0, 1024, 128);
  const label = 'IRONSLIDE \u2014 FOUNDRY RIDGE';
  let size = 62;
  do {
    g.font = `700 ${size}px "Arial Black", Arial, sans-serif`;
    size -= 3;
  } while (g.measureText(label).width > 930 && size > 30);
  g.fillStyle = '#f2ede4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 512, 66);
  g.fillStyle = '#c8452c';
  g.fillRect(0, 0, 22, 128);
  g.fillRect(1002, 0, 22, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function brandAtlasTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < BRANDS.length; i++) {
    const x0 = i * 512;
    g.fillStyle = '#20232a';
    g.fillRect(x0, 0, 512, 256);
    const accent = i % 2 === 0 ? CAR_COLORS[0].paint : CAR_COLORS[1].paint;
    g.fillStyle = '#' + accent.toString(16).padStart(6, '0');
    g.fillRect(x0 + 36, 196, 440, 16);
    let size = 104;
    do {
      g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
      size -= 6;
    } while (g.measureText(BRANDS[i]).width > 448 && size > 40);
    g.fillStyle = '#f0ebe1';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(BRANDS[i], x0 + 256, 112);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function cloudTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Environment {
  update(playerX: number, playerZ: number): void;
  dispose(): void;
}

export function buildEnvironment(scene: THREE.Scene, track: TrackData): Environment {
  const rng = new Rng(SEED);
  const root = new THREE.Group();
  scene.add(root);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const instanced: THREE.InstancedMesh[] = [];

  const mainPts: RefPoint[] = [];
  for (let i = 0; i < track.points.length; i += 3) {
    const p = track.points[i];
    mainPts.push({ x: p.x, z: p.z, y: p.y, hw: p.width * 0.5 });
  }
  const shortPts: RefPoint[] = track.shortcutPath.map((s) => ({
    x: s.x,
    z: s.z,
    y: s.y,
    hw: s.width * 0.5,
  }));
  const nearestMain = nearestFrom(mainPts);
  const nearestShort = nearestFrom(shortPts);
  const nearestAny = nearestFrom(mainPts.concat(shortPts));

  function terrainHeight(x: number, z: number): number {
    const n = nearestAny(x, z);
    const flat = smoothstep(n.halfW + 4, n.halfW + 26, n.d);
    const h = (fbm(x * 0.0042, z * 0.0042) - 0.5) * NOISE_AMP;
    const bed = n.y - 0.25;
    return bed + (h - bed) * flat;
  }

  const dummy = new THREE.Object3D();

  // ---- terrain ----
  const tGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
  tGeo.rotateX(-Math.PI / 2);
  const pos = tGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  tGeo.computeVertexNormals();
  const nor = tGeo.attributes.normal;
  const colArr = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x6d7a54);
  const cDirt = new THREE.Color(0x8a7a58);
  const cDusty = new THREE.Color(0xa59773);
  const tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = nearestAny(x, z);
    const slope = 1 - nor.getY(i);
    const m = Math.min(
      1,
      Math.max(0, fbm(x * 0.011 + 91.3, z * 0.011 - 47.9) - 0.42 + slope * 1.35)
    );
    tmpC.copy(cGrass).lerp(cDirt, m);
    const sh = 1 - smoothstep(n.halfW + 1.2, n.halfW + 11, n.d);
    if (sh > 0.001) tmpC.lerp(cDusty, sh * 0.85);
    colArr[i * 3] = tmpC.r;
    colArr[i * 3 + 1] = tmpC.g;
    colArr[i * 3 + 2] = tmpC.b;
  }
  tGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  geos.push(tGeo);
  const tMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mats.push(tMat);
  const terrain = new THREE.Mesh(tGeo, tMat);
  terrain.receiveShadow = true;
  terrain.frustumCulled = false;
  root.add(terrain);

  // ---- trees ----
  const trunk = paintGeo(new THREE.CylinderGeometry(0.18, 0.3, 1.7, 6), 0x5a4632);
  trunk.translate(0, 0.85, 0);
  const coneA = paintGeo(new THREE.ConeGeometry(1.6, 2.8, 7), 0x3c5238);
  coneA.translate(0, 2.55, 0);
  const coneB = paintGeo(new THREE.ConeGeometry(1.05, 2.1, 7), 0x46593d);
  coneB.translate(0, 4.3, 0);
  const treeGeo = mergeGeometries([trunk, coneA, coneB])!;
  geos.push(treeGeo);
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  mats.push(treeMat);

  const padX = 140;
  const minX = Math.max(-1230, track.boundsMin.x - padX);
  const maxX = Math.min(1230, track.boundsMax.x + padX);
  const minZ = Math.max(-1230, track.boundsMin.z - padX);
  const maxZ = Math.min(1230, track.boundsMax.z + padX);

  const treeSpots: { x: number; z: number }[] = [];
  let guard = 0;
  while (treeSpots.length < TREE_TARGET && guard++ < 12000) {
    const x = rng.range(minX, maxX);
    const z = rng.range(minZ, maxZ);
    const nm = nearestMain(x, z);
    if (nm.d <= nm.halfW + 7) continue;
    if (nearestShort(x, z).d <= 8) continue;
    treeSpots.push({ x, z });
  }

  const trees = new THREE.InstancedMesh(treeGeo, treeMat, Math.max(1, treeSpots.length));
  trees.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  for (let i = 0; i < treeSpots.length; i++) {
    const s = rng.range(0.8, 1.6);
    dummy.position.set(treeSpots[i].x, terrainHeight(treeSpots[i].x, treeSpots[i].z) - 0.15, treeSpots[i].z);
    dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
    dummy.scale.set(s, s * rng.range(0.92, 1.08), s);
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
    const v = rng.range(0.82, 1.08);
    trees.setColorAt(i, tmpC.setRGB(v, v, v));
  }
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.castShadow = true;
  trees.receiveShadow = true;
  trees.frustumCulled = false;
  instanced.push(trees);
  root.add(trees);

  // ---- rocks ----
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  geos.push(rockGeo);
  const rockMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  mats.push(rockMat);
  const gravelZones = track.surfaceZones.filter((zone) => zone.surface === 'gravel');

  const rockSpots: { x: number; z: number }[] = [];
  guard = 0;
  while (rockSpots.length < ROCK_TARGET && guard++ < 6000) {
    let x: number;
    let z: number;
    if (gravelZones.length > 0 && rng.next() < 0.55) {
      const zone = gravelZones[Math.floor(rng.next() * gravelZones.length)];
      const ang = rng.range(0, Math.PI * 2);
      const rad = zone.r * rng.range(1.05, 1.9);
      x = zone.x + Math.cos(ang) * rad;
      z = zone.z + Math.sin(ang) * rad;
    } else {
      x = rng.range(minX, maxX);
      z = rng.range(minZ, maxZ);
    }
    const nm = nearestMain(x, z);
    if (nm.d <= nm.halfW + 2.6) continue;
    if (nearestShort(x, z).d <= 3.2) continue;
    rockSpots.push({ x, z });
  }

  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, rockSpots.length));
  rocks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const rockBase = new THREE.Color(0x6e6459);
  for (let i = 0; i < rockSpots.length; i++) {
    const base = rng.range(0.5, 1.7);
    dummy.position.set(rockSpots[i].x, terrainHeight(rockSpots[i].x, rockSpots[i].z) + base * 0.22, rockSpots[i].z);
    dummy.rotation.set(rng.range(-0.15, 0.15), rng.range(0, Math.PI * 2), rng.range(-0.15, 0.15));
    dummy.scale.set(base * rng.range(0.8, 1.4), base * rng.range(0.45, 0.85), base * rng.range(0.8, 1.4));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    const v = rng.range(0.85, 1.15);
    rocks.setColorAt(i, tmpC.copy(rockBase).multiplyScalar(v));
  }
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.castShadow = true;
  rocks.frustumCulled = false;
  instanced.push(rocks);
  root.add(rocks);

  // ---- mountain ring ----
  const mtnGeo = new THREE.ConeGeometry(1, 1, 6);
  mtnGeo.translate(0, 0.5, 0);
  geos.push(mtnGeo);
  const mtnMat = new THREE.MeshStandardMaterial({ color: 0x7c8894, roughness: 1, flatShading: true });
  mats.push(mtnMat);
  const cx = (track.boundsMin.x + track.boundsMax.x) * 0.5;
  const cz = (track.boundsMin.z + track.boundsMax.z) * 0.5;
  const mountains = new THREE.InstancedMesh(mtnGeo, mtnMat, MOUNTAIN_COUNT);
  mountains.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  for (let k = 0; k < MOUNTAIN_COUNT; k++) {
    const ang = (k / MOUNTAIN_COUNT) * Math.PI * 2 + rng.range(-0.09, 0.09);
    const rad = 1150 + rng.range(-70, 70);
    dummy.position.set(cx + Math.cos(ang) * rad, -8, cz + Math.sin(ang) * rad);
    dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
    dummy.scale.set(rng.range(60, 140), rng.range(90, 220), rng.range(60, 140));
    dummy.updateMatrix();
    mountains.setMatrixAt(k, dummy.matrix);
  }
  mountains.frustumCulled = false;
  instanced.push(mountains);
  root.add(mountains);

  // ---- start gantry ----
  const sp = track.startPoint;
  const startPt = track.sampleAt(0);
  const halfSpan = startPt.width * 0.5 + 1.7;
  const steelParts: THREE.BufferGeometry[] = [];
  const pillarL = new THREE.BoxGeometry(0.55, 7.2, 0.55);
  pillarL.translate(-halfSpan, 3.6, 0);
  const pillarR = new THREE.BoxGeometry(0.55, 7.2, 0.55);
  pillarR.translate(halfSpan, 3.6, 0);
  const beam = new THREE.BoxGeometry(halfSpan * 2 + 0.6, 0.5, 0.75);
  beam.translate(0, 7.05, 0);
  steelParts.push(pillarL, pillarR, beam);
  const steelGeo = mergeGeometries(steelParts)!;
  geos.push(steelGeo);
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.55, metalness: 0.6 });
  mats.push(steelMat);
  const steel = new THREE.Mesh(steelGeo, steelMat);
  const gantry = new THREE.Group();
  gantry.position.set(sp.x, sp.y - 0.25, sp.z);
  gantry.rotation.y = sp.heading;
  steel.castShadow = true;

  const banTex = bannerTexture();
  texs.push(banTex);
  const banMat = new THREE.MeshBasicMaterial({ map: banTex });
  mats.push(banMat);
  const banGeo = new THREE.PlaneGeometry(halfSpan * 2 - 0.5, 1.8);
  geos.push(banGeo);
  const banner = new THREE.Mesh(banGeo, banMat);
  banner.position.set(0, 5.95, -0.06);
  banner.rotation.y = Math.PI;
  gantry.add(steel, banner);
  root.add(gantry);

  // ---- tire stacks at high-curvature apexes ----
  const tireParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const torus = new THREE.TorusGeometry(0.78, 0.34, 8, 14);
    torus.rotateX(Math.PI / 2);
    torus.translate(0, 0.34 + k * 0.66, 0);
    tireParts.push(torus);
  }
  const tireGeo = mergeGeometries(tireParts)!;
  geos.push(tireGeo);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 1 });
  mats.push(tireMat);

  const step = Math.max(1, Math.round(40 / track.spacing));
  const tireCands: { x: number; z: number }[] = [];
  for (let i = 0; i < track.points.length; i += step) {
    const p = track.points[i];
    if (Math.abs(p.curvature) <= 0.012) continue;
    const side = -Math.sign(p.curvature);
    const off = p.width * 0.5 + 2.2;
    tireCands.push({ x: p.x + p.lx * off * side, z: p.z + p.lz * off * side });
  }
  const stride = Math.max(1, Math.ceil(tireCands.length / TIRE_MAX));
  const tireSpots: { x: number; z: number }[] = [];
  for (let i = 0; i < tireCands.length && tireSpots.length < TIRE_MAX; i += stride) {
    tireSpots.push(tireCands[i]);
  }
  const tires = new THREE.InstancedMesh(tireGeo, tireMat, Math.max(1, tireSpots.length));
  tires.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  for (let i = 0; i < tireSpots.length; i++) {
    dummy.position.set(tireSpots[i].x, terrainHeight(tireSpots[i].x, tireSpots[i].z) - 0.05, tireSpots[i].z);
    dummy.rotation.set(0, rng.range(0, Math.PI * 2), rng.range(-0.04, 0.04));
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    tires.setMatrixAt(i, dummy.matrix);
  }
  tires.castShadow = true;
  tires.frustumCulled = false;
  instanced.push(tires);
  root.add(tires);

  // ---- sponsor boards along straights ----
  const atlas = brandAtlasTexture();
  texs.push(atlas);
  const boardFaceMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9 });
  mats.push(boardFaceMat);
  const boardBackMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.8, metalness: 0.3 });
  mats.push(boardBackMat);

  const faceGeos: THREE.BufferGeometry[] = [];
  const backGeos: THREE.BufferGeometry[] = [];
  const PANEL_W = 6.2;
  const PANEL_H = 1.5;
  let lastBoardDist = -1e9;
  let boardSide = 1;
  for (const p of track.points) {
    if (faceGeos.length >= BOARD_MAX) break;
    if (p.dist - lastBoardDist < 90) continue;
    if (Math.abs(p.curvature) > 0.004) continue;
    lastBoardDist = p.dist;
    boardSide = -boardSide;
    const bx = p.x + p.lx * (p.width * 0.5 + 4.6) * boardSide;
    const bz = p.z + p.lz * (p.width * 0.5 + 4.6) * boardSide;
    const gy = terrainHeight(bx, bz) - 0.05;
    const dirX = -p.lx * boardSide;
    const dirZ = -p.lz * boardSide;
    dummy.position.set(bx, gy, bz);
    dummy.rotation.set(0, Math.atan2(dirX, dirZ), 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();

    const cell = faceGeos.length % BRANDS.length;
    const face = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const uv = face.attributes.uv;
    const u0 = cell / BRANDS.length + 8 / 2048;
    const u1 = (cell + 1) / BRANDS.length - 8 / 2048;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), 0.03 + uv.getY(i) * 0.94);
    }
    face.translate(0, 1.15 + PANEL_H * 0.5, 0.07);
    face.applyMatrix4(dummy.matrix);
    faceGeos.push(face);

    const back = new THREE.BoxGeometry(PANEL_W + 0.12, PANEL_H + 0.12, 0.1);
    back.translate(0, 1.15 + PANEL_H * 0.5, 0);
    back.applyMatrix4(dummy.matrix);
    backGeos.push(back);
    const postL = new THREE.BoxGeometry(0.16, 1.2, 0.16);
    postL.translate(-PANEL_W * 0.36, 0.6, 0);
    postL.applyMatrix4(dummy.matrix);
    backGeos.push(postL);
    const postR = new THREE.BoxGeometry(0.16, 1.2, 0.16);
    postR.translate(PANEL_W * 0.36, 0.6, 0);
    postR.applyMatrix4(dummy.matrix);
    backGeos.push(postR);
  }
  if (faceGeos.length > 0 && backGeos.length > 0) {
    const facesGeo = mergeGeometries(faceGeos)!;
    const backsGeo = mergeGeometries(backGeos)!;
    geos.push(facesGeo, backsGeo);
    const faces = new THREE.Mesh(facesGeo, boardFaceMat);
    const backs = new THREE.Mesh(backsGeo, boardBackMat);
    faces.castShadow = true;
    backs.castShadow = true;
    root.add(faces, backs);
  }

  // ---- drifting cloud layer ----
  const CLOUD_COUNT = 6;
  const cloudGeo = new THREE.PlaneGeometry(1, 1);
  cloudGeo.rotateX(-Math.PI / 2);
  geos.push(cloudGeo);
  const cloudTex = cloudTexture();
  texs.push(cloudTex);
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
    fog: false,
  });
  mats.push(cloudMat);
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUD_COUNT);
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  clouds.frustumCulled = false;
  const cloudX = new Float32Array(CLOUD_COUNT);
  const cloudY = new Float32Array(CLOUD_COUNT);
  const cloudZ = new Float32Array(CLOUD_COUNT);
  const cloudS = new Float32Array(CLOUD_COUNT);
  const cloudStretch = new Float32Array(CLOUD_COUNT);
  const cloudSpeed = new Float32Array(CLOUD_COUNT);
  for (let i = 0; i < CLOUD_COUNT; i++) {
    cloudX[i] = cx + rng.range(-950, 950);
    cloudY[i] = rng.range(175, 265);
    cloudZ[i] = cz + rng.range(-950, 950);
    cloudS[i] = rng.range(280, 480);
    cloudStretch[i] = rng.range(0.55, 0.85);
    cloudSpeed[i] = rng.range(3.2, 6.0);
  }
  instanced.push(clouds);
  root.add(clouds);

  let lastMs = -1;
  let elapsed = 0;
  function update(): void {
    const now = performance.now();
    if (lastMs < 0) lastMs = now;
    const dt = Math.min(0.1, (now - lastMs) / 1000);
    lastMs = now;
    if (dt <= 0) return;
    elapsed += dt;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      let wx = cloudX[i] + elapsed * cloudSpeed[i];
      wx = (((wx + 1300) % 2600) + 2600) % 2600 - 1300;
      dummy.position.set(wx, cloudY[i], cloudZ[i]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(cloudS[i], 1, cloudS[i] * cloudStretch[i]);
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
  }

  function dispose(): void {
    root.removeFromParent();
    for (const m of instanced) m.dispose();
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) t.dispose();
    instanced.length = 0;
    geos.length = 0;
    mats.length = 0;
    texs.length = 0;
  }

  return { update, dispose };
}
