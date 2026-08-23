import type {
  AIDriver,
  CarProgress,
  RaceSnapshot,
  TrackData,
  VehicleControls,
  VehicleLike,
} from '../types';
import { AI, RACE, VEHICLE } from '../config';
import { Emitter } from '../core/events';

export interface RaceEvents {
  lapCompleted: { id: number; lap: number; lapTime: number; best: boolean };
  raceFinished: { standings: CarProgress[] };
  wrongWay: { id: number; on: boolean };
  autoReset: { id: number };
}

interface CarTracker extends CarProgress {
  prevRawDist: number;
  nextCheckpoint: number;
  lapStartTime: number;
  lastLap: number;
  bestLap: number;
  wrongWayTimer: number;
  wrongWayOn: boolean;
  flipTimer: number;
  wedgedTimer: number;
  stagTimer: number;
  strayTimer: number;
  progCheckTimer: number;
  lastProgValue: number;
  lastX: number;
  lastZ: number;
}

const ZERO: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const COAST: VehicleControls = { throttle: 0, brake: 0.3, steer: 0, handbrake: true };

export class RaceManager {
  events = new Emitter<RaceEvents>();
  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  raceTime = 0;

  private countdownLeft: number;
  private trackers: CarTracker[];
  private lapsTotal: number;
  private finishedAnnounced = false;
  private cpsAbsCache: number[] | null = null;

  constructor(
    public readonly track: TrackData,
    private vehicles: VehicleLike[],
    private drivers: (AIDriver | null)[],
    private playerId: number,
    lapsTotal: number = RACE.lapsTotal,
    countdownSeconds: number = RACE.countdownSeconds
  ) {
    this.lapsTotal = lapsTotal;
    this.countdownLeft = countdownSeconds;
    this.trackers = vehicles.map((v) => {
      const p = track.project(v.state.x, v.state.z);
      return {
        id: v.id,
        state: v.state,
        dist: p.dist,
        lap: 0,
        totalProgress: p.dist,
        finished: false,
        finishTime: Infinity,
        // grids sit BEFORE the start line; mod-space gating handles the first
        // crossing naturally (it carries no checkpoint credits -> not a lap)
        prevRawDist: p.dist,
        nextCheckpoint: 0,
        lapStartTime: 0,
        lastLap: 0,
        bestLap: Infinity,
        wrongWayTimer: 0,
        wrongWayOn: false,
        flipTimer: 0,
        wedgedTimer: 0,
        stagTimer: 0,
        strayTimer: 0,
        progCheckTimer: 0,
        lastProgValue: p.dist,
        lastX: v.state.x,
        lastZ: v.state.z,
      };
    });
  }

  /** Physics-rate tick: decides controls per car, then advances timing/progress logic. */
  fixedUpdate(dt: number, playerControls: VehicleControls): void {
    const n = this.vehicles.length;

    if (this.phase === 'countdown') {
      this.countdownLeft -= dt;
      for (let i = 0; i < n; i++) this.vehicles[i].applyControls(ZERO);
      if (this.countdownLeft <= 0) this.phase = 'racing';
      return;
    }
    if (this.phase === 'finished') {
      for (let i = 0; i < n; i++) {
        const t = this.trackers[i];
        this.vehicles[i].applyControls(t.finished ? COAST : ZERO);
      }
      return;
    }

    this.raceTime += dt;
    const progress = this.progressList(); // shared this tick
    const speeds = this.computeRubberBands(progress);

    for (let i = 0; i < n; i++) {
      const veh = this.vehicles[i];
      const t = this.trackers[i];
      if (t.finished) {
        veh.applyControls(COAST);
        continue;
      }
      const drv = this.drivers[i];
      if (drv) veh.applyControls(drv.update(dt, progress, veh.id, this.track, speeds[i]));
      else veh.applyControls(playerControls);
    }
  }

