import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvents } from '../core/types';
import { Dialogue } from './dialogue';
import { MarkerPool } from './markers';
import { MissionRunner } from './runner';
import { FakePed, flush, makeFake, MARAE, type FakeOptions, type FakeVehicle } from './testkit';
import { TUNING } from './tuning';
import type { MissionDef, Step } from './types';

const DT = 1 / 60;

function setup(defs: MissionDef[], options?: FakeOptions) {
  const fake = makeFake(options);
  const markers = new MarkerPool(fake.scene);
  const dialogue = new Dialogue(fake.ctx);
  const runner = new MissionRunner(fake.ctx, defs, { markers, dialogue });
  runner.validate();
  const log: { type: keyof GameEvents; payload: unknown }[] = [];
  for (const type of ['missionStarted', 'missionCompleted', 'missionFailed'] as const) fake.events.on(type, (payload) => log.push({ type, payload }));
  /** Advance the mission by `seconds` in frames of `dt`. */
  const tick = (seconds = DT, dt = DT) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      dialogue.update(dt);
      runner.update(dt);
    }
  };
  return { fake, markers, dialogue, runner, tick, log };
}

const mission = (steps: Step[], extra: Partial<MissionDef> = {}): MissionDef => ({
  id: 'test',
  title: 'Test Job',
  giver: 'Tester',
  blurb: 'A test.',
  reward: 100,
  placeId: 'timaru-chipshop',
  steps,
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('step sequencing', () => {
  it('walks goTo → enterVehicle → deliverVehicle and passes', () => {
    const { fake, runner, tick, log, markers } = setup([
      mission([
        { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'smithfield-carpark' },
        { kind: 'goTo', id: 'go', to: 'smithfield-carpark', radius: 30, objective: 'Get to the works' },
        { kind: 'enterVehicle', id: 'enter', vehicle: 'ute', objective: 'Nick the ute' },
        { kind: 'deliverVehicle', id: 'deliver', vehicle: 'ute', to: 'timaru-port-lockup', radius: 8, objective: 'Take it to the lock-up' },
      ]),
    ]);
    fake.moveTo(10, 5850);
    expect(runner.start('test')).toBe(true);
    expect(runner.active?.id).toBe('test');
    expect(runner.list()[0].state).toBe('active');
    expect(log[0]).toEqual({ type: 'missionStarted', payload: { id: 'test' } });
    expect(fake.ui.banners[0]).toMatchObject({ title: 'Test Job', tone: 'neutral' });

    tick();
    // The spawn step is instant; the player is within 500 m, so the ute already exists.
    expect(runner.run!.stepIndex).toBe(1);
    expect(fake.ui.objectiveText).toBe('Get to the works');
    expect(fake.ui.blips.get('m:goal')).toMatchObject({ kind: 'objective', x: 40, z: 5400, pinned: true });
    expect(markers.activeCount).toBe(1);
    const ute = runner.run!.vehicle('ute')!;
    expect(ute.spec.id).toBe('ute');
    expect(ute.tags.has('mission')).toBe(true);
    expect(ute.controls.handbrake).toBe(true);

    fake.moveTo(45, 5410);
    tick();
    expect(runner.run!.stepIndex).toBe(2);
    expect(fake.ui.objectiveText).toBe('Nick the ute');
    expect(fake.ui.blips.get('m:vehicle')).toMatchObject({ kind: 'vehicle' });
    expect(fake.ui.blips.has('m:goal')).toBe(false);

    fake.drive(ute);
    tick();
    expect(runner.run!.stepIndex).toBe(3);
    expect(fake.ui.objectiveText).toBe('Take it to the lock-up');

    // Arriving too fast does not count.
    fake.moveTo(45, 5990);
    (ute as unknown as FakeVehicle).speed = 12;
    tick();
    expect(runner.run).not.toBeNull();
    (ute as unknown as FakeVehicle).speed = 0;
    tick();

    expect(runner.run).toBeNull();
    expect(runner.active).toBeNull();
    expect(runner.list()[0].state).toBe('done');
    expect(log.at(-1)).toEqual({ type: 'missionCompleted', payload: { id: 'test', reward: 100 } });
    expect(fake.player.money).toBe(100);
    expect(fake.audio.played).toContain('missionPass');
    expect(fake.ui.banners.at(-1)).toMatchObject({ title: 'Job done', tone: 'good' });
    expect(fake.save.saves).toBe(1);
    expect(fake.ui.objectiveText).toBeNull();
    expect(fake.ui.blips.size).toBe(0);
    expect(markers.activeCount).toBe(0);
  });

  it('runs instant steps in a single frame', () => {
    const { fake, runner, tick } = setup([
      mission([
        { kind: 'setWeather', weather: 'southerly', transition: 30 },
        { kind: 'giveWeapon', weapon: 'pistol', ammo: 24, select: true, armour: 50 },
        { kind: 'setWanted', level: 2 },
        { kind: 'spawnPickup', pickup: 'health', at: 'timaru-chipshop' },
        { kind: 'say', lines: [{ who: 'Rena', text: 'Kia ora.' }] },
      ]),
    ]);
    fake.moveTo(10, 5900);
    runner.start('test');
    tick();
    expect(runner.run).toBeNull();
    expect(runner.done.has('test')).toBe(true);
    expect(fake.env.weather).toBe('southerly');
    expect(fake.combat.given).toEqual([{ id: 'pistol', ammo: 24 }]);
    expect(fake.combat.selected).toBe('pistol');
    expect(fake.player.armour).toBe(50);
    expect(fake.police.level).toBe(2);
    // The pickup was mission set dressing: gone with the mission.
    expect(fake.combat.pickups).toHaveLength(1);
    expect(fake.combat.pickups[0].removed).toBe(true);
  });

  it('a blocking say waits for the dialogue queue, and lines carry their speaker', () => {
    const { fake, runner, tick } = setup([
      mission([
        { kind: 'say', block: true, lines: [{ who: 'Rena', text: 'One.', seconds: 2 }, { who: 'Mack', text: 'Two.', seconds: 2 }] },
        { kind: 'wait', seconds: 1 },
      ]),
    ]);
    runner.start('test');
    tick(1);
    expect(fake.ui.subtitles).toEqual([{ text: 'One.', speaker: 'Rena' }]);
    expect(runner.run!.stepIndex).toBe(0);
    tick(2);
    expect(fake.ui.subtitles).toHaveLength(2);
    expect(runner.run!.stepIndex).toBe(0);
    tick(2.5);
    expect(runner.run!.stepIndex).toBe(1);
    tick(1.1);
    expect(runner.run).toBeNull();
  });

  it('a briefing stops holding things up if the player walks off', () => {
    const { fake, runner, tick } = setup([
      mission([
        { kind: 'say', block: true, lines: [{ who: 'Rena', text: 'One.', seconds: 5 }, { who: 'Rena', text: 'Two.', seconds: 5 }] },
        { kind: 'wait', seconds: 60, objective: 'Get going' },
      ]),
    ]);
    fake.moveTo(10, 5900);
    runner.start('test');
    tick(1);
    expect(runner.run!.stepIndex).toBe(0);
    fake.moveTo(10, 5900 - TUNING.briefingLeash - 1);
    tick();
    expect(runner.run!.stepIndex).toBe(1);
    expect(fake.ui.objectiveText).toBe('Get going');
    // …and the rest of the talk still plays.
    tick(5);
    expect(fake.ui.subtitles.map((s) => s.text)).toEqual(['One.', 'Two.']);
  });

  it('skips steps whose `needs` spot is not on the map', () => {
    const gate = { landmark: 'marae', near: 'temuka-pub', edge: 1, snap: 'verge' } as const;
    const steps: Step[] = [
      { kind: 'goTo', needs: gate, to: gate, radius: 10, objective: 'Drop the kai at the marae' },
      { kind: 'goTo', to: 'temuka-pub', radius: 10, objective: 'On to Temuka' },
    ];
    const without = setup([mission(steps)], { marae: false });
    without.runner.start('test');
    without.tick();
    expect(without.runner.run!.stepIndex).toBe(1);
    expect(without.fake.ui.objectiveText).toBe('On to Temuka');

    const withMarae = setup([mission(steps)]);
    withMarae.runner.start('test');
    withMarae.tick();
    expect(withMarae.runner.run!.stepIndex).toBe(0);
    // The drop-off is on the roadside in front of the marae, not on the marae itself.
    const blip = withMarae.fake.ui.blips.get('m:goal')!;
    expect(Math.abs(blip.x)).toBeLessThan(8);
    expect(Math.hypot(blip.x - MARAE.x, blip.z - MARAE.z)).toBeGreaterThan(MARAE.clearRadius);
  });

  it('fires cues at their time: lines, sounds and a held wanted level', () => {
    const { fake, runner, tick } = setup([
      mission([
        {
          kind: 'wait',
          seconds: 10,
          cues: [
            { at: 1, sfx: 'sheep', toast: 'Baa' },
            { at: 3, wanted: 2, lines: [{ who: 'Mack', text: 'Here they come.' }] },
          ],
        },
      ]),
    ]);
    runner.start('test');
    tick(0.5);
    expect(fake.audio.played).not.toContain('sheep');
    tick(1);
    expect(fake.audio.played).toContain('sheep');
    expect(fake.ui.toasts).toContain('Baa');
    expect(fake.police.level).toBe(0);
    tick(2);
    expect(fake.police.level).toBe(2);
    expect(fake.ui.subtitles.at(-1)).toEqual({ text: 'Here they come.', speaker: 'Mack' });
    // Held: the police cannot be shaken while the step runs.
    fake.police.level = 0;
    tick();
    expect(fake.police.level).toBe(2);
  });

  it('survives a step that throws: the mission fails, the loop carries on', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fake, runner, tick, log } = setup([
      mission([
        {
          kind: 'custom',
          tick() {
            throw new Error('boom');
          },
        },
      ]),
    ]);
    runner.start('test');
    expect(() => tick()).not.toThrow();
    expect(runner.run).toBeNull();
    expect(log.at(-1)?.type).toBe('missionFailed');
    expect(runner.list()[0].state).toBe('available');
    expect(fake.ui.objectiveText).toBeNull();
  });

  it('custom steps get enter / tick / exit and the runtime', () => {
    const calls: string[] = [];
    const { runner, tick } = setup([
      mission([
        {
          kind: 'custom',
          enter: (run) => {
            calls.push('enter');
            run.vars.count = 0;
          },
          tick: (run) => ++run.vars.count >= 3,
          exit: () => calls.push('exit'),
        },
      ]),
    ]);
    runner.start('test');
    tick(DT * 2);
    expect(runner.run).not.toBeNull();
    tick();
    expect(runner.run).toBeNull();
    expect(calls).toEqual(['enter', 'exit']);
  });
});

