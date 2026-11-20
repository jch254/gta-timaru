// The Rink Mall's rear stair: from the back door on the lower car park, walk up the four flights round the core
// to the court passage, steering by waypoints in the mall's frame. Prints the height above the court floor at
// each waypoint and whether the walk reached the top.
//
//   node scripts/shot.mjs --eval "$(cat scripts/playtest/rinkstair.js)" --out shots/rinkstair.png
const ctx = dev.ctx;
const p = ctx.player;
const mall = ctx.world.landmarks.find((l) => l.kind === 'timaru-arcade-mall');
const c = Math.cos(mall.heading);
const s = Math.sin(mall.heading);
const toWorld = (lx, lz) => [mall.x + lx * c + lz * s, mall.z - lx * s + lz * c];
const toLocal = (x, z) => [(x - mall.x) * c - (z - mall.z) * s, (x - mall.x) * s + (z - mall.z) * c];
dev.time(11);
// Outside the back door, then in under it and round the flights (the lowest climbs +x along z = -18.95), and
// through the doorway in the passage wall at x = 8.
const route = [[9, -19.4], [8.8, -18.95], [15.6, -18.95], [15.6, -14.9], [9.2, -14.9], [9.2, -18.95], [15.6, -18.95], [15.6, -14.9], [9.0, -14.9], [9.0, -16.9], [6.5, -16.9]];
const [sx, sz] = toWorld(9, -22);
await dev.tp(sx, sz, mall.heading + Math.PI);
await sleep(1200);
// The court floor: what floorAt gives just inside the mall's front.
const [fx, fz] = toWorld(0, 10);
const court = ctx.world.floorAt(fx, fz, Infinity);
const log = [];
for (const [lx, lz] of route) {
  const [tx, tz] = toWorld(lx, lz);
  const until = performance.now() + 9000;
  while (performance.now() < until) {
    const dx = tx - p.position.x;
    const dz = tz - p.position.z;
    if (Math.hypot(dx, dz) < 0.35) break;
    dev.look(Math.atan2(dx, dz), 0.2, 1);
    await dev.hold(['KeyW'], 120);
  }
  const [ax, az] = toLocal(p.position.x, p.position.z);
  log.push(`${lx},${lz} -> ${ax.toFixed(1)},${az.toFixed(1)} y ${(p.position.y - court).toFixed(2)}`);
}
const [ex, ez] = toLocal(p.position.x, p.position.z);
return { reachedTop: Math.abs(p.position.y - court) < 0.3 && Math.hypot(ex - 6.5, ez + 16.9) < 1, log };
