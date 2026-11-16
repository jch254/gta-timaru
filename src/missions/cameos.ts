/**
 * Cameos about town (the cast is data: defs/cameos.ts). Each one exists only while the player is near their
 * spot. They stand facing the street; when the player walks up they turn and say their next line; if they
 * are hit or shot at, or shooting starts close by, they protest and get out of the way, then drift back.
 *
 * They are ordinary scripted pedestrians with `invulnerable` set, so they never join the ambient crowd, never
 * fight, flee or panic, never get into a vehicle, and nothing can hurt them. They keep clear of trouble: one
 * is not put out while a mission's hostiles are standing near their spot.
 *
 * Cost: with nobody about, one timer per frame and a distance check per cameo twice a second.
 */
import * as THREE from 'three';
import { angleDiff, damp, dampAngle } from '../core/math';
import type { DamageInfo, GameContext, HumanoidLook, PedHandle, RoadEdge, WeatherKind, WorldApi } from '../core/types';
import type { CameoDef } from './defs/cameos';
import { lineSeconds } from './dialogue';
import { newResolved, resolveSpot } from './spots';
import { warnOnce } from './warn';

/** Metres and seconds. */
export const CAMEO_TUNING = {
  /** A cameo appears when the player is within `spawn` of their spot and goes once they are beyond `despawn`. */
  spawn: 110,
  despawn: 150,
  /** Seconds between checks of who should be about. */
  scan: 0.5,
  /** On foot and this close: they turn to face the player / speak. */
  faceRadius: 8,
  talkRadius: 4.5,
  /** Seconds after a line ends before the same cameo speaks again, and before any other cameo does. */
  gap: 7,
  crossTalk: 1,
  /** Seconds between protests from the same cameo. */
  oiGap: 4,
  /** Gunfire within this distance sends them off. */
  scareRadius: 30,
  /** How far they move off at a time, and the furthest they will ever go from their spot. */
  retreat: 14,
  leash: 45,
  /** Seconds of quiet before they come back. */
  calm: 16,
  /** No cameo is put out with a mission's hostiles standing this close to their spot. */
  trouble: 60,
  /** Restless cameos: seconds holding their pose, and seconds between. */
  poseSeconds: 4.5,
  poseRest: 5,
} as const;

/** Is `hour` inside [from, to)? Wraps past midnight when from > to. No hours = always. */
export function inHours(hour: number, hours: readonly [number, number] | undefined): boolean {
  if (!hours) return true;
  const [from, to] = hours;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Where a cameo has got to in their lines. Kept while they are away, so they pick up where they left off. */
export interface Voice {
  index: number;
  /** The weather they last remarked on. */
  weather: WeatherKind | null;
  /** Seconds until they will speak again. */
  cooldown: number;
}

export function newVoice(): Voice {
  return { index: 0, weather: null, cooldown: 0 };
}

/**
 * The next thing a cameo says: their lines in order, round and round, except that a change in the weather
 * gets a remark first from anyone who has one for it.
 */
export function nextLine(def: Pick<CameoDef, 'lines' | 'weather'>, voice: Voice, weather: WeatherKind): string {
  const remark = def.weather?.[weather];
  if (remark && voice.weather !== weather) {
    voice.weather = weather;
    return remark;
  }
  voice.weather = weather;
  if (!def.lines.length) return '';
  const text = def.lines[voice.index % def.lines.length];
  voice.index = (voice.index + 1) % def.lines.length;
  return text;
}

const drivable = (e: RoadEdge) => e.drivable;
/** Directions to try when moving off, as turns away from "straight away from the trouble". */
const RETREAT_TURNS = [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2];

/** Standing here would be on a carriageway, in water, or on ground that has not loaded. */
function unsafe(world: WorldApi, x: number, z: number): boolean {
  if (!world.isLoaded(x, z) || world.waterDepthAt(x, z) > 0.1) return true;
  const hit = world.graph.nearest(x, z, 30, drivable);
  return hit !== null && hit.distance < hit.edge.width / 2 + 1.2;
}

/**
 * Somewhere to move off to: `distance` metres from (x, z), as nearly straight away from the trouble at
 * (tx, tz) as can be had without stepping into or across a road, into water, or further than `leash` from
 * home. Null when there is nowhere better than where they are standing.
 */
export function retreatPoint(world: WorldApi, x: number, z: number, tx: number, tz: number, homeX: number, homeZ: number, distance: number, leash: number, out: { x: number; z: number }): { x: number; z: number } | null {
  let ax = x - tx;
  let az = z - tz;
  const d = Math.hypot(ax, az);
  if (d < 0.01) {
    ax = x - homeX;
    az = z - homeZ;
    const h = Math.hypot(ax, az);
    if (h < 0.01) {
      ax = 0;
      az = 1;
    } else {
      ax /= h;
      az /= h;
    }
  } else {
    ax /= d;
    az /= d;
  }
  for (const turn of RETREAT_TURNS) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const dx = ax * c + az * s;
    const dz = az * c - ax * s;
    const px = x + dx * distance;
    const pz = z + dz * distance;
    if (Math.hypot(px - homeX, pz - homeZ) > leash) continue;
    // The whole walk has to stay off the road, not just the far end of it.
    if (unsafe(world, px, pz) || unsafe(world, x + dx * distance * 0.66, z + dz * distance * 0.66) || unsafe(world, x + dx * distance * 0.33, z + dz * distance * 0.33)) continue;
    out.x = px;
    out.z = pz;
    return out;
  }
  return null;
}

