// Where the slow frames on the highway drive come from. Same drive as highway.js, but every frame over
// 20 ms is kept with what the game spent in each system that frame (Game.frameCost) and what the renderer
// was asked to draw, so a stall can be put down to chunk building, a shader being compiled, the sky's
// reflection map, and so on.
//   node scripts/shot.mjs --place timaru-spawn --time 15 --wait 0.2 --size 1920x1080 --fps 1 --eval "$(cat scripts/playtest/hitches.js)"
const ctx = dev.ctx;
const hit = ctx.world.graph.nearest(-1318, -1500, 300, (e) => e.drivable && e.cls === 'highway');
await dev.tp(hit.x, hit.z);
await sleep(500);
dev.car('statesman');
await sleep(1000);
dev.driveTo('ashburton-stock-agent', undefined, { timeout: 60, speed: 38, aggression: 1.4 });
await sleep(4000);

const SECONDS = 22;
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
      slow.push({ at: +((now - start) / 1000).toFixed(2), ms: +ms.toFixed(1), cost, newPrograms: made, queue: ctx.world.queue?.length ?? -1, calls: info.render.calls });
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
return {
  frames: times.length,
  fps: +(times.length / SECONDS).toFixed(1),
  p50: q(0.5),
  p99: q(0.99),
  worst: +sorted[sorted.length - 1].toFixed(1),
  over20: slow.length,
  over33: times.filter((t) => t > 33).length,
  programs,
  slowest: slow.slice(0, 8),
};
