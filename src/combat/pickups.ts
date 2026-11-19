import * as THREE from 'three';
import type { Actor, GameContext, WeaponSpec } from '../core/types';
import { SpriteBatch } from '../fx/particles';
import type { WeaponModels } from './models';
import { feelOf, TUNING } from './weapons';

/** What the pickups need from the combat system. */
export interface PickupHost {
  weapons: ReadonlyMap<string, WeaponSpec>;
  give(weaponId: string, ammo: number): void;
  /** True when picking up `weaponId` would add nothing. */
  full(weaponId: string): boolean;
}

interface Pickup {
  kind: string;
  amount: number;
  x: number;
  z: number;
  /** Ground height under it. */
  y: number;
  group: THREE.Object3D;
  /** Seconds until it comes back after being collected (0 = one-off). */
  respawn: number;
  /** Counts down while collected and waiting to come back. */
  hidden: number;
  /** Seconds until it disappears on its own (Infinity = never). */
  ttl: number;
  ground: number;
  phase: number;
  /** Dropped by a pedestrian (counts against the drop cap). */
  drop: boolean;
  glow: readonly [number, number, number];
}

const MAX_HALOS = 64;
/** Weapon pickups are drawn a little over life size. */
const DISPLAY_SCALE = 1.25;
/** Mid-point of each weapon along its length (weapon space z, metres), so it spins about its middle. */
const DISPLAY_CENTRE: Record<string, number> = { bat: 0.33, pistol: 0.04, shotgun: 0.185, rifle: 0.15 };
const GLOW: Record<string, readonly [number, number, number]> = {
  health: [1.1, 0.34, 0.28],
  armour: [0.3, 0.55, 1.1],
  cash: [0.35, 1, 0.45],
  weapon: [1.1, 0.8, 0.3],
};

/**
 * World pickups: slowly turning models that float at waist height with a soft halo, collected by
 * walking into them.
 */
export class Pickups {
  private list: Pickup[] = [];
  private halo = new SpriteBatch(MAX_HALOS, true, 0);
  private drops = 0;
  private off: () => void;

  constructor(
    private ctx: GameContext,
    private models: WeaponModels,
    private host: PickupHost,
  ) {
    ctx.scene.add(this.halo.mesh);
    this.off = ctx.events.on('actorDied', ({ actor }) => this.onActorDied(actor));
  }

  /** See CombatApi.spawnPickup. `ttl` makes it vanish by itself after that many seconds. */
  spawn(kind: string, x: number, z: number, amount?: number, respawnSeconds = 0, ttl = Infinity, drop = false): () => void {
    const { ctx } = this;
    const weapon = this.host.weapons.get(kind);
    let group: THREE.Object3D | null;
    let value: number;
    if (kind === 'health' || kind === 'armour' || kind === 'cash') {
      group = this.models.pickup(kind);
      value = amount ?? (kind === 'health' ? TUNING.healthPickup : kind === 'armour' ? TUNING.armourPickup : TUNING.cashPickup);
      group.rotation.set(kind === 'armour' ? 0 : 0.42, 0, 0);
    } else if (weapon && (group = this.models.display(kind))) {
      value = amount ?? feelOf(kind).pickupAmmo;
      // Lying on its side, centred on its length so it turns about the middle.
      group.scale.setScalar(DISPLAY_SCALE);
      group.position.z = -(DISPLAY_CENTRE[kind] ?? 0) * DISPLAY_SCALE;
      group.rotation.z = 0.6;
    } else {
      console.warn(`combat: unknown pickup kind "${kind}"`);
      return () => undefined;
    }
    if (this.inMarae(x, z)) {
      // Marae are places of respect: nothing to grab there (docs/CONTRACT.md addendum).
      // A body's drop just quietly fails; a scripted placement is worth a warning.
      if (!drop) console.warn(`combat: pickup "${kind}" at ${x.toFixed(0)}, ${z.toFixed(0)} is inside a marae and was not placed`);
      return () => undefined;
    }
    if (drop && this.drops >= TUNING.maxCashDrops) {
      // At the drop cap (cash and dropped weapons alike): the oldest drop makes way.
      const oldest = this.list.find((p) => p.drop);
      if (oldest) this.remove(oldest);
    }
    // A turntable so weapon models can be offset and still spin about the pickup's centre.
    const holder = new THREE.Group();
    holder.add(group);
    const y = ctx.world.groundAt(x, z);
    holder.position.set(x, y + TUNING.pickupHeight, z);
    holder.visible = false;
    ctx.scene.add(holder);
    const pickup: Pickup = {
      kind,
      amount: value,
      x,
      z,
      y,
      group: holder,
      respawn: Math.max(0, respawnSeconds),
      hidden: 0,
      ttl,
      ground: 0,
      phase: Math.random() * 6.28,
      drop,
      glow: GLOW[weapon ? 'weapon' : kind],
    };
    this.list.push(pickup);
    if (drop) this.drops++;
    return () => this.remove(pickup);
  }