type State = 'home' | 'away' | 'returning';

interface Live {
  ped: PedHandle;
  extras: PedHandle[];
  /** Meshes this module made (a towel, a camera): removed and disposed with the cameo. */
  props: THREE.Object3D[];
  state: State;
  /** Seconds of quiet left before heading home. */
  calm: number;
  /** Seconds spent standing off their mark. */
  drift: number;
  /** Bumps for every new errand, so a stale `goTo` result is ignored. */
  token: number;
  failures: number;
  lift: number;
  posing: boolean;
  poseTimer: number;
  lastOi: number;
}

export interface CameoRecord {
  def: CameoDef;
  /** False when their spot is not on this map. */
  ok: boolean;
  x: number;
  z: number;
  heading: number;
  voice: Voice;
  live: Live | null;
}

export interface CameoHost {
  /** A mission conversation (or the new-game monologue) is on screen: cameos keep quiet. */
  talking(): boolean;
}

/**
 * A look with nothing left to chance. The pedestrian system fills any field a scripted look leaves out with
 * a random one (it is how extras get variety); a cameo has to look the same every time.
 */
export function wholeLook(look: HumanoidLook): HumanoidLook {
  const female = !!look.female;
  return { topStyle: 'tee', shorts: false, hat: 'none', hatColor: 0x2a2a2e, hairStyle: female ? 'long' : 'short', height: 1, bulk: 1, ...look, female };
}

const _pt = { x: 0, z: 0 };
const _from = new THREE.Vector3();

export class Cameos {
  readonly records: CameoRecord[] = [];
  private liveCount = 0;
  private scanTimer = 0;
  /** Seconds until any cameo may speak (so two standing together take turns). */
  private quiet = 0;
  private offs: (() => void)[] = [];

  constructor(
    private ctx: GameContext,
    defs: readonly CameoDef[],
    private host: CameoHost,
  ) {
    for (const def of defs) this.records.push({ def, ok: false, x: 0, z: 0, heading: 0, voice: newVoice(), live: null });
    this.offs.push(ctx.events.on('gunshot', ({ shooter, position }) => this.gunshot(shooter.position.x, shooter.position.z, position.x, position.z)));
  }

  /** Once the world exists: work out where everybody stands. */
  init() {
    const at = newResolved();
    const missing: string[] = [];
    for (const r of this.records) {
      resolveSpot(this.ctx.world, r.def.at, at);
      r.ok = at.ok;
      r.x = at.x;
      r.z = at.z;
      r.heading = at.heading;
      if (!at.ok) missing.push(r.def.id);
    }
    if (missing.length) warnOnce(`cameos: nowhere on this map for ${missing.join(', ')}`);
  }

  /** Cameos in the world right now. */
  get count(): number {
    return this.liveCount;
  }

