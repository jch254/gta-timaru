#!/usr/bin/env node
// The ways a real player breaks missions, each run against the live game. Dev tools set up each situation
// (heat, damage, teleports between probes); what is being tested is how the game answers, and the answer is
// always observed honestly. Start `pnpm dev` first.
//
//   node scripts/playtest/abuse.mjs                 # every probe, each in a fresh game
//   node scripts/playtest/abuse.mjs --probe death   # just one
//
// Probes:
//   death          dying mid-mission fails it, hospital respawn, the job can be taken again
//   arrest         being arrested mid-mission fails it ("Nicked"), police-station respawn
//   wreck          wrecking the mission vehicle fails with its written reason
//   abandon        walking away from the mission vehicle flips the objective; too far fails where defined
//   wander         walking out of a blocking briefing lets the job carry on
//   kill-contact   shooting the body the script needs still lets the papers be taken
//   wreck-target   destroying the chase target early does not strand the mission
//   save-load      saving mid-job, reloading and Continue: job dropped cleanly, no stuck state
//   wanted-start   turning up to a giver with heat: the game says why there is no prompt
//   park-on-spawn  parking exactly on a mission car's spot: the spawn steps aside
//   skip-dialogue  holding skip through every line never wedges a mission
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS, newGame, parseArgs, SETTINGS_KEY } from '../lib.mjs';

const args = parseArgs();
const url = args.url || DEV_URL;
const botSource = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
const only = args.probe ? String(args.probe) : null;

// ───────────────────────────── Probes (run in the page) ─────────────────────────────
// Each returns { ok, notes: string[] }. `dev`, `bot`, `sleep` are in scope.

