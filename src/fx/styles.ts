import type * as THREE from 'three';
import type { DecalStyle } from './decals';
import { particleStyle, type ParticlePool } from './particles';

/**
 * Looks: every particle and decal style, and the bursts built from them. Lit styles ("smoke" pool)
 * hold surface colours and are multiplied by the scene light level; glow styles ("glow" pool) are
 * additive HDR colours, where anything above 1 blooms.
 */

// ───────────── Lit, alpha-blended ─────────────

export const SMOKE_GREY = particleStyle({ lifeMin: 1.6, lifeMax: 2.6, size0: 0.5, size1: 2.3, color0: [0.62, 0.62, 0.62], color1: [0.78, 0.78, 0.78], alpha: 0.3, fadeIn: 0.12, fadePower: 1.4, drag: 0.8, gravity: -1.6, wind: 0.9, spin: 0.8 });
export const SMOKE_DARK = particleStyle({ lifeMin: 1.8, lifeMax: 3, size0: 0.6, size1: 2.8, color0: [0.16, 0.16, 0.16], color1: [0.3, 0.3, 0.3], alpha: 0.42, fadeIn: 0.1, fadePower: 1.3, drag: 0.7, gravity: -1.9, wind: 0.9, spin: 0.8 });
export const SMOKE_BLACK = particleStyle({ lifeMin: 2.6, lifeMax: 4.6, size0: 0.9, size1: 4.4, color0: [0.03, 0.03, 0.03], color1: [0.13, 0.13, 0.13], alpha: 0.55, fadeIn: 0.08, fadePower: 1.2, drag: 0.5, gravity: -2.3, wind: 0.9, spin: 0.6 });
export const SMOKE_TYRE = particleStyle({ lifeMin: 0.9, lifeMax: 1.7, size0: 0.5, size1: 2.1, color0: [0.86, 0.86, 0.86], alpha: 0.2, fadeIn: 0.1, fadePower: 1.5, drag: 1.6, gravity: -0.5, wind: 0.6, spin: 1 });
export const SMOKE_GUN = particleStyle({ lifeMin: 0.5, lifeMax: 0.9, size0: 0.12, size1: 0.6, color0: [0.7, 0.7, 0.7], alpha: 0.22, fadePower: 1.4, drag: 3, gravity: -0.6, wind: 0.8, spin: 1.5 });

export const DUST_GRAVEL = particleStyle({ lifeMin: 1.2, lifeMax: 2.4, size0: 0.7, size1: 3.3, color0: [0.62, 0.57, 0.48], alpha: 0.26, fadeIn: 0.1, fadePower: 1.4, drag: 1.2, gravity: -0.35, wind: 0.8, spin: 0.7 });
export const DUST_GRASS = particleStyle({ lifeMin: 0.8, lifeMax: 1.6, size0: 0.5, size1: 2.2, color0: [0.4, 0.36, 0.25], alpha: 0.2, fadeIn: 0.1, fadePower: 1.5, drag: 1.5, gravity: -0.2, wind: 0.8, spin: 0.7 });
export const DUST_SAND = particleStyle({ lifeMin: 1, lifeMax: 2, size0: 0.6, size1: 2.8, color0: [0.78, 0.7, 0.52], alpha: 0.24, fadeIn: 0.1, fadePower: 1.4, drag: 1.3, gravity: -0.25, wind: 0.8, spin: 0.7 });

export const PUFF_WORLD = particleStyle({ lifeMin: 0.35, lifeMax: 0.75, size0: 0.14, size1: 0.75, color0: [0.6, 0.56, 0.5], alpha: 0.55, fadePower: 1.3, drag: 3, gravity: -0.2, wind: 0.5, spin: 1.5 });
export const PUFF_CLOTH = particleStyle({ lifeMin: 0.25, lifeMax: 0.5, size0: 0.1, size1: 0.42, color0: [0.62, 0.58, 0.52], alpha: 0.4, fadePower: 1.4, drag: 4, gravity: 0, wind: 0.4, spin: 1.5 });
export const CHIP = particleStyle({ lifeMin: 0.4, lifeMax: 0.9, size0: 0.06, size1: 0.035, jitter: 0.5, color0: [0.28, 0.26, 0.23], alpha: 1, fadePower: 0.4, drag: 0.5, gravity: 9.8, spin: 6 });
export const DEBRIS = particleStyle({ lifeMin: 0.9, lifeMax: 1.8, size0: 0.22, size1: 0.14, jitter: 0.6, color0: [0.06, 0.06, 0.06], alpha: 1, fadePower: 0.35, drag: 0.3, gravity: 9.8, spin: 8 });

