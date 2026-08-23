import * as THREE from 'three';
import { createScene, followSunWith } from './gfx/scene';
import { buildTrackMesh } from './gfx/trackMesh';
import { buildEnvironment } from './gfx/environment';
import { buildCarMesh, type CarMesh } from './gfx/carMesh';
import { CameraRig } from './gfx/camera';
import { ParticleSystem } from './gfx/particles';
import { SkidMarkSystem } from './gfx/skidmarks';
import { GameAudio } from './audio/audio';
import { InputSystem } from './core/input';
import { createPhysicsWorld, worldMaterials } from './sim/world';
import { RaceManager } from './sim/race';
import { buildTrack, buildRoadbedBody } from './sim/track';
import { createVehicle, type Vehicle } from './sim/vehicle';
import { createAIDriver } from './sim/ai';
import { createHud, ensureUiStyles } from './ui/hud';
import { createMinimap } from './ui/minimap';
import { createMenu, type MenuSettings } from './ui/menu';
import { createResults, type ResultsRow } from './ui/results';
import { AI, CAR_COLORS, GFX, PHYSICS, RACE, VEHICLE } from './config';
import type { AIDriver, CarProgress, SurfaceId, TrackData } from './types';
import * as CANNON from 'cannon-es';

type AppState = 'menu' | 'racing' | 'results';

const settings: MenuSettings = { masterVolume: 0.75, postFx: true, shadows: true };

const canvas = document.getElementById('app') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
ensureUiStyles();

const kit = createScene(canvas);
kit.setPostFx(settings.postFx);

const track: TrackData = buildTrack();
buildTrackMesh(kit.scene, track);
buildEnvironment(kit.scene, track);

const world = createPhysicsWorld();
const { chassisMat, worldMat } = worldMaterials(world);

const roadbed = buildRoadbedBody(track);
roadbed.material = worldMat;
world.addBody(roadbed);

// terrain safety net far below the circuit
const net = new CANNON.Body({ mass: 0, material: worldMat });
net.addShape(new CANNON.Plane());
net.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
net.position.set(0, -30, 0);
world.addBody(net);

for (const spec of track.colliderSpecs) {
  const b = new CANNON.Body({ mass: 0, material: worldMat });
  b.addShape(new CANNON.Box(new CANNON.Vec3(spec.hx, spec.hy, spec.hz)));
  b.position.set(spec.x, spec.y, spec.z);
  const q = new CANNON.Quaternion();
  q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spec.yaw);
  b.quaternion.copy(q);
  world.addBody(b);
}

const audio = new GameAudio();
const rig = new CameraRig(kit.camera);
const particles = new ParticleSystem(kit.scene);
const skids = new SkidMarkSystem(kit.scene);

const hud = createHud(uiRoot);
hud.setVisible(false);
const minimap = createMinimap(uiRoot);
minimap.setVisible(false);
const menu = createMenu(uiRoot, { onStart: () => startRace }, settings);
menu.show();
const results = createResults(uiRoot, {
  onRematch: () => {
    results.hide();
    startRace();
  },
  onMenu: () => {
    results.hide();
    teardownRace();
    enterMenu();
  },
});

let vehicles: Vehicle[] = [];
let meshes: CarMesh[] = [];
let race: RaceManager | null = null;
let state: AppState = 'menu';
let paused = false;
let wrongWay = false;
let lastCountdown = -1;
const input = new InputSystem();

const aiSkills = AI.skillSpread;
const aiNames = [CAR_COLORS[1].name, CAR_COLORS[2].name, CAR_COLORS[3].name];

