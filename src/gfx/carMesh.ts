import * as THREE from 'three';
import { VEHICLE, CAR_COLORS } from '../config';

export interface CarMesh {
  group: THREE.Group;
  wheels: THREE.Group[];
  setBrake(on: boolean): void;
  setReverse(on: boolean): void;
  /** localPoint/dirLocal in chassis space (meters); strength 0..1 */
  deform(localX: number, localY: number, localZ: number, dx: number, dy: number, dz: number, strength: number): void;
}

function paintTexture(paintHex: number, accentHex: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const paint = '#' + paintHex.toString(16).padStart(6, '0');
  const accent = '#' + accentHex.toString(16).padStart(6, '0');
  g.fillStyle = paint;
  g.fillRect(0, 0, 512, 256);
  // racing stripe pair
  g.fillStyle = accent;
  g.fillRect(236, 0, 14, 256);
  g.fillRect(262, 0, 14, 256);
  // subtle horizontal brush noise
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * 0.05;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 24, 1);
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 24, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Sculpt a dense box into an original fastback coupe silhouette. */
function hullGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(
    VEHICLE.chassisHalfExtents.x * 2,
    VEHICLE.chassisHalfExtents.y * 2 + 0.5,
    VEHICLE.chassisHalfExtents.z * 2,
    12, 8, 20
  );
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const hw = (z: number): number => {
    const t = Math.abs(z) / VEHICLE.chassisHalfExtents.z; // 0..1
    let w = 0.98 - 0.10 * t;
    if (z > 0) w -= 0.10 * Math.max(0, (z - 0.6) / VEHICLE.chassisHalfExtents.z); // narrower nose
    return w * VEHICLE.chassisHalfExtents.x;
  };
  const topY = (z: number): number => {
    const L = VEHICLE.chassisHalfExtents.z;
    // cabin peak just behind center
    if (z >= -1.05 && z <= 0.55) {
      const t = 1 - Math.abs(z - (-0.25)) / 1.35; // 1 at peak
      return 0.42 + 0.42 * Math.max(0, t);
    }
    if (z > 0.55) {
      const t = Math.min(1, (z - 0.55) / (L - 0.55)); // windshield slope to nose
      return 0.42 + 0.06 * (1 - t) - 0.20 * t;
    }
    const t = Math.min(1, (-z - 1.05) / (L - 1.05)); // rear deck
    return 0.42 - 0.08 * t;
  };
  const botY = (z: number): number => -0.48 + (z > 1.4 ? 0.04 : 0) + (z < -1.6 ? 0.03 : 0);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ty = topY(z), by = botY(z);
    const ny = by + (ty - by) * ((y + 0.57) / 1.14);
    const w = hw(z);
    const nx = Math.sign(x || 1) * w * (Math.abs(x) / VEHICLE.chassisHalfExtents.x);
    pos.setXYZ(i, nx, Math.min(ny, ty + 0.001), z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function wheelMesh(accentHex: number): THREE.Group {
  const grp = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(VEHICLE.wheelRadius, VEHICLE.wheelRadius, VEHICLE.wheelWidth, 18, 1);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(
    tireGeo,
    new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 })
  );
  tire.castShadow = true;
  const hubGeo = new THREE.CylinderGeometry(VEHICLE.wheelRadius * 0.55, VEHICLE.wheelRadius * 0.55, VEHICLE.wheelWidth + 0.02, 12, 1);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(
    hubGeo,
    new THREE.MeshStandardMaterial({ color: accentHex, metalness: 0.75, roughness: 0.32 })
  );
  grp.add(tire, hub);
  return grp;
}

export function buildCarMesh(colorIndex: number): CarMesh {
  const col = CAR_COLORS[colorIndex % CAR_COLORS.length];
  const group = new THREE.Group();

  const hullGeo = hullGeometry();
  const hullMat = new THREE.MeshStandardMaterial({
    map: paintTexture(col.paint, col.accent),
    metalness: 0.35,
    roughness: 0.38,
  });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = true;
  group.add(hull);

  // glass canopy
  const glassGeo = new THREE.BoxGeometry(1.5, 0.34, 1.55, 2, 1, 4);
  glassGeo.translate(0, 0.62, -0.28);
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.MeshStandardMaterial({ color: 0x0e141b, metalness: 0.6, roughness: 0.12 })
  );
  glass.scale.z = 0.82;
  glass.position.y = -0.02;
  group.add(glass);

  // splitter + diffuser + wing
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.6 });
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.07, 0.5), trimMat);
  splitter.position.set(0, -0.44, 2.0);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.06, 0.36), trimMat);
  wing.position.set(0, 0.52, -2.05);
  const struts = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.08), trimMat);
  struts.position.set(0, 0.42, -2.02);
  group.add(splitter, wing, struts);

  // lights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6da, emissive: 0xfff1bd, emissiveIntensity: 1.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2200, emissiveIntensity: 0.35 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.06), headMat);
    hl.position.set(sx * 0.56, 0.02, VEHICLE.chassisHalfExtents.z - 0.02);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.06), tailMat);
    tl.position.set(sx * 0.54, 0.1, -VEHICLE.chassisHalfExtents.z + 0.02);
    group.add(tl);
  }

  const wheels: THREE.Group[] = [];
  for (const wp of VEHICLE.wheelPositions) {
    const w = wheelMesh(col.accent);
    w.position.set(wp.x, -VEHICLE.suspensionRestLength, wp.z);
    group.add(w);
    wheels.push(w);
  }

  const orig = (hullGeo.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array;
  const accum = new Float32Array(hullGeo.attributes.position.count * 3);

  return {
    group,
    wheels,
    setBrake(on: boolean) {
      tailMat.emissiveIntensity = on ? 3.2 : 0.35;
    },
    setReverse(on: boolean) {
      headMat.emissiveIntensity = on ? 0.4 : 1.6;
    },
    deform(lx, ly, lz, dx, dy, dz, strength) {
      const posAttr = hullGeo.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const R = 1.05;
      const s = Math.min(1, strength) * 0.26;
      let touched = false;
      for (let i = 0; i < posAttr.count; i++) {
        const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
        const ddx = ox - lx, ddy = oy - ly, ddz = oz - lz;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > R * R) continue;
        const fall = 1 - Math.sqrt(d2) / R;
        const k = fall * fall * s;
        accum[i * 3] += dx * k; accum[i * 3 + 1] += dy * k; accum[i * 3 + 2] += dz * k;
        // clamp total displacement
        const ax = accum[i * 3], ay = accum[i * 3 + 1], az = accum[i * 3 + 2];
        const m = Math.hypot(ax, ay, az);
        const cap = 0.24;
        const f = m > cap ? cap / m : 1;
        arr[i * 3] = ox + ax * f;
        arr[i * 3 + 1] = oy + ay * f;
        arr[i * 3 + 2] = oz + az * f;
        touched = true;
      }
      if (touched) {
        posAttr.needsUpdate = true;
        hullGeo.computeVertexNormals();
      }
    },
  };
}

