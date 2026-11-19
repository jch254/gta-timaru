import { TAU, clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { Actor, GameContext, PedHandle, PedSpawnOptions, PedsApi, RoadEdge, System, Vehicle } from '../core/types';
import { makePoint } from './lanes';
import { barkLine, chatLine, completeLook, pedName, randomLook, type BarkKind, type LookContext } from './looks';
import { Ped, type PedWorld } from './ped';
import { pedTimeFactor, pickRingPoint, spawnAllowed, type RingPoint } from './spawn';
import { PEDS } from './tuning';
import { footpathInto, walkTrim, walkable } from './walk';

const WALKABLE = (e: RoadEdge) => walkable(e);
const _pt = makePoint();
const _ring: RingPoint = { x: 0, z: 0, radius: 0 };

/**
 * The street population: keeps pedestrians alive around the player, weighted by district and hour, and
 * relays danger (gunfire, crimes, speeding cars) to them. Scripted characters come through `spawn`.
 */
export class PedsSystem implements PedsApi, System {
  readonly name = 'peds';
  density = 1;

  private peds: Ped[] = [];
  private rng = new Rng(0x9ed5);
  private world: PedWorld;
  private fast: Vehicle[] = [];
  private frame = 0;
  private live = 0;
  private ambient = 0;
  private target = 0;
  /** Running estimate of how lively the surroundings are (0..1), from the districts sampled while spawning. */
  private busy = 0.5;
  private spawnTimer = 0;
  private slowTimer = 0;
  private seed: number = PEDS.seedSeconds;
  private lastBark = -100;
  private lastScream = -100;

  constructor(private ctx: GameContext) {
    this.world = {
      ctx,
      rng: this.rng,
      peds: this.peds,
      frame: 0,
      bark: (ped, kind) => this.bark(ped, kind),
      scream: (ped) => this.scream(ped),
      inMarae: (x, z) => this.inMarae(x, z),
    };
  }

  /** Live pedestrians (ambient and scripted). */
  get count(): number {
    return this.live;
  }

  init() {
    const { ctx } = this;
    ctx.events.on('gunshot', ({ shooter, position }) => this.alarm(position.x, position.z, PEDS.gunshotRadius, shooter));
    ctx.events.on('crime', ({ type, position, offender }) => {
      if (type === 'assault' || type === 'murder' || type === 'carjacking' || type === 'hitAndRun' || type === 'copAssault' || type === 'copKilled') {
        this.alarm(position.x, position.z, PEDS.crimeRadius, offender);
      } else if (type === 'carTheft') {
        // Somebody usually notices.
        for (const ped of this.peds) {
          if (ped.chatty && Math.hypot(ped.position.x - position.x, ped.position.z - position.z) < 14) {
            if (this.bark(ped, 'theft')) ped.pauseToFace(position.x, position.z, 2);
            break;
          }
        }
      }
    });
    ctx.events.on('vehicleDestroyed', ({ vehicle, source }) => {
      for (const ped of this.peds) {
        if (ped.seatedIn === vehicle) ped.takeDamage({ amount: 999, kind: 'explosion', source: source ?? null });
      }
    });
    ctx.events.on('playerRespawned', () => {
      this.seed = PEDS.seedSeconds;
    });
  }

  // ───────────── PedsApi ─────────────

  spawn(options: PedSpawnOptions): PedHandle {
    const { ctx, rng } = this;
    const look = completeLook(rng, options.look, this.lookContext(options.x, options.z));
    const ped = new Ped(this.world, ctx.actors.nextId(), {
      x: options.x,
      z: options.z,
      heading: options.heading ?? rng.range(0, TAU),
      look,
      kind: options.kind ?? 'ped',
      name: options.name ?? pedName(rng, !!look.female),
      health: options.health ?? PEDS.health,
      behaviour: options.behaviour ?? 'wander',
      weaponId: options.weaponId,
      persistent: options.persistent ?? false,
      ambient: false,
      invulnerable: options.invulnerable,
      onHit: options.onHit,
    });
    this.peds.push(ped);
    this.live++;
    return ped;
  }

  // ───────────── Frame ─────────────

  update(dt: number) {
    const { ctx } = this;
    this.frame++;
    this.world.frame = this.frame;
    if (this.seed > 0) this.seed -= dt;
    const player = ctx.player;
    const pp = player.position;
    const onFoot = !player.vehicle && player.alive;
    const cam = ctx.camera.position;

    // Vehicles moving fast enough to hurt someone, to roll over a body, or to be worth jumping clear of.
    const fast = this.fast;
    fast.length = 0;
    const vehicles = ctx.vehicles.all;
    const threshold = Math.min(PEDS.hitSpeed, PEDS.dodgeSpeed, PEDS.runOverSpeed);
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.velocity.x * v.velocity.x + v.velocity.z * v.velocity.z > threshold * threshold) fast.push(v);
    }

    let live = 0;
    let ambient = 0;
    const peds = this.peds;
    for (let i = peds.length - 1; i >= 0; i--) {
      const ped = peds[i];
      if (!ped.removed && !ped.alive) {
        // A body lies where it fell for a while (traffic still rolls over it), then is cleared away.
        ped.update(dt);
        if (fast.length) this.rollOver(ped);
        if (ped.corpseTimer <= 0) ped.dispose();
      }
      if (ped.removed) {
        peds[i] = peds[peds.length - 1];
        peds.pop();
        continue;
      }
      if (!ped.alive) continue;
      const dx = ped.position.x - pp.x;
      const dz = ped.position.z - pp.z;
      const d2 = dx * dx + dz * dz;
      if ((this.frame + ped.slot) % 20 === 0) {
        const cx = ped.position.x - cam.x;
        const cz = ped.position.z - cam.z;
        ped.far = cx * cx + cz * cz > PEDS.lodDistance * PEDS.lodDistance;
        if (!ped.persistent && !ped.seatedIn && (d2 > PEDS.despawn * PEDS.despawn || !ctx.world.isLoaded(ped.position.x, ped.position.z))) {
          ped.dispose();
          peds[i] = peds[peds.length - 1];
          peds.pop();
          continue;
        }
      }
      live++;
      if (ped.ambient) ambient++;
      if (!ped.seatedIn) {
        if (fast.length) this.vehicleDanger(ped, dt, (this.frame + ped.slot) % 5 === 0);
        if (onFoot && d2 < 9) this.playerNear(ped, d2, dt);
        else ped.lingerTime = 0;
      }
      ped.update(dt);
    }
    this.live = live;
    this.ambient = ambient;

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 1;
      this.target = Math.round(PEDS.perDensity * this.density * pedTimeFactor(ctx.clock.hour) * clamp(this.busy * 1.5, 0, 1));
      if (this.ambient > this.target + 3) this.thin();
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const wanting = this.ambient < this.target && this.live < PEDS.budget;
      // Keep sampling the surroundings even when full, just less often.
      this.spawnTimer = wanting ? PEDS.spawnInterval : 0.8;
      for (let k = this.seed > 0 && wanting ? 6 : 1; k > 0; k--) this.spawnAmbient();
    }
  }

  /** Hits, and near misses worth jumping away from. */
  private vehicleDanger(ped: Ped, dt: number, lookAhead: boolean) {
    if (!ped.standing) {
      this.rollOver(ped);
      return;
    }
    const fast = this.fast;
    const p = ped.position;
    for (let k = 0; k < fast.length; k++) {
      const v = fast[k];
      const dx = p.x - v.position.x;
      const dz = p.z - v.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 45 * 45 || Math.abs(p.y - v.position.y) > 2.5) continue;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      const f = dx * sin + dz * cos;
      const l = dx * cos - dz * sin;
      const speed = Math.hypot(v.velocity.x, v.velocity.z);
      if (ped.hitCooldown <= 0 && ped.standing && Math.abs(l) < v.spec.width / 2 + 0.32 && Math.abs(f) < v.spec.length / 2 + 0.32 + speed * dt * 1.5) {
        const d = Math.sqrt(d2);
        const closing = d > 0.4 ? (v.velocity.x * dx + v.velocity.z * dz) / d : speed;
        if (closing > PEDS.hitSpeed) {
          ped.struck(v, closing);
          return;
        }
      }
      if (lookAhead && speed > PEDS.dodgeSpeed) {
        const ahead = f * (v.speed >= 0 ? 1 : -1) - v.spec.length / 2;
        if (ahead > 0 && ahead < speed * PEDS.dodgeHorizon && Math.abs(l) < v.spec.width / 2 + PEDS.dodgeMargin) ped.dodge(v, l);
      }
    }
  }

  /** Someone lying in the road, knocked flat or dead: any wheels that go over them. */
  private rollOver(ped: Ped) {
    if (!ped.rollable) return;
    const p = ped.position;
    // The body lies back from where the feet are.
    const bx = p.x - Math.sin(ped.heading) * 0.7;
    const bz = p.z - Math.cos(ped.heading) * 0.7;
    const fast = this.fast;
    for (let k = 0; k < fast.length; k++) {
      const v = fast[k];
      const speed = Math.hypot(v.velocity.x, v.velocity.z);
      if (speed < PEDS.runOverSpeed || Math.abs(p.y - v.position.y) > 2) continue;
      const dx = bx - v.position.x;
      const dz = bz - v.position.z;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      // (A body is half a metre across: a wheel near the edge still finds it.)
      if (Math.abs(dx * cos - dz * sin) < v.spec.width / 2 + 0.25 && Math.abs(dx * sin + dz * cos) < v.spec.length / 2) {
        ped.runOver(v, speed);
        return;
      }
    }
  }

  /** The player is within a few steps: a word if they hang about, a protest if they barge. */
  private playerNear(ped: Ped, d2: number, dt: number) {
    const { ctx } = this;
    if (!ped.chatty) {
      ped.lingerTime = 0;
      return;
    }
    const player = ctx.player;
    if (d2 < PEDS.bumpRadius * PEDS.bumpRadius && player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z > 1) {
      ped.talkCooldown = 6;
      if (this.bark(ped, 'bump')) ped.pauseToFace(player.position.x, player.position.z, 1.2);
      return;
    }
    if (d2 > PEDS.lingerRadius * PEDS.lingerRadius) {
      ped.lingerTime = 0;
      return;
    }
    ped.lingerTime += dt;
    if (ped.lingerTime < PEDS.lingerSeconds) return;
    ped.lingerTime = 0;
    ped.talkCooldown = 14;
    if (!this.audible(ped)) return;
    this.lastBark = ctx.clock.elapsed;
    ctx.ui.subtitle(chatLine(this.rng, ctx.env.weather, ctx.env.night > 0.5, ctx.clock.hour), 2.5, ped.name);
    ped.pauseToFace(player.position.x, player.position.z, 2.5);
  }

  private alarm(x: number, z: number, radius: number, source: Actor | null) {
    const r2 = radius * radius;
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const dx = ped.position.x - x;
      const dz = ped.position.z - z;
      if (dx * dx + dz * dz < r2) ped.alarm(x, z, source);
    }
  }

  /** Too many for the place or the hour: let one drift away where nobody is looking. */
  private thin() {
    const { ctx } = this;
    const pp = ctx.player.position;
    const sin = Math.sin(ctx.player.cameraHeading);
    const cos = Math.cos(ctx.player.cameraHeading);
    for (const ped of this.peds) {
      if (!ped.ambient || !ped.calm) continue;
      const dx = ped.position.x - pp.x;
      const dz = ped.position.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d < 45 || (dx * sin + dz * cos) / d > 0.55) continue;
      ped.dispose();
      return;
    }
  }

  // ───────────── Voices ─────────────

  /** One line every few seconds at most, and only from people within earshot of the player. */
  private audible(ped: Ped): boolean {
    const { ctx } = this;
    if (ctx.clock.elapsed - this.lastBark < PEDS.barkGap) return false;
    const p = ctx.player.position;
    return (ped.position.x - p.x) * (ped.position.x - p.x) + (ped.position.z - p.z) * (ped.position.z - p.z) < 22 * 22;
  }

  private bark(ped: Ped, kind: BarkKind): boolean {
    if (!this.audible(ped)) return false;
    this.lastBark = this.ctx.clock.elapsed;
    this.ctx.ui.subtitle(barkLine(this.rng, kind), 2.5, ped.name);
    return true;
  }

  private scream(ped: Ped) {
    const { ctx } = this;
    if (ctx.clock.elapsed - this.lastScream < PEDS.screamGap) return;
    this.lastScream = ctx.clock.elapsed;
    ctx.audio.play('scream', { at: ped.position, pitch: ped.female ? 1.15 : 0.85 });
  }

  private inMarae(x: number, z: number): boolean {
    for (const l of this.ctx.world.landmarks) {
      if (l.kind === 'marae' && (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z) < l.clearRadius * l.clearRadius) return true;
    }
    return false;
  }

  // ───────────── Ambient population ─────────────

  private lookContext(x: number, z: number): LookContext {
    const { ctx } = this;
    const weekday = ctx.clock.day % 7;
    return {
      district: ctx.world.districtAt(x, z).type,
      hour: ctx.clock.hour,
      // clock.day % 7: 5 and 6 are Friday and Saturday, so 1–5 are the working week.
      weekday: weekday >= 1 && weekday <= 5,
      cold: ctx.env.weather === 'southerly' || ctx.env.rain > 0.3 || ctx.env.night > 0.6,
    };
  }

  private spawnAmbient() {
    const { ctx, rng } = this;
    const p = ctx.player.position;
    const cam = ctx.player.cameraHeading;
    const seeding = this.seed > 0;
    const minR = seeding ? PEDS.seedMin : PEDS.spawnMin;
    pickRingPoint(rng, p.x, p.z, cam, minR, PEDS.spawnMax, PEDS.coneHalfAngle, 0, _ring);
    const hit = ctx.world.graph.nearest(_ring.x, _ring.z, 30, WALKABLE);
    const district = hit ? ctx.world.districtAt(hit.x, hit.z).type : 'rural';
    const weight = hit ? (PEDS.district[district] ?? 0.2) : 0;
    this.busy += (weight - this.busy) * 0.06;
    if (!hit || this.ambient >= this.target || this.live >= PEDS.budget || !rng.chance(weight)) return;
    const e = hit.edge;
    if (e.bridge || e.tunnel) return;
    const graph = ctx.world.graph;
    const trimA = walkTrim(graph, e, e.a);
    const trimB = walkTrim(graph, e, e.b);
    if (e.length - trimA - trimB < 4) return;
    const side = rng.chance(0.5) ? 1 : -1;
    const jitter = rng.range(-1, 1);
    const s = clamp(hit.s, trimA + 1, e.length - trimB - 1);
    footpathInto(e, s, side, jitter, _pt);
    const x = _pt.x;
    const z = _pt.z;
    if (!spawnAllowed(p.x, p.z, cam, x, z, minR, PEDS.spawnMax, 8, PEDS.coneHalfAngle, seeding ? minR : PEDS.coneNear)) return;
    if (!ctx.world.isLoaded(x, z) || ctx.world.waterDepthAt(x, z) > 0.2) return;
    for (const other of this.peds) {
      if ((other.position.x - x) * (other.position.x - x) + (other.position.z - z) * (other.position.z - z) < 2.2) return;
    }
    const look = randomLook(rng, this.lookContext(x, z));
    const ped = new Ped(this.world, ctx.actors.nextId(), {
      x,
      z,
      heading: rng.range(0, TAU),
      look,
      kind: 'ped',
      name: pedName(rng, !!look.female),
      health: PEDS.health,
      behaviour: 'wander',
      persistent: false,
      ambient: true,
      edge: e,
      side,
      s,
      jitter,
    });
    this.peds.push(ped);
    this.ambient++;
    this.live++;
  }
}
