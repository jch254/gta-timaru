/**
 * The mission runner.
 *
 *  - `MissionRun` interprets one mission: it walks the definition's steps, owns everything the mission
 *    spawns (vehicles, pedestrians, pickups, blips, markers, streaming foci) and gives it all back at the end.
 *  - `MissionRunner` is the book-keeper: which missions are locked / available / done, starting and
 *    aborting, what happens on pass and fail, and the save slice.
 *
 * Step behaviour lives in `steps.ts`; this file is the machinery they share.
 */
import * as THREE from 'three';
import type { Autopilot, BlipKind, GameContext, MissionSummary, PedHandle, PedSpawnOptions, Vehicle } from '../core/types';
import type { Dialogue } from './dialogue';
import type { Marker, MarkerPool, MarkerStyle } from './markers';
import { collectRefs } from './refs';
import { copyResolved, findPlace, isMovingSpot, maraeAt, newResolved, resolveSpot, roadDistance, routeAhead, type Resolved } from './spots';
import { STEP_HANDLERS, type StepHandler } from './steps';
import { TUNING } from './tuning';

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
import { warnOnce } from './warn';
import type { FailCondition, Line, MissionDef, MissionResult, MissionRuntime, PedDef, ResumePoint, SpawnPickupStep, SpawnVehicleStep, Spot, Step, TimerSpec } from './types';

/** Something a mission spawned (or is waiting to spawn), kept under a handle for later steps. */
export interface Entity {
  name: string;
  type: 'vehicle' | 'ped' | 'pickup';
  /** pending = waiting for the player to come near / the area to load; missing = could not be created. */
  state: 'pending' | 'live' | 'missing' | 'gone';
  spot: Spot;
  /** Where it spawns (valid once `resolved`). */
  at: Resolved;
  resolved: boolean;
  activate: number;
  vehicleDef: SpawnVehicleStep | null;
  pedDef: PedDef | null;
  pickupDef: SpawnPickupStep | null;
  vehicle: Vehicle | null;
  ped: PedHandle | null;
  removePickup: (() => void) | null;
  autopilot: Autopilot | null;
  /** The runner is calling `autopilot.update` for it. */
  driving: boolean;
  releaseFocus: (() => void) | null;
  /** Blip shown by a step: 0 none, 1 at the spawn spot, 2 following it. */
  blip: 0 | 1 | 2;
  tries: number;
  /** Mission time at which its spawn spot was first found blocked (-1 = not blocked). */
  blockedAt: number;
  /** Mission time at which a spot that follows something else is next worked out again. */
  placeAt: number;
  /** The player has been at its wheel: it is "theirs" until they walk away from it. */
  driven: boolean;
  hostile: boolean;
  /** Seconds since the mission ended (while it lingers in the world). */
  age: number;
}

/** Per-step working memory, reused for every step so stepping allocates nothing. */
export interface StepScratch {
  phase: number;
  t: number;
  n: number;
  a: number;
  b: number;
  flag: boolean;
  target: Resolved;
  marker: Marker | null;
  data: unknown;
}

export interface RunShared {
  markers: MarkerPool;
  dialogue: Dialogue;
}

const BLIP_PREFIX = 'm:';

/** Remove an entity from the world for good. A vehicle the player is sitting in is left alone (and forgotten). */
export function disposeEntity(ctx: GameContext, e: Entity) {
  if (e.releaseFocus) {
    e.releaseFocus();
    e.releaseFocus = null;
  }
  if (e.autopilot) {
    try {
      e.autopilot.stop();
    } catch {
      // The vehicle may already be gone.
    }
    e.autopilot = null;
  }
  e.driving = false;
  const v = e.vehicle;
  if (v) {
    e.vehicle = null;
    if (ctx.player.vehicle === v) {
      v.tags.delete('mission');
    } else if (ctx.vehicles.all.indexOf(v) >= 0) {
      // An AI car from the traffic module brings its own occupants: take them away with it.
      const riders = v.driver ? [v.driver, ...v.passengers] : [...v.passengers];
      ctx.vehicles.remove(v);
      for (const rider of riders) {
        if (rider.kind === 'player') continue;
        const remove = (rider as Partial<PedHandle>).remove;
        if (typeof remove !== 'function') continue;
        try {
          remove.call(rider);
        } catch {
          // Already removed by its owner.
        }
      }
    }
  }
  if (e.ped) {
    try {
      e.ped.remove();
    } catch {
      // Already removed by its owner.
    }
    e.ped = null;
  }
  if (e.removePickup) {
    e.removePickup();
    e.removePickup = null;
  }
  e.state = 'gone';
}

// ───────────────────────────── One running mission ─────────────────────────────

export class MissionRun implements MissionRuntime {
  readonly vars: Record<string, number> = {};
  elapsed = 0;
  stepTime = 0;
  stepIndex = -1;
  result: MissionResult | 'running' = 'running';
  reason = '';
  readonly entities: Entity[] = [];
  readonly scratch: StepScratch = { phase: 0, t: 0, n: 0, a: 0, b: 0, flag: false, target: newResolved(), marker: null, data: null };
  /** Seconds left on the step countdown (-1 = none). */
  stepTimer = -1;
  /** The last checkpoint step passed (for the retry offer when this run fails). */
  reached: ResumePoint | null = null;
  /** Set when this run is a retry: it resumes from this checkpoint instead of the top. */
  private resume: ResumePoint | null = null;

  private byName = new Map<string, Entity>();
  private blipIds: string[] = [];
  private stepMarkers: Marker[] = [];
  private preloadRelease: (() => void) | null = null;
  /** What this run last put on the objective line (undefined = nothing yet, so the first call always lands). */
  private objectiveText: string | null | undefined = undefined;
  private stepTimerLabel = '';
  private stepTimerReason: string | null = null;
  private missionTimer = -1;
  private missionTimerLabel = '';
  private missionTimerReason = '';
  private counter: string | null = null;
  private shownSeconds = -1;
  private shownLabel: string | null = null;
  private cueIndex = 0;
  private minWanted = 0;
  private policeSuspended = false;
  private controlsTaken = false;
  private fade: 'clear' | 'pending' | 'black' = 'clear';
  private fadeToken = 0;
  private fadeAt = 0;
  private fadeSeconds = 0;
  private prevPedDensity = -1;
  private prevTrafficDensity = -1;
  private cleaned = false;
  private tmp = newResolved();
  /** An ambush has been sprung early: where, and how far the alarm carries (-1 = nothing pending). */
  private alarmX = 0;
  private alarmZ = 0;
  private alarmRadius = -1;

