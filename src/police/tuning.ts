/**
 * Field tunables for the police module: distances in metres, times in seconds, speeds in m/s.
 * The heat rules live in heat.ts and the per-level response and marksmanship in response.ts.
 */
export const TUNING = {
  // ── Sight ──
  /** An officer (on foot or in a car) with line of sight inside this range has eyes on the player. */
  sightRange: 120,
  /** How far a patrol car's driver can keep a fleeing vehicle in view down a clear road. */
  pursuitSightRange: 260,
  /** Sight range multiplier at dead of night. */
  sightNightScale: 0.75,
  /** Line-of-sight ray casts spent on sight tracking per frame. */
  losPerFrame: 3,
  /** The player counts as seen for this long after the last positive check. */
  seenMemory: 1,
  /** "Right under their noses": range for traffic offences to be noticed. */
  nearSightRange: 55,

  // ── Dispatch ──
  /** Units appear on a drivable road this far from the player (along the road)… */
  spawnMin: 150,
  spawnMax: 250,
  /** …and the spot must be this far away as the crow flies. */
  spawnNearest: 115,
  spawnFarthest: 320,
  /** A police station closer than this sends its own cars. */
  stationRange: 320,
  /** Delay before the first unit is dispatched after heat appears. */
  firstResponseDelay: 1.5,
  /** A pursuit car left this far behind is quietly replaced by one nearer. */
  outrunDistance: 420,

  // ── Pursuit driving ──
  /** Inside this range (or when the player is off-road) cars steer straight at the player. */
  directRange: 40,
  /** The player is "off-road" when further than this from any drivable centreline. */
  offRoadDistance: 22,
  /** Off-road, cars only leave the road for a player nearer than this. */
  offRoadChase: 140,
  /** Route re-plan interval. */
  replan: 1.5,
  /** Below the ramming levels, pursuit cars hold about this gap behind a moving suspect. */
  tailGap: 9,
  /** When ramming, aim this many seconds ahead of the player's car. */
  ramLead: 0.7,
  /** Crew get out when the car is this close to a suspect who is on foot or stopped… */
  dismountRange: 15,
  /** …a bit further back when they intend to shoot… */
  dismountRangeArmed: 24,
  /** …and the car has slowed to this. */
  dismountSpeed: 5,
  /** A suspect vehicle slower than this counts as stopped. */
  suspectStoppedSpeed: 3,
  /** Crew run back to the car when the suspect drives further than this from it… */
  remountDistance: 40,
  /** …or gets this far away on foot. */
  remountOnFoot: 50,
  /** A suspect on foot moving faster than this is running for it: the passenger chases, the driver follows. */
  runnerSpeed: 2.5,
  /** Crew poke about on foot for this long after losing sight before going back to the car. */
  footSearch: 9,
  searchSpeed: 14,
  patrolSpeed: 13,

  // ── Officers ──
  copHealth: 120,
  armedHealth: 160,
  /** A little slower than the player's sprint (6.8): running works, dawdling does not. */
  runSpeed: 6.2,
  walkSpeed: 1.9,
  /** A body stays this long. */
  corpseSeconds: 20,
  /** A vehicle closing faster than this hurts an officer it hits. */
  vehicleHitSpeed: 3.5,
  vehicleHitDamage: 11,

  // ── Busted ──
  bustRange: 1.8,
  bustSeconds: 1.2,
  /** A player in a vehicle slower than this can be pulled out. */
  bustMaxVehicleSpeed: 2,
  /** Pointing a gun at an officer for this long counts as an assault on police. */
  aimThreatSeconds: 2,

  // ── Roadblocks ──
  roadblockMin: 180,
  roadblockMax: 300,
  /** Removed when the player is further away than this. */
  roadblockRemove: 400,
  roadblockCooldown: 14,
  /** Only thrown up ahead of a player driving at least this fast… */
  roadblockMinSpeed: 9,
  /** …on a carriageway at least this wide (two cars nose to tail do not fit a lane). */
  roadblockMinWidth: 8,

  // ── Ambient patrols (level 0) ──
  ambientChristchurch: 2,
  ambientTown: 1,
  ambientDespawn: 340,

  // ── Respray ──
  sprayRange: 6,
  sprayBase: 100,
  sprayPerLevel: 150,

  // ── Radio ──
  /** Minimum gap between ordinary radio lines; level changes cut in sooner. */
  radioGap: 6,
  radioSeconds: 3.5,
} as const;