describe('timers', () => {
  it('a step timer counts down on screen and fails the mission when it runs out', () => {
    const { fake, runner, tick, log } = setup([mission([{ kind: 'goTo', to: 'temuka-pub', timer: { seconds: 5, label: 'Ice', reason: 'The ice melted' } }])]);
    runner.start('test');
    tick();
    expect(fake.ui.timerLabel).toBe('Ice');
    expect(fake.ui.timerSeconds).toBe(5);
    tick(2);
    expect(fake.ui.timerSeconds).toBe(3);
    tick(3.1);
    expect(runner.run).toBeNull();
    expect(log.at(-1)).toEqual({ type: 'missionFailed', payload: { id: 'test', reason: 'The ice melted' } });
    expect(fake.ui.banners.at(-1)).toMatchObject({ title: "Job's off", sub: 'The ice melted', tone: 'bad' });
    expect(fake.audio.played).toContain('missionFail');
    expect(fake.ui.timerLabel).toBeNull();
  });

  it('a step timer goes away when the step is finished in time', () => {
    const { fake, runner, tick } = setup([mission([{ kind: 'goTo', to: 'temuka-pub', timer: 30 }, { kind: 'wait', seconds: 60 }])]);
    runner.start('test');
    tick();
    expect(fake.ui.timerSeconds).toBe(30);
    fake.moveTo(10, 4200);
    tick();
    expect(runner.run!.stepIndex).toBe(1);
    expect(fake.ui.timerLabel).toBeNull();
    tick(40);
    expect(runner.run).not.toBeNull();
  });

  it('a mission timer spans steps until stopTimer', () => {
    const steps = (stop: boolean): Step[] => [
      { kind: 'startTimer', time: { seconds: 6, label: 'Ice', reason: 'Too slow' } },
      { kind: 'wait', seconds: 2 },
      { kind: 'wait', seconds: 2 },
      ...(stop ? [{ kind: 'stopTimer' } as Step] : []),
      { kind: 'wait', seconds: 5 },
    ];
    const kept = setup([mission(steps(false))]);
    kept.runner.start('test');
    kept.tick(3);
    expect(kept.runner.run!.stepIndex).toBe(2);
    expect(kept.fake.ui.timerLabel).toBe('Ice');
    kept.tick(3.2);
    expect(kept.log.at(-1)).toEqual({ type: 'missionFailed', payload: { id: 'test', reason: 'Too slow' } });

    const stopped = setup([mission(steps(true))]);
    stopped.runner.start('test');
    stopped.tick(4.1);
    expect(stopped.fake.ui.timerLabel).toBeNull();
    stopped.tick(5.1);
    expect(stopped.log.at(-1)?.type).toBe('missionCompleted');
  });

  it('scales a timer by the road distance to its target', () => {
    const { fake, runner, tick } = setup([mission([{ kind: 'goTo', to: 'rangitata-layby', timer: { base: 40, perKm: 60, to: 'rangitata-layby' } }])]);
    // Temuka to the lay-by is 1.3 km in the toy world; routed via the graph or as a padded straight line,
    // the allowance must be the base plus about a minute per kilometre.
    fake.moveTo(10, 4200);
    runner.start('test');
    tick();
    expect(fake.ui.timerSeconds).toBeGreaterThanOrEqual(40 + 78);
    expect(fake.ui.timerSeconds).toBeLessThanOrEqual(40 + 78 * 1.35);
  });

  it('survive shows a countdown and completes when it ends', () => {
    const { fake, runner, tick } = setup([mission([{ kind: 'survive', seconds: 4, label: 'Hold on' }])]);
    runner.start('test');
    tick(1.1);
    expect(fake.ui.timerLabel).toBe('Hold on');
    expect(fake.ui.timerSeconds).toBe(3);
    tick(3);
    expect(runner.done.has('test')).toBe(true);
  });
});

describe('fail conditions', () => {
  const withUte = (extra: Partial<Step> & { failIf?: Step['failIf'] }, missionExtra: Partial<MissionDef> = {}) =>
    setup([
      mission(
        [
          { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'timaru-chipshop', wait: true },
          { kind: 'spawnPeds', peds: [{ as: 'tip', at: { place: 'timaru-chipshop', forward: 4 }, name: 'Tip', behaviour: 'stand' }], wait: true },
          { kind: 'wait', seconds: 60, ...extra } as Step,
        ],
        missionExtra,
      ),
    ]);
  const begin = (s: ReturnType<typeof setup>) => {
    s.fake.moveTo(10, 5900);
    s.runner.start('test');
    s.tick();
    expect(s.runner.run!.stepIndex).toBe(2);
    return s.runner.run!;
  };
  const failure = (s: ReturnType<typeof setup>) => (s.log.at(-1)?.type === 'missionFailed' ? (s.log.at(-1)!.payload as { reason: string }).reason : null);

  it('vehicle destroyed', () => {
    const s = withUte({ failIf: [{ kind: 'vehicleDestroyed', vehicle: 'ute', reason: 'Wrecked it' }] });
    const run = begin(s);
    s.tick(1);
    expect(s.runner.run).not.toBeNull();
    run.vehicle('ute')!.destroyed = true;
    s.tick();
    expect(failure(s)).toBe('Wrecked it');
  });

  it('vehicle damaged below a threshold', () => {
    const s = withUte({ failIf: [{ kind: 'vehicleDamaged', vehicle: 'ute', below: 0.5, reason: 'Munted' }] });
    const run = begin(s);
    run.vehicle('ute')!.health = 60;
    s.tick();
    expect(s.runner.run).not.toBeNull();
    run.vehicle('ute')!.health = 49;
    s.tick();
    expect(failure(s)).toBe('Munted');
  });

  it('target escaped beyond a distance', () => {
    const s = withUte({ failIf: [{ kind: 'escaped', target: 'ute', distance: 200, reason: 'Gone' }] });
    begin(s);
    s.fake.moveTo(10, 5750);
    s.tick();
    expect(s.runner.run).not.toBeNull();
    s.fake.moveTo(10, 5650);
    s.tick();
    expect(failure(s)).toBe('Gone');
  });

  it('key pedestrian died', () => {
    const s = withUte({ failIf: [{ kind: 'pedDied', ped: 'tip' }] });
    const run = begin(s);
    (run.ped('tip') as unknown as FakePed).kill();
    s.tick();
    expect(failure(s)).toBe('Tip is dead');
  });

  it('vehicle abandoned', () => {
    const s = withUte({ failIf: [{ kind: 'abandoned', vehicle: 'ute', distance: 100, reason: 'Left it' }] });
    const run = begin(s);
    s.fake.drive(run.vehicle('ute')!);
    s.fake.moveTo(10, 5000);
    s.tick();
    expect(s.runner.run).not.toBeNull();
    s.fake.getOut();
    s.fake.moveTo(10, 4800);
    s.tick();
    expect(failure(s)).toBe('Left it');
  });

  it('too much heat, and custom tests', () => {
    const hot = withUte({ failIf: [{ kind: 'wantedAbove', level: 2, reason: 'Too hot' }] });
    begin(hot);
    hot.fake.police.level = 2;
    hot.tick();
    expect(hot.runner.run).not.toBeNull();
    hot.fake.police.level = 3;
    hot.tick();
    expect(failure(hot)).toBe('Too hot');

    const custom = withUte({ failIf: [{ kind: 'custom', test: (run) => run.stepTime > 2, reason: 'Dawdled' }] });
    begin(custom);
    custom.tick(2.2);
    expect(failure(custom)).toBe('Dawdled');
  });

  it('mission-level conditions apply to every step', () => {
    const s = withUte({}, { failIf: [{ kind: 'vehicleDestroyed', vehicle: 'ute' }] });
    const run = begin(s);
    run.vehicle('ute')!.destroyed = true;
    s.tick();
    expect(failure(s)).toBe('The ute is a write-off');
  });

  it('the player dying or being busted ends the mission, on the next update', () => {
    for (const [event, reason] of [
      ['playerDied', 'You carked it'],
      ['playerBusted', 'Nicked'],
    ] as const) {
      const s = withUte({});
      begin(s);
      if (event === 'playerDied') s.fake.events.emit('playerDied', { info: { amount: 999, kind: 'bullet' } });
      else s.fake.events.emit('playerBusted', {});
      // Flagged, not yet torn down: nothing is removed in the middle of another system's update.
      expect(s.runner.run).not.toBeNull();
      expect(s.fake.vehicles.removed).toHaveLength(0);
      s.tick();
      expect(s.runner.run).toBeNull();
      expect(failure(s)).toBe(reason);
      expect(s.runner.list()[0].state).toBe('available');
    }
  });

  it('a deliver step fails by itself when the vehicle is wrecked or too damaged', () => {
    const make = () =>
      setup([
        mission([
          { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'timaru-chipshop', wait: true },
          { kind: 'deliverVehicle', vehicle: 'ute', to: 'timaru-port-lockup', minHealth: 0.5, damageReason: 'Scrap', objective: 'Deliver it' },
        ]),
      ]);
    const a = make();
    a.fake.moveTo(10, 5900);
    a.runner.start('test');
    a.tick();
    const ute = a.runner.run!.vehicle('ute')!;
    a.fake.drive(ute);
    a.tick();
    expect(a.fake.ui.timerLabel).toBe('Condition 100%');
    ute.health = 72;
    a.tick();
    expect(a.fake.ui.timerLabel).toBe('Condition 75%');
    ute.health = 40;
    a.tick();
    expect(failure(a)).toBe('Scrap');
  });
});

