import type { WeaponSpec } from '../core/types';

/** The fixed weapon ids (docs/CONTRACT.md), in the order the player cycles through them. */
export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'shotgun', 'rifle'] as const;
export type WeaponId = (typeof WEAPON_ORDER)[number];

/**
 * Weapons as data. `damage` is per pellet; `rate` is trigger pulls per second; `spread` is the cone
 * half-angle in radians before the stance multipliers in TUNING.
 *
 * Display names are 1995 Canterbury flavour only (the club target pistol, the duck-season pump, the
 * farm .22); ids and every number are fixed by the contract and playtest.
 */
export const WEAPONS: readonly WeaponSpec[] = [
  { id: 'fists', name: 'Fists', kind: 'fists', damage: 14, rate: 2.4, range: 1.5, magazine: 0, reloadTime: 0, spread: 0, pellets: 1, automatic: false, driveBy: false, price: 0 },
  { id: 'bat', name: 'Cricket Bat', kind: 'melee', damage: 32, rate: 1.5, range: 2, magazine: 0, reloadTime: 0, spread: 0, pellets: 1, automatic: false, driveBy: false, price: 45 },
  { id: 'pistol', name: 'Target Pistol', kind: 'pistol', damage: 26, rate: 3.6, range: 70, magazine: 9, reloadTime: 1.5, spread: 0.02, pellets: 1, automatic: false, driveBy: true, price: 400 },
  { id: 'shotgun', name: 'Duck Gun', kind: 'shotgun', damage: 13, rate: 1, range: 30, magazine: 5, reloadTime: 2.8, spread: 0.085, pellets: 8, automatic: false, driveBy: false, price: 850 },
  { id: 'rifle', name: '.22 Rabbit Rifle', kind: 'rifle', damage: 70, rate: 0.8, range: 240, magazine: 5, reloadTime: 2.6, spread: 0.003, pellets: 1, automatic: false, driveBy: false, price: 1200 },
];

/** Handling data the shared WeaponSpec has no field for. */
export interface WeaponFeel {
  /** Camera shake per shot (PlayerApi.shakeCamera), 0..1. */
  recoil: number;
  /** View kick per shot in radians: the camera snaps up by this much, then springs back. */
  kick: number;
  /** Grip-to-muzzle distance in metres: where tracers and the flash start. */
  barrel: number;
  /** Rounds a world pickup grants when the caller gives no amount. */
  pickupAmmo: number;
  /** Most spare rounds the player can carry. */
  maxReserve: number;
  /** Damage multiplier against vehicles (guns; melee uses TUNING.meleeVehicle*). */
  vehicleScale: number;
  /** Fraction of `range` where damage starts to drop, and the fraction of damage left at full range. */
  falloffStart: number;
  falloffMin: number;
  /** Muzzle flash size multiplier. */
  flash: number;
  /** Blood drawn by one hit on a person, 0 (none) .. 1.5 (a head shot draws half as much again). */
  blood: number;
  /** Extra radians the player tips the weapon up from the forearm when carrying it (not aiming). */
  carryTilt: number;
}

export const WEAPON_FEEL: Record<WeaponId, WeaponFeel> = {
  fists: { recoil: 0, kick: 0, barrel: 0, pickupAmmo: 0, maxReserve: 0, vehicleScale: 0, falloffStart: 1, falloffMin: 1, flash: 0, blood: 0.3, carryTilt: 0 },
  bat: { recoil: 0, kick: 0, barrel: 0, pickupAmmo: 0, maxReserve: 0, vehicleScale: 0, falloffStart: 1, falloffMin: 1, flash: 0, blood: 1, carryTilt: 0 },
  pistol: { recoil: 0.1, kick: 0.016, barrel: 0.2, pickupAmmo: 18, maxReserve: 180, vehicleScale: 0.45, falloffStart: 0.5, falloffMin: 0.6, flash: 1, blood: 1, carryTilt: 0.1 },
  shotgun: { recoil: 0.38, kick: 0.06, barrel: 0.75, pickupAmmo: 10, maxReserve: 60, vehicleScale: 0.4, falloffStart: 0.3, falloffMin: 0.25, flash: 1.8, blood: 0.5, carryTilt: 0.3 },
  rifle: { recoil: 0.2, kick: 0.036, barrel: 0.7, pickupAmmo: 10, maxReserve: 60, vehicleScale: 0.5, falloffStart: 0.7, falloffMin: 0.8, flash: 1.25, blood: 1.3, carryTilt: 0.3 },
};

