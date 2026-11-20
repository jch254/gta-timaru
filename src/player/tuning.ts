/** Every tunable number for the player, in one place. Metres, seconds, m/s, in-game hours, dollars. */
export const TUNING = {
  /** Health a new game and a hospital bed both give. */
  maxHealth: 100,
  /** The player is outnumbered in every fight and has no cover system to lean on, so other people's
   *  bullets and bats bite less than the player's own do. */
  bulletTaken: 0.55,
  meleeTaken: 0.75,
  /** Share of incoming damage the armour soaks up while it lasts (never for falls or drowning). */
  armourShare: 0.75,
  /** Seconds lying there before the respawn fade. */
  deathSeconds: 3,
  /** Hospital bill / bail: whichever is more of the flat fee and the share of cash. */
  feeFlat: 50,
  feeShare: 0.1,
  /** In-game hours lost to a hospital stay / a night in the cells. */
  hospitalHours: 6,
  custodyHours: 3,
  /** Jump take-off speed (m/s up) and on-foot gravity (m/s per second, down). */
  jumpSpeed: 6.6,
  gravity: 22,
  /** Landing faster than this (m/s down) hurts: damage = (speed − fallGrace) × fallScale. */
  fallHurts: 14,
  fallGrace: 13,
  fallScale: 7,
  /** Top speed on foot: aiming / sprinting / walking. Cop runSpeed and ped run ranges are balanced against these. */
  aimSpeed: 1.9,
  sprintSpeed: 6.8,
  walkSpeed: 3.9,
  /** Wading deeper than wadeDepth slows the player to wadeFactor; past drownDepth it hurts, per second. */
  wadeDepth: 0.4,
  wadeFactor: 0.5,
  drownDepth: 1.5,
  drownPerSecond: 18,
  /** Seated in a vehicle, the head is this far above the seat: under the water there, the driver drowns. */
  seatedHead: 0.8,
  /** Vehicle-enter reach: a coarse search radius, refined to half the car's length plus an arm. */
  enterRadius: 4.2,
  enterReach: 2.2,
};
