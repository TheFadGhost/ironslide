import type { VehicleControls } from '../types';

export interface FrameInput extends VehicleControls {
  cameraTogglePressed: boolean; // edge
  resetPressed: boolean; // edge
  pausePressed: boolean; // edge
  source: 'keyboard' | 'gamepad';
}

const KEYMAP: Record<string, string> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
};

export class InputSystem {
  private keys = new Set<string>();
  private gamepadIndex: number | null = null;
  private lastSource: 'keyboard' | 'gamepad' = 'keyboard';
  private prevCamera = false;
  private prevReset = false;
  private prevPause = false;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      this.lastSource = 'keyboard';
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

  private pollGamepad(): { steer: number; throttle: number; brake: number; handbrake: boolean } | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = (this.gamepadIndex !== null ? pads[this.gamepadIndex] : null) ?? pads.find((p) => p?.connected) ?? null;
    if (!pad) return null;
    const dz = 0.1;
    let sx = pad.axes[0] ?? 0;
    if (Math.abs(sx) < dz) sx = 0;
    // expo curve for finer center control
    const shaped = Math.sign(sx) * Math.pow(Math.abs(sx), 1.35);
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    const hand = (pad.buttons[0]?.pressed ?? false) || (pad.buttons[5]?.value ?? 0) > 0.5;
    void dz;
    return { steer: shaped, throttle: rt, brake: lt, handbrake: hand };
  }

  sample(): FrameInput {
    const gp = this.pollGamepad();
    let out: FrameInput;
    if (gp && (gp.steer !== 0 || gp.throttle > 0 || gp.brake > 0 || gp.handbrake)) {
      this.lastSource = 'gamepad';
    }
    if (this.lastSource === 'gamepad' && gp) {
      out = {
        throttle: gp.throttle,
        brake: gp.brake,
        steer: gp.steer,
        handbrake: gp.handbrake,
        cameraTogglePressed: !!(padBtn(pad!, 3) && !this.prevCamera),
        resetPressed: !!(padBtn(pad!, 2) && !this.prevReset),
        pausePressed: !!(padBtn(pad!, 9) && !this.prevPause),
        source: 'gamepad',
      };
      this.prevCamera = !!padBtn(pad!, 3);
      this.prevReset = !!padBtn(pad!, 2);
      this.prevPause = !!padBtn(pad!, 9);
      // allow keyboard edges even in gamepad mode
      if (this.keys.has('KeyC')) out.cameraTogglePressed = true;
      if (this.keys.has('KeyR')) out.resetPressed = true;
      if (this.keys.has('Escape') || this.keys.has('KeyP')) out.pausePressed = true;
      if (!this.enabled) {
        out.throttle = 0; out.brake = 0; out.steer = 0; out.handbrake = false;
      }
      return out;
    }

    let left = 0, right = 0, throttle = 0, brake = 0;
    for (const code of this.keys) {
      const m = KEYMAP[code];
      if (m === 'throttle') throttle = 1;
      else if (m === 'brake') brake = 1;
      else if (m === 'left') left = 1;
      else if (m === 'right') right = 1;
    }
    const cam = this.keys.has('KeyC');
    const rst = this.keys.has('KeyR');
    const pse = this.keys.has('Escape') || this.keys.has('KeyP');
    out = {
      throttle,
      brake,
      steer: right - left,
      handbrake: this.keys.has('Space'),
      cameraTogglePressed: cam && !this.prevCamera,
      resetPressed: rst && !this.prevReset,
      pausePressed: pse && !this.prevPause,
      source: 'keyboard',
    };
    this.prevCamera = cam;
    this.prevReset = rst;
    this.prevPause = pse;
    if (!this.enabled) {
      out.throttle = 0; out.brake = 0; out.steer = 0; out.handbrake = false;
    }
    return out;
  }
}

function padBtn(p: Gamepad, i: number): boolean {
  return p.buttons[i]?.pressed ?? false;
}
