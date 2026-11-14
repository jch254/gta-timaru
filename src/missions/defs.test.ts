import { afterEach, describe, expect, it, vi } from 'vitest';
import { MISSIONS } from './defs';
import { Dialogue } from './dialogue';
import { LANDMARK_KINDS, PICKUP_KINDS, PLACE_IDS, VEHICLE_IDS, WEAPON_IDS } from './ids';
import { MarkerPool } from './markers';
import { collectRefs } from './refs';
import { MissionRunner, type MissionRun } from './runner';
import { WORLD_PICKUPS } from './services';
import { maraeAt, newResolved, type Resolved } from './spots';
import { STEP_HANDLERS } from './steps';
import { FakePed, flush, makeFake, type Fake, type FakeOptions, type FakeVehicle } from './testkit';
import { TUNING } from './tuning';
import type { Line, MissionDef, Step } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every subtitle line in a mission, wherever it hangs. */
function linesOf(def: MissionDef): Line[] {
  const out: Line[] = [];
  for (const step of def.steps) {
    if (step.lines) out.push(...step.lines);
    if (step.cues) for (const cue of step.cues) if (cue.lines) out.push(...cue.lines);
  }
  return out;
}

describe('the six missions (data)', () => {
  it('are six, in story order, each unlocked by the one before, starting at the chip shop', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(['severance-pay', 'on-ice', 'mint-sauce', 'four-avenues', 'punt-return', 'southerly-change']);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(6);
    expect(MISSIONS[0].requires ?? []).toEqual([]);
    expect(MISSIONS[0].placeId).toBe('timaru-chipshop');
    for (let i = 1; i < MISSIONS.length; i++) expect(MISSIONS[i].requires).toEqual([MISSIONS[i - 1].id]);
    expect(MISSIONS.filter((m) => m.finale).map((m) => m.id)).toEqual(['southerly-change']);
  });

  it('pay more as they go, from about $200 to about $5,000', () => {
    const rewards = MISSIONS.map((m) => m.reward);
    expect(rewards[0]).toBe(200);
    expect(rewards.at(-1)).toBe(5000);
    for (let i = 1; i < rewards.length; i++) expect(rewards[i]).toBeGreaterThan(rewards[i - 1]);
  });

  it('move from Timaru up SH1 to Christchurch and over the hill to Lyttelton', () => {
    const places = MISSIONS.map((m) => [...collectRefs(m).places]);
    expect(places[0]).toEqual(expect.arrayContaining(['timaru-chipshop', 'smithfield-carpark', 'timaru-port-lockup']));
    expect(places[1]).toEqual(expect.arrayContaining(['temuka-pub', 'rangitata-layby']));
    expect(places[2]).toEqual(expect.arrayContaining(['hinds-woolshed', 'ashburton-stock-agent']));
    expect(places[3]).toEqual(expect.arrayContaining(['chch-garage', 'four-aves-start']));
    expect(places[4]).toEqual(expect.arrayContaining(['antigua-boatsheds', 'arts-centre']));
    expect(places[5]).toEqual(expect.arrayContaining(['sign-of-the-kiwi', 'lyttelton-wharf']));
  });

  for (const def of MISSIONS) {
    describe(def.id, () => {
      const refs = collectRefs(def);

      it('references only contract place, vehicle, weapon, pickup and landmark ids', () => {
        for (const id of refs.places) expect(PLACE_IDS as readonly string[], `place "${id}"`).toContain(id);
        for (const id of refs.vehicles) expect(VEHICLE_IDS as readonly string[], `vehicle "${id}"`).toContain(id);
        for (const id of refs.weapons) expect(WEAPON_IDS as readonly string[], `weapon "${id}"`).toContain(id);
        for (const id of refs.pickups) expect([...PICKUP_KINDS, ...WEAPON_IDS] as readonly string[], `pickup "${id}"`).toContain(id);
        for (const kind of refs.landmarks) expect(LANDMARK_KINDS as readonly string[], `landmark "${kind}"`).toContain(kind);
        expect(refs.places.size).toBeGreaterThan(1);
      });

      it('only uses entity handles it has spawned, each defined once', () => {
        for (const handle of refs.used) expect([...refs.defined], `handle "${handle}"`).toContain(handle);
        const seen = new Set<string>();
        for (const step of def.steps) {
          const names = step.kind === 'spawnVehicle' ? [step.as] : step.kind === 'spawnPeds' ? step.peds.map((p) => p.as) : step.kind === 'race' ? step.rivals.map((r) => r.as) : [];
          for (const name of names) {
            expect(seen.has(name), `handle "${name}" defined twice`).toBe(false);
            seen.add(name);
          }
        }
      });

      it('has a handler for every step, an objective for every step the player waits on, and a proper card', () => {
        const waits: Step['kind'][] = ['goTo', 'enterVehicle', 'deliverVehicle', 'eliminate', 'loseHeat', 'race', 'chase'];
        for (const step of def.steps) {
          expect(STEP_HANDLERS[step.kind], step.kind).toBeDefined();
          if (waits.includes(step.kind)) expect(typeof step.objective, `${step.kind} objective`).toBe('string');
        }
        expect(def.title.length).toBeGreaterThan(3);
        expect(def.giver.length).toBeGreaterThan(2);
        expect(def.blurb.length).toBeGreaterThan(40);
        expect(def.blurb.length).toBeLessThan(280);
        expect(def.steps.length).toBeGreaterThanOrEqual(5);
      });

      it('speaks in short subtitled lines, each with a speaker', () => {
        const lines = linesOf(def);
        expect(lines.length).toBeGreaterThanOrEqual(8);
        for (const l of lines) {
          expect(l.who, l.text).toBeTruthy();
          expect(l.text.length, l.text).toBeLessThanOrEqual(150);
          expect(l.text.trim(), l.text).toBe(l.text);
        }
      });

      it('writes te reo Māori with its macrons', () => {
        const text = [def.blurb, def.title, ...linesOf(def).map((l) => l.text), ...def.steps.map((s) => s.objective ?? '')].join('\n');
        // Words that take a macron must not appear without one.
        for (const bare of [/\bwhanau\b/i, /\bMaori\b/i, /\bNgai\b/i, /\bkorero\b/i, /\bhangi\b/i, /\bpaua\b/i, /\bkumara\b/i, /\bkaumatua\b/i, /\bmorena\b/i]) expect(text).not.toMatch(bare);
      });
    });
  }

  it('uses te reo in everyday speech, and gives the story a Māori cast beyond Aunty Rena', () => {
    const all = MISSIONS.flatMap(linesOf);
    const text = all.map((l) => l.text).join('\n');
    for (const word of ['Kia ora', 'whānau', 'kai', 'Ka pai', 'e hoa', 'mahi', 'tamariki', 'hui', 'Kia kaha']) expect(text, word).toContain(word);
    const speakers = new Set(all.map((l) => l.who));
    for (const who of ['Aunty Rena', 'Hine', 'Tama', 'Tip', 'Mack']) expect([...speakers], who).toContain(who);
  });

  it('leans on police pursuit and shoot-outs from the second mission on', () => {
    for (const def of MISSIONS.slice(1)) {
      const kinds = def.steps.map((s) => s.kind);
      const pursuit = kinds.includes('loseHeat') || kinds.includes('chase') || def.steps.some((s) => s.police?.minLevel);
      const shootOut = kinds.includes('eliminate');
      expect(pursuit || shootOut, def.id).toBe(true);
    }
    const count = (kind: Step['kind']) => MISSIONS.filter((m) => m.steps.some((s) => s.kind === kind)).length;
    expect(count('loseHeat')).toBeGreaterThanOrEqual(4);
    expect(count('eliminate')).toBeGreaterThanOrEqual(3);
    expect(count('race')).toBe(1);
    expect(count('chase')).toBe(1);
  });

  it('world pickups hang off contract places and known pickup kinds, with a cricket bat by the start', () => {
    const ids = new Set<string>();
    for (const p of WORLD_PICKUPS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      const place = typeof p.at === 'string' ? p.at : p.at.place;
      expect(PLACE_IDS as readonly string[]).toContain(place);
      expect([...PICKUP_KINDS, ...WEAPON_IDS] as readonly string[]).toContain(p.kind);
    }
    expect(WORLD_PICKUPS.find((p) => p.kind === 'bat')?.at).toMatchObject({ place: 'timaru-spawn' });
    for (const kind of ['health', 'armour', 'cash']) expect(WORLD_PICKUPS.some((p) => p.kind === kind)).toBe(true);
  });
});

