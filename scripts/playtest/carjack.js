// Walk, take a parked car, drive it, get out, then pull a driver out of a moving one: the basic loop, by key
// presses only (no dev shortcuts once in position).
//   node scripts/shot.mjs --place four-aves-start --hud --eval "$(cat scripts/playtest/carjack.js)"
const ctx = dev.ctx;
const player = ctx.player;
const out = {};
// Walk forward for two seconds.
const p0 = player.position.clone();
await dev.hold(['KeyW'], 2000);
out.walked = +player.position.distanceTo(p0).toFixed(1);
// A parked car: stand at its door and press F.
const parked = ctx.vehicles.spawn('hatch', player.position.x + 6, player.position.z + 3, 0, {});
await sleep(600);
const door = player.position.clone();
parked.doorPosition(door, 0);
player.teleport(door.x, door.z, parked.heading);
await sleep(300);
dev.tap('KeyF');
await sleep(1500);
out.inParked = player.vehicle === parked;
let peak = 0;
const watch = setInterval(() => (peak = Math.max(peak, Math.abs(parked.speed))), 100);
await dev.hold(['KeyW'], 3500);
clearInterval(watch);
out.peakKmh = Math.round(peak * 3.6); // (it may well have hit something by the end: nobody is steering)
await dev.hold(['Space'], 1800);
dev.tap('KeyF');
await sleep(1500);
out.gotOut = player.vehicle === null;
// Somebody else's car, with them in it.
const heatBefore = ctx.police.level;
const victim = ctx.vehicles.all.filter((v) => v.driver && v.driver !== player && v.spec.cls !== 'police' && v.spec.cls !== 'bus').sort((a, b) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position))[0];
if (victim) {
  for (let i = 0; i < 12 && player.vehicle !== victim; i++) {
    victim.doorPosition(door, 0);
    player.teleport(door.x, door.z, victim.heading);
    await sleep(120);
    dev.tap('KeyF');
    await sleep(900);
  }
  out.jacked = player.vehicle === victim ? victim.spec.name : false;
  await sleep(2500);
  out.heat = heatBefore + ' -> ' + ctx.police.level;
} else out.jacked = 'no occupied car nearby';
return out;