function startRace(): void {
  for (const v of vehicles) v.removeFromWorld(world);
  vehicles = [];
  for (const m of meshes) {
    kit.scene.remove(m.group);
  }
  meshes = [];

  const slots = track.gridSlots;
  const lineup: Array<{ slot: number; isPlayer: boolean; skill: number }> = [
    { slot: 0, isPlayer: false, skill: aiSkills[2] },
    { slot: 1, isPlayer: false, skill: aiSkills[1] },
    { slot: 2, isPlayer: false, skill: aiSkills[0] },
    { slot: 3, isPlayer: true, skill: 0 },
  ];
  let aiIdx = 0;
  for (let i = 0; i < lineup.length; i++) {
    const entry = lineup[i];
    const carId = entry.isPlayer ? 0 : 1 + aiIdx++;
    const slot = slots[entry.slot];
    const v = createVehicle({
      id: carId,
      world,
      track,
      spawnX: slot.x,
      spawnY: slot.y,
      spawnZ: slot.z,
      heading: slot.heading,
    });
    v.addToWorld(world);
    v.resetDamage();
    vehicles.push(v);
    const mesh = buildCarMesh(carId % CAR_COLORS.length);
    kit.scene.add(mesh.group);
    meshes.push(mesh);
  }

  const drivers: (AIDriver | null)[] = vehicles.map((v) =>
    v.id === 0 ? null : createAIDriver(v.id, aiSkills[(v.id - 1) % aiSkills.length])
  );
  race = new RaceManager(track, vehicles, drivers, 0, RACE.lapsTotal, RACE.countdownSeconds);
  race.events.on('lapCompleted', ({ id, lap }) => {
    if (!race || race.phase !== 'racing') return;
    if (id === 0) {
      if (lap >= RACE.lapsTotal - 1) audio.beep('final');
      else audio.beep('lap');
    }
  });
  race.events.on('wrongWay', ({ id, on }) => {
    if (id === 0) wrongWay = on;
  });
  race.events.on('raceFinished', ({ standings }) => {
    showResults(standings);
  });

  minimap.drawStatic(track);
  minimap.setVisible(true);
  hud.setVisible(true);
  wrongWay = false;
  lastCountdown = -1;
  rig.mode = 'chase';
  rig.snapBehind();
  state = 'racing';
  paused = false;
}

function teardownRace(): void {
  for (const v of vehicles) v.removeFromWorld(world);
  for (const m of meshes) kit.scene.remove(m.group);
  vehicles = [];
  meshes = [];
  race = null;
  hud.setVisible(false);
  minimap.setVisible(false);
}

function enterMenu(): void {
  state = 'menu';
  menu.show();
}

function showResults(standings: CarProgress[]): void {
  state = 'results';
  audio.beep('finish');
  const rows: ResultsRow[] = standings.map((c, i) => {
    const t = race?.trackerFor(c.id);
    return {
      pos: i + 1,
      name: c.id === 0 ? 'YOU' : aiNames[(c.id - 1) % aiNames.length],
      isPlayer: c.id === 0,
      bestLapMs: t && Number.isFinite(t.bestLap) ? t.bestLap * 1000 : null,
      totalTimeMs: c.finished ? c.finishTime * 1000 : null,
      status: c.finished ? 'finished' : 'dnf',
    };
  });
  const playerPos = rows.find((r) => r.isPlayer)?.pos ?? standings.length;
  results.show(rows, `P${playerPos} — RACE COMPLETE`);
}

function respawnPlayer(): void {
  race?.respawnById(0);
}

window.addEventListener('resize', () => kit.resize(window.innerWidth, window.innerHeight));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'racing' && !paused) setPaused(true);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function setPaused(p: boolean): void {
  paused = p;
  pauseEl.style.display = p ? 'flex' : 'none';
  if (p) audio.suspend();
  else audio.resume();
}

const pauseEl = document.createElement('div');
pauseEl.style.cssText =
  'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,7,10,0.72);pointer-events:auto;z-index:30;';