  constructor(
    readonly ctx: GameContext,
    readonly def: MissionDef,
    private shared: RunShared,
  ) {
    if (def.pedDensity !== undefined) {
      this.prevPedDensity = ctx.peds.density;
      ctx.peds.density = def.pedDensity;
    }
    if (def.trafficDensity !== undefined) {
      this.prevTrafficDensity = ctx.traffic.density;
      ctx.traffic.density = def.trafficDensity;
    }
  }

  // ───────────── MissionRuntime (what custom steps and hooks see) ─────────────

  vehicle(name: string): Vehicle | null {
    return this.byName.get(name)?.vehicle ?? null;
  }

  ped(name: string): PedHandle | null {
    return this.byName.get(name)?.ped ?? null;
  }

  say(lines: readonly Line[]) {
    this.shared.dialogue.say(lines);
  }

  objective(text: string | null) {
    if (text === this.objectiveText) return;
    this.objectiveText = text;
    this.ctx.ui.objective(text);
  }

  fail(reason: string) {
    this.end('failed', reason);
  }

  freezePlayer(frozen: boolean) {
    if (frozen) {
      this.controlsTaken = true;
      this.ctx.player.controlsEnabled = false;
    } else if (this.controlsTaken) {
      this.controlsTaken = false;
      this.ctx.player.controlsEnabled = true;
    }
  }

  // ───────────── Helpers for the step handlers ─────────────

  end(result: MissionResult, reason: string) {
    if (this.result !== 'running') return;
    this.result = result;
    this.reason = reason;
  }

  get dialogueBusy(): boolean {
    return this.shared.dialogue.busy;
  }

  entity(name: string): Entity | null {
    return this.byName.get(name) ?? null;
  }

  private lookup = (name: string, out: Resolved): boolean => {
    const e = this.byName.get(name);
    if (!e) return false;
    const o = e.state === 'live' ? (e.vehicle ?? e.ped) : null;
    if (o) {
      out.x = o.position.x;
      out.z = o.position.z;
      out.heading = o.heading;
      return true;
    }
    if (!e.resolved || e.state === 'missing' || e.state === 'gone') return false;
    out.x = e.at.x;
    out.z = e.at.z;
    out.heading = e.at.heading;
    return true;
  };

  resolve(spot: Spot, out: Resolved): Resolved {
    return resolveSpot(this.ctx.world, spot, out, this.lookup);
  }

  /** The live vehicle / pedestrian a spot follows, for a blip that tracks it. */
  followOf(spot: Spot): { position: THREE.Vector3 } | null {
    if (typeof spot === 'string' || spot.entity === undefined) return null;
    const e = this.byName.get(spot.entity);
    return e && e.state === 'live' ? (e.vehicle ?? e.ped) : null;
  }

  /** Step-scoped map blip (removed when the step ends). Pinned so it stays on the minimap edge. */
  setBlip(id: string, kind: BlipKind, x: number, z: number, follow?: { position: THREE.Vector3 } | null, label?: string) {
    const full = BLIP_PREFIX + id;
    if (this.blipIds.indexOf(full) < 0) this.blipIds.push(full);
    this.ctx.ui.setBlip({ id: full, kind, x, z, pinned: true, follow: follow ?? undefined, label });
  }

  removeBlip(id: string) {
    const full = BLIP_PREFIX + id;
    const i = this.blipIds.indexOf(full);
    if (i < 0) return;
    this.blipIds.splice(i, 1);
    this.ctx.ui.removeBlip(full);
  }

  /** Step-scoped in-world marker (released when the step ends). */
  acquireMarker(style: MarkerStyle): Marker {
    const marker = this.shared.markers.acquire(style);
    this.stepMarkers.push(marker);
    return marker;
  }

  placeMarker(marker: Marker, x: number, z: number, radius: number) {
    marker.place(x, this.ctx.world.groundAt(x, z), z, radius);
  }

  /** Ask the streamer to get a destination ready as the player closes in. Released when the step ends. */
  preload(x: number, z: number) {
    const { ctx } = this;
    if (ctx.world.isLoaded(x, z)) {
      if (this.preloadRelease) {
        this.preloadRelease();
        this.preloadRelease = null;
      }
      return;
    }
    if (this.preloadRelease) return;
    const p = ctx.player.position;
    if (Math.hypot(p.x - x, p.z - z) <= TUNING.preloadDistance) this.preloadRelease = ctx.world.addFocus(x, z, TUNING.preloadRadius);
  }

  /** Label-only readout in the timer slot (shown when no countdown is running). */
  setCounter(text: string | null) {
    this.counter = text;
  }

  timerSeconds(spec: number | TimerSpec): number {
    if (typeof spec === 'number') return spec;
    let seconds = (spec.seconds ?? 0) + (spec.base ?? 0);
    if (spec.perKm && spec.to !== undefined) {
      const to = this.resolve(spec.to, this.tmp);
      if (to.ok) {
        const p = this.ctx.player.position;
        seconds += (roadDistance(this.ctx.world, p.x, p.z, to.x, to.z) / 1000) * spec.perKm;
      }
    }
    return Math.max(5, Math.round(seconds));
  }

  /** Countdown for the current step. `reason` null = running out is not a failure (the step decides). */
  startStepTimer(spec: number | TimerSpec, label: string, reason: string | null) {
    this.stepTimer = this.timerSeconds(spec);
    this.stepTimerLabel = label;
    this.stepTimerReason = reason;
  }

  startMissionTimer(spec: number | TimerSpec) {
    this.missionTimer = this.timerSeconds(spec);
    this.missionTimerLabel = (typeof spec === 'object' && spec.label) || 'Time';
    this.missionTimerReason = (typeof spec === 'object' && spec.reason) || 'Out of time';
  }

  stopMissionTimer() {
    this.missionTimer = -1;
  }

  get missionTimeLeft(): number {
    return this.missionTimer;
  }

  raiseWanted(level: number, hold: boolean) {
    this.pushWanted(level);
    if (hold && level > this.minWanted) this.minWanted = level;
  }

  /** Raise the wanted level to at least `level`. Never while the player is on a marae: no heat is staged there. */
  private pushWanted(level: number) {
    const { police, player, world } = this.ctx;
    if (police.level >= level) return;
    if (maraeAt(world, player.position.x, player.position.z, TUNING.maraeMargin)) return;
    police.setLevel(level);
  }

  /** Stop holding the wanted level up (it may now be lost). */
  releaseWanted() {
    this.minWanted = 0;
  }

  suspendPolice() {
    this.policeSuspended = true;
    this.ctx.police.enabled = false;
  }

  resumePolice() {
    if (!this.policeSuspended) return;
    this.policeSuspended = false;
    this.ctx.police.enabled = true;
  }

