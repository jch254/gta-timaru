// Run people down, back over them, then shoot and bat someone on foot: checks that a hit throws the body, the
// wheels finish whoever is lying in the road, blood lands on the road, the car and under the bodies, and the
// cries are asked for. The police and traffic are stood down so nothing else gets in the way.
//   node scripts/shot.mjs --place four-aves-start --time 13 --hud --wait 1 --eval "$(cat scripts/playtest/rampage.js)" --out shots/rampage.png
const ctx = dev.ctx;
const player = ctx.player;
const fx = ctx.combat.fx;
const out = {};
const seen = { struck: 0, under: 0, underDead: 0, died: 0, byCar: 0, hitAndRun: 0, murder: 0 };
const sounds = {};
const offs = [
  ctx.events.on('vehicleHitActor', (e) => {
    if (!e.under) seen.struck++;
    else if (e.actor.alive) seen.under++;
    else seen.underDead++;
  }),
  ctx.events.on('actorDied', (e) => {
    seen.died++;
    if (e.info.kind === 'vehicle') seen.byCar++;
  }),
  ctx.events.on('crime', (e) => {
    if (e.type in seen) seen[e.type]++;
  }),
];
// Count the cries the audio system is asked for (it may be muted headless; the request is what matters here).
const emit = ctx.audio.emit.bind(ctx.audio);
ctx.audio.emit = (id, ...rest) => {
  sounds[id] = (sounds[id] ?? 0) + 1;
  return emit(id, ...rest);
};
ctx.police.enabled = false;
ctx.traffic.density = 0;
dev.god();

// Eastbound on Moorhouse Avenue: long and straight.
const spot = ctx.world.place('four-aves-start');
const laneZ = spot.z + 9 - 3;
await dev.tp(spot.x + 20, laneZ, Math.PI / 2);
await sleep(800);
const car = dev.car('v8sedan');
await sleep(1200);
const victims = [];
for (let i = 0; i < 6; i++) {
  victims.push(ctx.peds.spawn({ x: car.position.x + 28 + i * 8, z: laneZ + (i % 2 ? 0.35 : -0.35), heading: -Math.PI / 2, behaviour: 'stand', persistent: true }));
}
const start = victims.map((v) => v.position.clone());
let lift = 0;
let topKmh = 0;
const watch = setInterval(() => {
  for (const v of victims) lift = Math.max(lift, v.group.position.y - v.position.y);
  topKmh = Math.max(topKmh, Math.abs(car.speed) * 3.6);
}, 30);
await sleep(400);

// Floor it through them, then stop.
await dev.hold(['KeyW'], 5000);
await dev.hold(['KeyS'], 2200);
await sleep(1500);
out.firstPass = { ...seen, topKmh: Math.round(topKmh), liftM: +lift.toFixed(2) };
out.thrownM = victims.map((v, i) => +v.position.distanceTo(start[i]).toFixed(1));

// Back over each of them: lined up on the body, a short roll forward across it.
for (const v of victims.filter((p) => !p.alive)) {
  const cx = v.position.x - Math.sin(v.heading) * 0.7;
  const cz = v.position.z - Math.cos(v.heading) * 0.7;
  car.teleport(cx + 7, ctx.world.groundAt(cx + 7, cz), cz, -Math.PI / 2);
  await sleep(500);
  await dev.hold(['KeyW'], 2200);
  await dev.hold(['KeyS'], 900);
  await sleep(300);
}
await sleep(1200);
out.afterReversing = { ...seen };
out.dead = victims.filter((v) => !v.alive).length;
out.stillMoving = victims.filter((v) => !v.alive && v.velocity.lengthSq() > 0.01).length;
out.decalsAfterDriving = fx.decals.active;

// On foot: a pistol and a bat.
dev.tap('KeyF');
await sleep(1800);
dev.arm();
const h = player.heading;
const ahead = (d) => ({ x: player.position.x + Math.sin(h) * d, z: player.position.z + Math.cos(h) * d });
const a = ahead(6);
const target = ctx.peds.spawn({ x: a.x, z: a.z, heading: h + Math.PI, behaviour: 'stand', persistent: true });
await sleep(300);
const before = { decals: fx.decals.active };
for (let i = 0; i < 6 && target.alive; i++) {
  const from = player.position.clone().setY(player.position.y + 1.4);
  const to = target.position.clone().setY(target.position.y + 1.1);
  ctx.combat.fire(player, 'pistol', from, to.sub(from).normalize());
  await sleep(350);
}
out.shotDead = !target.alive;
const b = ahead(1.1);
const batted = ctx.peds.spawn({ x: b.x, z: b.z, heading: h + Math.PI, behaviour: 'stand', persistent: true, health: 60 });
await sleep(300);
for (let i = 0; i < 4 && batted.alive; i++) {
  ctx.combat.melee(player, ctx.combat.weapons.get('bat').damage, 2);
  await sleep(500);
}
out.battedDead = !batted.alive;
await sleep(1200);
out.decalsFromFoot = fx.decals.active - before.decals;
out.sounds = Object.fromEntries(['bodyHit', 'crunch', 'pain', 'scream', 'deathCry', 'punch'].map((id) => [id, sounds[id] ?? 0]));
out.audioErrors = ctx.audio.debug().errors;
out.final = { ...seen };

// Look back down the road at it all.
const bodies = victims.filter((v) => !v.alive);
if (bodies.length) {
  let x = 0;
  let z = 0;
  for (const v of bodies) {
    x += v.position.x;
    z += v.position.z;
  }
  x /= bodies.length;
  z /= bodies.length;
  player.teleport(x - 9, z + 6, Math.atan2(9, -6));
  await sleep(500);
  dev.look(Math.atan2(9, -6), 0.42, 1.6);
}
for (const off of offs) off();
ctx.audio.emit = emit;
return out;
