// A three-star pursuit across Christchurch with the test autopilot at the wheel: logs heat, speed, car health
// and the nearest patrol cars every five seconds.
//   node scripts/shot.mjs --place four-aves-start --hud --eval "$(cat scripts/playtest/chase.js)"
const ctx = dev.ctx;
dev.car('v8sedan');
await sleep(1500);
dev.heat(3);
const log = [];
let done = null;
dev.driveTo('new-brighton-beach', undefined, { timeout: 95, speed: 36, aggression: 2 }).then((r) => (done = r));
const t1 = performance.now();
while (!done && performance.now() - t1 < 100000) {
  await sleep(5000);
  const p = ctx.player.position;
  const cops = ctx.vehicles.all
    .filter((v) => v.spec.id === 'police' && !v.destroyed)
    .map((v) => ({ d: Math.round(Math.hypot(v.position.x - p.x, v.position.z - p.z)), k: Math.round(Math.abs(v.speed) * 3.6) }))
    .sort((a, b) => a.d - b.d);
  log.push(
    [
      Math.round((performance.now() - t1) / 1000) + 's',
      'heat ' + ctx.police.level,
      Math.round(Math.abs(ctx.player.vehicle?.speed ?? 0) * 3.6) + ' km/h',
      'car ' + Math.round(ctx.player.vehicle?.health ?? 0),
      'me ' + Math.round(ctx.player.health),
      cops.slice(0, 4).map((c) => c.d + 'm@' + c.k).join(' '),
      ctx.police.intel?.seen ? 'seen' : 'unseen',
      ctx.world.locationName(p.x, p.z),
    ].join(' | '),
  );
}
return { done, log };