  fadeOut(seconds = 0.6) {
    if (this.fade !== 'clear') return;
    this.fade = 'pending';
    this.fadeAt = this.elapsed;
    this.fadeSeconds = seconds;
    const token = ++this.fadeToken;
    const arrived = () => {
      if (this.fadeToken === token && this.fade === 'pending') this.fade = 'black';
    };
    try {
      this.ctx.ui.fade(true, seconds).then(arrived, arrived);
    } catch {
      this.fade = 'black';
    }
  }

  /** At full black (or the UI never told us, and it has been long enough). */
  get faded(): boolean {
    return this.fade === 'black' || (this.fade === 'pending' && this.elapsed - this.fadeAt > this.fadeSeconds + 1.5);
  }

  fadeIn(seconds = 0.6) {
    if (this.fade === 'clear') return;
    this.fade = 'clear';
    this.fadeToken++;
    try {
      void this.ctx.ui.fade(false, seconds).catch(() => undefined);
    } catch {
      // No fade available: nothing to undo.
    }
  }

  // ───────────── Entities ─────────────

  private makeEntity(name: string, type: Entity['type'], spot: Spot, activate: number): Entity {
    const previous = this.byName.get(name);
    if (previous) {
      // A handle is being reused: the old thing goes.
      disposeEntity(this.ctx, previous);
      const i = this.entities.indexOf(previous);
      if (i >= 0) this.entities.splice(i, 1);
    }
    const e: Entity = {
      name,
      type,
      state: 'pending',
      spot,
      at: newResolved(),
      resolved: false,
      activate,
      vehicleDef: null,
      pedDef: null,
      pickupDef: null,
      vehicle: null,
      ped: null,
      removePickup: null,
      autopilot: null,
      driving: false,
      releaseFocus: null,
      blip: 0,
      tries: 0,
      blockedAt: -1,
      placeAt: 0,
      driven: false,
      hostile: false,
      age: 0,
    };
    this.byName.set(name, e);
    this.entities.push(e);
    return e;
  }

  /** Work out where a pending entity goes. Unplaceable or barred ones become 'missing'. */
  private place(e: Entity) {
    this.resolve(e.spot, e.at);
    e.resolved = e.at.ok;
    if (!e.resolved) {
      if (isMovingSpot(e.spot)) return; // what it follows is not there yet
      warnOnce(`missions: nowhere to put "${e.name}" in "${this.def.id}"`);
      e.state = 'missing';
    } else if (this.barred(e)) {
      warnOnce(`missions: "${e.name}" in "${this.def.id}" would be on a marae, so it is left out`);
      e.resolved = false;
      e.state = 'missing';
    } else if (e.at.edge && this.ctx.world.waterDepthAt(e.at.x, e.at.z) > 0.2) {
      // A verge that turns out to be harbour (wharves, river banks): stand on the road instead.
      const mid = this.ctx.world.graph.pointAt(e.at.edge, e.at.s);
      e.at.x = mid.x;
      e.at.z = mid.z;
    }
  }

  /** Marae are off limits to anything hostile, to mission vehicles and to pickups. An unarmed, friendly figure is fine. */
  private barred(e: Entity): boolean {
    const ped = e.pedDef;
    if (e.type === 'ped' && ped && (ped.behaviour ?? 'stand') !== 'attack' && ped.weapon === undefined) return false;
    return maraeAt(this.ctx.world, e.at.x, e.at.z, TUNING.maraeMargin) !== null;
  }

  addVehicle(def: SpawnVehicleStep): Entity {
    const e = this.makeEntity(def.as, 'vehicle', def.at, def.activate ?? TUNING.vehicleActivate);
    e.vehicleDef = def;
    this.trySpawn(e);
    return e;
  }

  addPed(def: PedDef, activate: number): Entity {
    const e = this.makeEntity(def.as, 'ped', def.at, activate);
    e.pedDef = def;
    this.trySpawn(e);
    return e;
  }

  addPickup(def: SpawnPickupStep, name: string): Entity {
    const e = this.makeEntity(name, 'pickup', def.at, def.activate ?? TUNING.pickupActivate);
    e.pickupDef = def;
    this.trySpawn(e);
    return e;
  }

  /** An AI car created right now at a resolved position (race grids). `state` says whether it worked. */
  addRival(def: SpawnVehicleStep, at: Resolved): Entity {
    const e = this.makeEntity(def.as, 'vehicle', def.at, Infinity);
    e.vehicleDef = def;
    copyResolved(at, e.at);
    e.resolved = at.ok;
    if (e.resolved) this.spawn(e);
    if (e.state === 'pending') e.state = 'missing';
    return e;
  }

  /** Change what a spawned pedestrian is doing; one still waiting to spawn starts out that way instead. */
  setBehaviour(e: Entity, behaviour: NonNullable<PedDef['behaviour']>) {
    if (e.type !== 'ped' || !e.pedDef) return;
    if (e.state === 'pending') {
      e.pedDef = { ...e.pedDef, behaviour };
      return;
    }
    if (e.state !== 'live' || !e.ped || !e.ped.alive) return;
    // Nobody is set on anybody on a marae.
    if (behaviour === 'attack' && maraeAt(this.ctx.world, e.ped.position.x, e.ped.position.z, TUNING.maraeMargin)) return;
    e.hostile = behaviour === 'attack';
    try {
      if (behaviour === 'attack' || behaviour === 'follow') e.ped.setBehaviour(behaviour, this.ctx.player);
      else e.ped.setBehaviour(behaviour);
    } catch {
      // Its owner will deal with it.
    }
  }

  /** A crew standing about waiting for its cue: armed or gang, alive, and not yet set on the player. */
  private waiting(e: Entity): boolean {
    const def = e.pedDef;
    return e.type === 'ped' && e.state === 'live' && !e.hostile && e.ped !== null && e.ped.alive && def !== null && (def.kind === 'gang' || def.weapon !== undefined);
  }

