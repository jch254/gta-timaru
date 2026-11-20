import type * as THREE from 'three';
import { DecalPattern, type DecalStyle } from './decals';
import { particleStyle, type ParticlePool } from './particles';

/**
 * Looks: every particle and decal style, and the bursts built from them. Lit styles ("smoke" pool)
 * hold surface colours and are multiplied by the scene light level; glow styles ("glow" pool) are
 * additive HDR colours, where anything above 1 blooms.
 */

// ───────────── Lit, alpha-blended ─────────────

export const SMOKE_GREY = particleStyle({ shape: 'Billow', erode: 0.35, lifeMin: 1.6, lifeMax: 2.6, size0: 0.5, size1: 2.3, color0: [0.62, 0.62, 0.62], color1: [0.78, 0.78, 0.78], alpha: 0.32, fadeIn: 0.12, fadePower: 1.3, drag: 0.8, gravity: -1.6, wind: 0.9, spin: 0.8 });
export const SMOKE_DARK = particleStyle({ shape: 'Billow', erode: 0.35, lifeMin: 1.8, lifeMax: 3, size0: 0.6, size1: 2.8, color0: [0.16, 0.16, 0.16], color1: [0.3, 0.3, 0.3], alpha: 0.46, fadeIn: 0.1, fadePower: 1.2, drag: 0.7, gravity: -1.9, wind: 0.9, spin: 0.8 });
export const SMOKE_BLACK = particleStyle({ shape: 'Billow', erode: 0.3, lifeMin: 2.6, lifeMax: 4.6, size0: 0.9, size1: 4.4, color0: [0.03, 0.03, 0.03], color1: [0.13, 0.13, 0.13], alpha: 0.6, fadeIn: 0.08, fadePower: 1.1, drag: 0.5, gravity: -2.3, wind: 0.9, spin: 0.6 });
export const SMOKE_TYRE = particleStyle({ shape: 'Billow', erode: 0.45, lifeMin: 0.9, lifeMax: 1.7, size0: 0.5, size1: 2.1, color0: [0.86, 0.86, 0.86], alpha: 0.22, fadeIn: 0.1, fadePower: 1.4, drag: 1.6, gravity: -0.5, wind: 0.6, spin: 1 });
export const SMOKE_GUN = particleStyle({ shape: 'Billow', erode: 0.5, lifeMin: 0.5, lifeMax: 0.9, size0: 0.12, size1: 0.6, color0: [0.7, 0.7, 0.7], alpha: 0.24, fadePower: 1.3, drag: 3, gravity: -0.6, wind: 0.8, spin: 1.5 });
/** The column that keeps rising off a fire: big, black and slow to go. */
export const SMOKE_COLUMN = particleStyle({ shape: 'Billow', erode: 0.3, lifeMin: 4, lifeMax: 6.5, size0: 1.3, size1: 6.5, color0: [0.04, 0.035, 0.03], color1: [0.16, 0.16, 0.16], alpha: 0.62, fadeIn: 0.06, fadePower: 1.1, drag: 0.45, gravity: -2.6, wind: 0.8, spin: 0.4, heat: 0.6 });
/** The blast's own smoke: born glowing inside the fireball, then black, boiling up and out. */
export const SMOKE_BLAST = particleStyle({ shape: 'Billow', erode: 0.35, lifeMin: 2.8, lifeMax: 4.8, size0: 1.6, size1: 7.5, color0: [0.05, 0.04, 0.032], color1: [0.2, 0.19, 0.18], alpha: 0.9, fadeIn: 0.02, fadePower: 1.15, drag: 1.6, gravity: -2.8, wind: 0.5, spin: 0.5, heat: 1.5, cool: 3.5 });
/** The cap: smoke shot up through the fireball that rolls over into a mushroom and drifts off. */
export const SMOKE_CAP = particleStyle({ shape: 'Billow', erode: 0.3, lifeMin: 3.5, lifeMax: 5.5, size0: 1.4, size1: 8, color0: [0.045, 0.04, 0.035], color1: [0.22, 0.21, 0.2], alpha: 0.85, fadeIn: 0.03, fadePower: 1.1, drag: 1.1, gravity: -1.2, wind: 0.7, spin: 0.35, heat: 0.8, cool: 4 });
/** Behind a burning piece of wreck as it flies. */
export const SMOKE_TRAIL = particleStyle({ shape: 'Billow', erode: 0.45, lifeMin: 0.9, lifeMax: 1.7, size0: 0.45, size1: 1.6, color0: [0.09, 0.085, 0.08], color1: [0.3, 0.3, 0.3], alpha: 0.5, fadePower: 1.3, drag: 1.4, gravity: -1.4, wind: 0.8, spin: 1, heat: 0.5 });