describe('clean-up', () => {
  const messy = (): MissionDef =>
    mission([
      { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'timaru-chipshop', wait: true },
      {
        kind: 'spawnPeds',
        peds: [
          { as: 'goon', at: { place: 'timaru-chipshop', forward: 8 }, behaviour: 'attack', weapon: 'pistol' },
          { as: 'mate', at: { place: 'timaru-chipshop', forward: -8 }, behaviour: 'stand' },
        ],
        wait: true,
      },
      { kind: 'spawnPickup', as: 'medkit', pickup: 'health', at: { place: 'timaru-chipshop', left: 3 } },
      { kind: 'eliminate', targets: ['goon'], objective: 'Deal to him ({n} left)', timer: 30, police: { suspend: true } },
    ]);

  it('on failure: UI cleared, law restored, pickups gone, vehicles and people removed once out of sight', () => {
    const s = setup([messy()]);
    s.fake.moveTo(10, 5900);
    s.runner.start('test');
    s.tick();
    const run = s.runner.run!;
    const goon = run.ped('goon') as unknown as FakePed;
    const mate = run.ped('mate') as unknown as FakePed;
    expect(goon.options).toMatchObject({ kind: 'gang', behaviour: 'attack', weaponId: 'pistol', persistent: true });
    expect(mate.options).toMatchObject({ kind: 'scripted', behaviour: 'stand', persistent: true });
    expect(s.fake.ui.objectiveText).toBe('Deal to him (1 left)');
    expect(s.fake.ui.blips.get('m:goon')).toMatchObject({ kind: 'enemy' });
    expect(s.fake.police.enabled).toBe(false);
    expect(s.fake.combat.pickups[0].removed).toBe(false);
    expect(s.fake.world.foci.length).toBeGreaterThan(0); // the parked ute holds its patch of world

    s.tick(31);
    expect(s.runner.run).toBeNull();
    expect(s.log.at(-1)?.type).toBe('missionFailed');
    expect(s.runner.list()[0].state).toBe('available');
    expect(s.fake.ui.objectiveText).toBeNull();
    expect(s.fake.ui.timerLabel).toBeNull();
    expect(s.fake.ui.blips.size).toBe(0);
    expect(s.markers.activeCount).toBe(0);
    expect(s.fake.police.enabled).toBe(true);
    expect(s.fake.player.controlsEnabled).toBe(true);
    expect(s.fake.world.foci).toHaveLength(0);
    expect(s.fake.combat.pickups[0].removed).toBe(true);
    // Still standing where the player can see them, but the gunman has been told to scarper.
    expect(s.runner.lingeringCount).toBe(3);
    expect(goon.behaviour).toBe('flee');
    expect(goon.removed).toBe(false);

    s.fake.moveTo(10, 5900 - TUNING.lingerDistance - 20);
    s.tick();
    expect(s.runner.lingeringCount).toBe(0);
    expect(goon.removed).toBe(true);
    expect(mate.removed).toBe(true);
    expect(s.fake.vehicles.all).toHaveLength(0);
  });

  it('leftovers also go after a while, or the moment another mission starts', () => {
    const timed = setup([messy()]);
    timed.fake.moveTo(10, 5900);
    timed.runner.start('test');
    timed.tick();
    timed.runner.abort();
    expect(timed.runner.lingeringCount).toBe(3);
    timed.tick(TUNING.lingerSeconds + 1, 0.5);
    expect(timed.runner.lingeringCount).toBe(0);
    expect(timed.fake.vehicles.all).toHaveLength(0);

    const again = setup([messy()]);
    again.fake.moveTo(10, 5900);
    again.runner.start('test');
    again.tick();
    again.runner.abort();
    expect(again.fake.vehicles.all).toHaveLength(1);
    again.runner.start('test');
    expect(again.runner.lingeringCount).toBe(0);
    expect(again.fake.vehicles.all).toHaveLength(0);
  });

  it('abort: the mission is available again and a failure is announced', () => {
    const s = setup([messy()]);
    s.fake.moveTo(10, 5900);
    s.runner.start('test');
    s.tick();
    s.runner.abort('Changed my mind');
    expect(s.runner.run).toBeNull();
    expect(s.runner.active).toBeNull();
    expect(s.log.at(-1)).toEqual({ type: 'missionFailed', payload: { id: 'test', reason: 'Changed my mind' } });
    expect(s.fake.ui.banners.at(-1)).toMatchObject({ title: 'Job abandoned', tone: 'bad' });
    expect(s.runner.list()[0].state).toBe('available');
    expect(s.fake.police.enabled).toBe(true);
    expect(s.fake.ui.blips.size).toBe(0);
    expect(s.fake.save.saves).toBe(0);
    // Aborting with nothing running is a no-op.
    expect(() => s.runner.abort()).not.toThrow();
  });

  it('a mission vehicle the player has driven is theirs until they walk well away from it', () => {
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'timaru-chipshop', wait: true }, { kind: 'wait', seconds: 60 }])]);
    s.fake.moveTo(10, 5900);
    s.runner.start('test');
    s.tick();
    const ute = s.runner.run!.vehicle('ute')!;
    s.fake.drive(ute);
    s.tick();
    s.runner.abort();
    // Still at the wheel, a long way off and a long time later: it stays.
    s.fake.moveTo(10, 3000);
    s.tick(TUNING.lingerSeconds + 5, 0.5);
    expect(s.fake.vehicles.all).toContain(ute);
    // Parked up and popped into a shop: it stays, even across the start of another job.
    s.fake.getOut();
    s.fake.moveTo(10, 3000 + TUNING.lingerDrivenDistance - 50);
    s.tick(TUNING.lingerSeconds + 5, 0.5);
    s.runner.start('test');
    s.tick();
    expect(s.fake.vehicles.all).toContain(ute);
    // Walked away for good: tidied up.
    s.fake.moveTo(10, 3000 + TUNING.lingerDrivenDistance + 50);
    s.tick();
    expect(s.fake.vehicles.all).not.toContain(ute);
  });

  it('gives the controls and the law back when a race is cut short in its countdown', () => {
    const s = setup([
      mission([
        {
          kind: 'race',
          grid: { place: 'four-aves-start', snap: 'lane', road: 'moorhouse', along: 40 },
          checkpoints: [{ place: 'four-aves-start', dx: 500, snap: 'node' }],
          rivals: [{ as: 'r1', spec: 'coupe' }],
          police: { suspend: true },
        },
      ]),
    ]);
    s.fake.moveTo(40, -3);
    s.runner.start('test');
    s.tick();
    expect(s.fake.player.controlsEnabled).toBe(false);
    expect(s.fake.police.enabled).toBe(false);
    s.fake.events.emit('playerBusted', {});
    s.tick();
    expect(s.runner.run).toBeNull();
    expect(s.fake.player.controlsEnabled).toBe(true);
    expect(s.fake.police.enabled).toBe(true);
  });

  it('restores ambient densities', () => {
    const s = setup([mission([{ kind: 'wait', seconds: 5 }], { pedDensity: 0.3, trafficDensity: 0.5 })]);
    s.runner.start('test');
    expect(s.fake.peds.density).toBe(0.3);
    expect(s.fake.traffic.density).toBe(0.5);
    s.tick(5.1);
    expect(s.fake.peds.density).toBe(1);
    expect(s.fake.traffic.density).toBe(1);
  });
});