  /** One of ours has been hurt (called from the event bus: only takes a note, acted on in the next update). */
  noteDamage(actor: unknown) {
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.ped !== actor || !this.waiting(e)) continue;
      this.raiseAlarm(e.ped!.position.x, e.ped!.position.z);
      return;
    }
  }

  /** The player has fired a shot: a waiting crew within earshot does not wait any longer. */
  noteGunshot(x: number, z: number) {
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!this.waiting(e)) continue;
      if (Math.hypot(e.ped!.position.x - x, e.ped!.position.z - z) > TUNING.alarmEarshot) continue;
      this.raiseAlarm(x, z);
      return;
    }
  }

  private raiseAlarm(x: number, z: number) {
    this.alarmX = x;
    this.alarmZ = z;
    this.alarmRadius = TUNING.alarmRadius;
  }

  private springAmbush() {
    const r = this.alarmRadius;
    this.alarmRadius = -1;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!this.waiting(e)) continue;
      if (Math.hypot(e.ped!.position.x - this.alarmX, e.ped!.position.z - this.alarmZ) <= r) this.setBehaviour(e, 'attack');
    }
  }

  /** Remove one entity now (handover, `despawn` steps). */
  despawn(e: Entity) {
    if (e.blip !== 0) {
      e.blip = 0;
      this.removeBlip(e.name);
    }
    disposeEntity(this.ctx, e);
  }

  private specFor(id: string): string | null {
    const specs = this.ctx.vehicles.specs;
    if (specs.has(id)) return id;
    warnOnce(`missions: vehicle spec "${id}" is not in the roster yet, using a stand-in`);
    if (specs.has('statesman')) return 'statesman';
    const first = specs.keys().next();
    return first.done ? null : first.value;
  }

  private processSpawns() {
    const mine = this.ctx.player.vehicle;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      // A parked mission vehicle keeps its patch of world loaded until the player has taken it.
      if (mine !== null && mine === e.vehicle && e.state === 'live') {
        e.driven = true;
        if (e.releaseFocus) {
          e.releaseFocus();
          e.releaseFocus = null;
        }
      }
      if (e.state === 'pending') this.trySpawn(e);
    }
  }

  /** Create a pending entity if the player is close enough and its ground has streamed in. */
  private trySpawn(e: Entity) {
    const { ctx } = this;
    if (!e.resolved || isMovingSpot(e.spot)) {
      // A spot that hangs off another entity is worked out again now and then, not every frame.
      if (this.elapsed >= e.placeAt) {
        e.placeAt = this.elapsed + 0.5;
        this.place(e);
      }
      if (!e.resolved || e.state !== 'pending') return;
    }
    const p = ctx.player.position;
    if (Math.hypot(p.x - e.at.x, p.z - e.at.z) > e.activate) return;
    if (!ctx.world.isLoaded(e.at.x, e.at.z)) {
      if (!e.releaseFocus) e.releaseFocus = ctx.world.addFocus(e.at.x, e.at.z, TUNING.preloadRadius);
      return;
    }
    if (e.type === 'vehicle' && !this.clearSpot(e.at.x, e.at.z)) {
      // Somebody is in the way. Traffic moves on by itself; a car left sitting on the spot (very often the
      // player's own, parked right on the marker) will not, so after a moment the vehicle goes beside it.
      if (e.blockedAt < 0) e.blockedAt = this.elapsed;
      if (this.elapsed - e.blockedAt < 1.5 || !this.shiftOffBlockedSpot(e)) return;
    }
    e.blockedAt = -1;
    this.spawn(e);
    const state = e.state as Entity['state'];
    if (state === 'pending') {
      if (++e.tries <= TUNING.spawnTries) return;
      warnOnce(`missions: could not spawn "${e.name}" in "${this.def.id}"`);
      e.state = 'missing';
    }
    // A parked mission vehicle keeps the ground under it loaded until the player takes it (or the mission
    // ends); everything else looks after itself once it exists.
    const parked = state === 'live' && e.type === 'vehicle' && !e.autopilot;
    if (parked) {
      if (!e.releaseFocus) e.releaseFocus = ctx.world.addFocus(e.at.x, e.at.z, TUNING.preloadRadius);
    } else if (e.releaseFocus) {
      e.releaseFocus();
      e.releaseFocus = null;
    }
  }

  /** Move a blocked vehicle spawn to the nearest free, level, dry patch of ground around it. */
  private shiftOffBlockedSpot(e: Entity): boolean {
    const { ctx } = this;
    const y = ctx.world.groundAt(e.at.x, e.at.z);
    for (const radius of [7, 10, 14]) {
      for (let k = 0; k < 8; k++) {
        const angle = e.at.heading + (k * Math.PI) / 4 + (radius === 10 ? Math.PI / 8 : 0);
        const x = e.at.x + Math.sin(angle) * radius;
        const z = e.at.z + Math.cos(angle) * radius;
        if (!ctx.world.isLoaded(x, z) || ctx.world.waterDepthAt(x, z) > 0.05) continue;
        const gy = ctx.world.groundAt(x, z);
        if (Math.abs(gy - y) > 0.8) continue;
        if (ctx.vehicles.all.some((v) => Math.hypot(v.position.x - x, v.position.z - z) < v.spec.length * 0.5 + 3.2)) continue;
        // Nothing solid between the old spot and the new one (so not through a wall or into a building).
        _from.set(e.at.x, y + 1.1, e.at.z);
        _to.set(x, gy + 1.1, z);
        if (!ctx.physics.lineOfSight(_from, _to)) continue;
        e.at.x = x;
        e.at.z = z;
        return true;
      }
    }
    return false;
  }

  /**
   * Make room for a mission vehicle: ambient parked or abandoned cars on the spot are taken away. Returns
   * false while something that cannot simply be removed (the player's car, traffic passing through) is there.
   */
  private clearSpot(x: number, z: number): boolean {
    const { ctx } = this;
    const all = ctx.vehicles.all;
    let clear = true;
    for (let i = all.length - 1; i >= 0; i--) {
      const v = all[i];
      if (Math.hypot(v.position.x - x, v.position.z - z) > v.spec.length * 0.5 + 2.6) continue;
      const idle = v.driver === null && v !== ctx.player.vehicle && !v.tags.has('mission') && (v.controller === 'none' || v.tags.has('parked'));
      if (idle) ctx.vehicles.remove(v);
      else clear = false;
    }
    return clear;
  }

  private spawn(e: Entity) {
    if (this.barred(e)) {
      e.state = 'missing';
      return;
    }
    if (e.type === 'vehicle') this.spawnVehicle(e);
    else if (e.type === 'ped') this.spawnPed(e);
    else this.spawnPickup(e);
  }

  private spawnVehicle(e: Entity) {
    const { ctx } = this;
    const def = e.vehicleDef!;
    const spec = this.specFor(def.spec);
    if (!spec) {
      e.state = 'missing';
      return;
    }
    const at = e.at;
    let v: Vehicle | null = null;
    if (def.ai) {
      // Preferred: a driver from the traffic module. Otherwise a bare vehicle with an autopilot of our own.
      try {
        v = ctx.traffic.spawnDriver(spec, at.x, at.z, { aggression: def.ai.aggression, tags: ['mission'], persistent: true });
      } catch {
        v = null;
      }
      if (v) v.teleport(at.x, ctx.world.groundAt(at.x, at.z), at.z, at.heading);
      else v = ctx.vehicles.spawn(spec, at.x, at.z, at.heading, { color: def.color, controller: 'mission', tags: ['mission'] });
      if (!v) return; // try again next frame
      let autopilot: Autopilot | null = null;
      try {
        autopilot = ctx.traffic.createAutopilot(v);
      } catch {
        autopilot = null;
      }
      if (!autopilot) {
        warnOnce('missions: no traffic AI yet, so rivals and chase targets are skipped');
        e.vehicle = v;
        disposeEntity(ctx, e);
        e.state = 'missing';
        return;
      }
      autopilot.aggression = def.ai.aggression ?? TUNING.rivalAggression;
      autopilot.cruiseSpeed = def.ai.cruiseSpeed ?? TUNING.rivalCruise;
      autopilot.avoidObstacles = true;
      e.autopilot = autopilot;
    } else {
      v = ctx.vehicles.spawn(spec, at.x, at.z, at.heading, { color: def.color, controller: 'mission', tags: ['mission'] });
      if (!v) return;
    }
    v.controller = 'mission';
    v.tags.add('mission');
    if (def.tags) for (const tag of def.tags) v.tags.add(tag);
    if (def.owned) v.tags.add('owned');
    if (def.health !== undefined) v.health = v.spec.health * def.health;
    // Nobody is driving it yet: keep it where it was put (the Bay Hill is steep).
    v.controls.throttle = 0;
    v.controls.brake = 0;
    v.controls.steer = 0;
    v.controls.handbrake = true;
    e.vehicle = v;
    e.state = 'live';
  }

  private spawnPed(e: Entity) {
    const { ctx } = this;
    const def = e.pedDef!;
    const behaviour = def.behaviour ?? 'stand';
    const options: PedSpawnOptions = {
      x: e.at.x,
      z: e.at.z,
      heading: e.at.heading,
      kind: def.kind ?? (behaviour === 'attack' ? 'gang' : 'scripted'),
      behaviour,
      persistent: true,
    };
    if (def.name !== undefined) options.name = def.name;
    if (def.look !== undefined) options.look = def.look;
    if (def.health !== undefined) options.health = def.health;
    if (def.weapon !== undefined && ctx.combat.weapons.has(def.weapon)) options.weaponId = def.weapon;
    try {
      e.ped = ctx.peds.spawn(options);
      e.hostile = behaviour === 'attack';
      e.state = 'live';
    } catch {
      warnOnce('missions: no pedestrians yet, so mission characters are skipped');
      e.state = 'missing';
    }
  }

  private spawnPickup(e: Entity) {
    const def = e.pickupDef!;
    try {
      e.removePickup = this.ctx.combat.spawnPickup(def.pickup, e.at.x, e.at.z, def.amount, def.respawn);
      e.state = 'live';
    } catch {
      e.state = 'missing';
    }
  }

  /** Send an AI vehicle to a point by road (or straight at it when there is no route). */
  driveTo(e: Entity, x: number, z: number, cruiseSpeed?: number, aggression?: number): boolean {
    const ap = e.autopilot;
    const v = e.vehicle;
    if (!ap || !v) return false;
    const route = routeAhead(this.ctx.world, v.position.x, v.position.z, v.heading, x, z);
    if (route) ap.setRoute(route);
    else ap.setTarget(x, z);
    if (cruiseSpeed !== undefined) ap.cruiseSpeed = cruiseSpeed;
    if (aggression !== undefined) ap.aggression = aggression;
    this.startAi(e);
    return true;
  }

  startAi(e: Entity) {
    if (!e.autopilot || !e.vehicle) return;
    e.driving = true;
    e.vehicle.controls.handbrake = false;
  }

  stopAi(e: Entity) {
    if (!e.autopilot) return;
    e.driving = false;
    try {
      e.autopilot.stop();
    } catch {
      // Vehicle already gone.
    }
    if (e.vehicle) {
      e.vehicle.controls.throttle = 0;
      e.vehicle.controls.handbrake = true;
    }
  }

  private driveAi(dt: number) {
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!e.driving || !e.autopilot || !e.vehicle) continue;
      if (e.vehicle.destroyed) {
        e.driving = false;
        continue;
      }
      // Hijacked (or claimed by another system): whoever holds the wheel writes the controls, not us.
      if (e.vehicle.controller !== 'mission') continue;
      e.autopilot.update(dt);
    }
  }

  // ───────────── Stepping ─────────────

  /** Make this run a retry that picks up from a checkpoint (call before the first update). */
  beginAt(resume: ResumePoint | null) {
    this.resume = resume;
  }

  /**
   * Replay the steps before a checkpoint in set-up-only form: spawns, weapons, weather, the clock and
   * timers land again; drives, talk and fights do not. Enemies a passed eliminate or chase step dealt with
   * stay dealt with, and a vehicle the mission had the player driving waits at the checkpoint instead of
   * its original spot.
   */
  private fastForward(upTo: number) {
    const steps = this.def.steps;
    const dealtWith = new Set<string>();
    const ridden = new Set<string>();
    for (let i = 0; i < upTo; i++) {
      const step = steps[i];
      if (step.kind === 'eliminate') for (const t of step.targets) dealtWith.add(t);
      else if (step.kind === 'chase') dealtWith.add(step.target);
      if ((step.kind === 'enterVehicle' || step.kind === 'loseHeat' || step.kind === 'goTo') && step.vehicle !== undefined) ridden.add(step.vehicle);
      else if (step.kind === 'deliverVehicle') {
        // Delivered with a handover: the vehicle is gone (a shed door came down on it). It neither respawns
        // nor waits at the kerb — the retry resumes on foot, as the player stood after the hand-over.
        if (step.handover) dealtWith.add(step.vehicle);
        else ridden.add(step.vehicle);
      } else if (step.kind === 'spawnVehicle' && step.owned) ridden.add(step.as);
    }
    const here = newResolved();
    if (this.resume) this.resolve(this.resume.at, here);
    for (let i = 0; i < upTo; i++) {
      const step = steps[i];
      switch (step.kind) {
        case 'spawnVehicle': {
          if (dealtWith.has(step.as)) break;
          // Their getaway stands where they stand, not a province away — and they are back at its wheel.
          const mine = ridden.has(step.as) && here.ok;
          const at: Spot = mine ? { x: here.x, z: here.z, snap: 'lane', kerb: true } : step.at;
          const e = this.addVehicle(mine ? { ...step, at } : step);
          if (mine && e.state === 'live' && e.vehicle) this.ctx.player.warpIntoVehicle(e.vehicle);
          break;
        }
        case 'spawnPeds': {
          const activate = step.activate ?? TUNING.pedActivate;
          for (const ped of step.peds) if (!dealtWith.has(ped.as)) this.addPed(ped, activate);
          break;
        }
        case 'spawnPickup':
          this.addPickup(step, step.as ?? `pickup${i}`);
          break;
        case 'giveWeapon': {
          const { combat, player } = this.ctx;
          if (combat.weapons.has(step.weapon)) {
            combat.give(step.weapon, step.ammo);
            if (step.select) combat.select(step.weapon);
          }
          if (step.armour) player.addArmour(step.armour);
          break;
        }
        case 'setWeather':
          this.ctx.env.setWeather(step.weather, step.transition);
          break;
        case 'setTime': {
          const clock = this.ctx.clock;
          const h = clock.hour;
          const w = step.unlessBetween;
          const inside = w !== undefined && (w[0] <= w[1] ? h >= w[0] && h <= w[1] : h >= w[0] || h <= w[1]);
          if (!inside) clock.advanceHours((((step.hour - h) % 24) + 24) % 24);
          break;
        }
        case 'startTimer':
          this.startMissionTimer(step.time);
          break;
        case 'stopTimer':
          this.stopMissionTimer();
          break;
        case 'despawn':
          for (const name of step.handles) {
            const e = this.entity(name);
            if (e) this.despawn(e);
          }
          break;
        default:
          break; // drives, talk, fights and the law are not replayed
      }
    }
  }

  update(dt: number) {
    if (this.result !== 'running') return;
    this.elapsed += dt;
    this.processSpawns();
    if (this.alarmRadius >= 0) this.springAmbush();
    this.driveAi(dt);
    if (this.stepIndex < 0) {
      if (this.resume && this.resume.index > 0) {
        this.fastForward(this.resume.index);
        this.advance(this.resume.index);
      } else this.advance(0);
    }
    let sdt = dt;
    // Instant steps (spawns, weather, weapons…) complete in the same frame; the guard only stops a runaway definition.
    for (let guard = 0; guard < 64; guard++) {
      if (this.result !== 'running') return;
      const step = this.def.steps[this.stepIndex];
      if (!step) {
        this.end('passed', '');
        return;
      }
      this.stepTime += sdt;
      this.tickCommon(step, sdt);
      if (this.result !== 'running') return;
      const done = (STEP_HANDLERS[step.kind] as StepHandler<Step>).tick(this, step, this.scratch, sdt);
      if (this.result !== 'running') return;
      if (!done) break;
      this.exitStep(step);
      this.advance(this.stepIndex + 1);
      sdt = 0;
    }
    this.showTimer();
  }

  /** Enter the next step that applies, passing over optional ones whose spot is not on this map. */
  private advance(index: number) {
    const steps = this.def.steps;
    while (index < steps.length) {
      const needs = steps[index].needs;
      if (needs === undefined || this.resolve(needs, this.tmp).ok) break;
      index++;
    }
    this.enterStep(index);
  }

  private enterStep(index: number) {
    this.stepIndex = index;
    this.stepTime = 0;
    this.cueIndex = 0;
    this.minWanted = 0;
    const s = this.scratch;
    s.phase = 0;
    s.t = 0;
    s.n = 0;
    s.a = 0;
    s.b = 0;
    s.flag = false;
    s.target.ok = false;
    s.marker = null;
    s.data = null;
    const step = this.def.steps[index];
    if (!step) return;
    if (step.objective !== undefined) this.objective(step.objective);
    if (step.lines) this.shared.dialogue.say(step.lines);
    if (step.toast) this.ctx.ui.toast(step.toast, 4);
    if (step.timer !== undefined) {
      const spec = step.timer;
      this.startStepTimer(spec, (typeof spec === 'object' && spec.label) || 'Time', (typeof spec === 'object' && spec.reason) || 'Out of time');
    }
    if (step.police) {
      if (step.police.clear) this.ctx.police.clear();
      if (step.police.suspend) this.suspendPolice();
      if (step.police.minLevel) this.raiseWanted(step.police.minLevel, true);
    }
    (STEP_HANDLERS[step.kind] as StepHandler<Step>).enter?.(this, step, this.scratch);
  }

  private exitStep(step: Step) {
    try {
      (STEP_HANDLERS[step.kind] as StepHandler<Step>).exit?.(this, step, this.scratch);
    } catch (err) {
      console.warn(`missions: step ${this.stepIndex} of "${this.def.id}" failed to exit cleanly`, err);
    }
    this.releaseStepResources();
  }

  private releaseStepResources() {
    for (let i = 0; i < this.blipIds.length; i++) this.ctx.ui.removeBlip(this.blipIds[i]);
    this.blipIds.length = 0;
    for (let i = 0; i < this.entities.length; i++) this.entities[i].blip = 0;
    for (let i = 0; i < this.stepMarkers.length; i++) this.shared.markers.release(this.stepMarkers[i]);
    this.stepMarkers.length = 0;
    this.scratch.marker = null;
    if (this.preloadRelease) {
      this.preloadRelease();
      this.preloadRelease = null;
    }
    this.stepTimer = -1;
    this.counter = null;
    this.minWanted = 0;
    this.resumePolice();
  }

  /** Timers, cues, police pressure and fail conditions shared by every step kind. */
  private tickCommon(step: Step, dt: number) {
    const { ctx } = this;
    if (this.missionTimer >= 0) {
      this.missionTimer -= dt;
      if (this.missionTimer <= 0) {
        this.missionTimer = 0;
        this.fail(this.missionTimerReason);
        return;
      }
    }
    if (this.stepTimer >= 0) {
      this.stepTimer = Math.max(0, this.stepTimer - dt);
      if (this.stepTimer <= 0 && this.stepTimerReason !== null) {
        this.fail(this.stepTimerReason);
        return;
      }
    }
    const cues = step.cues;
    if (cues) {
      while (this.cueIndex < cues.length && this.stepTime >= cues[this.cueIndex].at) {
        const cue = cues[this.cueIndex++];
        if (cue.lines) this.shared.dialogue.say(cue.lines);
        if (cue.toast) ctx.ui.toast(cue.toast, 4);
        if (cue.sfx) ctx.audio.play(cue.sfx, { at: ctx.player.position });
        if (cue.wanted) this.raiseWanted(cue.wanted, true);
      }
    }
    if (this.minWanted > 0) this.pushWanted(this.minWanted);
    if (step.police?.heatPerSecond && dt > 0) ctx.police.addHeat(step.police.heatPerSecond * dt);
    if (step.failIf && this.checkFail(step.failIf)) return;
    if (this.def.failIf) this.checkFail(this.def.failIf);
  }

  private checkFail(conditions: readonly FailCondition[]): boolean {
    const { ctx } = this;
    const p = ctx.player.position;
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      let failed = false;
      let reason = '';
      switch (c.kind) {
        case 'vehicleDestroyed': {
          const v = this.vehicle(c.vehicle);
          failed = v !== null && (v.destroyed || v.health <= 0);
          if (failed) reason = c.reason ?? `The ${v!.spec.name} is a write-off`;
          break;
        }
        case 'vehicleDamaged': {
          const v = this.vehicle(c.vehicle);
          failed = v !== null && v.health < v.spec.health * c.below;
          if (failed) reason = c.reason ?? `The ${v!.spec.name} is too far gone`;
          break;
        }
        case 'escaped': {
          const e = this.byName.get(c.target);
          const o = e && e.state === 'live' ? (e.vehicle ?? e.ped) : null;
          failed = !!o && Math.hypot(o.position.x - p.x, o.position.z - p.z) > c.distance;
          reason = c.reason ?? 'They got away';
          break;
        }
        case 'pedDied': {
          const ped = this.ped(c.ped);
          failed = ped !== null && !ped.alive;
          if (failed) reason = c.reason ?? `${ped!.name ?? 'Your contact'} is dead`;
          break;
        }
        case 'abandoned': {
          const v = this.vehicle(c.vehicle);
          failed = v !== null && ctx.player.vehicle !== v && Math.hypot(v.position.x - p.x, v.position.z - p.z) > c.distance;
          if (failed) reason = c.reason ?? `You left the ${v!.spec.name} behind`;
          break;
        }
        case 'wantedAbove':
          failed = ctx.police.level > c.level;
          reason = c.reason ?? 'Too much heat';
          break;
        case 'custom':
          failed = c.test(this);
          reason = c.reason;
          break;
      }
      if (failed) {
        this.fail(reason);
        return true;
      }
    }
    return false;
  }

  private showTimer() {
    let label: string | null = null;
    let seconds = -1;
    if (this.stepTimer >= 0) {
      label = this.stepTimerLabel;
      seconds = Math.ceil(this.stepTimer);
    } else if (this.missionTimer >= 0) {
      label = this.missionTimerLabel;
      seconds = Math.ceil(this.missionTimer);
    } else if (this.counter !== null) {
      label = this.counter;
    }
    if (label === this.shownLabel && seconds === this.shownSeconds) return;
    this.shownLabel = label;
    this.shownSeconds = seconds;
    if (label === null) this.ctx.ui.timer(null);
    else if (seconds >= 0) this.ctx.ui.timer(label, seconds);
    else this.ctx.ui.timer(label);
  }

  // ───────────── Ending ─────────────

  /**
   * Give everything back. UI state, foci, pickups, the law and the player's controls are restored at once.
   * With `hard` the spawned vehicles and pedestrians go immediately; otherwise they are handed to `lingering`
   * (hostile survivors told to scarper) so the scene does not blink out in front of the player.
   */
  cleanup(hard: boolean, lingering: Entity[]) {
    if (this.cleaned) return;
    this.cleaned = true;
    const { ctx } = this;
    const step = this.def.steps[this.stepIndex];
    if (step) this.exitStep(step);
    else this.releaseStepResources();
    this.objectiveText = null;
    ctx.ui.objective(null);
    ctx.ui.timer(null);
    this.shownLabel = null;
    this.shownSeconds = -1;
    this.missionTimer = -1;
    ctx.police.enabled = true;
    this.policeSuspended = false;
    this.freezePlayer(false);
    this.fadeIn(0.5);
    if (this.prevPedDensity >= 0) ctx.peds.density = this.prevPedDensity;
    if (this.prevTrafficDensity >= 0) ctx.traffic.density = this.prevTrafficDensity;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.releaseFocus) {
        e.releaseFocus();
        e.releaseFocus = null;
      }
      if (e.autopilot) this.stopAi(e);
      const keep = !hard && e.state === 'live' && (e.vehicle !== null || e.ped !== null);
      if (!keep) {
        disposeEntity(ctx, e);
        continue;
      }
      if (e.ped && e.hostile && e.ped.alive) {
        try {
          e.ped.setBehaviour('flee');
        } catch {
          // Its owner will deal with it.
        }
      }
      e.age = 0;
      lingering.push(e);
    }
    this.entities.length = 0;
    this.byName.clear();
    for (const key in this.vars) delete this.vars[key];
  }
}

