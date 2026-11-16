#!/usr/bin/env node
// A run of screenshots from one session of the running game, for looking at things in motion (level-of-detail
// switches, glitches that last a frame). Same setup options as scripts/shot.mjs:
//   --place | --at x,z  --heading  --time  --weather  --car  --look yaw,pitch,zoom  --quality  --size  --mobile
//   --eval   JavaScript run once after setup (may await; `dev`, `sleep`)
//   --each   JavaScript run before every frame with `i` (frame number); its return value is logged
//   --frames how many (default 30)      --every  milliseconds between them (default 200)
//   --out    folder (frames are written as f000.jpg …)
//   --throttle N   slow the page's CPU N times (a busy machine: chunks still loading when the frame is taken)
//   node scripts/playtest/frames.mjs --place four-aves-start --car statesman --time 15 --frames 40 --out shots/x
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS, IPHONE_UA, parseArgs, SETTINGS_KEY } from '../lib.mjs';

const args = parseArgs();
const url = args.url || DEV_URL;
const mobile = args.mobile ? '844x390' : null;
const [width, height] = String(args.size || mobile || '1600x900').split('x').map(Number);
const out = resolve(String(args.out || 'shots/frames'));
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 1_200_000,
  defaultViewport: mobile ? { width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true } : { width, height, deviceScaleFactor: 1 },
  args: [...GPU_ARGS, '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`],
});
let failed = false;
try {
  const page = await browser.newPage();
  if (mobile) await page.setUserAgent(IPHONE_UA);
  if (args.throttle) await page.emulateCPUThrottling(Number(args.throttle));
  const problems = [];
  page.on('console', (m) => {
    if (m.text().startsWith('[shot]')) console.log(m.text());
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('error: ' + e.message));
  await page.evaluateOnNewDocument((key, quality) => {
    try {
      const s = JSON.parse(localStorage.getItem(key) || '{}');
      if (quality) s.quality = quality;
      s.liveRadio = false;
      localStorage.setItem(key, JSON.stringify(s));
    } catch {
      // No storage: defaults.
    }
  }, SETTINGS_KEY, args.quality ? String(args.quality) : null);
  await page.goto(url + '?dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  if (mobile) await page.tap('#btn-new');
  else await page.click('#btn-new');
  await page.waitForFunction('window.dev !== undefined', { timeout: 120000 });
  const setup = await page.evaluate(async (o) => {
    const dev = window.dev;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.sleep = sleep;
    dev.ctx.missions.dialogue?.clear?.();
    if (o.time !== undefined) dev.time(Number(o.time));
    if (o.weather) dev.weather(o.weather);
    if (o.place) await dev.tp(o.place);
    else if (o.at) {
      const [x, z] = String(o.at).split(',').map(Number);
      await dev.tp(x, z, Number(o.heading || 0));
    }
    await sleep(600);
    if (o.car) dev.car(String(o.car));
    if (o.look) {
      const [yaw, pitch, zoom] = String(o.look).split(',').map(Number);
      dev.look(yaw, pitch ?? 0.2, zoom ?? 1);
    }
    let result;
    if (o.eval) result = await new Function('dev', 'sleep', `return (async () => { ${o.eval} })()`)(dev, sleep);
    if (!o.hud) for (const el of document.querySelectorAll('.nw-ui')) el.style.visibility = 'hidden';
    return result;
  }, args);
  if (setup !== undefined) console.log('eval', JSON.stringify(setup));
  const frames = Number(args.frames || 30);
  const every = Number(args.every ?? 200);
  for (let i = 0; i < frames; i++) {
    const t = Date.now();
    if (args.each) {
      const r = await page.evaluate((code, i) => new Function('dev', 'sleep', 'i', `return (async () => { ${code} })()`)(window.dev, window.sleep, i), String(args.each), i);
      if (r !== undefined && r !== null) console.log(`f${String(i).padStart(3, '0')}`, JSON.stringify(r));
    }
    await page.screenshot({ path: `${out}/f${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: Number(args.jpeg || 85) });
    const left = every - (Date.now() - t);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }
  console.log('stats', JSON.stringify(await page.evaluate(() => window.dev.stats())));
  if (problems.length) {
    failed = true;
    console.log('PROBLEMS\n' + [...new Set(problems)].join('\n'));
  }
  console.log('wrote', frames, 'frames to', out);
} finally {
  await browser.close();
}
process.exit(failed ? 2 : 0);
