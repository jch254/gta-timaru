// Watches AI traffic for two faults from the report: driving off the sealed road, and touching a parked
// car. Use as the --eval of scripts/shot.mjs (it keeps watching until the page closes), then read the
// findings with a second eval or at the end of a long sleep:
//   node scripts/shot.mjs --place cathedral-square --eval "$(cat scripts/playtest/roadwatch.js)
//   await sleep(120000); return window.__road.report()"
// Off the seal is judged away from junctions (the fillet legitimately leaves both centrelines); a touch is
// an oriented-rectangle overlap between a moving AI car and a parked one, with a small margin.
const ctx = dev.ctx;
const graph = ctx.world.graph;
const road = (window.__road = { off: [], clips: [], frames: 0 });
const JUNCTION_PAD = 16;
const seen = new Map(); // vehicle id → cooldown frames, so one fault is one event, not hundreds

/** Half-extents of `v` projected onto a direction (sin, cos form), as an oriented rectangle. */
const extent = (v, sin, cos) => {
  const s = Math.sin(v.heading);
  const c = Math.cos(v.heading);
  const hw = v.spec.width / 2;
  const hl = v.spec.length / 2;
  // Body axes in world: forward (s, c), right (c, -s).
  return Math.abs((s * sin + c * cos) * hl) + Math.abs((c * sin - s * cos) * hw);
};

/** Signed gap between two cars' rectangles along the four body axes (negative everywhere = overlap). */
const boxGap = (a, b) => {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  let gap = -Infinity;
  for (const v of [a, b]) {
    const s = Math.sin(v.heading);
    const c = Math.cos(v.heading);
    for (const [ax, az] of [[s, c], [c, -s]]) {
      const d = Math.abs(dx * ax + dz * az) - extent(a, ax, az) - extent(b, ax, az);
      if (d > gap) gap = d;
    }
  }
  return gap;
};

const trails = new Map(); // vehicle id → recent positions, sampled every 12 frames
const trail = (v) => {
  if (road.frames % 12) return;
  let t = trails.get(v.id);
  if (!t) trails.set(v.id, (t = []));
  t.push([+v.position.x.toFixed(1), +v.position.z.toFixed(1)]);
  if (t.length > 40) t.shift();
};

const tick = () => {
  road.frames++;
  const all = ctx.vehicles.all;
  for (const v of all) {
    if (!v.driver || v.destroyed || (v.controller !== 'traffic' && v.controller !== 'police')) continue;
    trail(v);
    const speed = Math.abs(v.speed);
    if (speed < 2) continue;
    const x = v.position.x;
    const z = v.position.z;
    const cool = seen.get(v.id) ?? 0;
    if (cool > 0) {
      seen.set(v.id, cool - 1);
      continue;
    }
    const hit = graph.nearest(x, z, 40, (e) => e.drivable);
    const where = () => ctx.world.locationName(x, z);
    // What the pilot thinks it is doing (TS-private fields, reachable at runtime).
    const p = v.driver.car && v.driver.car.pilot;
    const pilot = p ? { mode: p.mode, dodge: +(p.dodge ?? 0).toFixed(1), assist: p.assist, edge: p.follower?.edge?.name, u: Math.round(p.follower?.u ?? -1), dir: p.follower?.dir, next: p.follower?.nextEdge?.name, conn: Math.round(p.follower?.connLength ?? 0) } : null;
    if (!hit) {
      road.off.push({ x: Math.round(x), z: Math.round(z), d: 99, edge: null, speed: Math.round(speed), ctrl: v.controller, pilot, where: where(), frame: road.frames, trail: trails.get(v.id)?.slice() });
      seen.set(v.id, 120);
      continue;
    }
    const nearNode = hit.s < JUNCTION_PAD || hit.edge.length - hit.s < JUNCTION_PAD;
    if (!nearNode && hit.distance > hit.edge.width / 2 + 0.3) {
      road.off.push({ x: Math.round(x), z: Math.round(z), d: +hit.distance.toFixed(1), w: hit.edge.width, edge: hit.edge.name, s: Math.round(hit.s), len: Math.round(hit.edge.length), speed: Math.round(speed), ctrl: v.controller, pilot, where: where(), frame: road.frames, trail: trails.get(v.id)?.slice() });
      seen.set(v.id, 120);
      continue;
    }
    for (const o of all) {
      if (o === v || o.driver || o.destroyed) continue; // parked and empty
      const dx = o.position.x - x;
      const dz = o.position.z - z;
      if (dx * dx + dz * dz > 49) continue;
      const gap = boxGap(v, o);
      if (gap < 0.05) {
        road.clips.push({ x: Math.round(x), z: Math.round(z), gap: +gap.toFixed(2), speed: Math.round(speed), ctrl: v.controller, where: where(), edge: hit.edge.name, s: Math.round(hit.s), len: Math.round(hit.edge.length), frame: road.frames, park: [Math.round(o.position.x), Math.round(o.position.z)], trail: trails.get(v.id)?.slice() });
        seen.set(v.id, 120);
        break;
      }
    }
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
window.__road.report = () => ({ frames: road.frames, off: road.off.slice(0, 40), offCount: road.off.length, clips: road.clips.slice(0, 40), clipCount: road.clips.length });
