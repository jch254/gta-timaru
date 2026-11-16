import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor, DamageInfo, WorldApi } from '../core/types';
import { compileMap } from '../world/map';
import { buildMap } from '../world/mapdata';
import { CAMEO_TUNING as T, Cameos, inHours, newVoice, nextLine, retreatPoint, wholeLook } from './cameos';
import { MISSIONS } from './defs';
import { CAMEOS, findCameo, type CameoDef } from './defs/cameos';
import { cameoCue, cameoRemark, withCameo } from './defs/cast';
import { lineSeconds } from './dialogue';
import { PLACE_IDS } from './ids';
import { maraeAt, newResolved, resolveSpot } from './spots';
import { FakePed, flush, makeFake } from './testkit';
import type { Line, SpotObject } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

// ───────────────────────────── The cast (data) ─────────────────────────────

describe('the cameo cast (data)', () => {
  it('is the eleven agreed characters, each with a unique id and invented name', () => {
    expect(CAMEOS.map((c) => c.name)).toEqual([
      'The Warlock of the Square',
      'Mayor Nicky Roe',
      'Jase Cannon',
      'Sione “Freight Train” Lotu',
      'Sir Roger Hadfield',
      'Skipper Pete Blackwell',
      'Jim Hickory',
      'Rochelle Huntley',
      'Prime Minister Jim Boulder',
      'Sir Ted Hillsborough',
      'Danny Loadman',
    ]);
    expect(new Set(CAMEOS.map((c) => c.id)).size).toBe(CAMEOS.length);
    for (const c of CAMEOS) {
      expect(c.id, c.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(findCameo(c.id)).toBe(c);
      expect(c.about.length, c.id).toBeGreaterThan(20);
    }
    expect(findCameo('nobody')).toBeNull();
  });

  it('gives everyone four to six short lines and a protest, none empty, none repeated', () => {
    const seen = new Set<string>();
    for (const c of CAMEOS) {
      expect(c.lines.length, c.id).toBeGreaterThanOrEqual(4);
      expect(c.lines.length, c.id).toBeLessThanOrEqual(6);
      for (const text of [...c.lines, c.oi, ...Object.values(c.weather ?? {})]) {
        expect(text.trim(), `${c.id}: "${text}"`).toBe(text);
        expect(text.length, `${c.id}: "${text}"`).toBeGreaterThan(8);
        expect(text.length, `${c.id}: "${text}"`).toBeLessThanOrEqual(150);
        expect(seen.has(text), `${c.id}: "${text}" twice`).toBe(false);
        seen.add(text);
      }
      // "Oi!"-style: short, and it starts that way.
      expect(c.oi, c.id).toMatch(/^(Oi|Hey)\b/);
      expect(c.oi.length, c.id).toBeLessThanOrEqual(60);
    }
  });

  it('writes te reo Māori with its macrons', () => {
    const text = CAMEOS.flatMap((c) => [c.name, c.about, c.oi, ...c.lines, ...Object.values(c.weather ?? {})]).join('\n');
    for (const bare of [/\bwhanau\b/i, /\bMaori\b/i, /\bNgai\b/i, /\bkorero\b/i, /\bhangi\b/i, /\bkumara\b/i, /\bkaumatua\b/i, /\bmorena\b/i]) expect(text).not.toMatch(bare);
  });

  it('keeps sensible hours and whole, fixed looks (the winger and the mountaineer tower over everyone)', () => {
    for (const c of CAMEOS) {
      if (c.hours) {
        expect(c.hours[0], c.id).toBeGreaterThanOrEqual(0);
        expect(c.hours[1], c.id).toBeLessThanOrEqual(24);
        expect(c.hours[0], c.id).not.toBe(c.hours[1]);
      }
      const look = wholeLook(c.look);
      for (const key of ['skin', 'hair', 'top', 'topStyle', 'legs', 'shorts', 'shoes', 'hat', 'hatColor', 'hairStyle', 'height', 'bulk', 'female'] as const) expect(look[key], `${c.id} ${key}`).toBeDefined();
      expect(look.height!, c.id).toBeGreaterThan(0.9);
      expect(look.height!, c.id).toBeLessThan(1.2);
      for (const extra of c.extras ?? []) expect(Math.hypot(extra.forward, extra.left), `${c.id} ${extra.name}`).toBeGreaterThan(2);
    }
    const winger = findCameo('sione-lotu')!;
    expect(winger.look.height).toBeGreaterThanOrEqual(1.1);
    expect(winger.look.bulk).toBeGreaterThanOrEqual(1.25);
    expect(winger.wears?.number).toBe('11');
    expect(findCameo('ted-hillsborough')!.look.height).toBeGreaterThanOrEqual(1.1);
    expect(findCameo('pete-blackwell')!.look.socks).toBe(0xc8201e);
    expect(findCameo('danny-loadman')!.wears?.towel).toBeDefined();
    expect(findCameo('rochelle-huntley')!.extras?.map((e) => e.name)).toEqual(['Camera operator', 'Director']);
    expect(findCameo('warlock')!.lift).toBeGreaterThan(1);
    // The weatherman has something to say about every kind of weather.
    expect(Object.keys(findCameo('jim-hickory')!.weather ?? {}).sort()).toEqual(['clear', 'fog', 'norwester', 'overcast', 'southerly']);
  });

  it('stands every one of them somewhere real: on the map, off the carriageway, off any marae, well apart', () => {
    const map = compileMap(buildMap());
    const world = {
      graph: map.graph,
      places: map.places,
      landmarks: map.landmarks,
      place(id: string) {
        const place = map.places.find((p) => p.id === id);
        if (!place) throw new Error(`Unknown place "${id}"`);
        return place;
      },
    } as unknown as WorldApi;
    const at = newResolved();
    const spots: { id: string; x: number; z: number }[] = [];
    for (const c of CAMEOS) {
      const spot = c.at as SpotObject;
      if (typeof c.at === 'string') expect(PLACE_IDS as readonly string[], c.id).toContain(c.at);
      else if (spot.place !== undefined) expect(PLACE_IDS as readonly string[], c.id).toContain(spot.place);
      else if (spot.landmark !== undefined) expect(map.landmarks.some((l) => l.kind === spot.landmark), `${c.id}: landmark "${spot.landmark}"`).toBe(true);
      resolveSpot(world, c.at, at);
      expect(at.ok, c.id).toBe(true);
      expect(Math.abs(at.x), c.id).toBeLessThan(3072);
      expect(Math.abs(at.z), c.id).toBeLessThan(6144);
      expect(Number.isFinite(at.heading), c.id).toBe(true);
      const road = map.graph.nearest(at.x, at.z, 60, (e) => e.drivable);
      if (road) expect(road.distance, `${c.id} is standing in ${road.edge.name}`).toBeGreaterThan(road.edge.width / 2 + 1);
      expect(maraeAt(world, at.x, at.z, 30), c.id).toBeNull();
      // Somewhere people go: within a short walk of a named place or a landmark.
      const near = (q: { x: number; z: number }) => Math.hypot(q.x - at.x, q.z - at.z) < 150;
      expect(map.places.some(near) || map.landmarks.some(near), c.id).toBe(true);
      spots.push({ id: c.id, x: at.x, z: at.z });
    }
    for (const a of spots) for (const b of spots) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} / ${b.id}`).toBeGreaterThan(20);
  });
});

// ───────────────────────────── Lines: order, weather, cooldown ─────────────────────────────

describe('what a cameo says next', () => {
  const def = { lines: ['one', 'two', 'three'], weather: { southerly: 'brr', fog: 'murk' } };

  it('goes through their lines in order, round and round', () => {
    const plain = { lines: ['one', 'two', 'three'] };
    const voice = newVoice();
    const said = Array.from({ length: 7 }, () => nextLine(plain, voice, 'clear'));
    expect(said).toEqual(['one', 'two', 'three', 'one', 'two', 'three', 'one']);
  });

  it('remarks on the weather first whenever it has changed, once, then carries on where it left off', () => {
    const voice = newVoice();
    expect(nextLine(def, voice, 'clear')).toBe('one');
    expect(nextLine(def, voice, 'southerly')).toBe('brr');
    expect(nextLine(def, voice, 'southerly')).toBe('two');
    expect(nextLine(def, voice, 'southerly')).toBe('three');
    expect(nextLine(def, voice, 'fog')).toBe('murk');
    expect(nextLine(def, voice, 'clear')).toBe('one');
    expect(nextLine(def, voice, 'fog')).toBe('murk');
    expect(nextLine({ lines: [] }, newVoice(), 'clear')).toBe('');
  });

  it('every real cameo cycles through every one of their lines', () => {
    for (const c of CAMEOS) {
      const voice = newVoice();
      const said = new Set<string>();
      for (let i = 0; i < c.lines.length + 1; i++) said.add(nextLine(c, voice, 'clear'));
      for (const text of c.lines) expect(said.has(text), `${c.id}: "${text}"`).toBe(true);
    }
  });

  it('knows its hours, including ones that run past midnight', () => {
    expect(inHours(3, undefined)).toBe(true);
    expect(inHours(9, [9, 17])).toBe(true);
    expect(inHours(16.9, [9, 17])).toBe(true);
    expect(inHours(17, [9, 17])).toBe(false);
    expect(inHours(8.9, [9, 17])).toBe(false);
    expect(inHours(23, [20, 4])).toBe(true);
    expect(inHours(2, [20, 4])).toBe(true);
    expect(inHours(12, [20, 4])).toBe(false);
  });
});

// ───────────────────────────── The system, on the toy map ─────────────────────────────

const LOOK = { skin: 0xe2b090, hair: 0x3a2a1c, top: 0x17171b, legs: 0x17171b, shoes: 0x121214 };
/** A cameo in open ground 200 m from any road of the toy map, and one on the Colombo Street footpath. */
const ORATOR: CameoDef = { id: 'orator', name: 'The Orator', about: 'Test cameo standing in open ground.', look: LOOK, at: { x: 300, z: -500, turn: 1 }, hours: [9, 17], lines: ['First.', 'Second.', 'Third.', 'Fourth.'], oi: 'Oi! Steady on!', gesture: 'orate' };
const FORECASTER: CameoDef = { id: 'forecaster', name: 'The Forecaster', about: 'Test cameo with a line for the weather.', look: LOOK, at: { place: 'arts-centre', snap: 'verge', out: 3 }, lines: ['Plain one.', 'Plain two.', 'Plain three.', 'Plain four.'], weather: { southerly: 'Southerly!' }, oi: 'Oi! Not me!' };

function harness(defs: readonly CameoDef[] = [ORATOR, FORECASTER]) {
  const fake = makeFake();
  let talking = false;
  const cameos = new Cameos(fake.ctx, defs, { talking: () => talking });
  cameos.init();
  const run = (seconds: number, dt = 0.1) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      fake.clock.elapsed += dt;
      cameos.update(dt);
    }
  };
  const record = (id: string) => cameos.records.find((r) => r.def.id === id)!;
  const pedOf = (id: string) => record(id).live?.ped as unknown as FakePed | undefined;
  const said = () => fake.ui.subtitles.map((s) => `${s.speaker}: ${s.text}`);
  return { fake, cameos, run, record, pedOf, said, setTalking: (v: boolean) => (talking = v) };
}

describe('cameos about town', () => {
  it('exist only near the player: spawned inside 110 m, gone beyond 150 m, and nothing at all when far away', () => {
    const h = harness([ORATOR]);
    const spawn = vi.spyOn(h.fake.peds, 'spawn');
    h.fake.moveTo(300, 3000);
    h.run(5);
    expect(h.cameos.count).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    h.fake.moveTo(300 + T.spawn + 15, -500);
    h.run(2);
    expect(h.cameos.count).toBe(0);
    h.fake.moveTo(300 + T.spawn - 5, -500);
    h.run(1);
    expect(h.cameos.count).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    const ped = h.pedOf('orator')!;
    expect([ped.position.x, ped.position.z]).toEqual([300, -500]);
    expect(ped.heading).toBeCloseTo(1);
    // Between the two radii they stay (no flicker at the edge)…
    h.fake.moveTo(300 + T.despawn - 10, -500);
    h.run(2);
    expect(h.cameos.count).toBe(1);
    // …and past the outer one they are taken away.
    h.fake.moveTo(300 + T.despawn + 10, -500);
    h.run(1);
    expect(h.cameos.count).toBe(0);
    expect(ped.removed).toBe(true);
    expect(h.fake.ui.subtitles).toHaveLength(0);
  });

  it('are scripted, standing, persistent and invulnerable, with nothing about their look left to chance', () => {
    const h = harness([ORATOR]);
    h.fake.moveTo(330, -500);
    h.run(1);
    const o = h.pedOf('orator')!.options;
    expect(o.invulnerable).toBe(true);
    expect(o.persistent).toBe(true);
    expect(o.kind).toBe('scripted');
    expect(o.behaviour).toBe('stand');
    expect(o.name).toBe('The Orator');
    expect(o.weaponId).toBeUndefined();
    expect(typeof o.onHit).toBe('function');
    expect(o.look).toEqual(wholeLook(LOOK));
    expect(o.look!.female).toBe(false);
    expect(o.look!.shorts).toBe(false);
  });

  it('keep their hours, and are not put out where the map is not loaded', () => {
    const h = harness([ORATOR]);
    h.fake.clock.hour = 22;
    h.fake.moveTo(320, -500);
    h.run(2);
    expect(h.cameos.count).toBe(0);
    h.fake.clock.hour = 10;
    h.fake.world.loaded = false;
    h.run(2);
    expect(h.cameos.count).toBe(0);
    h.fake.world.loaded = true;
    h.run(1);
    expect(h.cameos.count).toBe(1);
  });

  it('turn to the player on foot and say their next line, by name, then wait before the next one', () => {
    const h = harness([ORATOR]);
    h.fake.moveTo(300, -500 + T.talkRadius + 3);
    h.run(2);
    const ped = h.pedOf('orator')!;
    // Close enough to be noticed, not to be spoken to: they turn (the player is due south: heading 0).
    expect(h.said()).toEqual([]);
    expect(Math.abs(ped.heading)).toBeLessThan(0.05);
    h.fake.moveTo(300, -500 + T.talkRadius - 1);
    h.run(0.3);
    expect(h.said()).toEqual(['The Orator: First.']);
    // Standing there does not get a stream of chatter: nothing more until the line is over and a pause has passed.
    const wait = lineSeconds({ text: 'First.' }) + T.gap;
    h.run(wait - 0.6);
    expect(h.said()).toHaveLength(1);
    h.run(0.6);
    expect(h.said()).toEqual(['The Orator: First.', 'The Orator: Second.']);
    // Walking away and back does not skip the wait, and the lines carry on in order and come round again.
    h.fake.moveTo(300, -470);
    h.run(1);
    h.fake.moveTo(300, -498);
    h.run(1);
    expect(h.said()).toHaveLength(2);
    h.run(3 * (wait + 1));
    expect(h.said().slice(2)).toEqual(['The Orator: Third.', 'The Orator: Fourth.', 'The Orator: First.']);
    // The player leaves: they face the street again.
    h.fake.moveTo(300, -440);
    h.run(3);
    expect(ped.heading).toBeCloseTo(1, 1);
  });

  it('remember where they had got to after the player has been away', () => {
    const h = harness([ORATOR]);
    h.fake.moveTo(300, -498);
    h.run(1);
    expect(h.said()).toEqual(['The Orator: First.']);
    h.fake.moveTo(300, 3000);
    h.run(30);
    expect(h.cameos.count).toBe(0);
    h.fake.moveTo(300, -498);
    h.run(2.5);
    expect(h.said()).toEqual(['The Orator: First.', 'The Orator: Second.']);
  });

  it('stay silent while a mission conversation is on screen, from a car, and with a menu open', () => {
    const h = harness([ORATOR]);
    h.setTalking(true);
    h.fake.moveTo(300, -498);
    h.run(8);
    expect(h.said()).toEqual([]);
    h.setTalking(false);
    h.fake.ui.menuOpen = true;
    h.run(3);
    expect(h.said()).toEqual([]);
    h.fake.ui.menuOpen = false;
    const car = h.fake.vehicles.spawn('hatch', 300, -498, 0)!;
    h.fake.drive(car);
    h.run(3);
    expect(h.said()).toEqual([]);
    h.fake.getOut();
    h.run(0.3);
    expect(h.said()).toEqual(['The Orator: First.']);
  });

  it('two standing together take turns rather than talking over each other', () => {
    const twin: CameoDef = { ...ORATOR, id: 'twin', name: 'The Twin', at: { x: 303, z: -500 }, lines: ['Me too.', 'And again.', 'Still here.', 'Yes.'] };
    const h = harness([ORATOR, twin]);
    h.fake.moveTo(301.5, -498);
    h.run(0.6);
    expect(h.said()).toEqual(['The Orator: First.']);
    h.run(lineSeconds({ text: 'First.' }) + T.crossTalk + 0.2);
    expect(h.said()).toEqual(['The Orator: First.', 'The Twin: Me too.']);
  });

  it('the weather gets a remark from anyone who has one', () => {
    const h = harness([FORECASTER]);
    const r = h.record('forecaster');
    h.fake.env.weather = 'southerly';
    h.fake.moveTo(r.x + 1, r.z + 1);
    h.run(1);
    expect(h.said()).toEqual(['The Forecaster: Southerly!']);
    h.run(lineSeconds({ text: 'Southerly!' }) + T.gap + 0.3);
    expect(h.said()[1]).toBe('The Forecaster: Plain one.');
  });

  it('hit or shot at, they are not hurt: they say "oi" once and get out of the way, off the road, then drift back', async () => {
    const h = harness([ORATOR]);
    h.fake.moveTo(300, -498);
    h.run(1);
    const ped = h.pedOf('orator')!;
    const goTo = vi.spyOn(ped, 'goTo');
    const blow: DamageInfo = { amount: 40, kind: 'bullet', source: h.fake.player as unknown as Actor };
    ped.options.onHit!(blow);
    ped.options.onHit!(blow);
    ped.options.onHit!({ amount: 10, kind: 'melee', source: h.fake.player as unknown as Actor });
    expect(ped.health).toBe(100);
    expect(ped.alive).toBe(true);
    expect(ped.removed).toBe(false);
    expect(h.said().filter((s) => s === 'The Orator: Oi! Steady on!')).toHaveLength(1);
    expect(h.record('orator').live!.state).toBe('away');
    // Straight away from the player (who is due south), at a run.
    expect(goTo).toHaveBeenCalled();
    const [x, z, running] = goTo.mock.calls[0] as unknown as [number, number, boolean];
    expect(x).toBeCloseTo(300, 0);
    expect(z).toBeCloseTo(-500 - T.retreat, 0);
    expect(running).toBe(true);
    // Not another word while they are put out, however close the player stands.
    const before = h.said().length;
    h.run(T.calm - 1);
    expect(h.said()).toHaveLength(before);
    // Then home again, at a walk.
    h.run(2);
    await flush();
    expect(goTo.mock.calls.at(-1)).toEqual([300, -500, false]);
    expect(h.record('orator').live!.state).toBe('home');
  });

  it('shooting nearby sends them off without a word; shooting a long way off does not', () => {
    const h = harness([ORATOR]);
    h.fake.moveTo(320, -500);
    h.run(1);
    const ped = h.pedOf('orator')!;
    const goTo = vi.spyOn(ped, 'goTo');
    const shot = (x: number, z: number) => h.fake.events.emit('gunshot', { shooter: h.fake.player as unknown as Actor, weaponId: 'pistol', position: new THREE.Vector3(x, 0, z), direction: new THREE.Vector3(0, 0, 1) });
    shot(300 + T.scareRadius + 20, -500);
    expect(goTo).not.toHaveBeenCalled();
    shot(310, -500);
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(h.record('orator').live!.state).toBe('away');
    expect(h.said()).toEqual([]);
    // A whole magazine is one fright, not thirty errands.
    for (let i = 0; i < 12; i++) shot(310, -500);
    expect(goTo).toHaveBeenCalledTimes(1);
  });

  it('keep clear of trouble: nobody is put out with a mission’s hostiles standing by their spot', () => {
    const h = harness([ORATOR]);
    const thug = new FakePed({ x: 300 + T.trouble - 10, z: -500, kind: 'gang' });
    (h.fake.ctx.actors.all as Set<Actor>).add(thug as unknown as Actor);
    h.fake.moveTo(330, -500);
    h.run(3);
    expect(h.cameos.count).toBe(0);
    thug.kill();
    h.run(1);
    expect(h.cameos.count).toBe(1);
  });

  it('never step into or across a road, into water, or far from their spot when moving off', () => {
    const { ctx } = makeFake();
    const world = ctx.world;
    const out = { x: 0, z: 0 };
    // Open ground: straight away from the trouble.
    expect(retreatPoint(world, 300, -500, 300, -490, 300, -500, 14, 45, out)).toEqual({ x: 300, z: -514 });
    // Beside Colombo Street (x = 500, 8 m wide), threatened from the far side: away is fine…
    const away = retreatPoint(world, 508, -500, 495, -500, 508, -500, 14, 45, out)!;
    expect(away.x).toBeGreaterThan(508);
    // …but threatened from behind, the road is in the way: they go along it or stay put, never across.
    const blocked = retreatPoint(world, 508, -500, 530, -500, 508, -500, 14, 45, { x: 0, z: 0 });
    if (blocked) {
      const road = world.graph.nearest(blocked.x, blocked.z, 60)!;
      expect(road.distance).toBeGreaterThan(road.edge.width / 2 + 1.2);
      expect(blocked.x).toBeGreaterThan(500);
    }
    // At the end of the leash there is nowhere further to go.
    expect(retreatPoint(world, 300, -545, 300, -500, 300, -500, 14, 45, { x: 0, z: 0 })?.z ?? -545).toBeGreaterThanOrEqual(-545.01);
    // Water all round: stay where they are.
    (world as unknown as { water: () => number }).water = () => 2;
    expect(retreatPoint(world, 300, -500, 300, -490, 300, -500, 14, 45, { x: 0, z: 0 })).toBeNull();
  });

  it('take their extras with them, and everyone is cleared away on dispose', () => {
    const star: CameoDef = { ...ORATOR, id: 'star', extras: [{ name: 'Camera operator', look: LOOK, forward: 5, left: 1, camera: true }, { name: 'Director', look: LOOK, forward: 6, left: -2 }] };
    const h = harness([star]);
    h.fake.moveTo(330, -500);
    h.run(1);
    expect(h.fake.peds.all.map((p) => p.name)).toEqual(['The Orator', 'Camera operator', 'Director']);
    for (const ped of h.fake.peds.all) expect(ped.options.invulnerable).toBe(true);
    h.cameos.dispose();
    expect(h.cameos.count).toBe(0);
    expect(h.fake.peds.all.every((p) => p.removed)).toBe(true);
  });

  it('a spot that is not on this map is skipped with one warning, and a build with no pedestrians is survived', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lost: CameoDef = { ...ORATOR, id: 'lost', at: { landmark: 'no-such-landmark-anywhere' } };
    const h = harness([lost]);
    expect(h.record('lost').ok).toBe(false);
    h.fake.moveTo(0, 0);
    expect(() => h.run(2)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const stub = makeFake({ peds: false });
    const cameos = new Cameos(stub.ctx, [ORATOR], { talking: () => false });
    cameos.init();
    stub.moveTo(320, -500);
    expect(() => {
      for (let i = 0; i < 30; i++) cameos.update(0.1);
    }).not.toThrow();
    expect(cameos.count).toBe(0);
  });
});

// ───────────────────────────── Cameos in the story ─────────────────────────────

describe('cameos in the story', () => {
  /** Every line a mission can say, including the cameo remarks that only play when the cameo is standing by. */
  const linesOf = (id: string): Line[] => {
    const def = MISSIONS.find((m) => m.id === id)!;
    const out: Line[] = [];
    for (const step of def.steps) {
      if (step.lines) out.push(...step.lines);
      for (const cue of step.cues ?? []) if (cue.lines) out.push(...cue.lines);
      const remark = (step as { remark?: readonly Line[] }).remark;
      if (remark) out.push(...remark);
    }
    return out;
  };

  it('three of them have a small, benign speaking part, under their cast names', () => {
    const parts: [mission: string, cameo: string, speaker: string][] = [
      ['mint-sauce', 'jim-boulder', 'Prime Minister Jim Boulder'],
      ['four-avenues', 'nicky-roe', 'Mayor Nicky Roe, on the radio'],
      ['southerly-change', 'jim-hickory', 'Jim Hickory, on the radio'],
    ];
    for (const [mission, cameo, speaker] of parts) {
      expect(findCameo(cameo), cameo).not.toBeNull();
      const lines = linesOf(mission).filter((l) => l.who === speaker);
      expect(lines.length, `${mission}: ${speaker}`).toBeGreaterThanOrEqual(1);
      for (const l of lines) {
        expect(l.text.length, l.text).toBeLessThanOrEqual(150);
        expect(l.text.trim(), l.text).toBe(l.text);
      }
    }
    // Nobody from the cameo cast is ever a mission's giver, target or armed character.
    const names = new Set(CAMEOS.map((c) => c.name));
    for (const def of MISSIONS) {
      expect(names.has(def.giver), def.id).toBe(false);
      for (const step of def.steps) if (step.kind === 'spawnPeds') for (const ped of step.peds) expect(names.has(ped.name ?? ''), `${def.id}: ${ped.as}`).toBe(false);
    }
  });

  it('their lines drop out of the story when a cameo is taken out of the cast', () => {
    expect(withCameo('nobody', (who) => [{ who, text: 'Hello.' }])).toEqual([]);
    expect(cameoCue('nobody', 5, (who) => [{ who, text: 'Hello.' }])).toEqual([]);
    expect(cameoCue('jim-hickory', 5, (who) => [{ who, text: 'Hello.' }])).toEqual([{ at: 5, lines: [{ who: 'Jim Hickory', text: 'Hello.' }] }]);
    const gone = cameoRemark('nobody', (who) => [{ who, text: 'Hello.' }]);
    expect(gone.remark).toEqual([]);
    const say = vi.fn();
    gone.enter!({ ctx: makeFake().ctx, say } as never);
    expect(say).not.toHaveBeenCalled();
  });

  it('a passing remark is only made when that cameo really is standing nearby', () => {
    const fake = makeFake();
    const step = cameoRemark('jim-boulder', (who) => [{ who, text: 'Gidday.' }]);
    const say = vi.fn();
    const run = { ctx: fake.ctx, say } as never;
    step.enter!(run);
    expect(say).not.toHaveBeenCalled();
    // Somebody else of that name who can be hurt is not him; nor is he "nearby" from down the road.
    const actors = fake.ctx.actors.all as Set<Actor>;
    const impostor = { name: 'Prime Minister Jim Boulder', alive: true, position: new THREE.Vector3(5, 0, 5) } as unknown as Actor;
    const far = { name: 'Prime Minister Jim Boulder', alive: true, invulnerable: true, position: new THREE.Vector3(500, 0, 5) } as unknown as Actor;
    actors.add(impostor);
    actors.add(far);
    step.enter!(run);
    expect(say).not.toHaveBeenCalled();
    actors.add({ name: 'Prime Minister Jim Boulder', alive: true, invulnerable: true, position: new THREE.Vector3(12, 0, 5) } as unknown as Actor);
    step.enter!(run);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0]).toEqual([{ who: 'Prime Minister Jim Boulder', text: 'Gidday.' }]);
    // It is a one-shot: it never holds the mission up.
    expect(step.tick).toBeUndefined();
  });
});
