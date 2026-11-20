/**
 * Free-roam services the missions module owns: gun shops, safehouses, their map blips, and a handful of
 * world pickups that appear once their corner of the map has streamed in.
 */
import { settle } from '../core/async';
import type { GameContext, Place } from '../core/types';
import { maraeAt, newResolved, resolveSpot } from './spots';
import { findStashes, STASH } from './stashes';
import { TUNING } from './tuning';
import type { Spot } from './types';
import { warnOnce } from './warn';

export interface WorldPickup {
  id: string;
  /** 'health' | 'armour' | 'cash' | weapon id. */
  kind: string;
  at: Spot;
  amount?: number;
  /** Seconds until it comes back. Omitted = a one-off, remembered in the save once taken. */
  respawn?: number;
}

/** Near the safehouses, plus a few rewards for poking about. Positions hang off contract places. */
export const WORLD_PICKUPS: readonly WorldPickup[] = [
  { id: 'bat-bay-hill', kind: 'bat', at: { place: 'timaru-spawn', snap: 'verge', along: 9 } },
  { id: 'health-chipshop', kind: 'health', at: { place: 'timaru-chipshop', snap: 'verge', along: -8 }, respawn: TUNING.healthRespawn },
  { id: 'health-garage', kind: 'health', at: { place: 'chch-garage', snap: 'verge', along: -8 }, respawn: TUNING.healthRespawn },
  { id: 'armour-garage', kind: 'armour', at: { place: 'chch-garage', snap: 'verge', along: 10 }, respawn: TUNING.armourRespawn },
  { id: 'cash-caroline-bay', kind: 'cash', at: { place: 'caroline-bay', left: 2 }, amount: 150 },
  { id: 'cash-saleyards', kind: 'cash', at: { place: 'washdyke-saleyards', left: 2 }, amount: 300 },
  { id: 'health-layby', kind: 'health', at: { place: 'rangitata-layby', left: 3 }, respawn: TUNING.healthRespawn },
  { id: 'cash-salmon', kind: 'cash', at: { place: 'rakaia-salmon', left: 2 }, amount: 200 },
  { id: 'cash-lancaster', kind: 'cash', at: { place: 'lancaster-park', left: 2 }, amount: 250 },
  { id: 'armour-brighton', kind: 'armour', at: { place: 'new-brighton-beach', left: 2 }, respawn: TUNING.armourRespawn },
  { id: 'health-kiwi', kind: 'health', at: { place: 'sign-of-the-kiwi', left: 3 }, respawn: TUNING.healthRespawn },
  { id: 'health-wharf', kind: 'health', at: { place: 'lyttelton-wharf', snap: 'verge', along: -12 }, respawn: TUNING.healthRespawn },
];

interface PickupState {
  def: Pick<WorldPickup, 'id' | 'kind' | 'amount' | 'respawn'>;
  x: number;
  z: number;
  /** Hidden round the back of somewhere (stashes.ts): lies low, no halo. */
  stash: boolean;
  spawned: boolean;
  remove: (() => void) | null;
}

interface ShopItem {
  label: string;
  price: number;
  weapon: string | null;
  ammo: number;
  name: string;
}

/** "6:40 am". */
export function clockText(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  let whole = Math.floor(h);
  let minutes = Math.round((h - whole) * 60);
  if (minutes === 60) {
    minutes = 0;
    whole = (whole + 1) % 24;
  }
  const twelve = whole % 12 === 0 ? 12 : whole % 12;
  return `${twelve}:${String(minutes).padStart(2, '0')} ${whole < 12 ? 'am' : 'pm'}`;
}

export class Services {
  /** One-off pickups already taken (saved). */
  readonly collected = new Set<string>();
  private pickups: PickupState[] = [];
  /** The first stash found gets a word; the rest are their own reward. */
  private stashFound = false;
  private scan = 0;
  private blipIds: string[] = [];
  private off: () => void;

  constructor(private ctx: GameContext) {
    this.off = ctx.events.on('pickup', ({ kind }) => this.claim(kind));
  }

  /** Once the world exists: blips for shops and safehouses, and positions for the pickups. */
  init() {
    const { ctx } = this;
    for (const place of ctx.world.placesTagged('gunshop')) this.blip(`shop:${place.id}`, 'shop', place);
    for (const place of ctx.world.placesTagged('safehouse')) this.blip(`safehouse:${place.id}`, 'safehouse', place);

    const at = newResolved();
    let skipped = 0;
    for (const def of WORLD_PICKUPS) {
      resolveSpot(ctx.world, def.at, at);
      // Nothing is left lying about on a marae, or in the water.
      if (!at.ok || maraeAt(ctx.world, at.x, at.z, TUNING.maraeMargin) || ctx.world.waterDepthAt(at.x, at.z) > 0.1) {
        skipped++;
        continue;
      }
      this.pickups.push({ def, x: at.x, z: at.z, stash: false, spawned: false, remove: null });
    }
    if (skipped) warnOnce(`missions: ${skipped} world pickup(s) have nowhere to go on this map yet`);
    // Weapons hidden round the back of buildings. Guns come back after a long while; a katana is found once.
    for (const s of findStashes(ctx.world)) {
      if (maraeAt(ctx.world, s.x, s.z, TUNING.maraeMargin)) continue;
      this.pickups.push({ def: { id: s.id, kind: s.kind, respawn: s.kind === 'katana' ? undefined : STASH.respawn }, x: s.x, z: s.z, stash: true, spawned: false, remove: null });
    }
  }

