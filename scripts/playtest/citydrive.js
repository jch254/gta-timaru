// Frame times while driving through central Christchurch (Moorhouse Avenue, 70 km/h, traffic and trees):
// the town counterpart of highway.js, with each frame over 20 ms put down to a system.
//   node scripts/shot.mjs --place four-aves-start --car statesman --time 15 --wait 0.2 --size 1920x1080 --fps 1 --eval "$(cat scripts/playtest/citydrive.js)"
const ctx = dev.ctx;
dev.driveTo('lancaster-park', undefined, { timeout: 80, speed: 20, aggression: 1.3 });
await sleep(3000);
const SECONDS = 25;
const times = [];
const slow = [];
const info = ctx.gfx.renderer.info;
let programs = info.programs?.length ?? 0;
let last = performance.now();
const start = last;
await new Promise((done) => {
  const tick = () => {
    const now = performance.now();
    const ms = now - last;
    times.push(ms);
    const made = (info.programs?.length ?? 0) - programs;
    programs = info.programs?.length ?? 0;
    if (ms > 20) {
      const cost = {};
      for (const [k, v] of Object.entries(dev.game.frameCost ?? {})) if (v > 1) cost[k] = +v.toFixed(1);
      slow.push({ at: +((now - start) / 1000).toFixed(1), ms: +ms.toFixed(1), cost, newPrograms: made });
    }
    last = now;
    if (now - start < SECONDS * 1000) requestAnimationFrame(tick);
    else done();
  };
  requestAnimationFrame(tick);
});
const sorted = [...times].sort((a, b) => a - b);
const q = (p) => +sorted[Math.floor(sorted.length * p)].toFixed(1);
slow.sort((a, b) => b.ms - a.ms);
const p = ctx.player.position;
return { frames: times.length, fps: +(times.length / SECONDS).toFixed(1), p50: q(0.5), p99: q(0.99), worst: +sorted[sorted.length - 1].toFixed(1), over20: slow.length, over33: times.filter((t) => t > 33).length, kmh: Math.round(Math.abs(ctx.player.vehicle?.speed ?? 0) * 3.6), where: [Math.round(p.x), Math.round(p.z)], slowest: slow.slice(0, 6) };
