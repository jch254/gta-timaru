import * as THREE from 'three';
import { createPeds, createTraffic } from '../ai';
import { preloadCharacters } from '../actors/gltf';
import { createAudio } from '../audio';
import { createCombat } from '../combat';
import { EventBus } from '../core/events';
import { Input } from '../core/input';
import { Save } from '../core/save';
import { Settings } from '../core/settings';
import type { Actor, ActorsApi, GameClock, GameContext, GameEvents, System } from '../core/types';
import { createMissions } from '../missions';
import { Physics } from '../physics/physics';
import { Player } from '../player/player';
import { createPolice } from '../police';
import { Gfx } from '../render/renderer';
import { createUi } from '../ui';
import { Vehicles } from '../vehicles';
import { Detail } from '../vehicles/models/kit';
import { createFigureLod } from '../actors/lod';
import { createTram } from '../rail/tram';
import { createTouch } from '../touch';
import { plantField } from '../world/props/foliage';
import { World } from '../world/world';

const STEP = 1 / 60;

class Actors implements ActorsApi {
  all = new Set<Actor>();
  private id = 1;
  nextId() {
    return this.id++;
  }
  near(x: number, z: number, radius: number, filter?: (a: Actor) => boolean): Actor[] {
    const out: Actor[] = [];
    for (const a of this.all) {
      if (Math.hypot(a.position.x - x, a.position.z - z) <= radius && (!filter || filter(a))) out.push(a);
    }
    return out;
  }
}

export interface StartOptions {
  canvas: HTMLCanvasElement;
  /** Continue from the save file instead of starting fresh. */
  load: boolean;
  onProgress(stage: string, fraction: number): void;
}

/** Builds every system, wires the shared context and runs the loop. */
export class Game {
  ctx!: GameContext;
  private systems: System[] = [];
  private gfx!: Gfx;
  private physics!: Physics;
  private world!: World;
  private input!: Input;
  private accumulator = 0;
  private last = 0;
  private running = false;

  static async start(options: StartOptions): Promise<Game> {
    const game = new Game();
    await game.init(options);
    return game;
  }

  private async init({ canvas, load, onProgress }: StartOptions) {
    onProgress('Starting physics', 0);
    const physics = (this.physics = await Physics.create());
    const settings = new Settings();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.35, 26000);
    const events = new EventBus<GameEvents>();
    const clock: GameClock = {
      hour: 9.5,
      day: 1,
      elapsed: 0,
      secondsPerHour: 60,
      paused: false,
      advanceHours(hours: number) {
        this.hour += hours;
        while (this.hour >= 24) {
          this.hour -= 24;
          this.day++;
        }
      },
    };
    const gfx = (this.gfx = new Gfx(canvas, scene, camera, settings, clock));
    const input = (this.input = new Input(canvas, settings));
    const save = new Save();

    onProgress('Unpacking the scenery', 0.02);
    await Promise.all([gfx.loadTextures(), preloadCharacters(import.meta.env.BASE_URL)]);

    onProgress('Surveying Canterbury', 0.05);
    const world = (this.world = new World(scene, gfx, physics, () => gfx.preset.chunkRadius));

    // The context is filled in stages; systems only touch each other after init().
    const ctx = (this.ctx = {
      scene,
      camera,
      events,
      input,
      settings,
      clock,
      env: gfx.atmosphere,
      gfx,
      physics,
      world,
      actors: new Actors(),
      save,
    } as unknown as GameContext);
    ctx.ui = createUi(ctx);
    ctx.audio = createAudio(ctx);
    ctx.vehicles = new Vehicles(ctx);
    ctx.combat = createCombat(ctx);
    ctx.player = new Player(ctx);
    ctx.peds = createPeds(ctx);
    ctx.traffic = createTraffic(ctx);
    ctx.police = createPolice(ctx);
    ctx.missions = createMissions(ctx);
    world.attach(ctx);
    // What the quality level (and, on a phone, its own tier) asks of everything outside the renderer: how
    // far out the full versions of plants and vehicles are drawn, and how big the ambient crowd is.
    let crowd = 1;
    const tune = () => {
      const preset = gfx.preset;
      plantField.range = preset.detailRange;
      Detail.reach = preset.detailRange;
      // Scaled rather than set: a mission that has thinned the streets keeps its own setting.
      ctx.peds.density *= preset.crowd / crowd;
      ctx.traffic.density *= preset.crowd / crowd;
      crowd = preset.crowd;
    };
    tune();
    settings.onChange((key) => {
      if (key === 'quality') tune();
    });
    // Update order: input consumers → AI → vehicles → world → UI last.
    this.systems = [ctx.player, ctx.combat, ctx.peds, ctx.traffic, createTram(ctx), ctx.police, ctx.missions, ctx.vehicles, world, createFigureLod(ctx), ctx.audio, ctx.ui] as unknown as System[];
    // The on-screen controller for phones: one more input source, drawn over the HUD.
    this.systems.push(createTouch(ctx, input.touch, canvas));

