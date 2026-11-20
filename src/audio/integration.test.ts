/**
 * Drives the whole audio system against a strict fake of the WebAudio API (fake-webaudio.ts): every call is
 * validated the way a browser would, and the node graph is tracked so leaks and runaway voice counts show up.
 * There is no way to listen in a unit test, but this proves the plumbing: nothing throws, nothing is scheduled
 * with bad values, every buffer is built at the context's sample rate, and finished notes are released.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import type { Action, AudioApi, GameContext, GameEvents, GroundSurface, SettingsData, SfxId, System, Vehicle } from '../core/types';
import { FakeAudioContext } from './fake-webaudio';
import { createAudio } from './index';
import { VOICE_COUNT } from './mixer';
import { STATIONS } from './radio/dial';
import { SOUNDS } from './sfx';

type Audio = AudioApi & System & { debug(): { voices: number; dropped: number; rpm: number; gear: number; station: string | null; running: boolean; errors: number } };

interface World {
  ctx: GameContext;
  audio: Audio;
  events: EventBus<GameEvents>;
  player: { position: { x: number; y: number; z: number }; vehicle: Vehicle | null; alive: boolean; controlsEnabled: boolean; kind: string; id: number };
  vehicles: Vehicle[];
  pressed: Set<Action>;
  env: { rain: number; wind: { x: number; z: number }; night: number; weather: string };
  clock: { hour: number; paused: boolean };
  surface: { kind: GroundSurface; depth: number; district: string };
  settings: { data: SettingsData; fire(key: keyof SettingsData): void };
  saved: { serialize: () => unknown; deserialize: (d: unknown) => void };
  radioEvents: { stationId: string | null; name: string }[];
  ac(): FakeAudioContext;
  /** Runs the game loop for `seconds` of simulated time. */
  run(seconds: number, each?: (t: number, dt: number) => void): void;
}

let nextVehicleId = 1;

function makeVehicle(cls: string, engineSound: string, x = 0, z = 0): Vehicle {
  return {
    id: nextVehicleId++,
    spec: { cls, engineSound, topSpeed: 50 },
    position: { x, y: 0.6, z },
    speed: 0,
    controls: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    wheelsOnGround: 4,
    slip: 0,
    siren: false,
    destroyed: false,
    burning: false,
    driver: null,
  } as unknown as Vehicle;
}

function makeWorld(): World {
  const events = new EventBus<GameEvents>();
  const pressed = new Set<Action>();
  const handlers = new Set<(key: keyof SettingsData) => void>();
  const data: SettingsData = { quality: 'medium', dynamicResolution: true, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, liveRadio: true, mouseSensitivity: 1, invertY: false, showFps: false };
  const player = { position: { x: 0, y: 0, z: 0 }, vehicle: null as Vehicle | null, alive: true, controlsEnabled: true, kind: 'player', id: 1 };
  const vehicles: Vehicle[] = [];
  const env = { rain: 0, wind: { x: 3, z: 2 }, night: 0, weather: 'clear' };
  const clock = { hour: 12, paused: false };
  const surface = { kind: 'road' as GroundSurface, depth: 0, district: 'cbd' };
  const saved = { serialize: (): unknown => null, deserialize: (_d: unknown): void => undefined };
  const radioEvents: { stationId: string | null; name: string }[] = [];
  events.on('radioChanged', (e) => radioEvents.push(e));
  const ctx = {
    events,
    settings: {
      data,
      set() {},
      onChange(h: (key: keyof SettingsData) => void) {
        handlers.add(h);
        return () => handlers.delete(h);
      },
    },
    save: {
      register(_key: string, serialize: () => unknown, deserialize: (d: unknown) => void) {
        saved.serialize = serialize;
        saved.deserialize = deserialize;
      },
    },
    clock,
    env,
    world: {
      seaLevel: 0,
      landmarks: [{ kind: 'tram-stop', x: 30, z: 30 }],
      surfaceAt: () => surface.kind,
      waterDepthAt: () => surface.depth,
      heightAt: () => -surface.depth,
      groundAt: () => 0,
      districtAt: () => ({ id: 'd', name: 'D', city: null, type: surface.district }),
    },
    player,
    vehicles: { all: vehicles },
    input: { pressed: (a: Action) => pressed.has(a) },
    ui: { menuOpen: false },
    combat: { weapons: new Map([['pistol', { kind: 'pistol' }], ['sawnoff', { kind: 'shotgun' }], ['bat', { kind: 'melee' }]]) },
    camera: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 6, 1] } },
  } as unknown as GameContext;
  const audio = createAudio(ctx) as Audio;
  void audio.init?.();
  const ac = (): FakeAudioContext => FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
  const run = (seconds: number, each?: (t: number, dt: number) => void): void => {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      each?.(t, dt);
      if (!clock.paused) audio.update?.(dt);
      audio.lateUpdate?.(dt);
      pressed.clear();
      if (FakeAudioContext.instances.length) ac().advance(dt);
    }
  };
  return { ctx, audio, events, player, vehicles, pressed, env, clock, surface, saved, radioEvents, ac, run, settings: { data, fire: (key) => handlers.forEach((h) => h(key)) } };
}