// ───────────────────────────── The book-keeper ─────────────────────────────

interface SaveData {
  v: 1;
  done: string[];
  completed: boolean;
}

export class MissionRunner {
  readonly defs: readonly MissionDef[];
  readonly done = new Set<string>();
  /** Missions that cannot run on this map (a place they need is missing). They never block the chain. */
  readonly disabled = new Set<string>();
  completed = false;
  run: MissionRun | null = null;
  /** After a failure: what can be retried, and from where (null resume = from the start). */
  retry: { id: string; resume: ResumePoint | null } | null = null;
  /** Called whenever any mission's state changes (blips and beacons re-sync from this). */
  onChange: (() => void) | null = null;
  onResult: ((def: MissionDef, result: MissionResult, reason: string) => void) | null = null;

  private byId = new Map<string, MissionDef>();
  private summaries: MissionSummary[] = [];
  private summaryOf = new Map<string, MissionSummary>();
  private lingering: Entity[] = [];
  private offs: (() => void)[] = [];

  constructor(
    private ctx: GameContext,
    defs: readonly MissionDef[],
    private shared: RunShared,
  ) {
    this.defs = defs;
    for (const def of defs) {
      this.byId.set(def.id, def);
      const summary: MissionSummary = { id: def.id, title: def.title, giver: def.giver, blurb: def.blurb, reward: def.reward, state: 'locked', placeId: def.placeId };
      this.summaries.push(summary);
      this.summaryOf.set(def.id, summary);
    }
    // Only flag the failure here: the clean-up happens in our own update, never in the middle of the
    // system that happened to deliver the blow.
    this.offs.push(ctx.events.on('playerDied', () => this.run?.fail('You carked it')));
    this.offs.push(ctx.events.on('playerBusted', () => this.run?.fail('Nicked')));
    // A crew waiting on its cue does not keep waiting once it is shot at.
    this.offs.push(ctx.events.on('actorDamaged', ({ actor }) => this.run?.noteDamage(actor)));
    this.offs.push(
      ctx.events.on('gunshot', ({ shooter, position }) => {
        if (shooter.kind === 'player') this.run?.noteGunshot(position.x, position.z);
      }),
    );
    this.refresh();
  }

