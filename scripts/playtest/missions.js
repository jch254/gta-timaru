// Plays all six missions back to back in one session with the scripted test player (see dev.auto in
// src/game/dev.ts: it teleports the long drives and cheats the fights, so this checks mission logic, not skill).
//   node scripts/shot.mjs --place timaru-spawn --hud --eval "$(cat scripts/playtest/missions.js)"
const ctx = dev.ctx;
const out = [];
dev.god(true);
const failures = {};
ctx.events.on('missionFailed', (e) => (failures[e.id] = e.reason));
for (const id of ['severance-pay', 'on-ice', 'mint-sauce', 'four-avenues', 'punt-return', 'southerly-change']) {
  const t0 = performance.now();
  console.log('[shot] starting ' + id);
  dev.startMission(id);
  await sleep(400);
  let log = [];
  let guard = 0;
  while (dev.step() && guard++ < 2) {
    log = await dev.auto(80);
    console.log('[shot]   ' + log.slice(-2).join(' | '));
  }
  const st = ctx.missions.list().find((m) => m.id === id);
  const stuck = dev.step();
  const line = id + ': ' + (st ? st.state : '?') + ' in ' + Math.round((performance.now() - t0) / 1000) + 's' + (stuck ? ' STUCK at #' + stuck.index + ' ' + stuck.kind : '') + (failures[id] ? ' FAILED: ' + failures[id] : '');
  console.log('[shot] ' + line);
  out.push(line);
  ctx.police.clear();
  await sleep(2500);
}
return { out, money: ctx.player.money };
