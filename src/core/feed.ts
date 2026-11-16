import type { Action } from './types';

/**
 * What the on-screen controller feeds into the input layer (`Input.touch`, src/core/input.ts). It holds no DOM
 * and knows nothing about the game: the overlay writes here from touch events, `Input.poll()` reads it once a
 * frame and mixes it in beside the keyboard, mouse and gamepad.
 *
 * Presses are queued until the next `poll()`, the way key events are: a tap that starts and ends between two
 * frames still gives one `pressed()` edge, and a press queued late in a frame is seen by the whole of the next.
 */
export class TouchFeed {
  /** Touch is the device in use. Set by any touch; a key press or gamepad input clears it. */
  active = false;
  /** Left stick, in InputApi's convention: moveX +1 = left, moveZ +1 = forward. */
  moveX = 0;
  moveZ = 0;
  /**
   * Hand out button names through `label()`. Off while a menu is open: the pause screen's controls table asks
   * for the keyboard and gamepad names, and must not be given the touch ones.
   */
  labelsOn = true;
  /** Pedals, 0..1. */
  throttle = 0;
  brake = 0;
  /** Look drag for the current frame in CSS pixels (+x = finger moved right, +y = down). Set by `poll()`. */
  lookX = 0;
  lookY = 0;

  private down = new Set<Action>();
  private queued = new Set<Action>();
  private hits = new Set<Action>();
  private stash: Set<Action> | null = null;
  private dragX = 0;
  private dragY = 0;
  private used = false;
  private repeats = new Map<Action, { every: number; left: number }>();
  private labels: Partial<Record<Action, string>> = {};

  /** A button went down or came up. Going down counts as a press. */
  hold(action: Action, on: boolean) {
    this.used = true;
    if (on) {
      if (!this.down.has(action)) this.queued.add(action);
      this.down.add(action);
    } else {
      this.down.delete(action);
      const repeat = this.repeats.get(action);
      if (repeat) repeat.left = repeat.every;
    }
  }

  /** A press with nothing held (taps: next weapon, pause, skip). */
  press(action: Action) {
    this.used = true;
    this.queued.add(action);
  }

  /** The look finger moved by this many CSS pixels. */
  look(dx: number, dy: number) {
    this.used = true;
    this.dragX += dx;
    this.dragY += dy;
  }

  /** The stick moved (or was let go: 0, 0). */
  stick(moveX: number, moveZ: number) {
    this.used = true;
    this.moveX = moveX;
    this.moveZ = moveZ;
  }

  /** A pedal went down (1) or came up (0). */
  pedal(axis: 'throttle' | 'brake', value: number) {
    this.used = true;
    this[axis] = value;
  }

  held(action: Action): boolean {
    return this.down.has(action);
  }

  pressed(action: Action): boolean {
    return this.hits.has(action);
  }

  /**
   * While `action` is held, press it again every `seconds` (0 turns that off). This is how holding the fire
   * button keeps a pistol firing: the game fires semi-automatic weapons on the press, not the hold.
   */
  repeat(action: Action, seconds: number) {
    if (seconds > 0) {
      const repeat = this.repeats.get(action);
      if (repeat) repeat.every = seconds;
      else this.repeats.set(action, { every: seconds, left: seconds });
    } else this.repeats.delete(action);
  }

  /** Advance the repeat timers. Call once a frame while the game is running. */
  tick(dt: number) {
    for (const [action, repeat] of this.repeats) {
      if (!this.down.has(action)) continue;
      repeat.left -= dt;
      if (repeat.left <= 0) {
        repeat.left += repeat.every;
        if (repeat.left <= 0) repeat.left = repeat.every;
        this.queued.add(action);
      }
    }
  }

  /**
   * Start of a frame: what was queued since the last one becomes this frame's presses and look drag.
   * Returns true if the controller was touched since the last poll.
   */
  poll(): boolean {
    this.hits.clear();
    for (const action of this.queued) this.hits.add(action);
    this.queued.clear();
    this.stash = null;
    this.lookX = this.dragX;
    this.lookY = this.dragY;
    this.dragX = this.dragY = 0;
    const used = this.used;
    this.used = false;
    return used;
  }

  /** See Input.suspend: presses belong to the first slice of a slow frame only. */
  suspend() {
    if (this.stash) return;
    this.stash = new Set(this.hits);
    this.hits.clear();
  }

  resume() {
    if (!this.stash) return;
    for (const action of this.stash) this.hits.add(action);
    this.stash = null;
  }

  /** Let go of everything (a menu opened, the page lost focus, the controller was hidden). */
  releaseAll() {
    this.down.clear();
    this.queued.clear();
    this.moveX = this.moveZ = this.throttle = this.brake = 0;
    this.dragX = this.dragY = 0;
    for (const repeat of this.repeats.values()) repeat.left = repeat.every;
  }

  /** What the button for `action` says on screen, for prompts ("USE  Nick the ute"). */
  setLabel(action: Action, text: string | null) {
    if (text) this.labels[action] = text;
    else delete this.labels[action];
  }

  /** Undefined while `labelsOn` is off, so the caller falls back to the keyboard's name for the action. */
  label(action: Action): string | undefined {
    return this.labelsOn ? this.labels[action] : undefined;
  }
}
