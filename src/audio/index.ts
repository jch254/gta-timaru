/**
 * Audio system. Everything is synthesised at runtime with WebAudio: there are no audio files.
 *
 *  - mixer.ts          buses, master limiter, reverb, the 24-voice one-shot pool, buffer cache
 *  - sfx-render.ts     every sound effect as offline DSP (cached as AudioBuffers on first use)
 *  - vehicle-audio.ts  the player's engine, tyres, road and wind
 *  - nearby.ts         sirens and passing traffic
 *  - ambience.ts       place / hour / weather beds and wildlife
 *  - radio/            six generative stations on a shared look-ahead scheduler
 *
 * Nothing makes a sound (or touches WebAudio) until `unlock()` is called from a user gesture.
 */
import { Rng } from '../core/rng';
import type { Actor, AudioApi, GameContext, GameEvents, GroundSurface, SfxId, System, Vehicle } from '../core/types';
import { Ambience, renderRain } from './ambience';
import { Mixer, renderNoiseBed } from './mixer';
import { PassBy, Sirens } from './nearby';
import { DRUM_IDS, renderDrum } from './radio/drums';
import { LiveStream } from './radio/live';
import { Radio } from './radio/radio';
import { SOUNDS, renderSound, warmList } from './sfx';
import { renderCrickets, type SoundId } from './sfx-render';
import { spatialize, type Spatial } from './spatial';
import { ENGINE_KINDS, VehicleAudio, renderEngine, renderGravel } from './vehicle-audio';

/** Which footstep to use on each kind of ground. */
export function footSound(surface: GroundSurface): SoundId {
  switch (surface) {
    case 'gravel':
    case 'shingle':
      return 'footGravel';
    case 'grass':
    case 'field':
      return 'footGrass';
    case 'sand':
      return 'footSand';
    case 'water':
      return 'footWet';
    default:
      return 'footstep';
  }
}

/** Sound for a weapon, from its id or (failing that) its kind. Melee weapons make no report. */
export function gunSound(weaponId: string, kind?: string): SoundId | null {
  for (const key of [weaponId, kind]) {
    if (key === 'pistol' || key === 'shotgun' || key === 'smg' || key === 'rifle') return key;
  }
  return null;
}

/** Metres of ground covered per footfall at a given speed: a stroll is ~2 steps a second, a sprint ~3.5. */
export const strideLength = (speed: number): number => 0.6 + 0.2 * speed;

/**
 * Playback pitch for someone's cries: women higher, men lower, and a fixed tilt of their own (from the id) so the
 * same person sounds the same each time. `scream` keeps the spread narrower, as that sound is rendered high already.
 */
export function voicePitch(id: number, female: boolean, scream = false): number {
  const own = 0.93 + ((id * 37) % 15) / 100;
  return own * (female ? (scream ? 1.15 : 1.4) : scream ? 0.85 : 0.9);
}

const isVehicle = (o: Vehicle | Actor): o is Vehicle => 'spec' in o;

class AudioSystem implements AudioApi, System {
  readonly name = 'audio';
  readonly radio: AudioApi['radio'];

  private mixer = new Mixer();
  private live = new LiveStream();
  private tuner: Radio;
  private engine: VehicleAudio;
  private sirens: Sirens;
  private passers: PassBy;
  private ambience: Ambience;
  private rng = new Rng(0x50a11d);
  private sp: Spatial = { gain: 0, pan: 0, cutoff: 22000, delay: 0, distance: 0 };
  private lastTime = new Map<SoundId, number>();
  private lastX = new Map<SoundId, number>();
  private lastZ = new Map<SoundId, number>();
  private lastVariant = new Map<SoundId, number>();
  private perVehicle = new WeakMap<Vehicle, number>();
  private offs: (() => void)[] = [];
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private disposed = false;
  private errors = 0;
  /** Set after repeated failures: audio switches itself off rather than disturb the game. */
  private dead = false;
  /** The player module also plays door sounds on enter / exit: ignore those while ours are sequenced. */
  private doorMuteUntil = 0;
  /** Seconds before the engine catches after getting in (0 = already running). */
  private startDelay = 0;
  private surface: GroundSurface = 'road';
  private depth = 0;
  private waterTop = -Infinity;
  private probe = 0;
  private wasWet = false;
  private stride = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private air = 0;
  private falling = false;

