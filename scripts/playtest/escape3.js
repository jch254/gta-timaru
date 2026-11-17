// Losing a THREE-light pursuit, where they shoot and throw up roadblocks — the case the report admitted
// nobody had tried. Same honest method as escape.js: run until nobody has eyes on you, ditch the car they
// are looking for, take another, drive off quietly. The only shortcut is the second car being put beside
// the first. Reports whether it can be done, how long it takes, and what state the car was in.
//   node scripts/shot.mjs --place four-aves-start --hud --eval "$(cat scripts/playtest/escape3.js)"
const ctx = dev.ctx;
const player = ctx.player;
const log = [];
const t0 = performance.now();
const note = (what) => {
  const p = player.position;
  const cops = ctx.vehicles.all.filter((v) => v.spec.id === 'police' && !v.destroyed).map((v) => Math.round(Math.hypot(v.position.x - p.x, v.position.z - p.z))).sort((a, b) => a - b);
  log.push(Math.round((performance.now() - t0) / 1000) + 's | heat ' + ctx.police.level + ' | ' + (ctx.police.intel?.seen ? 'seen' : 'unseen') + ' | hp ' + Math.round(player.health) + ' car ' + (player.vehicle ? Math.round(player.vehicle.health) : '-') + ' | cops at ' + (cops.slice(0, 3).join(', ') || 'none') + ' m | ' + what);
};
dev.car('v8sedan');
await sleep(1200);
dev.heat(3);
note('three lights, in the V8 they are looking for');
let clear = 0;
for (let leg = 0; leg < 30 && clear < 3; leg++) {
  await dev.driveTo(leg % 2 === 0 ? 'lancaster-park' : 'new-brighton-beach', undefined, { timeout: 5, speed: 33, aggression: 2 });
  const p = player.position;
  const nearest = Math.min(Infinity, ...ctx.vehicles.all.filter((v) => v.spec.id === 'police' && !v.destroyed).map((v) => Math.hypot(v.position.x - p.x, v.position.z - p.z)));
  clear = !ctx.police.intel?.seen && nearest > 200 ? clear + 1 : 0;
  note('running: ' + Math.round(Math.abs(player.vehicle?.speed ?? 0) * 3.6) + ' km/h, ' + ctx.world.locationName(p.x, p.z));
  if (!player.vehicle || player.vehicle.destroyed || !player.alive) break;
}
if (!player.alive) return { result: 'died', log };
if (ctx.police.level === 0) return { result: 'heat already gone', seconds: Math.round((performance.now() - t0) / 1000), log };
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
for (let leg = 0; leg < 24 && ctx.police.level > 0 && player.alive; leg++) {
  await dev.driveTo('new-brighton-beach', undefined, { timeout: 6, speed: 14, aggression: 1 });
  note('driving quietly: ' + Math.round(Math.abs(player.vehicle?.speed ?? 0) * 3.6) + ' km/h');
}
return { result: ctx.police.level === 0 && player.alive ? 'lost them' : player.alive ? 'still wanted (heat ' + ctx.police.level + ')' : 'died', seconds: Math.round((performance.now() - t0) / 1000), log };