// ───────────────────────────── Play-through ─────────────────────────────

interface Harness {
  fake: Fake;
  runner: MissionRunner;
  dialogue: Dialogue;
  markers: MarkerPool;
  failures: string[];
}

function harness(options?: FakeOptions): Harness {
  const fake = makeFake(options);
  const markers = new MarkerPool(fake.scene);
  const dialogue = new Dialogue(fake.ctx);
  const runner = new MissionRunner(fake.ctx, MISSIONS, { markers, dialogue });
  runner.validate();
  const failures: string[] = [];
  fake.events.on('missionFailed', ({ id, reason }) => failures.push(`${id}: ${reason}`));
  return { fake, runner, dialogue, markers, failures };
}

const _r = newResolved();

/** A dutiful player: does whatever the current step asks, by the most direct means available. */
function act(h: Harness, run: MissionRun, visited: Resolved[]) {
  const { fake } = h;
  const step = run.def.steps[run.stepIndex];
  if (!step) return;
  const driveIt = (name: string | undefined) => {
    if (name === undefined) return;
    const v = run.vehicle(name);
    if (v && fake.player.vehicle !== v) {
      fake.getOut();
      fake.drive(v);
    }
  };
  const park = () => {
    if (fake.player.vehicle) (fake.player.vehicle as unknown as FakeVehicle).speed = 0;
  };
  switch (step.kind) {
    case 'goTo': {
      if (step.mode === 'vehicle') driveIt(step.vehicle);
      if (step.mode === 'foot') fake.getOut();
      if (run.resolve(step.to, _r).ok) {
        fake.moveTo(_r.x, _r.z);
        visited.push({ ..._r });
      }
      park();
      break;
    }
    case 'enterVehicle': {
      const e = step.vehicle !== undefined ? run.entity(step.vehicle) : null;
      if (e?.vehicle) driveIt(step.vehicle);
      else if (e?.resolved) fake.moveTo(e.at.x + 3, e.at.z);
      break;
    }
    case 'deliverVehicle': {
      const e = run.entity(step.vehicle);
      if (!e?.vehicle) {
        if (e?.resolved) fake.moveTo(e.at.x + 3, e.at.z);
        break;
      }
      driveIt(step.vehicle);
      if (step.clean) fake.police.level = 0;
      if (run.resolve(step.to, _r).ok) fake.moveTo(_r.x, _r.z);
      park();
      break;
    }
    case 'eliminate': {
      for (const name of step.targets) {
        const e = run.entity(name);
        if (!e) continue;
        if (e.state === 'pending' && e.resolved) fake.moveTo(e.at.x + 4, e.at.z);
        else if (e.ped) (e.ped as unknown as FakePed).kill();
        else if (e.vehicle) e.vehicle.destroyed = true;
      }
      break;
    }
    case 'loseHeat': {
      driveIt(step.vehicle);
      if (run.stepTime > (step.holdFor ?? 0) + 0.3) fake.police.level = 0;
      break;
    }
    case 'race': {
      const d = run.scratch.data as { go: boolean; next: number; cps: Resolved[] } | null;
      if (d?.go && d.cps.length) {
        const cp = d.cps[d.next % d.cps.length];
        fake.moveTo(cp.x, cp.z);
      }
      break;
    }
    case 'chase': {
      const v = run.vehicle(step.target);
      if (v) fake.moveTo(v.position.x - 15, v.position.z - 15);
      break;
    }
    default:
      break;
  }
}