  /** Disable missions whose places are not on the map. Call once the world exists. */
  validate() {
    const problems: string[] = [];
    this.disabled.clear();
    for (const def of this.defs) {
      const missing: string[] = [];
      for (const id of collectRefs(def).places) if (!findPlace(this.ctx.world, id)) missing.push(id);
      // No job is handed out on a marae.
      const start = findPlace(this.ctx.world, def.placeId);
      if (start && maraeAt(this.ctx.world, start.x, start.z, TUNING.maraeMargin)) missing.push(`${def.placeId} is on a marae`);
      if (missing.length) {
        this.disabled.add(def.id);
        problems.push(`${def.id} (${missing.join(', ')})`);
      }
    }
    if (problems.length) console.warn(`missions: disabled until the map has their places: ${problems.join('; ')}`);
    this.refresh();
  }

  stateOf(def: MissionDef): MissionSummary['state'] {
    if (this.run && this.run.def === def) return 'active';
    if (this.done.has(def.id)) return 'done';
    if (this.disabled.has(def.id)) return 'locked';
    if (def.requires) for (const id of def.requires) if (!this.satisfied(id, 0)) return 'locked';
    return 'available';
  }

  /** A requirement is met when that mission is done, or cannot run on this map and its own requirements are met. */
  private satisfied(id: string, depth: number): boolean {
    if (this.done.has(id)) return true;
    if (!this.disabled.has(id) || depth > 16) return false;
    const requires = this.byId.get(id)?.requires;
    if (requires) for (const earlier of requires) if (!this.satisfied(earlier, depth + 1)) return false;
    return true;
  }