export const DUST_GRAVEL = particleStyle({ shape: 'Billow', erode: 0.4, lifeMin: 1.2, lifeMax: 2.4, size0: 0.7, size1: 3.3, color0: [0.62, 0.57, 0.48], alpha: 0.28, fadeIn: 0.1, fadePower: 1.3, drag: 1.2, gravity: -0.35, wind: 0.8, spin: 0.7 });
export const DUST_GRASS = particleStyle({ shape: 'Billow', erode: 0.4, lifeMin: 0.8, lifeMax: 1.6, size0: 0.5, size1: 2.2, color0: [0.4, 0.36, 0.25], alpha: 0.22, fadeIn: 0.1, fadePower: 1.4, drag: 1.5, gravity: -0.2, wind: 0.8, spin: 0.7 });
export const DUST_SAND = particleStyle({ shape: 'Billow', erode: 0.4, lifeMin: 1, lifeMax: 2, size0: 0.6, size1: 2.8, color0: [0.78, 0.7, 0.52], alpha: 0.26, fadeIn: 0.1, fadePower: 1.3, drag: 1.3, gravity: -0.25, wind: 0.8, spin: 0.7 });
/** Driven out along the ground by the shock of a blast. */
export const DUST_BLAST = particleStyle({ shape: 'Billow', erode: 0.4, lifeMin: 1.6, lifeMax: 2.8, size0: 1, size1: 4.6, color0: [0.5, 0.46, 0.4], color1: [0.62, 0.6, 0.56], alpha: 0.5, fadeIn: 0.04, fadePower: 1.3, drag: 3.2, gravity: -0.3, wind: 0.7, spin: 0.6 });

export const PUFF_WORLD = particleStyle({ shape: 'Billow', erode: 0.5, lifeMin: 0.35, lifeMax: 0.75, size0: 0.14, size1: 0.75, color0: [0.6, 0.56, 0.5], alpha: 0.6, fadePower: 1.2, drag: 3, gravity: -0.2, wind: 0.5, spin: 1.5 });
export const PUFF_CLOTH = particleStyle({ shape: 'Billow', erode: 0.5, lifeMin: 0.25, lifeMax: 0.5, size0: 0.1, size1: 0.42, color0: [0.62, 0.58, 0.52], alpha: 0.4, fadePower: 1.4, drag: 4, gravity: 0, wind: 0.4, spin: 1.5 });
export const CHIP = particleStyle({ shape: 'Drop', land: 'Bounce', lifeMin: 0.4, lifeMax: 0.9, size0: 0.05, size1: 0.035, jitter: 0.5, color0: [0.28, 0.26, 0.23], alpha: 1, fadePower: 0.4, drag: 0.5, gravity: 9.8, spin: 6 });
/** Scraps of a vehicle thrown out by a blast: they bounce and lie where they stop. */
export const DEBRIS = particleStyle({ shape: 'Drop', land: 'Bounce', bounce: 0.35, stretch: 0.012, lifeMin: 5, lifeMax: 9, size0: 0.12, size1: 0.1, jitter: 0.6, color0: [0.05, 0.05, 0.05], alpha: 1, fadePower: 0.15, drag: 0.25, gravity: 9.8, spin: 8 });
/** Window glass: little glints that tinkle down and lie on the road. */
export const GLASS = particleStyle({ shape: 'Drop', land: 'Bounce', bounce: 0.25, lifeMin: 4, lifeMax: 7, size0: 0.06, size1: 0.05, jitter: 0.5, color0: [0.75, 0.85, 0.85], alpha: 0.85, fadePower: 0.2, drag: 0.4, gravity: 9.8, spin: 10 });

