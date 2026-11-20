import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInitialRegion } from '../game/initialRegion';
import { archiveInvalid, readSlot } from './saveFormat';
import { Save } from './save';
import { SAVE_KEY } from './storage';

const storage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
};

const legacy = {
  savedAt: 123,
  clock: { hour: 23.5, day: 2 },
  player: { x: 250, z: -4500, heading: 1, money: 300, health: 98, armour: 5 },
  missions: { v: 1, done: ['m1'], completed: false, intro: true, pickups: [] },
  combat: { v: 1, current: 'pistol', weapons: [{ id: 'pistol', clip: 3, reserve: 0 }] },
  police: { level: 0 }, audio: { station: null },
};
const completeGame = () => {
  const save = new Save();
  for (const [key, data] of Object.entries(legacy)) {
    if (key !== 'savedAt') save.register(key, () => data, () => {});
  }
  return save;
};

describe('Continue', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    '', '{', 'null', '[]', '{}',
    ...[
      { version: 3 }, { clock: undefined }, { clock: { day: 0, hour: 9 } },
      { clock: { day: 1.5, hour: 1 } }, { clock: { day: 1, hour: 24 } },
      { player: { ...legacy.player, z: -6145 } }, { player: { ...legacy.player, x: 3073 } },
      { player: { ...legacy.player, armour: 101 } }, { player: { ...legacy.player, money: -1 } },
      { combat: { ...legacy.combat, weapons: [{ id: 'pistol', clip: 100, reserve: 1 }] } },
      { missions: { ...legacy.missions, pickups: 'wrong' } }, { audio: [] }, { police: null },
    ].map(fields => JSON.stringify({ ...legacy, ...fields })),
  ])('rejects invalid data before applying any slices', raw => {
    const files = storage({ [SAVE_KEY]: raw });
    const apply = vi.fn();
    const save = completeGame();
    save.register('audio', () => legacy.audio, apply);
    expect(readSlot().kind).toBe('invalid');
    expect(save.load()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(save.save().ok).toBe(false);
    expect(files.get(SAVE_KEY)).toBe(raw);
  });

  it('migrates v1 in memory, streams only the saved region, then writes v2 on save', async () => {
    const raw = JSON.stringify(legacy);
    const files = storage({ [SAVE_KEY]: raw });
    const slot = readSlot();
    if (slot.kind !== 'ready') throw new Error('Legacy file rejected');
    expect(slot.snapshot).toEqual({ ...legacy, version: 2 });
    expect(files.get(SAVE_KEY)).toBe(raw);
    const world = { places: [], placesTagged: vi.fn(), loadAround: vi.fn() };
    await loadInitialRegion(world, slot.snapshot, undefined, vi.fn());
    expect(world.placesTagged).not.toHaveBeenCalled();
    expect(world.loadAround).toHaveBeenCalledTimes(1);
    expect(world.loadAround).toHaveBeenCalledWith(legacy.player.x, legacy.player.z, expect.any(Function));
    const save = completeGame();
    const apply = vi.fn();
    save.register('player', () => legacy.player, apply);
    expect(save.load()).toBe(true);
    expect(apply).toHaveBeenCalledWith(legacy.player);
    expect(save.save().ok).toBe(true);
    expect(JSON.parse(files.get(SAVE_KEY)!)).toEqual({ ...legacy, savedAt: expect.any(Number), version: 2 });
    expect(readSlot().kind).toBe('ready');
  });

  it('starts fresh only after preserving raw data; failed backup leaves the slot intact', () => {
    const raw = '{broken';
    const files = storage({ [SAVE_KEY]: raw });
    const slot = readSlot();
    if (slot.kind !== 'invalid') throw new Error('Expected invalid slot');
    const write = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('quota'); };
    expect(archiveInvalid(slot)).toBe(false);
    expect(files.get(SAVE_KEY)).toBe(raw);
    localStorage.setItem = write;
    expect(archiveInvalid(slot)).toBe(true);
    expect(readSlot().kind).toBe('missing');
    expect(completeGame().save().ok).toBe(true);
    expect(files.get(`${SAVE_KEY}.recovery.1`)).toBe(raw);
  });
});

describe('Save.save', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    () => { throw new Error('slice'); },
    () => undefined,
    () => ({ nested: Infinity }),
    () => BigInt(1),
  ])('does not commit a partial snapshot', (serialize) => {
    const previous = JSON.stringify(legacy);
    const data = storage({ [SAVE_KEY]: previous });
    const save = completeGame();
    save.register('good', () => 5, () => {});
    save.register('bad', serialize, () => {});
    expect(save.save().ok).toBe(false);
    expect(data.get(SAVE_KEY)).toBe(previous);
  });

  it('reports a refused storage write', () => {
    storage();
    localStorage.setItem = () => { throw new Error('quota'); };
    expect(completeGame().save().ok).toBe(false);
  });
});
