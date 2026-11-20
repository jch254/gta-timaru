#!/usr/bin/env node
// Save, reload the page, Continue: checks that money and position come back. Start `pnpm dev` first.
//   node scripts/playtest/continue.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS, newGame } from '../lib.mjs';

const url = process.argv[2] || DEV_URL;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 720 },
  args: [...GPU_ARGS, '--mute-audio'],
});
try {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(m.text());
  });
  const start = async (button) => {
    await page.goto(url + '?dev', { waitUntil: 'domcontentloaded' });
    if (button === '#btn-new') await newGame(page);
    else {
      await page.waitForSelector(button + ':not([hidden])', { timeout: 30000 });
      await page.click(button);
    }
    await page.waitForFunction('window.dev !== undefined && document.querySelector("#title") === null', { timeout: 90000 });
  };
  await start('#btn-new');
  const saved = await page.evaluate(async () => {
    const dev = window.dev;
    await dev.tp('caroline-bay');
    dev.money(1234);
    await new Promise((r) => setTimeout(r, 500));
    dev.ctx.save.save();
    const p = dev.ctx.player.position;
    return { money: dev.ctx.player.money, x: Math.round(p.x), z: Math.round(p.z) };
  });
  await start('#btn-continue');
  const loaded = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const dev = window.dev;
    const p = dev.ctx.player.position;
    return { money: dev.ctx.player.money, x: Math.round(p.x), z: Math.round(p.z), where: dev.ctx.world.locationName(p.x, p.z) };
  });
  const ok = loaded.money === saved.money && Math.hypot(loaded.x - saved.x, loaded.z - saved.z) < 5;
  console.log(JSON.stringify({ saved, loaded, ok, problems }));
  process.exitCode = ok && problems.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