pauseEl.innerHTML = `
  <div style="background:rgba(12,14,18,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:28px 40px;text-align:center;">
    <div style="font-size:22px;font-weight:700;letter-spacing:.14em;margin-bottom:18px;">PAUSED</div>
    <button data-a="resume" style="display:block;width:220px;margin:6px auto;padding:10px;background:#c8452c;color:#fff;border:none;border-radius:5px;font-size:14px;letter-spacing:.08em;cursor:pointer;">RESUME</button>
    <button data-a="restart" style="display:block;width:220px;margin:6px auto;padding:10px;background:#22262e;color:#ddd;border:1px solid rgba(255,255,255,0.14);border-radius:5px;font-size:14px;letter-spacing:.08em;cursor:pointer;">RESTART RACE</button>
    <button data-a="quit" style="display:block;width:220px;margin:6px auto;padding:10px;background:#22262e;color:#ddd;border:1px solid rgba(255,255,255,0.14);border-radius:5px;font-size:14px;letter-spacing:.08em;cursor:pointer;">QUIT TO MENU</button>
  </div>`;
uiRoot.appendChild(pauseEl);
pauseEl.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).dataset?.a;
  if (a === 'resume') setPaused(false);
  else if (a === 'restart') {
    setPaused(false);
    startRace();
  } else if (a === 'quit') {
    setPaused(false);
    teardownRace();
    enterMenu();
  }
});

const scratchQ = new THREE.Quaternion();
const scratchQ2 = new THREE.Quaternion();
const scratchYAxis = new THREE.Vector3(0, 1, 0);
const scratchV = new THREE.Vector3();
const scratchV2 = new THREE.Vector3();
const invQ = new THREE.Quaternion();
const prevSkid = new Map<number, { x: number; y: number; z: number }>();
let menuOrbitT = 0;

function emitCarEffects(v: Vehicle, density: number): void {
  const st = v.state;
  for (let w = 0; w < 4; w++) {
    const wt = st.wheels[w];
    if (!wt.contact || st.speed < 3) {
      prevSkid.delete(v.id * 4 + w);
      continue;
    }
    const hard = wt.surface === 'tarmac' || wt.surface === 'kerb';
    if (hard && wt.skidIntensity > 0.42) {
      const key = v.id * 4 + w;
      const prev = prevSkid.get(key);
      if (prev) {
        const dx = wt.worldX - prev.x, dz = wt.worldZ - prev.z;
        if (dx * dx + dz * dz < 9 && dx * dx + dz * dz > 1e-6) {
          skids.addSegment(
            (v.id * 4 + w) as 0 | 1 | 2 | 3,
            prev.x, prev.y, prev.z,
            wt.worldX, wt.worldY, wt.worldZ,
            wt.skidIntensity
          );
          prev.x = wt.worldX; prev.y = wt.worldY; prev.z = wt.worldZ;
        }
      } else {
        prevSkid.set(key, { x: wt.worldX, y: wt.worldY, z: wt.worldZ });
      }
      if (st.speed > 10 && Math.random() < 0.5 * density) {
        particles.emit('smoke', {
          x: wt.worldX, y: wt.worldY + 0.15, z: wt.worldZ,
          vx: st.vx * 0.25, vy: 0.6, vz: st.vz * 0.25,
          count: 1, spread: 0.4, size: [0.35, 0.8], life: [0.5, 0.9],
        });
      }
    } else if (!hard) {
      prevSkid.delete(v.id * 4 + w);
      if (st.speed > 5 && Math.random() < density * Math.min(1, st.speed / 20)) {
        const kind = wt.surface === 'gravel' ? 'gravel' : 'dust';
        particles.emit(kind, {
          x: wt.worldX, y: wt.worldY + 0.1, z: wt.worldZ,
          vx: -st.vx * 0.3, vy: 1.2 + st.speed * 0.04, vz: -st.vz * 0.3,
          count: 2, spread: 0.5, size: [0.25, 0.65], life: [0.4, 1.0],
        });
      }
    } else if (wt.skidIntensity <= 0.42) {
      prevSkid.delete(v.id * 4 + w);
    }
  }
}

function surfaceMajority(v: Vehicle): SurfaceId {
  const counts: Partial<Record<SurfaceId, number>> = {};
  let best: SurfaceId = 'tarmac';
  let bestN = 0;
  for (const wt of v.state.wheels) {
    if (!wt.contact) continue;
    const n = (counts[wt.surface] ?? 0) + 1;
    counts[wt.surface] = n;
    if (n > bestN) {
      bestN = n;
      best = wt.surface;
    }
  }
  return best;
}