  private blip(id: string, kind: 'shop' | 'safehouse', place: Place) {
    this.blipIds.push(id);
    this.ctx.ui.setBlip({ id, kind, x: place.x, z: place.z });
  }

  update(dt: number) {
    this.scan -= dt;
    if (this.scan > 0) return;
    this.scan = TUNING.pickupScanSeconds;
    const { world, combat } = this.ctx;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.spawned || this.collected.has(p.def.id) || !world.isLoaded(p.x, p.z)) continue;
      p.spawned = true;
      try {
        p.remove = combat.spawnPickup(p.def.kind, p.x, p.z, p.def.amount, p.def.respawn, p.stash ? { stash: true } : undefined);
      } catch {
        p.remove = null;
      }
    }
  }

  /** A 'pickup' event says what was taken but not which one: the one-off of that kind under the player's feet is it. */
  private claim(kind: string) {
    const pos = this.ctx.player.position;
    if (!this.stashFound) {
      for (let i = 0; i < this.pickups.length; i++) {
        const p = this.pickups[i];
        if (!p.stash || !p.spawned || p.def.kind !== kind || Math.hypot(p.x - pos.x, p.z - pos.z) > TUNING.pickupClaimDistance) continue;
        this.stashFound = true;
        this.ctx.ui.toast("Somebody's stash. Finders keepers: there'll be more round the back of places.", 5);
        break;
      }
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.spawned || p.def.respawn !== undefined || p.def.kind !== kind || this.collected.has(p.def.id)) continue;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > TUNING.pickupClaimDistance) continue;
      this.collected.add(p.def.id);
      p.remove = null;
      return;
    }
  }

  // ───────────── Gun shop ─────────────

  private shopItems(): ShopItem[] {
    const { combat } = this.ctx;
    const items: ShopItem[] = [];
    for (const w of combat.weapons.values()) {
      if (w.price <= 0 || w.kind === 'fists') continue;
      const rounds = w.magazine > 0 ? w.magazine * TUNING.shopMagazines : 0;
      if (!combat.has(w.id)) {
        items.push({ label: `${w.name}  $${w.price}`, price: w.price, weapon: w.id, ammo: rounds, name: w.name });
      } else if (rounds > 0) {
        const price = Math.max(5, Math.round((w.price * TUNING.ammoPriceShare) / 5) * 5);
        items.push({ label: `${w.name} rounds ×${rounds}  $${price}`, price, weapon: w.id, ammo: rounds, name: `${w.name} rounds` });
      }
    }
    items.push({ label: `Padded shooting vest  $${TUNING.armourPrice}`, price: TUNING.armourPrice, weapon: null, ammo: 0, name: 'Padded vest' });
    return items;
  }

  /** The counter: keeps offering until the player leaves. */
  async shop(place: Place): Promise<void> {
    const { ctx } = this;
    for (let sales = 0; sales < 24; sales++) {
      const items = this.shopItems();
      const options = items.map((item) => item.label);
      options.push('Leave');
      const pick = await ctx.ui.choose(place.name, `You've got $${ctx.player.money}.`, options);
      if (pick < 0 || pick >= items.length) return;
      const item = items[pick];
      if (ctx.player.money < item.price) {
        ctx.ui.toast("You're a bit short for that.", 3);
        ctx.audio.play('empty');
        continue;
      }
      ctx.player.addMoney(-item.price);
      if (item.weapon) ctx.combat.give(item.weapon, item.ammo);
      else ctx.player.addArmour(TUNING.armourAmount);
      ctx.audio.play('cash');
      ctx.ui.toast(`${item.name}: sorted.`, 3);
    }
  }

  // ───────────── Safehouse ─────────────

  /** Have a kip: fade, sleep six to eight hours, heal, save. */
  async kip(): Promise<void> {
    const { ctx } = this;
    const player = ctx.player;
    player.controlsEnabled = false;
    try {
      await settle(ctx.ui.fade(true, 0.8), 2500);
      const [min, max] = TUNING.kipHours;
      ctx.clock.advanceHours(min + Math.random() * (max - min));
      player.heal(player.maxHealth);
      const result = ctx.save.save();
      await settle(ctx.ui.fade(false, 0.8), 2500);
      ctx.ui.toast(!result.ok ? result.message : `Game saved. It's ${clockText(ctx.clock.hour)}.`, 4);
    } finally {
      player.controlsEnabled = true;
    }
  }

  // ───────────── Save slice ─────────────

  serialize(): string[] {
    return [...this.collected];
  }

  deserialize(data: unknown) {
    this.collected.clear();
    if (Array.isArray(data)) for (const id of data) if (typeof id === 'string') this.collected.add(id);
    // Anything already lying in the world that the save says was taken goes again.
    for (const p of this.pickups) {
      if (!p.spawned || !this.collected.has(p.def.id)) continue;
      p.remove?.();
      p.remove = null;
    }
  }

  dispose() {
    this.off();
    for (const p of this.pickups) p.remove?.();
    this.pickups.length = 0;
    for (const id of this.blipIds) this.ctx.ui.removeBlip(id);
    this.blipIds.length = 0;
  }
}
