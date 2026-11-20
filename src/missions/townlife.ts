/**
 * Town life on Stafford Street: the people who belong in the walk-in shops, and Friday and Saturday nights.
 *
 * - Shop staff stand behind their counters while the shops are open (places tagged `staff`, published by the
 *   landmark builders in their own frames and turned into places by the map; `upstairs` puts them on the top
 *   floor). Walk up to one and they say something. Only the nearest few are put out at once.
 * - At the door of the Millstone (`club-door`) a bouncer and a queue, Friday and Saturday nights. Pay the cover
 *   and have a few: the clock moves on, and the view sways for a while after.
 * - At the Church Street lights (`burnouts`) a couple of boy racers park up with a crowd on the corners. Now and
 *   then one of them lights up the tyres; do it yourself in front of them and they go off, and someone shouts
 *   you a jug (once a night).
 * - Anywhere, a burnout with a patrol car looking on is reckless driving (the police decide whether they saw it).
 *
 * The racers on the corner are a game invention: no source records Friday-night burnouts at Church and Stafford
 * (docs/research/11-timaru-landmarks.md, section 9). The Old Mill was a nightclub in the old flour mill at the
 * bottom of North Street; the Millstone stands for it.
 *
 * Cost: one timer per frame; twice a second, a distance check per place and per person put out.
 */
import * as THREE from 'three';
import { FRIDAY, SATURDAY, weekday, weekendNight } from '../core/calendar';
import { Rng } from '../core/rng';
import type { GameContext, HumanoidLook, PedHandle, Place, Vehicle } from '../core/types';

export const TOWN_TUNING = {
  scan: 0.5,
  /** Staff are put out within `staffSpawn` of the player and taken away beyond `staffDespawn`, nearest first. */
  staffSpawn: 45,
  staffDespawn: 70,
  staffMax: 8,
  /** The club and the corner, likewise. */
  nightSpawn: 150,
  nightDespawn: 200,
  /** On foot and this close to a shop assistant or the bouncer: they speak. */
  talkRadius: 3.4,
  /** Seconds between lines from the same person, and between any two. */
  talkGap: 16,
  crossTalk: 4,
  /** The club door: how close for the prompt, the cover charge, the hours a few jugs take, how long the sway lasts. */
  doorRadius: 2.4,
  cover: 15,
  drinkHours: 1.25,
  tipsy: 240,
  /** The corner: how near the lights a burnout is seen, how long it must last, the jug, the gap between cheers. */
  cornerRadius: 42,
  burnoutHold: 1.2,
  jug: 20,
  cheerGap: 3,
  /** A racer on the corner gives it a bit every so often, for a few seconds. */
  aiEvery: [16, 34] as const,
  aiSeconds: [3.5, 6] as const,
  /** Seconds between reckless-driving reports while the player's tyres are spinning. */
  reportGap: 4,
  /** People on the corner and in the queue. */
  onlookers: 6,
  queue: 5,
} as const;

/**
 * Shop hours in 1995 (day 1 is a Friday): weekdays nine to half past five, late night Friday to nine,
 * Saturday nine to four, Sunday ten to four (Sunday trading had been legal since 1990).
 */
export function shopOpen(hour: number, day: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  const w = weekday(day);
  if (w === FRIDAY) return h >= 9 && h < 21;
  if (w === SATURDAY) return h >= 9 && h < 16;
  if (w === 6) return h >= 10 && h < 16;
  return h >= 9 && h < 17.5;
}

/** The Millstone is going: Friday and Saturday nights, nine until three. */
export function clubNight(hour: number, day: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return weekendNight(hour, day) && (h >= 21 || h < 3);
}

/** The racers are on the corner: Friday and Saturday nights, half past nine until half past two. */
export function cornerNight(hour: number, day: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return weekendNight(hour, day) && (h >= 21.5 || h < 2.5);
}

