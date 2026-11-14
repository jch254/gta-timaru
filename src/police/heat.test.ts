import { describe, expect, it } from 'vitest';
import type { CrimeType } from '../core/types';
import { COP_SIGHT_SCALE, CRIME_RULES, EVADE_SECONDS, HeatModel, IDLE_DECAY_DELAY, MAX_LEVEL, judgeWitnesses, witnessRange, type WitnessCandidate } from './heat';

/** A model that records every level change. */
function tracked() {
  const model = new HeatModel();
  const changes: [level: number, previous: number][] = [];
  model.onLevelChanged = (level, previous) => changes.push([level, previous]);
  return { model, changes };
}

/** Run the clock in 60 Hz steps. */
function run(model: HeatModel, seconds: number, seen = false, fleeing = false) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) model.update(dt, seen, fleeing);
}

describe('witnesses', () => {
  const theft = CRIME_RULES.carTheft;
  const gunfire = CRIME_RULES.gunfire;
  const reckless = CRIME_RULES.recklessDriving;

  it('needs line of sight inside the sight radius, and police see further', () => {
    expect(witnessRange(theft, 'ped', theft.sightRadius - 1)).toBe(1);
    expect(witnessRange(theft, 'ped', theft.sightRadius + 1)).toBe(0);
    expect(witnessRange(theft, 'cop', theft.sightRadius + 1)).toBe(1);
    expect(witnessRange(theft, 'cop', theft.sightRadius * COP_SIGHT_SCALE + 1)).toBe(0);
  });

  it('gunfire is heard well beyond sight, with no line of sight needed', () => {
    expect(gunfire.hearRadius).toBeGreaterThan(gunfire.sightRadius);
    expect(witnessRange(gunfire, 'ped', gunfire.hearRadius - 1)).toBe(2);
    const behindAWall: WitnessCandidate[] = [{ kind: 'ped', distance: 70 }];
    expect(judgeWitnesses(gunfire, behindAWall, () => false)).toBe('ped');
  });

  it('a crime nobody can see is not witnessed', () => {
    const crowd: WitnessCandidate[] = [
      { kind: 'ped', distance: 5 },
      { kind: 'cop', distance: 10 },
    ];
    expect(judgeWitnesses(theft, crowd, () => false)).toBe('none');
    expect(judgeWitnesses(theft, [], () => true)).toBe('none');
    expect(judgeWitnesses(theft, [{ kind: 'ped', distance: 500 }], () => true)).toBe('none');
  });

  it('a constable who saw it outranks a member of the public', () => {
    const crowd: WitnessCandidate[] = [
      { kind: 'ped', distance: 5 },
      { kind: 'cop', distance: 25 },
    ];
    expect(judgeWitnesses(theft, crowd, () => true)).toBe('cop');
    expect(judgeWitnesses(theft, crowd, (c) => c.kind === 'ped')).toBe('ped');
  });

  it('only the police care about traffic offences', () => {
    expect(witnessRange(reckless, 'ped', 5)).toBe(0);
    expect(judgeWitnesses(reckless, [{ kind: 'ped', distance: 5 }], () => true)).toBe('none');
    expect(judgeWitnesses(reckless, [{ kind: 'cop', distance: 20 }], () => true)).toBe('cop');
  });

  it('crimes against the police always count', () => {
    expect(judgeWitnesses(CRIME_RULES.copAssault, [], () => false)).toBe('cop');
    expect(judgeWitnesses(CRIME_RULES.copKilled, [], () => false)).toBe('cop');
  });

  it('rations line-of-sight checks in a crowd', () => {
    const crowd: WitnessCandidate[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'ped' as const, distance: 1 + i }));
    let asked = 0;
    judgeWitnesses(theft, crowd, () => {
      asked++;
      return false;
    });
    expect(asked).toBeLessThanOrEqual(6);
  });
});

