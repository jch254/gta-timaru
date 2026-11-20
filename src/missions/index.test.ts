import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionsApi, System } from '../core/types';
import { createMissions } from './index';
import { clockText, WORLD_PICKUPS } from './services';
import { flush, makeFake, MARAE, type Fake, type FakeOptions } from './testkit';
import { TUNING } from './tuning';

const DT = 1 / 60;
type Missions = MissionsApi & System & { completed: boolean };

async function boot(options?: FakeOptions) {
  const fake = makeFake(options);
  const missions = createMissions(fake.ctx) as Missions;
  fake.ctx.missions = missions;
  await missions.init?.();
  const tick = (seconds = DT, dt = DT) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      fake.ui.promptText = null; // the UI clears the prompt every frame
      missions.update!(dt);
    }
  };
  /** One frame with the interact key pressed, then let the dialog resolve. */
  const interact = async () => {
    fake.input.pressedNow.add('interact');
    tick();
    fake.input.pressedNow.clear();
    await flush();
    tick();
    await flush();
  };
  return { fake, missions, tick, interact };
}

const at = (fake: Fake, id: string) => {
  const place = fake.world.place(id);
  fake.getOut();
  fake.moveTo(place.x + 1, place.z + 1);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('missions system', () => {
  it('keeps its entry point and API', async () => {
    const { missions } = await boot();
    expect(missions.name).toBe('missions');
    expect(missions.list()).toHaveLength(6);
    expect(missions.list().map((m) => m.state)).toEqual(['available', 'locked', 'locked', 'locked', 'locked', 'locked']);
    expect(missions.active).toBeNull();
    expect(missions.start('southerly-change')).toBe(false);
    expect(() => missions.abort()).not.toThrow();
  });

  it('marks the available job with a labelled, pinned blip and a beacon; shops and safehouses with their own', async () => {
    const { fake, tick } = await boot();
    expect(fake.ui.blips.get('mission:severance-pay')).toMatchObject({ kind: 'mission', label: 'R', x: 10, z: 5900, pinned: true });
    expect([...fake.ui.blips.values()].filter((b) => b.kind === 'mission')).toHaveLength(1);
    expect([...fake.ui.blips.values()].filter((b) => b.kind === 'shop').map((b) => b.id).sort()).toEqual(['shop:chch-gunshop', 'shop:timaru-gunshop']);
    expect([...fake.ui.blips.values()].filter((b) => b.kind === 'safehouse').map((b) => b.id).sort()).toEqual(['safehouse:chch-garage', 'safehouse:timaru-chipshop']);
    // The beacon is a mesh in the scene, shown only when the player is in the neighbourhood.
    const beacon = fake.scene.children.find((c) => c.position.x === 10 && c.position.z === 5900)!;
    expect(beacon).toBeDefined();
    fake.moveTo(10, 5900 - TUNING.beaconDistance - 50);
    tick();
    expect(beacon.visible).toBe(false);
    fake.moveTo(10, 5880);
    tick();
    expect(beacon.visible).toBe(true);
  });

  it('offers a job on foot within reach: prompt, then a short choice', async () => {
    const { fake, missions, tick, interact } = await boot();
    fake.moveTo(10, 5900 - 4);
    tick();
    expect(fake.ui.promptText).toBeNull();
    at(fake, 'timaru-chipshop');
    tick();
    expect(fake.ui.promptText).toBe('F  Talk to Aunty Rena');

    // "Not now".
    fake.ui.answer = (_t, options) => options.indexOf('Not now');
    await interact();
    expect(fake.ui.chooses).toHaveLength(1);
    expect(fake.ui.chooses[0].title).toBe('Severance Pay');
    expect(fake.ui.chooses[0].body).toContain('Pays $200.');
    // The chip shop is also a safehouse, so the bed is on the same card.
    expect(fake.ui.chooses[0].options).toEqual(['Take the job', 'Have a kip and save', 'Not now']);
    expect(missions.active).toBeNull();

    // Dismissed (Esc).
    tick(TUNING.interactCooldown + 0.1);
    fake.ui.answer = () => -1;
    await interact();
    expect(missions.active).toBeNull();

    tick(TUNING.interactCooldown + 0.1);
    fake.ui.answer = () => 0;
    await interact();
    expect(missions.active?.id).toBe('severance-pay');
    expect(missions.list()[0].state).toBe('active');
    // One job at a time: the start marker goes away, and standing there offers nothing more.
    expect(fake.ui.blips.has('mission:severance-pay')).toBe(false);
    tick(TUNING.interactCooldown + 0.1);
    fake.ui.promptText = null;
    tick();
    expect(fake.ui.promptText).toBeNull();
  });

  it('does not offer from a driving seat, with a menu open, or next to a car the player could get into', async () => {
    const { fake, tick } = await boot();
    at(fake, 'timaru-chipshop');
    const car = fake.vehicles.spawn('statesman', 12, 5903, 0)!;
    tick();
    expect(fake.ui.promptText).toBeNull();
    car.position.set(40, 5903, 0);
    car.position.z = 5903;
    tick();
    expect(fake.ui.promptText).toBe('F  Talk to Aunty Rena');
    fake.ui.menuOpen = true;
    tick();
    expect(fake.ui.promptText).toBeNull();
    fake.ui.menuOpen = false;
    fake.drive(car);
    fake.moveTo(10, 5900);
    tick();
    expect(fake.ui.promptText).toBeNull();
  });

  it('will not talk business with the police on the player\'s tail', async () => {
    const { fake, missions, tick, interact } = await boot();
    at(fake, 'timaru-chipshop');
    fake.police.level = 1;
    tick();
    expect(fake.ui.promptText).toBe('Lose the police before you talk business');
    fake.ui.answer = () => 0;
    await interact();
    expect(fake.ui.chooses).toHaveLength(0);
    expect(missions.active).toBeNull();
  });

  it('puts the marker back when a job fails', async () => {
    const { fake, missions, tick } = await boot();
    at(fake, 'timaru-chipshop');
    expect(missions.start('severance-pay')).toBe(true);
    tick();
    expect(fake.ui.blips.has('mission:severance-pay')).toBe(false);
    missions.abort();
    expect(fake.ui.blips.has('mission:severance-pay')).toBe(true);
    expect(missions.list()[0].state).toBe('available');
  });

  it('offers another go after a failure; a yes calls off the law and puts the player straight back', async () => {
    const { fake, missions, tick } = await boot();
    at(fake, 'timaru-chipshop');
    missions.start('severance-pay');
    tick(0.1); // the briefing anchors where it began…
    // …so walking out to the works breaks its leash and brings the ute into being; wreck it.
    fake.moveTo(80, 5400);
    tick(1);
    const ute = fake.vehicles.all.find((v) => v.spec.id === 'ute')!;
    ute.applyDamage(9999);
    tick(0.5);
    expect(missions.active).toBeNull();
    // Walk somewhere else; the offer arrives after its grace, and "Go again" is the first option.
    fake.moveTo(400, 5000);
    fake.police.setLevel(1);
    fake.ui.answer = () => 0;
    tick(TUNING.retryDelay + 0.5);
    await flush();
    tick(0.2);
    await flush();
    tick(0.2);
    const offer = fake.ui.chooses.at(-1)!;
    expect(offer.title).toBe('Have another go?');
    expect(offer.options[0]).toBe('Go again');
    // Back at the chip shop (no checkpoint was reached), law flushed off the street, job running again.
    expect(fake.police.flushed).toBeGreaterThan(0);
    expect(Math.hypot(fake.player.position.x - 10, fake.player.position.z - 5900)).toBeLessThan(5);
    expect(missions.active?.id).toBe('severance-pay');
  });

  it('a no lets the matter rest: no second offer', async () => {
    const { fake, missions, tick } = await boot();
    at(fake, 'timaru-chipshop');
    missions.start('severance-pay');
    tick(0.1);
    fake.moveTo(80, 5400);
    tick(1);
    fake.vehicles.all.find((v) => v.spec.id === 'ute')!.applyDamage(9999);
    tick(0.5);
    fake.ui.answer = () => 1;
    tick(TUNING.retryDelay + 0.5);
    await flush();
    tick(0.2);
    const offers = fake.ui.chooses.length;
    expect(offers).toBeGreaterThan(0);
    tick(TUNING.retryDelay + 1);
    await flush();
    expect(fake.ui.chooses.length).toBe(offers);
    expect(missions.active).toBeNull();
  });

  it('nudges a new game towards Aunty Rena, once', async () => {
    const { fake, missions, tick } = await boot();
    fake.moveTo(10, 5905);
    fake.events.emit('playerRespawned', { reason: 'new' });
    tick(TUNING.introDelay - 0.2);
    expect(fake.ui.subtitles).toHaveLength(0);
    tick(0.4);
    expect(fake.ui.subtitles).toHaveLength(1);
    expect(fake.ui.subtitles[0].speaker).toBe('Mack');
    expect(fake.ui.objectiveText).toBe('See Aunty Rena at her chip shop on the Bay Hill');
    tick(12);
    expect(fake.ui.subtitles.length).toBeGreaterThanOrEqual(2);
    // Remembered in the save; a loaded game is not told again.
    fake.save.save();
    expect((fake.save.stored!.missions as { intro: boolean }).intro).toBe(true);
    const again = await boot();
    again.fake.save.stored = fake.save.stored;
    again.fake.save.load();
    again.fake.events.emit('playerRespawned', { reason: 'load' });
    again.tick(5);
    expect(again.fake.ui.subtitles).toHaveLength(0);
    // Starting the job hands the objective line over to the mission.
    at(fake, 'timaru-chipshop');
    missions.start('severance-pay');
    tick();
    expect(fake.ui.objectiveText).not.toBe('See Aunty Rena at her chip shop on the Bay Hill');
  });

  it('points a new game begun in Christchurch down the road to Timaru', async () => {
    const { fake, tick } = await boot();
    fake.moveTo(0, -4200);
    fake.events.emit('playerRespawned', { reason: 'new' });
    tick(TUNING.introDelay + 0.2);
    expect(fake.ui.objectiveText).toBe('Head down SH1 to Timaru and see Aunty Rena at her chip shop on the Bay Hill');
  });

  it('does not nudge on death or arrest respawns', async () => {
    const { fake, tick } = await boot();
    fake.events.emit('playerRespawned', { reason: 'died' });
    fake.events.emit('playerRespawned', { reason: 'busted' });
    tick(5);
    expect(fake.ui.subtitles).toHaveLength(0);
    expect(fake.ui.objectiveText).toBeNull();
  });

  it('saves and loads progress through the save API, including the finished flag', async () => {
    const a = await boot();
    a.fake.save.save();
    expect(a.fake.save.stored!.missions).toEqual({ v: 1, done: [], completed: false, intro: false, pickups: [] });

    const b = await boot();
    b.fake.save.stored = { missions: { v: 1, done: ['severance-pay', 'on-ice'], completed: false, intro: true, pickups: ['cash-salmon'] } };
    expect(b.fake.save.load()).toBe(true);
    expect(b.missions.list().map((m) => m.state)).toEqual(['done', 'done', 'available', 'locked', 'locked', 'locked']);
    expect(b.fake.ui.blips.has('mission:severance-pay')).toBe(false);
    expect(b.fake.ui.blips.get('mission:mint-sauce')).toMatchObject({ kind: 'mission', label: 'N' });
    b.fake.save.save();
    expect(b.fake.save.stored!.missions).toEqual({ v: 1, done: ['severance-pay', 'on-ice'], completed: false, intro: true, pickups: ['cash-salmon'] });

    const c = await boot();
    c.fake.save.stored = { missions: { v: 1, done: c.missions.list().map((m) => m.id), completed: true, intro: true } };
    c.fake.save.load();
    expect(c.missions.completed).toBe(true);
    expect([...c.fake.ui.blips.values()].filter((x) => x.kind === 'mission')).toHaveLength(0);
    expect(() => c.fake.save.load()).not.toThrow();
  });

  it('after the last job: a "you\'ve done it" banner, the completed flag saved, and free roam carries on', async () => {
    const { fake, missions, tick } = await boot();
    fake.save.stored = { missions: { v: 1, done: missions.list().slice(0, 5).map((m) => m.id), completed: false, intro: true } };
    fake.save.load();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    at(fake, 'chch-garage');
    expect(missions.start('southerly-change')).toBe(true);
    // Skip to the end of the story: nothing left to do but be told it is over.
    const run = (missions as unknown as { runner: { run: { stepIndex: number; def: { steps: unknown[] } } } }).runner.run;
    tick();
    run.stepIndex = run.def.steps.length;
    tick();
    expect(missions.active).toBeNull();
    expect(missions.completed).toBe(true);
    expect(fake.player.money).toBe(5000);
    expect((fake.save.stored!.missions as { completed: boolean }).completed).toBe(true);
    expect(fake.police.cleared).toBeGreaterThan(0);
    expect(fake.ui.banners.at(-1)).toMatchObject({ title: 'Job done' });
    tick(TUNING.finaleDelay + 0.5, 0.1);
    expect(fake.ui.banners.at(-1)).toMatchObject({ title: "You've done it", tone: 'good' });
    // Still a going concern: safehouses and shops keep working.
    at(fake, 'chch-garage');
    tick(1);
    expect(fake.ui.promptText).toBe('F  Have a kip and save');
  });
});

describe('safehouses', () => {
  it('a kip fades out, sleeps six to eight hours, heals, saves and says so', async () => {
    const { fake, tick, interact } = await boot();
    // The garage has no job on offer yet, so it is just a bed.
    at(fake, 'chch-garage');
    fake.player.health = 35;
    fake.clock.hour = 22;
    tick();
    expect(fake.ui.promptText).toBe('F  Have a kip and save');
    await interact();
    expect(fake.ui.fades).toEqual([true, false]);
    const slept = (fake.clock.hour + 24 - 22) % 24;
    expect(slept).toBeGreaterThanOrEqual(6);
    expect(slept).toBeLessThanOrEqual(8);
    expect(fake.clock.day).toBe(2);
    expect(fake.player.health).toBe(100);
    expect(fake.save.saves).toBe(1);
    expect(fake.ui.toasts.at(-1)).toMatch(/^Game saved\. It's \d+:\d\d am\.$/);
    expect(fake.player.controlsEnabled).toBe(true);
  });

  it('is on the same card as a job at the chip shop', async () => {
    const { fake, missions, interact } = await boot();
    at(fake, 'timaru-chipshop');
    fake.ui.answer = (_t, options) => options.indexOf('Have a kip and save');
    await interact();
    expect(missions.active).toBeNull();
    expect(fake.save.saves).toBe(1);
    expect(fake.ui.fades).toEqual([true, false]);
  });

  it('is not available with the police about, or in the middle of a job', async () => {
    const { fake, missions, tick, interact } = await boot();
    at(fake, 'chch-garage');
    fake.police.level = 2;
    tick();
    expect(fake.ui.promptText).toBe("Can't have a kip with the police about");
    await interact();
    expect(fake.save.saves).toBe(0);
    fake.police.level = 0;
    at(fake, 'timaru-chipshop');
    missions.start('severance-pay');
    at(fake, 'chch-garage');
    tick(TUNING.interactCooldown + 0.2);
    fake.ui.promptText = null;
    tick();
    expect(fake.ui.promptText).toBeNull();
  });
});

describe('gun shops', () => {
  it('lists what the combat module sells, with prices, and charges for it', async () => {
    const { fake, tick, interact } = await boot();
    at(fake, 'timaru-gunshop');
    fake.player.money = 1000;
    tick();
    expect(fake.ui.promptText).toBe('F  Browse timaru gunshop');
    const answers = ['pistol  $400', 'Leave'];
    fake.ui.answer = (_t, options) => options.indexOf(answers.shift()!);
    await interact();
    expect(fake.ui.chooses[0].title).toBe('timaru gunshop');
    expect(fake.ui.chooses[0].body).toBe("You've got $1000.");
    // The knife is over the counter; the katana has no price and is not for sale.
    expect(fake.ui.chooses[0].options).toEqual(['knife  $30', 'bat  $45', 'pistol  $400', 'shotgun  $850', 'rifle  $1200', `Padded shooting vest  $${TUNING.armourPrice}`, 'Leave']);
    expect(fake.combat.given).toEqual([{ id: 'pistol', ammo: 6 * TUNING.shopMagazines }]);
    expect(fake.player.money).toBe(600);
    expect(fake.audio.played).toContain('cash');
    // Came back round with rounds on offer instead of the gun, and the new balance.
    expect(fake.ui.chooses[1].body).toBe("You've got $600.");
    expect(fake.ui.chooses[1].options[2]).toBe(`pistol rounds ×${6 * TUNING.shopMagazines}  $80`);
  });

  it('sells rounds and a vest, and turns away the short of cash', async () => {
    const { fake, tick, interact } = await boot();
    at(fake, 'chch-gunshop');
    fake.player.money = 340;
    fake.combat.owned.add('pistol');
    tick();
    // bat (45) → vest (250) → pistol rounds (80: cannot afford, 45 left) → rifle (no) → leave
    const wants = ['bat', 'Padded', 'pistol rounds', 'rifle', 'Leave'];
    fake.ui.answer = (_t, options) => {
      const want = wants.shift();
      return want === undefined ? -1 : options.findIndex((o) => o.startsWith(want));
    };
    await interact();
    await flush();
    expect(fake.combat.given).toEqual([{ id: 'bat', ammo: 0 }]);
    expect(fake.player.armour).toBe(TUNING.armourAmount);
    expect(fake.player.money).toBe(45);
    expect(fake.ui.toasts.filter((t) => t.includes('short'))).toHaveLength(2);
    expect(fake.audio.played).toContain('empty');
  });

  it('shuts its door while the player is wanted', async () => {
    const { fake, tick, interact } = await boot();
    at(fake, 'timaru-gunshop');
    fake.police.level = 1;
    tick();
    expect(fake.ui.promptText).toMatch(/Lose the police/);
    await interact();
    expect(fake.ui.chooses).toHaveLength(0);
  });
});

describe('world pickups', () => {
  it('appear lazily, once their area has streamed in, at dry spots off any marae', async () => {
    const { fake, tick } = await boot();
    fake.world.loaded = false;
    tick(TUNING.pickupScanSeconds + 0.1);
    expect(fake.combat.pickups).toHaveLength(0);
    fake.world.loaded = true;
    tick(TUNING.pickupScanSeconds + 0.1);
    expect(fake.combat.pickups).toHaveLength(WORLD_PICKUPS.length);
    const bat = fake.combat.pickups.find((p) => p.kind === 'bat')!;
    expect(Math.hypot(bat.x - 10, bat.z - 5905)).toBeLessThan(15);
    expect(fake.combat.pickups.filter((p) => p.kind === 'health').every((p) => p.respawn === TUNING.healthRespawn)).toBe(true);
    expect(fake.combat.pickups.filter((p) => p.kind === 'cash').every((p) => p.respawn === undefined && (p.amount ?? 0) >= 100)).toBe(true);
    for (const p of fake.combat.pickups) expect(Math.hypot(p.x - MARAE.x, p.z - MARAE.z)).toBeGreaterThan(MARAE.clearRadius + TUNING.maraeMargin);
    // Spawned once only.
    tick(TUNING.pickupScanSeconds * 3);
    expect(fake.combat.pickups).toHaveLength(WORLD_PICKUPS.length);
  });

  it('remembers one-off pickups that have been taken', async () => {
    const { fake, tick } = await boot();
    tick(TUNING.pickupScanSeconds + 0.1);
    const cash = fake.combat.pickups.find((p) => p.kind === 'cash' && p.amount === 200)!;
    // A cash pickup event somewhere else is not this one.
    fake.moveTo(cash.x + 80, cash.z);
    fake.events.emit('pickup', { kind: 'cash', amount: 50 });
    fake.moveTo(cash.x + 1, cash.z);
    fake.events.emit('pickup', { kind: 'health', amount: 25 });
    fake.save.save();
    expect((fake.save.stored!.missions as { pickups: string[] }).pickups).toEqual([]);
    fake.events.emit('pickup', { kind: 'cash', amount: 200 });
    fake.save.save();
    expect((fake.save.stored!.missions as { pickups: string[] }).pickups).toEqual(['cash-salmon']);

    // A fresh session with that save does not put it back, and removes it if it was already lying there.
    const next = await boot();
    next.tick(TUNING.pickupScanSeconds + 0.1);
    const lying = next.fake.combat.pickups.find((p) => p.kind === 'cash' && p.amount === 200)!;
    expect(lying.removed).toBe(false);
    next.fake.save.stored = fake.save.stored;
    next.fake.save.load();
    expect(lying.removed).toBe(true);

    const fresh = await boot();
    fresh.fake.save.stored = fake.save.stored;
    fresh.fake.save.load();
    fresh.tick(TUNING.pickupScanSeconds + 0.1);
    expect(fresh.fake.combat.pickups).toHaveLength(WORLD_PICKUPS.length - 1);
  });

  it('skips pickups whose place is not on the map yet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fake, tick } = await boot({ places: ['timaru-spawn', 'timaru-chipshop'] });
    tick(TUNING.pickupScanSeconds + 0.1);
    expect(fake.combat.pickups.map((p) => p.kind).sort()).toEqual(['bat', 'health']);
  });
});

describe('clockText', () => {
  it('reads like a clock radio', () => {
    expect(clockText(6.5)).toBe('6:30 am');
    expect(clockText(0)).toBe('12:00 am');
    expect(clockText(12.25)).toBe('12:15 pm');
    expect(clockText(23.999)).toBe('12:00 am');
    expect(clockText(17.75)).toBe('5:45 pm');
  });
});