export const BLOOD_DROP = particleStyle({ lifeMin: 0.35, lifeMax: 0.8, size0: 0.075, size1: 0.035, jitter: 0.55, color0: [0.42, 0.012, 0.012], color1: [0.24, 0.006, 0.006], alpha: 0.95, fadePower: 0.5, drag: 0.8, gravity: 9.8 });
export const BLOOD_MIST = particleStyle({ lifeMin: 0.2, lifeMax: 0.4, size0: 0.16, size1: 0.6, color0: [0.46, 0.02, 0.02], alpha: 0.5, fadePower: 1.2, drag: 5, gravity: 1, spin: 2 });

export const WATER_SPRAY = particleStyle({ lifeMin: 0.5, lifeMax: 0.95, size0: 0.3, size1: 1, color0: [0.78, 0.83, 0.88], alpha: 0.4, fadePower: 1.3, drag: 0.7, gravity: 6.5, spin: 1 });
export const WATER_DROP = particleStyle({ lifeMin: 0.6, lifeMax: 1.1, size0: 0.16, size1: 0.09, jitter: 0.5, color0: [0.82, 0.87, 0.92], alpha: 0.7, fadePower: 0.6, drag: 0.2, gravity: 9.8 });

// ───────────── Additive glows ─────────────

export const MUZZLE = particleStyle({ lifeMin: 0.045, lifeMax: 0.07, size0: 0.3, size1: 0.6, jitter: 0.15, color0: [7, 5, 2.2], color1: [3, 1.4, 0.3] });
export const SPARK = particleStyle({ lifeMin: 0.18, lifeMax: 0.5, size0: 0.07, size1: 0.02, jitter: 0.4, color0: [6, 4, 1.6], color1: [2.4, 0.7, 0.1], fadePower: 0.6, drag: 1, gravity: 9.8 });
export const FLAME = particleStyle({ lifeMin: 0.35, lifeMax: 0.75, size0: 0.5, size1: 1.15, color0: [3.4, 1.6, 0.36], color1: [1.2, 0.24, 0.03], alpha: 0.7, fadeIn: 0.15, fadePower: 1.2, drag: 1.2, gravity: -3.2, wind: 0.5, spin: 2 });
export const FIREBALL = particleStyle({ lifeMin: 0.5, lifeMax: 1.05, size0: 1.3, size1: 4.2, color0: [5, 2.7, 0.8], color1: [0.9, 0.14, 0.02], alpha: 0.85, fadeIn: 0.04, fadePower: 1.6, drag: 2.2, gravity: -2.5, spin: 1.2 });
export const BLAST = particleStyle({ lifeMin: 0.1, lifeMax: 0.15, size0: 3.5, size1: 11, jitter: 0, color0: [8, 6.6, 4.4], color1: [4, 2.2, 0.8] });
export const EMBER = particleStyle({ lifeMin: 0.8, lifeMax: 1.7, size0: 0.1, size1: 0.03, jitter: 0.5, color0: [5, 2.4, 0.6], color1: [1.6, 0.3, 0.04], fadePower: 0.7, drag: 0.6, gravity: 6 });

// ───────────── Decals ─────────────

/** Recycling rings: each kind of stain has its own budget. */
export const DecalRing = { Blood: 0, Hole: 1, Scorch: 2, Pock: 3, Skid: 4 } as const;
/** Ring sizes, indexed by DecalRing. */
export const DECAL_CAPACITY: readonly number[] = [64, 60, 12, 40, 220];

