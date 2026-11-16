import { deviceHints, isPhone } from '../touch/device';
import { SETTINGS_KEY as KEY } from './storage';
import type { SettingsApi, SettingsData } from './types';

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

export class Settings implements SettingsApi {
  data: SettingsData;
  private handlers = new Set<(key: keyof SettingsData) => void>();

  constructor(phone = isPhone(deviceHints())) {
    let stored: Partial<SettingsData> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SettingsData>;
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
