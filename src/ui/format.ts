import { weekday } from '../core/calendar';
import { CITY_NAMES, CITY_TE_REO, FEATURE_TE_REO } from '../core/names';
import type { CityId } from '../core/types';

/** Pure text helpers for the HUD and menus. No DOM in here, so everything is unit-testable. */

const MINUS = '−';

/** 1234567 → "1,234,567". Rounds to whole numbers; sign is dropped (callers add their own). */
export function groupThousands(value: number): string {
  const digits = String(Math.round(Math.abs(Number.isFinite(value) ? value : 0)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** 1250 → "NZ$1,250"; negative amounts get a real minus sign in front. */
export function formatMoney(amount: number): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0);
  return `${rounded < 0 ? MINUS : ''}NZ$${groupThousands(rounded)}`;
}

/** Signed change for the money tick: "+$250" / "−$50". */
export function formatDelta(delta: number): string {
  const rounded = Math.round(Number.isFinite(delta) ? delta : 0);
  return `${rounded < 0 ? MINUS : '+'}$${groupThousands(rounded)}`;
}

/** Whole in-game minutes since midnight (0..1439) for a clock hour in 0..24. */
export function minuteOfDay(hour: number): number {
  const h = Number.isFinite(hour) ? hour : 0;
  const wrapped = ((h % 24) + 24) % 24;
  // The epsilon stops 9.5 (stored as 9.4999…) reading as 9:29.
  return Math.min(1439, Math.floor(wrapped * 60 + 1e-6));
}

/** 12-hour clock: 9.5 → "9:30 am", 0 → "12:00 am", 12.25 → "12:15 pm". */
export function formatClock(hour: number): string {
  const minutes = minuteOfDay(hour);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'am' : 'pm'}`;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The story opens on a Friday, so day 1 is a Friday. */
export function weekdayName(day: number, short = false): string {
  const name = WEEKDAYS[weekday(day)];
  return short ? name.slice(0, 3) : name;
}

/** Countdown text: 75 → "1:15", 4.2 → "0:05" (rounds up so 0:00 only shows at zero), 3700 → "1:01:40". */
export function formatTimer(seconds: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(seconds) ? seconds : 0) - 1e-6));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = `${s < 10 ? '0' : ''}${s}`;
  return h > 0 ? `${h}:${m < 10 ? '0' : ''}${m}:${ss}` : `${m}:${ss}`;
}

export interface ParsedPrompt {
  /** Key names to draw as keycaps (empty when the prompt has no key part). */
  keys: string[];
  text: string;
}

const MAX_KEY_PART = 16;

/**
 * Splits a prompt such as "F  Nick the ute" into keycaps and text. The key part is whatever comes before
 * the first run of two spaces; "A / D  Steer" and "Shift+F  Shove" give several caps.
 */
export function parsePrompt(raw: string): ParsedPrompt {
  const text = raw.trim();
  const gap = text.indexOf('  ');
  if (gap > 0 && gap <= MAX_KEY_PART) {
    const rest = text.slice(gap).trim();
    if (rest) {
      const keys = text
        .slice(0, gap)
        .split(/\s*[/+]\s*/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      if (keys.length > 0 && keys.length <= 3) return { keys, text: rest };
    }
  }
  return { keys: [], text };
}

export function cityName(city: CityId | null | undefined): string {
  return (city && CITY_NAMES[city]) || 'Canterbury';
}

/** Te reo Māori name of a town, or '' where none is listed. Macrons are kept exactly as given. */
export function cityTeReo(city: CityId | null | undefined): string {
  return (city && CITY_TE_REO[city]) || '';
}

/** Te reo Māori name for a suburb or natural feature: the map's own, else the shared feature list. */
export function featureTeReo(name: string, own?: string | null): string {
  return own || FEATURE_TE_REO[name] || '';
}

/** "Christchurch · Ōtautahi", or just the English name where no te reo name is listed. */
export function bilingual(name: string, teReo: string | null | undefined): string {
  return teReo && teReo !== name ? `${name} · ${teReo}` : name;
}

export interface LocationLines {
  /** The street (or suburb) the player is on. */
  title: string;
  /** "suburb · town · te reo name of the town", without repeating a name that is already showing. */
  sub: string;
  /** Te reo Māori name of the suburb / feature, when there is one ('' otherwise). */
  teReo: string;
}

/** The lines of the location sign. `suburb` is the district's name and `suburbTeReo` its te reo name. */
export function locationLines(name: string, suburb: string, city: CityId | null | undefined, suburbTeReo?: string | null): LocationLines {
  const town = cityName(city);
  const title = name || suburb || town;
  const parts: string[] = [];
  if (suburb && suburb !== title && suburb !== town) parts.push(suburb);
  if (town !== title) parts.push(town);
  const townTeReo = cityTeReo(city);
  if (townTeReo) parts.push(townTeReo);
  const teReo = featureTeReo(suburb, suburbTeReo);
  return { title, sub: parts.join(' · '), teReo: teReo === townTeReo ? '' : teReo };
}

/** How long a subtitle stays up when the caller does not say: reading time, within sensible limits. */
export function subtitleSeconds(text: string): number {
  return Math.min(7, Math.max(2.2, 1.4 + text.length * 0.055));
}

/** Metres per second → whole km/h (always positive). */
export function toKmh(speed: number): number {
  return Math.round(Math.abs(Number.isFinite(speed) ? speed : 0) * 3.6);
}

/** Three-character plate readout: 7 → "007", 123 → "123", capped at 999. */
export function plateDigits(kmh: number): string {
  const v = Math.min(999, Math.max(0, Math.round(kmh)));
  return v < 10 ? `00${v}` : v < 100 ? `0${v}` : String(v);
}

/** Vehicle condition wording, from health fraction 0..1. */
export function conditionWord(fraction: number, burning: boolean): string {
  if (burning) return 'On fire';
  if (fraction > 0.75) return 'Sweet as';
  if (fraction > 0.5) return 'Bit rough';
  if (fraction > 0.25) return 'Pretty rough';
  return 'Munted';
}

/** "540k", "1.2M", "312". */
export function compactCount(value: number): string {
  const v = Math.max(0, Number.isFinite(value) ? value : 0);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}