/** Play one mission to the end. Returns how long it took in game seconds (dialogue and drive time not included in travel). */
async function play(h: Harness, id: string, limit = 1500): Promise<{ seconds: number; visited: Resolved[] }> {
  const dt = 0.1;
  const visited: Resolved[] = [];
  // As in the game: walk up to where the job is handed out.
  const start = h.fake.world.place(h.runner.def(id)!.placeId);
  h.fake.getOut();
  h.fake.moveTo(start.x, start.z);
  expect(h.runner.start(id), `start ${id}`).toBe(true);
  let seconds = 0;
  while (h.runner.run && seconds < limit) {
    act(h, h.runner.run, visited);
    h.dialogue.update(dt);
    h.runner.update(dt);
    await flush();
    seconds += dt;
  }
  expect(h.runner.run, `${id} still running after ${limit}s at step ${h.runner.run?.stepIndex}`).toBeNull();
  return { seconds, visited };
}

describe('the six missions (played through on the toy map)', () => {
  it('can each be completed in order, and the last one finishes the story', async () => {
    const h = harness();
    const money: number[] = [];
    for (const def of MISSIONS) {
      await play(h, def.id);
      expect(h.failures, def.id).toEqual([]);
      expect(h.runner.done.has(def.id), def.id).toBe(true);
      money.push(h.fake.player.money);
      // Nothing of the mission's is left on the HUD or holding the world open.
      expect(h.fake.ui.objectiveText).toBeNull();
      expect(h.fake.ui.timerLabel).toBeNull();
      expect(h.fake.ui.blips.size).toBe(0);
      expect(h.markers.activeCount).toBe(0);
      expect(h.fake.world.foci).toHaveLength(0);
      expect(h.fake.police.enabled).toBe(true);
      expect(h.fake.player.controlsEnabled).toBe(true);
      expect(h.fake.peds.density).toBe(1);
      expect(h.fake.traffic.density).toBe(1);
    }
    expect(money).toEqual([200, 700, 1900, 3900, 7100, 12100]);
    expect(h.runner.completed).toBe(true);
    expect(h.runner.list().every((m) => m.state === 'done')).toBe(true);
    expect(h.fake.save.saves).toBe(6);
    // Leftovers are cleared once the player moves on.
    h.fake.moveTo(-2000, -2000);
    h.runner.update(0.1);
    expect(h.runner.lingeringCount).toBe(0);
    expect(h.fake.vehicles.all.filter((v) => v !== h.fake.player.vehicle)).toHaveLength(0);
    expect(h.fake.peds.all.every((p) => p.removed)).toBe(true);
  });

  it('hands out the right kit and sets the scene', async () => {
    const h = harness();
    h.fake.clock.hour = 13;
    for (const def of MISSIONS) await play(h, def.id);
    expect(h.fake.combat.given.map((g) => g.id)).toEqual(['shotgun', 'pistol', 'pistol', 'shotgun']);
    expect(h.fake.env.weather).toBe('southerly');
    // The race was run at night.
    expect(h.fake.ui.fades.length).toBeGreaterThan(0);
    const said = h.fake.ui.subtitles.map((s) => s.speaker);
    for (const who of ['Aunty Rena', 'Hine', 'Jock', 'Shona', 'Russell', 'Neville', 'Dazza', 'Tama', 'Tracey', 'Brick', 'Tip', 'Flash Harkness', 'Mack']) expect(said, who).toContain(who);
    // Every hostile character was an Easterly with a weapon; nobody hostile was ever put on the marae.
    const hostile = h.fake.peds.all.filter((p) => p.options.kind === 'gang');
    expect(hostile.length).toBeGreaterThanOrEqual(25);
    for (const ped of hostile) {
      expect(ped.options.weaponId).toBeTruthy();
      expect(maraeAt(h.fake.ctx.world, ped.options.x, ped.options.z, TUNING.maraeMargin)).toBeNull();
    }
    expect(h.fake.audio.played.filter((s) => s === 'sheep').length).toBeGreaterThanOrEqual(2);
  });

  it('the kai is dropped at the roadside by the marae gate with no heat staged there', async () => {
    const h = harness();
    await play(h, 'severance-pay');
    const levels: number[] = [];
    h.fake.events.on('wantedChanged', ({ level }) => {
      const p = h.fake.player.position;
      if (level > 0 && maraeAt(h.fake.ctx.world, p.x, p.z, TUNING.maraeMargin)) levels.push(level);
    });
    const { visited } = await play(h, 'on-ice');
    const marae = h.fake.world.landmarks[0];
    const drop = visited.find((v) => Math.hypot(v.x - marae.x, v.z - marae.z) < marae.clearRadius + 30);
    expect(drop, 'visited the marae gate').toBeDefined();
    expect(Math.hypot(drop!.x - marae.x, drop!.z - marae.z)).toBeGreaterThanOrEqual(marae.clearRadius);
    expect(levels).toEqual([]);
    expect(h.fake.ui.subtitles.some((s) => s.speaker === 'Hine')).toBe(true);
  });

  it('still play through with no pedestrians and no traffic AI (other modules still stubs)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ peds: false, traffic: false });
    for (const def of MISSIONS) await play(h, def.id);
    expect(h.failures).toEqual([]);
    expect(h.runner.completed).toBe(true);
    expect(h.fake.vehicles.all.filter((v) => v.tags.has('racer'))).toHaveLength(0);
  });

  it('still play through with only the first vehicle in the roster and no marae on the map', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ specs: ['statesman'], marae: false });
    for (const def of MISSIONS) await play(h, def.id);
    expect(h.failures).toEqual([]);
    expect(h.runner.completed).toBe(true);
    expect(h.fake.ui.subtitles.some((s) => s.speaker === 'Hine')).toBe(false);
  });

  it('on the vertical-slice map (hardly any places) every mission is disabled, quietly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ places: ['chch-hospital', 'chch-police'] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.runner.list().every((m) => m.state === 'locked')).toBe(true);
    expect(h.runner.start('severance-pay')).toBe(false);
    expect(() => h.runner.update(0.016)).not.toThrow();
  });

  it('take a sensible amount of talking: no briefing runs much over half a minute', () => {
    for (const def of MISSIONS) {
      for (const step of def.steps) {
        if (step.kind !== 'say' || !step.block) continue;
        const seconds = step.lines.reduce((sum, l) => sum + Math.min(6.5, Math.max(2.2, 1.3 + l.text.length * 0.055)) + 0.25, 0);
        expect(seconds, `${def.id} briefing`).toBeLessThan(45);
      }
    }
  });
});
