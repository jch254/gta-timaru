/** Every tunable number for the mission runner and the free-roam services, in one place. Metres, seconds, dollars. */
export const TUNING = {
  /** On-foot distance at which a mission start, gun shop or safehouse can be used. */
  reach: 2.5,
  /** Seconds before the same point offers its prompt again after a dialog closes. */
  interactCooldown: 0.8,
  /** Start beacons are only drawn this close to the player. */
  beaconDistance: 420,

  /** Pre-load a destination when the player gets this close; radius of the extra streaming focus. */
  preloadDistance: 500,
  preloadRadius: 140,
  /** Default distances at which pending mission entities are created (and their area must be loaded). */
  vehicleActivate: 500,
  pedActivate: 250,
  pickupActivate: 300,
  /** Give up on a spawn that keeps failing after this many attempts (one per frame). */
  spawnTries: 240,

  /** Nothing hostile, no vehicles and no pickups are placed within a marae's cleared ground plus this margin. */
  maraeMargin: 12,

  /** A crew waiting for its cue turns on the player if one of them is hurt, or the player fires within earshot… */
  alarmEarshot: 45,
  /** …and everyone of theirs within this distance of the trouble joins in. */
  alarmRadius: 70,

  /** A blocking briefing stops holding the mission up once the player has gone this far from where it began. */
  briefingLeash: 25,

  /** "Nearly stationary" for stop / deliver steps, m/s. */
  stopSpeed: 2.5,
  /** Default radii. */
  goToRadius: 6,
  deliverRadius: 8,
  checkpointRadius: 22,
  /** A rival counts as through a checkpoint this much further out than the player has to be. */
  rivalCheckpointSlack: 8,
  /** Rival AI defaults. */
  rivalAggression: 1.6,
  rivalCruise: 34,
  /** Race grid: metres between rows. */
  gridRow: 9,
  /** Flip a stuck AI car back onto its wheels after this long, at most this often. */
  aiStuckSeconds: 8,

  /** Leftover mission vehicles / bodies are removed once the player is this far away, or after this long. */
  lingerDistance: 150,
  lingerSeconds: 90,
  /** A mission vehicle the player has driven stays until they are this far from it (and not in it). */
  lingerDrivenDistance: 300,

  /** Banners. */
  passSeconds: 5,
  failSeconds: 4,
  titleSeconds: 3.5,
  /**
   * Mint Sauce: how long the Hinds constable sticks to the stock truck before giving it away. Under the 45 s
   * of resisting that turns one light into two, so the beat stays an escort and never becomes a gunfight.
   */
  constableSeconds: 40,
  /** Seconds between a failure landing (and any respawn finishing) and the "have another go?" offer. */
  retryDelay: 2.5,
  /** Delay between passing the last mission and the "you've done it" banner. */
  finaleDelay: 7,

  /** New-game nudge: seconds after the first spawn before Mack speaks. */
  introDelay: 2.5,
  /** Starting further than this (m) from the first job, the nudge says which town it is in. */
  introFar: 1500,

  /** Safehouse: hours slept (a random amount in this range). */
  kipHours: [6, 8] as const,
  /** Gun shop. */
  armourPrice: 250,
  armourAmount: 100,
  /** Magazines of ammunition sold with a gun / as a top-up, and the top-up price as a share of the gun's. */
  shopMagazines: 3,
  ammoPriceShare: 0.2,
  /** World pickups. */
  healthRespawn: 180,
  armourRespawn: 300,
  pickupScanSeconds: 1,
  /** A one-off pickup counts as taken when a matching 'pickup' event fires with the player this close to it. */
  pickupClaimDistance: 5,
};
