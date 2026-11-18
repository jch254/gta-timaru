import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY, SETTINGS_KEY, migrateStorage } from './storage';

const storage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
};

describe('migrateStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves a Timmaz Hard save and settings to the current keys', () => {
    const data = storage({ 'timmaz-hard.save.v1': '{"cash":7}', 'timmaz-hard.settings.v2': '{"quality":"low"}' });
    migrateStorage();
    expect(data.get(SAVE_KEY)).toBe('{"cash":7}');
    expect(data.get(SETTINGS_KEY)).toBe('{"quality":"low"}');
    expect(data.has('timmaz-hard.save.v1')).toBe(false);
    expect(data.has('timmaz-hard.settings.v2')).toBe(false);
  });

  it("moves a Nor'west Arch save, two renames back", () => {
    const data = storage({ 'norwest-arch.save.v1': '{"cash":3}' });
    migrateStorage();
    expect(data.get(SAVE_KEY)).toBe('{"cash":3}');
    expect(data.has('norwest-arch.save.v1')).toBe(false);
  });

  it('keeps the newest data: a current save wins, then the newest old name', () => {
    const data = storage({ [SAVE_KEY]: '{"cash":9}', 'timmaz-hard.save.v1': '{"cash":7}', 'norwest-arch.save.v1': '{"cash":3}' });
    migrateStorage();
    expect(data.get(SAVE_KEY)).toBe('{"cash":9}');
    const tie = storage({ 'timmaz-hard.save.v1': '{"cash":7}', 'norwest-arch.save.v1': '{"cash":3}' });
    migrateStorage();
    expect(tie.get(SAVE_KEY)).toBe('{"cash":7}');
  });
});