/** A player's burnout or a big slide, in the car they are driving: how hard the tyres are going, 0..1. */
export function tyreShow(v: Pick<Vehicle, 'speed' | 'slip' | 'wheelsOnGround'> & { wheelspin?: number }): number {
  if (v.wheelsOnGround < 2) return 0;
  const spin = v.wheelspin ?? 0;
  const slide = Math.abs(v.speed) > 3 && Math.abs(v.speed) < 22 ? Math.max(0, (v.slip - 0.45) / 0.4) : 0;
  return Math.min(1, Math.max(spin, slide));
}

interface ShopStyle {
  look: Partial<HumanoidLook>;
  lines: readonly string[];
}

/** Who works where, what they wear and what they say (per place, by the number at the end of its id). */
const SHOPS: Record<string, (i: number) => ShopStyle> = {
  dekko: () => ({
    look: { top: 0xf4c400, topStyle: 'tee', legs: 0x1b2340 },
    lines: ["Kia ora. Two-dollar bin's just by the door.", "Everything in the window's on special this week.", "I can take you on this checkout, if you're ready.", "We've got the school jerseys in now, love."],
  }),
  stockmans: (i) => ({
    look: i >= 4 ? { top: 0xf2ece0, topStyle: 'tee', legs: 0x2a2a2e } : { top: 0xb3201e, topStyle: 'jacket', legs: 0x2a2a2e },
    lines:
      i >= 4
        ? ['Pot of tea and a scone? Take a seat by the window.', "Cheese scones are just out, if you're quick."]
        : ['Can I help you find anything?', "The escalator's just through there. Hold the handrail, mind.", 'Lay-by is at the desk by the escalator.', 'Tearooms are upstairs, if you fancy a cuppa.'],
  }),
  rink: (i) =>
    [
      { look: { top: 0x2a2a3a, topStyle: 'jacket' as const, legs: 0x1c1c22 }, lines: ['Booking for the Theatre Royal? You have come to the right place.', 'New tapes in on Thursday.', 'Pick a card. Any card. Go on.'] },
      { look: { top: 0xf2ece0, topStyle: 'tee' as const, legs: 0x5a6a8a }, lines: ['Milkshake? Spearmint or caramel?', "Pies are hot. Mince 'n' cheese, steak, or potato top."] },
      { look: { top: 0x1d2a44, topStyle: 'tee' as const, legs: 0x2a2a2e }, lines: ["Trots at Addington tonight. Got a fancy?", "Field's out on the wall."] },
      { look: { top: 0xb3261e, topStyle: 'tee' as const, legs: 0x5a6a8a }, lines: ["Have a rummage, there's bargains in there.", "That's two for a fiver, that."] },
    ][i] ?? { look: {}, lines: ['Just let me know if you need a hand.'] },
};

const BOUNCER: ShopStyle = {
  look: { top: 0x141416, topStyle: 'jacket', legs: 0x141416, bulk: 1.2, height: 1.04, hairStyle: 'bald' },
  lines: ["Fifteen bucks on the door. In you go.", "Not in those jandals, mate.", "Keep it down out here, the neighbours have rung twice.", "Band's on at ten."],
};
const PUNTERS: Partial<HumanoidLook>[] = [
  { top: 0x2c3a5c, topStyle: 'bushShirt', legs: 0x5a6a8a },
  { top: 0xe8e2d8, topStyle: 'tee', legs: 0x2a2a2e, female: true, hairStyle: 'long' },
  { top: 0x8a1f2a, topStyle: 'jacket', legs: 0x1c1c22, female: true },
  { top: 0x1c1c22, topStyle: 'tee', legs: 0x5a6a8a, hairStyle: 'mullet' },
  { top: 0x3c5a3a, topStyle: 'jersey', legs: 0x2c3a5c },
  { top: 0xc87a8a, topStyle: 'tee', legs: 0x1c1c22, female: true },
];
const HOONS: Partial<HumanoidLook>[] = [
  { top: 0x1c1c22, topStyle: 'tee', legs: 0x5a6a8a, hairStyle: 'mullet' },
  { top: 0x2c3a5c, topStyle: 'bushShirt', legs: 0x3a4a6a, hat: 'cap', hatColor: 0x1c1c22 },
  { top: 0xe8e2d8, topStyle: 'singlet', legs: 0x5a6a8a, hairStyle: 'mullet' },
  { top: 0x8a1f2a, topStyle: 'jacket', legs: 0x2a2a2e },
];
const CHEERS = ['Yeeeew!', 'Mean as!', 'Give it some herbs!', 'Chur, bro!', 'Send it!', 'Smoke \u2019em up!', 'Hard out!'];
const RACER_CARS = ['v8sedan', 'coupe', 'kingswood', 'hothatch'];
const RACER_COLOURS = [0x1c1c22, 0xe8e2d8, 0x8a1f2a, 0x2c4a7a, 0xd8b02a];

