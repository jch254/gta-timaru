// Blood on the clothes and gore on the road, framed close up. SCENE (prefix the eval, e.g. `const SCENE = 'gore';`):
//   'shot'  someone shot twice in the chest and once in the leg, held still and seen from the front;
//   'gore'  someone hit by a car at 90 km/h, seen from above where they fell, gore round them;
//   'blast' someone caught close by a blast, sooted and torn, seen once the fire is out of the way.
//   node scripts/shot.mjs --place four-aves-start --time 13 --wait 0 --size 960x540 --eval "const SCENE = 'shot'; $(cat scripts/playtest/stains.js)" --out shots/stains.png
const ctx = dev.ctx;
const player = ctx.player;
const fx = ctx.combat.fx;
const scene = typeof SCENE === 'string' ? SCENE : 'shot';
const out = { scene };
ctx.police.enabled = false;
ctx.traffic.density = 0;
dev.god();
const spot = ctx.world.place('four-aves-start');
const z = spot.z + 6;
await dev.tp(spot.x, z, Math.PI / 2);
await sleep(800);
const ped = ctx.peds.spawn({ x: spot.x + 2.2, z: z + 0.5, heading: -Math.PI / 2, behaviour: 'stand', persistent: true });
await sleep(800);
const at = (dy, side = 0) => {
  const p = ped.position.clone();
  p.y += dy;
  p.z += side;
  return p;
};
const shoot = async (target) => {
  const eye = player.position.clone();
  eye.y += 1.4;
  ctx.combat.fire(player, 'pistol', eye, target.clone().sub(eye).normalize());
  await sleep(250);
};

if (scene === 'shot') {
  // Hurt but kept on their feet and facing us.
  ped.reactive = false;
  ped.maxHealth = ped.health = 1000;
  await shoot(at(1.3, 0.08));
  await shoot(at(1.15, -0.1));
  await shoot(at(0.62, 0.12));
  ped.heading = -Math.PI / 2;
  dev.look(Math.PI / 2 + 0.3, 0.05, 0.25);
  await sleep(3000);
} else if (scene === 'gore') {
  const car = ctx.vehicles.spawn('v8sedan', ped.position.x - 4, z + 6, 0, {});
  car.velocity.set(0, 0, 0);
  const travel = ped.position.clone().set(0.4, 0, -1).normalize();
  car.velocity.copy(travel).multiplyScalar(25);
  ctx.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 25, under: false });
  ped.takeDamage({ amount: 400, kind: 'vehicle', source: player, point: at(1), direction: travel });
  car.velocity.set(0, 0, 0);
  await sleep(1500);
  ctx.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 6, under: true });
  dev.look(Math.PI / 2 + 0.15, 0.75, 0.45);
  await sleep(2500);
} else {
  const blast = at(0, -0.8);
  ctx.combat.explode(blast, 6, 120, player);
  await sleep(500);
  out.dead = !ped.alive;
  // Let the fire die down (a lone blast with no car burns briefly), then stand by wherever they were thrown.
  await sleep(6000);
  player.teleport(ped.position.x - 2.6, ped.position.z - 0.6, Math.PI / 2);
  dev.look(Math.PI / 2 + 0.2, 0.6, 0.4);
  await sleep(2500);
}
const figure = ped.figure;
out.alive = ped.alive;
out.bloodied = !!figure?.bloodList;
out.wounds = figure?.blood ? Array.from(figure.blood.uWounds.value).map((v) => +v.toFixed(3)) : null;
out.soot = figure?.blood?.uSoot.value ?? null;
out.decals = fx.decals.active;
out.particles = fx.smoke.alive;
return out;
