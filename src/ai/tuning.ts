import { FOOTPATH_OFFSET } from '../core/lanes';
import type { DistrictType, RoadClass } from '../core/types';

/**
 * Every tunable number for traffic and pedestrians lives here, so the feel can be adjusted in one place.
 * Units: metres, seconds, radians, m/s.
 */

/** Autopilot: steering, speed planning, obstacle handling. */
export const DRIVE = {
  /** Pure-pursuit look-ahead distance = clamp(lookMin + lookGain × speed, lookMin, lookMax). */
  lookMin: 5,
  lookGain: 0.55,
  lookMax: 26,
  /** Mirrors the speed-sensitive steering lock in vehicles/vehicle.ts (lock = steerLock / (1 + |v| × this)). */
  steerSpeedFalloff: 0.052,
  /** Comfortable planning deceleration; the profile to any stop or slow point is v² = v₀² + 2·brake·d. */
  brake: 3.6,
  /** Lateral acceleration accepted on open-road bends and through junction turns. */
  lateral: 3.4,
  turnLateral: 3.1,
  /** Tightest turn a car is assumed to manage (limits junction turn speed estimates). */
  minTurnRadius: 4.2,
  /** Below this turn angle a junction movement counts as "straight on" (no slowing). */
  straightAngle: 0.3,
  /** Gap kept to whatever is ahead when stopped behind it: traffic, driverless cars (room to pull out), people. */
  standoff: 2.4,
  standoffParked: 9,
  standoffPerson: 2.8,
  /** Speed kept up while squeezing past something (so the sideways move can actually happen). */
  passCrawl: 2.2,
  /** Look-ahead used while pulling out from a crawl with a long way still to move over (steers hard). */
  pullOutLook: 3.4,
  /** A driver arriving at a junction from the smaller road slows to this before the line. */
  giveWaySpeed: 4.5,
  /** Drivers at or above this aggression overtake slower traffic (lane change, or the oncoming lane if clear). */
  overtakeAggression: 1.35,
  /** Extra clearance either side of the body when testing the forward corridor. */
  corridorMargin: 0.35,
  /** Obstacles further than this are ignored. */
  scanRange: 75,
  /** Sideways shift (towards the centre line) allowed to squeeze past a parked car / stopped obstacle. */
  dodgeMax: 2.3,
  /** Shift allowed once a driver has lost patience behind a stationary obstacle (crosses the centre line). */
  overtakeMax: 4.4,
  /** Seconds stopped behind something stationary before going round it. */
  overtakeAfter: 4.5,
  /** …multiplied by this when the thing ahead is live traffic in a queue (also delays the horn). */
  queuePatience: 3.5,
  /** How far ahead oncoming traffic is noticed before pulling out over the centre line. */
  oncomingRange: 140,
  /** Seconds of straight reversing to make room before pulling out round something. */
  pullOutReverse: 2,
  /** How fast the sideways shift is fed in / out, m/s (fed in faster at walking pace, where comfort is no issue). */
  dodgeRate: 2.2,
  dodgeDecay: 0.9,
  /** Stuck handling: reverse after this long without moving while trying to. */
  stuckAfter: 3,
  reverseTime: 1.7,
  /** Request a junction this far (plus braking distance) before its boundary. */
  approachPad: 12,
  /** Kerb-to-junction padding added to the widest joining road's half width (where lane paths stop). */
  junctionPad: 0.5,
  /** Stop line sits this far (plus half the car) before the junction boundary. */
  stopLineGap: 1.2,
};

/**
 * CHASES. Everything that shapes pursuit driving (target mode, and route driving at pursuit aggression)
 * is collected here. `Autopilot.aggression` ≥ `aggression` switches a driver into pursuit manners.
 */
