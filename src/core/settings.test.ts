import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './settings';
import { SETTINGS_KEY } from './storage';

const storage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return data;
};

describe('Settings with damaged storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops a quality level the game does not have', () => {
    storage({ [SETTINGS_KEY]: JSON.stringify({ quality: 'potato' }) });
    expect(new Settings(false).data.quality).toBe('high');
  });

  it('keeps a stored quality the game does have', () => {
    storage({ [SETTINGS_KEY]: JSON.stringify({ quality: 'medium' }) });
    expect(new Settings(false).data.quality).toBe('medium');
  });

  it('drops values of the wrong type and keeps the good ones', () => {
    storage({ [SETTINGS_KEY]: JSON.stringify({ masterVolume: {}, mouseSensitivity: 'fast', invertY: true }) });
    const s = new Settings(false);
    expect(s.data.masterVolume).toBe(0.8);
    expect(s.data.mouseSensitivity).toBe(1);
    expect(s.data.invertY).toBe(true);
  });

  it('drops non-finite numbers', () => {
    storage({ [SETTINGS_KEY]: '{"masterVolume":1e999,"sfxVolume":0.5}' });
    const s = new Settings(false);
    expect(s.data.masterVolume).toBe(0.8);
    expect(s.data.sfxVolume).toBe(0.5);
  });

  it('ignores a stored primitive entirely, without junk keys', () => {
    storage({ [SETTINGS_KEY]: '"hi"' });
    const s = new Settings(false);
    expect(s.data.quality).toBe('high');
    expect('0' in s.data).toBe(false);
  });
});