export const feelOf = (id: string): WeaponFeel => WEAPON_FEEL[id as WeaponId] ?? WEAPON_FEEL.fists;

/** Fires projectiles (as opposed to swinging). */
export const isRanged = (spec: WeaponSpec): boolean => spec.kind !== 'fists' && spec.kind !== 'melee';
/** Held two-handed at the shoulder (drives the `aimRifle` pose). */
export const isLongGun = (spec: WeaponSpec): boolean => spec.kind === 'shotgun' || spec.kind === 'rifle' || spec.kind === 'smg';

/** Everything worth tuning that is not per-weapon. */
export const TUNING = {
  /** Spread multipliers for the player: aiming down the sights, shooting from the hip, from a car window. */
  aimSpread: 0.7,
  hipSpread: 1.5,
  driveBySpread: 1.8,
  /** A fire press this many seconds early still fires when the weapon comes ready. */
  fireBuffer: 0.18,
  /** Seconds the gun stays raised (and tracks the camera) after a shot from the hip. */
  hipFireStance: 0.5,
  /** Melee: seconds from the start of the swing to the hit, default reach (m), fan half-angle (rad). */
  meleeHitDelay: 0.13,
  meleeReach: 1.6,
  meleeArc: 0.6,
  /** Knock-back speed (m/s) per point of melee damage, and its limits. */
  meleeKnock: 0.1,
  meleeKnockMin: 1.2,
  meleeKnockMax: 4,
  /** A swing does (damage − floor) × scale to a vehicle: fists barely mark a car, the bat dents it. */
  meleeVehicleFloor: 10,
  meleeVehicleScale: 0.5,
  /** Melee swings at or above this damage draw a bat's worth of blood; lighter ones (fists) a punch's worth. */
  meleeBloodDamage: 25,
  /** Shove (m/s) a bullet gives per point of damage, and its cap. */
  bulletKnock: 0.04,
  bulletKnockMax: 2,
  /** How fast the view kick springs back (1/s), its sideways wander as a fraction of the climb, and its scale in a vehicle. */
  kickDecay: 9,
  kickYaw: 0.35,
  kickDriveBy: 0.5,
  /** How quickly the held gun swings onto the aim line (1/s). */
  aimAlignRate: 18,
  /** Minimum real seconds between 'gunfire' / 'vehicleDamage' crime reports. */
  gunfireCrimeInterval: 2,
  vehicleCrimeInterval: 1,
  /** Explosions: full damage inside this fraction of the radius, then linear to zero at the radius. */
  explosionCore: 0.25,
  /** Damage multiplier for actors with solid world between them and the blast. */
  explosionCover: 0.35,
  explosionVehicleScale: 1,
  /** Velocity change (m/s) given to a vehicle at the core: outwards and upwards. */
  explosionPush: 5.5,
  explosionLift: 2.6,
  /** Knock given to people caught in a blast (m/s at the core). */
  explosionKnock: 5,
  /** Pickups. */
  pickupRadius: 1.4,
  pickupHeight: 0.8,
  pickupDrawDistance: 110,
  healthPickup: 50,
  armourPickup: 50,
  cashPickup: 50,
  /** Cash dropped by pedestrians and gang members when they die. */
  cashDropChance: 0.4,
  cashDropMin: 5,
  cashDropMax: 50,
  cashDropSeconds: 60,
  maxCashDrops: 10,
} as const;