export const PURSUIT = {
  /** At or above this aggression a driver never gives way at junctions and recovers from being stuck sooner. */
  aggression: 1.95,
  /** Target mode: within this distance of the target point the autopilot reports `arrived` and holds. */
  arriveRadius: 5,
  /** Target mode look-ahead: steer at a point this far along the line to the target (grows with speed). */
  lookMin: 6,
  lookGain: 0.45,
  lookMax: 24,
  /**
   * Target mode speed: cruiseSpeed, cut back for the turn needed to face the target.
   * allowed = sqrt(lateral / curvature) — higher `lateral` = harder cornering (and more spins).
   */
  lateral: 6.5,
  /** Never slower than this while turning towards a target (keeps momentum through hairpins). */
  minTurnSpeed: 5.5,
  /** Target more than this far off the nose (radians) and nearer than `jTurnRange`: back up and swing round. */
  behindAngle: 2.1,
  jTurnRange: 16,
  /** Road speed multiplier cap when a pursuit driver follows roads (limit × aggression, at most cruiseSpeed). */
  bendLateral: 5.2,
  junctionLateral: 4.6,
  brake: 6.5,
  /** Stuck recovery when chasing: reverse sooner and for a little longer, steering the other way. */
  stuckAfter: 1.2,
  reverseTime: 1.5,
  /** Vehicles / people this close to the target point are the quarry, not obstacles to brake for. */
  quarryRadius: 4,
  /** Swerve: sideways aim-off (m) used to pass traffic in the way instead of queueing behind it. */
  swerve: 3.2,
  /** Speed held while swerving round / forcing past traffic. */
  passSpeed: 7,
  /**
   * Road assist: when the straight line to a far target is blocked by buildings, follow the road network
   * towards it instead of grinding against a wall; drive straight at it again once it is in the clear.
   */
  roadAssist: true,
  /** Always go direct inside this range. */
  directRange: 38,
  /** How often the line of sight / plan is re-checked, and how far the target may move before re-planning. */
  recheck: 0.45,
  replanDistance: 28,
  replanSeconds: 4,
  /** Only use roads if one is this close to the vehicle. */
  roadSnap: 45,
};

/** Per-node reservations. */
export const JUNCTION = {
  /** Two movements conflict when their paths through the node come closer than this. */
  conflictDistance: 2.4,
  /** A claim not refreshed for this long is forgotten. */
  stale: 1,
  /** A granted claim blocks others for at most this long. */
  holdMax: 12,
  /** After waiting this long a vehicle outranks everything (nobody waits forever). */
  waitMax: 7,
};

/** Give way to the larger road. */
export const CLASS_RANK: Record<RoadClass, number> = {
  highway: 5,
  arterial: 4,
  street: 3,
  lane: 2,
  gravel: 1,
  pedestrian: 0,
};

/** Wandering drivers prefer to stay on bigger roads. */
export const EXIT_CLASS_WEIGHT: Record<RoadClass, number> = {
  highway: 3,
  arterial: 3,
  street: 2,
  lane: 0.4,
  gravel: 0.25,
  pedestrian: 0,
};