  private refresh() {
    for (const def of this.defs) this.summaryOf.get(def.id)!.state = this.stateOf(def);
  }

  def(id: string): MissionDef | null {
    return this.byId.get(id) ?? null;
  }

  list(): MissionSummary[] {
    return this.summaries;
  }

  get active(): MissionSummary | null {
    return this.run ? (this.summaryOf.get(this.run.def.id) ?? null) : null;
  }

  start(id: string, resume: ResumePoint | null = null): boolean {
    const def = this.byId.get(id);
    if (!def || this.run || this.stateOf(def) !== 'available') return false;
    const { ctx } = this;
    this.retry = null;
    this.flushLingering(true);
    const run = (this.run = new MissionRun(ctx, def, this.shared));
    run.beginAt(resume);
    this.refresh();
    ctx.ui.banner(def.title, def.giver, TUNING.titleSeconds, 'neutral');
    ctx.events.emit('missionStarted', { id });
    try {
      def.onStart?.(run);
    } catch (err) {
      console.warn(`missions: onStart of "${id}" threw`, err);
    }
    this.onChange?.();
    return true;
  }

  abort(reason?: string) {
    const run = this.run;
    if (!run) return;
    run.end('aborted', reason ?? 'You walked away from it');
    this.finish(run);
  }

  update(dt: number) {
    const run = this.run;
    if (run) {
      try {
        run.update(dt);
      } catch (err) {
        // A broken step must not take the game loop down with it.
        console.error(`missions: "${run.def.id}" step ${run.stepIndex} threw`, err);
        run.fail('It all went sideways');
      }
      if (run.result !== 'running') this.finish(run);
    }
    this.updateLingering(dt);
  }

