import type { WeaponSpec } from '../core/types';

export interface AmmoState {
  clip: number;
  reserve: number;
}

/**
 * What a trigger pull did.
 *  - 'fired'      a round left the clip (the caller does the shot)
 *  - 'cooldown'   the weapon is between shots
 *  - 'reloading'  a reload is running (or was just started because the clip was empty)
 *  - 'empty'      no rounds anywhere: dry click
 *  - 'melee'      the current weapon does not shoot
 */
export type FireResult = 'fired' | 'cooldown' | 'reloading' | 'empty' | 'melee';

export interface InventorySave {
  v: 1;
  current: string;
  weapons: { id: string; clip: number; reserve: number }[];
}

/** Seconds before a freshly drawn weapon can fire. */
export const DRAW_TIME = 0.3;
const EPSILON = 1e-6;

const shoots = (spec: WeaponSpec) => spec.kind !== 'fists' && spec.kind !== 'melee';
const whole = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/**
 * The player's weapons, ammunition and the fire / reload state machine. Pure logic: no scene, no
 * input, no clock other than the `dt` passed to `update`.
 */
export class Inventory {
  currentId: string;
  /** Seconds left of the running reload; 0 when not reloading. */
  reloadLeft = 0;
  /** Reload notifications (sound, HUD). */
  onReload: ((phase: 'start' | 'done', weaponId: string) => void) | null = null;

  private readonly owned = new Map<string, AmmoState>();
  /** Seconds until each weapon may fire again, indexed like `order`. */
  private readonly cool: Float64Array;
  private readonly slot = new Map<string, number>();

  /**
   * @param specs      every weapon by id
   * @param order      cycling order; `order[0]` is the weapon that can never be lost (fists)
   * @param maxReserve cap on spare rounds per weapon
   */
  constructor(
    private readonly specs: ReadonlyMap<string, WeaponSpec>,
    private readonly order: readonly string[],
    private readonly maxReserve: (id: string) => number = () => 999,
  ) {
    this.currentId = order[0];
    this.owned.set(order[0], { clip: 0, reserve: 0 });
    this.cool = new Float64Array(order.length);
    order.forEach((id, i) => this.slot.set(id, i));
  }

  get current(): WeaponSpec {
    return this.specs.get(this.currentId)!;
  }

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  has(id: string): boolean {
    return this.owned.has(id);
  }

  /** Owned weapon ids in cycling order. */
  list(): string[] {
    return this.order.filter((id) => this.owned.has(id));
  }

  /** Rounds in the clip and in reserve (a copy; zeros for melee or weapons not owned). */
  ammo(id: string = this.currentId): AmmoState {
    const a = this.owned.get(id);
    return a ? { clip: a.clip, reserve: a.reserve } : { clip: 0, reserve: 0 };
  }

  /** True when a pickup of `id` would add nothing (melee already owned, or reserve full). */
  full(id: string): boolean {
    const spec = this.specs.get(id);
    const a = this.owned.get(id);
    if (!spec || !a) return false;
    return !shoots(spec) || a.reserve >= this.maxReserve(id);
  }

  /**
   * Add a weapon and / or ammunition. A new gun arrives loaded (the clip is filled first). A new
   * weapon is drawn straight away if the player is unarmed.
   */
  give(id: string, ammo = 0): 'unknown' | 'new' | 'ammo' | 'none' {
    const spec = this.specs.get(id);
    if (!spec) return 'unknown';
    const rounds = shoots(spec) ? whole(ammo) : 0;
    const have = this.owned.get(id);
    if (!have) {
      const clip = Math.min(spec.magazine, rounds);
      this.owned.set(id, { clip, reserve: Math.min(this.maxReserve(id), rounds - clip) });
      if (this.currentId === this.order[0]) this.select(id);
      return 'new';
    }
    if (rounds <= 0) return 'none';
    const before = have.reserve;
    have.reserve = Math.min(this.maxReserve(id), have.reserve + rounds);
    if (id === this.currentId && have.clip === 0) this.startReload();
    return have.reserve > before ? 'ammo' : 'none';
  }

  /** Draw a weapon. Returns true if the current weapon changed. */
  select(id: string): boolean {
    if (id === this.currentId || !this.owned.has(id)) return false;
    this.currentId = id;
    this.reloadLeft = 0; // an interrupted reload is lost
    const slot = this.slot.get(id);
    if (slot !== undefined) this.cool[slot] = Math.max(this.cool[slot], DRAW_TIME);
    const a = this.owned.get(id)!;
    if (shoots(this.current) && a.clip === 0 && a.reserve > 0) this.startReload();
    return true;
  }