interface Staffer {
  place: Place;
  style: ShopStyle;
  ped: PedHandle | null;
  /** Taken away dead: not put back until the player has gone away and come back. */
  spent: boolean;
  line: number;
  cooldown: number;
}

interface Racer {
  vehicle: Vehicle;
  driver: PedHandle | null;
  mate: PedHandle | null;
  x: number;
  z: number;
  heading: number;
}

const _p = new THREE.Vector3();

export class TownLife {
  private staff: Staffer[] = [];
  private door: Place | null = null;
  private corner: Place | null = null;
  private club: { bouncer: PedHandle | null; queue: PedHandle[]; line: number; cooldown: number } | null = null;
  private crowd: PedHandle[] = [];
  private racers: Racer[] = [];
  private scanTimer = 0;
  private talkTimer = 0;
  private busy = false;
  /** The current night's number (its day), and whether its jug has been bought. */
  private jugNight = -1;
  private show = 0;
  private cheerTimer = 0;
  private reportTimer = 0;
  private aiTimer: number = TOWN_TUNING.aiEvery[0];
  private aiRun: { racer: Racer; left: number; t: number } | null = null;
  private rng = new Rng(0x2f6e2b1);

  constructor(
    private ctx: GameContext,
    private opts: { talking: () => boolean },
  ) {}

  init() {
    const { world } = this.ctx;
    for (const place of world.placesTagged('staff')) {
      const shop = place.tags.find((t) => t.startsWith('shop:'))?.slice(5) ?? '';
      const index = Number(place.id.split('-').pop() ?? '1') - 1;
      const style = SHOPS[shop]?.(index) ?? { look: {}, lines: ['Just let me know if you need a hand.'] };
      this.staff.push({ place, style, ped: null, spent: false, line: 0, cooldown: 0 });
    }
    this.door = world.placesTagged('club-door')[0] ?? null;
    this.corner = world.placesTagged('burnouts')[0] ?? null;
  }

