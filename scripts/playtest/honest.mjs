#!/usr/bin/env node
// The honest playtest: a new game played the way a player has to play it. The bot (bot.js) walks with the
// movement keys, drives every metre of every route, fights with what each mission hands out, and loses the
// police the way the game intends — no teleports, no god mode, no patched cars, no scripted kills.
// Start `pnpm dev` first.
//
//   node scripts/playtest/honest.mjs                     # all six missions, back to back
//   node scripts/playtest/honest.mjs --mission on-ice    # just one (earlier ones marked done)
//   node scripts/playtest/honest.mjs --from mint-sauce   # start the chain there
//   node scripts/playtest/honest.mjs --out shots/honest/run1.json
//   node scripts/playtest/honest.mjs --mission on-ice --checkpoint 1   # pick one up at its Nth checkpoint
//   node scripts/playtest/honest.mjs --verbose           # a telemetry line every five seconds (--verbose 2: every two)
//
// Prints a live log, then a per-mission table, and writes the full record as JSON.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS, parseArgs, SETTINGS_KEY } from '../lib.mjs';

const MISSIONS = ['severance-pay', 'on-ice', 'mint-sauce', 'four-avenues', 'punt-return', 'southerly-change'];
const args = parseArgs();
const url = args.url || DEV_URL;
const out = resolve(String(args.out || `shots/honest/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(out), { recursive: true });
const botSource = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');

const only = args.mission ? String(args.mission) : null;
const from = args.from ? String(args.from) : null;
const checkpoint = only && args.checkpoint ? Number(args.checkpoint) : 0;
let list = MISSIONS;
if (only) list = [only];
else if (from) list = MISSIONS.slice(MISSIONS.indexOf(from));
if (list.some((id) => !MISSIONS.includes(id))) {
  console.error(`Unknown mission. Known: ${MISSIONS.join(', ')}`);
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 7_200_000, // one evaluate call can hold a whole mission's attempts

  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
  args: [...GPU_ARGS, '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,900'],
});

let failed = false;
try {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.text().startsWith('[shot]')) console.log(m.text());
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text());
    if (m.type() === 'warning' && m.text().startsWith('missions:')) problems.push('warn: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('error: ' + e.message));
  await page.evaluateOnNewDocument(
    (key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        s.liveRadio = false;
        localStorage.setItem(key, JSON.stringify(s));
      } catch {
        /* defaults */
      }
    },
    SETTINGS_KEY,
  );
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  await page.click('#btn-new');
  await page.waitForFunction('window.dev !== undefined', { timeout: 60000 });
  await page.evaluate(botSource);
  await page.evaluate(async () => {
    // Let the intro lines run their course like a patient player, then start from the chip shop door.
    await bot.sleep(4000);
  });

  // Earlier missions than the first requested are marked done (their drives are not what is being measured).
  const first = list[0];
  if (first !== MISSIONS[0]) {
    await page.evaluate((id) => {
      // The dev helper marks everything before `id` done; aborting leaves it ready to be taken honestly.
      // A player who reached this job has the earlier pay in his pocket (and needs it: a respray at three
      // lights costs $550), so the skipped rewards are granted too.
      const missions = bot.ctx.missions;
      let pay = 0;
      for (const m of missions.list()) {
        if (m.id === id) break;
        pay += missions.runner.def(m.id)?.reward ?? 0;
      }
      bot.dev.startMission(id);
      missions.abort('skip ahead');
      bot.dev.money(pay);
    }, first);
  }

  if (args.verbose) await page.evaluate((seconds) => bot.watch(seconds), Number(args.verbose) > 0 ? Number(args.verbose) : 5);

  // --checkpoint N: the same resume the "Have another go?" offer performs, for iterating on a late leg.
  let running = false;
  if (checkpoint > 0) {
    running = await page.evaluate(
      async (id, n) => {
        const missions = bot.ctx.missions;
        const def = missions.runner.def(id);
        const points = def.steps.map((step, index) => ({ step, index })).filter((q) => q.step.kind === 'checkpoint');
        const point = points[n - 1];
        if (!point) return false;
        await missions.resumeMission(def, { index: point.index, label: point.step.label, at: point.step.at });
        return missions.active?.id === id;
      },
      only,
      checkpoint,
    );
    if (!running) throw new Error(`${only} has no checkpoint ${checkpoint}`);
    console.log(`[shot] ${only}: picked up at checkpoint ${checkpoint}`);
  }

  const records = [];
  for (const id of list) {
    const record = await page.evaluate(async (missionId, already) => bot.runMission(missionId, { maxAttempts: 6, running: already }), id, running);
    running = false;
    records.push(record);
    if (record.result !== 'passed') {
      console.log(`[shot] ${id}: ${record.result.toUpperCase()} — stopping the chain`);
      await page.screenshot({ path: resolve(dirname(out), `${id}-${record.result}.png`) }).catch(() => undefined);
      failed = true;
      break;
    }
  }

  const finale = await page.evaluate(() => ({
    money: bot.ctx.player.money,
    completed: bot.ctx.missions.completed ?? null,
    missions: bot.ctx.missions.list().map((m) => `${m.id}:${m.state}`),
  }));

  // ── Summary table ──
  const rows = records.map((r) => {
    const last = r.attempts[r.attempts.length - 1] ?? {};
    const total = r.attempts.reduce((s, a) => s + (a.seconds ?? 0), 0);
    return {
      mission: r.id,
      result: r.result,
      attempts: r.attempts.length,
      'last (s)': last.seconds ?? '',
      'total (s)': total,
      damage: last.damageTaken ?? '',
      deaths: r.attempts.reduce((s, a) => s + (a.deaths ?? 0), 0),
      maxHeat: Math.max(0, ...r.attempts.map((a) => a.maxHeat ?? 0)),
      'timer slack': (last.timerSlack ?? []).map((t) => `${t.left}s@#${t.step}`).join(' '),
      failures: r.attempts.flatMap((a) => a.reasons).join(' | '),
    };
  });
  console.table(rows);
  console.log('finale', JSON.stringify(finale));
  if (problems.length) {
    failed = true;
    console.log('PROBLEMS\n' + [...new Set(problems)].join('\n'));
  }
  writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), list, records, finale, problems }, null, 2));
  console.log('wrote', out);
} finally {
  await browser.close();
}
process.exit(failed ? 2 : 0);