  constructor(private ctx: GameContext) {
    this.tuner = new Radio(this.mixer, (id, name) => ctx.events.emit('radioChanged', { stationId: id, name }), this.live);
    // Absent from old settings files: live radio is on unless it has been switched off.
    this.tuner.setLive(ctx.settings.data.liveRadio !== false);
    this.engine = new VehicleAudio(this.mixer, (v, delay) => this.emit('backfire', v.position.x, v.position.y, v.position.z, 1, 1, delay));
    this.sirens = new Sirens(this.mixer);
    this.passers = new PassBy(this.mixer);
    this.ambience = new Ambience(this.mixer, ctx, (id, x, y, z, volume) => this.emit(id, x, y, z, volume));
    const tuner = this.tuner;
    const guard = this.guard;
    this.radio = {
      stations: tuner.stations,
      get current() {
        return tuner.station;
      },
      set current(id: string | null) {
        guard(() => tuner.set(id));
      },
      next: () => guard(() => tuner.next()),
      set: (id) => guard(() => tuner.set(id)),
    };
    ctx.save.register(
      'audio',
      () => ({ station: tuner.station }),
      (data) => {
        const station = (data as { station?: unknown } | null)?.station;
        if (station === null || typeof station === 'string') tuner.set(station, false);
      },
    );
    this.offs.push(
      ctx.settings.onChange((key) => {
        if (key === 'masterVolume' || key === 'musicVolume' || key === 'sfxVolume') this.volumes();
        if (key === 'liveRadio') guard(() => tuner.setLive(ctx.settings.data.liveRadio !== false));
      }),
    );
    this.queueLibrary();
    this.pump();
  }

  /**
   * Audio must never take the game down: every entry point (API calls, event handlers, the frame update, timers)
   * runs through here. Errors are logged a few times; if they keep coming the system switches itself off.
   */
  private guard = (fn: () => void): void => {
    if (this.dead) return;
    try {
      fn();
    } catch (err) {
      this.fail(err);
    }
  };

  private fail(err: unknown): void {
    this.errors++;
    if (this.errors <= 3) console.warn('audio: error (carrying on)', err);
    if (this.errors < 8 || this.dead) return;
    this.dead = true;
    console.warn('audio: too many errors, switching sound off');
    try {
      this.tuner.dispose();
      this.mixer.dispose();
    } catch {
      // Nothing more to be done.
    }
  }

  /**
   * Everything that can be synthesised ahead of time goes on the render queue: the beds the continuous layers
   * need straight away first, then the sound effects (most important first), engines and drum kits.
   */
  private queueLibrary(): void {
    const bank = this.mixer.bank;
    for (const color of ['white', 'pink', 'brown'] as const) bank.queue(`noise:${color}`, () => renderNoiseBed(color));
    bank.queue('loop:crickets', renderCrickets);
    bank.queue('loop:rain', renderRain);
    bank.queue('loop:gravel', renderGravel);
    for (const [id, v] of warmList()) bank.queue(`sfx:${id}:${v}`, () => renderSound(id, v));
    for (const kind of ENGINE_KINDS) for (const band of [0, 1] as const) bank.queue(`engine:${kind}:${band}`, () => renderEngine(kind, band));
    for (const id of DRUM_IDS) bank.queue(`drum:${id}`, () => renderDrum(id));
  }

  /** Works through the render queue in short slices: generous while the world loads, frugal once playing. */
  private pump = (): void => {
    this.pumpTimer = null;
    if (this.disposed || this.dead) return;
    let done = false;
    this.guard(() => {
      done = this.mixer.bank.work(this.playing ? 2 : 6);
    });
    if (!done && !this.dead) this.pumpTimer = setTimeout(this.pump, this.playing ? 30 : 3);
  };