  update(dt: number) {
    this.talkTimer = Math.max(0, this.talkTimer - dt);
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = TOWN_TUNING.scan;
      this.scanStaff();
      this.scanNight();
    }
    this.talk(dt);
    this.updateDoor();
    this.updateCorner(dt);
    this.updateRacers(dt);
  }

  // ───────────── Shop staff ─────────────

  private scanStaff() {
    const { ctx } = this;
    const p = ctx.player.position;
    const open = shopOpen(ctx.clock.hour, ctx.clock.day);
    const want: Staffer[] = [];
    for (const st of this.staff) {
      const d = Math.hypot(st.place.x - p.x, st.place.z - p.z);
      if (st.spent && d > TOWN_TUNING.staffDespawn) st.spent = false;
      if (st.ped && (!open || d > TOWN_TUNING.staffDespawn || !st.ped.alive)) {
        // A body stays where it fell until nobody is looking; the living go when the shop shuts.
        if (st.ped.alive || d > TOWN_TUNING.staffDespawn) {
          if (!st.ped.alive) st.spent = true;
          st.ped.remove();
          st.ped = null;
        }
      }
      if (open && !st.ped && !st.spent && d < TOWN_TUNING.staffSpawn && ctx.world.isLoaded(st.place.x, st.place.z)) want.push(st);
    }
    let out = this.staff.filter((s) => s.ped).length;
    want.sort((a, b) => Math.hypot(a.place.x - p.x, a.place.z - p.z) - Math.hypot(b.place.x - p.x, b.place.z - p.z));
    for (const st of want) {
      if (out >= TOWN_TUNING.staffMax) break;
      const up = st.place.tags.includes('upstairs');
      const y = ctx.world.floorAt?.(st.place.x, st.place.z, up ? Infinity : -Infinity);
      st.ped = ctx.peds.spawn({ x: st.place.x, z: st.place.z, y, heading: st.place.heading, look: st.style.look, behaviour: 'stand', persistent: true });
      out++;
    }
  }

  /** Shop staff and the bouncer say something when the player is on foot beside them. */
  private talk(dt: number) {
    const { ctx } = this;
    const player = ctx.player;
    if (player.vehicle || !player.alive || this.opts.talking() || this.talkTimer > 0) {
      for (const st of this.staff) st.cooldown = Math.max(0, st.cooldown - dt);
      return;
    }
    const p = player.position;
    for (const st of this.staff) {
      st.cooldown = Math.max(0, st.cooldown - dt);
      const ped = st.ped;
      if (!ped || !ped.alive || st.cooldown > 0) continue;
      if (Math.hypot(ped.position.x - p.x, ped.position.z - p.z) > TOWN_TUNING.talkRadius || Math.abs(ped.position.y - p.y) > 1.5) continue;
      ped.say(st.style.lines[st.line % st.style.lines.length]);
      st.line++;
      st.cooldown = TOWN_TUNING.talkGap;
      this.talkTimer = TOWN_TUNING.crossTalk;
      return;
    }
    const club = this.club;
    if (club?.bouncer?.alive && club.cooldown <= 0 && Math.hypot(club.bouncer.position.x - p.x, club.bouncer.position.z - p.z) < TOWN_TUNING.talkRadius) {
      club.bouncer.say(BOUNCER.lines[club.line++ % BOUNCER.lines.length]);
      club.cooldown = TOWN_TUNING.talkGap;
      this.talkTimer = TOWN_TUNING.crossTalk;
    }
    if (club) club.cooldown = Math.max(0, club.cooldown - dt);
  }

  // ───────────── Friday and Saturday nights ─────────────

  private scanNight() {
    const { ctx } = this;
    const p = ctx.player.position;
    const quiet = !ctx.missions.active;
    if (this.door) {
      const d = Math.hypot(this.door.x - p.x, this.door.z - p.z);
      const on = quiet && clubNight(ctx.clock.hour, ctx.clock.day);
      if (!this.club && on && d < TOWN_TUNING.nightSpawn && ctx.world.isLoaded(this.door.x, this.door.z)) this.openClub(this.door);
      else if (this.club && (d > TOWN_TUNING.nightDespawn || (!on && d > 80))) this.closeClub();
    }
    if (this.corner) {
      const d = Math.hypot(this.corner.x - p.x, this.corner.z - p.z);
      const on = quiet && cornerNight(ctx.clock.hour, ctx.clock.day);
      const out = this.crowd.length > 0 || this.racers.length > 0;
      if (!out && on && d < TOWN_TUNING.nightSpawn && d > 60 && ctx.world.isLoaded(this.corner.x, this.corner.z)) this.fillCorner(this.corner);
      else if (out && (d > TOWN_TUNING.nightDespawn || (!on && d > 80))) this.clearCorner();
    }
  }

  private openClub(door: Place) {
    const { ctx } = this;
    const fx = Math.sin(door.heading);
    const fz = Math.cos(door.heading);
    // The queue runs along the front of the building, off to one side of the door.
    const ax = Math.cos(door.heading);
    const az = -Math.sin(door.heading);
    const bouncer = ctx.peds.spawn({ x: door.x - ax * 1.1 + fx * 0.3, z: door.z - az * 1.1 + fz * 0.3, heading: door.heading, look: BOUNCER.look, behaviour: 'stand', persistent: true, name: 'Bouncer' });
    const queue: PedHandle[] = [];
    for (let k = 0; k < TOWN_TUNING.queue; k++) {
      const x = door.x + ax * (1.6 + k * 0.85) + fx * (0.7 + (k % 2) * 0.15);
      const z = door.z + az * (1.6 + k * 0.85) + fz * (0.7 + (k % 2) * 0.15);
      queue.push(ctx.peds.spawn({ x, z, heading: Math.atan2(-ax, -az), look: PUNTERS[k % PUNTERS.length], behaviour: 'stand', persistent: true }));
    }
    this.club = { bouncer, queue, line: 0, cooldown: 0 };
  }

  private closeClub() {
    if (!this.club) return;
    this.club.bouncer?.remove();
    for (const q of this.club.queue) q.remove();
    this.club = null;
  }

  /** Pay the cover and have a few: fade out, the clock moves on, back out on the footpath a bit merry. */
  private updateDoor() {
    const { ctx } = this;
    const door = this.door;
    if (!door || this.busy || !this.club) return;
    const { player, ui, input } = ctx;
    if (!player.alive || player.vehicle || !player.controlsEnabled || ui.menuOpen) return;
    if (!clubNight(ctx.clock.hour, ctx.clock.day)) return;
    if (Math.hypot(door.x - player.position.x, door.z - player.position.z) > TOWN_TUNING.doorRadius) return;
    if (ctx.vehicles.nearest(player.position.x, player.position.z, 4)) return;
    if (ctx.police.level > 0) {
      ui.prompt("The bouncer's not letting you in with the police about");
      return;
    }
    ui.prompt(`${input.label('interact')}  Have a few at the Millstone ($${TOWN_TUNING.cover})`);
    if (input.pressed('interact')) void this.drink();
  }

  private async drink() {
    const { ctx } = this;
    const player = ctx.player;
    if (player.money < TOWN_TUNING.cover) {
      ctx.ui.toast(`${TOWN_TUNING.cover} bucks on the door, and you're short.`, 4);
      return;
    }
    this.busy = true;
    player.controlsEnabled = false;
    try {
      await ctx.ui.fade(true, 0.8);
      player.addMoney(-TOWN_TUNING.cover);
      ctx.clock.advanceHours(TOWN_TUNING.drinkHours);
      player.tipsy = TOWN_TUNING.tipsy;
      await ctx.ui.fade(false, 0.8);
      ctx.ui.toast(cornerNight(ctx.clock.hour, ctx.clock.day) ? 'A few jugs at the Millstone. Someone says the boys are doing skids up at Church and Stafford.' : 'A few jugs at the Millstone. Mind how you go.', 6);
    } finally {
      player.controlsEnabled = true;
      this.busy = false;
    }
  }

  private fillCorner(corner: Place) {
    const { ctx } = this;
    const graph = ctx.world.graph;
    const node = graph.nearestNode(corner.x, corner.z);
    const edges = node.edges.map((i) => graph.edges[i]);
    // Two cars at the kerb on Stafford Street, nosed up to the lights from either side.
    const stafford = edges.filter((e) => e.drivable && e.name === 'Stafford Street' && e.length > 40);
    stafford.slice(0, 2).forEach((e, i) => {
      const atA = e.a === node.index;
      const s = atA ? 22 : e.length - 22;
      const dir: 1 | -1 = atA ? -1 : 1;
      const pt = graph.pointAt(e, s);
      const tx = pt.tx * dir;
      const tz = pt.tz * dir;
      const specId = RACER_CARS.filter((id) => ctx.vehicles.specs.has(id))[i % 4] ?? 'v8sedan';
      const spec = ctx.vehicles.specs.get(specId);
      if (!spec) return;
      const off = e.width / 2 - spec.width / 2 - 0.3;
      const x = pt.x + tz * off;
      const z = pt.z - tx * off;
      if (ctx.vehicles.nearest(x, z, 5)) return;
      const heading = Math.atan2(tx, tz);
      const v = ctx.vehicles.spawn(specId, x, z, heading, { controller: 'mission', tags: ['townlife', 'racer'], color: RACER_COLOURS[Math.floor(this.rng.next() * RACER_COLOURS.length)] });
      if (!v) return;
      v.controls.handbrake = true;
      v.doorPosition(_p, 0);
      const driver = ctx.peds.spawn({ x: _p.x, z: _p.z, heading, look: HOONS[i * 2], behaviour: 'stand', persistent: true });
      driver.enterVehicle(v, 0);
      const side: 1 | -1 = dir === 1 ? 1 : -1;
      const fp = graph.footpathPoint(e, s + 1.5, side);
      const mate = ctx.peds.spawn({ x: fp.x, z: fp.z, heading: Math.atan2(x - fp.x, z - fp.z), look: HOONS[i * 2 + 1], behaviour: 'stand', persistent: true });
      this.racers.push({ vehicle: v, driver, mate, x, z, heading });
    });
    // The crowd on the corners, facing the middle of the intersection.
    const spots: { x: number; z: number }[] = [];
    for (const e of edges) {
      if (!e.footpaths) continue;
      const s = e.a === node.index ? 9 : e.length - 9;
      for (const side of [1, -1] as const) spots.push(graph.footpathPoint(e, s, side));
    }
    const keep = spots.filter((q) => !this.racers.some((r) => Math.hypot(r.x - q.x, r.z - q.z) < 4)).slice(0, TOWN_TUNING.onlookers);
    keep.forEach((q, k) => {
      const look = k % 3 === 0 ? HOONS[(k / 3) % HOONS.length] : PUNTERS[k % PUNTERS.length];
      this.crowd.push(ctx.peds.spawn({ x: q.x, z: q.z, heading: Math.atan2(node.x - q.x, node.z - q.z), look, behaviour: 'stand', persistent: true }));
    });
    this.aiTimer = this.range(TOWN_TUNING.aiEvery);
  }

  private clearCorner() {
    const { ctx } = this;
    for (const ped of this.crowd) ped.remove();
    this.crowd.length = 0;
    for (const r of this.racers) {
      r.driver?.remove();
      r.mate?.remove();
      // A car the player has taken is theirs now.
      if (r.vehicle !== ctx.player.vehicle && r.vehicle.controller === 'mission' && ctx.vehicles.all.includes(r.vehicle)) ctx.vehicles.remove(r.vehicle);
    }
    this.racers.length = 0;
    this.aiRun = null;
  }

  /** The player's tyres: the corner crowd's reaction, the jug, and the police if they are watching. */
  private updateCorner(dt: number) {
    const { ctx } = this;
    const v = ctx.player.vehicle;
    const show = v && v.controller === 'player' ? tyreShow(v) : 0;
    this.show = show > 0.55 ? this.show + dt : Math.max(0, this.show - dt * 2);
    this.cheerTimer = Math.max(0, this.cheerTimer - dt);
    this.reportTimer = Math.max(0, this.reportTimer - dt);
    if (!v || this.show < TOWN_TUNING.burnoutHold) return;
    if (this.reportTimer <= 0) {
      this.reportTimer = TOWN_TUNING.reportGap;
      ctx.events.emit('crime', { type: 'recklessDriving', position: v.position.clone(), offender: ctx.player });
    }
    const corner = this.corner;
    if (!corner || !this.crowd.length || this.cheerTimer > 0) return;
    if (Math.hypot(corner.x - v.position.x, corner.z - v.position.z) > TOWN_TUNING.cornerRadius) return;
    this.cheerTimer = TOWN_TUNING.cheerGap;
    this.cheer(true);
    const night = ctx.clock.hour < 12 ? ctx.clock.day - 1 : ctx.clock.day;
    if (this.jugNight !== night) {
      this.jugNight = night;
      ctx.player.addMoney(TOWN_TUNING.jug);
      ctx.audio.play('cash');
      ctx.ui.toast(`The corner goes off. Someone at the lights shouts you a jug: $${TOWN_TUNING.jug}.`, 5);
    }
  }

  /** The crowd point and holler; one of them is heard. */
  private cheer(loud: boolean) {
    const live = this.crowd.filter((p) => p.alive);
    for (const ped of live) if (this.rng.next() < (loud ? 0.8 : 0.4)) ped.gesture?.(this.rng.next() < 0.5 ? 'point' : 'orate', 1.6 + this.rng.next());
    const p = this.ctx.player.position;
    const near = live.filter((q) => Math.hypot(q.position.x - p.x, q.position.z - p.z) < 45);
    if (near.length && !this.opts.talking() && this.talkTimer <= 0) {
      near[Math.floor(this.rng.next() * near.length)].say(CHEERS[Math.floor(this.rng.next() * CHEERS.length)]);
      this.talkTimer = TOWN_TUNING.crossTalk;
    }
  }

  /** One of the racers on the corner lights the tyres up for a few seconds, then parks it again. */
  private updateRacers(dt: number) {
    const { ctx } = this;
    for (let i = this.racers.length - 1; i >= 0; i--) {
      const r = this.racers[i];
      // Taken, wrecked or gone: no longer ours to drive.
      if (r.vehicle.controller !== 'mission' || r.vehicle.destroyed || !ctx.vehicles.all.includes(r.vehicle)) {
        if (this.aiRun?.racer === r) this.aiRun = null;
        this.racers.splice(i, 1);
      }
    }
    const run = this.aiRun;
    if (run) {
      const v = run.racer.vehicle;
      run.left -= dt;
      run.t += dt;
      const moved = Math.hypot(v.position.x - run.racer.x, v.position.z - run.racer.z);
      if (run.left <= 0 || moved > 6 || v.driver !== run.racer.driver) {
        v.controls.throttle = 0;
        v.controls.brake = 0;
        v.controls.steer = 0;
        v.controls.handbrake = true;
        this.aiRun = null;
        if (this.rng.next() < 0.4) v.horn();
        return;
      }
      v.controls.handbrake = false;
      v.controls.throttle = 1;
      v.controls.brake = 1;
      v.controls.steer = Math.sin(run.t * 2.3) * 0.7;
      return;
    }
    if (!this.racers.length) return;
    this.aiTimer -= dt;
    if (this.aiTimer > 0) return;
    this.aiTimer = this.range(TOWN_TUNING.aiEvery);
    const ready = this.racers.filter((r) => r.driver?.alive && r.vehicle.driver === r.driver && ctx.player.vehicle !== r.vehicle);
    if (!ready.length) return;
    const racer = ready[Math.floor(this.rng.next() * ready.length)];
    this.aiRun = { racer, left: this.range(TOWN_TUNING.aiSeconds), t: 0 };
    ctx.audio.play('skid', { at: racer.vehicle.position, volume: 0.9 });
    this.cheer(false);
  }

  private range(r: readonly [number, number]): number {
    return r[0] + this.rng.next() * (r[1] - r[0]);
  }

  dispose() {
    for (const st of this.staff) {
      st.ped?.remove();
      st.ped = null;
    }
    this.closeClub();
    this.clearCorner();
  }
}
