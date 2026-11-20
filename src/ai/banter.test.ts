import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import type { GameContext, GameEvents, Humanoid, Vehicle } from '../core/types';
import { QUIPS, QuipsSystem, QUIP_TUNING } from '../player/quips';
import { BARKS, CONVOS, DATED_CONVOS, convoLines, datedConvos } from './looks';
import { PedsSystem } from './peds';
import { crossroads } from './testgraph';
import { makeTestWorld } from './testworld';
import { TrafficSystem } from './traffic';
import { PEDS } from './tuning';
import { Rng } from '../core/rng';

vi.mock('../actors/humanoid', () => ({
  createHumanoid: (): Humanoid => {
    const h: Humanoid = {
      group: new THREE.Group(),
      setPose() {},
      update() {},
      setHeld() {},
      handPosition: (target) => target,
      dispose() {
        h.group.removeFromParent();
      },
    };
    return h;
  },
}));

const STEP = 1 / 30;

function setup() {
  const world = makeTestWorld(crossroads());
  const peds = new PedsSystem(world.ctx);
  const traffic = new TrafficSystem(world.ctx);
  (world.ctx as { peds: unknown }).peds = peds;
  (world.ctx as { traffic: unknown }).traffic = traffic;
  peds.init();
  traffic.init();
  peds.density = 0;
  traffic.density = 0;
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += STEP) {
      peds.update(STEP);
      traffic.update(STEP);
      world.tick(STEP);
    }
  };
  return { world, peds, traffic, run };
}

const allBarks = () => Object.values(BARKS).flat() as string[];
const allConvoLines = () => [...(Object.values(CONVOS).flat(2) as string[]), ...DATED_CONVOS.flatMap((c) => c.lines)];
const allQuips = () => Object.values(QUIPS).flat() as string[];

