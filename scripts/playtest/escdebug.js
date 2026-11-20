// Debug: is the player on a conveyor at the foot of Stockmans' up escalator?
const ctx = dev.ctx;
const p = ctx.player;
const store = ctx.world.landmarks.find((l) => l.kind === 'timaru-dept-store');
const toWorld = (lx, lz) => [store.x + lx * Math.cos(store.heading) + lz * Math.sin(store.heading), store.z - lx * Math.sin(store.heading) + lz * Math.cos(store.heading)];
dev.time(11);
const [ux, uz] = toWorld(-1.05, 4.5);
await dev.tp(ux, uz, store.heading + Math.PI);
await sleep(1500);
const v = new p.position.constructor();
const esc = ctx.world.escalators;
const runs = esc.runs.map((r) => ({ from: r.c.from, to: r.c.to, w: r.c.width, len: r.length, rise: r.rise }));
const hit = ctx.world.conveyorAt(p.position.x, p.position.y, p.position.z, v);
return { want: [ux, uz], at: [p.position.x, p.position.y, p.position.z], grounded: p.grounded, vy: p.vy, hit, v: [v.x, v.y, v.z], runs };
