import { AUDIO } from '../config';
import type { SurfaceId } from '../types';

export interface AudioFrame {
  rpm01: number;
  throttle: number;
  load: number;
  speed01: number;
  slipMax: number;
  handbrake: boolean;
  surface: SurfaceId;
  airborne: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private vibDepth: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private screechBp: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;
  private crunchGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private prevRpm = 0;
  private blipUntil = 0;
  private wobPhase = 0;
  private lastImpact = -1;

  async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.safeResume();
      return;
    }
    const ctx = new AudioContext({ sampleRate: 48000 });
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = AUDIO.masterDefault;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const len = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const shape = ctx.createWaveShaper();
    shape.curve = GameAudio.softClipCurve();
    shape.oversample = '2x';

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;

    const eg = ctx.createGain();
    eg.gain.value = 0;

    const mkOsc = (type: OscillatorType, detune: number, mult: number): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      o.frequency.value = AUDIO.engineBaseFreq * mult;
      o.connect(shape);
      o.start();
      return o;
    };
    this.oscA = mkOsc('sawtooth', -6, 1);
    this.oscB = mkOsc('sawtooth', 6, 1);
    this.oscSub = mkOsc('square', 0, 0.5);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.5;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth);
    depth.connect(this.oscA.frequency);
    depth.connect(this.oscB.frequency);
    depth.connect(this.oscSub.frequency);
    lfo.start();
    this.vibDepth = depth;

    shape.connect(lp);
    lp.connect(eg);
    eg.connect(master);
    this.engineFilter = lp;
    this.engineGain = eg;

    const mkLoopSource = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      return src;
    };

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 750;
    bp.Q.value = 8;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    mkLoopSource().connect(bp);
    bp.connect(sg);
    sg.connect(master);
    this.screechBp = bp;
    this.screechGain = sg;

    const clp = ctx.createBiquadFilter();
    clp.type = 'lowpass';
    clp.frequency.value = 420;
    const cg = ctx.createGain();
    cg.gain.value = 0;
    mkLoopSource().connect(clp);
    clp.connect(cg);
    cg.connect(master);
    this.crunchGain = cg;

    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 300;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    mkLoopSource().connect(wlp);
    wlp.connect(wg);
    wg.connect(master);
    this.windGain = wg;

    if (ctx.state === 'suspended') await this.safeResume();
  }

  setVolume(v: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(clamp(v, 0, 1), ctx.currentTime, 0.03);
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => {});
  }

  resume(): void {
    void this.ctx?.resume().catch(() => {});
  }

  update(dt: number, s: AudioFrame): void {
    const ctx = this.ctx;
    const master = this.master;
    const oscA = this.oscA;
    const oscB = this.oscB;
    const oscSub = this.oscSub;
    const engineFilter = this.engineFilter;
    const engineGain = this.engineGain;
    const vibDepth = this.vibDepth;
    const screechBp = this.screechBp;
    const screechGain = this.screechGain;
    const crunchGain = this.crunchGain;
    const windGain = this.windGain;
    if (
      !ctx || !master || !oscA || !oscB || !oscSub || !engineFilter ||
      !engineGain || !vibDepth || !screechBp || !screechGain || !crunchGain || !windGain ||
      ctx.state !== 'running'
    ) {
      return;
    }
    const t = ctx.currentTime;

    const rpm = clamp(s.rpm01, 0, 1);
    const throttle = clamp(s.throttle, 0, 1);
    const speed01 = clamp(s.speed01, 0, 1);
    const speedGate = clamp(speed01 * 3, 0, 1);
    const slip = clamp(s.slipMax + (s.handbrake ? 0.3 : 0), 0, 1);
    const f = AUDIO.engineBaseFreq * (0.65 + rpm * 2.4);

    const fallingEdge = this.prevRpm - rpm > 0.25 && throttle > 0.5;
    const blipping = t < this.blipUntil;
    this.prevRpm = rpm;

    if (!blipping) {
      if (fallingEdge) {
        this.blipUntil = t + 0.09;
        const dip = f * 0.55;
        oscA.frequency.setTargetAtTime(dip, t, 0.02);
        oscB.frequency.setTargetAtTime(dip, t, 0.02);
        oscSub.frequency.setTargetAtTime(dip * 0.5, t, 0.02);
        engineGain.gain.setTargetAtTime((0.05 + throttle * 0.22 + rpm * 0.05) * 0.3, t, 0.02);
        oscA.frequency.setTargetAtTime(f, t + 0.09, 0.03);
        oscB.frequency.setTargetAtTime(f, t + 0.09, 0.03);
        oscSub.frequency.setTargetAtTime(f * 0.5, t + 0.09, 0.03);
        engineGain.gain.setTargetAtTime(0.05 + throttle * 0.22 + rpm * 0.05, t + 0.09, 0.04);
      } else {
        oscA.frequency.setTargetAtTime(f, t, 0.04);
        oscB.frequency.setTargetAtTime(f, t, 0.04);
        oscSub.frequency.setTargetAtTime(f * 0.5, t, 0.04);
        engineGain.gain.setTargetAtTime(0.05 + throttle * 0.22 + rpm * 0.05, t, 0.04);
      }
    }

    engineFilter.frequency.setTargetAtTime(400 + rpm * 3200, t, 0.04);
    vibDepth.gain.setTargetAtTime(f * 0.015, t, 0.04);

    const airborne = s.airborne;
    const hard = s.surface === 'tarmac' || s.surface === 'kerb';
    const loose = s.surface === 'gravel' || s.surface === 'dirt';
    const gScreech = airborne
      ? 0
      : Math.pow(clamp(slip - 0.25, 0, 1), 2) * speedGate * (hard ? 1 : 0.15);
    const gCrunch = airborne || !loose
      ? 0
      : clamp(slip * 1.4, 0, 0.8) * speedGate;
    screechGain.gain.setTargetAtTime(gScreech, t, 0.08);
    crunchGain.gain.setTargetAtTime(gCrunch, t, 0.08);

    this.wobPhase += dt * 9;
    const wobble = Math.sin(this.wobPhase) * 120 * slip;
    screechBp.frequency.setTargetAtTime(750 + wobble, t, 0.08);

    windGain.gain.setTargetAtTime(speed01 * speed01 * 0.16, t, 0.08);
  }

  impact(strength01: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.noiseBuf;
    if (!ctx || !master || !buf || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (t - this.lastImpact < 0.07) return;
    this.lastImpact = t;
    const str = clamp(strength01, 0, 1);
    const s2 = str * str;

    const burst = ctx.createBufferSource();
    burst.buffer = buf;
    const blp = ctx.createBiquadFilter();
    blp.type = 'lowpass';
    blp.frequency.value = 900;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(Math.max(0.6 * s2, 0.0001), t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    burst.connect(blp);
    blp.connect(bg);
    bg.connect(master);
    burst.start(t, Math.random() * 1.5);
    burst.stop(t + 0.26);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(58, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(Math.max(0.8 * s2, 0.0001), t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    thump.connect(tg);
    tg.connect(master);
    thump.start(t);
    thump.stop(t + 0.2);

    if (str > 0.5) {
      const ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.value = 220;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(Math.max(0.05 * s2, 0.0001), t);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      ring.connect(rg);
      rg.connect(master);
      ring.start(t);
      ring.stop(t + 0.32);
    }
  }

  beep(kind: 'count' | 'go' | 'lap' | 'final' | 'finish'): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    switch (kind) {
      case 'count':
        this.tone('square', 440, 440, t, 0.12, 0.18);
        break;
      case 'go':
        this.tone('square', 880, 880, t, 0.4, 0.2);
        break;
      case 'lap':
        this.tone('sine', 500, 880, t, 0.12, 0.2);
        this.tone('sine', 500, 880, t + 0.16, 0.12, 0.2);
        break;
      case 'final':
        this.tone('triangle', 523, 523, t, 0.12, 0.18);
        this.tone('triangle', 659, 659, t + 0.14, 0.12, 0.18);
        this.tone('triangle', 784, 784, t + 0.28, 0.3, 0.2);
        break;
      case 'finish':
        this.tone('sine', 523, 523, t, 0.12, 0.2);
        this.tone('sine', 659, 659, t + 0.11, 0.12, 0.2);
        this.tone('sine', 784, 784, t + 0.22, 0.12, 0.2);
        this.tone('sine', 1047, 1047, t + 0.33, 0.45, 0.22);
        break;
    }
  }

  dispose(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    this.master = null;
    this.oscA = null;
    this.oscB = null;
    this.oscSub = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.vibDepth = null;
    this.noiseBuf = null;
    this.screechBp = null;
    this.screechGain = null;
    this.crunchGain = null;
    this.windGain = null;
    void ctx.close().catch(() => {});
  }

  private async safeResume(): Promise<void> {
    try {
      await this.ctx?.resume();
    } catch {
      // needs user gesture; caller retries
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const master = this.master!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private static softClipCurve(): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(2.5 * ((i / (n - 1)) * 2 - 1));
    return curve;
  }
}
