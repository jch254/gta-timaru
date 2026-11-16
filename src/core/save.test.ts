import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('Save.load with a damaged file', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats valid JSON that is not an object as no save at all', () => {
    for (const raw of ['null', '5', 'true', '"x"', '[1,2]']) {
      storage({ [SAVE_KEY]: raw });
      const save = new Save();
      save.register('clock', () => 0, () => undefined);
      expect(save.load(), `raw=${raw}`).toBe(false);
    }
  });

  it('treats unparseable JSON as no save', () => {
    storage({ [SAVE_KEY]: '{"clock":' });
    expect(new Save().load()).toBe(false);
  });

  it('skips a slice that throws, applies the rest and records the problem', () => {
    storage({ [SAVE_KEY]: JSON.stringify({ good: 7, bad: 1 }) });
    const save = new Save();
    let applied = 0;
    save.register('bad', () => 0, () => {
      throw new Error('corrupt');
    });
    save.register('good', () => 0, (d) => void (applied = d as number));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(save.load()).toBe(true);
    warn.mockRestore();
    expect(applied).toBe(7);
    expect(save.loadProblems).toEqual(['bad']);
  });

  it('round-trips a healthy save with no problems recorded', () => {
    storage();
    const save = new Save();
    let value = 3;
    save.register('v', () => value, (d) => void (value = d as number));
    save.save();
    value = 0;
    expect(save.load()).toBe(true);
    expect(value).toBe(3);
    expect(save.loadProblems).toEqual([]);
  });
});
