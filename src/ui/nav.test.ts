import { describe, expect, it } from 'vitest';
import type { Action, InputApi } from '../core/types';
import { iconForTags } from './icons';
import { MenuNav } from './nav';

function fakeInput(): InputApi & { hits: Set<Action> } {
  const hits = new Set<Action>();
  return {
    hits,
    held: () => false,
    pressed: (action: Action) => hits.has(action),
    moveX: 0,
    moveZ: 0,
    throttle: 0,
    brake: 0,
    lookYaw: 0,
    lookPitch: 0,
    captured: false,
    capture() {},
    release() {},
    label: (action: Action) => action,
    gamepadActive: false,
  };
}

describe('MenuNav', () => {
  it('fires once when a direction is first pushed, then repeats after a delay', () => {
    const input = fakeInput();
    const nav = new MenuNav();
    nav.update(input, 0.016);
    expect(nav.up || nav.down).toBe(false);

    input.moveZ = -1; // S / stick down
    nav.update(input, 0.016);
    expect(nav.down).toBe(true);
    nav.update(input, 0.016);
    expect(nav.down).toBe(false);

    // Held: nothing until the first-repeat delay has passed…
    let fired = 0;
    for (let t = 0; t < 0.3; t += 0.016) {
      nav.update(input, 0.016);
      if (nav.down) fired++;
    }
    expect(fired).toBe(0);
    // …then a steady repeat.
    for (let t = 0; t < 0.5; t += 0.016) {
      nav.update(input, 0.016);
      if (nav.down) fired++;
    }
    expect(fired).toBeGreaterThanOrEqual(3);
    expect(fired).toBeLessThanOrEqual(6);

    input.moveZ = 0;
    nav.update(input, 0.016);
    expect(nav.down).toBe(false);
  });

  it('maps the axes the right way round (moveZ + is up, moveX + is left)', () => {
    const input = fakeInput();
    const nav = new MenuNav();
    input.moveZ = 1;
    nav.update(input, 0.016);
    expect(nav.up).toBe(true);
    expect(nav.down).toBe(false);
    input.moveZ = 0;
    input.moveX = 1;
    nav.update(input, 0.016);
    expect(nav.left).toBe(true);
    expect(nav.right).toBe(false);
    input.moveX = -1;
    nav.update(input, 0.016);
    expect(nav.right).toBe(true);
  });

  it('ignores a direction that was already held when the menu opened', () => {
    const input = fakeInput();
    const nav = new MenuNav();
    input.moveZ = 1; // still holding W from walking
    nav.reset(input);
    for (let i = 0; i < 120; i++) {
      nav.update(input, 0.016);
      expect(nav.up).toBe(false);
    }
    input.moveZ = 0;
    nav.update(input, 0.016);
    input.moveZ = 1;
    nav.update(input, 0.016);
    expect(nav.up).toBe(true);
  });

  it('reads confirm and back from the game actions', () => {
    const input = fakeInput();
    const nav = new MenuNav();
    input.hits.add('interact');
    nav.update(input, 0.016);
    expect(nav.confirm).toBe(true);
    expect(nav.back).toBe(false);
    input.hits.clear();
    input.hits.add('jump');
    nav.update(input, 0.016);
    expect(nav.confirm).toBe(true);
    input.hits.clear();
    input.hits.add('pause');
    nav.update(input, 0.016);
    expect(nav.back).toBe(true);
    expect(nav.confirm).toBe(false);
  });

  it('only treats the D-pad / B actions as navigation while a gamepad is in use', () => {
    const input = fakeInput();
    const nav = new MenuNav();
    // On a keyboard these are V, H, R, E and Q: not navigation.
    for (const action of ['camera', 'horn', 'radioNext', 'nextWeapon', 'melee'] as Action[]) input.hits.add(action);
    nav.update(input, 0.016);
    expect(nav.up || nav.down || nav.left || nav.right || nav.back).toBe(false);
    input.gamepadActive = true;
    nav.update(input, 0.016);
    expect(nav.up && nav.down && nav.left && nav.right && nav.back).toBe(true);
  });
});

describe('iconForTags', () => {
  it('picks the map symbol for a place', () => {
    expect(iconForTags(['hospital'])).toBe('hospital');
    expect(iconForTags(['police'])).toBe('police');
    expect(iconForTags(['safehouse', 'mission'])).toBe('safehouse');
    expect(iconForTags(['gunshop'])).toBe('gunshop');
    expect(iconForTags(['spray'])).toBe('spray');
    expect(iconForTags(['mission'])).toBeNull();
    expect(iconForTags(['spawn'])).toBeNull();
    expect(iconForTags([])).toBeNull();
  });
});