const vec = (x: number, y: number, z: number) => ({ x, y, z }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.options = {};
  const noop = (): void => undefined;
  vi.stubGlobal('window', { AudioContext: FakeAudioContext, addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('before unlock', () => {
  it('is silent and safe: nothing touches WebAudio', () => {
    const w = makeWorld();
    w.audio.play('pistol', { at: vec(1, 0, 1) });
    w.audio.play('uiSelect');
    w.events.emit('gunshot', { shooter: w.player as never, weaponId: 'pistol', position: vec(0, 1, 0), direction: vec(0, 0, 1) });
    w.events.emit('pausedChanged', { paused: true });
    w.run(0.5);
    expect(FakeAudioContext.instances.length).toBe(0);
    // The dial still works (and announces itself) with the sound off.
    w.audio.radio.next();
    expect(w.audio.radio.current).toBe(STATIONS[1].id);
    expect(w.radioEvents).toEqual([{ stationId: STATIONS[1].id, name: STATIONS[1].name }]);
    expect(w.audio.debug().errors).toBe(0);
  });
});

describe.each([48000, 44100])('unlocked at %i Hz', (rate) => {
  let w: World;
  beforeEach(() => {
    FakeAudioContext.options = { sampleRate: rate };
    w = makeWorld();
    w.audio.unlock();
  });

  it('builds every AudioBuffer at the context sample rate', () => {
    // Exercise everything that makes buffers: ambience, a vehicle, the radio, sirens, traffic, sound effects.
    const car = makeVehicle('sedan', 'v8');
    w.run(1);
    w.events.emit('vehicleEntered', { actor: w.player as never, vehicle: car, stolen: false, ejected: null });
    w.player.vehicle = car;
    w.vehicles.push(car, Object.assign(makeVehicle('police', 'six', 20, 5), { siren: true, speed: 20, driver: {} }));
    w.run(8, () => {
      car.speed = 20;
      car.controls.throttle = 0.8;
    });
    for (const id of Object.keys(SOUNDS)) w.audio.play(id as SfxId, { at: vec(3, 0, 3) });
    w.run(2);
    const ac = w.ac();
    expect(FakeAudioContext.instances.length).toBe(1);
    expect(ac.sampleRate).toBe(rate);
    expect(ac.bufferRates.length).toBeGreaterThan(40);
    expect(new Set(ac.bufferRates)).toEqual(new Set([rate]));
    expect(w.audio.debug().errors).toBe(0);
  });

  it('plays every sound in the contract, positioned or not, without complaint', () => {
    w.run(0.2);
    const ac = w.ac();
    const before = ac.byKind.bufferSource ?? 0;
    const ids = Object.keys(SOUNDS).filter((id) => !['slash', 'pain', 'deathCry', 'crunch', 'footGravel', 'footGrass', 'footSand', 'footWet', 'impactWorld', 'impactMetal', 'backfire', 'carPass', 'wantedUp', 'wantedClear', 'static', 'radioOff', 'gull', 'bellbird', 'chirp', 'morepork'].includes(id)) as SfxId[];
    expect(ids.length).toBe(32);
    let i = 0;
    w.run(8, (t) => {
      // One sound every 1/8 s, alternating positional and flat.
      const k = Math.floor(t * 8);
      if (k !== i && k < ids.length * 2) {
        i = k;
        const id = ids[k >> 1];
        if (k % 2) w.audio.play(id, { at: vec(5 + k, 0, -10), volume: 0.8, pitch: 1.1 });
        else w.audio.play(id);
      }
    });
    expect((ac.byKind.bufferSource ?? 0) - before).toBeGreaterThanOrEqual(ids.length * 2 - 4);
    expect(w.audio.debug().errors).toBe(0);
    // Out of earshot: culled before it costs anything.
    const made = ac.created;
    w.audio.play('doorClose', { at: vec(900, 0, 900) });
    expect(ac.created).toBe(made);
    // Silly arguments are survived.
    w.audio.play('pistol', { at: vec(1, 0, 1), volume: -3, pitch: 1 });
    w.audio.play('pistol', { at: vec(1, 0, 1), volume: 99, pitch: 1 });
    expect(w.audio.debug().errors).toBe(0);
  });

  it("a blade in the player's hand cuts when it lands; a fist, a bat and anyone else's blow add nothing", () => {
    const ac = w.ac();
    w.run(0.5);
    // (No health: nobody cries out, so the only new voice is the cut.)
    const ped = { kind: 'ped', id: 7, health: 0, position: { x: 4, y: 0, z: 4 } } as never;
    const combat = w.ctx.combat as unknown as { current: { id: string; kind: string; blade?: boolean } };
    const count = (): number => ac.byKind.bufferSource ?? 0;
    const hit = (source: unknown, kind: 'melee' | 'bullet' = 'melee'): number => {
      const before = count();
      w.events.emit('actorDamaged', { actor: ped, info: { amount: 26, kind, source: source as never, point: vec(4, 1.2, 3.8) } });
      w.run(0.2);
      return count() - before;
    };
    combat.current = { id: 'knife', kind: 'melee', blade: true };
    expect(hit(w.player)).toBe(1);
    combat.current = { id: 'katana', kind: 'melee', blade: true };
    expect(hit(w.player)).toBe(1);
    // Not a melee blow, not the player's, or not a blade: nothing more than the game already plays.
    expect(hit(w.player, 'bullet')).toBe(0);
    expect(hit({ kind: 'gang', id: 9 })).toBe(0);
    combat.current = { id: 'bat', kind: 'melee' };
    expect(hit(w.player)).toBe(0);
    combat.current = { id: 'fists', kind: 'fists' };
    expect(hit(w.player)).toBe(0);
    expect(w.audio.debug().errors).toBe(0);
  });

  it('never runs more than the voice cap, however many shots are fired', () => {
    let worst = 0;
    w.run(6, (t) => {
      const n = Math.floor(t * 60);
      // A firefight plus a pile-up: far more requests than voices.
      w.events.emit('gunshot', { shooter: w.player as never, weaponId: n % 2 ? 'pistol' : 'sawnoff', position: vec((n % 9) * 6 - 20, 1, (n % 7) * 5 - 15), direction: vec(0, 0, 1) });
      w.events.emit('impact', { position: vec((n % 11) * 4 - 20, 0, 10), normal: vec(0, 1, 0), surface: n % 3 === 0 ? 'world' : n % 3 === 1 ? 'vehicle' : 'flesh' });
      if (n % 20 === 0) w.audio.play('explosion', { at: vec(30, 0, 30) });
      worst = Math.max(worst, w.audio.debug().voices);
    });
    expect(worst).toBe(VOICE_COUNT);
    expect(w.audio.debug().dropped).toBeGreaterThan(0);
    expect(w.audio.debug().errors).toBe(0);
    // Stolen and finished voices are released: once it goes quiet only the odd bird or distant car is left.
    w.run(4);
    expect(w.audio.debug().voices).toBeLessThanOrEqual(3);
  });

  it('walking makes footsteps that follow the ground, and water makes a splash', () => {
    const ac = w.ac();
    w.run(0.5);
    const count = (): number => ac.byKind.bufferSource ?? 0;
    let before = count();
    w.run(4, (_t, dt) => (w.player.position.x += 3.9 * dt));
    const jog = count() - before;
    // ~2.8 footfalls a second at a jog (plus the odd bird).
    expect(jog).toBeGreaterThanOrEqual(9);
    expect(jog).toBeLessThanOrEqual(22);
    w.surface.kind = 'gravel';
    w.surface.district = 'rural';
    before = count();
    w.run(3, (_t, dt) => (w.player.position.x += 6.8 * dt));
    expect(count() - before).toBeGreaterThanOrEqual(8);
    // Standing still: no steps.
    w.run(1);
    before = count();
    w.run(2);
    expect(count() - before).toBeLessThanOrEqual(3);
    // Into the river.
    w.surface.depth = 1;
    w.player.position.y = -0.8;
    before = count();
    w.run(0.6, (_t, dt) => (w.player.position.x += 2 * dt));
    expect(count() - before).toBeGreaterThanOrEqual(1);
    expect(w.audio.debug().errors).toBe(0);
  });

  it('driving: engine, gears, radio on entry, dial cycling, clean shutdown on exit', () => {
    const ac = w.ac();
    w.run(1);
    const baseline = ac.liveNodes();
    const car = makeVehicle('sedan', 'six');
    w.vehicles.push(car);
    w.events.emit('vehicleEntered', { actor: w.player as never, vehicle: car, stolen: true, ejected: null });
    w.audio.play('doorClose', { at: vec(0, 0, 0) }); // the player module's own door sound: swallowed
    w.player.vehicle = car;
    let topGear = 0;
    let topRpm = 0;
    w.run(20, (t, dt) => {
      car.controls.throttle = t < 15 ? 1 : 0;
      car.speed = Math.min(48, car.speed + (t < 15 ? 4 : -6) * dt);
      car.slip = t > 8 && t < 9 ? 0.9 : 0;
      car.position.x += car.speed * dt;
      w.player.position.x = car.position.x;
      topGear = Math.max(topGear, w.audio.debug().gear);
      topRpm = Math.max(topRpm, w.audio.debug().rpm);
    });
    expect(topGear).toBe(4);
    expect(topRpm).toBeGreaterThan(4000);
    // Getting in announces the station that was left on.
    expect(w.audio.radio.current).toBe(STATIONS[0].id);
    expect(w.radioEvents).toEqual([{ stationId: STATIONS[0].id, name: STATIONS[0].name }]);
    w.radioEvents.length = 0;
    const driving = ac.liveNodes();
    expect(driving).toBeGreaterThan(baseline + 30);

    // R cycles the dial: every station, then off, then round again.
    const heard: (string | null)[] = [];
    for (let i = 0; i < STATIONS.length + 1; i++) {
      w.pressed.add('radioNext');
      w.run(4);
      heard.push(w.audio.radio.current);
    }
    expect(heard).toEqual([...STATIONS.slice(1).map((s) => s.id), null, STATIONS[0].id]);
    expect(w.radioEvents.map((e) => e.stationId)).toEqual(heard);
    expect(w.radioEvents.find((e) => e.stationId === null)?.name).toBe('Radio off');

    // Out of the car: engine and radio die away and their nodes are released.
    w.events.emit('vehicleExited', { actor: w.player as never, vehicle: car });
    w.player.vehicle = null;
    car.speed = 0;
    w.run(6);
    expect(ac.liveNodes()).toBeLessThanOrEqual(baseline + 6);
    // The station is remembered for the next vehicle…
    expect(w.audio.radio.current).toBe(STATIONS[0].id);
    // …but not on a motorbike.
    const bike = makeVehicle('bike', 'bike');
    w.events.emit('vehicleEntered', { actor: w.player as never, vehicle: bike, stolen: false, ejected: null });
    w.player.vehicle = bike;
    const oscBefore = ac.byKind.oscillator ?? 0;
    w.run(5, () => {
      bike.speed = 20;
      bike.controls.throttle = 0.7;
    });
    w.radioEvents.length = 0;
    w.pressed.add('radioNext');
    w.run(1);
    expect(w.audio.radio.current).toBe(STATIONS[0].id);
    expect(w.radioEvents).toEqual([]);
    expect((ac.byKind.oscillator ?? 0) - oscBefore).toBe(0);
    expect(w.audio.debug().errors).toBe(0);
  });

  it('sirens and passing traffic use a fixed, small pool of voices', () => {
    const ac = w.ac();
    w.run(1);
    for (let i = 0; i < 8; i++) w.vehicles.push(Object.assign(makeVehicle(i % 2 ? 'police' : 'sedan', 'six', 10 + i * 12, -5), { siren: i % 2 === 1, speed: 15, driver: {} }));
    const osc = ac.byKind.oscillator ?? 0;
    w.run(10, (t, dt) => {
      for (const v of w.vehicles) v.position.x -= 12 * dt;
      // Sirens switch on and off as the chase goes on.
      if (Math.floor(t) % 3 === 0) w.vehicles[1].siren = !w.vehicles[1].siren;
    });
    // Three siren voices and three traffic voices at most, however many cars there are.
    expect((ac.byKind.oscillator ?? 0) - osc).toBeLessThanOrEqual(6);
    w.vehicles.length = 0;
    w.run(6);
    expect(w.audio.debug().errors).toBe(0);
  });

  it('reacts to the game: crashes, horns, money, missions, wanted level, death, weather, pause, settings', () => {
    const ac = w.ac();
    const car = makeVehicle('truck', 'diesel', 5, 5);
    const ped = { kind: 'ped', id: 7, position: { x: 4, y: 0, z: 4 } } as never;
    w.run(0.5);
    const before = ac.byKind.bufferSource ?? 0;
    const fire: (() => void)[] = [
      () => w.events.emit('vehicleCrash', { vehicle: car, speed: 4, other: null }),
      () => w.events.emit('vehicleCrash', { vehicle: car, speed: 15, other: ped }),
      () => w.events.emit('horn', { vehicle: car }),
      () => w.events.emit('vehicleDestroyed', { vehicle: car }),
      () => w.events.emit('pickup', { kind: 'health', amount: 1 }),
      () => w.events.emit('moneyChanged', { money: 100, delta: 100 }),
      () => w.events.emit('missionCompleted', { id: 'm', reward: 500 }),
      () => w.events.emit('missionFailed', { id: 'm', reason: 'x' }),
      () => w.events.emit('wantedChanged', { level: 2, previous: 1 }),
      () => w.events.emit('wantedChanged', { level: 0, previous: 2 }),
      () => w.events.emit('actorDamaged', { actor: ped, info: { amount: 10, kind: 'vehicle' } }),
      () => w.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 9, under: true }),
      () => w.events.emit('actorDied', { actor: ped, info: { amount: 10, kind: 'bullet' } }),
      () => w.events.emit('weaponChanged', { weaponId: 'pistol' }),
      () => w.events.emit('vehicleEntered', { actor: ped, vehicle: car, stolen: false, ejected: null }),
      () => w.events.emit('vehicleExited', { actor: ped, vehicle: car }),
      () => w.events.emit('actorDied', { actor: w.player as never, info: { amount: 99, kind: 'bullet' } }),
      () => w.events.emit('playerRespawned', { reason: 'died' }),
    ];
    let k = -1;
    w.run(fire.length * 0.5, (t) => {
      const n = Math.floor(t * 2);
      if (n !== k) {
        k = n;
        fire[n]?.();
      }
    });
    expect((ac.byKind.bufferSource ?? 0) - before).toBeGreaterThanOrEqual(14);

    // A burst of identical crash events from one vehicle makes one crash.
    const crashesBefore = ac.byKind.bufferSource ?? 0;
    for (let i = 0; i < 10; i++) w.events.emit('vehicleCrash', { vehicle: car, speed: 5, other: null });
    expect((ac.byKind.bufferSource ?? 0) - crashesBefore).toBe(1);

    // A southerly comes through at night on the coast; then a nor'wester on the plains.
    w.env.rain = 0.85;
    w.env.wind = { x: 0, z: 11 };
    w.env.night = 1;
    w.env.weather = 'southerly';
    w.clock.hour = 23;
    w.surface.district = 'beach';
    w.run(6);
    w.env.rain = 0;
    w.env.wind = { x: 11, z: 11 };
    w.env.night = 0;
    w.env.weather = 'norwester';
    w.clock.hour = 6.5;
    w.surface.district = 'rural';
    w.run(20);

    // Pause: only lateUpdate runs; interface sounds still play.
    w.clock.paused = true;
    w.events.emit('pausedChanged', { paused: true });
    w.audio.play('uiMove');
    w.audio.play('uiSelect');
    w.run(1);
    w.clock.paused = false;
    w.events.emit('pausedChanged', { paused: false });

    // Volume sliders.
    w.settings.data.masterVolume = 0;
    w.settings.fire('masterVolume');
    w.settings.data.musicVolume = 1;
    w.settings.fire('musicVolume');
    w.run(1);
    expect(w.audio.debug().errors).toBe(0);
  });

  it('remembers the station in the save file', () => {
    w.audio.radio.set('lowtide');
    expect(w.saved.serialize()).toEqual({ station: 'lowtide' });
    w.radioEvents.length = 0;
    w.saved.deserialize({ station: 'drover' });
    expect(w.audio.radio.current).toBe('drover');
    w.saved.deserialize({ station: null });
    expect(w.audio.radio.current).toBeNull();
    // Loading is not the player turning the dial: no announcement. Rubbish in the file is ignored.
    expect(w.radioEvents).toEqual([]);
    w.saved.deserialize({ station: 'no-such-station' });
    w.saved.deserialize(undefined);
    w.saved.deserialize({ station: 42 });
    expect(w.audio.radio.current).toBeNull();
    w.audio.radio.set('nonsense');
    expect(w.audio.radio.current).toBeNull();
    expect(w.audio.debug().errors).toBe(0);
  });
});

describe('radio soak', () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
    w.audio.unlock();
  });

  it.each(STATIONS.map((s) => s.id))('station %s plays for minutes across tracks, idents and ads without leaking', (id) => {
    const ac = w.ac();
    const car = makeVehicle('ute', 'four');
    w.vehicles.push(car);
    w.audio.radio.set(id);
    w.events.emit('vehicleEntered', { actor: w.player as never, vehicle: car, stolen: false, ejected: null });
    w.player.vehicle = car;
    w.run(3);
    const settled = ac.liveNodes();
    let peak = 0;
    let peakSources = 0;
    const createdBefore = ac.created;
    w.run(300, (t) => {
      car.speed = 25;
      car.controls.throttle = 0.5;
      if (Math.floor(t * 60) % 30 === 0) {
        peak = Math.max(peak, ac.liveNodes());
        peakSources = Math.max(peakSources, ac.activeSources());
      }
    });
    // Music was made the whole time…
    expect(ac.created - createdBefore).toBeGreaterThan(1500);
    // …with a modest graph at any one moment…
    expect(peak).toBeLessThan(420);
    expect(peakSources).toBeLessThan(140);
    // …and nothing piles up: five minutes later the graph is no bigger than when it settled (bar a few tails).
    w.audio.radio.set(null);
    w.run(5);
    expect(ac.liveNodes()).toBeLessThan(settled);
    expect(w.audio.debug().errors).toBe(0);
  });
});

