/** Mix data for every sound: level, reach, reverb send, priority. The renderers live in sfx-render.ts. */
import { Rng, hashInts } from '../core/rng';
import type { SfxId } from '../core/types';
import { RENDERERS, trimTail, type Renderer, type SoundId } from './sfx-render';
import { MAX_DISTANCE } from './spatial';

export interface SoundDef {
  /** Distinct renders kept per sound. */
  variants: number;
  /** Linear gain of the voice before the bus. Nothing exceeds 0.5. */
  gain: number;
  /** Metres inside which the sound plays at full level. */
  ref: number;
  /** Cull distance, metres. */
  max: number;
  /** Reverb send 0..1. */
  reverb: number;
  /** 0 (ambient garnish) .. 10 (never steal). */
  priority: number;
  /** Seconds within which a repeat of the same sound at the same spot is dropped. */
  gap: number;
  /** Random pitch spread, ± fraction. */
  jitter: number;
  /** Interface sounds skip the world bus: not spatial, no reverb, audible while paused. */
  ui: boolean;
  /** Most copies allowed to overlap. */
  limit: number;
}

const def = (o: Partial<SoundDef>): SoundDef => ({ variants: 1, gain: 0.3, ref: 6, max: MAX_DISTANCE, reverb: 0.15, priority: 4, gap: 0.03, jitter: 0.04, ui: false, limit: 6, ...o });
const step = (gain: number): SoundDef => def({ variants: 4, gain, ref: 2.5, max: 35, reverb: 0.04, priority: 2, gap: 0.09, jitter: 0.07, limit: 3 });