  init(): void {
    const on = <K extends keyof GameEvents>(type: K, handler: (payload: GameEvents[K]) => void): void => {
      this.offs.push(this.ctx.events.on(type, (payload) => this.guard(() => handler(payload))));
    };
    const { ctx } = this;

    on('pausedChanged', ({ paused }) => this.mixer.setPaused(paused));

    on('gunshot', ({ shooter, weaponId, position }) => {
      const id = gunSound(weaponId, ctx.combat.weapons.get(weaponId)?.kind);
      if (id) this.emit(id, position.x, position.y, position.z, 1, 1, 0, shooter.kind === 'player' ? 2 : 0);
    });

    on('impact', ({ position, surface }) => {
      const id: SoundId = surface === 'flesh' ? 'bodyHit' : surface === 'vehicle' ? 'impactMetal' : this.rng.chance(0.3) ? 'ricochet' : 'impactWorld';
      this.emit(id, position.x, position.y, position.z);
    });

    on('vehicleCrash', ({ vehicle, speed, other }) => {
      if (!this.gate(vehicle, 0.15)) return;
      const p = vehicle.position;
      if (speed < 7) this.emit('crashSmall', p.x, p.y, p.z, Math.min(1, 0.35 + speed / 9));
      else {
        this.emit('crashBig', p.x, p.y, p.z, Math.min(1, 0.6 + (speed - 7) / 12));
        if (speed > 11 && this.rng.chance(0.5)) this.emit('glass', p.x, p.y, p.z, 0.9, 1, 0.05);
      }
      if (other && !isVehicle(other)) this.emit('bodyHit', other.position.x, other.position.y, other.position.z);
    });

    on('vehicleDestroyed', ({ vehicle }) => {
      const p = vehicle.position;
      this.emit('explosion', p.x, p.y, p.z);
      this.emit('glass', p.x, p.y, p.z, 0.8, 1, 0.12);
    });

    on('horn', ({ vehicle }) => {
      if (!this.gate(vehicle, 0.3)) return;
      const p = vehicle.position;
      const cls = vehicle.spec.cls;
      // Every car's horn is tuned a little differently.
      const tune = 0.92 + (vehicle.id % 7) * 0.03;
      if (cls === 'truck' || cls === 'bus') this.emit('hornTruck', p.x, p.y, p.z, 1, tune);
      else this.emit('horn', p.x, p.y, p.z, cls === 'bike' ? 0.8 : 1, cls === 'bike' ? 1.45 : tune);
    });

    on('vehicleEntered', ({ actor, vehicle, ejected }) => {
      const p = vehicle.position;
      const bike = vehicle.spec.cls === 'bike';
      if (actor.kind !== 'player') {
        if (!bike) this.emit('doorClose', p.x, p.y, p.z, 0.6, 1, 0.3);
        return;
      }
      const running = ejected !== null || Math.abs(vehicle.speed) > 2;
      this.doorMuteUntil = this.mixer.now + 0.15;
      let t = 0;
      if (!bike) {
        this.emit('doorOpen', p.x, p.y, p.z);
        this.emit('doorClose', p.x, p.y, p.z, 1, 1, 0.32);
        t = 0.4;
      }
      if (!running && vehicle.spec.engineSound !== 'electric') {
        // Starter motor, then the engine catches as the cranking stops (0.55 s into the sound).
        const pitch = bike ? 1.5 : vehicle.spec.engineSound === 'diesel' ? 0.8 : 1;
        this.emit('engineStart', p.x, p.y, p.z, 1, pitch, t);
        this.startDelay = t + 0.55 / pitch;
      } else {
        this.startDelay = 0;
      }
    });

    on('vehicleExited', ({ actor, vehicle }) => {
      if (vehicle.spec.cls === 'bike') {
        if (actor.kind === 'player') this.doorMuteUntil = this.mixer.now + 0.15;
        return;
      }
      const p = vehicle.position;
      if (actor.kind !== 'player') {
        this.emit('doorOpen', p.x, p.y, p.z, 0.6);
        return;
      }
      this.doorMuteUntil = this.mixer.now + 0.15;
      this.emit('doorOpen', p.x, p.y, p.z);
      this.emit('doorClose', p.x, p.y, p.z, 1, 1, 0.42);
    });

    on('pickup', ({ kind }) => this.flat(kind === 'cash' ? 'cash' : 'pickup'));
    on('moneyChanged', ({ delta }) => {
      if (delta !== 0) this.flat('cash', Math.min(1, 0.6 + Math.abs(delta) / 600), delta > 0 ? 1 : 0.8);
    });
    on('weaponChanged', () => this.flat('empty', 0.6, 0.8));

    on('missionCompleted', () => {
      this.flat('missionPass');
      this.mixer.duckMusic(0.35, 2.2);
    });
    on('missionFailed', () => {
      this.flat('missionFail');
      this.mixer.duckMusic(0.35, 1.8);
    });
    on('wantedChanged', ({ level, previous }) => {
      if (level > previous) this.flat('wantedUp', 1, 1 + 0.04 * level);
      else if (level === 0 && previous > 0) this.flat('wantedClear');
    });

    on('actorDamaged', ({ actor, info }) => {
      const p = actor.position;
      if (info.kind === 'vehicle' || info.kind === 'fall') this.emit('bodyHit', p.x, p.y, p.z);
      // A cry from whoever it did not kill (the dying get theirs below).
      if (actor.kind !== 'player' && actor.health > 0 && info.kind !== 'drown' && this.rng.chance(0.75)) this.emit('pain', p.x, p.y + 1.6, p.z, 1, this.voice(actor));
    });
    on('actorDied', ({ actor, info }) => {
      if (actor.kind === 'player') {
        // The world goes dull and far away.
        this.mixer.setMuffled(true);
      } else if (info.kind !== 'drown' && this.rng.chance(0.85)) {
        // Run down: a scream. Shot, beaten or blown up: mostly a last groan.
        const p = actor.position;
        if (info.kind === 'vehicle' || info.kind === 'fire') this.emit('scream', p.x, p.y + 1.2, p.z, 1, this.voice(actor, true));
        else this.emit('deathCry', p.x, p.y + 1.2, p.z, 1, this.voice(actor));
      }
    });
    on('vehicleHitActor', ({ actor, speed, under }) => {
      if (!under) return;
      const p = actor.position;
      this.emit('crunch', p.x, p.y + 0.2, p.z, Math.min(1.2, 0.6 + speed / 15));
    });
    on('playerRespawned', () => {
      this.mixer.setMuffled(false);
      this.wasWet = false;
      this.stride = 0;
    });
  }

