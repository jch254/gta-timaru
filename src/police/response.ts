/**
 * What the force sends at each heat level, and how well its officers shoot.
 * Pure data and arithmetic (no Three, no Rapier) so it can be unit-tested.
 */

/** Pursuit vehicles on the road at once (roadblock cars are parked and counted separately). */
export const MAX_POLICE_VEHICLES = 6;
/** Officers out of their cars at once, roadblock crews included. */
export const MAX_ON_FOOT = 8;
/** Roadblocks alive at once (two cars each). */
export const MAX_ROADBLOCKS = 2;

export type CopWeapon = 'pistol' | 'shotgun';

export interface Response {
  /** Pursuit vehicles wanted on the road. */
  cars: number;
  /** One of them is the armed-response van (when a `van` spec exists). */
  van: boolean;
  /** Officers open fire instead of going for the collar. */
  shoot: boolean;
  /** The passenger of each car carries a shotgun. */
  shotguns: boolean;
  /** Autopilot cruise cap in m/s (only bites on the open road: in town the road limit × aggression is lower). */
  cruise: number;
  /** Autopilot aggression: road speed is limit × this; from about 2 up the autopilot drives as a pursuit car. */
  aggression: number;
  /** Aim at a point just ahead of the player's car and stop braking for it. */
  ram: boolean;
  /** Roadblocks to keep ahead of the player. */
  roadblocks: number;
  /** Seconds between dispatching units. */
  spawnInterval: number;
}

const TABLE: readonly Response[] = [
  { cars: 0, van: false, shoot: false, shotguns: false, cruise: 13, aggression: 1, ram: false, roadblocks: 0, spawnInterval: 8 },
  // 1: the nearest patrol car comes for a look; officers try to make an arrest.
  { cars: 1, van: false, shoot: false, shotguns: false, cruise: 28, aggression: 1.7, ram: false, roadblocks: 0, spawnInterval: 4 },
  // 2: active pursuit by two cars.
  { cars: 2, van: false, shoot: false, shotguns: false, cruise: 38, aggression: 2.1, ram: false, roadblocks: 0, spawnInterval: 3 },
  // 3: three cars (a fourth once it heats up), pistols out, roadblocks begin. Cruise sits just under the
  // ute's top speed: an honest playtest showed that at 46 nothing short of the V8 could ever break their
  // line of sight, which made the evade rules (and two missions) unwinnable in ordinary cars.
  { cars: 3, van: false, shoot: true, shotguns: false, cruise: 40, aggression: 2.4, ram: false, roadblocks: 1, spawnInterval: 2.5 },
  // 4: more cars, shotguns, ramming.
  { cars: 5, van: false, shoot: true, shotguns: true, cruise: 48, aggression: 2.8, ram: true, roadblocks: 2, spawnInterval: 2 },
  // 5: everything, plus the Armed Response Section's van.
  { cars: MAX_POLICE_VEHICLES, van: true, shoot: true, shotguns: true, cruise: 58, aggression: 3.2, ram: true, roadblocks: 2, spawnInterval: 1.5 },
];
const LEVEL3_HOT: Response = { ...TABLE[3], cars: 4 };

/** Response for a level; `heat` (0..1 within the level) brings the fourth car out at level 3. */
export function responseFor(level: number, heat = 0): Response {
  const l = Math.min(TABLE.length - 1, Math.max(0, Math.floor(level)));
  return l === 3 && heat >= 0.5 ? LEVEL3_HOT : TABLE[l];
}

export interface AimProfile {
  /** Opens fire inside this distance (metres)… */
  range: number;
  /** …and stops closing in once inside this fraction of it. */
  hold: number;
  /** Aim error (standard deviation, radians) at point-blank on a still target… */
  base: number;
  /** …plus this much per metre of range… */
  perMetre: number;
  /** …plus this much per m/s the target is moving. */
  perSpeed: number;
  /** Seconds to react after first getting a clear shot [min, max]. */
  reaction: readonly [number, number];
  /** Shots per burst [min, max]. */
  burst: readonly [number, number];
  /** Seconds between shots in a burst [min, max]. */
  shotGap: readonly [number, number];
  /** Seconds between bursts [min, max]. */
  pause: readonly [number, number];
}

export const AIM: Record<CopWeapon, AimProfile> = {
  pistol: { range: 38, hold: 0.45, base: 0.04, perMetre: 0.0028, perSpeed: 0.014, reaction: [0.7, 1.4], burst: [1, 3], shotGap: [0.4, 0.75], pause: [1.3, 2.6] },
  shotgun: { range: 22, hold: 0.5, base: 0.05, perMetre: 0.003, perSpeed: 0.012, reaction: [0.9, 1.6], burst: [1, 1], shotGap: [1.1, 1.5], pause: [1.4, 2.4] },
};

/** Standard deviation of an officer's aim error in radians: worse at range and at a fast-moving target. */
export function aimError(weapon: CopWeapon, distance: number, targetSpeed: number): number {
  const a = AIM[weapon];
  return a.base + a.perMetre * Math.max(0, distance) + a.perSpeed * Math.min(30, Math.max(0, targetSpeed));
}

/** Price of a respray and new plates at a given heat level, in dollars (rates from police tuning). */
export function sprayCost(level: number, base: number, perLevel: number): number {
  return base + perLevel * Math.max(1, Math.min(5, Math.round(level)));
}