describe('when WebAudio lets us down', () => {
  it.each(['createConvolver', 'createDynamicsCompressor', 'createStereoPanner', 'createBuffer'])('unlock() survives a broken %s and the game carries on in silence', (method) => {
    FakeAudioContext.options = { breakOn: method };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = makeWorld();
    expect(() => w.audio.unlock()).not.toThrow();
    expect(() => w.audio.unlock()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(() => {
      w.audio.play('pistol', { at: vec(0, 0, 0) });
      w.audio.radio.next();
      w.events.emit('missionCompleted', { id: 'm', reward: 1 });
      w.run(1);
    }).not.toThrow();
    // It gave up cleanly: one context, closed, and no retry storm.
    expect(FakeAudioContext.instances.length).toBe(1);
    expect(FakeAudioContext.instances[0].state).toBe('closed');
    warn.mockRestore();
  });

  it('unlock() survives a browser with no WebAudio at all', () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const w = makeWorld();
    expect(() => w.audio.unlock()).not.toThrow();
    expect(() => w.run(0.5)).not.toThrow();
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  it('a fault in the middle of play switches sound off instead of breaking the frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = makeWorld();
    w.audio.unlock();
    w.run(0.5);
    // The world starts answering with garbage.
    (w.ctx.world as unknown as { surfaceAt: () => never }).surfaceAt = () => {
      throw new Error('boom');
    };
    expect(() => w.run(3)).not.toThrow();
    expect(w.audio.debug().errors).toBeGreaterThan(0);
    expect(() => w.audio.play('horn')).not.toThrow();
    warn.mockRestore();
  });
});
