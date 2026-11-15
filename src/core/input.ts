import type { Action, InputApi, SettingsApi } from './types';

const KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyF', 'Enter'],
  fire: ['Mouse0', 'ControlLeft', 'KeyJ'],
  aim: ['Mouse2', 'KeyK'],
  reload: ['KeyR'],
  melee: ['KeyQ'],
  nextWeapon: ['KeyE', 'WheelDown'],
  prevWeapon: ['KeyZ', 'WheelUp'],
  handbrake: ['Space'],
  horn: ['KeyH'],
  radioNext: ['KeyR'],
  radioPrev: ['KeyT'],
  lookBack: ['KeyC'],
  camera: ['KeyV'],
  pause: ['Escape', 'KeyP'],
  map: ['KeyM', 'Tab'],
  skip: ['KeyX', 'Backspace'],
};

const LABELS: Partial<Record<string, string>> = {
  Mouse0: 'LMB',
  Mouse2: 'RMB',
  Space: 'Space',
  ShiftLeft: 'Shift',
  Escape: 'Esc',
  Enter: 'Enter',
};

// Standard-mapping gamepad buttons.
const PAD: Partial<Record<Action, number>> = {
  jump: 0,
  handbrake: 0,
  melee: 1,
  reload: 2,
  radioNext: 14,
  interact: 3,
  aim: 4,
  fire: 5,
  sprint: 10,
  lookBack: 11,
  camera: 12,
  horn: 13,
  nextWeapon: 15,
  pause: 9,
  map: 8,
};

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input implements InputApi {
  moveX = 0;
  moveZ = 0;
  throttle = 0;
  brake = 0;
  lookYaw = 0;
  lookPitch = 0;
  captured = false;
  gamepadActive = false;

  private down = new Set<string>();
  private hits = new Set<string>();
  private padDown = new Set<number>();
  private padHits = new Set<number>();
  private mouseDX = 0;
  private mouseDY = 0;

  constructor(
    private element: HTMLElement,
    private settings: SettingsApi,
  ) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.hits.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    element.addEventListener('mousedown', (e) => {
      this.hits.add(`Mouse${e.button}`);
      this.down.add(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      // Without pointer lock (embedded frames), dragging with any button still looks around.
      if (this.captured || e.buttons) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    element.addEventListener('wheel', (e) => this.hits.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp'), { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.captured = document.pointerLockElement === element;
    });
  }

  capture() {
    try {
      const result = this.element.requestPointerLock?.() as Promise<void> | undefined;
      result?.catch?.(() => undefined);
    } catch {
      // Pointer lock unavailable: drag-to-look still works.
    }
  }

  release() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  held(action: Action): boolean {
    for (const code of KEYS[action]) if (this.down.has(code)) return true;
    const button = PAD[action];
    return button !== undefined && this.padDown.has(button);
  }

  pressed(action: Action): boolean {
    for (const code of KEYS[action]) if (this.hits.has(code)) return true;
    const button = PAD[action];
    return button !== undefined && this.padHits.has(button);
  }

  label(action: Action): string {
    if (this.gamepadActive) {
      const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'D-up', 'D-down', 'D-left', 'D-right'];
      const button = PAD[action];
      if (button !== undefined) return names[button];
    }
    const code = KEYS[action][0];
    return LABELS[code] ?? code.replace(/^Key|^Digit/, '');
  }

  /** Sample devices. Call once at the start of each frame. */
  poll() {
    const sens = this.settings.data.mouseSensitivity;
    const invert = this.settings.data.invertY ? -1 : 1;
    this.lookYaw = -this.mouseDX * 0.0024 * sens;
    this.lookPitch = this.mouseDY * 0.002 * sens * invert;
    this.mouseDX = this.mouseDY = 0;

    const k = (a: Action) => (this.held(a) ? 1 : 0);
    this.moveX = k('left') - k('right');
    this.moveZ = k('forward') - k('back');
    this.throttle = k('forward');
    this.brake = k('back');

    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.mapping === 'standard');
    this.padHits.clear();
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(pad.axes[0]);
      const ly = dz(pad.axes[1]);
      const rx = dz(pad.axes[2]);
      const ry = dz(pad.axes[3]);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padDown.has(i)) this.padHits.add(i);
        if (b.pressed) this.padDown.add(i);
        else this.padDown.delete(i);
      });
      if (lx || ly || rx || ry || rt || lt || this.padHits.size) this.gamepadActive = true;
      if (this.gamepadActive) {
        if (lx || ly) {
          this.moveX = -lx;
          this.moveZ = -ly;
        }
        this.throttle = Math.max(this.throttle, rt);
        this.brake = Math.max(this.brake, lt);
        this.lookYaw += -rx * 0.045 * sens;
        this.lookPitch += ry * 0.03 * sens * invert;
      }
    }
    if (this.hits.size && !this.padHits.size) this.gamepadActive = this.gamepadActive && !this.hits.size;
  }

  /**
   * When a slow frame is simulated in several slices, one-shot input (presses, look deltas) must only be
   * seen by the first slice. `suspend` hides it for the remaining slices; `resume` brings it back for the
   * late update (camera, menus).
   */
  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    this.stash = { hits: new Set(this.hits), padHits: new Set(this.padHits), yaw: this.lookYaw, pitch: this.lookPitch };
    this.hits.clear();
    this.padHits.clear();
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  resume() {
    if (!this.suspended || !this.stash) return;
    this.suspended = false;
    for (const h of this.stash.hits) this.hits.add(h);
    for (const h of this.stash.padHits) this.padHits.add(h);
    this.lookYaw = this.stash.yaw;
    this.lookPitch = this.stash.pitch;
    this.stash = null;
  }

  private suspended = false;
  private stash: { hits: Set<string>; padHits: Set<number>; yaw: number; pitch: number } | null = null;

  /** Clear edge state. Call at the end of each frame. */
  endFrame() {
    this.hits.clear();
  }
}