describe('crime → heat → level', () => {
  it('an unwitnessed crime adds nothing', () => {
    const { model, changes } = tracked();
    expect(model.report('murder', 'none')).toBe(false);
    expect(model.level).toBe(0);
    expect(model.heat).toBe(0);
    expect(changes).toEqual([]);
  });

  it('car theft is small: it takes a few reports from the public to reach level 1', () => {
    const { model, changes } = tracked();
    model.report('carTheft', 'ped');
    expect(model.level).toBe(0);
    expect(model.heat).toBeGreaterThan(0);
    model.report('carTheft', 'ped');
    expect(model.level).toBe(0);
    model.report('carTheft', 'ped');
    expect(model.level).toBe(1);
    expect(changes).toEqual([[1, 0]]);
  });

  it('…but in front of a constable it counts immediately', () => {
    const { model } = tracked();
    model.report('carTheft', 'cop');
    expect(model.level).toBe(1);
  });

  it('moderate crimes reach level 1 at once or within a couple of reports', () => {
    for (const type of ['carjacking', 'hitAndRun', 'gunfire'] as CrimeType[]) {
      const model = new HeatModel();
      model.report(type, 'ped');
      expect(model.level, type).toBe(1);
    }
    for (const type of ['assault', 'vehicleDamage'] as CrimeType[]) {
      const model = new HeatModel();
      model.report(type, 'ped');
      expect(model.level, type).toBe(0);
      for (let i = 0; i < 4 && model.level === 0; i++) {
        run(model, CRIME_RULES[type].cooldown + 0.1, true);
        model.report(type, 'ped');
      }
      expect(model.level, type).toBe(1);
    }
  });

  it('murder goes straight to at least level 2', () => {
    const { model, changes } = tracked();
    model.report('murder', 'ped');
    expect(model.level).toBe(2);
    expect(changes).toEqual([[2, 0]]);
    model.report('murder', 'ped');
    expect(model.level).toBe(3);
  });

  it('assaulting a constable is at least level 2 and needs no witness', () => {
    const { model } = tracked();
    expect(model.report('copAssault', 'none')).toBe(true);
    expect(model.level).toBe(2);
  });

  it('killing a constable is at least level 3, and each one after that climbs to 5', () => {
    const { model, changes } = tracked();
    model.report('copKilled', 'none');
    expect(model.level).toBe(3);
    model.report('copKilled', 'none');
    expect(model.level).toBe(4);
    model.report('copKilled', 'none');
    expect(model.level).toBe(5);
    model.report('copKilled', 'none');
    model.report('copKilled', 'none');
    expect(model.level).toBe(MAX_LEVEL);
    expect(model.heat).toBeLessThanOrEqual(1);
    expect(changes).toEqual([
      [3, 0],
      [4, 3],
      [5, 4],
    ]);
  });

  it('reckless driving only matters in front of the police, and only a little', () => {
    const { model } = tracked();
    expect(model.report('recklessDriving', 'ped')).toBe(false);
    expect(model.report('recklessDriving', 'cop')).toBe(true);
    expect(model.level).toBe(0);
    for (let i = 0; i < 20; i++) {
      run(model, CRIME_RULES.recklessDriving.cooldown + 0.1, true);
      model.report('recklessDriving', 'cop');
    }
    expect(model.level).toBe(1); // never worse than a look from a patrol car
  });

  it('petty crime cannot escalate past its cap', () => {
    const { model } = tracked();
    for (let i = 0; i < 40; i++) model.report('carTheft', 'cop');
    expect(model.level).toBe(CRIME_RULES.carTheft.cap);
    for (let i = 0; i < 40; i++) {
      run(model, CRIME_RULES.gunfire.cooldown + 0.1, true);
      model.report('gunfire', 'cop');
    }
    expect(model.level).toBe(CRIME_RULES.gunfire.cap);
  });

  it('a crime never lowers the level', () => {
    const { model } = tracked();
    model.setLevel(4);
    model.report('carTheft', 'cop');
    expect(model.level).toBe(4);
  });

  it('per-shot spam inside the cooldown counts once', () => {
    const { model } = tracked();
    expect(model.report('gunfire', 'ped')).toBe(true);
    const heat = model.heat;
    for (let i = 0; i < 10; i++) expect(model.report('gunfire', 'ped')).toBe(false);
    expect(model.ready('gunfire')).toBe(false);
    expect(model.heat).toBe(heat);
    run(model, CRIME_RULES.gunfire.cooldown + 0.1, true);
    expect(model.ready('gunfire')).toBe(true);
    expect(model.report('gunfire', 'ped')).toBe(true);
  });

  it('ignores crimes while the law is suspended', () => {
    const { model } = tracked();
    model.enabled = false;
    expect(model.report('copKilled', 'cop')).toBe(false);
    expect(model.level).toBe(0);
    model.enabled = true;
    expect(model.report('copKilled', 'cop')).toBe(true);
  });

  it('heat below level 1 fades once things have been quiet', () => {
    const { model } = tracked();
    model.report('carTheft', 'ped');
    const heat = model.heat;
    run(model, IDLE_DECAY_DELAY - 0.5);
    expect(model.heat).toBe(heat);
    run(model, 30);
    expect(model.heat).toBe(0);
    expect(model.level).toBe(0);
  });
});

