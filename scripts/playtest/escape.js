// Losing a two-light pursuit the way the game intends: run until no patrol car has eyes on you, ditch the car
// they are looking for, take another, and drive off quietly. The test autopilot does the driving; the only
// shortcut is that the second car is put beside the first rather than found in a street.
//   node scripts/shot.mjs --place four-aves-start --hud --eval "$(cat scripts/playtest/escape.js)"
const ctx = dev.ctx;
const player = ctx.player;
const log = [];
const t0 = performance.now();
const note = (what) => {
  const p = player.position;
  const cops = ctx.vehicles.all.filter((v) => v.spec.id === 'police' && !v.destroyed).map((v) => Math.round(Math.hypot(v.position.x - p.x, v.position.z - p.z))).sort((a, b) => a - b);
  log.push(Math.round((performance.now() - t0) / 1000) + 's | heat ' + ctx.police.level + ' | ' + (ctx.police.intel?.seen ? 'seen' : 'unseen') + ' | cops at ' + (cops.slice(0, 3).join(', ') || 'none') + ' m | ' + what);
};
dev.car('v8sedan');
await sleep(1200);
dev.heat(2);
note('two lights, in the V8 they are looking for');
// Run for it, in short legs, until nobody can see the car and the nearest patrol car is well back.
let clear = 0;
for (let leg = 0; leg < 14 && clear < 2; leg++) {
  await dev.driveTo('lancaster-park', undefined, { timeout: 5, speed: 31, aggression: 1.9 });
  const p = player.position;
  const nearest = Math.min(Infinity, ...ctx.vehicles.all.filter((v) => v.spec.id === 'police' && !v.destroyed).map((v) => Math.hypot(v.position.x - p.x, v.position.z - p.z)));
  clear = !ctx.police.intel?.seen && nearest > 110 ? clear + 1 : 0;
  note('running: ' + Math.round(Math.abs(player.vehicle?.speed ?? 0) * 3.6) + ' km/h, ' + ctx.world.locationName(p.x, p.z));
  if (!player.vehicle || !player.alive) break;
}
if (!player.alive || ctx.police.level === 0) return { result: player.alive ? 'heat already gone' : 'died', log };
// Ditch the car and take another.
const old = player.vehicle;
if (old) {
  old.controls.throttle = 0;
  old.controls.brake = 1;
  await sleep(1800);
  dev.tap('KeyF');
  await sleep(1200);
}
const h = player.heading;
const fresh = ctx.vehicles.spawn('hatch', player.position.x + Math.cos(h) * 5, player.position.z - Math.sin(h) * 5, h, {});
await sleep(400);
const door = player.position.clone();
fresh.doorPosition(door, 0);
player.teleport(door.x, door.z, fresh.heading);
await sleep(300);
dev.tap('KeyF');
await sleep(1500);
note(player.vehicle === fresh ? 'swapped into a ' + fresh.spec.name : 'FAILED to get into the second car');
// Drive off under the limit and watch the lights go out.
for (let leg = 0; leg < 12 && ctx.police.level > 0 && player.alive; leg++) {
  await dev.driveTo('new-brighton-beach', undefined, { timeout: 6, speed: 14, aggression: 1 });
  note('driving quietly: ' + Math.round(Math.abs(player.vehicle?.speed ?? 0) * 3.6) + ' km/h');
}
return { result: ctx.police.level === 0 && player.alive ? 'lost them' : 'still wanted (heat ' + ctx.police.level + ')', seconds: Math.round((performance.now() - t0) / 1000), log };