// Blood: deep venous red, a little darker as it thins and dries in the air.
/** The bulk of a spray: drops drawn out along their flight, gone where they land (the decals take over). */
export const BLOOD_DROP = particleStyle({ shape: 'Drop', land: 'Die', stretch: 0.022, lifeMin: 0.5, lifeMax: 1.1, size0: 0.032, size1: 0.024, jitter: 0.55, color0: [0.17, 0.006, 0.008], color1: [0.11, 0.004, 0.005], alpha: 1, fadePower: 0.3, drag: 0.6, gravity: 9.8 });
/** Fine, fast droplets: the exit-side haze of a gunshot. */
export const BLOOD_FINE = particleStyle({ shape: 'Drop', land: 'Die', stretch: 0.03, lifeMin: 0.25, lifeMax: 0.6, size0: 0.016, size1: 0.012, jitter: 0.5, color0: [0.22, 0.01, 0.012], color1: [0.14, 0.006, 0.008], alpha: 0.95, fadePower: 0.5, drag: 1.4, gravity: 9.8 });
/** Thick gouts: slower, heavier, landing close. */
export const BLOOD_GOB = particleStyle({ shape: 'Drop', land: 'Die', stretch: 0.015, lifeMin: 0.6, lifeMax: 1.2, size0: 0.07, size1: 0.055, jitter: 0.4, color0: [0.14, 0.005, 0.007], color1: [0.09, 0.004, 0.005], alpha: 1, fadePower: 0.25, drag: 0.3, gravity: 9.8 });
/** A red haze hanging where the shot went through. */
export const BLOOD_MIST = particleStyle({ shape: 'Billow', erode: 0.65, lifeMin: 0.35, lifeMax: 0.8, size0: 0.2, size1: 1.05, color0: [0.26, 0.018, 0.018], color1: [0.2, 0.03, 0.03], alpha: 0.55, fadePower: 1.1, drag: 4.5, gravity: 0.5, wind: 0.4, spin: 2 });
/** Torn flesh: dark, wet lumps that tumble, barely bounce and lie where they stop. */
export const GORE = particleStyle({ shape: 'Drop', land: 'Bounce', bounce: 0.12, stretch: 0.008, lifeMin: 9, lifeMax: 14, size0: 0.1, size1: 0.085, jitter: 0.55, color0: [0.4, 0.026, 0.022], color1: [0.22, 0.012, 0.01], alpha: 1, fadePower: 0.12, drag: 0.35, gravity: 9.8, spin: 7 });
/** The paler bits among it: fat, gristle, bone. */
export const GORE_PALE = particleStyle({ shape: 'Drop', land: 'Bounce', bounce: 0.2, stretch: 0.008, lifeMin: 9, lifeMax: 14, size0: 0.05, size1: 0.045, jitter: 0.5, color0: [0.55, 0.36, 0.3], color1: [0.36, 0.2, 0.17], alpha: 1, fadePower: 0.12, drag: 0.35, gravity: 9.8, spin: 9 });

export const WATER_SPRAY = particleStyle({ shape: 'Billow', erode: 0.55, lifeMin: 0.5, lifeMax: 0.95, size0: 0.3, size1: 1, color0: [0.78, 0.83, 0.88], alpha: 0.42, fadePower: 1.2, drag: 0.7, gravity: 6.5, spin: 1 });
export const WATER_DROP = particleStyle({ shape: 'Drop', stretch: 0.03, lifeMin: 0.6, lifeMax: 1.1, size0: 0.12, size1: 0.07, jitter: 0.5, color0: [0.82, 0.87, 0.92], alpha: 0.7, fadePower: 0.6, drag: 0.2, gravity: 9.8 });

// ───────────── Additive glows ─────────────

export const MUZZLE = particleStyle({ lifeMin: 0.045, lifeMax: 0.07, size0: 0.3, size1: 0.6, jitter: 0.15, color0: [7, 5, 2.2], color1: [3, 1.4, 0.3] });
/** Sparks are streaks: hot metal seen moving. They skitter on the ground before they die. */
export const SPARK = particleStyle({ land: 'Bounce', bounce: 0.4, stretch: 0.028, lifeMin: 0.18, lifeMax: 0.55, size0: 0.045, size1: 0.02, jitter: 0.4, color0: [7, 4.6, 1.8], color1: [2.4, 0.7, 0.1], fadePower: 0.6, drag: 1, gravity: 9.8 });
export const FLAME = particleStyle({ shape: 'Billow', erode: 0.75, lifeMin: 0.35, lifeMax: 0.75, size0: 0.55, size1: 1.2, color0: [3.6, 1.7, 0.4], color1: [1.2, 0.24, 0.03], alpha: 0.85, fadeIn: 0.12, fadePower: 1, drag: 1.2, gravity: -3.2, wind: 0.5, spin: 2 });
/** The fireball: roiling lumps of burning vapour, yellow-orange going to deep red as they break up into the smoke. */
export const FIREBALL = particleStyle({ shape: 'Billow', erode: 0.85, lifeMin: 0.45, lifeMax: 1.05, size0: 1.4, size1: 4.4, color0: [1.35, 0.4, 0.07], color1: [0.3, 0.035, 0.005], alpha: 0.6, fadeIn: 0.03, fadePower: 1, drag: 3.2, gravity: -3.4, wind: 0.3, spin: 1.2 });
/** The hot heart of it, for the first instant. */
export const FIRE_CORE = particleStyle({ shape: 'Billow', erode: 0.6, lifeMin: 0.1, lifeMax: 0.2, size0: 1.8, size1: 4.2, color0: [6, 3.6, 1.4], color1: [2.6, 0.9, 0.18], alpha: 0.8, fadePower: 1.2, drag: 3, gravity: -1, spin: 1 });
export const BLAST = particleStyle({ lifeMin: 0.06, lifeMax: 0.1, size0: 3.5, size1: 9, jitter: 0, color0: [5, 4, 2.6], color1: [2.4, 1.2, 0.4] });
export const EMBER = particleStyle({ land: 'Die', stretch: 0.02, lifeMin: 1, lifeMax: 2.4, size0: 0.07, size1: 0.025, jitter: 0.5, color0: [5, 2.4, 0.6], color1: [1.6, 0.3, 0.04], fadePower: 0.7, drag: 0.8, gravity: 4, wind: 0.6 });
/** A burning scrap in flight, drawn as a streak back along its path (one a frame, so they overlap). */
export const FIRE_STREAK = particleStyle({ stretch: 0.04, lifeMin: 0.07, lifeMax: 0.12, size0: 0.2, size1: 0.12, jitter: 0.2, color0: [4, 1.7, 0.4], color1: [1.4, 0.3, 0.04], alpha: 0.75, fadePower: 0.8 });