describe('spawning', () => {
  it('waits for the area to load, asking the streamer for it, then lets go', () => {
    const s = setup([
      mission([
        { kind: 'spawnPeds', peds: [{ as: 'goon', at: { place: 'temuka-pub', forward: 5 }, behaviour: 'attack' }] },
        { kind: 'eliminate', targets: ['goon'], objective: '{n} left' },
      ]),
    ]);
    s.fake.world.loaded = false;
    s.fake.moveTo(10, 4000);
    s.runner.start('test');
    s.tick(0.5);
    expect(s.fake.peds.all).toHaveLength(0);
    expect(s.fake.world.foci).toHaveLength(1);
    expect(s.fake.world.foci[0]).toMatchObject({ x: 10, z: 4205 });
    // Shown on the map where they will be.
    expect(s.fake.ui.blips.get('m:goon')).toMatchObject({ kind: 'enemy', x: 10, z: 4205 });
    s.fake.world.loaded = true;
    s.tick();
    expect(s.fake.peds.all).toHaveLength(1);
    expect(s.fake.world.foci).toHaveLength(0);
    expect(s.fake.ui.blips.get('m:goon')?.follow).toBeDefined();
  });

  it('holds off until the player is within the activation distance', () => {
    const s = setup([mission([{ kind: 'spawnPeds', peds: [{ as: 'goon', at: 'temuka-pub', behaviour: 'attack' }], activate: 100 }, { kind: 'eliminate', targets: ['goon'] }])]);
    s.fake.moveTo(10, 4400);
    s.runner.start('test');
    s.tick(1);
    expect(s.fake.peds.all).toHaveLength(0);
    expect(s.fake.world.foci).toHaveLength(0);
    s.fake.moveTo(10, 4290);
    s.tick();
    expect(s.fake.peds.all).toHaveLength(1);
    (s.fake.peds.all[0] as FakePed).kill();
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
  });

  it('a parked mission vehicle keeps its ground loaded until the player takes it', () => {
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'temuka-pub', wait: true }, { kind: 'enterVehicle', vehicle: 'ute' }, { kind: 'wait', seconds: 5 }])]);
    s.fake.moveTo(10, 4190);
    s.runner.start('test');
    s.tick();
    expect(s.fake.world.foci).toHaveLength(1);
    s.fake.drive(s.runner.run!.vehicle('ute')!);
    s.tick();
    expect(s.fake.world.foci).toHaveLength(0);
  });

  it('pre-loads a destination as the player approaches and releases it', () => {
    const s = setup([mission([{ kind: 'goTo', to: 'temuka-pub', radius: 10 }, { kind: 'wait', seconds: 5 }])]);
    s.fake.world.loaded = false;
    s.fake.moveTo(10, 4200 + TUNING.preloadDistance + 100);
    s.runner.start('test');
    s.tick();
    expect(s.fake.world.foci).toHaveLength(0);
    s.fake.moveTo(10, 4200 + TUNING.preloadDistance - 20);
    s.tick();
    expect(s.fake.world.foci).toHaveLength(1);
    s.fake.world.loaded = true;
    s.tick();
    expect(s.fake.world.foci).toHaveLength(0);
  });

  it('falls back to a stand-in when a vehicle spec is not in the roster yet', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'truck', spec: 'farmtruck', at: 'temuka-pub', wait: true }, { kind: 'wait', seconds: 5 }])], { specs: ['statesman'] });
    s.fake.moveTo(10, 4190);
    s.runner.start('test');
    s.tick();
    expect(s.runner.run!.vehicle('truck')!.spec.id).toBe('statesman');
  });

  it('carries on without pedestrians when that module is still a stub', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup([mission([{ kind: 'spawnPeds', peds: [{ as: 'goon', at: 'temuka-pub', behaviour: 'attack' }], wait: true }, { kind: 'eliminate', targets: ['goon'] }])], { peds: false });
    s.fake.moveTo(10, 4190);
    s.runner.start('test');
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
  });

  it('clears an ambient parked car off the spot, and waits for anything it cannot simply remove', () => {
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'temuka-pub' }, { kind: 'enterVehicle', vehicle: 'ute', objective: 'Get in' }])]);
    const parked = s.fake.vehicles.spawn('hatch', 11, 4201, 0, { tags: ['parked'] })!;
    const passing = s.fake.vehicles.spawn('wagon', 9, 4199, 0, { controller: 'traffic' })!;
    passing.driver = s.fake.player as never; // somebody is at the wheel
    s.fake.moveTo(10, 4150);
    s.runner.start('test');
    s.tick(0.5);
    expect(s.fake.vehicles.all).not.toContain(parked);
    expect(s.runner.run!.vehicle('ute')).toBeNull();
    // Shown on the map where it will be, meanwhile.
    expect(s.fake.ui.blips.get('m:vehicle')).toMatchObject({ kind: 'vehicle', x: 10, z: 4200 });
    passing.position.set(9, 0, 4100);
    s.tick();
    expect(s.runner.run!.vehicle('ute')?.spec.id).toBe('ute');
  });

  it('parks against the kerb when asked', () => {
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'a', spec: 'ute', at: { place: 'chch-garage', snap: 'lane', kerb: true } }, { kind: 'spawnVehicle', as: 'b', spec: 'ute', at: { place: 'temuka-pub', snap: 'lane', kerb: true } }, { kind: 'wait', seconds: 5 }])]);
    s.fake.moveTo(300, 9);
    s.runner.start('test');
    s.tick();
    // Moorhouse Ave: 14 m wide, two lanes each way, so the kerb is at z = 7; the car's centre sits 1.15 m in from it.
    expect(s.runner.run!.vehicle('a')!.position.z).toBeCloseTo(7 - 1.15);
    s.fake.moveTo(10, 4190);
    s.tick();
    // SH1 through Temuka: 8 m wide, one lane each way, kerb at x = 4.
    expect(s.runner.run!.vehicle('b')!.position.x).toBeCloseTo(4 - 1.15);
  });

  it('tags, ownership and health of mission vehicles', () => {
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'v8', spec: 'v8sedan', at: { place: 'chch-garage', snap: 'lane', along: 7, out: 1.2 }, owned: true, health: 1.5, tags: ['racer'], wait: true }, { kind: 'wait', seconds: 5 }])]);
    s.fake.moveTo(300, 9);
    s.runner.start('test');
    s.tick();
    const v8 = s.runner.run!.vehicle('v8')!;
    expect([...v8.tags].sort()).toEqual(['mission', 'owned', 'racer']);
    expect(v8.controller).toBe('mission');
    expect(v8.health).toBe(150);
    // Parked outside the garage: the kerb-side lane on its own (south) side of Moorhouse Ave, pulled in to
    // the kerb, 7 m along and pointing the way that lane runs (west: traffic keeps left).
    expect(v8.position.z).toBeCloseTo(5.25 + 1.2);
    expect(v8.position.x).toBeCloseTo(293);
    expect(v8.heading).toBeCloseTo(-Math.PI / 2);
  });
});

