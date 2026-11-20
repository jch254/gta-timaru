// Run against dist only. ?dev exposes scenario setup/inspection in the shipping bundle.
import assert from 'node:assert/strict';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { checkShadowBudget } from './playtest/shadow-budget.mjs';
import { CHROME, GPU_ARGS, SETTINGS_KEY, newGame } from './lib.mjs';

const engine = process.env.BROWSER || 'chrome';
assert(['chrome', 'firefox'].includes(engine));
const firefox = engine === 'firefox';
const server = await preview({ appType: 'mpa', preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({
    browser: engine,
    executablePath: firefox ? process.env.FIREFOX_PATH : CHROME,
    headless: !(firefox && process.env.DISPLAY),
    defaultViewport: { width: 800, height: 480 },
    args: firefox ? [] : process.platform === 'darwin' ? GPU_ARGS : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    extraPrefsFirefox: { 'webgl.force-enabled': true },
    protocolTimeout: 120_000,
  });
  console.log('Testing', await browser.version());
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => { console.error(e); errors.push(e.message); });
  page.on('response', r => {
    if (r.url().startsWith(origin + '/') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  const until = fn => page.waitForFunction(fn, { polling: 100 });
  const ready = () => until(() => window.dev && !document.querySelector('#title'));
  const menu = label => page.evaluate(label => {
    const post = [...document.querySelectorAll('.nw-pause.on .nw-post')].find(el => el.textContent === label);
    if (!post) throw new Error(`Missing pause action: ${label}`);
    post.click();
  }, label);
  await page.evaluateOnNewDocument(key => localStorage.setItem(key, JSON.stringify({ quality: 'low', liveRadio: false })), SETTINGS_KEY);
  await page.goto(origin + '/?dev');
  await newGame(page);
  await ready();
  await page.evaluate(async () => { await dev.tp('caroline-bay'); dev.money(1234); });
  await page.keyboard.press('p');
  await until(() => dev.ctx.clock.paused && document.querySelector('.nw-pause.on'));
  await menu('Save game');
  const saved = await page.evaluate(() => {
    const { player } = dev.ctx;
    return { raw: localStorage.getItem('03-quest.save.v1'), money: player.money, x: player.position.x, z: player.position.z };
  });
  assert(saved.raw, 'Save game must create a slot');
  await page.evaluate(() => {
    dev.money(777);
    const write = Storage.prototype.setItem;
    window.blockedWrites = 0;
    Storage.prototype.setItem = function(key, value) {
      if (key === '03-quest.save.v1' && this === localStorage) {
        window.blockedWrites++;
        throw new DOMException('Simulated full storage', 'QuotaExceededError');
      }
      return write.call(this, key, value);
    };
  });
  await menu('Save game');
  const failure = await page.evaluate(() => ({ raw: localStorage.getItem('03-quest.save.v1'), attempts: window.blockedWrites, note: document.querySelector('.nw-pane-save').innerText }));
  assert(failure.attempts > 0);
  assert.equal(failure.raw, saved.raw, 'failed write replaced the good slot');
  if (!/not saved|could not save|failed to save/i.test(failure.note)) errors.push(`Failed save not disclosed: ${failure.note}`);
  await page.reload();
  await page.click('#btn-continue:not([hidden])');
  await ready();
  const restored = await page.evaluate(() => {
    const { money, position: { x, z } } = dev.ctx.player;
    return { money, x, z };
  });
  assert.equal(restored.money, saved.money);
  assert(Math.hypot(restored.x - saved.x, restored.z - saved.z) < 5, 'Continue did not restore position');
  await page.keyboard.press('p');
  await until(() => dev.ctx.clock.paused);
  const pausedAt = await page.evaluate(() => dev.ctx.clock.elapsed);
  await menu('Resume');
  await page.waitForFunction(t => !dev.ctx.clock.paused && dev.ctx.clock.elapsed > t, {}, pausedAt);
  console.log('Continue and pause/resume passed');

  // Set up just outside Templeton. From here only the throttle moves the car, along the same named road.
  await page.evaluate(async () => {
    await dev.tp(-1297, -3056, 0);
    window.testCar = dev.car('v8sedan');
  });
  await until(() => dev.ctx.player.vehicle === window.testCar && document.querySelector('.nw-loc-title').textContent === 'Main South Road');
  assert.notEqual(await page.evaluate(() => dev.ctx.world.districtAt(testCar.position.x, testCar.position.z).id), 'templeton');
  await page.keyboard.down('w');
  try {
    await until(() => dev.ctx.player.vehicle === testCar && testCar.driver === dev.ctx.player && testCar.speed > 1 &&
      dev.ctx.world.districtAt(testCar.position.x, testCar.position.z).id === 'templeton' &&
      document.querySelector('.nw-loc-sub').textContent.includes('Templeton'));
  } finally { await page.keyboard.up('w'); }
  console.log('District crossing passed');

  // Use the authored retry point to skip dialogue and approach. The runner recreates and seats us in its V8.
  await page.evaluate(async () => {
    await dev.tp('four-aves-start');
    const runner = dev.ctx.missions.runner;
    const def = runner.def('four-avenues');
    const index = def.steps.findIndex(s => s.kind === 'checkpoint' && s.label === 'the grid');
    const { label, at } = def.steps[index];
    for (const id of def.requires) runner.done.add(id);
    if (!runner.start(def.id, { index, label, at })) throw new Error('Could not start Four Aves');
  });
  await until(() => dev.step()?.kind === 'race' && dev.step().run.scratch.data.go);
  await page.evaluate(async () => {
    const { run } = dev.step();
    const { player, world } = dev.ctx;
    window.original = run.vehicle('v8');
    if (!original || player.vehicle !== original) throw new Error('Retry did not restore mission car');
    const cp = run.scratch.data.cps[0];
    await world.whenLoaded(cp.x, cp.z);
    window.substitute = dev.car(original.spec.id);
    substitute.teleport(cp.x, world.groundAt(cp.x, cp.z), cp.z, cp.heading);
  });
  // Observe actual mission ticks at the checkpoint before checking for *absence* of progress.
  await until(() => dev.ctx.player.vehicle === substitute && dev.ctx.player.position.distanceTo(substitute.position) < 2 &&
    Math.hypot(dev.ctx.player.position.x - dev.step().run.scratch.data.cps[0].x, dev.ctx.player.position.z - dev.step().run.scratch.data.cps[0].z) < 10);
  const tick = await page.evaluate(() => dev.step().run.stepTime);
  await page.waitForFunction(t => dev.step().run.stepTime > t + 0.5, {}, tick);
  assert.equal(await page.evaluate(() => dev.step().run.scratch.data.next), 0, 'substitute collected a checkpoint');
  await page.evaluate(() => {
    const { player, world } = dev.ctx;
    player.warpIntoVehicle(original);
    const cp = dev.step().run.scratch.data.cps[0];
    original.teleport(cp.x + 6, world.groundAt(cp.x + 6, cp.z), cp.z, cp.heading);
  });
  await until(() => dev.ctx.player.vehicle === original && dev.step().run.scratch.data.next === 1);
  console.log('Mission vehicle swap passed');
  await checkShadowBudget(page);
  assert.deepEqual(errors, [], 'Production browser gate');
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