  // ───────────── AudioApi ─────────────

  /**
   * Called from the Start button's click, and again from every touch on a touch screen (src/touch), because iOS
   * only starts sound inside a gesture. Never throws: if WebAudio will not start, the game is simply silent.
   */
  unlock(): void {
    this.guard(() => {
      const { data } = this.ctx.settings;
      if (this.mixer.unlock(data.masterVolume, data.musicVolume, data.sfxVolume)) this.mixer.setPaused(this.ctx.clock.paused);
      if (data.liveRadio !== false) this.live.prime();
    });
  }

  play(id: SfxId, options?: { at?: { x: number; y: number; z: number }; volume?: number; pitch?: number }): void {
    if (this.dead || !this.mixer.ac) return;
    try {
      this.playNow(id, options);
    } catch (err) {
      this.fail(err);
    }
  }

  private playNow(id: SfxId, options?: { at?: { x: number; y: number; z: number }; volume?: number; pitch?: number }): void {
    if ((id === 'doorOpen' || id === 'doorClose') && this.mixer.now < this.doorMuteUntil) return;
    const at = options?.at;
    const volume = options?.volume ?? 1;
    const pitch = options?.pitch ?? 1;
    if (!at) {
      this.flat(id, volume, pitch);
      return;
    }
    const sound: SoundId = id === 'footstep' ? footSound(this.ctx.world.surfaceAt(at.x, at.z)) : id;
    this.emit(sound, at.x, at.y, at.z, volume, pitch);
  }

  // ───────────── playback ─────────────

  private volumes(): void {
    const { data } = this.ctx.settings;
    this.mixer.setVolumes(data.masterVolume, data.musicVolume, data.sfxVolume);
  }

  /** One gate per vehicle so a burst of identical events makes one sound. */
  private gate(vehicle: Vehicle, seconds: number): boolean {
    const now = this.mixer.now;
    const last = this.perVehicle.get(vehicle);
    if (last !== undefined && now - last < seconds) return false;
    this.perVehicle.set(vehicle, now);
    return true;
  }

  /** Drops a repeat of the same sound at the same place within its `gap` (two systems reporting one event). */
  private tooSoon(id: SoundId, gap: number, x: number, z: number): boolean {
    const now = this.mixer.now;
    const last = this.lastTime.get(id);
    if (last !== undefined && now - last < gap && Math.hypot(x - (this.lastX.get(id) ?? 0), z - (this.lastZ.get(id) ?? 0)) < 8) return true;
    this.lastTime.set(id, now);
    this.lastX.set(id, x);
    this.lastZ.set(id, z);
    return false;
  }

