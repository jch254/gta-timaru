// Blow up a car with people standing round it, on foot and a safe way back: checks the fireball, smoke,
// debris and the gore (who was killed, how much blood and how many decals it left). The shot is taken
// `AT` seconds after the blast (default 0.35; prefix the eval with `const AT = 2;` for later moments).
//   node scripts/shot.mjs --place four-aves-start --time 13 --wait 0 --size 960x540 --eval "$(cat scripts/playtest/blast.js)" --out shots/blast.png
const ctx = dev.ctx;
const fx = ctx.combat.fx;
const at = typeof AT === 'number' ? AT : 0.35;
const out = {};
let died = 0;
let blown = 0;
const offs = [
  ctx.events.on('actorDied', (e) => {
    died++;
    if (e.info.kind === 'explosion') blown++;
  }),
];
ctx.police.enabled = false;
ctx.traffic.density = 0;
dev.god();

const spot = ctx.world.place('four-aves-start');
const laneZ = spot.z + 6;
await dev.tp(spot.x, laneZ, Math.PI / 2);
await sleep(800);
// A car 16 m ahead, people round it: two close, two further out.
const car = ctx.vehicles.spawn('v8sedan', spot.x + 16, laneZ, 0, {});
const spots = [[1.6, 1.8], [-1.5, -2], [4.5, 2.5], [-3.5, 4]];
const peds = spots.map(([dx, dz]) => ctx.peds.spawn({ x: car.position.x + dx, z: laneZ + dz, heading: 0, behaviour: 'stand', persistent: true }));
dev.look(Math.PI / 2, 0.12, 1.4);
await sleep(1200);
const before = { decals: fx.decals.active };
ctx.combat.explode(car.position.clone(), 9, 120, ctx.player);
await sleep(at * 1000);
out.at = at;
out.smoke = fx.smoke.alive;
out.glow = fx.glow.alive;
out.decals = fx.decals.active - before.decals;
out.died = died;
out.blown = blown;
out.pedsDead = peds.filter((p) => !p.alive).length;
for (const off of offs) off();
return out;
