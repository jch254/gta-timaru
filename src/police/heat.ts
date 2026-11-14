import type { CrimeType } from '../core/types';

/**
 * The heat state machine: crime → heat → level, and how heat is lost again.
 * Pure logic (no Three, no Rapier, no GameContext) so it can be unit-tested.
 *
 * `level` is 0..5 and `heat` is the fraction 0..1 towards the next level, so `level + heat` is one
 * continuous scale. A crime adds heat (in levels), may lift the level to a floor, and cannot push the
 * scale past its own cap: shoplifting-grade offences never bring out the shotguns.
 */

export const MAX_LEVEL = 5;

export type Witness = 'none' | 'ped' | 'cop';

export interface CrimeRule {
  /** Heat added, in levels (1 = one whole level). */
  heat: number;
  /** A witnessed crime lifts the level to at least this. */
  floor: number;
  /** …and to at least this when a constable saw it first-hand. */
  copFloor: number;
  /** Highest level this kind of crime can push to on its own. */
  cap: number;
  /** A witness within this distance with line of sight reports it (metres; police see further). */
  sightRadius: number;
  /** Heard within this distance whether or not it was seen (0 = silent). */
  hearRadius: number;
  /** Crimes against the police themselves: always count, no witness needed. */
  always: boolean;
  /** Only the police take any notice (traffic offences). */
  copsOnly: boolean;
  /** Seconds before the same kind of crime adds heat again (stops per-bullet spam). */
  cooldown: number;
}

/** Severity table. Tune here. */
export const CRIME_RULES: Record<CrimeType, CrimeRule> = {
  carTheft: { heat: 0.35, floor: 0, copFloor: 1, cap: 2, sightRadius: 30, hearRadius: 0, always: false, copsOnly: false, cooldown: 0 },
  carjacking: { heat: 0.6, floor: 1, copFloor: 1, cap: 2, sightRadius: 40, hearRadius: 0, always: false, copsOnly: false, cooldown: 0 },
  assault: { heat: 0.5, floor: 0, copFloor: 1, cap: 2, sightRadius: 30, hearRadius: 0, always: false, copsOnly: false, cooldown: 1 },
  hitAndRun: { heat: 0.6, floor: 1, copFloor: 1, cap: 3, sightRadius: 45, hearRadius: 0, always: false, copsOnly: false, cooldown: 1 },
  vehicleDamage: { heat: 0.3, floor: 0, copFloor: 1, cap: 2, sightRadius: 35, hearRadius: 0, always: false, copsOnly: false, cooldown: 2 },
  gunfire: { heat: 0.3, floor: 1, copFloor: 2, cap: 2, sightRadius: 60, hearRadius: 90, always: false, copsOnly: false, cooldown: 2 },
  murder: { heat: 1.2, floor: 2, copFloor: 2, cap: 4, sightRadius: 50, hearRadius: 0, always: false, copsOnly: false, cooldown: 0 },
  copAssault: { heat: 0.35, floor: 2, copFloor: 2, cap: 3, sightRadius: 0, hearRadius: 0, always: true, copsOnly: false, cooldown: 2.5 },
  copKilled: { heat: 1, floor: 3, copFloor: 3, cap: 5, sightRadius: 0, hearRadius: 0, always: true, copsOnly: false, cooldown: 0 },
  recklessDriving: { heat: 0.5, floor: 0, copFloor: 0, cap: 1, sightRadius: 45, hearRadius: 0, always: false, copsOnly: true, cooldown: 4 },
};

const CRIME_TYPES = Object.keys(CRIME_RULES) as CrimeType[];

/** Seconds out of sight before the level drops by one, indexed by level. */
export const EVADE_SECONDS: readonly number[] = [0, 14, 20, 28, 36, 45];
/** Heat per second for running from officers who can see you (resisting). Tops out at level 3. */
export const PURSUIT_HEAT_RATE: readonly number[] = [0, 1 / 45, 1 / 75, 0, 0, 0];
/** Below level 1, heat fades at this rate once things have been quiet for a moment. */
export const IDLE_DECAY = 0.04;
export const IDLE_DECAY_DELAY = 6;
/** Police witnesses see this much further than the public… */
export const COP_SIGHT_SCALE = 1.5;
/** …and what they see first-hand counts for this much more. */
export const COP_HEAT_SCALE = 1.25;
/** How far into its cap level a crime may fill the heat bar. */
const CAP_FILL = 0.95;

export interface WitnessCandidate {
  kind: 'cop' | 'ped';
  /** Horizontal distance from the crime, metres. */
  distance: number;
}

/** 0 = too far to notice, 1 = notices if it has line of sight, 2 = notices regardless (heard it). */
export function witnessRange(rule: CrimeRule, kind: 'cop' | 'ped', distance: number): 0 | 1 | 2 {
  if (rule.copsOnly && kind !== 'cop') return 0;
  if (rule.hearRadius > 0 && distance <= rule.hearRadius) return 2;
  return distance <= rule.sightRadius * (kind === 'cop' ? COP_SIGHT_SCALE : 1) ? 1 : 0;
}

/**
 * Decide who, if anyone, witnessed a crime. `candidates` are the live bystanders nearest-first (the caller
 * leaves out the dead, including a dead victim); `hasSight` is only asked when it matters, and at most
 * `maxSightChecks` times, so a crowd cannot cost a crowd of ray casts.
 */