// ───────────── Decals ─────────────

/** Recycling rings: each kind of stain has its own budget. */
export const DecalRing = { Blood: 0, Hole: 1, Scorch: 2, Pock: 3, Skid: 4, Track: 5, Drop: 6 } as const;
/** Ring sizes, indexed by DecalRing. */
export const DECAL_CAPACITY: readonly number[] = [128, 60, 12, 40, 220, 90, 96];

/** Blood landing beyond someone hit: a splash and droplets thrown on the way it was going. */
export const DECAL_BLOOD_SPATTER: DecalStyle = { ring: DecalRing.Blood, pattern: DecalPattern.Spray, tint: [0.38, 0.018, 0.018], alpha: 0.92, life: 75, fade: 12, grow: 0.2, growFrom: 0.5, soft: 0.1, irregular: 0.55, speckle: 0.8, lift: 0.03 };
export const DECAL_BLOOD_POOL: DecalStyle = { ring: DecalRing.Blood, tint: [0.26, 0.01, 0.01], alpha: 0.95, life: 90, fade: 15, grow: 16, growFrom: 0.12, soft: 0.06, irregular: 0.3, speckle: 0, lift: 0.035 };
/**
 * Small stains in a ring of their own, so a trail of them never takes the pools: drips off someone wounded
 * as they go, and the splats where torn pieces landed.
 */
export const DECAL_BLOOD_DROP: DecalStyle = { ring: DecalRing.Drop, tint: [0.36, 0.016, 0.016], alpha: 0.9, life: 60, fade: 10, grow: 0.15, growFrom: 0.5, soft: 0.14, irregular: 0.55, speckle: 0.45, lift: 0.032 };
/** Where a tyre went over someone, or a body slid: a streak along the road. */
export const DECAL_BLOOD_SMEAR: DecalStyle = { ring: DecalRing.Blood, tint: [0.32, 0.014, 0.014], alpha: 0.88, life: 75, fade: 12, grow: 0.3, growFrom: 0.5, soft: 0.3, irregular: 0.45, speckle: 0.6, lift: 0.03 };
/** Splashed on a wall behind someone shot: it runs. */
export const DECAL_BLOOD_WALL: DecalStyle = { ring: DecalRing.Blood, pattern: DecalPattern.Drip, tint: [0.36, 0.016, 0.016], alpha: 0.92, life: 75, fade: 12, grow: 0.5, growFrom: 0.6, soft: 0.1, irregular: 0.55, speckle: 0, lift: 0.015 };
/** Splashed across the panel of the car that hit them; rides on it, sitting tight to the paint. */
export const DECAL_BLOOD_CAR: DecalStyle = { ring: DecalRing.Blood, pattern: DecalPattern.Drip, tint: [0.4, 0.02, 0.02], alpha: 0.9, life: 60, fade: 10, grow: 0, growFrom: 1, soft: 0.12, irregular: 0.6, speckle: 0, lift: 0.01 };
/** Red tyre prints out of a run-over, fading as the blood wears off the tread. */
export const DECAL_BLOOD_TYRE: DecalStyle = { ring: DecalRing.Track, tint: [0.36, 0.03, 0.03], alpha: 0.75, life: 50, fade: 12, grow: 0, growFrom: 1, soft: 0, irregular: 0, speckle: -1, lift: 0.028 };
export const DECAL_HOLE: DecalStyle = { ring: DecalRing.Hole, tint: [0.1, 0.1, 0.1], alpha: 0.9, life: 45, fade: 6, grow: 0, growFrom: 1, soft: 0.45, irregular: 0.35, speckle: 0, lift: 0.012 };
export const DECAL_SCUFF: DecalStyle = { ring: DecalRing.Hole, tint: [0.3, 0.28, 0.25], alpha: 0.6, life: 30, fade: 6, grow: 0, growFrom: 1, soft: 0.6, irregular: 0.5, speckle: 0.5, lift: 0.025 };
export const DECAL_SCORCH: DecalStyle = { ring: DecalRing.Scorch, tint: [0.06, 0.05, 0.045], alpha: 0.9, life: 120, fade: 20, grow: 0.3, growFrom: 0.45, soft: 0.75, irregular: 0.5, speckle: 0.7, lift: 0.04 };
export const DECAL_BURN: DecalStyle = { ...DECAL_SCORCH, grow: 4.5, growFrom: 0.25 };
export const DECAL_POCK: DecalStyle = { ring: DecalRing.Pock, tint: [0.08, 0.08, 0.09], alpha: 0.93, life: 120, fade: 5, grow: 0, growFrom: 1, soft: 0.35, irregular: 0.3, speckle: 0, lift: 0.008 };
export const DECAL_SKID: DecalStyle = { ring: DecalRing.Skid, tint: [0.2, 0.2, 0.2], alpha: 0.5, life: 40, fade: 12, grow: 0, growFrom: 1, soft: 0, irregular: 0, speckle: -1, lift: 0.025 };