describe('marae', () => {
  it('nothing hostile, no vehicles and no pickups are placed on a marae; a friendly figure may stand there', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onMarae = { x: MARAE.x + 5, z: MARAE.z + 5 };
    const s = setup([
      mission([
        { kind: 'spawnPeds', peds: [{ as: 'goon', at: onMarae, behaviour: 'attack', weapon: 'pistol' }, { as: 'hine', at: onMarae, behaviour: 'stand', name: 'Hine' }], wait: true },
        { kind: 'spawnVehicle', as: 'van', spec: 'van', at: onMarae, wait: true },
        { kind: 'spawnPickup', as: 'cash', pickup: 'cash', at: onMarae },
        { kind: 'eliminate', targets: ['goon', 'van'] },
        { kind: 'wait', seconds: 5 },
      ]),
    ]);
    s.fake.moveTo(MARAE.x, MARAE.z + 20);
    s.runner.start('test');
    s.tick();
    expect(s.runner.run!.stepIndex).toBe(4);
    expect(s.fake.peds.all.map((p) => p.name)).toEqual(['Hine']);
    expect(s.fake.vehicles.all).toHaveLength(0);
    expect(s.fake.combat.pickups).toHaveLength(0);
  });

  it('no heat is raised while the player is on a marae', () => {
    const s = setup([mission([{ kind: 'wait', seconds: 30, police: { minLevel: 2 } }])]);
    s.fake.moveTo(MARAE.x, MARAE.z);
    s.runner.start('test');
    s.tick(1);
    expect(s.fake.police.level).toBe(0);
    s.fake.moveTo(10, 4000);
    s.tick();
    expect(s.fake.police.level).toBe(2);
  });

  it('a mission that would start on a marae is disabled', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup([mission([{ kind: 'wait', seconds: 1 }])]);
    s.fake.world.places.find((p) => p.id === 'timaru-chipshop')!.x = MARAE.x;
    s.fake.world.places.find((p) => p.id === 'timaru-chipshop')!.z = MARAE.z;
    s.runner.validate();
    expect(s.runner.list()[0].state).toBe('locked');
    expect(s.runner.start('test')).toBe(false);
  });
});

describe('getting about', () => {
  it('goTo modes: on foot, in a vehicle, in a particular vehicle, stopped', () => {
    const s = setup([
      mission([
        { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'temuka-pub', wait: true },
        { kind: 'spawnVehicle', as: 'van', spec: 'van', at: { place: 'temuka-pub', forward: 10 }, wait: true },
        { kind: 'goTo', to: 'rangitata-layby', radius: 10, mode: 'vehicle', vehicle: 'ute', stop: true },
        { kind: 'goTo', to: { place: 'rangitata-layby', forward: 30 }, radius: 3, mode: 'foot' },
      ]),
    ]);
    s.fake.moveTo(10, 4195);
    s.runner.start('test');
    s.tick();
    const run = s.runner.run!;
    const ute = run.vehicle('ute')!;
    const van = run.vehicle('van')!;
    // On foot: no.
    s.fake.moveTo(12, 2900);
    s.tick();
    expect(run.stepIndex).toBe(2);
    // Wrong vehicle: no.
    s.fake.drive(van);
    s.fake.moveTo(12, 2900);
    s.tick();
    expect(run.stepIndex).toBe(2);
    // Right vehicle but still rolling: no.
    s.fake.getOut();
    s.fake.drive(ute);
    s.fake.moveTo(12, 2900);
    (ute as unknown as FakeVehicle).speed = 9;
    s.tick();
    expect(run.stepIndex).toBe(2);
    (ute as unknown as FakeVehicle).speed = 0.5;
    s.tick();
    expect(run.stepIndex).toBe(3);
    // Next one must be on foot.
    s.fake.moveTo(12, 2930);
    s.tick();
    expect(run.stepIndex).toBe(3);
    s.fake.getOut();
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
  });

  it('enterVehicle accepts any vehicle of a spec or class and points at the nearest one', () => {
    const s = setup([mission([{ kind: 'enterVehicle', cls: ['ute', 'truck'], objective: 'Find a ute' }, { kind: 'enterVehicle', spec: 'coupe' }])]);
    s.fake.moveTo(10, 4200);
    const sedan = s.fake.vehicles.spawn('statesman', 14, 4200, 0)!;
    const ute = s.fake.vehicles.spawn('ute', 60, 4200, 0)!;
    const coupe = s.fake.vehicles.spawn('coupe', 90, 4200, 0)!;
    s.runner.start('test');
    s.tick();
    expect(s.fake.ui.blips.get('m:vehicle')?.follow).toBe(ute);
    s.fake.drive(sedan);
    s.tick();
    expect(s.runner.run!.stepIndex).toBe(0);
    s.fake.getOut();
    s.fake.drive(ute);
    s.tick();
    expect(s.runner.run!.stepIndex).toBe(1);
    s.fake.getOut();
    s.fake.drive(coupe);
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
  });

  it('deliverVehicle: get-back-in objective, clean arrival, and a handover that takes the vehicle away', async () => {
    const s = setup([
      mission([
        { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'temuka-pub', wait: true },
        { kind: 'deliverVehicle', vehicle: 'ute', to: 'rangitata-layby', radius: 10, clean: true, handover: true, objective: 'Take it to the lay-by', returnObjective: 'Get back in', cleanObjective: 'Lose them first' },
        { kind: 'wait', seconds: 5 },
      ]),
    ]);
    s.fake.moveTo(10, 4195);
    s.runner.start('test');
    s.tick();
    const run = s.runner.run!;
    const ute = run.vehicle('ute')!;
    expect(s.fake.ui.objectiveText).toBe('Get back in');
    expect(s.fake.ui.blips.get('m:goal')).toMatchObject({ kind: 'vehicle' });
    s.fake.drive(ute);
    s.tick();
    expect(s.fake.ui.objectiveText).toBe('Take it to the lay-by');
    expect(s.fake.ui.blips.get('m:goal')).toMatchObject({ kind: 'objective', x: 12, z: 2900 });
    // There, but with the police in tow.
    s.fake.police.level = 2;
    s.fake.moveTo(12, 2900);
    s.tick();
    expect(run.stepIndex).toBe(1);
    expect(s.fake.ui.objectiveText).toBe('Lose them first');
    s.fake.police.level = 0;
    s.tick();
    // Handing over: frozen, fading out.
    expect(run.stepIndex).toBe(1);
    expect(s.fake.player.controlsEnabled).toBe(false);
    expect(s.fake.ui.fades).toEqual([true]);
    await flush();
    s.tick();
    expect(run.stepIndex).toBe(2);
    expect(s.fake.player.vehicle).toBeNull();
    expect(s.fake.player.controlsEnabled).toBe(true);
    expect(s.fake.ui.fades).toEqual([true, false]);
    expect(s.fake.vehicles.all).not.toContain(ute);
    expect(run.vehicle('ute')).toBeNull();
  });

  it('setTime jumps the clock forward under a fade, unless it is already the right time of day', async () => {
    const night: Step = { kind: 'setTime', hour: 22, unlessBetween: [20.5, 4.5], fade: true };
    const s = setup([mission([night, { kind: 'wait', seconds: 1 }])]);
    s.fake.clock.hour = 14;
    s.runner.start('test');
    s.tick();
    expect(s.fake.clock.hour).toBe(14);
    expect(s.fake.player.controlsEnabled).toBe(false);
    await flush();
    s.tick();
    expect(s.fake.clock.hour).toBe(22);
    expect(s.fake.clock.day).toBe(1);
    expect(s.fake.player.controlsEnabled).toBe(true);
    expect(s.fake.ui.fades).toEqual([true, false]);

    const late = setup([mission([night, { kind: 'wait', seconds: 1 }])]);
    late.fake.clock.hour = 2;
    late.runner.start('test');
    late.tick();
    expect(late.fake.clock.hour).toBe(2);
    expect(late.fake.ui.fades).toEqual([]);

    // Never backwards: an earlier hour means tomorrow.
    const wrap = setup([mission([{ kind: 'setTime', hour: 6 }])]);
    wrap.fake.clock.hour = 20;
    wrap.runner.start('test');
    wrap.tick();
    expect(wrap.fake.clock.hour).toBe(6);
    expect(wrap.fake.clock.day).toBe(2);
  });
});