    gfx.atmosphere.onWeather = (weather) => events.emit('weatherChanged', { weather });
    save.register(
      'clock',
      () => ({ hour: clock.hour, day: clock.day }),
      (d) => Object.assign(clock, d as object),
    );
    events.on('qualityChanged', () => undefined);

    await world.buildFar((f) => onProgress('Raising the Alps', 0.1 + f * 0.35));
    for (const s of this.systems) await s.init?.();

    const spawn = world.placesTagged('spawn')[0] ?? { x: 0, z: 0, heading: 0 };
    await world.loadAround(spawn.x, spawn.z, (f) => onProgress('Building the streets', 0.45 + f * 0.5));
    ctx.player.teleport(spawn.x, spawn.z, spawn.heading);
    if (load && save.load()) {
      const p = ctx.player.position;
      await world.loadAround(p.x, p.z, (f) => onProgress('Finding where you left off', 0.95 + f * 0.05));
      ctx.player.teleport(p.x, p.z, ctx.player.heading);
      events.emit('playerRespawned', { reason: 'load' });
    } else {
      events.emit('playerRespawned', { reason: 'new' });
    }
    onProgress('Ready', 1);

    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  setPaused(paused: boolean) {
    if (this.ctx.clock.paused === paused) return;
    this.ctx.clock.paused = paused;
    this.ctx.events.emit('pausedChanged', { paused });
  }

  /** Extra per-slice callbacks (development tools). */
  hooks = new Set<(dt: number) => void>();

  /** Smoothed milliseconds per frame spent in each system and in rendering (for the perf readout / dev tools). */
  profile: Record<string, number> = {};

  private time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    const result = fn();
    const ms = performance.now() - t0;
    this.frameCost[name] = (this.frameCost[name] ?? 0) + ms;
    return result;
  }
  private frameCost: Record<string, number> = {};

  private frame(now: number) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    // Up to a second of catching up per frame: a throttled background tab still plays in real time.
    const real = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(0.1, real);
    const { ctx } = this;
    this.frameCost = {};
    this.input.poll();

    if (!ctx.clock.paused) {
      // Simulate in slices of at most 1/30 s so the world keeps real time even when frames are slow
      // (a busy machine, a background tab), up to a quarter of a second per frame.
      let remaining = real;
      let first = true;
      while (remaining > 1e-5) {
        const h = Math.min(remaining, 1 / 30);
        remaining -= h;
        this.accumulator += h;
        while (this.accumulator >= STEP) {
          for (const s of this.systems) if (s.fixedUpdate) this.time(s.name, () => s.fixedUpdate!(STEP));
          this.time('physics', () => this.physics.step());
          this.accumulator -= STEP;
        }
        for (const s of this.systems) if (s.update) this.time(s.name, () => s.update!(h));
        for (const hook of this.hooks) hook(h);
        const p = ctx.player.position;
        this.world.setFocus(p.x, p.z);

        ctx.clock.elapsed += h;
        const before = Math.floor(ctx.clock.hour);
        ctx.clock.advanceHours(h / ctx.clock.secondsPerHour);
        if (Math.floor(ctx.clock.hour) !== before) ctx.events.emit('hourChanged', { hour: Math.floor(ctx.clock.hour) });
        // Key presses and mouse movement belong to the first slice only.
        if (first && remaining > 1e-5) this.input.suspend();
        first = false;
      }
    }
    this.input.resume();
    // UI and camera keep running while paused so menus stay live.
    for (const s of this.systems) if (s.lateUpdate) this.time(s.name, () => s.lateUpdate!(dt));
    this.time('render', () => this.gfx.render(real));
    this.input.endFrame();
    for (const [name, ms] of Object.entries(this.frameCost)) this.profile[name] = (this.profile[name] ?? ms) * 0.95 + ms * 0.05;
  }
}