  private buffer(id: SoundId): AudioBuffer {
    const n = SOUNDS[id].variants;
    let v = 0;
    if (n > 1) {
      v = this.rng.int(0, n - 1);
      if (v === this.lastVariant.get(id)) v = (v + 1) % n;
      this.lastVariant.set(id, v);
    }
    return this.mixer.buffer(`sfx:${id}:${v}`, () => renderSound(id, v));
  }

  /** Playback pitch for this person's cries. */
  private voice(actor: Actor, scream = false): number {
    return voicePitch(actor.id, !!actor.female, scream);
  }

  /** Positional one-shot. */
  private emit(id: SoundId, x: number, y: number, z: number, volume = 1, pitch = 1, delay = 0, boost = 0): void {
    if (!this.mixer.ac) return;
    const def = SOUNDS[id];
    if (def.ui) {
      this.flat(id, volume, pitch, delay);
      return;
    }
    const sp = spatialize(this.mixer.listener, x, y, z, def.ref, def.max, this.sp);
    if (sp.gain <= 0 || this.tooSoon(id, def.gap, x, z)) return;
    const v = volume < 0 ? 0 : volume > 1.25 ? 1.25 : volume;
    this.mixer.playVoice(this.buffer(id), {
      id,
      gain: Math.min(0.5, def.gain * v) * sp.gain,
      rate: pitch * (1 + (this.rng.next() - 0.5) * 2 * def.jitter),
      pan: sp.pan,
      cutoff: sp.cutoff,
      // Far-off sounds are mostly reflection.
      reverb: def.reverb * (0.6 + 0.4 * Math.min(1, sp.distance / 40)),
      delay: delay + sp.delay,
      priority: def.priority + boost,
      limit: def.limit,
    });
  }

  /** Non-positional one-shot: interface sounds on the UI bus, anything else centred in the world. */
  private flat(id: SoundId, volume = 1, pitch = 1, delay = 0): void {
    if (!this.mixer.ac) return;
    const def = SOUNDS[id];
    const l = this.mixer.listener;
    if (this.tooSoon(id, def.gap, l.x, l.z)) return;
    const v = volume < 0 ? 0 : volume > 1.25 ? 1.25 : volume;
    const gain = Math.min(0.5, def.gain * v);
    const rate = pitch * (1 + (this.rng.next() - 0.5) * 2 * def.jitter);
    if (def.ui) this.mixer.playTo(this.mixer.ui, this.buffer(id), gain, rate, delay);
    else this.mixer.playVoice(this.buffer(id), { id, gain, rate, pan: 0, cutoff: 22000, reverb: def.reverb * 0.5, delay, priority: def.priority + 1, limit: def.limit });
  }

  // ───────────── frame ─────────────

  update(dt: number): void {
    this.playing = true;
    if (this.dead || !this.mixer.ac) return;
    try {
      this.frame(dt);
    } catch (err) {
      this.fail(err);
    }
  }

  private frame(dt: number): void {
    const { ctx } = this;
    const player = ctx.player;
    const vehicle = player.vehicle;
    const p = player.position;

    // Ground and water under the player, a few times a second (the lookups walk the road graph).
    this.probe -= dt;
    if (this.probe <= 0) {
      this.probe = 0.16;
      this.surface = ctx.world.surfaceAt(p.x, p.z);
      this.depth = ctx.world.waterDepthAt(p.x, p.z);
      this.waterTop = this.depth > 0 ? ctx.world.heightAt(p.x, p.z) + this.depth : -Infinity;
    }

    // Engine follows whatever the player is driving.
    if (vehicle !== this.engine.active) {
      if (vehicle) this.engine.attach(vehicle, this.startDelay);
      else this.engine.detach();
    }
    this.engine.update(dt, this.surface);

    // Radio: cars, utes, trucks and vans have one. Bikes do not.
    const hasRadio = vehicle !== null && vehicle.spec.cls !== 'bike' && !vehicle.destroyed;
    if (hasRadio !== this.tuner.audible) this.tuner.setAudible(hasRadio, this.startDelay + 0.45);
    else if (hasRadio) this.tuner.refresh();
    if (hasRadio && player.controlsEnabled && !ctx.ui.menuOpen) {
      if (ctx.input.pressed('radioNext')) this.tuner.next();
      else if (ctx.input.pressed('radioPrev')) this.tuner.prev();
    }
    if (vehicle) this.startDelay = 0;

    this.sirens.update(dt, ctx.vehicles.all);
    this.passers.update(dt, ctx.vehicles.all, vehicle);
    this.ambience.update(dt);
    this.foley(dt);
  }