  private finish(run: MissionRun) {
    const { ctx } = this;
    const def = run.def;
    const result = run.result as MissionResult;
    const reason = run.reason;
    this.run = null;
    run.cleanup(false, this.lingering);
    if (result === 'passed') {
      this.done.add(def.id);
      if (def.finale) this.completed = true;
      this.refresh();
      ctx.ui.banner('Job done', `${def.title}  +$${def.reward}`, TUNING.passSeconds, 'good');
      ctx.player.addMoney(def.reward);
      ctx.audio.play('missionPass');
      ctx.events.emit('missionCompleted', { id: def.id, reward: def.reward });
    } else {
      this.shared.dialogue.clear();
      this.refresh();
      ctx.ui.banner(result === 'aborted' ? 'Job abandoned' : "Job's off", reason, TUNING.failSeconds, 'bad');
      ctx.audio.play('missionFail');
      if (result === 'failed') this.retry = { id: def.id, resume: run.reached };
      ctx.events.emit('missionFailed', { id: def.id, reason });
    }
    try {
      def.onEnd?.(run, result);
    } catch (err) {
      console.warn(`missions: onEnd of "${def.id}" threw`, err);
    }
    this.onResult?.(def, result, reason);
    this.onChange?.();
    if (result === 'passed') ctx.save.save();
  }

  /**
   * Should a leftover stay in the world a while longer? Bodies, wrecks and set dressing go once the player
   * is out of sight or after a while. A vehicle the player has driven is theirs until they walk well away.
   */
  private keeps(e: Entity): boolean {
    const { player } = this.ctx;
    const o = e.vehicle ?? e.ped;
    if (!o) return false;
    if (e.vehicle && e.vehicle === player.vehicle) return true;
    const d = Math.hypot(o.position.x - player.position.x, o.position.z - player.position.z);
    if (e.vehicle && e.driven && !e.vehicle.destroyed) return d < TUNING.lingerDrivenDistance;
    return e.age < TUNING.lingerSeconds && d < TUNING.lingerDistance;
  }

  private updateLingering(dt: number) {
    const list = this.lingering;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.age += dt;
      if (this.keeps(e)) continue;
      disposeEntity(this.ctx, e);
      list.splice(i, 1);
    }
  }

  /** Mission leftovers still in the world. */
  get lingeringCount(): number {
    return this.lingering.length;
  }

  /** Clear leftovers now. With `keepRide` the vehicle the player is using (or has just stepped out of) is spared. */
  private flushLingering(keepRide = false) {
    const list = this.lingering;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (keepRide && e.vehicle && (e.driven || e.vehicle === this.ctx.player.vehicle) && this.keeps(e)) continue;
      disposeEntity(this.ctx, e);
      list.splice(i, 1);
    }
  }

  serialize(): unknown {
    const data: SaveData = { v: 1, done: [...this.done], completed: this.completed };
    return data;
  }

  deserialize(data: unknown) {
    // Loading replaces the world state: whatever was running is dropped without ceremony.
    if (this.run) {
      const run = this.run;
      this.run = null;
      run.end('aborted', 'load');
      run.cleanup(true, this.lingering);
      this.shared.dialogue.clear();
    }
    this.flushLingering();
    this.retry = null;
    this.done.clear();
    this.completed = false;
    if (data && typeof data === 'object') {
      const d = data as Partial<SaveData>;
      if (Array.isArray(d.done)) for (const id of d.done) if (typeof id === 'string' && this.byId.has(id)) this.done.add(id);
      this.completed = d.completed === true;
    }
    this.refresh();
    this.onChange?.();
  }

  dispose() {
    if (this.run) {
      const run = this.run;
      this.run = null;
      run.end('aborted', 'dispose');
      run.cleanup(true, this.lingering);
    }
    this.flushLingering();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