  /** Live, takeable pickups — for the dev tools (the honest playtest grabs kit between fights). */
  all(): { kind: string; x: number; z: number }[] {
    return this.list.filter((p) => p.hidden === 0).map((p) => ({ kind: p.kind, x: p.x, z: p.z }));
  }

  private remove(pickup: Pickup) {
    const i = this.list.indexOf(pickup);
    if (i < 0) return;
    this.list.splice(i, 1);
    pickup.group.removeFromParent();
    if (pickup.drop) this.drops--;
  }

  /** People sometimes have a few dollars on them. */
  private onActorDied(actor: Actor) {
    if (actor.kind !== 'ped' && actor.kind !== 'gang') return;
    if (actor.vehicle || Math.random() > TUNING.cashDropChance) return;
    const { ctx } = this;
    const x = actor.position.x + (Math.random() - 0.5) * 0.8;
    const z = actor.position.z + (Math.random() - 0.5) * 0.8;
    if (ctx.world.waterDepthAt(x, z) > 0.2 || this.inMarae(x, z)) return;
    const amount = TUNING.cashDropMin + Math.floor(Math.random() * (TUNING.cashDropMax - TUNING.cashDropMin + 1));
    this.spawn('cash', x, z, actor.kind === 'gang' ? amount * 2 : amount, 0, TUNING.cashDropSeconds, true);
  }

  /** Clear circles of the marae on the map (looked up once). */
  private maraeGrounds: { x: number; z: number; r: number }[] | null = null;

  private inMarae(x: number, z: number): boolean {
    this.maraeGrounds ??= this.ctx.world.landmarks.filter((l) => l.kind === 'marae').map((l) => ({ x: l.x, z: l.z, r: l.clearRadius }));
    for (const m of this.maraeGrounds) if (Math.hypot(x - m.x, z - m.z) < m.r) return true;
    return false;
  }

  update(dt: number) {
    const { ctx } = this;
    const player = ctx.player;
    const cam = ctx.camera.position;
    const canCollect = player.alive && !player.vehicle;
    const draw = TUNING.pickupDrawDistance;
    let halos = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.hidden > 0) {
        p.hidden -= dt;
        continue;
      }
      if (p.ttl !== Infinity && (p.ttl -= dt) <= 0) {
        this.remove(p);
        continue;
      }
      const dx = cam.x - p.x;
      const dz = cam.z - p.z;
      const near = dx * dx + dz * dz < draw * draw;
      p.group.visible = near;
      if (!near) continue;

      // Terrain streams in: keep it sat on whatever is there now (bridge decks, water).
      if ((p.ground -= dt) <= 0) {
        p.ground = 1.5;
        const depth = ctx.world.waterDepthAt(p.x, p.z);
        p.y = Math.max(ctx.world.groundAt(p.x, p.z), depth > 0 ? ctx.world.heightAt(p.x, p.z) + depth : -Infinity);
      }
      p.phase += dt * 2.2;
      const y = p.y + TUNING.pickupHeight + Math.sin(p.phase) * 0.06;
      p.group.position.y = y;
      p.group.rotation.y += dt * 1.7;

      if (canCollect) {
        const px = player.position.x - p.x;
        const pz = player.position.z - p.z;
        if (px * px + pz * pz <= TUNING.pickupRadius * TUNING.pickupRadius && Math.abs(player.position.y - p.y) < 2.4 && this.collect(p)) {
          if (p.respawn > 0) {
            p.hidden = p.respawn;
            p.group.visible = false;
          } else this.remove(p);
          continue;
        }
      }
      // The halo fades with a drop that is about to vanish.
      const fade = p.ttl < 4 ? p.ttl / 4 : 1;
      if (halos < MAX_HALOS) this.halo.set(halos++, p.x, y, p.z, 1.15 + Math.sin(p.phase * 1.3) * 0.15, 0, p.glow[0], p.glow[1], p.glow[2], 0.32 * fade);
    }
    this.halo.commit(halos);
  }

  /** Apply the pickup to the player. False if they have no use for it right now. */
  private collect(p: Pickup): boolean {
    const { ctx } = this;
    const player = ctx.player;
    if (p.kind === 'health') {
      if (player.health >= player.maxHealth) return false;
      player.heal(p.amount);
    } else if (p.kind === 'armour') {
      if (player.armour >= 100) return false;
      player.addArmour(p.amount);
    } else if (p.kind === 'cash') {
      player.addMoney(p.amount);
    } else {
      if (this.host.full(p.kind)) return false;
      this.host.give(p.kind, p.amount);
    }
    ctx.events.emit('pickup', { kind: p.kind, amount: p.amount });
    ctx.audio.play(p.kind === 'cash' ? 'cash' : 'pickup', { at: player.position });
    return true;
  }

  dispose() {
    this.off();
    for (const p of this.list) p.group.removeFromParent();
    this.list.length = 0;
    this.halo.dispose();
  }
}
