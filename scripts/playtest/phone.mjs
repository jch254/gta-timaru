#!/usr/bin/env node
// Plays the game the way a phone would: headless Chrome emulating an iPhone in landscape (844x390 CSS px,
// device pixel ratio 3, touch, an iPhone user agent), driven with real touch events through the DevTools
// protocol (page.touchscreen), several fingers at once. Start `pnpm dev` first.
//
//   node scripts/playtest/phone.mjs [url] [--shots shots/round3/phone] [--size 932x430]
//
// It taps New game, pushes the stick, drags to look, jumps, walks to a car and gets in, drives, steers, brakes,
// gets out, works the pause menu and the map, turns the phone to portrait and back, and checks a key press
// hides the controller. Prints one line per check and exits non-zero if any failed.
//
// This is Chrome pretending to be a phone, not Safari: it says nothing about iOS audio, safe areas, the
// address bar or real performance. See shots/round3/phone-report.md for what still has to be tried by hand.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS, IPHONE_UA, SETTINGS_KEY } from '../lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const url = argv[0] && !argv[0].startsWith('--') ? argv[0] : DEV_URL;
const shots = resolve(opt('shots', 'shots/round3/phone'));
const [W, H] = String(opt('size', '844x390')).split('x').map(Number);
mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === '' ? '' : '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
};

/** Something outside the controller's own files (title screen, HUD, menus): reported, but does not fail the run. */
const note = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'todo'}  ${name}${detail === '' ? '' : '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600_000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
  args: [...GPU_ARGS, '--enable-webgl', '--mute-audio', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setUserAgent(IPHONE_UA);
const problems = [];
page.on('pageerror', (e) => problems.push('error: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text());
});
// No real radio stations in an automated run. Quality is deliberately not stored: a phone must pick its own.
await page.evaluateOnNewDocument((key) => {
  try {
    localStorage.setItem(key, JSON.stringify({ liveRadio: false }));
  } catch {
    // No storage.
  }
}, SETTINGS_KEY);

// ───────────── Helpers ─────────────
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const game = (fn, ...args) => page.evaluate(fn, ...args);
/** Centre of an element, in CSS px. */
const at = (selector) =>
  game((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;
  }, selector);
const shown = (id) => game((i) => !!document.querySelector(`.q03-b-${i}.q03-show`), id);
const buttons = () => game(() => [...document.querySelectorAll('.q03-btn.q03-show')].map((n) => n.dataset.th).sort());
/** An element's centre, waiting out the frame or two between a state change and the overlay showing it. */
const atSoon = async (selector, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const p = await at(selector);
    if (p || Date.now() > end) return p;
    await sleep(100);
  }
};
const tap = async (selector) => {
  const p = await atSoon(selector);
  if (!p) throw new Error('nothing to tap at ' + selector);
  await page.touchscreen.tap(p.x, p.y);
  return p;
};
const tapButton = (id) => tap(`.q03-b-${id}.q03-show`);
/** Put a finger down on a button and leave it there. */
const press = async (id) => {
  const p = await atSoon(`.q03-b-${id}.q03-show`);
  if (!p) throw new Error('no button ' + id);
  return page.touchscreen.touchStart(p.x, p.y);
};
/** Drag a finger that is already down, in small steps like a real one. */
const drag = async (finger, from, to, steps = 8, ms = 16) => {
  for (let i = 1; i <= steps; i++) {
    await finger.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(ms);
  }
};
const until = async (fn, ms = 6000, ...args) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await game(fn, ...args);
    if (value || Date.now() > end) return value;
    await sleep(100);
  }
};
const state = () =>
  game(() => {
    const { ctx } = window.dev;
    const p = ctx.player;
    const v = p.vehicle;
    return {
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      yaw: p.cameraHeading,
      sprinting: p.sprinting,
      aiming: p.aiming,
      vehicle: v ? v.spec.id : null,
      speed: v ? v.speed : 0,
      heading: v ? v.heading : p.heading,
      steer: v ? v.controls.steer : 0,
      throttle: v ? v.controls.throttle : 0,
      brake: v ? v.controls.brake : 0,
      handbrake: v ? v.controls.handbrake : false,
      paused: ctx.clock.paused,
      menu: ctx.ui.menuOpen,
      weapon: ctx.combat.current.id,
      radio: ctx.audio.radio.current,
      touch: ctx.input.touch.active,
      quality: ctx.settings.data.quality,
      dynamic: ctx.settings.data.dynamicResolution,
    };
  });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