describe('losing heat', () => {
  it('counts down only while unseen, and reports 0 while seen', () => {
    const { model } = tracked();
    model.setLevel(2);
    run(model, 5, true);
    expect(model.evading).toBe(0);
    expect(model.level).toBe(2);
    run(model, 5, false);
    expect(model.evading).toBeCloseTo(EVADE_SECONDS[2] - 5, 1);
  });

  it('being seen resets the countdown', () => {
    const { model } = tracked();
    model.setLevel(2);
    run(model, EVADE_SECONDS[2] - 1, false);
    expect(model.level).toBe(2);
    run(model, 0.5, true);
    run(model, EVADE_SECONDS[2] - 1, false);
    expect(model.level).toBe(2);
    expect(model.evading).toBeCloseTo(1, 1);
  });

  it('reaching zero drops one level and starts again', () => {
    const { model, changes } = tracked();
    model.setLevel(3);
    run(model, EVADE_SECONDS[3] + 0.1, false);
    expect(model.level).toBe(2);
    expect(model.heat).toBe(0);
    expect(model.evading).toBeCloseTo(EVADE_SECONDS[2], 0);
    run(model, EVADE_SECONDS[2] + 0.1, false);
    expect(model.level).toBe(1);
    run(model, EVADE_SECONDS[1] + 0.1, false);
    expect(model.level).toBe(0);
    expect(model.evading).toBe(0);
    expect(changes).toEqual([
      [3, 0],
      [2, 3],
      [1, 2],
      [0, 1],
    ]);
  });

  it('takes longer the hotter it is', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) expect(EVADE_SECONDS[l]).toBeGreaterThan(EVADE_SECONDS[l - 1]);
    expect(EVADE_SECONDS[MAX_LEVEL]).toBe(45);
  });

  it('a fresh report restarts the search', () => {
    const { model } = tracked();
    model.setLevel(1);
    run(model, EVADE_SECONDS[1] - 2, false);
    model.report('assault', 'ped');
    expect(model.level).toBe(1);
    run(model, 0.1, false);
    expect(model.evading).toBeGreaterThan(EVADE_SECONDS[1] - 1);
  });

  it('swapping cars out of sight halves what is left, but not while seen or clean', () => {
    const { model } = tracked();
    expect(model.halveEvade()).toBe(false);
    model.setLevel(2);
    run(model, 1, true);
    expect(model.halveEvade()).toBe(false);
    run(model, 4, false);
    const left = model.evading;
    expect(model.halveEvade()).toBe(true);
    expect(model.evading).toBeCloseTo(left / 2, 5);
    run(model, left / 2 + 0.1, false);
    expect(model.level).toBe(1);
  });

  it('heat within the level drains while unseen and holds while seen', () => {
    const { model } = tracked();
    model.setLevel(2);
    model.addHeat(0.8);
    run(model, 3, true, false);
    expect(model.heat).toBeCloseTo(0.8, 5);
    run(model, 5, false);
    expect(model.heat).toBeLessThan(0.8);
    expect(model.level).toBe(2);
  });

  it('running from officers in plain sight slowly makes it worse, up to level 3', () => {
    const { model } = tracked();
    model.setLevel(1);
    run(model, 30, true, false);
    expect(model.level).toBe(1);
    expect(model.heat).toBe(0);
    run(model, 60, true, true);
    expect(model.level).toBe(2);
    run(model, 600, true, true);
    expect(model.level).toBe(3);
  });
});