const PROBES = {
  /** Die in the punt-return shoot-out without fighting back. */
  death: async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.money(400); // so the hospital has something to bill
    dev.startMission('punt-return');
    await dev.auto(60, { fights: 'stop' });
    const before = ctx.player.money;
    // Stand there and take it.
    const until = performance.now() + 90 * 1000;
    while (ctx.player.alive && performance.now() < until) await sleep(500);
    notes.push(`alive=${ctx.player.alive}`);
    if (ctx.player.alive) return { ok: false, notes: [...notes, 'the crew never finished the job'] };
    await bot.waitForLife();
    await sleep(2500);
    const m = ctx.missions.list().find((x) => x.id === 'punt-return');
    const place = ctx.world.nearestPlace(ctx.player.position.x, ctx.player.position.z, 'hospital');
    const atHospital = place && Math.hypot(place.x - ctx.player.position.x, place.z - ctx.player.position.z) < 60;
    notes.push(`mission=${m.state}`, `fee=${before - ctx.player.money}`, `atHospital=${atHospital}`);
    return { ok: m.state === 'available' && atHospital, notes };
  },

  /** Get nicked mid-mission: heat, stand still beside the car until they close in. */
  arrest: async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.startMission('on-ice');
    await sleep(600);
    dev.heat(2);
    const before = ctx.player.money;
    const until = performance.now() + 120 * 1000;
    let busted = false;
    const off = ctx.events.on('playerBusted', () => (busted = true));
    while (!busted && performance.now() < until) await sleep(500);
    off();
    if (!busted) return { ok: false, notes: ['never arrested in 120 s standing still at heat 2'] };
    await bot.waitForLife();
    await sleep(2500);
    const m = ctx.missions.list().find((x) => x.id === 'on-ice');
    const place = ctx.world.nearestPlace(ctx.player.position.x, ctx.player.position.z, 'police');
    const atStation = place && Math.hypot(place.x - ctx.player.position.x, place.z - ctx.player.position.z) < 60;
    notes.push(`mission=${m.state}`, `fee=${before - ctx.player.money}`, `atStation=${atStation}`, `heat=${ctx.police.level}`);
    return { ok: m.state === 'available' && atStation && ctx.police.level === 0, notes };
  },

  /** Wreck the ute: the mission must fail with the written reason. */
  wreck: async () => {
    const ctx = bot.ctx;
    const notes = [];
    let reason = '';
    ctx.events.on('missionFailed', (e) => (reason = e.reason));
    // Stand at the car park so the ute spawns at once, then total it before it is even taken.
    await dev.tp('smithfield-carpark');
    dev.startMission('severance-pay');
    let guard = 0;
    let ute = null;
    while (!ute && guard++ < 30) {
      ctx.missions.dialogue?.clear?.();
      await sleep(400);
      ute = ctx.vehicles.all.find((v) => v.spec.id === 'ute' && v.tags.has('mission')) ?? null;
      if (!dev.step()) break;
    }
    if (!ute) return { ok: false, notes: [`no mission ute found (step ${dev.step()?.kind})`] };
    ute.applyDamage(99999, ctx.player);
    await sleep(2500);
    notes.push(`reason="${reason}"`);
    const m = ctx.missions.list().find((x) => x.id === 'severance-pay');
    return { ok: m.state === 'available' && /write-off|holiday pay/i.test(reason), notes };
  },

  /** Step out of the mission ute and walk: objective must flip; mint-sauce fails past 160 m. */
  abandon: async () => {
    const ctx = bot.ctx;
    const notes = [];
    let reason = '';
    ctx.events.on('missionFailed', (e) => (reason = e.reason));
    dev.startMission('mint-sauce');
    await sleep(500);
    let guard = 0;
    // The truck leg is the survive step (the constable escort); its failIf is the abandonment rule.
    while (dev.step() && dev.step().kind !== 'survive' && guard++ < 20) await dev.auto(8, { fights: 'stop' });
    const st = dev.step();
    notes.push(`step=${st?.kind}`);
    if (st?.kind !== 'survive') return { ok: false, notes: [...notes, 'never reached the truck step'] };
    // Out of the truck and away.
    dev.tap('KeyF');
    await sleep(1500);
    const p = ctx.player.position.clone();
    await ctx.world.whenLoaded(p.x + 200, p.z);
    ctx.player.teleport(p.x + 200, p.z, 0);
    await sleep(3000);
    notes.push(`objective="${dev.mission().objective}"`, `reason="${reason}"`);
    return { ok: /left the truck|sheep/i.test(reason), notes };
  },

  /** Walk out of Rena's blocking briefing: the mission must move on by itself. */
  wander: async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.startMission('severance-pay');
    await sleep(1200);
    const st = dev.step();
    notes.push(`step0=${st?.kind}`);
    const p = ctx.player.position.clone();
    await bot.walkTo(p.x + 40, p.z + 40, { radius: 4, timeout: 30 });
    await sleep(1500);
    const st2 = dev.step();
    notes.push(`step after walking off=${st2?.index} ${st2?.kind}`);
    return { ok: st2 !== null && st2.index > 0, notes };
  },

  /** Kill Brick (the script needs his body), wait half a minute, then take the papers off him. */
  'kill-contact': async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.startMission('punt-return');
    await sleep(500);
    dev.god(true); // the fight is not what this probe measures
    const killAll = () => {
      for (const a of ctx.actors.all) if (a.kind === 'gang' && a.alive) a.takeDamage({ amount: 9999, kind: 'bullet', source: ctx.player });
    };
    // Step up to the Arts Centre fight, then kill everyone — including Brick, whose body the script needs.
    let guard = 0;
    while (guard++ < 60) {
      const s2 = dev.step();
      if (!s2) break;
      if (s2.kind === 'eliminate') {
        const last = /Brick and his crew/i.test(s2.objective ?? '');
        killAll();
        await sleep(1000);
        if (last) break;
      } else await dev.auto(8, { fights: 'stop' });
    }
    await sleep(1500);
    const st = dev.step();
    if (!st || !/papers/i.test(st.objective ?? '')) return { ok: false, notes: [`never reached the papers step (${st?.kind} "${st?.objective}")`] };
    let failed = '';
    const offFail = ctx.events.on('missionFailed', (e) => (failed = e.reason));
    notes.push('waiting 30 s beside the body');
    await sleep(30000);
    const again = dev.step();
    if (!again || again.index !== st.index) {
      offFail();
      return { ok: false, notes: [...notes, `step changed while waiting (now ${again?.kind ?? 'gone'})`] };
    }
    await dev.auto(40);
    offFail();
    const after = dev.step();
    const done = ctx.missions.list().find((x) => x.id === 'punt-return')?.state;
    notes.push(`after walking to the body: step=${after?.index ?? 'gone'} ${after?.kind ?? ''}, mission=${done}`);
    dev.god(false);
    // Lootable means the step advanced — the strongest proof being the mission running on (or completing) rather than failing.
    return { ok: !failed && (after === null ? done === 'done' : after.index > st.index), notes };
  },

  /** Destroy the finale's van before the chase: the story must carry on, not strand. */
  'wreck-target': async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.startMission('southerly-change');
    await sleep(500);
    dev.god(true);
    // Play to the pass fight, clear it by hand, stop the moment the chase begins and kill the van.
    let guard = 0;
    while (guard++ < 40) {
      const s2 = dev.step();
      if (!s2 || s2.kind === 'chase') break;
      if (s2.kind === 'eliminate') {
        for (const a of ctx.actors.all) if (a.kind === 'gang' && a.alive) a.takeDamage({ amount: 9999, kind: 'bullet', source: ctx.player });
        await sleep(1000);
      } else await dev.auto(8, { fights: 'stop' });
    }
    const st = dev.step();
    if (st?.kind !== 'chase') return { ok: false, notes: [`never reached the chase (${st?.kind})`] };
    const van = ctx.vehicles.all.find((v) => v.spec.id === 'van' && v.tags.has('mission'));
    if (!van) return { ok: false, notes: ['no van on the road'] };
    let failed = '';
    const offFail = ctx.events.on('missionFailed', (e) => (failed = e.reason));
    van.applyDamage(99999, ctx.player);
    // A wrecked car burns on a fuse, then explodes; the chase ends when it is actually destroyed. Wait it out.
    const until = performance.now() + 15000;
    while (performance.now() < until && dev.step()?.kind === 'chase') await sleep(500);
    offFail();
    const after = dev.step();
    notes.push(`van destroyed=${van.destroyed}; after: step=${after?.index ?? 'gone'} ${after?.kind ?? ''}${failed ? ' FAILED:' + failed : ''}`);
    dev.god(false);
    // Not stranded: the chase ends and the story carries on (or the player is sent to the wharf), never a dead end.
    return { ok: !failed && after !== null && after.kind !== 'chase', notes };
  },

  /** Save from the pause menu mid-job, reload the page, Continue: clean world, job available again. */
  'save-load': async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.startMission('on-ice');
    // Mid-mission, deterministically: step forward in short bursts until the timed run is underway.
    let guard = 0;
    while (guard++ < 30) {
      const s = dev.step();
      if (!s || s.kind === 'deliverVehicle') break;
      await dev.auto(5, { fights: 'stop' });
    }
    const st = dev.step();
    if (!st) return { ok: false, notes: ['the mission finished before a mid-job save could happen'] };
    notes.push(`saved at step ${st.index} ${st.kind}, heat ${ctx.police.level}`);
    ctx.save.save();
    return { ok: true, notes, reload: true };
  },

  /** After the reload (run in the fresh page): Continue happened in the runner, check the state. */
  'save-load-after': async () => {
    const ctx = bot.ctx;
    const notes = [];
    await sleep(1500);
    const m = ctx.missions.list().find((x) => x.id === 'on-ice');
    notes.push(`mission=${m.state}`, `active=${ctx.missions.active?.id ?? 'none'}`, `controls=${ctx.player.controlsEnabled}`, `objective=${dev.mission().objective ?? 'none'}`);
    const ok = m.state === 'available' && ctx.missions.active === null && ctx.player.controlsEnabled;
    return { ok, notes };
  },

  /** Walk up to Rena with two lights: the game must say why there is no job on offer. */
  'wanted-start': async () => {
    const ctx = bot.ctx;
    const notes = [];
    dev.heat(2);
    await sleep(400);
    const place = ctx.world.place('timaru-chipshop');
    await bot.walkTo(place.x, place.z, { radius: 1.5, timeout: 30 });
    await sleep(1200);
    const prompt = ctx.ui.promptText ?? document.querySelector('[class*=prompt]')?.textContent ?? '';
    notes.push(`prompt="${prompt}"`);
    ctx.police.clear();
    return { ok: /lose the police/i.test(prompt), notes };
  },

  /** Park the player's car exactly on the ute's spawn spot: the ute must appear beside it. */
  'park-on-spawn': async () => {
    const ctx = bot.ctx;
    const notes = [];
    const spot = ctx.world.place('smithfield-carpark');
    // Stand the player at the car park (so the mission ute is within activation range), in a car parked
    // squarely on the spot.
    await dev.tp('smithfield-carpark');
    dev.car('statesman');
    await sleep(800);
    await ctx.world.whenLoaded(spot.x, spot.z);
    ctx.player.vehicle.teleport(spot.x, ctx.world.groundAt(spot.x, spot.z), spot.z, spot.heading);
    await sleep(500);
    dev.startMission('severance-pay');
    // The briefing is a blocking step: skip through it the way a player does, so the spawn step runs.
    for (let i = 0; i < 80 && dev.step() && dev.step().index === 0; i++) {
      dev.tap('KeyX');
      await sleep(400);
    }
    const until = performance.now() + 40 * 1000;
    let ute = null;
    while (!ute && performance.now() < until) {
      ute = ctx.vehicles.all.find((v) => v.spec.id === 'ute' && v.tags.has('mission')) ?? null;
      await sleep(500);
    }
    if (!ute) return { ok: false, notes: ['the ute never spawned with a car on its spot'] };
    const d = Math.hypot(ute.position.x - spot.x, ute.position.z - spot.z);
    const clear = Math.hypot(ute.position.x - ctx.player.vehicle.position.x, ute.position.z - ctx.player.vehicle.position.z);
    notes.push(`ute ${Math.round(d)} m from the spot, ${Math.round(clear)} m from the parked car`);
    return { ok: clear > 3, notes };
  },

  /** Hold skip through the whole first mission (the scripted player drives): nothing may wedge. */
  'skip-dialogue': async () => {
    const ctx = bot.ctx;
    const notes = [];
    const skipper = setInterval(() => dev.tap('KeyX'), 700);
    try {
      dev.god(true);
      dev.startMission('severance-pay');
      await sleep(300);
      let guard = 0;
      while (dev.step() && guard++ < 6) await dev.auto(60);
      const m = ctx.missions.list().find((x) => x.id === 'severance-pay');
      notes.push(`state=${m.state}`);
      return { ok: m.state === 'done', notes };
    } finally {
      clearInterval(skipper);
      dev.god(false);
    }
  },
};

