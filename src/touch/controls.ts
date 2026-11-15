import type { Action, WeaponSpec } from '../core/types';

/**
 * The buttons of the on-screen controller and the rules for which of them show. No DOM here: the overlay
 * (overlay.ts) draws whatever `visibleButtons` returns and the router (router.ts) turns touches on them into
 * input, so the rules can be tested on their own.
 */
export type ButtonId =
  | 'interact'
  | 'jump'
  | 'fire'
  | 'aim'
  | 'reload'
  | 'nextWeapon'
  | 'gas'
  | 'brake'
  | 'handbrake'
  | 'horn'
  | 'radio'
  | 'lookBack'
  | 'pause'
  | 'map'
  | 'camera'
  | 'skip'
  | 'back';

export type ButtonMode =
  /** Down while the finger is on it (a press when it lands). */
  | 'hold'
  /** One press when the finger lands. */
  | 'tap'
  /** Each tap switches it on or off: aiming, which has to leave the thumb free to look and fire. */
  | 'toggle'
  /** A pedal: an analogue axis rather than an action. */
  | 'pedal';

export interface ButtonDef {
  mode: ButtonMode;
  /** The game action it stands for (pedals have none). */
  action?: Action;
  axis?: 'throttle' | 'brake';
  /** Dragging a finger that is holding this button also turns the camera (so you can track a target while firing). */
  look?: boolean;
}

export const BUTTONS: Record<ButtonId, ButtonDef> = {
  interact: { mode: 'hold', action: 'interact' },
  jump: { mode: 'hold', action: 'jump' },
  fire: { mode: 'hold', action: 'fire', look: true },
  aim: { mode: 'toggle', action: 'aim', look: true },
  reload: { mode: 'tap', action: 'reload' },
  nextWeapon: { mode: 'tap', action: 'nextWeapon' },
  gas: { mode: 'pedal', axis: 'throttle' },
  brake: { mode: 'pedal', axis: 'brake' },
  handbrake: { mode: 'hold', action: 'handbrake' },
  horn: { mode: 'hold', action: 'horn' },
  radio: { mode: 'tap', action: 'radioNext' },
  lookBack: { mode: 'hold', action: 'lookBack' },
  pause: { mode: 'tap', action: 'pause' },
  map: { mode: 'tap', action: 'map' },
  camera: { mode: 'tap', action: 'camera' },
  skip: { mode: 'tap', action: 'skip' },
  // Menus read "back" from the pause action (Esc on a keyboard).
  back: { mode: 'tap', action: 'pause' },
};

export const BUTTON_IDS = Object.keys(BUTTONS) as ButtonId[];

/** What the overlay needs to know about the game to decide which buttons apply. */
export interface ControlState {
  /** The pause screen, the map, a shop or a job offer is up. */
  menuOpen: boolean;
  /** The player can act: alive and not held by a cutscene. */
  free: boolean;
  driving: boolean;
  /** The vehicle being driven has a radio (motorbikes do not). */
  radio: boolean;
  /** Kind of the weapon in hand. */
  weapon: WeaponSpec['kind'];
  /** How many weapons are carried, fists included. */
  carried: number;
  /** Something that can be fired from the driver's seat is carried. */
  driveBy: boolean;
  /** The game is offering something to interact with right now ("Nick the ute", "Talk to Aunty Rena"). */
  prompt: boolean;
  /** A line of mission talk is on screen. */
  talking: boolean;
}

const ranged = (kind: WeaponSpec['kind']) => kind !== 'fists' && kind !== 'melee';

/** The buttons that apply right now, in drawing order. */
export function visibleButtons(s: ControlState): ButtonId[] {
  // Menus are worked by tapping their own rows; all the controller adds is a way back out.
  if (s.menuOpen) return ['back'];
  const out: ButtonId[] = ['pause', 'map', 'camera'];
  if (s.talking) out.push('skip');
  if (!s.free) return out;
  if (s.driving) {
    out.push('gas', 'brake', 'handbrake', 'horn', 'lookBack', 'interact');
    if (s.radio) out.push('radio');
    if (s.driveBy) out.push('fire');
    return out;
  }
  out.push('jump', 'fire');
  if (ranged(s.weapon)) out.push('aim', 'reload');
  if (s.carried > 1) out.push('nextWeapon');
  if (s.prompt) out.push('interact');
  return out;
}

/** The word on the fire button. */
export function fireLabel(kind: WeaponSpec['kind'], driving: boolean): string {
  if (driving) return 'FIRE';
  return kind === 'fists' ? 'PUNCH' : kind === 'melee' ? 'SWING' : 'FIRE';
}

/**
 * The word on the interact button, which prompts repeat ("USE  Nick the ute"). In a car it gets you out,
 * unless the game is offering something else there (a respray), given as the prompt on screen.
 */
export function interactLabel(driving: boolean, prompt: string | null = null): string {
  if (!driving) return 'USE';
  return prompt && !/\bGet out\b/i.test(prompt) ? 'USE' : 'OUT';
}

/**
 * Seconds between repeat presses while fire is held. Automatic weapons fire on the hold itself and need none;
 * everything else fires (or swings) on the press, so the press is repeated.
 */
export function fireRepeat(spec: Pick<WeaponSpec, 'automatic' | 'rate'>): number {
  if (spec.automatic) return 0;
  // A touch slower than the weapon can cycle, so every repeat lands on a ready weapon.
  return Math.min(0.6, Math.max(0.16, 1.1 / Math.max(0.5, spec.rate)));
}

export type Zone = 'stick' | 'look';

/** Share of the screen width, from the left, where a touch on free space starts the stick. */
export const STICK_ZONE = 0.42;

/** What a touch on free space (not on a button) does, by where it lands. */
export function zoneAt(x: number, width: number): Zone {
  return x < width * STICK_ZONE ? 'stick' : 'look';
}

/** Landscape is the only layout: in portrait the overlay shows a "turn your phone" card instead. */
export function isPortrait(width: number, height: number): boolean {
  return height > width;
}