export const SOUNDS: Record<SoundId, SoundDef> = {
  pistol: def({ variants: 3, gain: 0.42, ref: 14, max: 220, reverb: 0.4, priority: 7, gap: 0.04 }),
  shotgun: def({ variants: 2, gain: 0.48, ref: 18, max: 260, reverb: 0.5, priority: 7, gap: 0.08 }),
  smg: def({ variants: 3, gain: 0.34, ref: 12, max: 200, reverb: 0.3, priority: 7, limit: 5 }),
  rifle: def({ variants: 2, gain: 0.46, ref: 20, max: 300, reverb: 0.55, priority: 7, gap: 0.08 }),
  punch: def({ variants: 3, gain: 0.38, ref: 4, max: 60, reverb: 0.08, priority: 5, gap: 0.06 }),
  reload: def({ gain: 0.24, ref: 2.5, max: 40, reverb: 0.05, gap: 0.2, jitter: 0.02 }),
  empty: def({ gain: 0.2, ref: 2, max: 30, reverb: 0, gap: 0.08, jitter: 0.02 }),
  ricochet: def({ variants: 4, gain: 0.24, ref: 6, max: 90, reverb: 0.3, priority: 3, jitter: 0.1 }),
  bodyHit: def({ variants: 3, gain: 0.38, ref: 4, max: 60, reverb: 0.08, priority: 5, gap: 0.05 }),
  crashSmall: def({ variants: 3, gain: 0.4, ref: 9, reverb: 0.25, priority: 6, gap: 0.09, jitter: 0.08 }),
  crashBig: def({ variants: 2, gain: 0.5, ref: 12, max: 220, reverb: 0.4, priority: 8, gap: 0.12 }),
  glass: def({ variants: 2, gain: 0.34, ref: 6, max: 100, reverb: 0.3, priority: 5, gap: 0.1, jitter: 0.08 }),
  explosion: def({ variants: 2, gain: 0.5, ref: 28, max: 420, reverb: 0.6, priority: 10, gap: 0.25, jitter: 0.06 }),
  horn: def({ gain: 0.22, ref: 10, reverb: 0.2, priority: 5, gap: 0.12, jitter: 0 }),
  hornTruck: def({ gain: 0.26, ref: 14, max: 180, reverb: 0.25, priority: 5, gap: 0.15, jitter: 0 }),
  doorOpen: def({ gain: 0.28, ref: 4, max: 50, reverb: 0.1, gap: 0.12 }),
  doorClose: def({ gain: 0.34, ref: 4, max: 60, reverb: 0.12, gap: 0.12 }),
  engineStart: def({ gain: 0.3, ref: 5, max: 60, reverb: 0.1, gap: 0.3 }),
  skid: def({ variants: 2, gain: 0.2, ref: 8, max: 120, gap: 0.15, jitter: 0.08 }),
  siren: def({ gain: 0.16, ref: 18, max: 250, reverb: 0.3, priority: 6, gap: 0.5, jitter: 0 }),
  pickup: def({ gain: 0.2, priority: 6, gap: 0.08, jitter: 0, ui: true }),
  cash: def({ gain: 0.28, priority: 6, gap: 0.2, jitter: 0.02, ui: true }),
  missionPass: def({ gain: 0.3, priority: 10, gap: 1, jitter: 0, ui: true }),
  missionFail: def({ gain: 0.26, priority: 10, gap: 1, jitter: 0, ui: true }),
  uiMove: def({ gain: 0.12, priority: 5, gap: 0.02, jitter: 0, ui: true }),
  uiSelect: def({ gain: 0.16, priority: 5, gap: 0.04, jitter: 0, ui: true }),
  footstep: step(0.16),
  footGravel: step(0.2),
  footGrass: step(0.15),
  footSand: step(0.14),
  footWet: step(0.18),
  splash: def({ variants: 2, gain: 0.4, ref: 6, max: 100, reverb: 0.2, priority: 5, gap: 0.3 }),
  tramBell: def({ gain: 0.3, ref: 10, max: 140, reverb: 0.3, priority: 3, gap: 0.5, jitter: 0.01 }),
  sheep: def({ variants: 4, gain: 0.22, ref: 8, max: 130, reverb: 0.2, priority: 1, gap: 0.2, jitter: 0.08 }),
  magpie: def({ variants: 4, gain: 0.2, ref: 9, max: 140, reverb: 0.3, priority: 1, gap: 0.5, jitter: 0.05 }),
  scream: def({ variants: 6, gain: 0.3, ref: 9, max: 150, reverb: 0.3, priority: 6, gap: 0.15, jitter: 0.06, limit: 4 }),
  pain: def({ variants: 6, gain: 0.3, ref: 5, max: 80, reverb: 0.15, priority: 5, gap: 0.12, jitter: 0.07, limit: 3 }),
  deathCry: def({ variants: 5, gain: 0.3, ref: 6, max: 90, reverb: 0.2, priority: 5, gap: 0.2, jitter: 0.06, limit: 3 }),
  crunch: def({ variants: 3, gain: 0.44, ref: 5, max: 80, reverb: 0.1, priority: 6, gap: 0.08, jitter: 0.08 }),
  impactWorld: def({ variants: 3, gain: 0.26, ref: 5, max: 80, priority: 3, jitter: 0.1 }),
  impactMetal: def({ variants: 3, gain: 0.3, ref: 5, max: 80, reverb: 0.2, priority: 3, jitter: 0.1 }),
  backfire: def({ variants: 2, gain: 0.34, ref: 8, max: 120, reverb: 0.3, gap: 0.2 }),
  carPass: def({ variants: 3, gain: 0.16, ref: 30, max: 200, reverb: 0.25, priority: 0, gap: 1, jitter: 0.1 }),
  wantedUp: def({ gain: 0.14, priority: 8, gap: 0.5, jitter: 0, ui: true }),
  wantedClear: def({ gain: 0.24, priority: 8, gap: 0.5, jitter: 0, ui: true }),
  static: def({ variants: 3, gain: 0.3, jitter: 0.05, ui: true }),
  radioOff: def({ gain: 0.25, jitter: 0, ui: true }),
  gull: def({ variants: 4, gain: 0.18, ref: 14, max: 180, reverb: 0.3, priority: 1, gap: 0.5, jitter: 0.06 }),
  bellbird: def({ variants: 5, gain: 0.18, ref: 9, max: 120, reverb: 0.3, priority: 1, gap: 0.3, jitter: 0.03 }),
  chirp: def({ variants: 4, gain: 0.08, ref: 6, max: 60, priority: 0, gap: 0.2, jitter: 0.08 }),
  morepork: def({ variants: 2, gain: 0.13, ref: 12, reverb: 0.4, priority: 1, gap: 2, jitter: 0.03 }),
};

/** Every public SfxId has a renderer (compile-time check). */
export const PUBLIC_SOUNDS: Record<SfxId, Renderer> = RENDERERS;

function seedOf(id: string, variant: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return hashInts(h, variant, 1995);
}

/** Renders one variant of a sound (pure; used by the buffer bank and the tests). */
export function renderSound(id: SoundId, variant: number): Float32Array {
  const render: Renderer = RENDERERS[id];
  return trimTail(render(new Rng(seedOf(id, variant))));
}

/** Every (sound, variant) pair, loudest-priority first, for warming the cache a frame at a time. */
export function warmList(): [SoundId, number][] {
  const list: [SoundId, number][] = [];
  const ids = (Object.keys(SOUNDS) as SoundId[]).sort((a, b) => SOUNDS[b].priority - SOUNDS[a].priority);
  for (const id of ids) for (let v = 0; v < SOUNDS[id].variants; v++) list.push([id, v]);
  return list;
}
