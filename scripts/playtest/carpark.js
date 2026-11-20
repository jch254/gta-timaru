// Car-park check for scripts/shot.mjs --eval: scenery cars near the player become real vehicles, can be taken
// and driven out, go back to scenery when left alone, and come back as the same car.
//   node scripts/shot.mjs --place temuka-pub --hud --eval-file scripts/playtest/carpark.js
const ctx = dev.ctx;
const offRoad = (v) => {
  const hit = ctx.world.graph.nearest(v.position.x, v.position.z, 80);
  return !hit || hit.distance > hit.edge.width / 2 + 0.5;
};
const lot = () => ctx.vehicles.all.filter((v) => v.tags.has('parked') && offRoad(v) && v.position.distanceTo(ctx.player.position) < 70);
const brief = (v) => `${v.spec.id}@${v.position.x.toFixed(1)},${v.position.z.toFixed(1)}`;
const home = { x: ctx.player.position.x, z: ctx.player.position.z };
await sleep(4000);
const first = lot().map(brief).sort();
const out = { place: [Math.round(home.x), Math.round(home.z)], promoted: first.length, cars: first.slice(0, 8) };
let car = lot().sort((a, b) => a.position.distanceTo(ctx.player.position) - b.position.distanceTo(ctx.player.position))[0];
if (car) {
  out.rest = { y: +(car.position.y - ctx.world.groundAt(car.position.x, car.position.z)).toFixed(2), speed: +Math.abs(car.speed).toFixed(2) };
  // Stand at the driver's door (the right-hand side: local -x) and press the interact key.
  const h = car.heading;
  await dev.tp(car.position.x - Math.cos(h) * (car.spec.width / 2 + 0.9), car.position.z + Math.sin(h) * (car.spec.width / 2 + 0.9));
  await sleep(700);
  out.prompt = document.querySelector('.nw-prompt')?.textContent ?? null;
  dev.tap('KeyF');
  await sleep(700);
  // In a row of cars the nearest to the door may be the neighbour: whichever it was, it must be one of the lot's.
  out.entered = ctx.player.vehicle ? brief(ctx.player.vehicle) : null;
  out.enteredOneOfTheLot = ctx.player.vehicle !== null && first.includes(out.entered);
  car = ctx.player.vehicle ?? car;
  const from = car.position.clone();
  await dev.hold(['KeyW'], 2600);
  out.droveMetres = +car.position.distanceTo(from).toFixed(1);
  dev.tap('KeyF');
  await sleep(1200);
  out.leftCar = ctx.player.vehicle === null;
  // Walk away: the untouched ones go back to being scenery, the taken one stays where it was left.
  await dev.tp(home.x + 140, home.z + 140);
  await sleep(2500);
  out.afterLeaving = { stillThere: ctx.vehicles.all.includes(car), others: ctx.vehicles.all.filter((v) => v !== car && first.includes(brief(v))).length };
  await dev.tp(home.x, home.z);
  await sleep(4000);
  const again = lot().filter((v) => v !== car).map(brief).sort();
  out.sameOnReturn = again.every((b) => first.includes(b));
  out.onReturn = again.length;
}
return out;
