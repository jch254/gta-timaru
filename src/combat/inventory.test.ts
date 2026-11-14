import { describe, expect, it } from 'vitest';
import { DRAW_TIME, Inventory } from './inventory';
import { feelOf, WEAPON_ORDER, WEAPONS } from './weapons';

const specs = new Map(WEAPONS.map((w) => [w.id, w]));
const make = () => new Inventory(specs, WEAPON_ORDER, (id) => feelOf(id).maxReserve);
const pistol = specs.get('pistol')!;
const rifle = specs.get('rifle')!;

/** Step the inventory in small frames. */
function wait(inv: Inventory, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) inv.update(1 / 60);
}

describe('Inventory: loadout', () => {
  it('starts with fists only', () => {
    const inv = make();
    expect(inv.list()).toEqual(['fists']);
    expect(inv.current.id).toBe('fists');
    expect(inv.has('pistol')).toBe(false);
    expect(inv.ammo()).toEqual({ clip: 0, reserve: 0 });
    expect(inv.tryFire()).toBe('melee');
  });

  it('a new gun arrives loaded and is drawn if the player is unarmed', () => {
    const inv = make();
    expect(inv.give('pistol', 20)).toBe('new');
    expect(inv.current.id).toBe('pistol');
    expect(inv.ammo('pistol')).toEqual({ clip: pistol.magazine, reserve: 20 - pistol.magazine });
    // Already armed: the next weapon is stowed, not drawn.
    expect(inv.give('shotgun', 3)).toBe('new');
    expect(inv.current.id).toBe('pistol');
    expect(inv.ammo('shotgun')).toEqual({ clip: 3, reserve: 0 });
  });

  it('more of an owned gun tops up the reserve, up to the cap', () => {
    const inv = make();
    inv.give('pistol', 9);
    expect(inv.give('pistol', 30)).toBe('ammo');
    expect(inv.ammo('pistol')).toEqual({ clip: 9, reserve: 30 });
    inv.give('pistol', 100000);
    expect(inv.ammo('pistol').reserve).toBe(feelOf('pistol').maxReserve);
    expect(inv.full('pistol')).toBe(true);
    expect(inv.give('pistol', 5)).toBe('none');
  });

  it('melee weapons carry no ammunition and unknown ids are refused', () => {
    const inv = make();
    expect(inv.give('bat', 50)).toBe('new');
    expect(inv.ammo('bat')).toEqual({ clip: 0, reserve: 0 });
    expect(inv.full('bat')).toBe(true);
    expect(inv.full('rifle')).toBe(false);
    expect(inv.give('bazooka', 5)).toBe('unknown');
    expect(inv.has('bazooka')).toBe(false);
  });

  it('cycles through owned weapons in the fixed order, wrapping', () => {
    const inv = make();
    inv.give('rifle', 5);
    inv.give('bat');
    inv.select('fists');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      inv.cycle(1);
      seen.push(inv.currentId);
    }
    expect(seen).toEqual(['bat', 'rifle', 'fists', 'bat']);
    inv.cycle(-1);
    expect(inv.currentId).toBe('fists');
    inv.cycle(-1);
    expect(inv.currentId).toBe('rifle');
    expect(inv.select('shotgun')).toBe(false);
    expect(make().cycle(1)).toBe(false);
  });

  it('disarm leaves fists; halveReserve keeps the guns', () => {
    const inv = make();
    inv.give('pistol', 9 + 31);
    inv.give('rifle', 5 + 10);
    inv.halveReserve();
    expect(inv.ammo('pistol')).toEqual({ clip: 9, reserve: 15 });
    expect(inv.ammo('rifle')).toEqual({ clip: 5, reserve: 5 });
    expect(inv.disarm()).toBe(true);
    expect(inv.list()).toEqual(['fists']);
    expect(inv.current.id).toBe('fists');
    expect(inv.disarm()).toBe(false);
  });
});

