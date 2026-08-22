import type {
  AIDriver,
  CarProgress,
  RaceSnapshot,
  TrackData,
  VehicleControls,
  VehicleLike,
} from '../types';
import { RACE } from '../config';
import { Emitter } from '../core/events';

export interface RaceEvents {
  lapCompleted: { id: number; lap: number; lapTime: number; best: boolean };
  raceFinished: { standings: CarProgress[] };
  wrongWay: { id: number; on: boolean };
  autoReset: { id: number };
}

interface CarTracker extends CarProgress {
  unwrapped: number; // monotonic-ish arc length since spawn
  prevRawDist: number;
  nextCheckpoint: number;
  lapStartTime: number;
  lastLap: number;
  bestLap: number;
  wrongWayTimer: number;
  wrongWayOn: boolean;
  flipTimer: number;
  wedgedTimer: number;
}

const ZERO: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const COAST: VehicleControls = { throttle: 0, brake: 0.3, steer: 0, handbrake: true };

const AI_BAND_RANGE = 90;
const AI_BAND_MAX = 0.075;

export class RaceManager {
  events = new Emitter<RaceEvents>();
  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  raceTime = 0;

  private countdownLeft: number;
  private trackers: CarTracker[];
  private lapsTotal: number;
  private finishedAnnounced = false;

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
        unwrapped: p.dist,
        prevRawDist: p.dist,
        nextCheckpoint: 0,
        lapStartTime: 0,
        lastLap: 0,
        bestLap: Infinity,
        wrongWayTimer: 0,
        wrongWayOn: false,
        flipTimer: 0,
        wedgedTimer: 0,
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
    const speeds = this.computeRubberBands();

    for (let i = 0; i < n; i++) {
      const veh = this.vehicles[i];
      const t = this.trackers[i];
      if (t.finished) {
        veh.applyControls(COAST);
        continue;
      }
      const drv = this.drivers[i];
      if (drv) veh.applyControls(drv.update(dt, this.progressList(), veh.id, this.track, speeds[i]));
      else veh.applyControls(playerControls);
    }
  }

  /** Called by the sim loop AFTER world.step so states are fresh. */
  postStep(dt: number): void {
    const cpsAbs = this.track.checkpointFracs.map((f) => f * this.track.length);
    const L = this.track.length;

    for (let i = 0; i < this.trackers.length; i++) {
      const t = this.trackers[i];
      t.state = this.vehicles[i].state;
      const st = t.state;
      const raw = this.track.project(st.x, st.z);

      let delta = raw.dist - t.prevRawDist;
      if (delta > L / 2) delta -= L;
      else if (delta < -L / 2) delta += L;
      // clamp absurd jumps (teleports); resets resync explicitly
      if (Math.abs(delta) < L / 4) t.unwrapped += delta;
      t.prevRawDist = raw.dist;
      t.dist = ((t.unwrapped % L) + L) % L;
      t.totalProgress = t.lap * L + t.dist;

      if (this.phase !== 'racing') continue;

      // checkpoints in order
      while (
        t.nextCheckpoint < cpsAbs.length &&
        t.unwrapped >= t.lap * L + cpsAbs[t.nextCheckpoint]
      ) {
        t.nextCheckpoint++;
      }

      // line crossing
      if (t.unwrapped >= (t.lap + 1) * L) {
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
            t.lap = this.lapsTotal; // keep coasting past finish without counting
          }
        } else {
          // missed a checkpoint: hold them at the gate until they earn it back.
          t.unwrapped = Math.min(t.unwrapped, t.lap * L + cpsAbs[Math.min(t.nextCheckpoint, cpsAbs.length - 1)] - 0.01);
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

      // flip / wedge recovery
      t.flipTimer = st.upDot < 0.15 ? t.flipTimer + dt : 0;
      const wedged = st.speed < 0.35 && Math.abs(st.forwardSpeed) < 0.25 && st.upDot >= 0.15;
      t.wedgedTimer = wedged ? t.wedgedTimer + dt : 0;
      if (t.flipTimer > 3.5 || t.wedgedTimer > (this.drivers[i] !== null ? 5.5 : 8)) {
        this.respawn(i);
      }
    }
  }

  respawn(i: number): void {
    const t = this.trackers[i];
    const sample = this.track.sampleAt(t.dist + 4);
    const cx = sample.x;
    const cz = sample.z + sample.lz * 0;
    const heading = Math.atan2(sample.tx, sample.tz);
    this.vehicles[i].resetTo(cx, sample.y + 1.2, cz, heading);
    t.flipTimer = 0;
    t.wedgedTimer = 0;
    // resync progress bookkeeping after teleport
    const p = this.track.project(cx, cz);
    const L = this.track.length;
    const targetUnwrapped = t.lap * L + p.dist;
    // never move backwards in unwrapped terms beyond current lap base
    t.unwrapped = Math.max(t.lap * L, targetUnwrapped);
    t.prevRawDist = p.dist;
    this.events.emit('autoReset', { id: t.id });
  }

  private computeRubberBands(): number[] {
    const speeds = new Array(this.trackers.length).fill(1);
    const list = this.progressList();
    const player = list.find((c) => c.id === this.playerId);
    if (!player) return speeds;
    for (let i = 0; i < this.trackers.length; i++) {
      const t = this.trackers[i];
      if (t.id === this.playerId) continue;
      const gap = player.totalProgress - t.totalProgress; // >0: AI behind player
      const clamped = Math.max(-AI_BAND_RANGE, Math.min(AI_BAND_RANGE, gap));
      speeds[i] = 1 + AI_BAND_MAX * (clamped / AI_BAND_RANGE);
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