export const DECAL_BLOOD_SPATTER: DecalStyle = { ring: DecalRing.Blood, tint: [0.42, 0.02, 0.02], alpha: 0.9, life: 60, fade: 10, grow: 0.25, growFrom: 0.4, soft: 0.1, irregular: 0.6, speckle: 0.9, lift: 0.03 };
export const DECAL_BLOOD_POOL: DecalStyle = { ring: DecalRing.Blood, tint: [0.3, 0.012, 0.012], alpha: 0.93, life: 60, fade: 12, grow: 14, growFrom: 0.12, soft: 0.07, irregular: 0.3, speckle: 0, lift: 0.035 };
/** Where a tyre went over someone: a streak along the road. */
export const DECAL_BLOOD_SMEAR: DecalStyle = { ring: DecalRing.Blood, tint: [0.34, 0.014, 0.014], alpha: 0.88, life: 60, fade: 10, grow: 0.3, growFrom: 0.5, soft: 0.3, irregular: 0.45, speckle: 0.6, lift: 0.03 };
/** Splashed across the panel of the car that hit them; rides on it, sitting tight to the paint. */
export const DECAL_BLOOD_CAR: DecalStyle = { ring: DecalRing.Blood, tint: [0.4, 0.02, 0.02], alpha: 0.9, life: 50, fade: 10, grow: 0, growFrom: 1, soft: 0.12, irregular: 0.6, speckle: 0.9, lift: 0.01 };
export const DECAL_HOLE: DecalStyle = { ring: DecalRing.Hole, tint: [0.1, 0.1, 0.1], alpha: 0.9, life: 45, fade: 6, grow: 0, growFrom: 1, soft: 0.45, irregular: 0.35, speckle: 0, lift: 0.012 };
export const DECAL_SCUFF: DecalStyle = { ring: DecalRing.Hole, tint: [0.3, 0.28, 0.25], alpha: 0.6, life: 30, fade: 6, grow: 0, growFrom: 1, soft: 0.6, irregular: 0.5, speckle: 0.5, lift: 0.025 };
export const DECAL_SCORCH: DecalStyle = { ring: DecalRing.Scorch, tint: [0.07, 0.06, 0.055], alpha: 0.86, life: 90, fade: 15, grow: 0.35, growFrom: 0.5, soft: 0.75, irregular: 0.45, speckle: 0.6, lift: 0.04 };
export const DECAL_BURN: DecalStyle = { ...DECAL_SCORCH, grow: 4.5, growFrom: 0.25 };
export const DECAL_POCK: DecalStyle = { ring: DecalRing.Pock, tint: [0.08, 0.08, 0.09], alpha: 0.93, life: 120, fade: 5, grow: 0, growFrom: 1, soft: 0.35, irregular: 0.3, speckle: 0, lift: 0.008 };
export const DECAL_SKID: DecalStyle = { ring: DecalRing.Skid, tint: [0.2, 0.2, 0.2], alpha: 0.5, life: 40, fade: 12, grow: 0, growFrom: 1, soft: 0, irregular: 0, speckle: -1, lift: 0.025 };

// ───────────── Bursts ─────────────

const rnd = () => Math.random() * 2 - 1;

/** A bullet striking masonry, timber or ground: dust kicked back along the normal, chips, a glint. */
export function burstWorld(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, n: THREE.Vector3, melee: boolean) {
  const count = melee ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const s = 0.6 + Math.random() * 1.1;
    smoke.emit(PUFF_WORLD, p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, n.x * s + rnd() * 0.5, n.y * s + rnd() * 0.5 + 0.2, n.z * s + rnd() * 0.5);
  }
  if (melee) return;
  for (let i = 0; i < 4; i++) {
    const s = 1.5 + Math.random() * 2.5;
    smoke.emit(CHIP, p.x, p.y, p.z, n.x * s + rnd() * 1.6, n.y * s + rnd() * 1.6 + 1.2, n.z * s + rnd() * 1.6);
  }
  for (let i = 0; i < 2; i++) {
    const s = 2 + Math.random() * 3;
    glow.emit(SPARK, p.x, p.y, p.z, n.x * s + rnd() * 2, n.y * s + rnd() * 2 + 0.5, n.z * s + rnd() * 2, 0.7);
  }
}

/** Metal: a shower of sparks and a wisp of smoke. */
export function burstVehicle(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, n: THREE.Vector3, melee: boolean) {
  const count = melee ? 3 : 9;
  for (let i = 0; i < count; i++) {
    const s = 2 + Math.random() * 5;
    glow.emit(SPARK, p.x, p.y, p.z, n.x * s + rnd() * 2.8, n.y * s + rnd() * 2.8 + 0.8, n.z * s + rnd() * 2.8);
  }
  smoke.emit(SMOKE_GUN, p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, n.x * 0.6, n.y * 0.6 + 0.3, n.z * 0.6);
}

