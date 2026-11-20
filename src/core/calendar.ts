/**
 * The game's week. The story opens on a Friday, so `clock.day` 1 is a Friday, 2 a Saturday, and so on.
 * The HUD, the boy racers and the Friday-night crowd on Stafford Street all count from here.
 */

/** 0 = Monday … 4 = Friday, 5 = Saturday, 6 = Sunday. */
export function weekday(day: number): number {
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  return (((d - 1 + 4) % 7) + 7) % 7;
}

export const FRIDAY = 4;
export const SATURDAY = 5;

/**
 * The day whose night it is: from 19:00 a night belongs to today, and its small hours (before 04:00) to the day
 * before. Null in the daytime.
 */
export function nightOf(hour: number, day: number): number | null {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19) return day;
  if (h < 4) return day - 1;
  return null;
}

/** Friday or Saturday night, 19:00 until 04:00 the next morning. */
export function weekendNight(hour: number, day: number): boolean {
  const night = nightOf(hour, day);
  if (night === null) return false;
  const w = weekday(night);
  return w === FRIDAY || w === SATURDAY;
}