describe('PoliceApi operations', () => {
  it('setLevel clamps, rounds and announces', () => {
    const { model, changes } = tracked();
    model.setLevel(9);
    expect(model.level).toBe(MAX_LEVEL);
    model.setLevel(-3);
    expect(model.level).toBe(0);
    model.setLevel(2.4);
    expect(model.level).toBe(2);
    model.setLevel(2);
    model.setLevel(Number.NaN);
    expect(model.level).toBe(0);
    expect(changes).toEqual([
      [5, 0],
      [0, 5],
      [2, 0],
      [0, 2],
    ]);
  });

  it('addHeat crosses thresholds in both directions', () => {
    const { model, changes } = tracked();
    model.addHeat(0.6);
    expect(model.level).toBe(0);
    expect(model.heat).toBeCloseTo(0.6, 5);
    model.addHeat(0.6);
    expect(model.level).toBe(1);
    expect(model.heat).toBeCloseTo(0.2, 5);
    model.addHeat(2);
    expect(model.level).toBe(3);
    model.addHeat(-1.5);
    expect(model.level).toBe(1);
    model.addHeat(100);
    expect(model.level).toBe(MAX_LEVEL);
    expect(model.heat).toBe(1);
    model.addHeat(Number.NaN);
    expect(model.level).toBe(MAX_LEVEL);
    expect(changes.map((c) => c[0])).toEqual([1, 3, 1, 5]);
  });

  it('clear wipes everything and announces once', () => {
    const { model, changes } = tracked();
    model.report('copKilled', 'cop');
    run(model, 2, false);
    model.clear();
    expect(model.level).toBe(0);
    expect(model.heat).toBe(0);
    expect(model.evading).toBe(0);
    expect(changes).toEqual([
      [3, 0],
      [0, 3],
    ]);
    model.clear();
    expect(changes.length).toBe(2);
    // Cooldowns are wiped too: the next crime registers straight away.
    model.report('gunfire', 'ped');
    model.clear();
    expect(model.report('gunfire', 'ped')).toBe(true);
  });

  it('level and heat always stay in range', () => {
    const { model } = tracked();
    const types = Object.keys(CRIME_RULES) as CrimeType[];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 4000; i++) {
      const r = rnd();
      if (r < 0.3) model.report(types[Math.floor(rnd() * types.length)], rnd() < 0.5 ? 'cop' : 'ped');
      else if (r < 0.34) model.addHeat(rnd() * 3 - 1.5);
      else if (r < 0.35) model.clear();
      else model.update(rnd() * 0.5, rnd() < 0.5, rnd() < 0.5);
      expect(Number.isInteger(model.level)).toBe(true);
      expect(model.level).toBeGreaterThanOrEqual(0);
      expect(model.level).toBeLessThanOrEqual(MAX_LEVEL);
      expect(model.heat).toBeGreaterThanOrEqual(0);
      expect(model.heat).toBeLessThanOrEqual(1);
      expect(model.evading).toBeGreaterThanOrEqual(0);
      if (model.level === 0) expect(model.evading).toBe(0);
    }
  });
});