// ───────────── Bursts ─────────────

const rnd = () => Math.random() * 2 - 1;
/** `n` scaled by a detail factor, never below one. */
const count = (n: number, detail: number) => Math.max(1, Math.round(n * detail));

/** A bullet striking masonry, timber or ground: dust kicked back along the normal, chips, a glint. */
export function burstWorld(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, n: THREE.Vector3, melee: boolean, floor = -Infinity) {
  const puffs = melee ? 2 : 3;
  for (let i = 0; i < puffs; i++) {
    const s = 0.6 + Math.random() * 1.1;
    smoke.emit(PUFF_WORLD, p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, n.x * s + rnd() * 0.5, n.y * s + rnd() * 0.5 + 0.2, n.z * s + rnd() * 0.5);
  }
  if (melee) return;
  for (let i = 0; i < 5; i++) {
    const s = 1.5 + Math.random() * 2.5;
    smoke.emit(CHIP, p.x, p.y, p.z, n.x * s + rnd() * 1.6, n.y * s + rnd() * 1.6 + 1.2, n.z * s + rnd() * 1.6, 1, floor);
  }
  for (let i = 0; i < 2; i++) {
    const s = 2 + Math.random() * 3;
    glow.emit(SPARK, p.x, p.y, p.z, n.x * s + rnd() * 2, n.y * s + rnd() * 2 + 0.5, n.z * s + rnd() * 2, 0.7, floor);
  }
}

/** Metal: a shower of sparks and a wisp of smoke. */
export function burstVehicle(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, n: THREE.Vector3, melee: boolean, floor = -Infinity) {
  const sparks = melee ? 3 : 10;
  for (let i = 0; i < sparks; i++) {
    const s = 2 + Math.random() * 5;
    glow.emit(SPARK, p.x, p.y, p.z, n.x * s + rnd() * 2.8, n.y * s + rnd() * 2.8 + 0.8, n.z * s + rnd() * 2.8, 1, floor);
  }
  smoke.emit(SMOKE_GUN, p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, n.x * 0.6, n.y * 0.6 + 0.3, n.z * 0.6);
}

/**
 * A person hit: a cloth puff at the entry and blood out along the blow. `d` is the unit direction the
 * bullet, bat or fist was travelling; `amount` 0..2 scales the spray (0 = puff only; a punch is about
 * 0.3, a pistol round 1, a rifle round through the head 2). `floor` is the ground under them.
 */