export function judgeWitnesses<T extends WitnessCandidate>(rule: CrimeRule, candidates: readonly T[], hasSight: (candidate: T) => boolean, maxSightChecks = 6): Witness {
  if (rule.always) return 'cop';
  let checks = 0;
  let ped = false;
  // Police first: a constable's own eyes beat a phone call from the public.
  for (const c of candidates) {
    if (c.kind !== 'cop') continue;
    const range = witnessRange(rule, 'cop', c.distance);
    if (range === 2) return 'cop';
    if (range === 1 && checks < maxSightChecks) {
      checks++;
      if (hasSight(c)) return 'cop';
    }
  }
  for (const c of candidates) {
    if (c.kind !== 'ped' || ped) continue;
    const range = witnessRange(rule, 'ped', c.distance);
    if (range === 2) ped = true;
    else if (range === 1 && checks < maxSightChecks) {
      checks++;
      if (hasSight(c)) ped = true;
    }
  }
  return ped ? 'ped' : 'none';
}

export class HeatModel {
  /** 0..5 */
  level = 0;
  /** 0..1 within the level. */
  heat = 0;
  /** Seconds until the level drops while out of sight; 0 while seen or clean. */
  evading = 0;
  /** Missions can suspend the law: while false, crimes are ignored. */
  enabled = true;
  /** Called on every level change. */
  onLevelChanged: ((level: number, previous: number) => void) | null = null;

  private evadeLeft = 0;
  private quiet = 0;
  private cooldowns: Record<CrimeType, number>;

  constructor() {
    this.cooldowns = {} as Record<CrimeType, number>;
    for (const t of CRIME_TYPES) this.cooldowns[t] = 0;
  }

  /** Would a crime of this type register right now (law enabled and not in its cooldown)? */
  ready(type: CrimeType): boolean {
    return this.enabled && this.cooldowns[type] <= 0;
  }

  /** A crime happened. Returns true if it added heat. */
  report(type: CrimeType, witness: Witness): boolean {
    const rule = CRIME_RULES[type];
    if (!this.ready(type)) return false;
    const byCop = rule.always || witness === 'cop';
    if (!byCop && (witness === 'none' || rule.copsOnly)) return false;

    this.cooldowns[type] = rule.cooldown;
    this.quiet = 0;
    const before = this.level + this.heat;
    const floor = byCop ? Math.max(rule.floor, rule.copFloor) : rule.floor;
    const ceiling = Math.max(floor, rule.cap >= MAX_LEVEL ? MAX_LEVEL + 1 : rule.cap + CAP_FILL);
    const added = rule.heat * (byCop && !rule.always ? COP_HEAT_SCALE : 1);
    const total = Math.max(before, Math.min(Math.max(before + added, floor), ceiling));
    this.setTotal(total);
    // A fresh report restarts the search.
    if (this.level > 0) this.evadeLeft = EVADE_SECONDS[this.level];
    return true;
  }

  /**
   * Advance time. `seen`: an officer has line of sight to the player right now. `fleeing`: the player is
   * seen and on the move (running from the law slowly makes things worse at low levels).
   */
  update(dt: number, seen: boolean, fleeing = false) {
    for (const t of CRIME_TYPES) if (this.cooldowns[t] > 0) this.cooldowns[t] -= dt;

    if (this.level === 0) {
      this.evading = 0;
      if (this.heat > 0) {
        this.quiet += dt;
        if (this.quiet > IDLE_DECAY_DELAY) this.heat = Math.max(0, this.heat - IDLE_DECAY * dt);
      }
      return;
    }
    if (seen) {
      this.evadeLeft = EVADE_SECONDS[this.level];
      this.evading = 0;
      const rate = fleeing ? PURSUIT_HEAT_RATE[this.level] : 0;
      if (rate > 0) this.setTotal(this.level + this.heat + rate * dt);
      return;
    }
    // Out of sight: the trail goes cold.
    this.evadeLeft -= dt;
    this.heat = Math.max(0, this.heat - dt / EVADE_SECONDS[this.level]);
    if (this.evadeLeft <= 0) this.setTotal(this.level - 1);
    this.evading = this.level > 0 ? this.evadeLeft : 0;
  }

  setLevel(level: number) {
    const target = Math.min(MAX_LEVEL, Math.max(0, Math.round(Number.isFinite(level) ? level : 0)));
    this.quiet = 0;
    if (target === this.level) {
      if (target > 0) this.evadeLeft = EVADE_SECONDS[target];
      return;
    }
    this.setTotal(target);
  }

  /** Add (or remove) heat in levels; crossing a whole number changes the level. */
  addHeat(amount: number) {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.quiet = 0;
    this.setTotal(this.level + this.heat + amount);
    if (amount > 0 && this.level > 0) this.evadeLeft = EVADE_SECONDS[this.level];
  }

  clear() {
    for (const t of CRIME_TYPES) this.cooldowns[t] = 0;
    this.quiet = 0;
    this.setTotal(0);
    this.heat = 0;
    this.evadeLeft = 0;
    this.evading = 0;
  }

  /** The description no longer fits (new wheels while nobody was looking): halve what is left to wait out. */
  halveEvade(): boolean {
    if (this.level === 0 || this.evading <= 0) return false;
    this.evadeLeft *= 0.5;
    this.evading = this.evadeLeft;
    return true;
  }

  private setTotal(total: number) {
    const t = Math.min(Math.max(total, 0), MAX_LEVEL + 1);
    const level = Math.min(MAX_LEVEL, Math.floor(t + 1e-6));
    const previous = this.level;
    this.level = level;
    this.heat = Math.min(1, Math.max(0, t - level));
    if (level !== previous) {
      this.evadeLeft = EVADE_SECONDS[level];
      this.evading = 0;
      this.onLevelChanged?.(level, previous);
    }
  }
}
