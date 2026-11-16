import { describe, expect, it } from 'vitest';
import { BUTTONS, BUTTON_IDS, STICK_ZONE, fireLabel, fireRepeat, interactLabel, isPortrait, visibleButtons, zoneAt, type ControlState } from './controls';

const onFoot = (over: Partial<ControlState> = {}): ControlState => ({
  menuOpen: false,
  free: true,
  driving: false,
  radio: false,
  weapon: 'fists',
  carried: 1,
  driveBy: false,
  prompt: false,
  talking: false,
  ...over,
});
const driving = (over: Partial<ControlState> = {}) => onFoot({ driving: true, radio: true, ...over });
const sorted = (s: ControlState) => [...visibleButtons(s)].sort();

describe('visibleButtons', () => {
  it('always offers pause, map and camera distance while the game is being played', () => {
    for (const s of [onFoot(), driving(), onFoot({ free: false }), onFoot({ weapon: 'rifle', carried: 4 })]) {
      expect(visibleButtons(s)).toEqual(expect.arrayContaining(['pause', 'map', 'camera']));
    }
  });

  it('on foot with bare hands: jump and punch, nothing else', () => {
    expect(sorted(onFoot())).toEqual(['camera', 'fire', 'jump', 'map', 'pause']);
  });

  it('shows aim and reload only with a weapon that fires', () => {
    expect(visibleButtons(onFoot({ weapon: 'melee', carried: 2 }))).not.toContain('aim');
    expect(visibleButtons(onFoot({ weapon: 'melee', carried: 2 }))).not.toContain('reload');
    for (const weapon of ['pistol', 'smg', 'shotgun', 'rifle'] as const) {
      expect(visibleButtons(onFoot({ weapon, carried: 2 }))).toEqual(expect.arrayContaining(['aim', 'reload', 'fire']));
    }
  });

  it('shows next weapon only when there is more than one to choose from', () => {
    expect(visibleButtons(onFoot({ carried: 1 }))).not.toContain('nextWeapon');
    expect(visibleButtons(onFoot({ carried: 2 }))).toContain('nextWeapon');
  });

  it('shows interact on foot only while the game is offering something', () => {
    expect(visibleButtons(onFoot())).not.toContain('interact');
    expect(visibleButtons(onFoot({ prompt: true }))).toContain('interact');
  });

  it('in a car: pedals, handbrake, horn, radio, look behind and get out, and none of the foot controls', () => {
    expect(sorted(driving())).toEqual(['brake', 'camera', 'gas', 'handbrake', 'horn', 'interact', 'lookBack', 'map', 'pause', 'radio']);
    expect(visibleButtons(driving({ weapon: 'pistol', carried: 3, prompt: true }))).not.toEqual(expect.arrayContaining(['jump']));
    expect(visibleButtons(driving({ weapon: 'rifle', carried: 3 }))).not.toContain('aim');
  });

  it('get out is there in a car whether or not a prompt is showing', () => {
    expect(visibleButtons(driving({ prompt: false }))).toContain('interact');
  });

  it('leaves the radio off a motorbike', () => {
    expect(visibleButtons(driving({ radio: false }))).not.toContain('radio');
  });

  it('offers fire in a car only with something that can be fired from the seat', () => {
    expect(visibleButtons(driving())).not.toContain('fire');
    expect(visibleButtons(driving({ driveBy: true }))).toContain('fire');
  });

  it('shows skip only while someone is talking, in or out of a car', () => {
    expect(visibleButtons(onFoot())).not.toContain('skip');
    expect(visibleButtons(onFoot({ talking: true }))).toContain('skip');
    expect(visibleButtons(driving({ talking: true }))).toContain('skip');
    expect(visibleButtons(onFoot({ talking: true, free: false }))).toContain('skip');
  });

  it('takes the action buttons away when the player cannot act (dead, cutscene)', () => {
    expect(sorted(onFoot({ free: false, prompt: true, weapon: 'pistol', carried: 3 }))).toEqual(['camera', 'map', 'pause']);
    expect(sorted(driving({ free: false }))).toEqual(['camera', 'map', 'pause']);
  });

  it('leaves only a way back while a menu is open', () => {
    expect(visibleButtons(onFoot({ menuOpen: true, talking: true, prompt: true }))).toEqual(['back']);
    expect(visibleButtons(driving({ menuOpen: true }))).toEqual(['back']);
  });

  it('never lists a button twice', () => {
    for (const s of [onFoot({ prompt: true, weapon: 'pistol', carried: 5, talking: true }), driving({ driveBy: true, talking: true })]) {
      const list = visibleButtons(s);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('buttons', () => {
  it('every button drives an action or a pedal axis', () => {
    for (const id of BUTTON_IDS) {
      const def = BUTTONS[id];
      if (def.mode === 'pedal') expect(def.axis).toBeDefined();
      else expect(def.action).toBeDefined();
    }
  });

  it('back means what Esc means to a menu', () => {
    expect(BUTTONS.back.action).toBe('pause');
  });

  it('jump and handbrake, reload and radio are separate here though they share keys on a keyboard', () => {
    expect(BUTTONS.jump.action).toBe('jump');
    expect(BUTTONS.handbrake.action).toBe('handbrake');
    expect(BUTTONS.reload.action).toBe('reload');
    expect(BUTTONS.radio.action).toBe('radioNext');
  });
});

describe('labels', () => {
  it('names the fire button for what it will do', () => {
    expect(fireLabel('fists', false)).toBe('PUNCH');
    expect(fireLabel('melee', false)).toBe('SWING');
    expect(fireLabel('pistol', false)).toBe('FIRE');
    expect(fireLabel('fists', true)).toBe('FIRE');
  });

  it('names the interact button: use on foot, out in a car, use again when the car is offered something', () => {
    expect(interactLabel(false)).toBe('USE');
    expect(interactLabel(false, 'USE  Nick the ute')).toBe('USE');
    expect(interactLabel(true)).toBe('OUT');
    expect(interactLabel(true, 'OUT  Get out')).toBe('OUT');
    expect(interactLabel(true, 'OUT  Respray and new plates — $200')).toBe('USE');
  });
});

describe('fireRepeat', () => {
  it('needs no repeat for an automatic weapon (the game fires those on the hold)', () => {
    expect(fireRepeat({ automatic: true, rate: 10 })).toBe(0);
  });

  it('repeats a little slower than the weapon cycles, within sensible bounds', () => {
    const pistol = fireRepeat({ automatic: false, rate: 3.6 });
    expect(pistol).toBeGreaterThan(1 / 3.6);
    expect(pistol).toBeLessThan(0.4);
    expect(fireRepeat({ automatic: false, rate: 0.8 })).toBe(0.6);
    expect(fireRepeat({ automatic: false, rate: 100 })).toBe(0.16);
    expect(fireRepeat({ automatic: false, rate: 0 })).toBe(0.6);
  });
});

describe('zones', () => {
  it('gives the left of the screen to the stick and the rest to looking', () => {
    expect(zoneAt(10, 844)).toBe('stick');
    expect(zoneAt(844 * STICK_ZONE - 1, 844)).toBe('stick');
    expect(zoneAt(844 * STICK_ZONE + 1, 844)).toBe('look');
    expect(zoneAt(800, 844)).toBe('look');
  });

  it('knows portrait from landscape', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(932, 430)).toBe(false);
    expect(isPortrait(500, 500)).toBe(false);
  });
});