  /** Called by the sim loop AFTER world.step so states are fresh. */
  postStep(dt: number): void {
    if (!this.cpsAbsCache) {
      this.cpsAbsCache = this.track.checkpointFracs.map((f) => f * this.track.length);
    }
    const cpsAbs = this.cpsAbsCache;
    const L = this.track.length;

    for (let i = 0; i < this.trackers.length; i++) {
      const t = this.trackers[i];
      t.state = this.vehicles[i].state;
      const st = t.state;
      const raw = this.track.project(st.x, st.z);

      let delta = raw.dist - t.prevRawDist;
      if (delta > L / 2) delta -= L;
      else if (delta < -L / 2) delta += L;
      const prevMod = t.dist;
      if (Math.abs(delta) < L / 4) {
        // integrate in mod space
        t.dist = ((prevMod + delta) % L + L) % L;
      }
      t.prevRawDist = raw.dist;
      t.totalProgress = t.lap * L + t.dist;

      if (this.phase !== 'racing') continue;

      const nowMod = t.dist;

      // forward crossings of each gate between prevMod -> nowMod
      const crossedForward = (target: number): boolean => {
        if (delta <= 0) return false;
        if (prevMod < target && nowMod >= target) return true;
        // wrapped through 0 this step
        if (nowMod < prevMod) return prevMod < target || nowMod >= target;
        return false;
      };

      while (
        t.nextCheckpoint < cpsAbs.length &&
        crossedForward(cpsAbs[t.nextCheckpoint])
      ) {
        t.nextCheckpoint++;
      }

      // start line (target 0): treat any forward wrap through 0
      let wrappedForward = delta > 0 && nowMod < prevMod;
      if (wrappedForward) {
        if (t.nextCheckpoint >= cpsAbs.length) {
          const lapTime = this.raceTime - t.lapStartTime;
          t.lastLap = lapTime;
          const best = lapTime < t.bestLap;
          if (best) t.bestLap = lapTime;
          t.lap++;
          t.lapStartTime = this.raceTime;
          t.nextCheckpoint = 0;
          if (!t.finished) {
            this.events.emit('lapCompleted', { id: t.id, lap: t.lap, lapTime, best });
            if (t.lap >= this.lapsTotal) {
              t.finished = true;
              t.finishTime = this.raceTime;
              this.checkAllFinished();
            }
          } else {
            t.lap = this.lapsTotal;
          }
        }
      }

      // wrong way
      const tan = this.track.sampleAt(t.dist);
      const vdot = st.vx * tan.tx + st.vz * tan.tz;
      if (vdot < -2 && st.speed > 2.5) {
        t.wrongWayTimer += dt;
        if (t.wrongWayTimer > RACE.wrongWayGrace && !t.wrongWayOn) {
          t.wrongWayOn = true;
          this.events.emit('wrongWay', { id: t.id, on: true });
        }
      } else if (t.wrongWayOn) {
        t.wrongWayTimer -= dt * 3;
        if (t.wrongWayTimer <= 0) {
          t.wrongWayOn = false;
          this.events.emit('wrongWay', { id: t.id, on: false });
        }
      } else {
        t.wrongWayTimer = Math.max(0, t.wrongWayTimer - dt);
      }

      // kill floor: fell off the world -> instant recovery
      // (shortcut corridor descends below main-loop elevation; exempt it)
      const roadYHere = this.track.sampleAt(t.dist).y;
      let onShortcut = false;
      if (this.track.shortcutPath.length > 1) {
        const sp = this.track.shortcutPath;
        for (let q = 0; q + 1 < sp.length; q++) {
          const ax = sp[q].x;
          const az = sp[q].z;
          const bx = sp[q + 1].x;
          const bz = sp[q + 1].z;
          const abx = bx - ax;
          const abz = bz - az;
          const l2 = abx * abx + abz * abz || 1e-9;
          let tt = ((st.x - ax) * abx + (st.z - az) * abz) / l2;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          if (Math.hypot(st.x - (ax + abx * tt), st.z - (az + abz * tt)) < 14) {
            onShortcut = true;
            break;
          }
        }
      }
      if (!onShortcut && st.y < roadYHere - 8) {
        this.respawn(i);
        continue;
      }

      // progress stagnation: racing car gaining <12m over 10s is stuck somehow
      t.progCheckTimer += dt;
      if (t.progCheckTimer >= 10) {
        if (t.totalProgress - t.lastProgValue < 12 && this.drivers[i] !== null) {
          this.respawn(i);
          t.progCheckTimer = 0;
          t.lastProgValue = t.totalProgress;
          continue;
        }
        t.progCheckTimer = 0;
        t.lastProgValue = t.totalProgress;
      }

      // flip / wedge recovery
      t.flipTimer = st.upDot < 0.15 ? t.flipTimer + dt : 0;
      const wedged = st.speed < 0.35 && Math.abs(st.forwardSpeed) < 0.25 && st.upDot >= 0.15;
      t.wedgedTimer = wedged ? t.wedgedTimer + dt : 0;
      // stray: way off the roadway for too long -> respawn on track
      // (grace > AI's own recovery timer so recovery gets first chance)
      const hwHere = this.track.sampleAt(t.dist).width * 0.5;
      if (Math.abs(raw.lateral) > hwHere + 2.5) t.strayTimer += dt;
      else t.strayTimer = 0;
      if (t.strayTimer > 3.6 && this.phase === 'racing') {
        this.respawn(i);
        continue;
      }
      // stagnation: driver-active car that barely moved over the window is wedged
      t.stagTimer += dt;
      if (t.stagTimer >= 4) {
        const moved = Math.hypot(st.x - t.lastX, st.z - t.lastZ);
        if (moved < 1.5 && this.drivers[i] !== null) {
          t.wedgedTimer = 99;
        }
        t.stagTimer = 0;
        t.lastX = st.x;
        t.lastZ = st.z;
      }
      if (t.flipTimer > VEHICLE.resetIfFlippedFor || t.wedgedTimer > (this.drivers[i] !== null ? 5.5 : 8)) {
        this.respawn(i);
      }
    }
  }