describe('Inventory: fire and reload', () => {
  it('needs a moment to draw, then fires at the weapon rate', () => {
    const inv = make();
    inv.give('pistol', 9);
    expect(inv.tryFire()).toBe('cooldown');
    wait(inv, DRAW_TIME);
    expect(inv.tryFire()).toBe('fired');
    expect(inv.ammo().clip).toBe(8);
    expect(inv.tryFire()).toBe('cooldown');
    wait(inv, 1 / pistol.rate - 0.05);
    expect(inv.tryFire()).toBe('cooldown');
    wait(inv, 0.06);
    expect(inv.tryFire()).toBe('fired');
    expect(inv.ammo().clip).toBe(7);
  });

  it('reloads by itself when the clip runs dry, taking reloadTime', () => {
    const inv = make();
    const phases: string[] = [];
    inv.onReload = (phase) => phases.push(phase);
    inv.give('pistol', pistol.magazine + 4);
    wait(inv, DRAW_TIME);
    for (let i = 0; i < pistol.magazine; i++) {
      expect(inv.tryFire()).toBe('fired');
      if (i < pistol.magazine - 1) wait(inv, 1 / pistol.rate + 0.01);
    }
    expect(inv.ammo()).toEqual({ clip: 0, reserve: 4 });
    expect(inv.reloading).toBe(true);
    expect(phases).toEqual(['start']);
    expect(inv.tryFire()).toBe('reloading');
    wait(inv, pistol.reloadTime - 0.1);
    expect(inv.reloading).toBe(true);
    wait(inv, 0.15);
    expect(inv.reloading).toBe(false);
    expect(phases).toEqual(['start', 'done']);
    // Only four rounds were left.
    expect(inv.ammo()).toEqual({ clip: 4, reserve: 0 });
  });

  it('clicks empty when there is nothing left anywhere', () => {
    const inv = make();
    inv.give('rifle', 1);
    wait(inv, DRAW_TIME);
    expect(inv.tryFire()).toBe('fired');
    expect(inv.reloading).toBe(false);
    wait(inv, 1 / rifle.rate + 0.01);
    expect(inv.tryFire()).toBe('empty');
    expect(inv.startReload()).toBe(false);
    // Ammunition picked up for the empty gun in hand starts a reload.
    inv.give('rifle', 3);
    expect(inv.reloading).toBe(true);
    wait(inv, rifle.reloadTime + 0.05);
    expect(inv.ammo()).toEqual({ clip: 3, reserve: 0 });
  });

  it('manual reload tops up a part-used clip and refuses when pointless', () => {
    const inv = make();
    inv.give('pistol', pistol.magazine + 20);
    expect(inv.startReload()).toBe(false); // full clip
    wait(inv, DRAW_TIME);
    inv.tryFire();
    expect(inv.startReload()).toBe(true);
    expect(inv.startReload()).toBe(false); // already reloading
    wait(inv, pistol.reloadTime + 0.05);
    expect(inv.ammo()).toEqual({ clip: pistol.magazine, reserve: 19 });
    inv.select('fists');
    expect(inv.startReload()).toBe(false);
  });

  it('switching weapons abandons a reload', () => {
    const inv = make();
    inv.give('pistol', pistol.magazine + 9);
    inv.give('bat');
    wait(inv, DRAW_TIME);
    inv.tryFire();
    inv.startReload();
    wait(inv, pistol.reloadTime / 2);
    inv.select('bat');
    expect(inv.reloading).toBe(false);
    wait(inv, pistol.reloadTime);
    expect(inv.ammo('pistol')).toEqual({ clip: pistol.magazine - 1, reserve: 9 });
  });

  it('drawing an empty gun with spare rounds starts reloading it', () => {
    const inv = make();
    inv.give('bat');
    inv.deserialize({ v: 1, current: 'bat', weapons: [{ id: 'bat', clip: 0, reserve: 0 }, { id: 'pistol', clip: 0, reserve: 12 }] });
    expect(inv.select('pistol')).toBe(true);
    expect(inv.reloading).toBe(true);
  });

  it('each weapon keeps its own cooldown: swapping does not skip the bolt', () => {
    const inv = make();
    inv.give('rifle', 5);
    inv.give('pistol', 9);
    wait(inv, DRAW_TIME);
    expect(inv.tryFire()).toBe('fired'); // rifle
    inv.select('pistol');
    wait(inv, DRAW_TIME + 0.02);
    expect(inv.tryFire()).toBe('fired');
    inv.select('rifle');
    wait(inv, DRAW_TIME + 0.02);
    // About 0.65 s since the rifle shot; the bolt takes 1.25 s.
    expect(inv.tryFire()).toBe('cooldown');
    wait(inv, 1 / rifle.rate);
    expect(inv.tryFire()).toBe('fired');
  });
});

describe('Inventory: save', () => {
  it('round-trips through JSON', () => {
    const inv = make();
    inv.give('bat');
    inv.give('pistol', 40);
    inv.give('shotgun', 12);
    inv.select('shotgun');
    wait(inv, DRAW_TIME);
    inv.tryFire();
    const saved = JSON.parse(JSON.stringify(inv.serialize()));
    const copy = make();
    copy.deserialize(saved);
    expect(copy.list()).toEqual(inv.list());
    expect(copy.currentId).toBe('shotgun');
    for (const id of inv.list()) expect(copy.ammo(id)).toEqual(inv.ammo(id));
    expect(copy.serialize()).toEqual(inv.serialize());
  });

  it('replaces whatever was held before', () => {
    const inv = make();
    inv.give('rifle', 5);
    inv.deserialize({ v: 1, current: 'bat', weapons: [{ id: 'bat', clip: 0, reserve: 0 }] });
    expect(inv.list()).toEqual(['fists', 'bat']);
    expect(inv.currentId).toBe('bat');
  });

  it('survives junk', () => {
    for (const junk of [null, undefined, 7, 'x', [], {}, { weapons: 'no' }, { weapons: [null, 3, { id: 9 }, { id: 'bazooka', clip: 1, reserve: 1 }] }]) {
      const inv = make();
      inv.give('pistol', 9);
      inv.deserialize(junk);
      expect(inv.list()).toEqual(['fists']);
      expect(inv.currentId).toBe('fists');
    }
  });

  it('clamps counts and ignores a current weapon that is not owned', () => {
    const inv = make();
    inv.deserialize({ v: 1, current: 'rifle', weapons: [{ id: 'pistol', clip: 999, reserve: -5 }, { id: 'shotgun', clip: 2.7, reserve: 1e9 }, { id: 'bat', clip: 4, reserve: 4 }] });
    expect(inv.currentId).toBe('fists');
    expect(inv.ammo('pistol')).toEqual({ clip: pistol.magazine, reserve: 0 });
    expect(inv.ammo('shotgun')).toEqual({ clip: 2, reserve: feelOf('shotgun').maxReserve });
    expect(inv.ammo('bat')).toEqual({ clip: 0, reserve: 0 });
  });
});
