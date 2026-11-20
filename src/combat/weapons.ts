import type { WeaponSpec } from '../core/types';

/** The fixed weapon ids (docs/CONTRACT.md), in the order the player cycles through them. */
export const WEAPON_ORDER = ['fists', 'knife', 'bat', 'katana', 'pistol', 'shotgun', 'rifle'] as const;
export type WeaponId = (typeof WEAPON_ORDER)[number];

/**
 * Weapons as data. `damage` is per pellet; `rate` is trigger pulls per second; `spread` is the cone
 * half-angle in radians before the stance multipliers in TUNING.
 *
 * Display names are 1995 Canterbury flavour only (the club target pistol, the duck-season pump, the
 * farm .22, the knife off the boning room belt); ids and every number are fixed by the contract and playtest.
 *
 * The two blades (`blade: true`) cut rather than club: see TUNING.bladeKnock / bladeVehicleDamage and the
 * `blood` in WEAPON_FEEL. The knife is quick and short; the katana is the best thing there is to swing, is
 * not for sale (price 0) and is only ever found (src/missions/stashes.ts).
 */
export const WEAPONS: readonly WeaponSpec[] = [
  { id: 'fists', name: 'Fists', kind: 'fists', damage: 14, rate: 2.4, range: 1.5, magazine: 0, reloadTime: 0, spread: 0, pellets: 1, automatic: false, driveBy: false, price: 0 },
  { id: 'knife', name: 'Boning Knife', kind: 'melee', damage: 26, rate: 3, range: 1.6, magazine: 0, reloadTime: 0, spread: 0, pellets: 1, automatic: false, driveBy: false, price: 30, blade: true },
  { id: 'bat', name: 'Cricket Bat', kind: 'melee', damage: 32, rate: 1.5, range: 2, magazine: 0, reloadTime: 0, spread: 0, pellets: 1, automatic: false, driveBy: false, price: 45 },
  { id: 'katana', name: 'Katana', kind: 'melee', damage: 55, rate: 1.9, range: 2.4, magazine: 0, reloadTime: 0, spread: 0, pellets: 1, automatic: false, driveBy: false, price: 0, blade: true },
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
  knife: { recoil: 0, kick: 0, barrel: 0, pickupAmmo: 0, maxReserve: 0, vehicleScale: 0, falloffStart: 1, falloffMin: 1, flash: 0, blood: 1.25, carryTilt: 0 },
  bat: { recoil: 0, kick: 0, barrel: 0, pickupAmmo: 0, maxReserve: 0, vehicleScale: 0, falloffStart: 1, falloffMin: 1, flash: 0, blood: 1, carryTilt: 0 },
  katana: { recoil: 0, kick: 0, barrel: 0, pickupAmmo: 0, maxReserve: 0, vehicleScale: 0, falloffStart: 1, falloffMin: 1, flash: 0, blood: 1.5, carryTilt: 0 },
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
  /** Melee swings at or above this damage draw a bat's worth of blood; lighter ones (fists) a punch's worth. (A swing that names its weapon draws that weapon's.) */
  meleeBloodDamage: 25,
  /** A blade goes in rather than sending them flying: its share of a club's knock-back (and of the shove it gives a car). */
  bladeKnock: 0.35,
  /** All a blade does to a vehicle, whatever it does to a person: a scratch in the paint. */
  bladeVehicleDamage: 1,
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
  /** Shells in the shotgun racked in every patrol car, taken the first time the player gets behind the wheel. */
  copCarShells: 10,
  /**
   * The player's rounds carry on through a vehicle's glass and panels into whoever is sitting in their line. A
   * seated person is a capsule from `cabinLow` to `cabinHigh` metres above the seat, `cabinRadius` thick (the
   * figure in vehicles/occupant.ts: torso from about 0.2 m, crown at 1 m, shoulders 0.21 m either side), and
   * takes `cabinDamage` of what the round had left when it reached the car.
   */
  cabinLow: 0.25,
  cabinHigh: 0.8,
  cabinRadius: 0.25,
  cabinDamage: 0.8,
  /** Pickups. */
  pickupRadius: 1.4,
  pickupHeight: 0.8,
  pickupDrawDistance: 110,
  /**
   * Hidden pickups (`spawnPickup(…, { stash: true })`): the gap between the thing and the ground it lies on, how
   * close the camera must be before it is drawn at all, and its glint: a sprite this many metres across, at this
   * resting opacity, plus this much more in the brief twinkle it gives every few seconds. (An ordinary pickup's
   * halo is 1.15 m across at 0.32, seen from 110 m.)
   */
  stashClearance: 0.02,
  stashDrawDistance: 28,
  stashGlintSize: 0.34,
  stashGlint: 0.07,
  stashTwinkle: 0.3,
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
