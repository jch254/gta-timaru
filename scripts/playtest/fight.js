// An honest gunfight: the fifth mission up to its first shoot-out, then the aim-and-fire bot (dev.fight) with
// whatever weapons, armour and health the mission gave. Reports time, damage taken and kills.
//   node scripts/shot.mjs --place timaru-spawn --hud --eval "$(cat scripts/playtest/fight.js)"
const ctx = dev.ctx;
dev.startMission('punt-return');
await sleep(500);
const auto = await dev.auto(60, { fights: 'stop' });
const st = dev.step();
const before = { step: st?.kind, health: Math.round(ctx.player.health), armour: Math.round(ctx.player.armour), weapon: ctx.combat.current.id };
const fight = await dev.fight(45);
return { auto: auto.slice(-3), before, fight, heat: ctx.police.level };
