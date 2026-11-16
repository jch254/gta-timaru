import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_DEFAULTS, Settings } from '../core/settings';
import { SETTINGS_KEY } from '../core/storage';
import { deviceHints, isPhone, isTouchFirst, type DeviceHints } from './device';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const hints = (userAgent: string, maxTouchPoints = 0, coarse = false): DeviceHints => ({ userAgent, maxTouchPoints, coarse });

describe('isPhone', () => {
  it('knows iPhones (Safari and Chrome) and Android phones', () => {
    expect(isPhone(hints(IPHONE, 5, true))).toBe(true);
    expect(isPhone(hints(IPHONE_CHROME, 5, true))).toBe(true);
    expect(isPhone(hints(ANDROID_PHONE, 5, true))).toBe(true);
  });

  it('does not count tablets, Macs or PCs, touch screen or not', () => {
    expect(isPhone(hints(ANDROID_TABLET, 5, true))).toBe(false);
    // An iPad asks for desktop sites as a Mac.
    expect(isPhone(hints(MAC, 5, true))).toBe(false);
    expect(isPhone(hints(MAC))).toBe(false);
    expect(isPhone(hints(WINDOWS, 10, false))).toBe(false);
    expect(isPhone(hints(''))).toBe(false);
  });
});

describe('isTouchFirst', () => {
  it('is true for phones and tablets, including an iPad calling itself a Mac', () => {
    expect(isTouchFirst(hints(IPHONE, 5, true))).toBe(true);
    expect(isTouchFirst(hints(ANDROID_TABLET, 5, true))).toBe(true);
    expect(isTouchFirst(hints(MAC, 5, true))).toBe(true);
  });

  it('is false for a real Mac and for a laptop that merely has a touch screen', () => {
    expect(isTouchFirst(hints(MAC, 0, false))).toBe(false);
    expect(isTouchFirst(hints(WINDOWS, 10, false))).toBe(false);
    expect(isTouchFirst(hints(WINDOWS, 0, false))).toBe(false);
  });

  it('believes a coarse-only pointer on anything else', () => {
    expect(isTouchFirst(hints(WINDOWS, 10, true))).toBe(true);
  });
});

describe('deviceHints', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('comes back empty where there is no browser', () => {
    vi.stubGlobal('navigator', undefined);
    expect(deviceHints()).toEqual({ userAgent: '', maxTouchPoints: 0, coarse: false });
  });

  it('reads the user agent, touch points and the coarse-pointer media query', () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE, maxTouchPoints: 5 });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('coarse') }));
    expect(deviceHints()).toEqual({ userAgent: IPHONE, maxTouchPoints: 5, coarse: true });
  });
});

describe('Settings on a phone', () => {
  afterEach(() => vi.unstubAllGlobals());

  const storage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    return data;
  };

  it('starts at Low with dynamic resolution on when nothing is stored', () => {
    storage();
    const s = new Settings(true);
    expect(s.data.quality).toBe('low');
    expect(s.data.dynamicResolution).toBe(true);
    expect(PHONE_DEFAULTS).toEqual({ quality: 'low', dynamicResolution: true });
  });

  it('leaves everything else at the usual defaults', () => {
    storage();
    const phone = new Settings(true).data;
    const desk = new Settings(false).data;
    expect({ ...phone, quality: desk.quality }).toEqual(desk);
  });

  it('keeps High on anything that is not a phone', () => {
    storage();
    expect(new Settings(false).data.quality).toBe('high');
  });

  it('never overrides what the player has chosen', () => {
    storage({ [SETTINGS_KEY]: JSON.stringify({ quality: 'medium', dynamicResolution: false }) });
    const s = new Settings(true);
    expect(s.data.quality).toBe('medium');
    expect(s.data.dynamicResolution).toBe(false);
  });

  it('still picks the phone level when only other settings are stored', () => {
    storage({ [SETTINGS_KEY]: JSON.stringify({ liveRadio: false }) });
    const s = new Settings(true);
    expect(s.data.quality).toBe('low');
    expect(s.data.liveRadio).toBe(false);
  });

  it('goes by the browser when not told (an iPhone user agent)', () => {
    storage();
    vi.stubGlobal('navigator', { userAgent: IPHONE, maxTouchPoints: 5 });
    expect(new Settings().data.quality).toBe('low');
    vi.stubGlobal('navigator', { userAgent: MAC, maxTouchPoints: 0 });
    expect(new Settings().data.quality).toBe('high');
  });

  it('stores the phone level once the player changes any setting', () => {
    const data = storage();
    const s = new Settings(true);
    s.set('masterVolume', 0.5);
    expect(JSON.parse(data.get(SETTINGS_KEY)!).quality).toBe('low');
  });
});
