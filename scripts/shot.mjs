#!/usr/bin/env node
// Headless screenshots and measurements of the running dev server, using the Chrome already installed
// on this machine (no browser download). Start `pnpm dev` first.
//
//   node scripts/shot.mjs --place cathedral-square --time 15 --out shots/square.png
//   node scripts/shot.mjs --place four-aves-start --car v8sedan --look 1.57,0.25,1 --weather rain --time 22
//   node scripts/shot.mjs --at 120,-4100 --quality ultra --size 1920x1080 --fps 5
//   node scripts/shot.mjs --place timaru-spawn --eval "dev.heat(3)" --wait 6
//
// Options
//   --url       dev server (default http://localhost:5195/)
//   --place     place id to teleport to           --at x,z   coordinates instead
//   --heading   player heading in radians (default 0)
//   --time      hour of day (0..24)               --weather  clear | norwester | southerly | fog …
//   --car       spawn this vehicle spec and sit in it
//   --look      camera yaw,pitch,zoom
//   --quality   low | medium | high | ultra
//   --live      leave the live radio stations on the dial (off by default here, so automated runs do not
//               connect to real stations)
//   --eval      JavaScript to run in the page after setup (may use `dev` and `sleep(ms)`, may await and return a
//               value; console.log('[shot] …') lines are echoed live). Ready-made ones: scripts/playtest/*.js,
//               e.g. --eval "$(cat scripts/playtest/missions.js)"
//   --wait      seconds to let the scene settle before the shot (default 4)
//   --fps       measure frame rate over this many seconds and print it
//   --hud       keep the HUD in the shot (hidden by default)
//   --size      viewport, default 1600x900
//   --mobile    emulate an iPhone: landscape 844x390 CSS px, device pixel ratio 3, touch, an iPhone user agent.
//               `--mobile max` is 932x430, `--mobile portrait` is 390x844; --size still overrides the viewport.
//               Implies --hud (the touch controller is part of the picture). This is Chrome pretending, not
//               Safari: see scripts/playtest/phone.mjs for a played-through run with real touch events.
//   --out       PNG path, default shots/shot.png
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS, IPHONE_UA, parseArgs, SETTINGS_KEY } from './lib.mjs';

const args = parseArgs();
const url = args.url || DEV_URL;
const MOBILE_SIZES = { true: '844x390', max: '932x430', portrait: '390x844' };
const mobile = args.mobile ? MOBILE_SIZES[String(args.mobile)] || MOBILE_SIZES.true : null;
const [width, height] = String(args.size || mobile || '1600x900').split('x').map(Number);
if (mobile) args.hud = true;
const out = resolve(String(args.out || 'shots/shot.png'));
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 1_200_000, // long --eval scripts (whole missions) are fine
  defaultViewport: mobile ? { width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: width > height } : { width, height, deviceScaleFactor: 1 },
  args: [...GPU_ARGS, '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`, '--disable-frame-rate-limit', '--disable-gpu-vsync'].filter((a) => args.fps || !a.includes('rate-limit') && !a.includes('vsync')),
});
let failed = false;
try {
  const page = await browser.newPage();
  if (mobile) await page.setUserAgent(IPHONE_UA);
  const problems = [];
  page.on('console', (m) => {
    // Progress lines from long --eval scripts: console.log('[shot] …') is echoed as it happens.
    if (m.text().startsWith('[shot]')) console.log(m.text());
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('error: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push('http ' + r.status() + ': ' + r.url());
  });
  // Settings are written before the page's own scripts run. Automated runs keep the live radio stations off
  // unless asked (--live): there is no call to connect to a real station on every screenshot.
  await page.evaluateOnNewDocument(
    (key, quality, live) => {
      try {
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        if (quality) s.quality = quality;
        s.liveRadio = live;
        localStorage.setItem(key, JSON.stringify(s));
      } catch {
        // No storage: the game falls back to its defaults.
      }
    },
    SETTINGS_KEY,
    args.quality ? String(args.quality) : null,
    !!args.live,
  );
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  if (mobile) await page.tap('#btn-new');
  else await page.click('#btn-new');
  await page.waitForFunction('window.dev !== undefined', { timeout: mobile ? 120000 : 60000 });
  const setup = await page.evaluate(
    async (o) => {
      const dev = window.dev;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      dev.ctx.missions.dialogue?.clear?.();
      if (o.time !== undefined) dev.time(Number(o.time));
      if (o.weather) dev.weather(o.weather);
      if (o.place) await dev.tp(o.place);
      else if (o.at) {
        const [x, z] = String(o.at).split(',').map(Number);
        await dev.tp(x, z, Number(o.heading || 0));
      }
      if (o.heading !== undefined && o.place) {
        const p = dev.ctx.player.position;
        dev.ctx.player.teleport(p.x, p.z, Number(o.heading));
      }
      await sleep(600);
      if (o.car) dev.car(String(o.car));
      if (o.look) {
        const [yaw, pitch, zoom] = String(o.look).split(',').map(Number);
        dev.look(yaw, pitch ?? 0.2, zoom ?? 1);
      }
      let result;
      if (o.eval) result = await new Function('dev', 'sleep', `return (async () => { ${o.eval} })()`)(dev, sleep);
      await sleep(Number(o.wait ?? 4) * 1000);
      dev.ctx.missions.dialogue?.clear?.();
      if (!o.hud) for (const el of document.querySelectorAll('.nw-ui')) el.style.visibility = 'hidden';
      return { result, stats: dev.stats() };
    },
    args,
  );
  if (args.fps) {
    const fps = await page.evaluate(async (seconds) => {
      let frames = 0;
      let worst = 0;
      let last = performance.now();
      const start = last;
      await new Promise((done) => {
        const tick = () => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          frames++;
          if (now - start < seconds * 1000) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      const s = window.dev.stats();
      return { fps: +(frames / ((last - start) / 1000)).toFixed(1), worstFrameMs: +worst.toFixed(1), calls: s.calls, tris: s.tris, scale: s.scale, profile: window.dev.profile() };
    }, Number(args.fps));
    console.log('fps', JSON.stringify(fps));
  }
  await page.screenshot(/\.jpe?g$/i.test(out) ? { path: out, type: 'jpeg', quality: 88 } : { path: out });
  console.log('stats', JSON.stringify(setup.stats));
  if (setup.result !== undefined) console.log('eval', JSON.stringify(setup.result));
  if (problems.length) {
    failed = true;
    console.log('PROBLEMS\n' + [...new Set(problems)].join('\n'));
  }
  console.log('wrote', out);
} finally {
  await browser.close();
}
process.exit(failed ? 2 : 0);
