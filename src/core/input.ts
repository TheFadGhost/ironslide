import type { VehicleControls } from '../types';

export interface FrameInput extends VehicleControls {
  cameraTogglePressed: boolean;
  resetPressed: boolean;
  pausePressed: boolean;
}

interface PadSnapshot {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  cam: boolean;
  resetBtn: boolean;
  pauseBtn: boolean;
}

const KEYMAP: Record<string, 'throttle' | 'brake' | 'left' | 'right'> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export class InputSystem {
  enabled = true;

  private keys = new Set<string>();
  private gamepadIndex: number | null = null;
  private padWasActive = false;
  private prevCamKey = false;
  private prevResetKey = false;
  private prevPauseKey = false;
  private prevCamPad = false;
  private prevResetPad = false;
  private prevPausePad = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'BUTTON') return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  private pollPad(): PadSnapshot | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad =
      (this.gamepadIndex !== null ? pads[this.gamepadIndex] : null) ??
      pads.find((p) => p && p.connected) ??
      null;
    if (!pad) return null;
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    let sx = pad.axes[0] ?? 0;
    if (Math.abs(sx) < 0.1) sx = 0;
    const steer = Math.sign(sx) * Math.pow(Math.abs(sx), 1.35);
    return {
      steer,
      throttle: pad.buttons[7]?.value ?? 0,
      brake: pad.buttons[6]?.value ?? 0,
      handbrake: btn(0) || (pad.buttons[5]?.value ?? 0) > 0.5,
      cam: btn(3),
      resetBtn: btn(2),
      pauseBtn: btn(9),
    };
  }

  private keyboardControls(): VehicleControls & { cam: boolean; reset: boolean; pause: boolean } {
    let left = 0, right = 0, throttle = 0, brake = 0;
    for (const code of this.keys) {
      const m = KEYMAP[code];
      if (!m) continue;
      if (m === 'throttle') throttle = 1;
      else if (m === 'brake') brake = 1;
      else if (m === 'left') left = 1;
      else right = 1;
    }
    const camKey = this.keys.has('KeyC');
    const resetKey = this.keys.has('KeyR');
    const pauseKey = this.keys.has('Escape') || this.keys.has('KeyP');
    return {
      throttle,
      brake,
      steer: right - left,
      handbrake: this.keys.has('Space'),
      cam: camKey,
      reset: resetKey,
      pause: pauseKey,
    };
  }

  sample(): FrameInput {
    const kb = this.keyboardControls();
    const pad = this.pollPad();

    const padActive =
      pad !== null &&
      (Math.abs(pad.steer) > 0.05 || pad.throttle > 0.05 || pad.brake > 0.05 || pad.handbrake);
    if (padActive) this.padWasActive = true;
    const kbActive = kb.throttle > 0 || kb.brake > 0 || kb.steer !== 0 || kb.handbrake;
    if (kbActive) this.padWasActive = false;

    let ctrl: VehicleControls;
    if (this.padWasActive && pad) {
      ctrl = { throttle: pad.throttle, brake: pad.brake, steer: pad.steer, handbrake: pad.handbrake };
    } else {
      ctrl = { throttle: kb.throttle, brake: kb.brake, steer: kb.steer, handbrake: kb.handbrake };
    }
    if (!this.enabled) ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    const camEdge = (kb.cam && !this.prevCamKey) || (!!pad?.cam && !this.prevCamPad);
    const resetEdge = (kb.reset && !this.prevResetKey) || (!!pad?.resetBtn && !this.prevResetPad);
    const pauseEdge = (kb.pause && !this.prevPauseKey) || (!!pad?.pauseBtn && !this.prevPausePad);
    this.prevCamKey = kb.cam;
    this.prevResetKey = kb.reset;
    this.prevPauseKey = kb.pause;
    this.prevCamPad = !!pad?.cam;
    this.prevResetPad = !!pad?.resetBtn;
    this.prevPausePad = !!pad?.pauseBtn;

    return {
      ...ctrl,
      cameraTogglePressed: camEdge,
      resetPressed: resetEdge,
      pausePressed: pauseEdge,
    };
  }
}