/** Ambient traffic population. */
export const TRAFFIC = {
  /** Targets at density 1, full daytime. */
  movingPerDensity: 14,
  parkedPerDensity: 10,
  /** Contract budget for all vehicles in the world (ambient spawning stops at this). */
  vehicleBudget: 28,
  spawnMin: 140,
  spawnMax: 260,
  despawn: 320,
  /** Right after a (re)spawn the streets are filled closer in so they are not empty. */
  seedSeconds: 6,
  seedMovingMin: 70,
  seedParkedMin: 28,
  /** Seconds between spawn attempts. */
  movingInterval: 0.3,
  parkedInterval: 0.35,
  /** Half-angle of the camera's forward cone that spawns avoid, and the distance beyond which it stops mattering. */
  coneHalfAngle: 0.66,
  coneFarDistance: 215,
  /** Above this player speed, some spawns are placed far ahead so oncoming traffic exists on the open road. */
  aheadSpeed: 11,
  aheadBias: 0.6,
  /** Keep clear of other vehicles when spawning. */
  clearMoving: 20,
  clearParked: 7.5,
  /** Stay this far from junctions when spawning. */
  nodeClearance: 14,
  /**
   * Parked cars keep further back: a car turning in sweeps from the junction box to the lane centre over
   * the first fifteen-odd metres, and a bay inside that sweep gets clipped. (It is also the law: no parking
   * within six metres of an intersection, measured from the corner.)
   */
  parkClearance: 22,
  /** Relative chance of an ambient car appearing on each road class (sparse on gravel). */
  classWeight: { highway: 1, arterial: 1, street: 0.75, lane: 0.2, gravel: 0.1, pedestrian: 0 } as Record<RoadClass, number>,
  /** Moving-traffic multiplier by the district the player is in. */
  areaFactor: { cbd: 1, shops: 1, villa: 0.9, statehouse: 0.9, industrial: 0.8, port: 0.6, township: 0.8, park: 0.8, rural: 0.5, beach: 0.6 } as Record<DistrictType, number>,
  /** Parked cars: chance per district (more in suburbs and shop streets) and per road class (none on highways). */
  parkDistrict: { cbd: 0.8, shops: 1, villa: 1, statehouse: 1, industrial: 0.5, port: 0.3, township: 0.8, park: 0.2, rural: 0.04, beach: 0.4 } as Record<DistrictType, number>,
  parkClass: { highway: 0, arterial: 0.35, street: 1, lane: 0.35, gravel: 0.12, pedestrian: 0 } as Record<RoadClass, number>,
  /** Gap between a parked car's body and the kerb. */
  kerbGap: 0.22,
  /** Fraction of ordinary drivers who sit in the inner lane on multi-lane roads. */
  innerLaneChance: 0.3,
  /** Honk after being blocked this long, then at this interval. */
  honkAfter: [2.5, 5] as const,
  honkRepeat: [4, 8] as const,
  /** Panic. */
  gunshotRadius: 45,
  ramSpeed: 4.5,
  ramRadius: 9,
  fleeSeconds: 20,
  fleeAggression: 1.9,
  bailChance: 0.25,
  /** A bailing driver waits for the car to slow to this before jumping out. */
  bailSpeed: 1.5,
  /** Hijacked drivers who put up a fight, and the chance either kind has a line to shout. */
  fightChance: 0.2,
  barkChance: 0.75,
  /** Ambient drivers cruise at this share of the car's top speed. */
  cruiseShare: 0.8,
  /** A driver with nowhere left to go slips away once further than this from the player. */
  deadEndDespawn: 90,
  /** Boy racers. */
  racerAggression: 1.7,
  racerCruise: 34,
  racerSpecs: ['v8sedan', 'coupe'],
  racerAvenues: ['Bealey', 'Fitzgerald', 'Moorhouse', 'Deans'],
  racerSpacing: 17,
  /** Buses. */
  busChance: 0.07,
  busAggression: 0.85,
  /** Wrecks are cleared after this long once the player is this far away. */
  wreckSeconds: 60,
  wreckDistance: 70,
  /** A driver stuck this many times in a row is quietly removed when out of sight. */
  stuckStrikes: 3,
};