function syncCarVisual(v: Vehicle, mesh: CarMesh): void {
  const st = v.state;
  mesh.group.position.set(st.x, st.y + Math.abs(VEHICLE.comYOffset), st.z);
  mesh.group.quaternion.set(st.qx, st.qy, st.qz, st.qw);
  for (let w = 0; w < 4; w++) {
    const vis = v.getWheelVisual(w);
    const wm = mesh.wheels[w];
    wm.position.set(vis.x - mesh.group.position.x, vis.y - mesh.group.position.y, vis.z - mesh.group.position.z);
    scratchQ.set(st.qx, st.qy, st.qz, st.qw).invert();
    scratchQ2.setFromAxisAngle(scratchYAxis, -vis.steer);
    wm.quaternion.copy(scratchQ).multiply(scratchQ2);
    wm.rotateX(vis.spin);
  }
  const ctrl = v.getControlsSnapshot();
  mesh.setBrake(ctrl.brake > 0.08 || ctrl.handbrake);
  mesh.setReverse(ctrl.brake > 0.5 && st.forwardSpeed < -0.2);
}

function frame(dtFrameRaw: number): void {
  requestAnimationFrame(frame);
  const dtFrame = Math.min(dtFrameRaw, 0.1);

  if (state !== 'racing' || !race) {
    // idle orbit over start line while in menus
    menuOrbitT += dtFrame;
    const sp = track.startPoint;
    rig.mode = 'orbit';
    rig.setTarget({
      id: 0, x: sp.x, y: sp.y, z: sp.z,
      qx: 0, qy: 0, qz: 0, qw: 1,
      vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
      speed: 0, forwardSpeed: 0, rpm: 800, gear: 1,
      bodyRoll: 0, bodyPitch: 0, damage: 0, upDot: 1,
      wheels: [],
    });
    rig.update(dtFrame);
    kit.renderFrame();
    return;
  }

  const fi = input.sample();
  if (fi.pausePressed) setPaused(!paused);
  if (paused) {
    kit.renderFrame();
    return;
  }
  if (fi.cameraTogglePressed) {
    rig.mode = rig.mode === 'chase' ? 'hood' : rig.mode === 'hood' ? 'orbit' : 'chase';
    rig.snapBehind();
  }
  if (fi.resetPressed) respawnPlayer();

  let steps = 0;
  acc += dtFrame;
  const fixedDt = PHYSICS.fixedDt;
  let playerCtrl = { throttle: fi.throttle, brake: fi.brake, steer: fi.steer, handbrake: fi.handbrake };
  while (acc >= fixedDt && steps < PHYSICS.maxSubSteps) {
    race.fixedUpdate(fixedDt, playerCtrl);
    for (const v of vehicles) v.fixedUpdate(fixedDt);
    world.step(fixedDt);
    for (const v of vehicles) v.postStep(fixedDt);
    race.postStep(fixedDt);
    acc -= fixedDt;
    steps++;
  }
  if (steps === PHYSICS.maxSubSteps) acc = 0;

  // impacts → feedback
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const impacts = v.consumeImpacts();
    if (!impacts.length) continue;
    const s = v.state;
    invQ.set(s.qx, s.qy, s.qz, s.qw).invert();
    let sum = 0;
    for (const im of impacts) {
      sum += im.impulse;
      scratchV.set(im.x - s.x, im.y - s.y, im.z - s.z).applyQuaternion(invQ);
      scratchV2.set(im.nx, im.ny, im.nz).applyQuaternion(invQ);
      meshes[i].deform(scratchV.x, scratchV.y, scratchV.z, scratchV2.x, scratchV2.y, scratchV2.z, im.impulse / 26000);
      if (im.impulse > 6000 && Math.random() < 0.8) {
        particles.emit('spark', {
          x: im.x, y: im.y, z: im.z,
          vx: s.vx * 0.3, vy: 2, vz: s.vz * 0.3,
          count: Math.min(14, Math.floor(im.impulse / 2500)), spread: 1.2,
          size: [0.08, 0.22], life: [0.15, 0.45],
        });
      }
    }
    if (i === 0 && sum > 0) {
      rig.reportImpacts(sum);
      audio.impact(Math.min(1, sum / 30000));
    }
  }

  // visuals & effects
  const player = vehicles[0];
  for (let i = 0; i < vehicles.length; i++) {
    syncCarVisual(vehicles[i], meshes[i]);
    emitCarEffects(vehicles[i], i === 0 ? 1 : 0.55);
  }
  particles.update(dtFrame);
  skids.update(dtFrame);

  // camera + postfx
  rig.setTarget(player.state);
  rig.update(dtFrame);
  kit.fx.chromatic = rig.fx.chromatic;
  kit.fx.speedBlur = rig.fx.speedBlur;
  kit.fx.flash = rig.fx.flash;
  followSunWith(kit, player.state.x, player.state.y, player.state.z);

  // audio
  const ps = player.state;
  let contacts = 0;
  let slipMax = 0;
  for (const wt of ps.wheels) {
    if (wt.contact) contacts++;
    slipMax = Math.max(slipMax, wt.skidIntensity > 0 ? wt.slip : 0);
  }
  audio.update(dtFrame, {
    rpm01: Math.max(0, Math.min(1, (ps.rpm - VEHICLE.idleRpm) / (VEHICLE.redlineRpm - VEHICLE.idleRpm))),
    throttle: player.getControlsSnapshot().throttle,
    load: player.getControlsSnapshot().throttle,
    speed01: Math.min(1, ps.speed / 62),
    slipMax,
    handbrake: player.getControlsSnapshot().handbrake,
    surface: surfaceMajority(player),
    airborne: contacts < 2,
  });

  // HUD
  const snap = race.snapshot();
  if (snap.phase === 'countdown' && snap.countdown !== lastCountdown) {
    lastCountdown = snap.countdown;
    if (snap.countdown > 0) audio.beep('count');
  } else if (snap.phase === 'racing' && lastCountdown > 0) {
    lastCountdown = 0;
    audio.beep('go');
  }
  const list = snap.cars;
  const posIdx = list.findIndex((c) => c.id === 0);
  const tracker = race.trackerFor(0);
  const leaderProgress = list[0]?.totalProgress ?? 0;
  const standingRows = list.map((c, idx) => {
    const name = c.id === 0 ? 'YOU' : aiNames[(c.id - 1) % aiNames.length];
    const gapM = leaderProgress - c.totalProgress;
    const gapText = idx === 0 ? 'LEADER' : gapM < 400 ? `+${gapM.toFixed(0)}m` : `+${(gapM / 1000).toFixed(2)}km`;
    return { id: c.id, name, isPlayer: c.id === 0, gapText, lapText: `${Math.min(c.lap + 1, snap.lapsTotal)}/${snap.lapsTotal}` };
  });
  hud.update({
    phase: snap.phase,
    countdownNumber: snap.countdown,
    speedKmh: ps.speed * 3.6,
    rpm01: Math.max(0, Math.min(1, (ps.rpm - VEHICLE.idleRpm) / (VEHICLE.redlineRpm - VEHICLE.idleRpm))),
    gear: ps.gear,
    lap: tracker ? tracker.lap : 0,
    lapsTotal: snap.lapsTotal,
    position: posIdx + 1,
    totalCars: list.length,
    curLapMs: tracker && snap.phase === 'racing' ? tracker.currentLapElapsed * 1000 : 0,
    lastLapMs: tracker && tracker.lastLap > 0 ? tracker.lastLap * 1000 : null,
    bestLapMs: tracker && Number.isFinite(tracker.bestLap) ? tracker.bestLap * 1000 : null,
    wrongWay,
    damage01: ps.damage,
    standingRows,
  });
  void posIdx;
  minimap.drawFrame(list);

  kit.renderFrame();
}

let acc = 0;
let last = performance.now();
function tick(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  frame(dt);
}
requestAnimationFrame(tick);

void GFX;
void chassisMat;