export function burstFlesh(smoke: ParticlePool, p: THREE.Vector3, n: THREE.Vector3, d: THREE.Vector3, amount: number, floor = -Infinity) {
  smoke.emit(PUFF_CLOTH, p.x + n.x * 0.04, p.y + n.y * 0.04, p.z + n.z * 0.04, n.x * 0.5 + rnd() * 0.3, n.y * 0.5 + 0.2, n.z * 0.5 + rnd() * 0.3);
  if (amount <= 0) return;
  // Out the far side in a cone along the blow: drops, then a haze of fine droplets travelling faster.
  const spray = Math.round(5 + 12 * amount);
  for (let i = 0; i < spray; i++) {
    const s = 1.8 + Math.random() * 4.2;
    const cone = 0.25 + 0.35 * Math.random();
    smoke.emit(BLOOD_DROP, p.x + d.x * 0.12, p.y + d.y * 0.12, p.z + d.z * 0.12, (d.x + rnd() * cone) * s, (d.y + rnd() * cone) * s + 1.1, (d.z + rnd() * cone) * s, 0.8 + 0.4 * Math.random(), floor);
  }
  const fine = Math.round(10 * amount);
  for (let i = 0; i < fine; i++) {
    const s = 4 + Math.random() * 5;
    smoke.emit(BLOOD_FINE, p.x + d.x * 0.1, p.y + d.y * 0.1, p.z + d.z * 0.1, (d.x + rnd() * 0.3) * s, (d.y + rnd() * 0.3) * s + 0.5, (d.z + rnd() * 0.3) * s, 1, floor);
  }
  // A little back towards whoever did it.
  const back = Math.round(1 + 3 * amount);
  for (let i = 0; i < back; i++) {
    const s = 0.8 + Math.random() * 1.8;
    smoke.emit(BLOOD_DROP, p.x, p.y, p.z, n.x * s + rnd() * 0.8, n.y * s + rnd() * 0.8 + 0.9, n.z * s + rnd() * 0.8, 0.7, floor);
  }
  // Heavy wounds throw gouts that land close.
  const gobs = amount > 0.6 ? Math.round(amount * 2.5) : 0;
  for (let i = 0; i < gobs; i++) {
    const s = 1 + Math.random() * 2;
    smoke.emit(BLOOD_GOB, p.x + d.x * 0.1, p.y, p.z + d.z * 0.1, (d.x + rnd() * 0.5) * s, 0.6 + Math.random() * 1.4, (d.z + rnd() * 0.5) * s, 1, floor);
  }
  smoke.emit(BLOOD_MIST, p.x + d.x * 0.12, p.y + d.y * 0.12, p.z + d.z * 0.12, d.x * 1.6, d.y * 1.6 + 0.2, d.z * 1.6, 0.6 + amount * 0.5);
  if (amount > 0.7) smoke.emit(BLOOD_MIST, p.x + d.x * 0.3, p.y + d.y * 0.3, p.z + d.z * 0.3, d.x * 2.6, d.y * 2.6 + 0.1, d.z * 2.6, 0.5 + amount * 0.45);
  if (amount > 0.45) smoke.emit(BLOOD_MIST, p.x, p.y, p.z, n.x * 0.6, n.y * 0.6 + 0.2, n.z * 0.6, 0.55);
}

/**
 * Blood squeezed out from under a tyre: low, fast squirts to both sides of `d` (the vehicle's travel)
 * and a gout in front. `amount` 0..1.5.
 */
export function burstCrush(smoke: ParticlePool, p: THREE.Vector3, d: THREE.Vector3, amount: number, floor: number) {
  for (const side of [-1, 1]) {
    const sx = d.z * side;
    const sz = -d.x * side;
    const squirts = Math.round(6 + 8 * amount);
    for (let i = 0; i < squirts; i++) {
      const s = 2.5 + Math.random() * 4.5;
      const fwd = rnd() * 0.6 + 0.2;
      smoke.emit(BLOOD_DROP, p.x + sx * 0.25, p.y, p.z + sz * 0.25, (sx + d.x * fwd) * s, 0.8 + Math.random() * 1.8, (sz + d.z * fwd) * s, 0.9 + Math.random() * 0.5, floor);
    }
    for (let i = 0; i < 4; i++) {
      const s = 4 + Math.random() * 4;
      smoke.emit(BLOOD_FINE, p.x + sx * 0.25, p.y, p.z + sz * 0.25, (sx + rnd() * 0.3) * s, 0.5 + Math.random(), (sz + rnd() * 0.3) * s, 1.2, floor);
    }
    smoke.emit(BLOOD_MIST, p.x + sx * 0.4, p.y + 0.05, p.z + sz * 0.4, sx * 1.5, 0.3, sz * 1.5, 0.5 + amount * 0.3);
  }
  for (let i = 0; i < Math.round(2 + 2 * amount); i++) {
    smoke.emit(BLOOD_GOB, p.x, p.y, p.z, d.x * (2 + Math.random() * 3) + rnd(), 1 + Math.random(), d.z * (2 + Math.random() * 3) + rnd(), 1, floor);
  }
}

/**
 * Someone torn open (blown up, hit hard and fast, crushed, a rifle round through the head): pieces of them
 * thrown out round `p`, mostly along `d`, with thick blood and a red haze. `amount` 0..2.
 */
