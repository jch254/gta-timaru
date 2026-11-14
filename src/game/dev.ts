import type { Game } from './game';

/** Console helpers for development builds: `dev.tp('cathedral-square')`, `dev.time(22)`, `dev.car('ute')`… */
export function installDevTools(game: Game) {
  const { ctx } = game;
  const key = (type: string, code: string) => window.dispatchEvent(new KeyboardEvent(type, { code }));
  const dev = {
    game,
    ctx,
    /** Teleport to a place id or coordinates, waiting for the area to load. */
    async tp(target: string | number, z?: number, heading = 0) {
      const spot = typeof target === 'string' ? ctx.world.place(target) : { x: target, z: z ?? 0, heading };
      await ctx.world.whenLoaded(spot.x, spot.z);
      ctx.player.teleport(spot.x, spot.z, spot.heading);
      return `${Math.round(spot.x)}, ${Math.round(spot.z)} — ${ctx.world.locationName(spot.x, spot.z)}`;
    },
    time(hour: number) {
      ctx.clock.hour = hour;
    },
    weather(kind: Parameters<typeof ctx.env.setWeather>[0]) {
      ctx.env.setWeather(kind, 1);
    },
    /** Spawn a vehicle just ahead of the player and get in. */
    car(specId = 'statesman') {
      const p = ctx.player.position;
      const h = ctx.player.heading;
      const v = ctx.vehicles.spawn(specId, p.x + Math.sin(h) * 5, p.z + Math.cos(h) * 5, h, { tags: ['owned'] });
      if (v) ctx.player.warpIntoVehicle(v);
      return v;
    },
    money(amount: number) {
      ctx.player.addMoney(amount);
    },
    heat(level: number) {
      ctx.police.setLevel(level);
    },
    arm() {
      for (const id of ctx.combat.weapons.keys()) ctx.combat.give(id, 200);
    },
    god(on = true) {
      ctx.player.maxHealth = on ? 1e9 : 100;
      ctx.player.health = ctx.player.maxHealth;
    },
    /** Hold keys for a while: `await dev.hold(['KeyW'], 3000)`. */
    async hold(codes: string[], ms: number) {
      for (const c of codes) key('keydown', c);
      await new Promise((r) => setTimeout(r, ms));
      for (const c of codes) key('keyup', c);
    },
    tap(code: string) {
      key('keydown', code);
      setTimeout(() => key('keyup', code), 60);
    },
    /** Point the camera: yaw (heading), pitch, zoom. */
    look(yaw: number, pitch = 0.2, zoom = 1) {
      const cam = (ctx.player as unknown as { camera: { yaw: number; pitch: number; zoom: number; sinceLook: number } }).camera;
      cam.yaw = yaw;
      cam.pitch = pitch;
      cam.zoom = zoom;
      cam.sinceLook = -1e6;
    },
    /**
     * Test autopilot: drive the player's current vehicle to a place id or coordinates along the roads.
     * Resolves with how it ended. Hands control back to the player afterwards.
     */
    async driveTo(target: string | number, z?: number, options: { speed?: number; aggression?: number; timeout?: number; radius?: number; avoid?: boolean } = {}) {
      const vehicle = ctx.player.vehicle;
      if (!vehicle) return 'not in a vehicle';
      const spot = typeof target === 'string' ? ctx.world.place(target) : { x: target, z: z ?? 0 };
      const graph = ctx.world.graph;
      const to = graph.nearest(spot.x, spot.z, 60, (e) => e.drivable);
      if (!to) return 'no road near target';
      const endNode = to.s < to.edge.length / 2 ? to.edge.a : to.edge.b;
      const pilot = ctx.traffic.createAutopilot(vehicle);
      const previous = vehicle.controller;
      vehicle.controller = 'mission';
      pilot.cruiseSpeed = options.speed ?? 27;
      pilot.aggression = options.aggression ?? 1.25;
      pilot.avoidObstacles = options.avoid ?? true;
      /** Plan from wherever the vehicle is now, leaving the current edge by whichever end is quicker. */
      const plan = (): boolean => {
        const from = graph.nearest(vehicle.position.x, vehicle.position.z, 60, (e) => e.drivable);
        if (!from) return false;
        let best: { edge: typeof from.edge; dir: 1 | -1 }[] | null = null;
        let bestLength = Infinity;
        for (const dir of [1, -1] as const) {
          if (dir === -1 && from.edge.oneway) continue;
          const rest = graph.route(graph.endNode(from.edge, dir).index, endNode);
          if (!rest) continue;
          // Facing the wrong way costs a U-turn.
          const facing = Math.cos(vehicle.heading - Math.atan2(graph.pointAt(from.edge, from.s).tx * dir, graph.pointAt(from.edge, from.s).tz * dir));
          const deadEnd = graph.endNode(from.edge, dir).edges.length === 1;
          const length = (dir === 1 ? from.edge.length - from.s : from.s) + rest.reduce((sum, leg) => sum + leg.edge.length, 0) + (facing < 0 ? 60 : 0) + (deadEnd ? 400 : 0);
          if (length < bestLength) {
            bestLength = length;
            best = [{ edge: from.edge, dir }, ...rest];
          }
        }
        if (!best) return false;
        // Start from the carriageway, facing the right way: the autopilot is a road driver, not a car-park navigator.
        if (from.distance > from.edge.width / 2) {
          const s0 = Math.min(from.edge.length - 8, Math.max(8, from.s));
          const lane = graph.lanePoint(from.edge, s0, best[0].dir, 0);
          vehicle.teleport(lane.x, ctx.world.groundAt(lane.x, lane.z), lane.z, lane.heading);
        }
        pilot.setRoute(best, from.s);
        return true;
      };
      if (!plan()) {
        vehicle.controller = previous;
        return 'no route';
      }
      const radius = options.radius ?? 14;
      let result = '';
      // Driven from the simulation itself so it keeps working when the page is throttled.
      const hook = (dt: number) => {
        if (result) return;
        if (ctx.player.vehicle !== vehicle) result = 'left vehicle';
        else if (Math.hypot(vehicle.position.x - spot.x, vehicle.position.z - spot.z) < radius) result = 'arrived';
        else {
          if (pilot.arrived) {
            // Route finished: close in directly when near, otherwise plan again from here.
            if (Math.hypot(vehicle.position.x - spot.x, vehicle.position.z - spot.z) < 70 || !plan()) pilot.setTarget(spot.x, spot.z);
          }
          pilot.update(dt);
        }
      };
      game.hooks.add(hook);
      const deadline = performance.now() + (options.timeout ?? 35) * 1000;
      while (!result && performance.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      game.hooks.delete(hook);
      if (!result) result = 'timeout';
      pilot.stop();
      vehicle.controller = previous === 'mission' ? 'player' : previous;
      vehicle.controls.throttle = 0;
      vehicle.controls.steer = 0;
      vehicle.controls.brake = 1;
      const d = Math.round(Math.hypot(vehicle.position.x - spot.x, vehicle.position.z - spot.z));
      return `${result}; ${d} m from target; ${Math.round(Math.abs(vehicle.speed) * 3.6)} km/h; health ${Math.round(vehicle.health)}`;
    },
    /** Mark every mission before `id` as done and start it (test use only). */
    startMission(id: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runner = (ctx.missions as any).runner;
      for (const m of ctx.missions.list()) {
        if (m.id === id) break;
        runner?.done?.add(m.id);
      }
      runner?.refresh?.();
      return ctx.missions.start(id);
    },
    /** The active mission's current step, read from the runner's internals (test use only). */
    step() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const run = (ctx.missions as any).runner?.run;
      if (!run) return null;
      const step = run.def.steps[run.stepIndex] ?? {};
      const t = run.scratch?.target;
      return {
        mission: run.def.id as string,
        index: run.stepIndex as number,
        of: run.def.steps.length as number,
        kind: step.kind as string,
        objective: run.objectiveText as string | null,
        target: t && typeof t.x === 'number' ? { x: t.x as number, z: t.z as number } : null,
        step,
        run,
      };
    },
    /**
     * Test player: plays the active mission by the most direct means for up to `seconds`, teleporting long
     * distances and cheating fights, so mission logic can be checked end to end. Returns a log of steps.
     */
    async auto(seconds = 30, options: { fights?: 'cheat' | 'stop' } = {}) {
      const log: string[] = [];
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const deadline = performance.now() + seconds * 1000;
      let lastIndex = -1;
      let acted = 0;
      const note = (text: string) => {
        if (log[log.length - 1] !== text) log.push(text);
      };
      while (performance.now() < deadline) {
        const st = dev.step();
        if (!st) {
          note('no active mission');
          break;
        }
        if (st.index !== lastIndex) {
          lastIndex = st.index;
          acted = 0;
          note('#' + st.index + ' of ' + st.of + ' ' + st.kind + (st.objective ? ': ' + st.objective : ''));
        }
        const player = ctx.player;
        const v = player.vehicle;
        // This checks mission logic, not driving: the test player's car is patched up as it goes, or a clumsy
        // getaway wrecks it and fails the job for a reason that has nothing to do with the mission.
        if (v && !v.destroyed && !v.burning) v.health = Math.max(v.health, v.spec.health * 0.8);
        const kind = st.kind;
        if (kind === 'race') {
          // Hop through the checkpoints in order once the flag drops.
          const data = st.run.scratch?.data;
          if (data?.go && v && data.cps?.length) {
            const cp = data.cps[data.next % data.cps.length];
            await ctx.world.whenLoaded(cp.x, cp.z);
            v.teleport(cp.x, ctx.world.groundAt(cp.x, cp.z), cp.z, cp.heading ?? v.heading);
            note('  checkpoint ' + (data.next + 1) + ' of ' + data.total);
            await wait(700);
          } else await wait(500);
        } else if ((kind === 'goTo' || kind === 'deliverVehicle' || kind === 'chase') && st.target) {
          const t = st.target;
          const here = v ? v.position : player.position;
          const d = Math.hypot(here.x - t.x, here.z - t.z);
          const radius = Math.max(4, (st.step.radius ?? 10) * 0.8);
          if (v) {
            if (d > radius * 0.6) {
              // Skip the driving (the autopilot is tested separately): put the vehicle on the spot and stop.
              await ctx.world.whenLoaded(t.x, t.z);
              const hit = ctx.world.graph.nearest(t.x, t.z, 60, (e) => e.drivable);
              const heading = hit ? Math.atan2(hit.edge.samples[0].tx, hit.edge.samples[0].tz) : v.heading;
              v.teleport(t.x + 1.5, ctx.world.groundAt(t.x + 1.5, t.z), t.z, heading);
              note('  teleported vehicle to target (' + Math.round(d) + ' m away)');
            }
            v.controls.throttle = 0;
            v.controls.brake = 1;
            await wait(1200);
          } else if (d > 3) {
            await ctx.world.whenLoaded(t.x, t.z);
            player.teleport(t.x + 0.6, t.z + 0.6, 0);
            note('  teleported on foot to target');
            await wait(800);
          } else await wait(500);
        } else if (kind === 'enterVehicle') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const record = (st.run.entities as any[])?.find?.((e) => e.name === st.step.vehicle) ?? null;
          const target = record?.vehicle ?? null;
          if (!target) {
            // Not spawned yet: mission entities appear when the player is near their spot.
            const spot = record?.at ?? record?.spot;
            if (spot && typeof spot.x === 'number' && Math.hypot(player.position.x - spot.x, player.position.z - spot.z) > 60) {
              await ctx.world.whenLoaded(spot.x, spot.z);
              if (player.vehicle) player.vehicle.teleport(spot.x + 8, ctx.world.groundAt(spot.x + 8, spot.z), spot.z, 0);
              else player.teleport(spot.x + 4, spot.z, 0);
              note('  moved next to where the vehicle spawns');
            } else note('  waiting for the vehicle to spawn (' + (record?.state ?? 'no record') + ')');
            await wait(1000);
          } else if (player.vehicle === target) await wait(300);
          else {
            if (player.vehicle) {
              player.vehicle.controls.brake = 1;
              await wait(600);
              dev.tap('KeyF');
              await wait(700);
            }
            await ctx.world.whenLoaded(target.position.x, target.position.z);
            const door = player.position.clone();
            target.doorPosition(door, 0);
            player.teleport(door.x, door.z, target.heading);
            await wait(500);
            dev.tap('KeyF');
            note('  entered ' + target.spec.id);
            await wait(1000);
          }
        } else if (kind === 'loseHeat') {
          if ((st.run.minWanted ?? 0) > 0) {
            // The mission is holding the heat on for now. Keep moving so the law cannot make an arrest.
            const from = v ? v.position : player.position;
            const far = ctx.world.places.filter((p) => Math.hypot(p.x - from.x, p.z - from.z) > 500).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
            if (v && far) {
              note('  fleeing towards ' + far.id + ' while the mission holds the heat on');
              await dev.driveTo(far.x, far.z, { timeout: Math.min(8, (deadline - performance.now()) / 1000), speed: 30, aggression: 2, avoid: false });
            } else await wait(600);
          } else {
            if (acted++ > 2) {
              ctx.police.clear();
              note('  cleared heat');
            }
            if (v) {
              v.controls.throttle = 0;
              v.controls.brake = 1;
            }
            await wait(600);
          }
        } else if (kind === 'eliminate' && options.fights === 'stop') {
          note('  stopped at the fight');
          break;
        } else if (kind === 'eliminate') {
          if (acted++ > 3) {
            for (const a of ctx.actors.all) {
              if ((a.kind === 'gang' || a.kind === 'scripted') && a.alive) a.takeDamage({ amount: 9999, kind: 'bullet', source: player });
            }
            for (const c of ctx.vehicles.all) if (c.tags.has('enemy') && !c.destroyed) c.applyDamage(9999, player);
            note('  eliminated hostiles');
          }
          await wait(700);
        } else if (kind === 'say') {
          // Skip the talking.
          await wait(900);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ctx.missions as any).dialogue?.clear?.();
        } else {
          await wait(500);
        }
      }
      const end = dev.step();
      log.push(end ? 'still on #' + end.index + ' ' + end.kind : 'mission ended; ' + ctx.missions.list().map((m) => m.id + ':' + m.state).join(' ') + '; $' + ctx.player.money);
      return log;
    },
    /**
     * Test gunfight: aims at the nearest living gang member and fires, like a player holding aim and tapping
     * fire, until they are all down, the player is, or time runs out. No cheating: weapons, ammo and
     * health are whatever the game gave.
     */
    async fight(seconds = 30) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const player = ctx.player;
      const before = player.health + player.armour;
      const hostiles = () =>
        [...ctx.actors.all]
          .filter((a) => a.kind === 'gang' && a.alive)
          .sort((a, b) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position));
      const total = hostiles().length;
      const start = performance.now();
      let shots = 0;
      key('keydown', 'KeyK');
      while (performance.now() - start < seconds * 1000 && player.alive) {
        const target = hostiles()[0];
        if (!target) break;
        const dx = target.position.x - player.position.x;
        const dz = target.position.z - player.position.z;
        const d = Math.hypot(dx, dz);
        // Level aim is a camera pitch of 0.16; chest height on both sides, so only the slope matters.
        const elevation = Math.atan2(target.position.y - player.position.y, Math.max(1, d));
        dev.look(Math.atan2(dx, dz), 0.16 - elevation, 1);
        await wait(90);
        key('keydown', 'KeyJ');
        await wait(110);
        key('keyup', 'KeyJ');
        shots++;
        await wait(200);
      }
      key('keyup', 'KeyK');
      return {
        seconds: +((performance.now() - start) / 1000).toFixed(1),
        alive: player.alive,
        damageTaken: Math.round(before - (player.health + player.armour)),
        health: Math.round(player.health),
        armour: Math.round(player.armour),
        killed: total - hostiles().length,
        of: total,
        triggerPulls: shots,
        weapon: ctx.combat.current.id,
      };
    },
    /** Summary of the mission / objective state for test scripts. */
    mission() {
      const active = ctx.missions.active;
      return {
        active: active ? active.id : null,
        list: ctx.missions.list().map((m) => `${m.id}:${m.state}`),
        money: ctx.player.money,
        health: Math.round(ctx.player.health),
        heat: ctx.police.level,
        vehicle: ctx.player.vehicle ? ctx.player.vehicle.spec.id : null,
        objective: document.querySelector('[class*="objective"]')?.textContent ?? null,
      };
    },
    /** Milliseconds per frame by system. */
    profile() {
      return Object.fromEntries(Object.entries(game.profile).map(([k, v]) => [k, +v.toFixed(2)]));
    },
    stats() {
      return {
        fps: Math.round(ctx.gfx.fps),
        ms: +ctx.gfx.frameMs.toFixed(1),
        calls: ctx.gfx.stats.drawCalls,
        tris: ctx.gfx.stats.triangles,
        scale: ctx.gfx.stats.renderScale,
        vehicles: ctx.vehicles.all.length,
        peds: ctx.peds.count,
        actors: ctx.actors.all.size,
        heat: ctx.police.level,
        pos: [Math.round(ctx.player.position.x), Math.round(ctx.player.position.z)],
        where: ctx.world.locationName(ctx.player.position.x, ctx.player.position.z),
      };
    },
  };
  (window as unknown as { dev: typeof dev }).dev = dev;
}
