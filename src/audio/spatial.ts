/** Pure listener maths: distance attenuation, stereo pan, air absorption. No WebAudio in here. */

export interface Listener {
  x: number;
  y: number;
  z: number;
  /** Unit vector pointing to the listener's right, on the ground plane. */
  rx: number;
  rz: number;
}

export interface Spatial {
  /** 0..1 gain from distance. 0 = culled. */
  gain: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Low-pass cutoff in Hz standing in for air absorption. */
  cutoff: number;
  /** Seconds the sound takes to arrive. */
  delay: number;
  distance: number;
}

/** Default cull distance for one-shots, metres. */
export const MAX_DISTANCE = 150;
const SPEED_OF_SOUND = 343;

/**
 * Inverse-distance attenuation: full level inside `ref` metres, halving at 2×ref, and eased to exactly zero
 * over the last 30 % before `max` so culling never clicks.
 */
export function attenuation(distance: number, ref: number, max = MAX_DISTANCE): number {
  if (distance >= max) return 0;
  const g = distance <= ref ? 1 : ref / distance;
  const edge = (max - distance) / (max * 0.3);
  return edge >= 1 ? g : g * edge * edge * (3 - 2 * edge);
}

/** Pan from the bearing of the source relative to the listener's right vector; centred when very close. */
export function panFor(l: Listener, x: number, z: number): number {
  const dx = x - l.x;
  const dz = z - l.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 0;
  const side = (dx * l.rx + dz * l.rz) / d;
  return 0.85 * side * Math.min(1, d / 4);
}

/** Distant sounds lose their top end. */
export function airCutoff(distance: number): number {
  const f = 22000 * Math.exp(-distance / 55);
  return f < 1400 ? 1400 : f;
}

export function spatialize(l: Listener, x: number, y: number, z: number, ref: number, max = MAX_DISTANCE, out?: Spatial): Spatial {
  const o = out ?? { gain: 0, pan: 0, cutoff: 22000, delay: 0, distance: 0 };
  const d = Math.hypot(x - l.x, y - l.y, z - l.z);
  o.distance = d;
  o.gain = attenuation(d, ref, max);
  o.pan = panFor(l, x, z);
  o.cutoff = airCutoff(d);
  o.delay = d > 25 ? Math.min(0.7, d / SPEED_OF_SOUND) : 0;
  return o;
}

export interface VoiceSlot {
  /** Context time at which the voice falls silent. */
  until: number;
  priority: number;
  /** Linear gain it was started with (how audible it is). */
  level: number;
  id: string;
  started: number;
}

/**
 * Picks the slot for a new one-shot: a free one if there is one, otherwise the least important voice
 * (lowest priority, then quietest / nearest its end). Returns -1 when the newcomer should be dropped
 * because everything playing matters more. `sameLimit` caps how many copies of one sound may overlap.
 */
export function allocateVoice(slots: readonly VoiceSlot[], now: number, id: string, priority: number, level: number, sameLimit = 6): number {
  let free = -1;
  let same = 0;
  let oldestSame = -1;
  let victim = -1;
  let victimScore = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.until <= now) {
      if (free < 0) free = i;
      continue;
    }
    if (s.id === id) {
      same++;
      if (oldestSame < 0 || s.started < slots[oldestSame].started) oldestSame = i;
    }
    const remaining = Math.min(1, (s.until - now) / 0.4);
    const score = s.priority * 10 + s.level * remaining;
    if (score < victimScore) {
      victimScore = score;
      victim = i;
    }
  }
  if (same >= sameLimit && oldestSame >= 0) return oldestSame;
  if (free >= 0) return free;
  if (victim < 0) return -1;
  const v = slots[victim];
  if (v.priority > priority) return -1;
  if (v.priority === priority && v.level * Math.min(1, (v.until - now) / 0.4) > level) return -1;
  return victim;
}