describe('trouble', () => {
  it('eliminate counts down, follows the living with blips and wants vehicles destroyed', () => {
    const s = setup([
      mission([
        { kind: 'spawnPeds', peds: [{ as: 'a', at: { place: 'temuka-pub', forward: 6 }, behaviour: 'attack' }, { as: 'b', at: { place: 'temuka-pub', forward: -6 }, behaviour: 'attack' }], wait: true },
        { kind: 'spawnVehicle', as: 'van', spec: 'van', at: { place: 'temuka-pub', left: 8 }, wait: true },
        { kind: 'eliminate', targets: ['a', 'b', 'van'], objective: 'Sort them out ({n} left)' },
      ]),
    ]);
    s.fake.moveTo(10, 4200);
    s.runner.start('test');
    s.tick();
    expect(s.fake.ui.objectiveText).toBe('Sort them out (3 left)');
    expect([...s.fake.ui.blips.keys()].sort()).toEqual(['m:a', 'm:b', 'm:van']);
    (s.fake.peds.all[0] as FakePed).kill();
    s.tick();
    expect(s.fake.ui.objectiveText).toBe('Sort them out (2 left)');
    expect(s.fake.ui.blips.has('m:a')).toBe(false);
    (s.fake.peds.all[1] as FakePed).kill();
    s.runner.run!.vehicle('van')!.destroyed = true;
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
  });

  it('a target that has fallen out of the world does not hold the mission up', () => {
    const s = setup([mission([{ kind: 'spawnPeds', peds: [{ as: 'a', at: 'temuka-pub', behaviour: 'attack' }], wait: true }, { kind: 'eliminate', targets: ['a'] }])]);
    s.fake.moveTo(10, 4190);
    s.runner.start('test');
    s.tick();
    expect(s.runner.run).not.toBeNull();
    s.fake.peds.all[0].position.y = -80;
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
    expect(s.fake.peds.all[0].removed).toBe(true);
  });

  it('setBehaviour turns a waiting crew on the player', () => {
    const s = setup([
      mission([
        { kind: 'spawnPeds', peds: [{ as: 'a', at: 'temuka-pub', behaviour: 'stand', weapon: 'bat', kind: 'gang' }], wait: true },
        { kind: 'wait', seconds: 1 },
        { kind: 'setBehaviour', peds: ['a'], behaviour: 'attack' },
        { kind: 'eliminate', targets: ['a'] },
      ]),
    ]);
    s.fake.moveTo(10, 4200);
    s.runner.start('test');
    s.tick();
    const ped = s.fake.peds.all[0] as FakePed;
    expect(ped.behaviour).toBe('stand');
    s.tick(1.1);
    expect(ped.behaviour).toBe('attack');
    // …and a survivor is sent packing when the mission ends.
    s.runner.abort();
    expect(ped.behaviour).toBe('flee');
  });

  it('a waiting crew does not wait once it is shot at, or shot near; bystanders are left out of it', () => {
    const crewAt = (): MissionDef =>
      mission([
        {
          kind: 'spawnPeds',
          peds: [
            { as: 'a', at: { place: 'temuka-pub', forward: 5 }, behaviour: 'stand', weapon: 'pistol', kind: 'gang' },
            { as: 'b', at: { place: 'temuka-pub', forward: -5 }, behaviour: 'stand', weapon: 'bat', kind: 'gang' },
            { as: 'far', at: { place: 'temuka-pub', forward: 200 }, behaviour: 'stand', weapon: 'bat', kind: 'gang' },
            { as: 'shona', at: { place: 'temuka-pub', left: 6 }, behaviour: 'stand', name: 'Shona' },
          ],
          activate: 400,
          wait: true,
        },
        { kind: 'wait', seconds: 60 },
      ]);
    const byName = (s: ReturnType<typeof setup>, name: string) => s.runner.run!.ped(name) as unknown as FakePed;

    const hurt = setup([crewAt()]);
    hurt.fake.moveTo(10, 4150);
    hurt.runner.start('test');
    hurt.tick();
    hurt.fake.events.emit('actorDamaged', { actor: byName(hurt, 'a') as never, info: { amount: 20, kind: 'bullet' } });
    expect(byName(hurt, 'a').behaviour).toBe('stand'); // noted, not acted on inside the event
    hurt.tick();
    expect(byName(hurt, 'a').behaviour).toBe('attack');
    expect(byName(hurt, 'b').behaviour).toBe('attack');
    expect(byName(hurt, 'far').behaviour).toBe('stand');
    expect(byName(hurt, 'shona').behaviour).toBe('stand');

    const shot = setup([crewAt()]);
    shot.fake.moveTo(10, 4150);
    shot.runner.start('test');
    shot.tick();
    const fire = (shooter: unknown, x: number, z: number) => shot.fake.events.emit('gunshot', { shooter, weaponId: 'pistol', position: { x, y: 1, z }, direction: { x: 0, y: 0, z: 1 } } as never);
    fire(shot.fake.player, 10, 4000); // out of earshot
    fire(byName(shot, 'far'), 10, 4190); // not the player
    shot.tick();
    expect(byName(shot, 'a').behaviour).toBe('stand');
    fire(shot.fake.player, 10, 4170);
    shot.tick();
    expect(byName(shot, 'a').behaviour).toBe('attack');
    expect(byName(shot, 'b').behaviour).toBe('attack');
    expect(byName(shot, 'shona').behaviour).toBe('stand');
  });

  it('loseHeat: raises heat, holds it, wants the player back in the vehicle, then ends at zero stars', () => {
    const s = setup([
      mission([
        { kind: 'spawnVehicle', as: 'truck', spec: 'farmtruck', at: 'temuka-pub', wait: true },
        { kind: 'loseHeat', vehicle: 'truck', atLeast: 2, holdFor: 5, objective: 'Lose them', returnObjective: 'Back in the truck' },
      ]),
    ]);
    s.fake.moveTo(10, 4195);
    s.runner.start('test');
    s.tick();
    const truck = s.runner.run!.vehicle('truck')!;
    expect(s.fake.police.level).toBe(2);
    expect(s.fake.ui.objectiveText).toBe('Back in the truck');
    s.fake.drive(truck);
    s.tick();
    expect(s.fake.ui.objectiveText).toBe('Lose them');
    // Cannot be shaken yet.
    s.fake.police.level = 0;
    s.tick(1);
    expect(s.fake.police.level).toBe(2);
    expect(s.runner.run).not.toBeNull();
    s.tick(4.5);
    s.fake.police.level = 0;
    s.fake.getOut();
    s.tick(1);
    // Lost them, but on foot: not yet.
    expect(s.runner.run).not.toBeNull();
    s.fake.drive(truck);
    s.tick();
    expect(s.runner.done.has('test')).toBe(true);
  });

  it('loseHeat passes straight through when nobody is after the player', () => {
    const s = setup([mission([{ kind: 'loseHeat', objective: 'Lose them' }])]);
    s.runner.start('test');
    s.tick(0.6);
    expect(s.runner.done.has('test')).toBe(true);
  });
});