/** Pedestrians. */
export const PEDS = {
  perDensity: 34,
  /** Contract budget for all pedestrians. */
  budget: 36,
  spawnMin: 40,
  spawnMax: 110,
  despawn: 140,
  seedSeconds: 5,
  seedMin: 14,
  spawnInterval: 0.18,
  /** Spawns inside this forward cone and nearer than coneNear are rejected (they would pop into view). */
  coneHalfAngle: 0.75,
  coneNear: 72,
  /** Relative busyness by district. */
  district: { cbd: 1, shops: 1, township: 0.55, villa: 0.4, statehouse: 0.4, beach: 0.35, park: 0.3, port: 0.12, industrial: 0.1, rural: 0.04 } as Record<DistrictType, number>,
  /** Capsule. */
  radius: 0.3,
  halfHeight: 0.56,
  /** Speeds. */
  walk: [1.15, 1.6] as const,
  run: [4.6, 5.8] as const,
  crossSpeed: 1.75,
  /** Footpath centre offset beyond the kerb, as built by the road mesher. */
  footpathOffset: FOOTPATH_OFFSET,
  /** Sideways wander within the footpath. */
  footpathJitter: 0.75,
  /** Strolling: seconds of walking between pauses, pause lengths. */
  strollSeconds: [9, 28] as const,
  pauseSeconds: [2, 6] as const,
  windowShopSeconds: [4, 9] as const,
  /** Crossing: wait for a gap of this radius, but no longer than this. */
  crossClearRadius: 26,
  crossWaitMax: [5, 10] as const,
  crossChance: 0.42,
  uTurnChance: 0.06,
  /** Danger. */
  gunshotRadius: 60,
  crimeRadius: 32,
  fleeSeconds: [12, 22] as const,
  cowerSeconds: [6, 12] as const,
  /** Share of the population: the rest flee. */
  cowerShare: 0.22,
  staunchShare: 0.08,
  /** Staunch pedestrians still run from gunfire this close. */
  staunchGunRadius: 12,
  /** A vehicle is "heading at" a pedestrian when it will arrive within this many seconds… */
  dodgeHorizon: 1.1,
  /** Share of pedestrians who see it coming and jump clear; the rest freeze. */
  dodgeChance: 0.65,
  /** …faster than this, passing within this margin of its flank. */
  dodgeSpeed: 6,
  dodgeMargin: 1,
  /** Hit by a vehicle: minimum closing speed, damage = (speed − hitDamageFrom) × hitDamageScale. */
  hitSpeed: 4,
  hitDamageFrom: 3,
  hitDamageScale: 9,
  /** Thrown by a hit: up into the air at (closing − throwFrom) × throwLift m/s, capped; spun round by up to throwSpin rad/s. */
  throwFrom: 6,
  throwLift: 0.3,
  throwLiftMax: 6,
  throwSpin: 5,
  /** The car feels it: it gives up this many kg's worth of its momentum, but never more than joltMax m/s. */
  hitMass: 40,
  joltMax: 0.9,
  /**
   * Run over where they lie (knocked flat, or already dead): any vehicle rolling faster than runOverSpeed does
   * (runOverDamage + speed × runOverScale) × (mass / runOverMass, clamped 0.5..2), at most once per runOverGap seconds.
   */
  runOverSpeed: 2,
  runOverDamage: 30,
  runOverScale: 6,
  runOverMass: 1200,
  runOverGap: 0.45,
  /** …and bounces over them: an upward kick of this many m/s at the wheel that went over. */
  runOverBump: 0.35,
  downSeconds: [3, 5.5] as const,
  corpseSeconds: 25,
  /** Everyone on the street (and every ambient driver) starts with this much health. */
  health: 100,
  /** Fists, and what an armed NPC's melee weapon keeps of its listed damage. */
  punchDamage: 9,
  meleeScale: 0.7,
  punchCooldown: [0.9, 1.5] as const,
  punchReach: 1.5,
  /** Shooting: seconds between shots = clamp((1 / weapon.rate) × fireSlowdown, fireMin, fireMax); aim error in radians. */
  fireSlowdown: [1.6, 3] as const,
  fireMin: 0.4,
  fireMax: 2.6,
  aimError: 0.05,
  aimErrorPerMetre: 0.0012,
  aimErrorPerSpeed: 0.006,
  engageRange: 24,
  /** Barks: at most one line every this many seconds, for everyone. */
  barkGap: 4.5,
  /** Screams: a panicking crowd lets one out at most this often, and a fresh fright screams this often. */
  screamGap: 0.45,
  screamChance: 0.6,
  lingerRadius: 2.3,
  lingerSeconds: 3.2,
  bumpRadius: 0.75,
  /** Two passers-by within this of each other, and both this close to the player, may strike up a yarn. */
  convoPair: 4.5,
  convoRange: 18,
  /** Seconds between looks for a pair to talk (a range), and the chance a look finds them talking. */
  convoEvery: [7, 14] as [number, number],
  convoChance: 0.6,
  /** Witnesses: how far a passer-by notices a crash, an explosion, a horn, a gun pointed their way, a chase. */
  crashWitness: 30,
  boomWitness: 45,
  hornWitness: 16,
  armedWitness: 14,
  chaseWitness: 22,
  /** The player's car hitting something at least this hard (m/s) draws a comment. */
  crashSpeed: 9,
  /** Driving at least this fast (m/s) with the police on you draws a comment from the footpath. */
  chaseSpeed: 14,
  /** Animation LOD: beyond this distance the rig updates every third frame. */
  lodDistance: 60,
  /** goTo gives up after distance / speed × this + goToGrace seconds. */
  goToSlack: 2.5,
  goToGrace: 10,
  enterTimeout: 18,
};