  update(dt: number) {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = CAMEO_TUNING.scan;
      this.scan();
    }
    if (this.liveCount === 0) return;
    if (this.quiet > 0) this.quiet -= dt;
    for (let i = 0; i < this.records.length; i++) if (this.records[i].live) this.tick(this.records[i], dt);
  }

  // ───────────── Who is about ─────────────

  private scan() {
    const { ctx } = this;
    const p = ctx.player.position;
    const T = CAMEO_TUNING;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      if (!r.ok) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (r.live) {
        if (d > T.despawn || !ctx.world.isLoaded(r.x, r.z)) this.despawn(r);
        else if (r.live.state !== 'away' || r.live.calm < T.calm - 3) {
          // Somebody's crew has turned up next door: time to be elsewhere.
          const trouble = this.troubleNear(r.live.ped.position.x, r.live.ped.position.z, T.scareRadius);
          if (trouble) this.moveOff(r, trouble.position.x, trouble.position.z);
        }
      } else if (d < T.spawn && inHours(ctx.clock.hour, r.def.hours) && ctx.world.isLoaded(r.x, r.z) && !this.troubleNear(r.x, r.z, T.trouble)) this.spawn(r);
    }
  }

  /** A live hostile within `radius` of a point, if any. */
  private troubleNear(x: number, z: number, radius: number) {
    for (const actor of this.ctx.actors.all) {
      if (actor.kind !== 'gang' || !actor.alive) continue;
      if (Math.hypot(actor.position.x - x, actor.position.z - z) < radius) return actor;
    }
    return null;
  }

  private spawnPed(name: string, look: HumanoidLook, x: number, z: number, heading: number, onHit?: (info: DamageInfo) => void): PedHandle {
    return this.ctx.peds.spawn({ x, z, heading, look: wholeLook(look), name, kind: 'scripted', behaviour: 'stand', persistent: true, invulnerable: true, onHit });
  }

  private spawn(r: CameoRecord) {
    const { def } = r;
    let ped: PedHandle;
    try {
      ped = this.spawnPed(def.name, def.look, r.x, r.z, r.heading, (info) => this.hit(r, info));
    } catch {
      // No pedestrian module (a stub build): nobody to put out.
      r.ok = false;
      warnOnce('cameos: no pedestrians yet, so nobody is about');
      return;
    }
    const live: Live = { ped, extras: [], props: [], state: 'home', calm: 0, drift: 0, token: 0, failures: 0, lift: def.lift ?? 0, posing: false, poseTimer: 1.5, lastOi: -100 };
    r.live = live;
    this.liveCount++;
    // Whatever pause they were in when the player left is long over.
    r.voice.cooldown = Math.min(r.voice.cooldown, 1);
    setLift(ped, live.lift);
    const sin = Math.sin(r.heading);
    const cos = Math.cos(r.heading);
    for (const extra of def.extras ?? []) {
      const x = r.x + sin * extra.forward + cos * extra.left;
      const z = r.z + cos * extra.forward - sin * extra.left;
      // Looking at the star.
      const facing = Math.atan2(r.x - x, r.z - z);
      try {
        live.extras.push(this.spawnPed(extra.name, extra.look, x, z, facing));
      } catch {
        continue;
      }
      if (extra.camera) this.addProp(live, null, cameraOnTripod(this.ctx), x + Math.sin(facing) * 0.75, z + Math.cos(facing) * 0.75, facing);
    }
    const height = def.look.height ?? 1;
    const bulk = def.look.bulk ?? 1;
    if (def.wears?.towel !== undefined) this.addProp(live, ped, towel(this.ctx, def.wears.towel, height, bulk), 0, 0, 0);
    if (def.wears?.number) this.addProp(live, ped, jerseyNumber(this.ctx, def.wears.number, height, bulk), 0, 0, 0);
  }

  /** Hang a prop on a figure (`on`), or stand it on the ground at (x, z). Nothing is added without a renderer. */
  private addProp(live: Live, on: PedHandle | null, prop: THREE.Object3D | null, x: number, z: number, heading: number) {
    if (!prop) return;
    if (on) (on.group.children[0] ?? on.group).add(prop);
    else {
      prop.position.set(x, this.ctx.world.groundAt(x, z), z);
      prop.rotation.y = heading;
      this.ctx.scene.add(prop);
    }
    live.props.push(prop);
  }

  private despawn(r: CameoRecord) {
    const live = r.live;
    if (!live) return;
    r.live = null;
    this.liveCount--;
    for (const prop of live.props) {
      prop.removeFromParent();
      prop.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const ped of [live.ped, ...live.extras]) {
      try {
        ped.remove();
      } catch {
        // Already removed by its owner.
      }
    }
  }

  // ───────────── One cameo, each frame they are about ─────────────

  private tick(r: CameoRecord, dt: number) {
    const live = r.live!;
    const { ped } = live;
    const { ctx } = this;
    const T = CAMEO_TUNING;
    const voice = r.voice;
    if (voice.cooldown > 0) voice.cooldown -= dt;
    const pos = ped.position;
    const atHome = Math.hypot(pos.x - r.x, pos.z - r.z) < 0.8;

    if (live.state === 'home') {
      if (atHome) live.drift = 0;
      else if ((live.drift += dt) > 2) this.goHome(r);
      const player = ctx.player;
      const dx = player.position.x - pos.x;
      const dz = player.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      const onFoot = !player.vehicle && player.alive;
      const want = onFoot && d < T.faceRadius && d > 0.3 ? Math.atan2(dx, dz) : r.heading;
      if (Math.abs(angleDiff(want, ped.heading)) > 0.002) ped.heading = dampAngle(ped.heading, want, 6, dt);
      if (onFoot && d < T.talkRadius && voice.cooldown <= 0 && this.quiet <= 0 && !ctx.ui.menuOpen && !this.host.talking()) this.speak(r);
      else if (r.def.restless && r.def.gesture && atHome) {
        // Holding forth to nobody in particular.
        live.poseTimer -= dt;
        if (live.poseTimer <= 0) {
          live.posing = !live.posing;
          live.poseTimer = live.posing ? T.poseSeconds : T.poseRest;
          if (live.posing) this.pose(r, T.poseSeconds);
        }
      }
    } else if (live.state === 'away') {
      live.calm -= dt;
      if (live.calm <= 0) this.goHome(r);
    }

    const lift = live.state === 'home' && atHome ? (r.def.lift ?? 0) : 0;
    if (live.lift !== lift) {
      const next = damp(live.lift, lift, 7, dt);
      live.lift = Math.abs(lift - next) < 0.01 ? lift : next;
      setLift(ped, live.lift);
    }
  }

  private pose(r: CameoRecord, seconds: number) {
    const ped = r.live!.ped;
    if (r.def.gesture) ped.gesture?.(r.def.gesture, seconds);
  }

  private speak(r: CameoRecord) {
    const text = nextLine(r.def, r.voice, this.ctx.env.weather);
    if (!text) return;
    const seconds = lineSeconds({ text });
    this.ctx.ui.subtitle(text, seconds, r.def.name);
    r.voice.cooldown = seconds + CAMEO_TUNING.gap;
    this.quiet = seconds + CAMEO_TUNING.crossTalk;
    const live = r.live!;
    live.posing = false;
    live.poseTimer = seconds + CAMEO_TUNING.poseRest;
    this.pose(r, seconds);
  }

  // ───────────── Trouble ─────────────

  /** Something that would have hurt anybody else. They are fine; they say so and go. */
  private hit(r: CameoRecord, info: DamageInfo) {
    const live = r.live;
    if (!live) return;
    const { ctx } = this;
    const now = ctx.clock.elapsed;
    if (now - live.lastOi > CAMEO_TUNING.oiGap && !this.host.talking()) {
      live.lastOi = now;
      ctx.ui.subtitle(r.def.oi, 2.6, r.def.name);
      this.quiet = Math.max(this.quiet, 2.6);
    }
    const pos = live.ped.position;
    if (info.kind === 'vehicle') {
      // Already bundled aside by the pedestrian system: give it a moment, then wander back.
      live.state = 'away';
      live.calm = 5;
      live.token++;
      return;
    }
    const from = info.source ? info.source.position : info.direction ? _from.copy(pos).sub(info.direction) : pos;
    this.moveOff(r, from.x, from.z);
  }

  private gunshot(sx: number, sz: number, x: number, z: number) {
    if (this.liveCount === 0) return;
    const T = CAMEO_TUNING;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      const live = r.live;
      if (!live) continue;
      // Not every round of a magazine: once they are on their way, leave them to it.
      if (live.state === 'away' && live.calm > T.calm - 2) continue;
      const pos = live.ped.position;
      if (Math.hypot(pos.x - x, pos.z - z) < T.scareRadius) this.moveOff(r, sx, sz);
    }
  }

  /** Off their mark and away from (tx, tz), by a route that keeps off the road. */
  private moveOff(r: CameoRecord, tx: number, tz: number) {
    const live = r.live!;
    const T = CAMEO_TUNING;
    const pos = live.ped.position;
    live.state = 'away';
    live.calm = T.calm;
    live.token++;
    live.posing = false;
    live.ped.gesture?.('idle', 0);
    r.voice.cooldown = Math.max(r.voice.cooldown, T.calm);
    const to = retreatPoint(this.ctx.world, pos.x, pos.z, tx, tz, r.x, r.z, T.retreat, T.leash, _pt);
    if (to) void live.ped.goTo(to.x, to.z, true);
  }

  private goHome(r: CameoRecord) {
    const live = r.live!;
    const token = ++live.token;
    live.state = 'returning';
    live.drift = 0;
    void live.ped.goTo(r.x, r.z, false).then((arrived) => {
      if (r.live !== live || live.token !== token) return;
      if (arrived) {
        live.state = 'home';
        live.failures = 0;
        return;
      }
      // Something in the way. Try again shortly; if it keeps happening, step back on to the mark unseen.
      const p = this.ctx.player.position;
      if (++live.failures >= 2 && Math.hypot(p.x - r.x, p.z - r.z) > 30) {
        live.ped.position.x = r.x;
        live.ped.position.z = r.z;
        live.state = 'home';
        live.failures = 0;
      } else {
        live.state = 'away';
        live.calm = 4;
      }
    });
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const r of this.records) this.despawn(r);
  }
}

