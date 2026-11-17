// The honest test player, injected into the page by honest.mjs and abuse.mjs. Unlike dev.auto it never
// teleports, never heals, never patches the car and never kills by fiat: it walks with the movement keys,
// drives every metre with the test autopilot (dev.driveTo), fights with dev.fight (aim and tap fire with
// whatever the mission handed out) and loses the police the way the game intends. Everything it does, a
// player at the keyboard could do.
//
// It assumes `window.dev` (src/game/dev.ts) exists and defines `window.bot`.
window.bot = (() => {
  const dev = window.dev;
  const ctx = dev.ctx;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
  const log = (text) => console.log('[shot] ' + text);

  const pos = () => (ctx.player.vehicle ? ctx.player.vehicle.position : ctx.player.position);
  const dist = (x, z) => Math.hypot(pos().x - x, pos().z - z);
  const condition = (v) => Math.round((v.health / v.spec.health) * 100);

  // ───────────────────────────── Metrics ─────────────────────────────

  const metrics = {
    deaths: 0,
    busts: 0,
    damageTaken: 0,
    maxHeat: 0,
    fights: [],
    timerSlack: [],
    events: [],
    reset() {
      this.deaths = 0;
      this.busts = 0;
      this.damageTaken = 0;
      this.maxHeat = 0;
      this.fights = [];
      this.timerSlack = [];
      this.events = [];
    },
  };

  let lastVitals = ctx.player.health + ctx.player.armour;
  let lastTimer = { label: null, seconds: -1, step: -1 };
  ctx.events.on('playerDied', () => {
    metrics.deaths++;
    metrics.events.push('died');
  });
  ctx.events.on('playerBusted', () => {
    metrics.busts++;
    metrics.events.push('busted');
  });
  ctx.events.on('wantedChanged', ({ level }) => {
    metrics.maxHeat = Math.max(metrics.maxHeat, level);
  });
  // Damage taken and timer slack are sampled, not evented: cheap and close enough.
  setInterval(() => {
    const vitals = ctx.player.health + ctx.player.armour;
    if (vitals < lastVitals) metrics.damageTaken += lastVitals - vitals;
    lastVitals = vitals;
    const st = dev.step();
    if (!st) {
      if (lastTimer.seconds >= 0) {
        metrics.timerSlack.push({ step: lastTimer.step, label: lastTimer.label, left: Math.round(lastTimer.seconds) });
        lastTimer = { label: null, seconds: -1, step: -1 };
      }
      return;
    }
    const run = st.run;
    const timer = run.stepTimer >= 0 ? run.stepTimer : run.missionTimeLeft >= 0 ? run.missionTimeLeft : -1;
    if (timer >= 0) {
      lastTimer = { label: 'timer', seconds: timer, step: st.index };
    } else if (lastTimer.seconds >= 0) {
      // A timer just finished (step passed or timer stopped): what was left is the slack.
      metrics.timerSlack.push({ step: lastTimer.step, label: lastTimer.label, left: Math.round(lastTimer.seconds) });
      lastTimer = { label: null, seconds: -1, step: -1 };
    }
  }, 250);

  /** A line of telemetry every few seconds while a mission runs (honest.mjs --verbose). */
  let telemetry = null;
  function watch(seconds = 5) {
    if (telemetry) clearInterval(telemetry);
    telemetry = setInterval(() => {
      const st = dev.step();
      if (!st) return;
      const v = ctx.player.vehicle;
      const t = st.target;
      const timer = st.run.stepTimer >= 0 ? st.run.stepTimer : st.run.missionTimeLeft;
      const where = t && ['goTo', 'deliverVehicle', 'chase', 'race'].includes(st.kind) ? `, ${Math.round(dist(t.x, t.z))} m to go` : '';
      const clock = timer >= 0 ? `, ${Math.round(timer)} s on the clock` : '';
      const ride = v ? `, ${Math.round(Math.abs(v.speed) * 3.6)} km/h in the ${v.spec.id} (${condition(v)}%)` : ', on foot';
      const law = ctx.police.level > 0 ? ` (${seen() ? 'seen' : 'unseen'}, nearest patrol car ${Math.round(nearestCop())} m)` : '';
      log(`    · #${st.index} ${st.kind}${where}${clock}${ride}, heat ${ctx.police.level}${law}`);
    }, seconds * 1000);
  }

  // ───────────────────────────── On foot ─────────────────────────────

  function lookAt(x, z) {
    const p = ctx.player.position;
    dev.look(Math.atan2(x - p.x, z - p.z), 0.2, 1);
  }

  /** Walk (sprint) to a point with the movement keys, steering the camera. Jumps and sidesteps when stuck. */
  async function walkTo(x, z, options = {}) {
    const radius = options.radius ?? 2;
    const deadline = now() + (options.timeout ?? 60) * 1000;
    key('keydown', 'KeyW');
    if (options.sprint !== false) key('keydown', 'ShiftLeft');
    let lastX = ctx.player.position.x;
    let lastZ = ctx.player.position.z;
    let stuck = 0;
    let result = 'walking';
    try {
      while (now() < deadline) {
        if (!ctx.player.alive) return 'died';
        if (ctx.player.vehicle) return 'in a vehicle';
        const p = ctx.player.position;
        if (Math.hypot(p.x - x, p.z - z) <= radius) return 'arrived';
        lookAt(x, z);
        await sleep(250);
        const moved = Math.hypot(ctx.player.position.x - lastX, ctx.player.position.z - lastZ);
        lastX = ctx.player.position.x;
        lastZ = ctx.player.position.z;
        if (moved < 0.35) {
          stuck++;
          if (stuck === 2) dev.tap('Space');
          if (stuck >= 3) {
            // Sidestep round whatever it is.
            const side = stuck % 2 === 0 ? 'KeyA' : 'KeyD';
            key('keydown', side);
            await sleep(500);
            key('keyup', side);
          }
          if (stuck > 10) return 'stuck';
        } else stuck = 0;
      }
      result = 'timeout';
    } finally {
      key('keyup', 'KeyW');
      key('keyup', 'ShiftLeft');
    }
    return result;
  }

  // ───────────────────────────── Vehicles ─────────────────────────────

  /** Cars that could not be reached or entered just now: left alone for a while. */
  const shunned = new Map();
  function shun(vehicle, seconds = 45) {
    shunned.set(vehicle.id, now() + seconds * 1000);
  }

  /** The nearest car a player would take: parked or abandoned, running, not the law's. */
  function nearestCar(maxDistance = 220) {
    const p = ctx.player.position;
    let best = null;
    let bestD = maxDistance;
    for (const v of ctx.vehicles.all) {
      if (v.destroyed || v.burning || v.spec.id === 'police' || v.spec.id === 'bus' || v.spec.id === 'bike') continue;
      if (v.driver && v.driver.kind === 'player') continue;
      if ((shunned.get(v.id) ?? 0) > now()) continue;
      const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      const parked = v.driver === null;
      // A parked car over a hijack any day: hijacking is a crime with a witness problem.
      const score = d + (parked ? 0 : 120) + (v.tags.has('owned') || v.tags.has('mission') ? -30 : 0);
      if (score < bestD) {
        bestD = score;
        best = v;
      }
    }
    return best;
  }

  /** Walk to a vehicle's door and press Interact until seated in it. */
  async function enterVehicle(vehicle, options = {}) {
    const deadline = now() + (options.timeout ?? 45) * 1000;
    while (now() < deadline) {
      if (!ctx.player.alive) return 'died';
      if (ctx.player.vehicle === vehicle) return 'in';
      if (vehicle.destroyed) return 'destroyed';
      if (ctx.player.vehicle) {
        await exitVehicle();
        continue;
      }
      const door = ctx.player.position.clone();
      vehicle.doorPosition(door, 0);
      const r = await walkTo(door.x, door.z, { radius: 1.6, timeout: 25 });
      if (r === 'died') return 'died';
      lookAt(vehicle.position.x, vehicle.position.z);
      await sleep(150);
      dev.tap('KeyF');
      await sleep(700);
    }
    return 'timeout';
  }

  async function exitVehicle() {
    const v = ctx.player.vehicle;
    if (!v) return;
    await stopCar(4000);
    dev.tap('KeyF');
    await sleep(700);
  }

  /** Make sure the player is at a wheel; finds and takes the nearest car if not. */
  async function ensureCar(options = {}) {
    if (ctx.player.vehicle && !ctx.player.vehicle.destroyed) return 'in';
    const want = options.prefer ?? null;
    const car = want && !want.destroyed ? want : nearestCar(options.maxDistance ?? 220);
    if (!car) return 'no car about';
    return enterVehicle(car, options);
  }

  // The bot's own driving is done on the keys a player has (W/S/A/D, Space): the game reads the seat's
  // controls from the keyboard every frame, so nothing else would count — or be honest.
  const DRIVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'];
  const held = new Set();
  function hold(code, on) {
    if (on === held.has(code)) return;
    if (on) held.add(code);
    else held.delete(code);
    key(on ? 'keydown' : 'keyup', code);
  }
  function releaseDrive() {
    for (const code of DRIVE_KEYS) hold(code, false);
  }
  const wrap = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  /** Foot on the brake until the car has all but stopped. */
  async function stopCar(timeoutMs = 4000) {
    const v = ctx.player.vehicle;
    if (!v) return;
    releaseDrive();
    const until = now() + timeoutMs;
    // The brake key reverses once stopped, so it is only held while still rolling forwards.
    while (ctx.player.vehicle === v && Math.abs(v.speed) > 1.2 && now() < until) {
      hold('KeyS', v.speed > 1.2);
      hold('KeyW', v.speed < -1.2);
      await sleep(80);
    }
    releaseDrive();
  }

  /**
   * What is in front of the bonnet while steering by hand. Returns 'stop' for a person close ahead, a
   * steering bias (radians, + = left) away from a vehicle in the path, or 0 for a clear run.
   */
  function inTheWay(v) {
    const sin = Math.sin(v.heading);
    const cos = Math.cos(v.heading);
    const half = (v.spec.width ?? 2) / 2;
    for (const a of ctx.actors.all) {
      if (!a.alive || a === ctx.player || a.kind === 'player') continue;
      const dx = a.position.x - v.position.x;
      const dz = a.position.z - v.position.z;
      const ahead = dx * sin + dz * cos;
      const side = dx * cos - dz * sin;
      if (ahead > 0 && ahead < 7 + Math.abs(v.speed) && Math.abs(side) < half + 0.9) return 'stop';
    }
    let bias = 0;
    let nearest = Infinity;
    for (const o of ctx.vehicles.all) {
      if (o === v || o.destroyed) continue;
      const dx = o.position.x - v.position.x;
      const dz = o.position.z - v.position.z;
      const ahead = dx * sin + dz * cos;
      const side = dx * cos - dz * sin; // + = to the left
      const reach = half + (o.spec.width ?? 2) / 2 + 1.2;
      if (ahead > -1 && ahead < 16 && Math.abs(side) < reach && ahead < nearest) {
        nearest = ahead;
        bias = side >= 0 ? -0.7 : 0.7;
      }
    }
    return bias;
  }

  /**
   * Steer by hand, slowly, straight at a point: out of a car park onto the road, or the last metres onto a
   * lay-by or into a yard that the road autopilot will not leave the carriageway for. Backs up and swings
   * round when the point is behind. `done()` ends it; returns whether it got there.
   */
  async function steerTo(x, z, options = {}) {
    const v = ctx.player.vehicle;
    if (!v) return false;
    const radius = options.radius ?? 4;
    const top = options.speed ?? 7;
    const deadline = now() + (options.timeout ?? 10) * 1000;
    let lastD = Infinity;
    let still = 0;
    let backing = 0;
    try {
      while (now() < deadline && ctx.player.vehicle === v && ctx.player.alive) {
        if (options.done && options.done()) return true;
        const d = Math.hypot(v.position.x - x, v.position.z - z);
        if (d <= radius) return true;
        const turn = wrap(Math.atan2(x - v.position.x, z - v.position.z) - v.heading);
        // Wedged against something: back off for a second on opposite lock, then come again.
        if (Math.abs(d - lastD) < 0.15) still++;
        else still = 0;
        lastD = d;
        if (still > 12 && backing <= 0) backing = 14;
        const behind = Math.abs(turn) > 2.0;
        const swerve = backing > 0 || behind ? 0 : inTheWay(v);
        if (swerve === 'stop') {
          // Somebody on foot dead ahead: wait for them.
          hold('KeyW', false);
          hold('KeyA', false);
          hold('KeyD', false);
          hold('KeyS', v.speed > 0.6);
        } else if (backing > 0 || behind) {
          backing--;
          hold('KeyW', false);
          hold('KeyS', v.speed > -4);
          hold('KeyA', turn < -0.15);
          hold('KeyD', turn > 0.15);
          if (backing === 0) still = 0;
        } else {
          // Round a parked car rather than through it: lean away from it until it is alongside.
          const want = turn + swerve;
          hold('KeyS', false);
          hold('KeyW', Math.abs(v.speed) < top * (Math.abs(want) > 0.7 || swerve !== 0 ? 0.6 : 1));
          hold('KeyA', want > 0.12);
          hold('KeyD', want < -0.12);
        }
        await sleep(100);
      }
      return false;
    } finally {
      releaseDrive();
    }
  }

  /**
   * Nose out of a car park: drive straight at the nearest road under the bot's own steering, so dev.driveTo
   * never has to snap the car onto the carriageway (its one teleport).
   */
  async function noseToRoad(timeoutMs = 12000) {
    const v = ctx.player.vehicle;
    if (!v) return;
    const onRoad = () => {
      const h = ctx.world.graph.nearest(v.position.x, v.position.z, 80, (e) => e.drivable);
      return !h || h.distance <= h.edge.width / 2 - 1;
    };
    const graph = ctx.world.graph;
    const hit = graph.nearest(v.position.x, v.position.z, 80, (e) => e.drivable);
    if (!hit || hit.distance <= hit.edge.width / 2) return;
    // Aim along the road, not square at it: a point a few car lengths on, whichever way the car faces, so
    // even a truck parked on the verge can swing out in one go.
    const t = graph.pointAt(hit.edge, hit.s);
    const forward = Math.sin(v.heading) * t.tx + Math.cos(v.heading) * t.tz >= 0 ? 1 : -1;
    const ahead = Math.max(2, Math.min(hit.edge.length - 2, hit.s + forward * (10 + hit.distance * 2)));
    const aim = graph.pointAt(hit.edge, ahead);
    await steerTo(aim.x, aim.z, { radius: 2, speed: 7, timeout: timeoutMs / 1000, done: onRoad });
  }

  /**
   * The turn the road autopilot cannot make: when the car is stuck within a few lengths of a junction on
   * its way to (x, z), a point a little way down the road it should leave by — for the bot to swing onto by
   * hand, three-point turn and all. Null when there is no junction close by on the route.
   */
  function turnOntoRoute(x, z) {
    const v = ctx.player.vehicle;
    const g = ctx.world.graph;
    if (!v) return null;
    const to = g.nearest(x, z, 60, (e) => e.drivable);
    const from = g.nearest(v.position.x, v.position.z, 60, (e) => e.drivable);
    if (!to || !from) return null;
    const end = to.s < to.edge.length / 2 ? to.edge.a : to.edge.b;
    let best = null;
    let bestLength = Infinity;
    for (const dir of [1, -1]) {
      if (dir === -1 && from.edge.oneway) continue;
      const node = g.endNode(from.edge, dir);
      const rest = g.route(node.index, end);
      if (!rest) continue;
      const toNode = dir === 1 ? from.edge.length - from.s : from.s;
      const length = toNode + rest.reduce((sum, leg) => sum + leg.edge.length, 0);
      if (length < bestLength) {
        bestLength = length;
        best = { rest, toNode };
      }
    }
    if (!best || best.toNode > 45 || !best.rest.length) return null;
    const leg = best.rest[0];
    const along = Math.min(30, leg.edge.length / 2);
    return g.lanePoint(leg.edge, leg.dir === 1 ? along : leg.edge.length - along, leg.dir, 0);
  }

  /**
   * Drive to a point along the roads, honestly: repeated dev.driveTo legs until arrived. `until` may end it
   * early (the mission step moved on). Profiles: gentle guards the panels, fast runs from the law. When the
   * autopilot stops making ground it reverses, rights the car and lets the autopilot re-plan from a cleaner spot.
   * Unless `rolling` (a race gate, a quarry, somewhere to flee towards), it comes off the speed on the way
   * in and stops there, as a driver does: the autopilot on its own passes a mid-road spot at full cruise.
   */
  async function driveTo(x, z, options = {}) {
    const radius = options.radius ?? 10;
    const cruise = options.speed ?? 22;
    const aggression = options.aggression ?? 1.25;
    const rolling = options.rolling ?? false;
    const deadline = now() + (options.timeout ?? 420) * 1000;
    const arrive = async () => {
      if (!rolling) await stopCar(3000);
      return 'arrived';
    };
    await noseToRoad();
    // Starting from the middle of a park or a yard: the road autopilot needs a road under it first, so
    // hand-drive back to the nearest one (dry line only — the Avon has swallowed getaways before).
    if (ctx.player.vehicle && !ctx.world.graph.nearest(pos().x, pos().z, 50, (e) => e.drivable)) {
      const back = ctx.world.graph.nearest(pos().x, pos().z, 400, (e) => e.drivable);
      if (back && dryLine(back.x, back.z)) await steerTo(back.x, back.z, { radius: 8, speed: 11, timeout: 50, done: options.until });
    }
    let legs = 0;
    let stalled = 0;
    // Progress is judged over a stretch of time, not per leg: nearer than it has been, or simply somewhere
    // else (a route may lead away before it leads back). Only a car that is neither is stuck.
    let best = Infinity;
    let mark = { x: pos().x, z: pos().z, at: now() };
    while (now() < deadline) {
      if (!ctx.player.alive) return 'died';
      if (options.until && options.until()) return 'done';
      if (!ctx.player.vehicle) return 'on foot';
      const d = dist(x, z);
      if (d <= radius) return arrive();
      const near = !rolling && d < 260;
      // Short legs near the end: the speed comes down with the distance, and a pilot that has stopped short
      // of an off-road spot is not waited on.
      const legSeconds = Math.min(near ? 5 : 20, (deadline - now()) / 1000);
      if (legSeconds <= 0) break;
      const speed = near ? Math.min(cruise, Math.max(8, d / 6)) : cruise;
      const r = await dev.driveTo(x, z, { speed, aggression, timeout: legSeconds, radius: Math.max(6, radius - 2) });
      legs++;
      if (r.startsWith('arrived')) return arrive();
      if (r.startsWith('left vehicle')) return 'on foot';
      const after = dist(x, z);
      const v = ctx.player.vehicle;
      const moved = Math.hypot(pos().x - mark.x, pos().z - mark.z);
      if (after <= best - 6 || moved > 25) {
        best = Math.min(best, after);
        mark = { x: pos().x, z: pos().z, at: now() };
        stalled = 0;
        if (legs % (near ? 6 : 3) === 0) log(`  bot: driving, ${Math.round(after)} m to go`);
        await sleep(60);
        continue;
      }
      // Give it a moment before calling it stuck: pulling away from rest takes a few seconds.
      if (now() - mark.at < (near ? 9 : 16) * 1000) {
        await sleep(60);
        continue;
      }
      // Stuck. Close by, the spot is somewhere the road autopilot will not go (a lay-by, a yard, a kerb
      // behind a parked van): pull in by hand, the way a player does.
      stalled++;
      mark = { x: pos().x, z: pos().z, at: now() };
      log(`  bot: making no ground (${Math.round(after)} m to go, ${r.split(';')[0]})`);
      if (v && (after < 60 || (after < 220 && dryLine(x, z)))) {
        // The road autopilot has given its best and the spot is off its network (a marae gate up a gravel
        // track, a yard, a lay-by): drive the rest by hand, the way a player does. Parking pace close in;
        // brisker over a longer run, and rather less patient with guns behind.
        const hot = (options.aggression ?? 1.25) >= 2.4;
        const pace = after >= 60 ? 11 : hot ? 13 : 6;
        if (await steerTo(x, z, { radius, speed: pace, timeout: after >= 60 ? 35 : 16, done: options.until })) return options.until && options.until() ? 'done' : arrive();
      } else if (v) {
        const turn = turnOntoRoute(x, z);
        if (turn) {
          // A junction too sharp for the autopilot (it circles): take the turn by hand and hand back.
          log(`  bot: taking the turn by hand`);
          await steerTo(turn.x, turn.z, { radius: 5, speed: 7, timeout: 25, done: options.until });
        } else {
          // Further out: a short reverse on some lock, then let the autopilot re-plan from a cleaner spot.
          // A spot the autopilot simply cannot route from is handed back to the caller to walk.
          if (v.wheelsOnGround < 3) v.recover();
          hold('KeyS', true);
          hold(stalled % 2 === 0 ? 'KeyA' : 'KeyD', true);
          await sleep(1500);
          releaseDrive();
          await stopCar(1500);
          await noseToRoad();
        }
      }
      if (r.startsWith('no route') || r.startsWith('no road')) {
        const road = v ? ctx.world.graph.nearest(v.position.x, v.position.z, 80, (e) => e.drivable) : null;
        if (!road) return 'no route';
      }
      if (stalled >= 6) return 'stuck driving';
      await sleep(120);
    }
    return 'timeout';
  }

  /** Go somewhere by whatever means a player would: drive if it is far or they have a car, walk the last bit. */
  async function goTo(x, z, options = {}) {
    const radius = options.radius ?? 4;
    const walkRadius = options.walkRadius ?? radius;
    const deadline = now() + (options.timeout ?? 600) * 1000;
    while (now() < deadline) {
      if (!ctx.player.alive) return 'died';
      if (options.until && options.until()) return 'done';
      const d = dist(x, z);
      if (d <= radius) {
        if (ctx.player.vehicle && options.onFoot) {
          await exitVehicle();
          continue;
        }
        return 'arrived';
      }
      if (ctx.player.vehicle) {
        const r = await driveTo(x, z, { ...options, radius: Math.max(radius, 9), timeout: (deadline - now()) / 1000 });
        if (r === 'arrived') {
          if (options.onFoot) await exitVehicle();
          continue;
        }
        if (r === 'died') return 'died';
        if (r === 'on foot') continue;
        if (r === 'no route' || r === 'timeout' || r === 'stuck driving') {
          // Close enough to leg it? Shun the car and walk the rest NOW: climbing into another car here
          // just drives the same dead end again (an hour of car-shopping at the Arowhenua gate proved it).
          if (dist(x, z) < 300) {
            const stuckCar = ctx.player.vehicle;
            await exitVehicle();
            if (stuckCar) shun(stuckCar, 120);
            const w = await walkTo(x, z, { radius: walkRadius, timeout: 150 });
            if (w === 'died') return 'died';
            continue;
          }
          return r;
        }
      } else if (d > (options.walkOver ?? 140)) {
        const car = nearestCar();
        if (car) {
          log(`  bot: taking the ${car.spec.id} ${Math.round(Math.hypot(car.position.x - ctx.player.position.x, car.position.z - ctx.player.position.z))} m away`);
          const r = await enterVehicle(car, { timeout: 30 });
          if (r === 'died') return 'died';
          if (r !== 'in') {
            log(`  bot: could not get into the ${car.spec.id} (${r}); leaving it be`);
            shun(car);
            await sleep(500);
          }
        } else {
          // No car in sight: walk towards it and keep looking.
          const r = await walkTo(x, z, { radius: walkRadius, timeout: 20 });
          if (r === 'died') return 'died';
        }
      } else {
        const r = await walkTo(x, z, { radius: walkRadius, timeout: Math.min(90, (deadline - now()) / 1000) });
        if (r === 'died') return 'died';
        if (r === 'arrived') continue;
        if (r === 'stuck') {
          // Back off and come at it again.
          const p = ctx.player.position;
          await walkTo(p.x + (Math.random() - 0.5) * 16, p.z + (Math.random() - 0.5) * 16, { radius: 3, timeout: 8 });
        }
      }
      await sleep(150);
    }
    return 'timeout';
  }

  // ───────────────────────────── The law ─────────────────────────────

  const seen = () => !!ctx.police.intel?.seen;

  function nearestCop() {
    const p = pos();
    let best = Infinity;
    for (const v of ctx.vehicles.all) {
      if (v.spec.id !== 'police' || v.destroyed) continue;
      best = Math.min(best, Math.hypot(v.position.x - p.x, v.position.z - p.z));
    }
    return best;
  }

  /** Where the nearest patrol car is, or null. */
  function nearestCopCar() {
    const p = pos();
    let best = null;
    let bestD = Infinity;
    for (const v of ctx.vehicles.all) {
      if (v.spec.id !== 'police' || v.destroyed) continue;
      const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /**
   * A far-off place to run for: ahead of the car rather than behind it (a U-turn in front of the law is an
   * arrest) and away from the nearest patrol car.
   */
  function fleeTarget() {
    const p = pos();
    const v = ctx.player.vehicle;
    const heading = v ? v.heading : ctx.player.heading;
    const cop = nearestCopCar();
    let best = ctx.world.places[0];
    let bestScore = -Infinity;
    for (const q of ctx.world.places) {
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 700 || d > 4000) continue;
      const ahead = (dx * Math.sin(heading) + dz * Math.cos(heading)) / d;
      let away = 0;
      if (cop) {
        const cx = p.x - cop.position.x;
        const cz = p.z - cop.position.z;
        const cd = Math.hypot(cx, cz) || 1;
        away = (dx * cx + dz * cz) / (d * cd);
      }
      const score = ahead + away * 0.8 - d / 8000;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    return best;
  }

  /** No water anywhere on the straight line from here to (x, z) — the Avon has swallowed getaways before. */
  function dryLine(x, z) {
    const p = pos();
    const d = Math.hypot(x - p.x, z - p.z);
    const n = Math.max(1, Math.ceil(d / 20));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (ctx.world.waterDepthAt(p.x + (x - p.x) * t, p.z + (z - p.z) * t) > 0.05) return false;
    }
    return true;
  }

  /**
   * Somewhere to go to ground: well off the road network, dry all the way there. Patrol cars are road-bound
   * and sight is short (90 m fresh at night), so two hundred metres of park is as good as a different city.
   */
  function hideSpot(opts = {}) {
    const rings = opts.rings ?? [110, 195, 280];
    const minOff = opts.minOff ?? 55;
    const p = pos();
    const cop = nearestCopCar();
    let best = null;
    let bestScore = -Infinity;
    for (const r of rings) {
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const x = p.x + Math.sin(ang) * r;
        const z = p.z + Math.cos(ang) * r;
        if (ctx.world.waterDepthAt(x, z) > 0.05 || ctx.world.surfaceAt(x, z) === 'water') continue;
        const road = ctx.world.graph.nearest(x, z, 240, (e) => e.drivable);
        const offRoad = road ? road.distance : 240;
        if (offRoad < minOff) continue;
        if (!dryLine(x, z)) continue;
        let away = 0;
        if (cop) away = Math.min(400, Math.hypot(x - cop.position.x, z - cop.position.z));
        const score = offRoad * 2 + away - r * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, offRoad };
        }
      }
    }
    return best;
  }

  /**
   * Go to ground the way the game teaches: open a gap on the roads, kerb the car the moment nobody has
   * eyes on you, and leg it into the dark on foot. A walker threads the trees and fences a car wedges on,
   * a parked car draws no fire, and the evade clock (about a minute for three lights) runs the whole time
   * you stand still unseen. Walks back afterwards is the caller's job — the kept car sits where it stopped.
   */
  async function lieLow(deadline) {
    const t0 = now();
    const give = now() + 170 * 1000;
    let spot = null;
    let flee = null;
    while (now() < Math.min(deadline, give)) {
      if (!ctx.player.alive) return 'died';
      if (ctx.police.level === 0) return 'clear';
      const v = ctx.player.vehicle;
      // The longer the chase has run, the smaller the gap we will settle for before stepping out.
      const gap = now() - t0 > 50 * 1000 ? 90 : 140;
      if (v && (seen() || nearestCop() < gap)) {
        if (!flee || dist(flee.x, flee.z) < 350) flee = fleeTarget();
        const flat = Math.min(52, v.spec.topSpeed * 0.93);
        await fleeLeg(flee, flat, ctx.police.level >= 3 ? 3.0 : 2.2, () => ctx.police.level === 0 || (!seen() && nearestCop() > gap));
        continue;
      }
      if (v) {
        // Unseen with a gap: kerb it and step out. They are looking for a moving car, not a parked one.
        await stopCar(2000);
        await exitVehicle();
        spot = null;
        continue;
      }
      if (seen()) spot = null;
      if (!spot) {
        spot = hideSpot({ rings: [60, 110, 170], minOff: 36 });
        if (!spot) return 'nowhere';
        log(`  bot: on foot, lying low ${Math.round(spot.offRoad)} m off the road`);
      }
      if (dist(spot.x, spot.z) > 6) {
        await walkTo(spot.x, spot.z, { radius: 5, timeout: 40 });
        continue;
      }
      await sleep(600); // standing still in the dark; the clock is running
    }
    return ctx.police.level === 0 ? 'clear' : 'no luck';
  }

  /** The nearest panel and paint shop, and what a respray would cost right now. */
  function sprayShop() {
    const p = pos();
    let best = null;
    let bestD = Infinity;
    for (const q of ctx.world.places) {
      if (!q.tags.includes('spray')) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best ? { place: best, distance: bestD, cost: 100 + 150 * ctx.police.level } : null;
  }

  /** Pull in at the panelbeater, stop, press Interact: fade, new paint, heat gone. */
  async function respray() {
    const shop = sprayShop();
    const v = ctx.player.vehicle;
    if (!shop || !v) return 'no shop';
    if (ctx.player.money < shop.cost) return 'too broke';
    log(`  bot: heading for a respray at ${shop.place.id} ($${shop.cost})`);
    // Chased in: drive like it. The shop refuses a respray while an officer can see the car, so from three
    // lights the laps of the block are the plan, not the fallback — flat out until a corner breaks the view.
    const hot = ctx.police.level >= 3;
    const go = { speed: hot ? 36 : 26, aggression: hot ? 2.6 : 1.6 };
    const r = await driveTo(shop.place.x, shop.place.z, { ...go, radius: 4, timeout: 90, until: () => ctx.police.level === 0 });
    if (r !== 'arrived') return r;
    const until = now() + 60 * 1000;
    while (now() < until && ctx.police.level > 0) {
      if (!ctx.player.alive) return 'died';
      if (seen()) {
        // They watched us in: a lap of the block first.
        await driveTo(shop.place.x + 120, shop.place.z, { speed: hot ? 38 : 28, aggression: hot ? 2.8 : 1.7, radius: 30, timeout: 10, rolling: true });
        await driveTo(shop.place.x, shop.place.z, { ...go, radius: 4, timeout: 30, until: () => ctx.police.level === 0 });
        continue;
      }
      if (!ctx.player.vehicle) break;
      await stopCar(2500);
      dev.tap('KeyF');
      await sleep(2500);
    }
    return ctx.police.level === 0 ? 'resprayed' : 'no luck';
  }

  /**
   * One leg of running from the law towards `t`. Short legs, so a car brought to a stand (boxed in, a
   * roadblock, a patrol car across the bonnet) is noticed: then it backs out on full lock and goes through
   * whatever is there with the autopilot's manners switched off, as anybody would with guns behind them.
   */
  let boxed = 0;
  async function fleeLeg(t, speed, aggression, until) {
    const v = ctx.player.vehicle;
    if (!v) return;
    if (Math.abs(v.speed) < 3 && boxed > 0) {
      hold('KeyS', true);
      hold(boxed % 2 === 0 ? 'KeyA' : 'KeyD', true);
      await sleep(1200);
      releaseDrive();
      await dev.driveTo(t.x, t.z, { speed, aggression: Math.max(aggression, 2.4), timeout: 4, radius: 20, avoid: false });
    } else {
      await driveTo(t.x, t.z, { speed, aggression, radius: 20, timeout: 4, rolling: true, until });
    }
    const now2 = ctx.player.vehicle;
    boxed = now2 && Math.abs(now2.speed) < 3 ? boxed + 1 : 0;
  }

  /**
   * Lose the wanted level the way the game intends: run hard until no officer has eyes on you, then keep
   * moving quietly, away from the pack, until the lights go out — or buy a respray once the first minute
   * of honest running has not shaken them. Stays in (or returns to) `keepVehicle`.
   */
  async function loseHeat(options = {}) {
    const deadline = now() + (options.timeout ?? 300) * 1000;
    const keep = options.vehicle ?? null;
    const sprayAfter = now() + (options.sprayAfter ?? 75) * 1000;
    let flee = null;
    let fleeUntil = 0;
    let noGround = false;
    while (now() < deadline) {
      if (!ctx.player.alive) return 'died';
      if (ctx.police.level === 0) return 'clear';
      const v = ctx.player.vehicle;
      if (!v) {
        // On foot at three lights with no car the mission pins us to: go to ground first, as the game
        // teaches. Grabbing the nearest parked car starts a pursuit it probably cannot outrun — the quad
        // fight's staged van tops out well under the level-3 cruise, and died proving it.
        if (!noGround && !keep && ctx.police.level >= 3) {
          const r = await lieLow(deadline);
          if (r === 'died') return 'died';
          if (r === 'clear' || ctx.police.level === 0) return 'clear';
          if (r === 'nowhere') noGround = true;
          continue;
        }
        const back = keep && !keep.destroyed ? keep : nearestCar();
        if (back) await enterVehicle(back, { timeout: 25 });
        else await sleep(500);
        continue;
      }
      // A car the mission pins us to with real heat on — or anything at three lights, where flat-out running
      // never breaks their eyes on the open avenues: go to ground off the road network first (honest, and
      // the dark is free), then the paint shop, and only then back to running.
      if (!noGround && ctx.police.level >= (keep ? 2 : 3)) {
        const r = await lieLow(deadline);
        if (r === 'died') return 'died';
        if (r === 'clear' || ctx.police.level === 0) return 'clear';
        if (r === 'nowhere') noGround = true; // nothing but streets within reach of here
        const s = await respray();
        if (s === 'died') return 'died';
        if (s === 'resprayed' || ctx.police.level === 0) return 'clear';
        continue;
      }
      if (now() > sprayAfter && ctx.police.level > 0) {
        const r = await respray();
        if (r === 'resprayed' || ctx.police.level === 0) return 'clear';
      }
      // From three lights they shoot, so "nearly out of sight" is not good enough: stay flat out for longer.
      const hot = seen() || nearestCop() < (ctx.police.level >= 3 ? 320 : 150);
      // One place to run for, kept until it is nearly reached: changing it every leg has the car doubling
      // back past the people chasing it.
      if (!flee || now() > fleeUntil || dist(flee.x, flee.z) < 350) {
        flee = fleeTarget();
        fleeUntil = now() + 60 * 1000;
      }
      // Seen: everything the car has (a player's foot is flat). Unseen: brisk, to stay ahead of the search.
      const flat = Math.min(52, v.spec.topSpeed * 0.93);
      // 2.2 is past the autopilot's pursuit threshold: it overtakes at once and gives way to nobody, which
      // is how anybody drives with a patrol car in the mirror.
      // From three lights the pursuit itself drives at 2.4 and up, so the getaway has to as well: in town the
      // autopilot's speed is the limit times its aggression, whatever the car could do.
      await fleeLeg(flee, hot ? flat : Math.min(flat, 24), hot ? (ctx.police.level >= 3 ? 3.0 : 2.2) : 1.3, () => ctx.police.level === 0);
    }
    return 'timeout';
  }

  // ───────────────────────────── Fights ─────────────────────────────

  /** Walk over staged health or armour within reach when short — part of honest play between fights. */
  async function grabKit(radius = 45) {
    if (!dev.pickups) return;
    for (let i = 0; i < 4; i++) {
      if (!ctx.player.alive || ctx.player.vehicle) return;
      const low = ctx.player.health < ctx.player.maxHealth - 5;
      const bare = ctx.player.armour < 95;
      if (!low && !bare) return;
      const packs = dev
        .pickups()
        .filter((q) => ((q.kind === 'health' && low) || (q.kind === 'armour' && bare)) && dist(q.x, q.z) <= radius)
        .sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z));
      if (!packs.length) return;
      const t = packs[0];
      log(`  bot: grabbing the ${t.kind} pack`);
      const r = await walkTo(t.x, t.z, { radius: 1.2, timeout: 20 });
      if (r !== 'arrived') return;
      await sleep(250);
    }
  }

  /** Fight the current eliminate step with what the game gave: aim-and-fire until they or the player drop. */
  async function fightStep(stepIndex, options = {}) {
    const deadline = now() + (options.timeout ?? 180) * 1000;
    let standoffs = 0; // consecutive bursts that hit nothing and cost nothing
    while (now() < deadline) {
      if (!ctx.player.alive) return 'died';
      const st = dev.step();
      if (!st || st.index !== stepIndex) return 'done';
      // A player's fight rhythm, in six-second beats: a shotgun is spent air past ~28 m, so walk up in a
      // short, re-measured hop (a converging crew closes the gap itself); crowded under 9 m with more than
      // one of them still up, give ground while firing — nobody stands still in a crowd.
      const near = nearestTargetOf(st);
      if (near && near.d > 28 && ctx.combat.current.id === 'shotgun') {
        await walkTo(near.x, near.z, { radius: 20, timeout: 2.5 });
        continue;
      }
      const up = (st.step.targets ?? []).filter((n) => {
        const e = st.run.entities.find((q) => q.name === n);
        return e && e.ped && e.ped.alive;
      }).length;
      const kite = near && near.d < 9 && up > 1;
      if (kite) hold('KeyS', true);
      const burst = await dev.fight(6);
      if (kite) hold('KeyS', false);
      metrics.fights.push(burst);
      // Running low with a staged pack in reach: sprint for it mid-fight, the way any player does at 30
      // health with a medkit by the gatehouse. The kit the missions stage is part of the fight's budget.
      if (ctx.player.alive && (ctx.player.health < 45 || (ctx.player.armour < 10 && ctx.player.health < ctx.player.maxHealth - 20))) await grabKit(35);
      if (!burst.alive) return 'died';
      if (burst.of === 0 || burst.killed === burst.of) await sleep(600);
      else if (burst.killed === 0 && burst.damageTaken === 0) {
        // A burst that hit nothing and cost nothing is a stand-off — they are wedged behind a fence or
        // their own parked car. A player walks over and settles it; so does the bot. Say where they stand:
        // a stand-off that repeats is the mission's bug, not the bot's, and the spot names the culprit.
        standoffs++;
        const t = nearestTargetOf(st);
        if (t) {
          log(
            `  bot: stand-off ${standoffs} — ${t.name} ${Math.round(t.d)} m away at ${Math.round(t.x)},${Math.round(t.z)}` +
              ` (me ${Math.round(pos().x)},${Math.round(pos().z)}), hostile ${t.hostile}`,
          );
          await walkTo(t.x, t.z, { radius: 5, timeout: 25 });
        }
      } else standoffs = 0;
    }
    return 'timeout';
  }

  /** The nearest living target of an eliminate step. */
  function nearestTargetOf(st) {
    const p = pos();
    let best = null;
    let bestD = Infinity;
    for (const name of st.step.targets ?? []) {
      const e = st.run.entities.find((q) => q.name === name);
      const ped = e?.ped;
      if (!ped || !ped.alive) continue;
      const d = Math.hypot(ped.position.x - p.x, ped.position.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = { x: ped.position.x, z: ped.position.z, d, name, hostile: e.hostile === true };
      }
    }
    return best;
  }

  // ───────────────────────────── Mission steps ─────────────────────────────

  /** Drive profile for the current step: guard the panels when damage fails the job, hurry when timed. */
  function driveProfile(st) {
    const timed = st.run.stepTimer >= 0 || st.run.missionTimeLeft >= 0;
    const fragile = st.step.minHealth !== undefined || st.step.kind === 'deliverVehicle';
    // A fragile cargo on the clock: drive briskly to beat it (the vehicles that carry one are given the
    // health to take a few knocks), but not so hard as to pinball off every car.
    if (timed && fragile) return { speed: 27, aggression: 1.35 };
    if (timed) return { speed: 28, aggression: 1.7 };
    if (fragile) return { speed: 17, aggression: 1.05 };
    return { speed: 22, aggression: 1.25 };
  }

  /** One pass at the current step. Returns when the step index moves on, the mission ends, or it is stuck. */
  async function playStep(st) {
    const kind = st.kind;
    const index = st.index;
    const run = st.run;
    const stillHere = () => {
      const s = dev.step();
      return s && s.index === index ? s : null;
    };

    if (kind === 'say') {
      // Talk is the one safe moment a fight scene offers: top up from any staged kit while it runs.
      await grabKit(30);
      const until = now() + 90 * 1000;
      while (stillHere() && now() < until) await sleep(400);
      return;
    }

    if (kind === 'goTo' || kind === 'deliverVehicle' || kind === 'chase') {
      const profile = driveProfile(st);
      const until = now() + 420 * 1000;
      let settleFails = 0;
      while (now() < until) {
        const s = stillHere();
        if (!s) return;
        const target = s.target;
        if (!target) {
          await sleep(400);
          continue;
        }
        const step = s.step;
        // deliverVehicle / vehicle-mode goTo: be in the right seat first.
        const wantedVehicle = step.kind === 'deliverVehicle' ? run.entities.find((e) => e.name === step.vehicle)?.vehicle : step.vehicle ? run.entities.find((e) => e.name === step.vehicle)?.vehicle : null;
        if (wantedVehicle && ctx.player.vehicle !== wantedVehicle) {
          const r = await enterVehicle(wantedVehicle, { timeout: 40 });
          if (r === 'died') return;
          if (r !== 'in') {
            await sleep(400);
            continue;
          }
        }
        const onFoot = step.mode === 'foot';
        // Aim for the step's own radius (a little inside it), and — crucially — stop the instant the step
        // advances, so a target tucked off the road doesn't make the bot drive past a ring the game accepts.
        const ring = step.radius ?? (step.kind === 'deliverVehicle' ? 8 : 6);
        const radius = Math.max(2, ring - 2);
        if (kind === 'chase') {
          // A chase on foot is lost before it starts: back into a car first — the mission's own car over
          // whatever is closest (the nearest thing to the finale's roadblock is the enemies' shot-up ute,
          // and the bot once chased a van down the wrong side of the pass in it at 35% health).
          if (!ctx.player.vehicle) {
            const own = run.entities.find((q) => q.vehicle && !q.vehicle.destroyed && q.vehicle.tags && q.vehicle.tags.has('owned') && Math.hypot(q.vehicle.position.x - pos().x, q.vehicle.position.z - pos().z) < 160);
            const back = own ? own.vehicle : nearestCar();
            if (!back) {
              await sleep(500);
              continue;
            }
            const r = await enterVehicle(back, { timeout: 30 });
            if (r === 'died') return;
            if (r !== 'in') {
              await sleep(400);
              continue;
            }
          }
          // Stay on the moving target itself, one short leg at a time (fall back to its destination).
          const quarry = run.entities.find((e) => e.name === step.target)?.vehicle;
          const tx = quarry ? quarry.position.x : target.x;
          const tz = quarry ? quarry.position.z : target.z;
          await driveTo(tx, tz, { speed: 30, aggression: 1.8, radius: 24, timeout: 5, rolling: true, until: () => !stillHere() });
          continue;
        }
        const r = await goTo(target.x, target.z, { ...profile, radius, onFoot, timeout: 60, until: () => !stillHere() });
        if (r === 'died') return;
        if (r === 'done') continue; // the step moved on while we were driving
        // Clean deliveries: lose the heat first.
        if (stillHere() && step.clean && ctx.police.level > 0) {
          await loseHeat({ vehicle: ctx.player.vehicle, timeout: 240 });
        }
        // Arrived in the car (a delivery, or a 'stop' goTo): hold the brake flat until it is truly stopped —
        // not just under stopCar's 1.2 m/s coast threshold — and wait out the handover's fade, which needs
        // a genuinely stationary car. A gentle 0.8 m/s creep used to sit 6 m from the garage forever.
        if (stillHere() && ctx.player.vehicle && dist(target.x, target.z) <= (step.radius ?? 8) + 1) {
          const settle = now() + 6000;
          while (stillHere() && ctx.player.vehicle && now() < settle) {
            const v = ctx.player.vehicle;
            if (Math.abs(v.speed) > 0.3) hold('KeyS', v.speed > 0);
            else {
              releaseDrive();
              await sleep(400);
            }
            await sleep(80);
          }
          releaseDrive();
          // Still on the step with the car inside the ring: the game is not taking it (chain-9 sat 6 m from
          // Dazza's garage for twenty minutes, creeping on the frontage). Say why from the step's side of the
          // fence, then do what a player does to a bad park: back out and take another run at it.
          if (stillHere() && ctx.player.vehicle && dist(target.x, target.z) <= (step.radius ?? 8) + 1) {
            settleFails++;
            const v = ctx.player.vehicle;
            const ent = step.vehicle ? run.entities.find((q) => q.name === step.vehicle) : null;
            const mv = ent ? ent.vehicle : null;
            const which = mv ? (mv === v ? 'the car I am in' : 'NOT the car I am in') : 'no car resolved';
            log(
              `  bot: parked inside the ring but the step will not take it ` +
                `(entity ${ent ? ent.state : 'none'}, ${which}, speed ${Math.abs(v.speed).toFixed(2)} m/s, heat ${ctx.police.level})`,
            );
            if (v.wheelsOnGround < 4) v.recover();
            hold('KeyS', true);
            hold(settleFails % 2 === 0 ? 'KeyA' : 'KeyD', true);
            await sleep(2200);
            releaseDrive();
            await stopCar(2000);
          } else {
            settleFails = 0;
          }
        }
      }
      return;
    }

    if (kind === 'enterVehicle') {
      const until = now() + 240 * 1000;
      while (now() < until) {
        const s = stillHere();
        if (!s) return;
        const e = run.entities.find((q) => q.name === s.step.vehicle);
        if (!e) {
          await sleep(500);
          continue;
        }
        if (e.vehicle) {
          const r = await enterVehicle(e.vehicle, { timeout: 60 });
          if (r === 'died' || r === 'in') return;
        } else if (e.resolved) {
          // Not spawned yet: close in on its spot for real.
          const r = await goTo(e.at.x, e.at.z, { radius: 25, timeout: 90 });
          if (r === 'died') return;
          await sleep(800);
        } else await sleep(500);
      }
      return;
    }

    if (kind === 'eliminate') {
      // Nobody fights a shoot-out from the cab: the car is cover for the enemy and a coffin for the driver.
      if (ctx.player.vehicle) await exitVehicle();
      await grabKit();
      await fightStep(index);
      await grabKit();
      return;
    }

    if (kind === 'loseHeat') {
      const e = st.step.vehicle ? run.entities.find((q) => q.name === st.step.vehicle) : null;
      const until = now() + 360 * 1000;
      while (now() < until) {
        const s = stillHere();
        if (!s) return;
        // One long call, not sixty-second slices: the respray only arms partway into a single run of honest
        // fleeing, so slicing the timeout meant the paint shop was never tried at all. When the mission makes
        // the player keep this exact car the paint shop is the designed way out, so go straight there while
        // the head start lasts; a mission that lets the car go gets the honest run-and-hide first.
        const r = await loseHeat({ vehicle: e?.vehicle ?? null, timeout: 330, sprayAfter: e?.vehicle ? 0 : 75 });
        if (r === 'died') return;
        if (r === 'clear') {
          // Lights out — but the step with a vehicle waits for the player back at its wheel (the bot may
          // have gone to ground on foot streets away), and one without still counts down its hold.
          if (e?.vehicle && ctx.player.vehicle !== e.vehicle && !e.vehicle.destroyed) {
            const back = await enterVehicle(e.vehicle, { timeout: 120 });
            if (back === 'died') return;
          } else await sleep(600);
        }
      }
      return;
    }

    if (kind === 'survive') {
      // A countdown with the law on the bumper: stay at the wheel and keep moving until it runs out.
      const until = now() + 300 * 1000;
      let flee = null;
      while (now() < until && stillHere()) {
        if (!ctx.player.alive) return;
        const v = ctx.player.vehicle;
        if (!v) {
          const car = nearestCar();
          if (car) await enterVehicle(car, { timeout: 25 });
          else await sleep(500);
          continue;
        }
        if (!flee || dist(flee.x, flee.z) < 350) flee = fleeTarget();
        await fleeLeg(flee, Math.min(44, v.spec.topSpeed * 0.95), 2.2, () => !stillHere());
      }
      return;
    }

    if (kind === 'race') {
      const until = now() + 420 * 1000;
      while (now() < until) {
        const s = stillHere();
        if (!s) return;
        const data = s.run.scratch?.data;
        if (!data || !data.go || !data.cps?.length) {
          await sleep(300);
          continue;
        }
        const startNext = data.next;
        const cp = data.cps[startNext % data.cps.length];
        await driveTo(cp.x, cp.z, { speed: 38, aggression: 2.0, radius: Math.max(10, (data.radius ?? 22) - 6), timeout: 30, rolling: true, until: () => {
          const q = stillHere();
          return !q || (q.run.scratch?.data?.next ?? 0) !== startNext;
        } });
      }
      return;
    }

    // Everything else (spawns, waits, weather, weapons, timers) runs itself.
    const until = now() + 120 * 1000;
    while (stillHere() && now() < until) await sleep(400);
  }

  // ───────────────────────────── Missions ─────────────────────────────

  async function waitForLife() {
    const until = now() + 30 * 1000;
    while ((!ctx.player.alive || !ctx.player.controlsEnabled) && now() < until) await sleep(500);
    await sleep(800);
  }

  /** Travel to a mission's start place (honestly) and wait until the law has lost interest. */
  async function travelTo(placeId) {
    const place = ctx.world.place(placeId);
    const r = await goTo(place.x, place.z, { radius: 2.2, onFoot: true, timeout: 900 });
    if (r === 'died') {
      await waitForLife();
      return travelTo(placeId);
    }
    const until = now() + 240 * 1000;
    while (ctx.police.level > 0 && now() < until) {
      await loseHeat({ timeout: 120 });
      if (ctx.police.level === 0) return goTo(place.x, place.z, { radius: 2.2, onFoot: true, timeout: 600 }).then(() => 'arrived');
    }
    return r;
  }

  /**
   * After a failure the game offers another go from the last checkpoint. Take it the way a player would:
   * wait for the card, press Enter on "Go again", and wait out the fade back to the checkpoint.
   */
  async function acceptRetryOffer(id) {
    const until = now() + 12 * 1000;
    while (now() < until) {
      const card = document.querySelector('.nw-choose.on');
      if (card && /another go/i.test(card.querySelector('.nw-choose-title')?.textContent ?? '')) {
        await sleep(400);
        dev.tap('Enter');
        const started = now() + 15 * 1000;
        while (now() < started) {
          if (ctx.missions.active?.id === id) return true;
          await sleep(300);
        }
        return false;
      }
      await sleep(300);
    }
    return false;
  }

  /** Play one mission from its start place, honestly, with retries. Returns the full record. */
  async function runMission(id, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const summaryOf = () => ctx.missions.list().find((m) => m.id === id);
    const record = { id, attempts: [], result: 'not-run' };
    // `running`: the caller has already started it (honest.mjs --checkpoint resumes one part-way in).
    let running = options.running ?? false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      metrics.reset();
      lastVitals = ctx.player.health + ctx.player.armour;
      const failures = [];
      const offFail = ctx.events.on('missionFailed', (e) => {
        if (e.id === id) failures.push(e.reason);
      });
      const t0 = now();
      if (!running) {
        const place = summaryOf()?.placeId;
        if (place) {
          const t = await travelTo(place);
          if (t !== 'arrived') log(`${id}: could not reach the start (${t})`);
        }
        if (!ctx.missions.start(id)) {
          offFail();
          record.result = 'could not start';
          log(`${id}: could not start (state ${summaryOf()?.state})`);
          return record;
        }
      }
      running = false;
      log(`${id}: attempt ${attempt} started`);
      let lastIndex = -1;
      const hardStop = now() + (options.timeout ?? 1500) * 1000;
      while (now() < hardStop) {
        const st = dev.step();
        if (!st) break;
        if (st.index !== lastIndex) {
          lastIndex = st.index;
          log(`${id}:   #${st.index}/${st.of} ${st.kind}${st.objective ? ' — ' + st.objective : ''}`);
        }
        await playStep(st);
        await sleep(200);
      }
      offFail();
      await sleep(1500);
      const state = summaryOf()?.state;
      const seconds = Math.round((now() - t0) / 1000);
      const att = {
        attempt,
        seconds,
        result: state === 'done' ? 'passed' : failures.length ? 'failed' : 'stuck',
        reasons: failures,
        deaths: metrics.deaths,
        busts: metrics.busts,
        damageTaken: Math.round(metrics.damageTaken),
        maxHeat: metrics.maxHeat,
        fights: metrics.fights,
        timerSlack: metrics.timerSlack.slice(),
        money: ctx.player.money,
      };
      record.attempts.push(att);
      log(`${id}: attempt ${attempt} ${att.result} in ${seconds}s (damage ${att.damageTaken}, deaths ${att.deaths}, heat ${att.maxHeat})${failures.length ? ' — ' + failures.join('; ') : ''}`);
      if (att.result === 'passed') {
        record.result = 'passed';
        return record;
      }
      if (att.result === 'stuck') {
        ctx.missions.abort('playtest stuck');
        record.result = 'stuck';
        return record;
      }
      await waitForLife();
      running = await acceptRetryOffer(id);
      if (running) log(`${id}: took the retry offer — back at the checkpoint`);
    }
    record.result = 'failed';
    return record;
  }

  return { ctx, dev, metrics, sleep, watch, walkTo, enterVehicle, exitVehicle, ensureCar, nearestCar, steerTo, stopCar, driveTo, goTo, loseHeat, respray, sprayShop, fightStep, travelTo, runMission, waitForLife, seen, nearestCop, dist, condition };
})();