// ───────────────────────────── Runner ─────────────────────────────

const launch = () =>
  puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 1_200_000,
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    args: [...GPU_ARGS, '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,900'],
  });

const results = [];
{
  const names = only ? [only] : Object.keys(PROBES).filter((n) => n !== 'save-load-after');
  for (const name of names) {
    const problems = [];
    // A fresh browser per probe: a renderer that falls over in one probe (heavy scenes under load) cannot
    // take the rest of the suite down with it.
    const browser = await launch();
    try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.text().startsWith('[shot]')) console.log(m.text());
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => problems.push('error: ' + e.message));
    await page.evaluateOnNewDocument((key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        s.liveRadio = false;
        localStorage.setItem(key, JSON.stringify(s));
      } catch {
        /* defaults */
      }
    }, SETTINGS_KEY);
    const start = async (button) => {
      await page.goto(url + (url.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'domcontentloaded' });
      if (button === '#btn-new') await newGame(page);
      else {
        await page.waitForSelector(button, { timeout: 30000 });
        await page.click(button);
      }
      await page.waitForFunction('window.dev !== undefined', { timeout: 60000 });
      await page.evaluate(botSource);
      await page.evaluate(() => bot.sleep(3000).then(() => bot.ctx.missions?.dialogue?.clear?.()));
    };
    // Fresh storage per probe, then a new game.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate((key) => {
      const keep = localStorage.getItem(key);
      localStorage.clear();
      if (keep) localStorage.setItem(key, keep);
    }, SETTINGS_KEY);
    await start('#btn-new');
    let r;
    try {
      r = await page.evaluate(`(async () => { const dev = window.dev, bot = window.bot, sleep = bot.sleep; return (${PROBES[name].toString()})(); })()`);
    } catch (err) {
      r = { ok: false, notes: ['threw: ' + String(err).slice(0, 300)] };
    }
    if (r && r.reload) {
      // Second act: reload and press Continue.
      await start('#btn-continue');
      try {
        const r2 = await page.evaluate(`(async () => { const dev = window.dev, bot = window.bot, sleep = bot.sleep; return (${PROBES['save-load-after'].toString()})(); })()`);
        r = { ok: r.ok && r2.ok, notes: [...r.notes, '— reload —', ...r2.notes] };
      } catch (err) {
        r = { ok: false, notes: [...r.notes, 'reload threw: ' + String(err).slice(0, 300)] };
      }
    }
    if (problems.length) r.notes.push('PAGE PROBLEMS: ' + [...new Set(problems)].join(' | '));
    results.push({ name, ok: r.ok && problems.length === 0, notes: r.notes });
    console.log(`${r.ok && problems.length === 0 ? 'ok  ' : 'FAIL'} ${name}: ${r.notes.join('; ')}`);
    } catch (err) {
      results.push({ name, ok: false, notes: ['probe crashed: ' + String(err).slice(0, 200)] });
      console.log(`FAIL ${name}: probe crashed: ${String(err).slice(0, 200)}`);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} probes passed${failed.length ? ': FAILED ' + failed.map((f) => f.name).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