describe('the words', () => {
  it('keeps conversations and quips short enough for a subtitle', () => {
    for (const set of Object.values(CONVOS)) {
      expect(set.length).toBeGreaterThan(1);
      for (const convo of set) {
        expect(convo.length).toBeGreaterThanOrEqual(2);
        for (const line of convo) expect(line.length, line).toBeLessThanOrEqual(60);
      }
    }
    for (const lines of Object.values(QUIPS)) {
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(60);
    }
    for (const { lines } of DATED_CONVOS) {
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(60);
    }
  });

  it('keeps the news in step with the story: nothing about the Cup before it is won, or the Shield before it is lost', () => {
    const has = (stage: number, text: string) => datedConvos(stage).some((c) => c[0].startsWith(text));
    expect(datedConvos(0)).toHaveLength(0);
    expect(datedConvos(1)).toHaveLength(0);
    expect(has(2, 'Five-nil')).toBe(true);
    expect(has(2, 'Still reckon somebody poisoned')).toBe(false);
    expect(has(3, 'Still reckon somebody poisoned')).toBe(true);
    expect(has(4, 'Five-nil')).toBe(false);
    expect(has(4, 'Shield')).toBe(false);
    expect(has(5, 'Shield')).toBe(true);
    expect(has(6, 'Ruapehu')).toBe(true);
    // Before the story gets there, a conversation is never about it; after, it sometimes is.
    const rng = new Rng(9);
    const dated = new Set(DATED_CONVOS.map((c) => c.lines));
    for (let i = 0; i < 300; i++) expect(dated.has(convoLines(rng, 'clear', false, 0, 1))).toBe(false);
    let news = 0;
    for (let i = 0; i < 300; i++) if (dated.has(convoLines(rng, 'clear', false, 0, 5))) news++;
    expect(news).toBeGreaterThan(30);
    expect(news).toBeLessThan(150);
  });

  it('swears plenty, but never with the c-word or a slur, and keeps the macrons and curly apostrophes', () => {
    const everything = [...allBarks(), ...allConvoLines(), ...allQuips()];
    const text = everything.join(' ');
    for (const word of ['fuck', 'shit', 'bloody', 'bastard', 'prick', 'wanker', 'dickhead', 'bugger']) expect(text.toLowerCase()).toContain(word);
    for (const banned of [/\bcunt/i, /\bhori\b/i, /\bjap\b/i, /poof/i, /\bfag/i, /retard/i, /\bspaz/i, /\bgook/i, /\bcoconut/i, /\bboong/i, /\bnigg/i]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
    // 1995: none of the words that came later.
    for (const late of [/\bchur\b/i, /\bsus\b/i, /munted|munter/i, /yeah right/i]) expect(text, String(late)).not.toMatch(late);
    for (const wrong of ['Hoha', 'Porangi', 'Tutae', 'Aue!', 'Morena', 'Whanau', 'Pohara']) expect(text).not.toContain(wrong);
    for (const line of everything) expect(line, line).not.toContain("'");
  });

  it('colours conversations by the night and the weather', () => {
    const rng = new Rng(4);
    const has = (set: readonly (readonly string[])[], lines: readonly string[]) => set.includes(lines);
    const seen = { night: false, rain: false, norwester: false, general: false };
    for (let i = 0; i < 200; i++) {
      if (has(CONVOS.night, convoLines(rng, 'clear', true, 0))) seen.night = true;
      if (has(CONVOS.rain, convoLines(rng, 'clear', false, 0.8))) seen.rain = true;
      if (has(CONVOS.norwester, convoLines(rng, 'norwester', false, 0))) seen.norwester = true;
      const day = convoLines(rng, 'clear', false, 0);
      expect(has(CONVOS.night, day)).toBe(false);
      if (has(CONVOS.general, day)) seen.general = true;
    }
    expect(seen).toEqual({ night: true, rain: true, norwester: true, general: true });
  });
});

describe('passers-by react to the player', () => {
  const saved = { ...PEDS };
  afterEach(() => Object.assign(PEDS, saved));

  it('have a word about a crash, a horn and an explosion nearby', () => {
    const { world, peds, run } = setup();
    peds.spawn({ x: 4, z: 30, behaviour: 'wander', name: 'Shaz' });
    const car = world.ctx.vehicles.spawn('statesman', 0, 30, 0)!;
    world.ctx.vehicles.enter(world.player, car, 0);
    world.player.position.copy(car.position);
    world.events.emit('vehicleCrash', { vehicle: car, speed: 20, other: null });
    expect(world.subtitles.at(-1)).toEqual({ text: expect.any(String), speaker: 'Shaz' });
    expect(BARKS.crash as readonly string[]).toContain(world.subtitles.at(-1)!.text);

    // A gentle nudge is not worth a comment, and the next line waits for the gap.
    run(PEDS.barkGap + 0.5);
    const before = world.subtitles.length;
    world.events.emit('vehicleCrash', { vehicle: car, speed: 3, other: null });
    expect(world.subtitles.length).toBe(before);

    let honked = false;
    for (let i = 0; i < 12 && !honked; i++) {
      car.horn();
      honked = (BARKS.horn as readonly string[]).includes(world.subtitles.at(-1)?.text ?? '');
      run(PEDS.barkGap + 0.5);
    }
    expect(honked).toBe(true);

    const other = world.ctx.vehicles.spawn('statesman', 10, 34, 0)!;
    world.events.emit('vehicleDestroyed', { vehicle: other, source: world.player });
    expect(BARKS.boom as readonly string[]).toContain(world.subtitles.at(-1)!.text);
  });

  it('shout at the player for making them jump, and only the player', () => {
    const { world, peds } = setup();
    PEDS.dodgeChance = 1;
    const ped = peds.spawn({ x: 2, z: 40, behaviour: 'wander', name: 'Trev' }) as unknown as { dodge(v: Vehicle, side: number): void };
    const other = peds.spawn({ x: -2, z: 40, behaviour: 'wander', name: 'Kev' }) as unknown as { dodge(v: Vehicle, side: number): void };
    const theirs = world.ctx.vehicles.spawn('statesman', 0, 30, 0)!;
    theirs.driver = { kind: 'ped' } as never;
    other.dodge(theirs, 1);
    expect(world.subtitles).toHaveLength(0);
    world.ctx.clock.elapsed += 3;
    const mine = world.ctx.vehicles.spawn('statesman', 0, 30, 0)!;
    world.ctx.vehicles.enter(world.player, mine, 0);
    world.player.position.copy(mine.position);
    ped.dodge(mine, 1);
    expect(world.subtitles.at(-1)?.speaker).toBe('Trev');
    expect(BARKS.nearMiss as readonly string[]).toContain(world.subtitles.at(-1)!.text);
  });

  it('cry out at a gun pointed their way, then get out of it', () => {
    const { world, peds, run } = setup();
    const ped = peds.spawn({ x: 0, z: 8, behaviour: 'wander', name: 'Bev' });
    const behind = peds.spawn({ x: 0, z: -8, behaviour: 'wander', name: 'Col' });
    world.player.position.set(0, 0, 0);
    world.player.heading = 0;
    (world.player as unknown as { aiming: boolean }).aiming = true;
    run(8);
    const said = world.subtitles.filter((s) => s.speaker === 'Bev').map((s) => s.text);
    expect(said.some((t) => (BARKS.armed as readonly string[]).includes(t))).toBe(true);
    expect((ped as unknown as { calm: boolean }).calm).toBe(false);
    // Nobody behind the gun is bothered by it.
    expect(world.subtitles.some((s) => s.speaker === 'Col' && (BARKS.armed as readonly string[]).includes(s.text))).toBe(false);
    expect((behind as unknown as { calm: boolean }).calm).toBe(true);
  });

  it('stop for a yarn in pairs, a line each in turn', () => {
    PEDS.convoEvery = [0.5, 0.5];
    PEDS.convoChance = 1;
    const { world, peds, run } = setup();
    world.player.position.set(10, 0, 30);
    peds.spawn({ x: 3, z: 30, behaviour: 'wander', name: 'Hemi' });
    peds.spawn({ x: 4, z: 30.5, behaviour: 'wander', name: 'Raewyn' });
    run(14);
    const lines = new Set(allConvoLines());
    const talk = world.subtitles.filter((s) => lines.has(s.text));
    expect(talk.length).toBeGreaterThanOrEqual(2);
    expect(new Set(talk.map((s) => s.speaker))).toEqual(new Set(['Hemi', 'Raewyn']));
    // Alternating speakers, and the lines of one conversation in order.
    expect(talk[0].speaker).not.toBe(talk[1].speaker);
    const convo = [...Object.values(CONVOS).flat(), ...DATED_CONVOS.map((c) => c.lines)].find((c) => c[0] === talk[0].text)!;
    expect(convo).toBeDefined();
    expect(talk.slice(0, convo.length).map((s) => s.text)).toEqual([...convo]);
  });

  it('keep quiet while the story is talking', () => {
    PEDS.convoEvery = [0.5, 0.5];
    PEDS.convoChance = 1;
    const { world, peds, run } = setup();
    (world.ctx as { missions: unknown }).missions = { talking: true };
    world.player.position.set(10, 0, 30);
    peds.spawn({ x: 3, z: 30, behaviour: 'wander', name: 'Hemi' });
    peds.spawn({ x: 4, z: 30.5, behaviour: 'wander', name: 'Raewyn' });
    const car = world.ctx.vehicles.spawn('statesman', 6, 30, 0)!;
    world.ctx.vehicles.enter(world.player, car, 0);
    world.events.emit('vehicleCrash', { vehicle: car, speed: 20, other: null });
    run(10);
    expect(world.subtitles).toHaveLength(0);
  });

  it('a driver the player rams gives them a mouthful', () => {
    const { world, traffic, run } = setup();
    world.player.position.set(0, 0, 40);
    const theirs = traffic.spawnDriver('statesman', 2, 50)!;
    const mine = world.ctx.vehicles.spawn('statesman', 2, 45, 0)!;
    world.ctx.vehicles.enter(world.player, mine, 0);
    run(0.2);
    let said = false;
    for (let i = 0; i < 10 && !said; i++) {
      world.events.emit('vehicleCrash', { vehicle: theirs, speed: 20, other: mine });
      said = (BARKS.rammed as readonly string[]).includes(world.subtitles.at(-1)?.text ?? '');
      world.ctx.clock.elapsed += PEDS.barkGap + 0.1;
    }
    expect(said).toBe(true);
    expect(world.subtitles.at(-1)!.speaker).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe('Mack’s quips', () => {
  function harness() {
    const events = new EventBus<GameEvents>();
    const subtitles: { text: string; speaker?: string }[] = [];
    const player = {
      kind: 'player',
      position: new THREE.Vector3(),
      alive: true,
      controlsEnabled: true,
      vehicle: null as Vehicle | null,
    };
    const missions = { talking: false };
    const ctx = {
      events,
      clock: { elapsed: 0 },
      player,
      missions,
      ui: { subtitle: (text: string, _s?: number, speaker?: string) => subtitles.push({ text, speaker }) },
    } as unknown as GameContext;
    const quips = new QuipsSystem(ctx);
    quips.init();
    const tick = (seconds: number) => {
      for (let t = 0; t < seconds; t += STEP) {
        (ctx.clock as { elapsed: number }).elapsed += STEP;
        quips.update(STEP);
      }
    };
    const car = () =>
      ({
        position: new THREE.Vector3(),
        speed: 0,
        wheelsOnGround: 4,
        slip: 0,
        driver: player,
        tags: new Set<string>(),
      }) as unknown as Vehicle;
    return { events, subtitles, player, missions, tick, car };
  }

  it('comes round in hospital or out of the cells with something to say', () => {
    const h = harness();
    h.events.emit('playerDied', { info: { amount: 999, kind: 'bullet' } });
    h.events.emit('playerRespawned', { reason: 'died' });
    h.tick(1);
    expect(h.subtitles).toHaveLength(0);
    h.tick(1.5);
    expect(h.subtitles).toHaveLength(1);
    expect(h.subtitles[0].speaker).toBe('Mack');
    expect(QUIPS.died as readonly string[]).toContain(h.subtitles[0].text);
    h.events.emit('playerBusted', {});
    h.events.emit('playerRespawned', { reason: 'busted' });
    h.tick(2.5);
    expect(QUIPS.busted as readonly string[]).toContain(h.subtitles.at(-1)!.text);
  });

  it('greets the cops, the heavy mob and losing them, with a gap between lines', () => {
    const h = harness();
    h.events.emit('wantedChanged', { level: 1, previous: 0 });
    h.tick(1);
    expect(QUIPS.heat as readonly string[]).toContain(h.subtitles.at(-1)!.text);
    h.events.emit('wantedChanged', { level: 3, previous: 1 });
    h.tick(1);
    // Too soon after the last one.
    expect(h.subtitles).toHaveLength(1);
    h.tick(QUIP_TUNING.gap);
    // Waited too long for the gap: dropped rather than said out of date.
    expect(h.subtitles).toHaveLength(1);
    h.events.emit('wantedChanged', { level: 4, previous: 2 });
    h.tick(1);
    expect(QUIPS.heavy as readonly string[]).toContain(h.subtitles.at(-1)!.text);
    h.tick(QUIP_TUNING.gap);
    h.events.emit('wantedChanged', { level: 0, previous: 4 });
    h.tick(2);
    expect(QUIPS.lost as readonly string[]).toContain(h.subtitles.at(-1)!.text);
  });

  it('does not count losing the cops by being nicked', () => {
    const h = harness();
    h.tick(QUIP_TUNING.gap);
    h.events.emit('wantedChanged', { level: 0, previous: 2 });
    h.events.emit('playerBusted', {});
    h.tick(2);
    expect(h.subtitles).toHaveLength(0);
    // The police clear the level just after the arrest, too.
    h.events.emit('playerRespawned', { reason: 'load' });
    h.events.emit('playerBusted', {});
    h.events.emit('wantedChanged', { level: 0, previous: 3 });
    h.tick(4);
    expect(h.subtitles).toHaveLength(0);
  });

  it('holds his tongue while the story is talking', () => {
    const h = harness();
    h.missions.talking = true;
    h.events.emit('wantedChanged', { level: 1, previous: 0 });
    h.tick(2);
    expect(h.subtitles).toHaveLength(0);
    h.missions.talking = false;
    h.tick(0.5);
    expect(h.subtitles).toHaveLength(1);
  });

  it('whoops at air time and flat-stick driving, once each', () => {
    const h = harness();
    const v = h.car() as unknown as { speed: number; wheelsOnGround: number };
    h.player.vehicle = v as unknown as Vehicle;
    v.speed = 25;
    v.wheelsOnGround = 0;
    h.tick(1.2);
    const air = h.subtitles.filter((s) => (QUIPS.air as readonly string[]).includes(s.text));
    // (Three in four jumps get a line.)
    v.wheelsOnGround = 4;
    h.tick(QUIP_TUNING.gap + 1);
    v.speed = QUIP_TUNING.speedFast + 2;
    h.tick(QUIP_TUNING.speedSeconds + 0.5);
    expect(QUIPS.speed as readonly string[]).toContain(h.subtitles.at(-1)!.text);
    expect(air.length).toBeLessThanOrEqual(1);
  });
});
