// Wound someone and let them run: checks they leave a trail of drops (the Drop decal ring) while they bleed,
// that a rifle round through the head throws gore, and that it all stays within budget.
//   node scripts/shot.mjs --place four-aves-start --time 13 --wait 0 --eval "$(cat scripts/playtest/bleed.js)" --out shots/bleed.png
const ctx = dev.ctx;
const player = ctx.player;
const fx = ctx.combat.fx;
const decals = fx.decals;
const ring = 6; // DecalRing.Drop
const drops = () => {
  let n = 0;
  for (let i = decals.ringStart[ring]; i < decals.ringStart[ring] + decals.ringSize[ring]; i++) n += decals.live[i];
  return n;
};
const out = {};
ctx.police.enabled = false;
ctx.traffic.density = 0;
dev.god();
const spot = ctx.world.place('four-aves-start');
const z = spot.z + 6;
await dev.tp(spot.x, z, Math.PI / 2);
await sleep(800);
const ped = ctx.peds.spawn({ x: spot.x + 5, z, heading: -Math.PI / 2, behaviour: 'stand', persistent: true });
await sleep(500);
const before = drops();
const dir = ped.position.clone().set(1, 0, 0);
ped.takeDamage({ amount: ped.maxHealth * 0.45, kind: 'bullet', source: player, point: ped.position.clone(), direction: dir });
const from = ped.position.clone();
ped.setBehaviour('flee', player);
await sleep(6000);
out.alive = ped.alive;
out.ranM = +ped.position.distanceTo(from).toFixed(1);
out.trail = drops() - before;
out.bleeders = fx.bleeders.length;

// A second one, shot through the head with the rifle.
const victim = ctx.peds.spawn({ x: player.position.x + 4, z: player.position.z, heading: -Math.PI / 2, behaviour: 'stand', persistent: true });
await sleep(500);
const head = victim.position.clone();
head.y += 1.6;
const eye = player.position.clone();
eye.y += 1.6;
const aim = head.clone().sub(eye).normalize();
const gore0 = drops();
const smoke0 = fx.smoke.alive;
ctx.combat.fire(player, 'rifle', eye, aim);
await sleep(400);
out.headshot = { dead: !victim.alive, splats: drops() - gore0, particles: fx.smoke.alive - smoke0 };
out.dropCapacity = decals.ringSize[ring];
return out;
