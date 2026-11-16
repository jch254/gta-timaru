import { deviceHints, isPhone } from './device';
import { SETTINGS_KEY as KEY } from './storage';
import type { QualityLevel, SettingsApi, SettingsData } from './types';

const DEFAULTS: SettingsData = {
  // Tuned for Apple-silicon Macs; the pause menu and dynamic resolution scale it down elsewhere.
  quality: 'high',
  dynamicResolution: true,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  liveRadio: true,
  mouseSensitivity: 1,
  invertY: false,
  showFps: false,
};

/** Where a phone starts when nothing has been chosen yet: the lightest level, scaling itself to hold frame rate. */
export const PHONE_DEFAULTS: Partial<SettingsData> = { quality: 'low', dynamicResolution: true };

// Compile-time exhaustive, so a new quality level cannot be forgotten here.
const QUALITY_LEVELS: Record<QualityLevel, true> = { low: true, medium: true, high: true, ultra: true };

/** Stored values are untrusted (corrupt storage, old formats): keep only ones of the expected shape. */
function sanitise(stored: unknown): Partial<SettingsData> {
  if (typeof stored !== 'object' || stored === null) return {};
  const raw = stored as Record<string, unknown>;
  const out: Partial<SettingsData> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof SettingsData)[]) {
    const value = raw[key];
    if (key === 'quality') {
      if (typeof value === 'string' && value in QUALITY_LEVELS) out.quality = value as QualityLevel;
    } else if (typeof value === typeof DEFAULTS[key] && (typeof value !== 'number' || Number.isFinite(value))) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export class Settings implements SettingsApi {
  data: SettingsData;
  private handlers = new Set<(key: keyof SettingsData) => void>();

  constructor(phone = isPhone(deviceHints())) {
    let stored: Partial<SettingsData> = {};
    try {
      stored = sanitise(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
    } catch {
      // Corrupt settings: fall back to defaults.
    }
    // Anything the player has stored wins; a phone that has stored nothing starts lighter than a Mac does.
    this.data = { ...DEFAULTS, ...(phone ? PHONE_DEFAULTS : null), ...stored };
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    if (this.data[key] === value) return;
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage full / blocked: settings just won't persist.
    }
    for (const h of this.handlers) h(key);
  }

  onChange(handler: (key: keyof SettingsData) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