  respawnById(id: number): void {
    const i = this.trackers.findIndex((t) => t.id === id);
    if (i >= 0) this.respawn(i);
  }

  respawn(i: number): void {
    const t = this.trackers[i];
    const sample = this.track.sampleAt(t.dist + 4);
    const cx = sample.x;
    const cz = sample.z;
    const heading = Math.atan2(sample.tx, sample.tz);
    this.vehicles[i].resetTo(cx, sample.y + 1.2, cz, heading);
    t.flipTimer = 0;
    t.wedgedTimer = 0;
    t.dist = this.track.project(cx, cz).dist;
    t.prevRawDist = t.dist;
    this.events.emit('autoReset', { id: t.id });
  }

  private computeRubberBands(progress: CarProgress[]): number[] {
    const speeds = new Array(this.trackers.length).fill(1);
    const list = progress;
    const player = list.find((c) => c.id === this.playerId);
    if (!player) return speeds;
    for (let i = 0; i < this.trackers.length; i++) {
      const t = this.trackers[i];
      if (t.id === this.playerId) continue;
      const gap = player.totalProgress - t.totalProgress; // >0: AI behind player
      const clamped = Math.max(-AI.rubberBandRange, Math.min(AI.rubberBandRange, gap));
      speeds[i] = 1 + AI.rubberBandMax * (clamped / AI.rubberBandRange);
    }
    return speeds;
  }

  progressList(): CarProgress[] {
    const arr: CarProgress[] = this.trackers.map((t) => ({
      id: t.id,
      state: t.state,
      dist: t.dist,
      lap: t.lap,
      totalProgress: t.totalProgress,
      finished: t.finished,
      finishTime: t.finishTime,
    }));
    arr.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.totalProgress - a.totalProgress;
    });
    return arr;
  }

  snapshot(): RaceSnapshot {
    return {
      phase: this.phase,
      time: this.phase === 'countdown' ? -this.countdownLeft : this.raceTime,
      countdown: this.phase === 'countdown' ? Math.max(0, Math.ceil(this.countdownLeft)) : 0,
      cars: this.progressList(),
      playerFinished: this.playerFinished(),
      lapsTotal: this.lapsTotal,
    };
  }

  playerFinished(): boolean {
    const t = this.trackers.find((x) => x.id === this.playerId);
    return !!t && t.finished;
  }

  trackerFor(id: number): { bestLap: number; lastLap: number; lap: number; currentLapElapsed: number } | undefined {
    const t = this.trackers.find((x) => x.id === id);
    if (!t) return undefined;
    return {
      bestLap: t.bestLap,
      lastLap: t.lastLap,
      lap: t.lap,
      currentLapElapsed: this.raceTime - t.lapStartTime,
    };
  }

  private checkAllFinished(): void {
    // End the race shortly after the player finishes even if AIs are still out.
    if (!this.finishedAnnounced && this.playerFinished()) {
      this.finishedAnnounced = true;
      this.phase = 'finished';
      // estimate remaining positions by progress
      this.events.emit('raceFinished', { standings: this.progressList() });
    }
  }
}
