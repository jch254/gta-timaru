// Drive the Lyttelton road tunnel both ways, then Summit Road over the top of it, and report where the car
// stopped, what it hit and whether the player came through.
//   node scripts/shot.mjs --at 1300,-3420 --hud --eval "$(cat scripts/playtest/tunnel.js)" --out shots/tunnel.png
const log = (...a) => console.log('[shot]', ...a);
const { ctx } = dev;
dev.god(false);
dev.time(12);
const legs = [
  { name: 'tunnel north to south', from: [1300, -3420, 0], to: [1300, -2380] },
  { name: 'tunnel south to north', from: [1300, -2380, Math.PI], to: [1300, -3420] },
];
const results = [];
for (const leg of legs) {
  const [x, z, heading] = leg.from;
  await dev.tp(x, z, heading);
  await sleep(1500);
  const v = dev.car('statesman');
  await sleep(500);
  let crashes = 0;
  let lowest = Infinity;
  const onCrash = ({ vehicle, speed }) => {
    if (vehicle !== v || speed < 6) return;
    crashes++;
    log('crash', speed.toFixed(1), 'at', v.position.x.toFixed(0), v.position.y.toFixed(1), v.position.z.toFixed(0));
  };
  ctx.events.on('vehicleCrash', onCrash);
  const timer = setInterval(() => {
    lowest = Math.min(lowest, v.position.y);
    log(leg.name, 'at', v.position.x.toFixed(0), v.position.y.toFixed(1), v.position.z.toFixed(0), (Math.abs(v.speed) * 3.6).toFixed(0) + ' km/h', 'hp', Math.round(v.health));
  }, 2000);
  const end = await dev.driveTo(leg.to[0], leg.to[1], { timeout: 90, speed: 22 });
  clearInterval(timer);
  ctx.events.off?.('vehicleCrash', onCrash);
  results.push(`${leg.name}: ${end}; crashes ${crashes}; lowest y ${lowest.toFixed(1)}; player ${ctx.player.alive ? 'alive' : 'dead'}`);
  log(results[results.length - 1]);
  if (!ctx.player.alive) await sleep(8000);
}
// Summit Road crosses the top of the bore at (1300, -2800): straight across it, east then west, on full throttle.
for (const [x0, heading] of [[1235, Math.atan2(1, 0)], [1365, Math.atan2(-1, 0)]]) {
  const name = `Summit Road over the tunnel, heading ${heading > 0 ? 'east' : 'west'}`;
  const on = ctx.world.graph.nearest(x0, -2799, 30, (e) => e.name === 'Summit Road');
  const x = on.x;
  const z = on.z;
  await dev.tp(x, z, heading);
  await sleep(1500);
  const v = ctx.player.vehicle ?? dev.car('statesman');
  if (ctx.player.vehicle !== v) ctx.player.warpIntoVehicle(v);
  v.teleport(x, on.y, z, heading);
  await sleep(500);
  v.controller = 'mission';
  v.controls.handbrake = false;
  v.controls.brake = 0;
  v.controls.throttle = 0.7;
  let lowest = Infinity;
  const t0 = performance.now();
  while (performance.now() - t0 < 7000) {
    if (Math.abs(v.position.x - 1300) < 30) lowest = Math.min(lowest, v.position.y);
    await sleep(100);
  }
  v.controls.throttle = 0;
  v.controls.brake = 1;
  v.controller = 'player';
  results.push(`${name}: reached x ${v.position.x.toFixed(0)} at y ${v.position.y.toFixed(1)}; lowest over the bore y ${lowest.toFixed(1)}; player ${ctx.player.alive ? 'alive' : 'dead'}`);
  log(results[results.length - 1]);
}
return results.join('\n');