describe('race', () => {
  const lap = (): MissionDef =>
    mission([
      {
        kind: 'race',
        grid: { place: 'four-aves-start', snap: 'lane', road: 'moorhouse', toward: { junction: ['moorhouse', 'fitzgerald'] }, along: 40 },
        checkpoints: [
          { junction: ['moorhouse', 'fitzgerald'], place: 'four-aves-start', dx: 1250, snap: 'node' },
          { junction: ['fitzgerald', 'bealey'], place: 'four-aves-start', dx: 1250, dz: -1250, snap: 'node' },
          { junction: ['bealey', ['harper', 'deans']], place: 'four-aves-start', dz: -1250, snap: 'node' },
          { place: 'four-aves-start', snap: 'node' },
        ],
        rivals: [
          { as: 'skids', spec: 'v8sedan', name: 'Skids', aggression: 1.8, cruiseSpeed: 37 },
          { as: 'tama', spec: 'coupe', name: 'Tama' },
          { as: 'tracey', spec: 'hatch', name: 'Tracey' },
        ],
        countdown: 3,
        parSpeed: 25,
        police: { suspend: true },
        objective: 'Win the lap',
      },
    ]);
  const CORNERS: [number, number][] = [
    [1000, 0],
    [1000, -1000],
    [0, -1000],
    [0, 0],
  ];

  function onTheGrid(options?: FakeOptions) {
    const s = setup([lap()], options);
    const car = s.fake.vehicles.spawn('v8sedan', 40, -5.25, Math.PI / 2)!;
    s.fake.drive(car);
    s.runner.start('test');
    s.tick();
    return s;
  }

  it('lines the field up, counts down with the player frozen, then lets everyone go', () => {
    const s = onTheGrid();
    const run = s.runner.run!;
    const rivals = ['skids', 'tama', 'tracey'].map((name) => run.vehicle(name)!);
    expect(rivals.every(Boolean)).toBe(true);
    // Facing east along Moorhouse in the eastbound lanes (to the left of travel: the north side), none of
    // them on top of the player.
    for (const v of rivals) {
      expect(v.heading).toBeCloseTo(Math.PI / 2);
      expect(v.position.z).toBeLessThan(0);
      expect(v.position.distanceTo(s.fake.player.position)).toBeGreaterThan(3);
      expect(v.controller).toBe('mission');
      expect(v.tags.has('racer')).toBe(true);
    }
    expect(new Set(rivals.map((v) => `${v.position.x.toFixed(1)},${v.position.z.toFixed(1)}`)).size).toBe(3);
    expect(s.fake.traffic.autopilots[0].cruiseSpeed).toBe(37);
    expect(s.fake.traffic.autopilots[0].aggression).toBe(1.8);

    expect(s.fake.player.controlsEnabled).toBe(false);
    expect(s.fake.police.enabled).toBe(false);
    expect(s.fake.ui.banners.at(-1)?.title).toBe('3');
    expect(s.fake.traffic.autopilots.every((ap) => ap.updates === 0)).toBe(true);
    expect(s.fake.ui.blips.get('m:goal')).toMatchObject({ x: 1000, z: 0 });
    expect(s.fake.ui.objectiveText).toContain('checkpoint 1/4');

    s.tick(3.1);
    expect(s.fake.ui.banners.at(-1)?.title).toBe('Go!');
    expect(s.fake.player.controlsEnabled).toBe(true);
    expect(s.fake.traffic.autopilots.every((ap) => ap.updates > 0)).toBe(true);
    expect(rivals[0].position.x).toBeGreaterThan(40);
  });

  it('moves a rival back a row rather than spawn it on top of traffic', () => {
    const s = setup([lap()]);
    const car = s.fake.vehicles.spawn('v8sedan', 40, -5.25, Math.PI / 2)!;
    // Somebody sitting in the outside lane right where the first rival would go.
    const inTheWay = s.fake.vehicles.spawn('bus', 40, -1.75, Math.PI / 2)!;
    s.fake.drive(car);
    s.runner.start('test');
    s.tick();
    const rivals = ['skids', 'tama', 'tracey'].map((name) => s.runner.run!.vehicle(name)!);
    const all = [car, inTheWay, ...rivals];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const dx = Math.abs(all[i].position.x - all[j].position.x);
        const dz = Math.abs(all[i].position.z - all[j].position.z);
        expect(dx > 6 || dz > 2.4, `${i} and ${j} overlap`).toBe(true);
      }
    }
  });

  it('first through the last checkpoint wins', () => {
    const s = onTheGrid();
    s.fake.traffic.aiSpeed = 15;
    s.tick(3.1);
    for (const [i, [x, z]] of CORNERS.entries()) {
      s.fake.moveTo(x, z);
      s.tick();
      if (i < 3) {
        expect(s.runner.run).not.toBeNull();
        expect(s.fake.ui.objectiveText).toContain(`checkpoint ${i + 2}/4`);
        expect(s.fake.ui.objectiveText).toContain('1st of 4');
        expect(s.fake.ui.blips.get('m:goal')).toMatchObject({ x: CORNERS[i + 1][0], z: CORNERS[i + 1][1] });
      }
    }
    expect(s.runner.done.has('test')).toBe(true);
    expect(s.fake.police.enabled).toBe(true);
    expect(s.fake.traffic.autopilots.every((ap) => ap.stopped)).toBe(true);
  });

  it('checkpoints only count in order, and from a vehicle', () => {
    const s = onTheGrid();
    s.fake.traffic.aiSpeed = 0;
    s.tick(3.1);
    s.fake.moveTo(1000, -1000); // second corner first: no
    s.tick();
    expect(s.fake.ui.objectiveText).toContain('checkpoint 1/4');
    const car = s.fake.player.vehicle!;
    s.fake.getOut();
    s.fake.moveTo(1000, 0); // right corner, on foot: no
    s.tick();
    expect(s.fake.ui.objectiveText).toContain('checkpoint 1/4');
    s.fake.drive(car);
    s.fake.moveTo(1000, 0);
    s.tick();
    expect(s.fake.ui.objectiveText).toContain('checkpoint 2/4');
  });

  it('a rival home first loses it, and the place readout tracks the field', () => {
    const s = onTheGrid();
    s.fake.traffic.aiSpeed = 60;
    s.tick(3.1);
    s.tick(5);
    expect(s.fake.ui.objectiveText).toContain('4th of 4');
    s.tick(70, 0.05);
    expect(s.runner.run).toBeNull();
    const last = s.log.at(-1)!;
    expect(last.type).toBe('missionFailed');
    expect((last.payload as { reason: string }).reason).toMatch(/took the flag/);
    expect(s.runner.list()[0].state).toBe('available');
  });

  it('without traffic AI it becomes a lap against the clock', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = onTheGrid({ traffic: false });
    expect(s.fake.vehicles.all).toHaveLength(1); // nothing left behind by the failed rival spawns
    s.tick(3.1);
    // 3,960 m of course at 25 m/s, plus a little grace.
    expect(s.fake.ui.timerLabel).toBe('Par');
    expect(s.fake.ui.timerSeconds).toBeGreaterThan(150);
    expect(s.fake.ui.timerSeconds).toBeLessThan(175);
    expect(s.fake.ui.objectiveText).not.toContain(' of ');
    for (const [x, z] of CORNERS) {
      s.fake.moveTo(x, z);
      s.tick();
    }
    expect(s.runner.done.has('test')).toBe(true);

    const slow = onTheGrid({ traffic: false });
    slow.tick(3.1);
    slow.tick(180, 0.25);
    expect((slow.log.at(-1)!.payload as { reason: string }).reason).toBe('Too slow');
  });
});

describe('chase', () => {
  const pursuit = (): MissionDef =>
    mission([
      { kind: 'spawnVehicle', as: 'van', spec: 'van', at: { place: 'sign-of-the-kiwi', snap: 'lane', toward: 'lyttelton-wharf', along: 30 }, ai: { aggression: 1.7, cruiseSpeed: 24 }, wait: true },
      { kind: 'chase', target: 'van', to: 'lyttelton-wharf', maxDistance: 300, grace: 3, arriveRadius: 60, objective: 'Stay on the van', lostReason: 'Lost it' },
      { kind: 'wait', seconds: 1 },
    ]);

  it('the target drives for its destination; staying close until it arrives completes the step', () => {
    const s = setup([pursuit()]);
    s.fake.moveTo(1505, 805);
    s.runner.start('test');
    s.tick();
    const van = s.runner.run!.vehicle('van')!;
    const start = van.position.clone();
    expect(s.fake.ui.blips.get('m:target')).toMatchObject({ kind: 'enemy' });
    for (let t = 0; t < 60 && s.runner.run!.stepIndex === 1; t += 0.1) {
      s.fake.moveTo(van.position.x - 20, van.position.z - 20);
      s.tick(0.1, 0.1);
    }
    expect(van.position.distanceTo(start)).toBeGreaterThan(500);
    expect(s.runner.run!.stepIndex).toBe(2);
    expect(s.fake.traffic.autopilots[0].stopped).toBe(true);
  });

  it('falling too far behind for too long loses it', () => {
    const s = setup([pursuit()]);
    s.fake.moveTo(1505, 805);
    s.runner.start('test');
    s.tick();
    s.tick(14, 0.1); // the van pulls 280 m clear
    expect(s.runner.run).not.toBeNull();
    s.tick(6, 0.1);
    expect((s.log.at(-1)!.payload as { reason: string }).reason).toBe('Lost it');
  });

  it('wrecking the target, or beating it there, also ends the chase', () => {
    const wrecked = setup([pursuit()]);
    wrecked.fake.moveTo(1505, 805);
    wrecked.runner.start('test');
    wrecked.tick();
    wrecked.runner.run!.vehicle('van')!.destroyed = true;
    wrecked.tick();
    expect(wrecked.runner.run!.stepIndex).toBe(2);

    const beaten = setup([pursuit()]);
    beaten.fake.traffic.aiSpeed = 1;
    beaten.fake.moveTo(1505, 805);
    beaten.runner.start('test');
    beaten.tick();
    beaten.fake.moveTo(1990, 1490);
    beaten.tick();
    expect(beaten.runner.run!.stepIndex).toBe(2);
  });

  it('with no traffic AI there is nothing to chase and the story carries on', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup([pursuit()], { traffic: false });
    s.fake.moveTo(1505, 805);
    s.runner.start('test');
    s.tick();
    expect(s.runner.run!.stepIndex).toBe(2);
    expect(s.fake.vehicles.all).toHaveLength(0);
  });
});