export function burstGore(smoke: ParticlePool, p: THREE.Vector3, d: THREE.Vector3, amount: number, floor: number, detail = 1) {
  const along = Math.min(1, Math.hypot(d.x, d.z));
  const chunks = count(4 + 10 * amount, detail);
  for (let i = 0; i < chunks; i++) {
    const a = Math.random() * Math.PI * 2;
    // Half thrown along the blow, half anywhere round.
    const bias = i % 2 ? along : 0;
    const s = 2 + Math.random() * (3 + 3 * amount);
    const dx = Math.cos(a) * (1 - bias) + d.x * bias * 1.4;
    const dz = Math.sin(a) * (1 - bias) + d.z * bias * 1.4;
    smoke.emit(GORE, p.x + rnd() * 0.15, p.y + rnd() * 0.2, p.z + rnd() * 0.15, dx * s, 1.5 + Math.random() * (2 + 2 * amount), dz * s, 0.6 + Math.random() * 0.9, floor);
  }
  for (let i = 0; i < count(1 + 3 * amount, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 4;
    smoke.emit(GORE_PALE, p.x, p.y, p.z, Math.cos(a) * s + d.x * 2, 2 + Math.random() * 3, Math.sin(a) * s + d.z * 2, 0.6 + Math.random() * 0.8, floor);
  }
  for (let i = 0; i < count(3 + 5 * amount, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    smoke.emit(BLOOD_GOB, p.x, p.y, p.z, Math.cos(a) * s + d.x * 1.5, 1 + Math.random() * 2.5, Math.sin(a) * s + d.z * 1.5, 1 + Math.random() * 0.5, floor);
  }
  for (let i = 0; i < count(10 + 16 * amount, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 0.8;
    const s = 2.5 + Math.random() * 5.5;
    smoke.emit(BLOOD_DROP, p.x, p.y, p.z, Math.cos(a) * (1 - up) * s + d.x * 2, up * s + 1, Math.sin(a) * (1 - up) * s + d.z * 2, 0.8 + Math.random() * 0.6, floor);
  }
  for (let i = 0; i < 2 + Math.round(amount); i++) {
    smoke.emit(BLOOD_MIST, p.x + rnd() * 0.3, p.y + rnd() * 0.3, p.z + rnd() * 0.3, d.x * 1.5 + rnd(), 0.4 + Math.random() * 0.6, d.z * 1.5 + rnd(), 0.9 + 0.5 * amount);
  }
}

/**
 * Muzzle flash: a hot core, a tongue of flame down the barrel line, and a wisp of smoke.
 * (vx, vy, vz) is the shooter's velocity, so the flash keeps up with a moving car.
 */
export function burstMuzzle(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, d: THREE.Vector3, size: number, vx: number, vy: number, vz: number) {
  glow.emit(MUZZLE, p.x, p.y, p.z, vx, vy, vz, size);
  glow.emit(MUZZLE, p.x + d.x * 0.16 * size, p.y + d.y * 0.16 * size, p.z + d.z * 0.16 * size, vx + d.x * 2, vy + d.y * 2, vz + d.z * 2, size * 0.72);
  glow.emit(MUZZLE, p.x + d.x * 0.36 * size, p.y + d.y * 0.36 * size, p.z + d.z * 0.36 * size, vx + d.x * 4, vy + d.y * 4, vz + d.z * 4, size * 0.42);
  for (let i = 0; i < 2; i++) {
    const s = 6 + Math.random() * 8;
    glow.emit(SPARK, p.x, p.y, p.z, vx + d.x * s + rnd() * 2, vy + d.y * s + rnd() * 2, vz + d.z * s + rnd() * 2, 0.6);
  }
  smoke.emit(SMOKE_GUN, p.x + d.x * 0.2, p.y + d.y * 0.2, p.z + d.z * 0.2, vx * 0.5 + d.x * 1.5, vy * 0.5 + 0.4, vz * 0.5 + d.z * 1.5, size);
}

/**
 * The instant of an explosion of `radius` metres at `p`, `floor` the ground under it: a white flash
 * and a white-hot core, a fireball of rolling lumps that break up as they cool, black smoke born
 * glowing inside it that boils up and out, sparks and embers, scraps and glass that bounce and lie
 * on the road, and a ring of dust driven out along the ground. `detail` 0..1 thins it at low quality.
 */
export function burstExplosion(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, radius: number, floor: number, detail = 1) {
  const k = radius / 9;
  const lift = Math.max(0.3, Math.min(1.2, p.y - floor + 0.3));
  const cy = p.y + lift * 0.5;
  glow.emit(BLAST, p.x, cy, p.z, 0, 0, 0, k);
  for (let i = 0; i < count(4, detail); i++) {
    glow.emit(FIRE_CORE, p.x + rnd() * 0.6 * k, cy + Math.random() * 0.8 * k, p.z + rnd() * 0.6 * k, rnd() * 3 * k, (1 + Math.random() * 3) * k, rnd() * 3 * k, k);
  }
  // Fireball: lumps over the upper hemisphere, thrown fast and slowed hard by the air, so the ball
  // swells, then stalls and climbs.
  for (let i = 0; i < count(24, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.pow(Math.random(), 0.7);
    const flat = Math.sqrt(1 - up * up);
    const dx = Math.cos(a) * flat;
    const dz = Math.sin(a) * flat;
    const s = (5 + Math.random() * 11) * k;
    const off = Math.random() * radius * 0.12;
    glow.emit(FIREBALL, p.x + dx * off, cy + up * off, p.z + dz * off, dx * s, up * s * 0.8 + 2, dz * s, k * (0.7 + Math.random() * 0.5));
  }
  // Smoke born inside the fire (lit by it while it burns, so the ball reads as flame wrapped in soot).
  for (let i = 0; i < count(34, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.random();
    const flat = Math.sqrt(1 - up * up);
    const off = Math.random() * radius * 0.18;
    const s = (2.5 + Math.random() * 7) * k;
    smoke.emit(SMOKE_BLAST, p.x + Math.cos(a) * flat * off, cy + 0.4 + up * off, p.z + Math.sin(a) * flat * off, Math.cos(a) * flat * s, up * s + 2 + Math.random() * 2, Math.sin(a) * flat * s, k * (0.75 + Math.random() * 0.5));
  }
  // The cap: punched straight up through the fireball, slowing into a rolling head of smoke.
  for (let i = 0; i < count(9, detail); i++) {
    const s = (9 + Math.random() * 7) * Math.sqrt(k);
    smoke.emit(SMOKE_CAP, p.x + rnd() * 0.8 * k, cy + 0.8, p.z + rnd() * 0.8 * k, rnd() * 2.5 * k, s, rnd() * 2.5 * k, k * (0.8 + Math.random() * 0.4));
  }
  // Sparks and embers.
  for (let i = 0; i < count(46, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 0.9 + 0.05;
    const flat = Math.sqrt(1 - up * up);
    const s = (8 + Math.random() * 16) * Math.sqrt(k);
    glow.emit(SPARK, p.x, cy, p.z, Math.cos(a) * flat * s, up * s, Math.sin(a) * flat * s, 1.4, floor);
  }
  for (let i = 0; i < count(30, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const up = 0.3 + Math.random() * 0.7;
    const s = 5 + Math.random() * 11;
    glow.emit(EMBER, p.x + rnd() * k, cy + Math.random() * k, p.z + rnd() * k, Math.cos(a) * s * (1 - up * 0.5), up * s, Math.sin(a) * s * (1 - up * 0.5), 1, floor);
  }
  // Scraps and glass.
  for (let i = 0; i < count(18, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 4 + Math.random() * 10;
    smoke.emit(DEBRIS, p.x + rnd() * 0.8, cy, p.z + rnd() * 0.8, Math.cos(a) * s, 4 + Math.random() * 9, Math.sin(a) * s, 0.5 + Math.random(), floor);
  }
  for (let i = 0; i < count(30, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 3 + Math.random() * 9;
    smoke.emit(GLASS, p.x + rnd(), cy + 0.4, p.z + rnd(), Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s, 1, floor);
  }
  // Shock ring: dust driven out along the ground.
  const ring = count(22, detail);
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + Math.random() * 0.3;
    const s = (11 + Math.random() * 7) * k;
    smoke.emit(DUST_BLAST, p.x + Math.cos(a) * radius * 0.12, floor + 0.35, p.z + Math.sin(a) * radius * 0.12, Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s, k * (0.8 + Math.random() * 0.4));
  }
}

/** A smaller burst a moment after the first (a fuel tank going up): fireball, smoke and sparks. */
export function burstSecondary(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, k: number, floor: number, detail = 1) {
  for (let i = 0; i < count(12, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.random();
    const flat = Math.sqrt(1 - up * up);
    const s = (3 + Math.random() * 7) * k;
    glow.emit(FIREBALL, p.x, p.y, p.z, Math.cos(a) * flat * s, up * s + 2.5, Math.sin(a) * flat * s, k * 0.65);
  }
  for (let i = 0; i < count(7, detail); i++) {
    smoke.emit(SMOKE_BLAST, p.x + rnd() * k, p.y + 0.5, p.z + rnd() * k, rnd() * 2 * k, 2.5 + Math.random() * 2.5, rnd() * 2 * k, k * 0.7);
  }
  for (let i = 0; i < count(14, detail); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 6 + Math.random() * 10;
    glow.emit(SPARK, p.x, p.y, p.z, Math.cos(a) * s, 2 + Math.random() * 8, Math.sin(a) * s, 1.2, floor);
  }
}

/** Something landing in water at `p` (on the surface). `size` ≈ 0.5 for a person, 1–2 for a vehicle. */
export function burstSplash(smoke: ParticlePool, p: THREE.Vector3, size: number) {
  const drops = Math.round(8 + 14 * size);
  for (let i = 0; i < drops; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (1 + Math.random() * 3) * size;
    smoke.emit(WATER_DROP, p.x + Math.cos(a) * 0.3 * size, p.y + 0.05, p.z + Math.sin(a) * 0.3 * size, Math.cos(a) * s, (3 + Math.random() * 4) * Math.sqrt(size), Math.sin(a) * s, 0.8 + size * 0.5);
  }
  const sheets = Math.round(4 + 5 * size);
  for (let i = 0; i < sheets; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (0.8 + Math.random() * 1.8) * size;
    smoke.emit(WATER_SPRAY, p.x + Math.cos(a) * 0.4 * size, p.y + 0.1, p.z + Math.sin(a) * 0.4 * size, Math.cos(a) * s, (2 + Math.random() * 2.5) * Math.sqrt(size), Math.sin(a) * s, size);
  }
}