  /** Footsteps, landings and splashes for the player. */
  private foley(dt: number): void {
    const player = this.ctx.player;
    const p = player.position;
    const dx = p.x - this.prevX;
    const dy = p.y - this.prevY;
    const dz = p.z - this.prevZ;
    this.prevX = p.x;
    this.prevY = p.y;
    this.prevZ = p.z;
    const moved = Math.hypot(dx, dz);
    if (dt <= 0 || moved > 4) return; // teleported
    const speed = moved / dt;

    const wet = this.depth > 0.35 && p.y < this.waterTop + 0.25;
    if (wet && !this.wasWet) this.emit('splash', p.x, p.y, p.z, player.vehicle ? 1 : Math.min(1, 0.45 + speed / 10), player.vehicle ? 0.85 : 1.15);
    this.wasWet = wet;

    if (player.vehicle || !player.alive) {
      this.stride = 0;
      this.air = 0;
      this.falling = false;
      return;
    }
    // No access to the controller's grounded flag: infer jumps and falls from vertical speed. The hold-off
    // outlasts the slow moment at the top of a jump, so there are no footsteps in mid-air.
    const vy = dy / dt;
    if (Math.abs(vy) > 2.2) {
      this.air = 0.25;
      this.falling = vy < 0;
      return;
    }
    if (this.air > 0) {
      this.air -= dt;
      if (this.falling && Math.abs(vy) < 0.8) {
        // Landed.
        this.air = 0;
        this.falling = false;
        this.stride = 0;
        this.step(p.x, p.y, p.z, 1.2, 0.85);
      }
      return;
    }
    if (speed < 0.6) {
      this.stride = Math.min(this.stride, strideLength(speed) * 0.5);
      return;
    }
    this.stride += moved;
    const length = strideLength(speed);
    if (this.stride >= length) {
      this.stride -= length;
      this.step(p.x, p.y, p.z, 0.55 + 0.45 * Math.min(1, speed / 6.8), 1);
    }
  }

  private step(x: number, y: number, z: number, volume: number, pitch: number): void {
    const id = this.depth > 0.08 && y < this.waterTop + 0.1 ? 'footWet' : footSound(this.surface);
    this.emit(id, x, y, z, volume, pitch, 0, 1);
  }

  lateUpdate(): void {
    if (this.dead || !this.mixer.ac) return;
    try {
      this.late();
    } catch (err) {
      this.fail(err);
    }
  }

  private late(): void {
    const mixer = this.mixer;
    // The listener hears from the player's head but faces the way the camera does.
    const e = this.ctx.camera.matrixWorld.elements;
    const l = mixer.listener;
    const len = Math.hypot(e[0], e[2]) || 1;
    l.rx = e[0] / len;
    l.rz = e[2] / len;
    const p = this.ctx.player.position;
    if (Math.hypot(p.x - e[12], p.y - e[13], p.z - e[14]) < 30) {
      l.x = p.x;
      l.y = p.y + 1.5;
      l.z = p.z;
    } else {
      l.x = e[12];
      l.y = e[13];
      l.z = e[14];
    }
    this.engine.housekeep();
    this.tuner.update();
  }

  /** Mixer state for a debug overlay. */
  debug(): { voices: number; dropped: number; rpm: number; gear: number; station: string | null; live: string; running: boolean; errors: number } {
    return {
      voices: this.mixer.activeVoices(),
      dropped: this.mixer.dropped,
      rpm: this.engine.gearbox.rpm,
      gear: this.engine.gearbox.gear + 1,
      station: this.tuner.station,
      live: this.tuner.liveState,
      running: this.mixer.running,
      errors: this.errors,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.guard(() => {
      this.tuner.dispose();
      this.sirens.release();
      this.passers.release();
      this.mixer.dispose();
    });
  }
}

export function createAudio(ctx: GameContext): AudioApi & System {
  return new AudioSystem(ctx);
}