/** Raise (or lower) a figure off the ground without moving the pedestrian itself. */
function setLift(ped: PedHandle, y: number) {
  const figure = ped.group.children[0];
  if (figure) figure.position.y = y;
}

// ───────────────────────────── Props ─────────────────────────────

/** A towel round the neck: a collar and two ends hanging down the chest. */
function towel(ctx: GameContext, color: number, height: number, bulk: number): THREE.Object3D | null {
  const materials = ctx.gfx?.materials;
  if (!materials) return null;
  const cloth = materials.get('cloth', { color });
  const group = new THREE.Group();
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.032, 6, 14), cloth);
  collar.rotation.x = Math.PI / 2 - 0.3;
  collar.scale.set(1.2 * bulk, 1, 1);
  // (The figures stand a little behind their own origin: the neck is at about z = −0.05.)
  collar.position.set(0, 1.49 * height, -0.05);
  group.add(collar);
  for (const side of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.02), cloth);
    end.position.set(side * 0.08 * bulk, 1.3 * height, 0.012 + 0.09 * bulk);
    end.rotation.x = -0.06;
    group.add(end);
  }
  return group;
}

/** A number on the back of a jersey. */
function jerseyNumber(ctx: GameContext, text: string, height: number, bulk: number): THREE.Object3D | null {
  const materials = ctx.gfx?.materials;
  if (!materials) return null;
  const material = materials.sign(text, { bg: '#101012', fg: '#f0f0ea', style: 'block', aspect: 1, border: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), material);
  // Just clear of the shoulder blades (the figures stand a little behind their own origin).
  mesh.position.set(0, 1.3 * height, -(0.056 + 0.184 * bulk));
  mesh.rotation.y = Math.PI;
  return mesh;
}

/** A film camera on a tripod, lens along local +z. */
function cameraOnTripod(ctx: GameContext): THREE.Object3D | null {
  const materials = ctx.gfx?.materials;
  if (!materials) return null;
  const dark = materials.get('paintedMetal', { color: 0x1c1d20 });
  const alloy = materials.get('metal', { color: 0x8a8d92 });
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 1.5, 6), alloy);
    leg.position.set(Math.sin(a) * 0.24, 0.7, Math.cos(a) * 0.24);
    leg.rotation.set(Math.cos(a) * 0.33, 0, -Math.sin(a) * 0.33);
    group.add(leg);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.42), dark);
  body.position.set(0, 1.53, 0);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.2, 10), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.53, 0.3);
  const magazine = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 12), dark);
  magazine.rotation.z = Math.PI / 2;
  magazine.position.set(0, 1.72, -0.06);
  group.add(body, lens, magazine);
  group.traverse((o) => {
    o.castShadow = true;
  });
  return group;
}
