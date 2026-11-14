// Frame times while driving State Highway 1 at speed (chunks streaming in the whole way).
//   node scripts/shot.mjs --place timaru-spawn --time 15 --wait 0.2 --size 1920x1080 --fps 1 --eval "$(cat scripts/playtest/highway.js)"
// (--fps is there to lift the frame-rate cap; the figures that matter are in the `eval` line.)
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
let last = performance.now();
const start = last;
await new Promise((done) => {
  const tick = () => {
    const now = performance.now();
    times.push(now - last);
    last = now;
    if (now - start < SECONDS * 1000) requestAnimationFrame(tick);
    else done();
  };
  requestAnimationFrame(tick);
});
times.sort((a, b) => a - b);
const q = (p) => +times[Math.floor(times.length * p)].toFixed(1);
return {
  frames: times.length,
  fps: +(times.length / SECONDS).toFixed(1),
  p50: q(0.5),
  p95: q(0.95),
  p99: q(0.99),
  worst: +times[times.length - 1].toFixed(1),
  over33: times.filter((t) => t > 33).length,
  kmh: Math.round(Math.abs(ctx.player.vehicle?.speed ?? 0) * 3.6),
  where: ctx.world.locationName(ctx.player.position.x, ctx.player.position.z),
};
