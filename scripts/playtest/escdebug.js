// Ride Stockmans' escalators end to end, hands off and then walking on from the shop floor holding forward,
// and report how far along each run the player ends up and at what height against the run's far end.
const ctx = dev.ctx;
const p = ctx.player;
const runs = ctx.world.escalators.runs.map((r) => r.c);
if (runs.length < 2) return { error: 'no escalators loaded', runs: runs.length };
dev.time(11);
const ride = async (c) => {
  const dx = c.to.x - c.from.x;
  const dz = c.to.z - c.from.z;
  const len = Math.hypot(dx, dz);
  // Step on half a metre in from the start, facing the way it goes.
  const sx = c.from.x + (dx / len) * 0.5;
  const sz = c.from.z + (dz / len) * 0.5;
  await dev.tp(sx, sz, Math.atan2(dx, dz));
  if (c.from.y > c.to.y) {
    // dev.tp drops onto the ground; lift the body onto the first floor landing.
    p.body.setTranslation({ x: sx, y: c.from.y + 1.0, z: sz }, true);
  }
  await sleep(600);
  const start = [p.position.x, p.position.y, p.position.z];
  const trace = [];
  for (let i = 0; i < 26; i++) {
    await sleep(1000);
    trace.push(+p.position.y.toFixed(2));
  }
  const end = [p.position.x, p.position.y, p.position.z];
  const along = ((end[0] - c.from.x) * dx + (end[2] - c.from.z) * dz) / len;
  return { from: c.from.y.toFixed(2), to: c.to.y.toFixed(2), len: len.toFixed(2), start: start.map((v) => +v.toFixed(2)), end: end.map((v) => +v.toFixed(2)), along: +along.toFixed(2), trace };
};
// Walk on from 3 m back on the shop floor holding forward, and keep walking off the top onto the first floor.
const walk = async (c) => {
  const dx = c.to.x - c.from.x;
  const dz = c.to.z - c.from.z;
  const len = Math.hypot(dx, dz);
  const heading = Math.atan2(dx, dz);
  await dev.tp(c.from.x - (dx / len) * 3, c.from.z - (dz / len) * 3, heading);
  if (c.from.y > c.to.y) p.body.setTranslation({ x: c.from.x - (dx / len) * 3, y: c.from.y + 1.0, z: c.from.z - (dz / len) * 3 }, true);
  await sleep(600);
  dev.look(heading);
  await dev.hold(['KeyW'], 12000);
  await sleep(500);
  const e = p.position;
  const along = ((e.x - c.from.x) * dx + (e.z - c.from.z) * dz) / len;
  return { along: +along.toFixed(2), len: +len.toFixed(2), y: +e.y.toFixed(2), want: +c.to.y.toFixed(2) };
};
const up = await ride(runs.find((c) => c.to.y > c.from.y));
const down = await ride(runs.find((c) => c.to.y < c.from.y));
const walkUp = await walk(runs.find((c) => c.to.y > c.from.y));
const walkDown = await walk(runs.find((c) => c.to.y < c.from.y));
return { up: { along: up.along, end: up.end }, down: { along: down.along, end: down.end }, walkUp, walkDown };