describe('unlock chain and save', () => {
  const chain = (): MissionDef[] => [
    mission([{ kind: 'wait', seconds: 1 }], { id: 'one' }),
    mission([{ kind: 'wait', seconds: 1 }], { id: 'two', requires: ['one'], placeId: 'temuka-pub' }),
    mission([{ kind: 'wait', seconds: 1 }], { id: 'three', requires: ['two'], placeId: 'chch-garage', finale: true }),
  ];
  const states = (runner: MissionRunner) => runner.list().map((m) => m.state);

  it('each mission unlocks the next; only one runs at a time', () => {
    const s = setup(chain());
    expect(states(s.runner)).toEqual(['available', 'locked', 'locked']);
    expect(s.runner.start('two')).toBe(false);
    expect(s.runner.start('nope')).toBe(false);
    expect(s.runner.start('one')).toBe(true);
    expect(s.runner.start('one')).toBe(false);
    expect(states(s.runner)).toEqual(['active', 'locked', 'locked']);
    s.tick(1.1);
    expect(states(s.runner)).toEqual(['done', 'available', 'locked']);
    expect(s.runner.start('one')).toBe(false); // done is done
    s.runner.start('two');
    s.tick(1.1);
    expect(states(s.runner)).toEqual(['done', 'done', 'available']);
    expect(s.runner.completed).toBe(false);
    s.runner.start('three');
    s.tick(1.1);
    expect(states(s.runner)).toEqual(['done', 'done', 'done']);
    expect(s.runner.completed).toBe(true);
    expect(s.fake.player.money).toBe(300);
  });

  it('summaries carry the definition and stay the same objects', () => {
    const s = setup(chain());
    const before = s.runner.list();
    expect(before[1]).toEqual({ id: 'two', title: 'Test Job', giver: 'Tester', blurb: 'A test.', reward: 100, state: 'locked', placeId: 'temuka-pub' });
    s.runner.start('one');
    expect(s.runner.list()).toBe(before);
    expect(s.runner.active).toBe(before[0]);
  });

  it('a mission whose places are missing is disabled with one warning and does not block the chain', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup(chain(), { places: ['timaru-chipshop', 'chch-garage'] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('two (temuka-pub)');
    expect(states(s.runner)).toEqual(['available', 'locked', 'locked']);
    expect(s.runner.start('two')).toBe(false);
    s.runner.start('one');
    s.tick(1.1);
    expect(states(s.runner)).toEqual(['done', 'locked', 'available']);
  });

  it('round-trips through the save file', () => {
    const a = setup(chain());
    a.fake.save.register('missions', () => a.runner.serialize(), (d) => a.runner.deserialize(d));
    a.runner.start('one');
    a.tick(1.1);
    a.runner.start('two');
    a.tick(1.1);
    expect(a.fake.save.saves).toBe(2);
    const stored = a.fake.save.stored!;
    expect(stored.missions).toEqual({ v: 1, done: ['one', 'two'], completed: false });

    const b = setup(chain());
    b.runner.deserialize(stored.missions);
    expect(states(b.runner)).toEqual(['done', 'done', 'available']);
    expect(b.runner.completed).toBe(false);
    b.runner.start('three');
    b.tick(1.1);
    expect(b.runner.serialize()).toEqual({ v: 1, done: ['one', 'two', 'three'], completed: true });
  });

  it('tolerates a missing or mangled save slice, and unknown mission ids', () => {
    const s = setup(chain());
    for (const junk of [null, undefined, 7, 'x', [], { done: 'one' }, { done: [1, null, 'ghost', 'one'], completed: 'yes' }]) {
      expect(() => s.runner.deserialize(junk)).not.toThrow();
    }
    expect(states(s.runner)).toEqual(['done', 'available', 'locked']);
    expect(s.runner.completed).toBe(false);
  });

  it('loading drops a running mission without ceremony', () => {
    const s = setup([mission([{ kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'timaru-chipshop', wait: true }, { kind: 'wait', seconds: 60, police: { suspend: true } }])]);
    s.fake.moveTo(10, 5900);
    s.runner.start('test');
    s.tick();
    expect(s.fake.vehicles.all).toHaveLength(1);
    s.runner.deserialize({ v: 1, done: [], completed: false });
    expect(s.runner.run).toBeNull();
    expect(s.fake.vehicles.all).toHaveLength(0);
    expect(s.fake.police.enabled).toBe(true);
    expect(s.log.some((e) => e.type === 'missionFailed')).toBe(false);
    expect(s.runner.list()[0].state).toBe('available');
  });

  it('tells its owner when anything changes', () => {
    const s = setup(chain());
    let changes = 0;
    s.runner.onChange = () => changes++;
    s.runner.start('one');
    expect(changes).toBe(1);
    s.tick(1.1);
    expect(changes).toBe(2);
    s.runner.deserialize(null);
    expect(changes).toBe(3);
  });
});

describe('checkpoints and retries', () => {
  const checkpointed = (): MissionDef[] => [
    mission(
      [
        { kind: 'giveWeapon', weapon: 'pistol', ammo: 12 },
        { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'smithfield-carpark' },
        { kind: 'enterVehicle', vehicle: 'ute' },
        { kind: 'checkpoint', label: 'the works', at: 'smithfield-carpark' },
        { kind: 'spawnPeds', peds: [{ as: 'goon1', at: 'timaru-port-lockup', behaviour: 'attack', weapon: 'bat' }] },
        { kind: 'eliminate', targets: ['goon1'] },
        { kind: 'checkpoint', label: 'the lock-up', at: 'timaru-port-lockup' },
        { kind: 'deliverVehicle', vehicle: 'ute', to: 'timaru-port-lockup', radius: 8 },
      ],
      { failIf: [{ kind: 'vehicleDestroyed', vehicle: 'ute' }] },
    ),
  ];

  it('records the last checkpoint passed and offers it with the failure', () => {
    const s = setup(checkpointed());
    s.fake.moveTo(40, 5400);
    s.runner.start('test');
    s.tick();
    const run = s.runner.run!;
    expect(run.reached).toBeNull();
    s.fake.drive(run.vehicle('ute')!);
    s.tick();
    expect(run.reached).toMatchObject({ index: 3, label: 'the works' });
    run.vehicle('ute')!.applyDamage(9999, null as never);
    s.tick();
    expect(s.runner.run).toBeNull();
    expect(s.runner.retry).toMatchObject({ id: 'test', resume: { index: 3, label: 'the works' } });
  });

  it('failing before any checkpoint offers a retry from the start', () => {
    const s = setup(checkpointed());
    s.fake.moveTo(40, 5400);
    s.runner.start('test');
    s.tick();
    s.runner.run!.vehicle('ute')!.applyDamage(9999, null as never);
    s.tick();
    expect(s.runner.retry).toEqual({ id: 'test', resume: null });
  });

  it('a retry resumes after the checkpoint: set-up replayed, the ride waiting beside the player', () => {
    const s = setup(checkpointed());
    s.fake.moveTo(40, 5400);
    expect(s.runner.start('test', { index: 3, label: 'the works', at: 'smithfield-carpark' })).toBe(true);
    s.tick();
    const run = s.runner.run!;
    // Past the checkpoint, on the eliminate (the spawn steps replayed silently).
    expect(run.stepIndex).toBe(5);
    expect(run.reached).toMatchObject({ index: 3, label: 'the works' });
    expect(s.fake.combat.given).toContainEqual({ id: 'pistol', ammo: 12 });
    // The ute reappears by the checkpoint with the player back at its wheel.
    const ute = run.vehicle('ute')!;
    expect(Math.hypot(ute.position.x - 40, ute.position.z - 5400)).toBeLessThan(60);
    expect(s.fake.player.vehicle).toBe(ute);
    // Starting any run clears the standing retry.
    expect(s.runner.retry).toBeNull();
  });

  it('enemies dealt with before the checkpoint stay dealt with', () => {
    const s = setup(checkpointed());
    s.fake.moveTo(45, 5990);
    s.runner.start('test', { index: 6, label: 'the lock-up', at: 'timaru-port-lockup' });
    s.tick();
    const run = s.runner.run!;
    expect(run.stepIndex).toBe(7); // straight onto the delivery
    expect(run.entity('goon1')).toBeNull();
    expect(run.vehicle('ute')).not.toBeNull();
  });

  it('a vehicle handed over before the checkpoint stays handed over', () => {
    const s = setup([
      mission(
        [
          { kind: 'spawnVehicle', as: 'truck', spec: 'farmtruck', at: 'smithfield-carpark' },
          { kind: 'enterVehicle', vehicle: 'truck' },
          { kind: 'deliverVehicle', vehicle: 'truck', to: 'timaru-port-lockup', radius: 8, handover: true },
          { kind: 'checkpoint', label: 'the yard', at: 'timaru-port-lockup' },
          { kind: 'spawnPeds', peds: [{ as: 'goon1', at: 'timaru-port-lockup', behaviour: 'attack', weapon: 'bat' }] },
          { kind: 'eliminate', targets: ['goon1'] },
        ],
        { failIf: [{ kind: 'vehicleDestroyed', vehicle: 'truck' }] },
      ),
    ]);
    s.fake.moveTo(45, 5990);
    s.runner.start('test', { index: 3, label: 'the yard', at: 'timaru-port-lockup' });
    s.tick();
    const run = s.runner.run!;
    // The shed door already came down on the truck: the retry starts on foot, nothing respawned to shoot.
    expect(run.stepIndex).toBe(5);
    expect(run.vehicle('truck')).toBeNull();
    expect(s.fake.player.vehicle).toBeNull();
  });

  it('a load clears the retry', () => {
    const s = setup(checkpointed());
    s.fake.moveTo(40, 5400);
    s.runner.start('test');
    s.tick();
    s.runner.run!.vehicle('ute')!.applyDamage(9999, null as never);
    s.tick();
    expect(s.runner.retry).not.toBeNull();
    s.runner.deserialize(null);
    expect(s.runner.retry).toBeNull();
  });
});