  /** Next (+1) or previous (−1) owned weapon. */
  cycle(direction: 1 | -1): boolean {
    const list = this.list();
    if (list.length < 2) return false;
    const i = list.indexOf(this.currentId);
    return this.select(list[(i + direction + list.length) % list.length]);
  }

  /** Pull the trigger once. */
  tryFire(): FireResult {
    const spec = this.current;
    if (!shoots(spec)) return 'melee';
    if (this.reloadLeft > 0) return 'reloading';
    const slot = this.slot.get(spec.id);
    if (slot === undefined) return 'melee';
    if (this.cool[slot] > 0) return 'cooldown';
    const a = this.owned.get(spec.id)!;
    if (a.clip <= 0) return this.startReload() ? 'reloading' : 'empty';
    a.clip--;
    this.cool[slot] = 1 / spec.rate;
    if (a.clip === 0) this.startReload(); // empty: reload without being asked
    return 'fired';
  }

  /** Begin reloading the current weapon. False if there is nothing to do. */
  startReload(): boolean {
    const spec = this.current;
    const a = this.owned.get(spec.id)!;
    if (!shoots(spec) || this.reloadLeft > 0 || a.reserve <= 0 || a.clip >= spec.magazine) return false;
    this.reloadLeft = Math.max(0.01, spec.reloadTime);
    this.onReload?.('start', spec.id);
    return true;
  }

  /** Advance timers. Returns true on the step a reload completes. */
  update(dt: number): boolean {
    // Anything within a microsecond of done is done: frame steps rarely sum exactly.
    const cool = this.cool;
    for (let i = 0; i < cool.length; i++) if (cool[i] > 0) cool[i] = cool[i] - dt > EPSILON ? cool[i] - dt : 0;
    if (this.reloadLeft <= 0) return false;
    this.reloadLeft -= dt;
    if (this.reloadLeft > EPSILON) return false;
    this.reloadLeft = 0;
    const spec = this.current;
    const a = this.owned.get(spec.id)!;
    const take = Math.min(spec.magazine - a.clip, a.reserve);
    a.clip += take;
    a.reserve -= take;
    this.onReload?.('done', spec.id);
    return true;
  }

  /** Lose everything but the first weapon. Returns true if the current weapon changed. */
  disarm(): boolean {
    const first = this.order[0];
    const changed = this.currentId !== first;
    this.owned.clear();
    this.cool.fill(0);
    this.owned.set(first, { clip: 0, reserve: 0 });
    this.currentId = first;
    this.reloadLeft = 0;
    return changed;
  }

  /** Keep the weapons, lose half the spare rounds (hospital). */
  halveReserve() {
    for (const a of this.owned.values()) a.reserve = Math.floor(a.reserve / 2);
  }

  serialize(): InventorySave {
    const weapons: InventorySave['weapons'] = [];
    for (const id of this.list()) {
      if (id === this.order[0]) continue;
      const a = this.owned.get(id)!;
      weapons.push({ id, clip: a.clip, reserve: a.reserve });
    }
    return { v: 1, current: this.currentId, weapons };
  }

  /** Restore from `serialize()` output. Anything malformed or unknown is dropped. */
  deserialize(data: unknown) {
    this.disarm();
    if (!data || typeof data !== 'object') return;
    const save = data as Partial<InventorySave>;
    if (Array.isArray(save.weapons)) {
      for (const entry of save.weapons as unknown[]) {
        if (!entry || typeof entry !== 'object') continue;
        const w = entry as { id?: unknown; clip?: unknown; reserve?: unknown };
        const spec = typeof w.id === 'string' ? this.specs.get(w.id) : undefined;
        if (!spec || spec.id === this.order[0]) continue;
        const gun = shoots(spec);
        this.owned.set(spec.id, {
          clip: gun ? Math.min(spec.magazine, whole(w.clip)) : 0,
          reserve: gun ? Math.min(this.maxReserve(spec.id), whole(w.reserve)) : 0,
        });
      }
    }
    if (typeof save.current === 'string' && this.owned.has(save.current)) this.currentId = save.current;
  }
}