/**
 * A person hit: a cloth puff at the entry and blood out along the shot. `d` is the unit direction
 * the bullet or bat was travelling; `amount` 0..1.5 scales the spray (0 = a punch: puff only).
 */
export function burstFlesh(smoke: ParticlePool, p: THREE.Vector3, n: THREE.Vector3, d: THREE.Vector3, amount: number) {
  smoke.emit(PUFF_CLOTH, p.x + n.x * 0.04, p.y + n.y * 0.04, p.z + n.z * 0.04, n.x * 0.5 + rnd() * 0.3, n.y * 0.5 + 0.2, n.z * 0.5 + rnd() * 0.3);
  if (amount <= 0) return;
  // Out the far side, along the shot.
  const spray = Math.round(4 + 9 * amount);
  for (let i = 0; i < spray; i++) {
    const s = 2 + Math.random() * 4.5;
    smoke.emit(BLOOD_DROP, p.x + d.x * 0.15, p.y + d.y * 0.15, p.z + d.z * 0.15, d.x * s + rnd() * 1.5, d.y * s + rnd() * 1.3 + 1, d.z * s + rnd() * 1.5);
  }
  // A little back towards the shooter.
  const back = Math.round(1 + 2 * amount);
  for (let i = 0; i < back; i++) {
    const s = 0.8 + Math.random() * 1.6;
    smoke.emit(BLOOD_DROP, p.x, p.y, p.z, n.x * s + rnd() * 0.8, n.y * s + rnd() * 0.8 + 0.8, n.z * s + rnd() * 0.8, 0.8);
  }
  smoke.emit(BLOOD_MIST, p.x + d.x * 0.1, p.y + d.y * 0.1, p.z + d.z * 0.1, d.x * 1.4, d.y * 1.4 + 0.2, d.z * 1.4, 0.6 + amount * 0.5);
  if (amount > 0.7) smoke.emit(BLOOD_MIST, p.x, p.y, p.z, n.x * 0.6, n.y * 0.6 + 0.2, n.z * 0.6, 0.7);
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

/** The instant of an explosion of `radius` metres: flash, fireball, embers, debris, smoke, a ring of dust. */
export function burstExplosion(smoke: ParticlePool, glow: ParticlePool, p: THREE.Vector3, radius: number) {
  const k = radius / 9;
  glow.emit(BLAST, p.x, p.y + 0.5, p.z, 0, 0, 0, k);
  for (let i = 0; i < 22; i++) {
    // Directions over the upper hemisphere.
    const a = Math.random() * Math.PI * 2;
    const up = Math.random();
    const flat = Math.sqrt(1 - up * up);
    const dx = Math.cos(a) * flat;
    const dz = Math.sin(a) * flat;
    const s = (2 + Math.random() * 6) * k;
    const off = Math.random() * radius * 0.16;
    glow.emit(FIREBALL, p.x + dx * off, p.y + 0.4 + up * off, p.z + dz * off, dx * s, up * s + 1.5, dz * s, k);
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = 0.2 + Math.random() * 0.8;
    const s = 6 + Math.random() * 12;
    glow.emit(EMBER, p.x, p.y + 0.4, p.z, Math.cos(a) * s * (1 - up * 0.5), up * s, Math.sin(a) * s * (1 - up * 0.5));
  }
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 4 + Math.random() * 9;
    smoke.emit(DEBRIS, p.x, p.y + 0.5, p.z, Math.cos(a) * s, 4 + Math.random() * 8, Math.sin(a) * s);
  }
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const off = Math.random() * radius * 0.22;
    smoke.emit(SMOKE_BLACK, p.x + Math.cos(a) * off, p.y + 0.6 + Math.random() * 1.2, p.z + Math.sin(a) * off, Math.cos(a) * (1 + Math.random() * 2.5), 1.6 + Math.random() * 2.6, Math.sin(a) * (1 + Math.random() * 2.5), 1.25 * k);
  }
  // Shock ring: dust driven out along the ground.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
    const s = (5 + Math.random() * 4) * k;
    smoke.emit(DUST_GRAVEL, p.x + Math.cos(a) * radius * 0.2, p.y + 0.25, p.z + Math.sin(a) * radius * 0.2, Math.cos(a) * s, 0.5 + Math.random(), Math.sin(a) * s, 1.1 * k);
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
