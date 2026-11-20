// Stafford Street walk-ins: rides Stockmans' up escalator and down again, walks into Dekko, then checks the
// Friday-night crowd at the Millstone and the Church Street lights and does a burnout in front of them.
// Prints what happened as [shot] lines and returns a summary.
//
//   node scripts/shot.mjs --place timaru-spawn --hud --eval "$(cat scripts/playtest/stafford.js)" --out shots/stafford.png
const log = (...a) => console.log('[shot]', ...a);
const ctx = dev.ctx;
const p = ctx.player;
const out = {};

// Stockmans: the up escalator's foot, in the store's frame (425.2, 5128, facing east), is local (-1.05, 5); stand just on it.
const store = ctx.world.landmarks.find((l) => l.kind === 'timaru-dept-store');
const toWorld = (lx, lz) => [store.x + lx * Math.cos(store.heading) + lz * Math.sin(store.heading), store.z - lx * Math.sin(store.heading) + lz * Math.cos(store.heading)];
dev.time(11);
const [ux, uz] = toWorld(-1.05, 4.5);
await dev.tp(ux, uz, store.heading + Math.PI);
await sleep(1500);
const floor = p.position.y;
log('foot of the up escalator at', p.position.x.toFixed(1), p.position.z.toFixed(1), 'y', floor.toFixed(2));
let top = floor;
for (let t = 0; t < 36; t++) {
  await sleep(500);
  top = Math.max(top, p.position.y);
  if (t % 4 === 0) log(`  t ${(t / 2).toFixed(1)} s  y ${(p.position.y - floor).toFixed(2)}  at`, p.position.x.toFixed(1), p.position.z.toFixed(1));
}
out.rodeUp = +(top - floor).toFixed(2);
log('rode up', out.rodeUp, 'm');
// Step off and walk forward a little on the first floor.
await dev.hold(['KeyW'], 900);
await sleep(400);
out.upstairs = +(p.position.y - floor).toFixed(2);
dev.look(store.heading, 0.15, 1);
await sleep(800);
log('upstairs at', p.position.x.toFixed(1), p.position.z.toFixed(1), 'height', out.upstairs);

// Down escalator: its top is local (1.05, -4.65).
const [dx, dz] = toWorld(1.05, -4.2);
p.teleport(dx, dz, store.heading);
// teleport puts the player on the ground: lift them back to the first floor.
const body = p.body;
body.setTranslation({ x: dx, y: floor + 4.3 + 0.9, z: dz }, true);
await sleep(600);
log('top of the down escalator, height', (p.position.y - floor).toFixed(2));
let low = p.position.y;
for (let t = 0; t < 36; t++) {
  await sleep(500);
  low = Math.min(low, p.position.y);
}
out.rodeDown = +(low - floor).toFixed(2);
log('rode down to', out.rodeDown);

// Shop staff about.
const staff = [...ctx.actors.all].filter((a) => a.kind === 'ped' && Math.hypot(a.position.x - store.x, a.position.z - store.z) < 30);
out.staffNearStockmans = staff.length;
log('people in and around Stockmans', staff.length, staff.map((a) => (a.position.y - floor).toFixed(1)).join(' '));

// Friday night (day 1 is a Friday): the club and the corner.
ctx.clock.day = 1;
dev.time(22.5);
const corner = ctx.world.place('church-stafford');
await dev.tp(corner.x - 70, corner.z, Math.PI / 2);
await sleep(2500);
await dev.tp(corner.x - 8, corner.z + 30, Math.PI);
await sleep(3000);
const near = (x, z, r) => [...ctx.actors.all].filter((a) => a !== p && Math.hypot(a.position.x - x, a.position.z - z) < r).length;
out.cornerCrowd = near(corner.x, corner.z, 30);
out.racers = ctx.vehicles.all.filter((v) => v.tags.has('townlife')).length;
log('corner crowd', out.cornerCrowd, 'racer cars', out.racers);
// A burnout of our own at the lights.
const v = dev.car('v8sedan');
await sleep(1000);
const money = p.money;
const spins = [];
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
for (let t = 0; t < 10; t++) {
  await sleep(300);
  spins.push(+(v.wheelspin ?? 0).toFixed(2));
}
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
out.wheelspin = Math.max(...spins);
out.moved = +Math.hypot(v.position.x - (corner.x - 8), v.position.z - (corner.z + 30)).toFixed(1);
out.jug = p.money - money;
log('wheelspin', spins.join(' '), 'moved', out.moved, 'm, jug', out.jug);
dev.look(v.heading + Math.PI * 0.75, 0.25, 1.3);
await sleep(600);

const door = ctx.world.place('millstone-door-1');
out.clubCrowd = near(door.x, door.z, 12);
log('club door crowd', out.clubCrowd);
return out;
