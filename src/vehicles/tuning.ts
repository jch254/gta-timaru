/** The universal vehicle damage and destruction rules; per-vehicle numbers live in specs.ts. Metres, seconds, m/s. */
export const TUNING = {
  /** Change in velocity over one physics step that counts as a crash event (skids, horn reactions, heat). */
  crashNoticeDv: 2.6,
  /** A harder jolt starts hurting the body: damage = (dv − crashDamageGrace) × crashDamageScale. */
  crashHurtsDv: 4.5,
  crashDamageGrace: 4,
  crashDamageScale: 2.4,
  /** Water deeper than this, close enough to sea level, drowns the engine for good. */
  drownDepth: 1.3,
  drownAboveSea: 0.6,
  /** Seconds a dead vehicle burns before it explodes. */
  burnSeconds: 4.5,
  /** The explosion a burnt-out vehicle finally makes. */
  explosionRadius: 9,
  explosionDamage: 120,
  /** Burnouts (throttle and brake together): only from below this speed, the creep stops above `burnoutCreep`. */
  burnoutBelow: 4,
  burnoutCreep: 1.6,
  /** How hard the tail swings with the steering during one, per kilogram. */
  burnoutSwing: 0.9,
};
