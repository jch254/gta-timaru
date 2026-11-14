// Stand still for 45 seconds and log every vehicle crash nearby: repeated hits at one spot with no other
// vehicle involved mean something solid is sitting on a carriageway.
//   node scripts/shot.mjs --place cathedral-square --weather clear --eval "$(cat scripts/playtest/soak.js)"
const ctx = dev.ctx;
const hits = new Map();
let total = 0;
ctx.events.on('vehicleCrash', (e) => {
  const v = e.vehicle;
  if (v === ctx.player.vehicle) return;
  total++;
  const key = Math.round(v.position.x / 6) * 6 + ',' + Math.round(v.position.z / 6) * 6;
  const entry = hits.get(key) ?? { n: 0, worst: 0, who: new Set(), other: 0 };
  entry.n++;
  entry.worst = Math.max(entry.worst, +e.speed.toFixed(1));
  entry.who.add(v.spec.id + '/' + v.controller);
  if (e.other) entry.other++;
  hits.set(key, entry);
});
await sleep(45000);
const spots = [...hits.entries()]
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 8)
  .map(([at, h]) => at + ' x' + h.n + ' worst ' + h.worst + ' m/s' + (h.other ? ' (' + h.other + ' with another vehicle)' : '') + ' ' + [...h.who].join(' '));
return { total, vehicles: ctx.vehicles.all.length, spots };