try {
  // ───────────── Title screen ─────────────
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  await sleep(400);
  await shot('10-title');
  const titleButton = await at('#btn-new');
  note('title: New game is at least 44 px tall', titleButton && titleButton.h >= 44 && titleButton.w >= 44, titleButton && `${Math.round(titleButton.w)} x ${Math.round(titleButton.h)}`);
  await page.touchscreen.tap(titleButton.x, titleButton.y);
  await page.waitForFunction('window.dev !== undefined && document.querySelector("#title") === null', { timeout: 180000 });
  await sleep(1500);

  // ───────────── What a phone gets ─────────────
  let s = await state();
  check('phone default: Low quality, dynamic resolution on', s.quality === 'low' && s.dynamic === true, { quality: s.quality, dynamic: s.dynamic });
  check('controller is up without being asked', s.touch && (await game(() => !!document.querySelector('.q03-touch.q03-on.q03-play'))));
  const viewport = await game(() => document.querySelector('meta[name=viewport]')?.content ?? '');
  check('viewport: no zoom, covers the notch', /user-scalable=no/.test(viewport) && /viewport-fit=cover/.test(viewport), viewport);
  check('page: fixed, no touch scrolling', await game(() => getComputedStyle(document.body).position === 'fixed' && getComputedStyle(document.documentElement).touchAction === 'none'));
  check('on foot: pause, map, view, jump, punch (and skip while Mack talks)', (await buttons()).join() === ['camera', 'fire', 'jump', 'map', 'pause', 'skip'].join(), (await buttons()).join(' '));

  // ───────────── Skip a line of talk ─────────────
  const line = () => game(() => document.querySelector('.nw-sub')?.textContent ?? '');
  const before = await line();
  await shot('11a-foot-talking');
  await tapButton('skip');
  const after = await until((was) => {
    const now = document.querySelector('.nw-sub')?.textContent ?? '';
    return now && now !== was ? now : null;
  }, 2500, before);
  check('skip moves the talk on', !!after && after !== before, `"${before.slice(0, 28)}…" → "${String(after).slice(0, 28)}…"`);
  await game(() => window.dev.ctx.missions.dialogue?.clear?.());
  await sleep(300);
  check('skip goes away when the talking stops', !(await shown('skip')));
  await shot('11-foot');

  // ───────────── Stick, look and a button at once ─────────────
  const start = await state();
  const base = { x: Math.round(W * 0.2), y: Math.round(H * 0.42) };
  const thumb = await page.touchscreen.touchStart(base.x, base.y);
  await drag(thumb, base, { x: base.x, y: base.y - 30 });
  await sleep(900);
  const walking = await state();
  check('stick: half-way walks', dist(start, walking) > 1 && !walking.sprinting, `${dist(start, walking).toFixed(1)} m, sprinting ${walking.sprinting}`);
  check('stick: drawn where the thumb landed', await game((b) => {
    const r = document.querySelector('.q03-stick.q03-show')?.getBoundingClientRect();
    return !!r && Math.abs(r.left + r.width / 2 - b.x) < 3 && Math.abs(r.top + r.height / 2 - b.y) < 3;
  }, base));
  await drag(thumb, { x: base.x, y: base.y - 30 }, { x: base.x, y: base.y - 70 });
  await sleep(900);
  const running = await state();
  check('stick: pushed to the rim sprints', running.sprinting && dist(walking, running) > 3, `${dist(walking, running).toFixed(1)} m in 0.9 s`);

  // Second finger: look. The stick finger stays down.
  const lookFrom = { x: Math.round(W * 0.62), y: Math.round(H * 0.4) };
  const finger = await page.touchscreen.touchStart(lookFrom.x, lookFrom.y);
  await drag(finger, lookFrom, { x: lookFrom.x + 120, y: lookFrom.y });
  await sleep(120);
  const looked = await state();
  check('look: dragging on the right turns the camera', turn(looked.yaw, running.yaw) > 0.4, `${turn(looked.yaw, running.yaw).toFixed(2)} rad for 120 px`);
  check('look: the stick kept working underneath', looked.sprinting && dist(running, looked) > 0.5);

  // Third finger: jump, with the other two still down.
  const y0 = looked.y;
  await tapButton('jump');
  const peak = await game(async (ground) => {
    let top = ground;
    for (let i = 0; i < 40; i++) {
      top = Math.max(top, window.dev.ctx.player.position.y);
      await new Promise((r) => setTimeout(r, 16));
    }
    return top - ground;
  }, y0);
  check('jump: a third finger works while stick and look are held', peak > 0.3, `${peak.toFixed(2)} m off the ground`);
  await shot('12-foot-three-fingers');
  await finger.end();
  await thumb.end();
  await sleep(500);
  const stopped = await state();
  await sleep(500);
  check('letting go stops the player', dist(stopped, await state()) < 0.3);
  check('stick: put away on release', !(await game(() => !!document.querySelector('.q03-stick.q03-show'))));

  // ───────────── Walk to a car and get in ─────────────
  // A parked car is put a few metres ahead, down the camera's line, on a straight piece of road.
  await game(async () => {
    const dev = window.dev;
    await dev.tp('four-aves-start');
    await new Promise((r) => setTimeout(r, 800));
    const { ctx } = dev;
    const p = ctx.player.position;
    const yaw = ctx.player.cameraHeading;
    window.__car = ctx.vehicles.spawn('wagon', p.x + Math.sin(yaw) * 9, p.z + Math.cos(yaw) * 9, yaw + Math.PI / 2, { tags: ['owned'] });
  });
  await sleep(600);
  check('get in: no button until there is something to get into', !(await shown('interact')));
  const walk = await page.touchscreen.touchStart(base.x, base.y);
  await drag(walk, base, { x: base.x, y: base.y - 40 });
  const near = await until(() => !!document.querySelector('.q03-b-interact.q03-show'), 6000);
  await walk.end();
  check('get in: the USE button appears beside the car', near);
  const promptText = await game(() => document.querySelector('.nw-prompt')?.textContent ?? '');
  check('prompt names the button, not a key', /^USE/.test(promptText.trim()), promptText.trim());
  await sleep(200);
  await shot('13-foot-by-car');
  await tapButton('interact');
  await until(() => window.dev.ctx.player.vehicle !== null, 3000);
  s = await state();
  check('get in: tapping USE puts the player in the car', s.vehicle === 'wagon', s.vehicle);
  await sleep(500);
  check('driving: the car controls replace the foot controls', (await buttons()).join() === ['brake', 'camera', 'gas', 'handbrake', 'horn', 'interact', 'lookBack', 'map', 'pause', 'radio'].join(), (await buttons()).join(' '));
  await shot('14-car');

  // ───────────── Drive ─────────────
  const parked = await state();
  const go = await press('gas');
  await sleep(2500);
  const rolling = await state();
  check('accelerate: holding GO moves the car', rolling.speed > 4 && dist(parked, rolling) > 4, `${(rolling.speed * 3.6).toFixed(0)} km/h, ${dist(parked, rolling).toFixed(1)} m`);
  // Steer with the left thumb while the right holds GO.
  const wheel = await page.touchscreen.touchStart(base.x, base.y);
  await drag(wheel, base, { x: base.x - 60, y: base.y });
  await sleep(1200);
  const turning = await state();
  check('steer: stick left steers left with GO still held', turning.steer > 0.5 && turning.throttle === 1 && turn(turning.heading, rolling.heading) > 0.15, `steer ${turning.steer.toFixed(2)}, heading +${turn(turning.heading, rolling.heading).toFixed(2)} rad`);
  await shot('15-car-driving');
  await drag(wheel, { x: base.x - 60, y: base.y }, { x: base.x + 60, y: base.y });
  await sleep(500);
  check('steer: stick right steers right', (await state()).steer < -0.5);
  await wheel.end();
  await sleep(200);
  check('steer: centres on release', Math.abs((await state()).steer) < 0.05);
  // Slide the thumb from GO across to BRAKE without lifting it.
  const gas = await at('.q03-b-gas');
  const brake = await at('.q03-b-brake');
  await drag(go, gas, brake, 6);
  await sleep(200);
  s = await state();
  check('pedals: sliding from GO to BRAKE swaps them', s.throttle === 0 && s.brake === 1, { throttle: s.throttle, brake: s.brake });
  await until(() => Math.abs(window.dev.ctx.player.vehicle.speed) < 0.5, 6000);
  await go.end();
  await sleep(300);
  s = await state();
  check('pedals: both up on release', s.throttle === 0 && s.brake === 0);

  const hand = await press('handbrake');
  await sleep(200);
  check('handbrake: held while the finger is down', (await state()).handbrake === true);
  await hand.end();
  await game(() => {
    window.__horns = 0;
    window.dev.ctx.events.on('horn', () => window.__horns++);
  });
  await tapButton('horn');
  await sleep(300);
  check('horn', (await game(() => window.__horns)) === 1);
  const station = (await state()).radio;
  await tapButton('radio');
  await sleep(400);
  check('radio: next station', (await state()).radio !== station, `${station} → ${(await state()).radio}`);
  const ahead = await state();
  const behind = await press('lookBack');
  await sleep(300);
  check('look behind: while held', turn((await state()).yaw, ahead.heading + Math.PI) < 0.2);
  await behind.end();
  // Free space on the right still looks around in a car.
  const carLook = await page.touchscreen.touchStart(Math.round(W * 0.55), Math.round(H * 0.3));
  await drag(carLook, { x: W * 0.55, y: H * 0.3 }, { x: W * 0.55 + 100, y: H * 0.3 });
  const swung = await state();
  await carLook.end();
  check('look: dragging free space works in a car', turn(swung.yaw, ahead.heading) > 0.3);

  await tapButton('interact');
  await until(() => window.dev.ctx.player.vehicle === null, 3000);
  check('get out: tapping OUT', (await state()).vehicle === null);
  await sleep(400);
  check('on foot again: pedals gone', !(await shown('gas')) && (await shown('jump')));

  // ───────────── Weapons ─────────────
  await game(() => window.dev.arm());
  await sleep(300);
  check('armed: a weapon button appears', await shown('nextWeapon'));
  for (let i = 0; i < 6 && (await state()).weapon !== 'pistol'; i++) {
    await tapButton('nextWeapon');
    await sleep(250);
  }
  s = await state();
  check('next weapon: taps cycle to the pistol', s.weapon === 'pistol', s.weapon);
  const fireWord = await game(() => document.querySelector('.q03-b-fire')?.textContent);
  check('pistol: fire, aim and reload show', fireWord === 'FIRE' && (await shown('aim')) && (await shown('reload')), fireWord);
  await game(() => {
    window.__shots = 0;
    window.dev.ctx.events.on('gunshot', ({ shooter }) => {
      if (shooter === window.dev.ctx.player) window.__shots++;
    });
  });
  const trigger = await press('fire');
  await sleep(1500);
  await trigger.end();
  const fired = await game(() => window.__shots);
  check('fire: holding keeps a pistol firing', fired >= 3, `${fired} shots in 1.5 s`);
  await tapButton('aim');
  await sleep(300);
  check('aim: a tap switches it on', (await state()).aiming === true);
  await shot('16-foot-armed-aiming');
  await tapButton('aim');
  await sleep(300);
  check('aim: a second tap switches it off', (await state()).aiming === false);
  await tapButton('reload');

  // ───────────── Pause menu and map ─────────────
  await tapButton('pause');
  await until(() => window.dev.ctx.ui.menuOpen, 2000);
  s = await state();
  check('pause: the button opens the menu and stops the clock', s.menu && s.paused);
  await sleep(500);
  check('pause: only BACK is left of the controller', (await buttons()).join() === 'back', (await buttons()).join(' '));
  await shot('17-pause');
  const posts = await game(() => [...document.querySelectorAll('.nw-post')].map((n) => n.textContent.trim()));
  for (let i = 0; i < posts.length; i++) {
    const p = await game((n) => {
      const r = document.querySelectorAll('.nw-post')[n].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
    }, i);
    if (/resume|carry on|back to/i.test(posts[i]) || /quit|title|new game/i.test(posts[i])) continue;
    await page.touchscreen.tap(p.x, p.y);
    await sleep(700);
    await shot(`18-pause-${String(i).padStart(2, '0')}-${posts[i].toLowerCase().replace(/[^a-z]+/g, '-')}`);
    const where = await game(() => ({ open: window.dev.ctx.ui.menuOpen, sel: document.querySelector('.nw-post.sel')?.textContent.trim() ?? null }));
    check(`pause: tapping "${posts[i]}"`, where.open, where.sel ?? '');
    if (i === 1) note('pause: menu rows are at least 44 px tall', p.h >= 44, `${Math.round(p.h)} px`);
    // Whatever that opened, BACK returns to the menu (or closes it: then open it again).
    if (await shown('back')) await tapButton('back');
    await sleep(400);
    if (!(await state()).menu) {
      await tapButton('pause');
      await sleep(500);
    }
  }
  // Close with BACK until the game is running again.
  for (let i = 0; i < 4 && (await state()).menu; i++) {
    await tapButton('back');
    await sleep(400);
  }
  s = await state();
  check('pause: BACK closes the menu and the game carries on', !s.menu && !s.paused);
  await tapButton('map');
  await until(() => window.dev.ctx.ui.menuOpen, 2000);
  await sleep(900);
  await shot('19-map');
  check('map: the button opens it', (await state()).menu);
  for (let i = 0; i < 4 && (await state()).menu; i++) {
    await tapButton('back');
    await sleep(400);
  }
  check('map: BACK closes it', !(await state()).menu);

  // ───────────── Menus by touch ─────────────
  await tapButton('pause');
  await until(() => window.dev.ctx.ui.menuOpen, 2000);
  await sleep(400);
  const post = (label) =>
    game((l) => {
      const node = [...document.querySelectorAll('.nw-post')].find((n) => n.textContent.trim().toLowerCase() === l);
      const r = node?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, label);
  const settings = await post('settings');
  await page.touchscreen.tap(settings.x, settings.y);
  await sleep(500);
  const chip = (text) =>
    game((t) => {
      const node = [...document.querySelectorAll('.nw-chip')].find((n) => n.textContent.trim() === t);
      const r = node?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;
    }, text);
  const medium = await chip('Medium');
  await page.touchscreen.tap(medium.x, medium.y);
  await sleep(600);
  check('settings: tapping a quality chip changes it', (await state()).quality === 'medium', `chip ${Math.round(medium.w)} x ${Math.round(medium.h)} px`);
  const low = await chip('Low');
  await page.touchscreen.tap(low.x, low.y);
  await sleep(600);
  const track = await at('.nw-slide-track');
  const volume = () => game(() => window.dev.ctx.settings.data.masterVolume);
  const v0 = await volume();
  const slide = await page.touchscreen.touchStart(track.x, track.y);
  await drag(slide, track, { x: track.x - track.w * 0.3, y: track.y });
  await slide.end();
  const v1 = await volume();
  check('settings: a volume slider drags with a finger', Math.abs(v1 - v0) > 0.1 && v1 < 0.6, `${v0} → ${v1}, track ${Math.round(track.w)} x ${Math.round(track.h)} px`);
  await game((v) => window.dev.ctx.settings.set('masterVolume', v), v0);
  // The list is taller than the panel: it has to scroll under a finger, with the page itself staying put.
  const pane = await game(() => {
    const node = document.querySelector('.nw-panel-scroll');
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.7, room: node.scrollHeight - node.clientHeight };
  });
  const swipe = await page.touchscreen.touchStart(pane.x, pane.y);
  await drag(swipe, pane, { x: pane.x, y: pane.y - 90 }, 10, 20);
  await swipe.end();
  await sleep(400);
  const scrolled = await game(() => ({ top: document.querySelector('.nw-panel-scroll').scrollTop, page: window.scrollY + document.documentElement.scrollTop }));
  check('settings: the list scrolls under a finger and the page does not', (pane.room <= 0 || scrolled.top > 20) && scrolled.page === 0, { room: pane.room, ...scrolled });
  await shot('18-pause-settings-scrolled');
  const resume = await post('resume');
  await tapButton('back');
  await sleep(300);
  await page.touchscreen.tap(resume.x, resume.y);
  await sleep(500);
  check('pause: tapping Resume carries on', !(await state()).menu && !(await state()).paused);

  // The map: one finger pans.
  await tapButton('map');
  await until(() => window.dev.ctx.ui.menuOpen, 2000);
  await sleep(800);
  const mapView = () => game(() => {
    const v = window.dev.ctx.ui.pause?.map?.view;
    return v ? { x: v.x, z: v.z, scale: v.scale } : null;
  });
  const m0 = await mapView();
  const pan = await page.touchscreen.touchStart(W * 0.5, H * 0.5);
  await drag(pan, { x: W * 0.5, y: H * 0.5 }, { x: W * 0.5 - 120, y: H * 0.5 - 40 });
  await pan.end();
  await sleep(300);
  const m1 = await mapView();
  check('map: dragging with one finger pans', !!m0 && !!m1 && Math.hypot(m1.x - m0.x, m1.z - m0.z) > 50, m0 && m1 ? `${Math.round(Math.hypot(m1.x - m0.x, m1.z - m0.z))} m` : 'no view');
  for (let i = 0; i < 4 && (await state()).menu; i++) {
    await tapButton('back');
    await sleep(400);
  }

  // Shop, safehouse and job offers are all the same choice dialog.
  await game(() => {
    window.__choice = null;
    void window.dev.ctx.ui.choose('Sports & guns', 'What will it be?', ['Pistol — $400', 'Cricket bat — $45', 'Nothing today']).then((i) => (window.__choice = i));
  });
  await sleep(500);
  await shot('22-choice');
  const option = await game(() => {
    const r = [...document.querySelectorAll('.nw-option')].filter((n) => n.style.display !== 'none')[1].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
  });
  check('choice: only BACK shows over a dialog', (await buttons()).join() === 'back');
  await page.touchscreen.tap(option.x, option.y);
  await sleep(400);
  check('choice: tapping an option picks it', (await game(() => window.__choice)) === 1, `row ${Math.round(option.h)} px tall`);
  await game(() => {
    window.__choice = null;
    void window.dev.ctx.ui.choose('Aunty Rena', 'Got a job for you.', ['Yeah, righto', 'Not now']).then((i) => (window.__choice = i));
  });
  await sleep(500);
  await tapButton('back');
  await sleep(400);
  check('choice: BACK leaves it', (await game(() => window.__choice)) === -1 && !(await state()).menu);

  // ───────────── Portrait ─────────────
  await page.setViewport({ width: H, height: W, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false });
  await sleep(900);
  s = await state();
  const card = await game(() => {
    const node = document.querySelector('.q03-turn');
    return !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height >= window.innerHeight - 1;
  });
  check('portrait: the "turn your phone" card covers the game, which waits', card && s.paused && (await buttons()).length === 0);
  await shot('20-portrait');
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
  await sleep(900);
  s = await state();
  const fits = await game(() => {
    const c = document.querySelector('#scene');
    return { css: [c.clientWidth, c.clientHeight], inner: [window.innerWidth, window.innerHeight], buffer: [c.width, c.height] };
  });
  check('landscape again: card gone, game running, canvas resized', !s.paused && (await shown('jump')) && fits.css[0] === fits.inner[0] && fits.css[1] === fits.inner[1] && fits.buffer[0] / fits.buffer[1] > 1.5, fits);

  // ───────────── Keyboard takes over, touch takes it back ─────────────
  await page.keyboard.press('KeyV');
  await sleep(300);
  check('a key press hides the controller', !(await game(() => !!document.querySelector('.q03-touch.q03-on'))));
  await page.touchscreen.tap(Math.round(W * 0.6), Math.round(H * 0.5));
  await sleep(300);
  check('the next touch brings it back', await game(() => !!document.querySelector('.q03-touch.q03-on.q03-play')));

  // ───────────── A tap on the game must not also arrive as a mouse click ─────────────
  await game(() => {
    window.__swings = 0;
    window.dev.ctx.combat.select('fists');
    const play = window.dev.ctx.player.playAction.bind(window.dev.ctx.player);
    window.dev.ctx.player.playAction = (pose, seconds) => {
      window.__swings++;
      play(pose, seconds);
    };
  });
  await page.touchscreen.tap(Math.round(W * 0.6), Math.round(H * 0.5));
  await sleep(500);
  check('tapping free space does not throw a punch', (await game(() => window.__swings)) === 0);
  await tapButton('fire');
  await sleep(500);
  check('tapping PUNCH does', (await game(() => window.__swings)) >= 1);
  await shot('21-end');
} catch (err) {
  check('playtest ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  await shot('99-failed').catch(() => undefined);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
if (problems.length) console.log('PAGE PROBLEMS\n' + [...new Set(problems)].join('\n'));
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? ': FAILED ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length || problems.length ? 1 : 0);
