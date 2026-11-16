import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../core/input';
import type { SettingsApi, SettingsData } from '../core/types';

/**
 * The input layer with touch added as one more source: touch reaches the game through the ordinary InputApi,
 * keyboard, mouse and gamepad behave as before, and the most recently used device is the one in charge.
 */
type Handler = (event: Record<string, unknown>) => void;

function target() {
  const handlers = new Map<string, Handler[]>();
  return {
    addEventListener(type: string, fn: Handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    removeEventListener() {},
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const fn of handlers.get(type) ?? []) fn({ preventDefault() {}, ...event });
    },
    requestPointerLock: vi.fn(),
  };
}

const settings = (over: Partial<SettingsData> = {}): SettingsApi => ({
  data: { quality: 'low', dynamicResolution: true, masterVolume: 1, musicVolume: 1, sfxVolume: 1, liveRadio: false, mouseSensitivity: 1, invertY: false, showFps: false, ...over },
  set() {},
  onChange: () => () => undefined,
});

let win: ReturnType<typeof target>;
let canvas: ReturnType<typeof target>;
let pads: unknown[];

const make = (over: Partial<SettingsData> = {}) => new Input(canvas as unknown as HTMLElement, settings(over));
const key = (code: string, trusted = true) => win.fire('keydown', { code, repeat: false, isTrusted: trusted });
const pad = (axes = [0, 0, 0, 0], pressed: number[] = []) => ({
  connected: true,
  mapping: 'standard',
  axes,
  buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

beforeEach(() => {
  win = target();
  canvas = target();
  pads = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(target(), { pointerLockElement: null }));
  vi.stubGlobal('navigator', { getGamepads: () => pads });
});
afterEach(() => vi.unstubAllGlobals());

describe('Input with the touch controller', () => {
  it('touch buttons arrive as ordinary held and pressed actions', () => {
    const input = make();
    input.touch.active = true;
    input.touch.hold('interact', true);
    input.poll();
    expect(input.pressed('interact')).toBe(true);
    expect(input.held('interact')).toBe(true);
    input.endFrame();
    input.poll();
    expect(input.pressed('interact')).toBe(false);
    expect(input.held('interact')).toBe(true);
  });

  it('the stick and pedals fill the same axes as the keyboard and gamepad', () => {
    const input = make();
    input.touch.active = true;
    input.touch.stick(0.5, 1);
    input.touch.pedal('throttle', 1);
    input.poll();
    expect([input.moveX, input.moveZ, input.throttle, input.brake]).toEqual([0.5, 1, 1, 0]);
    input.touch.stick(0, 0);
    input.touch.pedal('throttle', 0);
    input.poll();
    expect([input.moveX, input.moveZ, input.throttle]).toEqual([0, 0, 0]);
  });

  it('dragging right turns the view right (yaw is positive to the left); look follows the settings', () => {
    const input = make();
    input.touch.active = true;
    input.touch.look(100, 50);
    input.poll();
    expect(input.lookYaw).toBeLessThan(-0.3);
    expect(input.lookPitch).toBeGreaterThan(0.1);
    const tuned = make({ mouseSensitivity: 2, invertY: true });
    tuned.touch.active = true;
    tuned.touch.look(100, 50);
    tuned.poll();
    expect(tuned.lookYaw).toBeCloseTo(input.lookYaw * 2);
    expect(tuned.lookPitch).toBeCloseTo(-input.lookPitch * 2);
    input.poll();
    expect(Math.abs(input.lookYaw) + Math.abs(input.lookPitch)).toBe(0);
  });

  it('does nothing at all until a touch has switched it on', () => {
    const input = make();
    input.touch.hold('fire', true);
    input.touch.stick(1, 1);
    input.touch.look(50, 50);
    input.poll();
    expect(input.held('fire') || input.pressed('fire')).toBe(false);
    expect(Math.abs(input.moveX) + Math.abs(input.moveZ) + Math.abs(input.lookYaw) + Math.abs(input.lookPitch)).toBe(0);
  });

  it('prompts name the on-screen button while touch is in use, and the key otherwise', () => {
    const input = make();
    input.touch.setLabel('interact', 'USE');
    expect(input.label('interact')).toBe('F');
    input.touch.active = true;
    expect(input.label('interact')).toBe('USE');
    expect(input.label('horn')).toBe('H');
  });
});

describe('Input: whichever device was used last is in charge', () => {
  it('a real key press hands over to the keyboard; a scripted one (dev tools) does not', () => {
    const input = make();
    input.touch.active = true;
    input.touch.setLabel('interact', 'USE');
    key('KeyF', false);
    expect(input.touch.active).toBe(true);
    key('KeyW');
    expect(input.touch.active).toBe(false);
    input.poll();
    expect(input.moveZ).toBe(1);
    expect(input.label('interact')).toBe('F');
  });

  it('gamepad input hands over to the gamepad, and a touch takes it back', () => {
    const input = make();
    input.touch.active = true;
    pads = [pad([0, -1, 0, 0])];
    input.poll();
    expect(input.gamepadActive).toBe(true);
    expect(input.touch.active).toBe(false);
    expect(input.moveZ).toBeCloseTo(1);
    pads = [pad()];
    input.touch.active = true;
    input.touch.press('jump');
    input.poll();
    expect(input.gamepadActive).toBe(false);
    expect(input.pressed('jump')).toBe(true);
  });

  it('does not ask for pointer lock while touch is in use', () => {
    const input = make();
    input.touch.active = true;
    input.capture();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    input.touch.active = false;
    input.capture();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('keeps touch presses to the first slice of a slow frame, like key presses', () => {
    const input = make();
    input.touch.active = true;
    input.touch.press('interact');
    input.poll();
    input.suspend();
    expect(input.pressed('interact')).toBe(false);
    input.resume();
    expect(input.pressed('interact')).toBe(true);
  });

  it('losing focus lets go of touch buttons as it does keys', () => {
    const input = make();
    input.touch.active = true;
    input.touch.hold('fire', true);
    input.touch.pedal('throttle', 1);
    win.fire('blur');
    input.poll();
    expect(input.held('fire')).toBe(false);
    expect(input.throttle).toBe(0);
  });
});

describe('Input without touch is unchanged', () => {
  it('keyboard: held, pressed once, axes, released', () => {
    const input = make();
    key('KeyW');
    key('KeyA');
    key('KeyF');
    input.poll();
    expect([input.moveX, input.moveZ, input.throttle, input.brake]).toEqual([1, 1, 1, 0]);
    expect(input.pressed('interact')).toBe(true);
    input.endFrame();
    input.poll();
    expect(input.pressed('interact')).toBe(false);
    expect(input.held('interact')).toBe(true);
    win.fire('keyup', { code: 'KeyW' });
    input.poll();
    expect(input.moveZ).toBe(0);
  });

  it('mouse: a click on the game fires, and movement looks while a button is down', () => {
    const input = make();
    canvas.fire('mousedown', { button: 0 });
    win.fire('mousemove', { movementX: 100, movementY: 50, buttons: 1 });
    input.poll();
    expect(input.pressed('fire')).toBe(true);
    expect(input.lookYaw).toBeCloseTo(-0.24);
    expect(input.lookPitch).toBeCloseTo(0.1);
  });

  it('gamepad: buttons, triggers and labels; a key press takes over from it', () => {
    const input = make();
    pads = [pad([0, 0, 0, 0], [3, 7])];
    input.poll();
    expect(input.pressed('interact')).toBe(true);
    expect(input.throttle).toBe(1);
    expect(input.label('interact')).toBe('Y');
    input.endFrame();
    key('KeyW');
    pads = [pad()];
    input.poll();
    expect(input.gamepadActive).toBe(false);
  });
});
