/**
 * What each step kind does. A handler gets the run (for the shared machinery), the step's data and the
 * reusable scratch record; `tick` returns true when the step is finished. Blips, markers, the step timer
 * and the pre-load focus are released by the run when a step ends, so handlers rarely need an `exit`.
 */
import * as THREE from 'three';
import type { Vehicle } from '../core/types';
import type { Entity, MissionRun, StepScratch } from './runner';
import { copyResolved, isMovingSpot, newResolved, walkRoad, type Resolved, type Route } from './spots';
import { TUNING } from './tuning';
import { warnOnce } from './warn';
import type {
  ChaseStep,
  CheckpointStep,
  CustomStep,
  DeliverVehicleStep,
  DespawnStep,
  EliminateStep,
  EnterVehicleStep,
  GiveWeaponStep,
  GoToStep,
  LoseHeatStep,
  RaceStep,
  SayStep,
  SetBehaviourStep,
  SetTimeStep,
  SetWantedStep,
  SetWeatherStep,
  SpawnPedsStep,
  SpawnPickupStep,
  SpawnVehicleStep,
  StartTimerStep,
  Step,
  StopTimerStep,
  SurviveStep,
  WaitStep,
} from './types';

export interface StepHandler<S extends Step> {
  enter?(run: MissionRun, step: S, s: StepScratch): void;
  tick(run: MissionRun, step: S, s: StepScratch, dt: number): boolean;
  exit?(run: MissionRun, step: S, s: StepScratch): void;
}

const _door = new THREE.Vector3();
const _slot = newResolved();
const FELL_THROUGH = 'The job fell through';
/** A target this far below the terrain has left the map. */
const LOST_DEPTH = 30;

const unusable = (e: Entity | null): boolean => !e || e.state === 'missing' || e.state === 'gone';

function matches(value: string, want: string | readonly string[] | undefined): boolean {
  if (want === undefined) return false;
  return typeof want === 'string' ? want === value : want.indexOf(value) >= 0;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

// ───────────────────────────── Getting about ─────────────────────────────

const goTo: StepHandler<GoToStep> = {
  enter(_run, step, s) {
    s.a = step.radius ?? TUNING.goToRadius;
    s.flag = isMovingSpot(step.to);
  },
  tick(run, step, s) {
    const { ctx } = run;
    if (s.flag || s.phase === 0) {
      run.resolve(step.to, s.target);
      if (!s.target.ok) {
        if (!s.flag) {
          run.fail(FELL_THROUGH);
          return false;
        }
        // Following something: wait for it to turn up, carry on if it never will.
        return unusable(run.entity((step.to as { entity: string }).entity));
      }
    }
    const t = s.target;
    if (s.phase === 0) {
      s.phase = 1;
      if (step.marker !== false) {
        s.marker = run.acquireMarker(step.mode === 'foot' || s.a < 5 ? 'goal' : 'checkpoint');
        run.placeMarker(s.marker, t.x, t.z, s.a);
      }
      if (step.blip !== false) run.setBlip('goal', 'objective', t.x, t.z, run.followOf(step.to));
    } else if (s.flag) {
      if (s.marker) run.placeMarker(s.marker, t.x, t.z, s.a);
      // What we are following has just come into being: let the blip ride on it.
      if (s.phase === 1 && step.blip !== false) {
        const follow = run.followOf(step.to);
        if (follow) {
          s.phase = 2;
          run.setBlip('goal', 'objective', t.x, t.z, follow);
        }
      }
    }
    run.preload(t.x, t.z);
    const p = ctx.player.position;
    if (Math.hypot(p.x - t.x, p.z - t.z) > s.a) return false;
    const v = ctx.player.vehicle;
    if (step.mode === 'foot' && v) return false;
    if (step.mode === 'vehicle') {
      if (!v) return false;
      if (step.vehicle !== undefined) {
        const wanted = run.vehicle(step.vehicle);
        if (wanted && wanted !== v) return false;
      }
    }
    if (step.stop && v && Math.abs(v.speed) > TUNING.stopSpeed) return false;
    return true;
  },
};

const enterVehicle: StepHandler<EnterVehicleStep> = {
  tick(run, step, s, dt) {
    const { ctx } = run;
    const mine = ctx.player.vehicle;
    if (step.vehicle !== undefined) {
      const e = run.entity(step.vehicle);
      if (!e || unusable(e)) {
        run.fail(FELL_THROUGH);
        return false;
      }
      if (e.state === 'pending') {
        if (s.phase !== 1 && e.resolved) {
          s.phase = 1;
          run.setBlip('vehicle', 'vehicle', e.at.x, e.at.z);
        }
        if (e.resolved) run.preload(e.at.x, e.at.z);
        return false;
      }
      const v = e.vehicle!;
      if (v.destroyed) {
        run.fail(`The ${v.spec.name} is a write-off`);
        return false;
      }
      if (s.phase !== 2) {
        s.phase = 2;
        run.setBlip('vehicle', 'vehicle', v.position.x, v.position.z, v);
      }
      return mine === v;
    }
    if (mine && (matches(mine.spec.id, step.spec) || matches(mine.spec.cls, step.cls))) return true;
    // Point at the nearest suitable vehicle now and then.
    s.t -= dt;
    if (s.t <= 0) {
      s.t = 1;
      const p = ctx.player.position;
      let best: Vehicle | null = null;
      let bestD = 400;
      const all = ctx.vehicles.all;
      for (let i = 0; i < all.length; i++) {
        const v = all[i];
        if (v.destroyed || !(matches(v.spec.id, step.spec) || matches(v.spec.cls, step.cls))) continue;
        const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (best !== s.data) {
        s.data = best;
        if (best) run.setBlip('vehicle', 'vehicle', best.position.x, best.position.z, best);
        else run.removeBlip('vehicle');
      }
    }
    return false;
  },
};

const deliverVehicle: StepHandler<DeliverVehicleStep> = {
  enter(run, step, s) {
    run.resolve(step.to, s.target);
    s.a = step.radius ?? TUNING.deliverRadius;
    s.n = -1; // which objective is showing
    s.b = -1; // condition readout
  },
  tick(run, step, s) {
    const { ctx } = run;
    const e = run.entity(step.vehicle);
    if (!e || unusable(e) || !s.target.ok) {
      run.fail(FELL_THROUGH);
      return false;
    }
    if (e.state === 'pending') {
      if (e.resolved && s.n !== 3) {
        s.n = 3;
        run.setBlip('goal', 'vehicle', e.at.x, e.at.z);
      }
      return false;
    }
    const v = e.vehicle!;
    const t = s.target;

    // Handing over: wait for black, step the player out, take the vehicle away.
    if (s.phase === 1) {
      if (!run.faded) return false;
      v.doorPosition(_door, 0);
      ctx.player.teleport(_door.x, _door.z, v.heading);
      run.despawn(e);
      run.fadeIn();
      run.freezePlayer(false);
      return true;
    }

    if (v.destroyed || v.health <= 0) {
      run.fail(step.damageReason ?? `The ${v.spec.name} is a write-off`);
      return false;
    }
    if (step.minHealth !== undefined) {
      const fraction = v.health / v.spec.health;
      if (fraction < step.minHealth) {
        run.fail(step.damageReason ?? `The ${v.spec.name} is too far gone`);
        return false;
      }
      const percent = Math.min(100, Math.ceil(fraction * 20) * 5);
      if (percent !== s.b) {
        s.b = percent;
        run.setCounter(`Condition ${percent}%`);
      }
    }

    run.preload(t.x, t.z);
    const driving = ctx.player.vehicle === v;
    const there = driving && Math.hypot(v.position.x - t.x, v.position.z - t.z) <= s.a;
    const hot = step.clean === true && ctx.police.level > 0;
    const mode = !driving ? 0 : there && hot ? 2 : 1;
    if (mode !== s.n) {
      s.n = mode;
      if (mode === 0) {
        run.objective(step.returnObjective ?? `Get back in the ${v.spec.name}`);
        run.setBlip('goal', 'vehicle', v.position.x, v.position.z, v);
        if (s.marker) s.marker.group.visible = false;
      } else {
        run.objective(mode === 2 ? (step.cleanObjective ?? 'Lose the cops first') : (step.objective ?? null));
        run.setBlip('goal', 'objective', t.x, t.z);
        if (!s.marker) s.marker = run.acquireMarker('checkpoint');
        run.placeMarker(s.marker, t.x, t.z, s.a);
      }
    }
    if (!there || hot || Math.abs(v.speed) > TUNING.stopSpeed) return false;
    if (!step.handover) return true;
    s.phase = 1;
    run.freezePlayer(true);
    run.fadeOut();
    return false;
  },
};

// ───────────────────────────── Set dressing ─────────────────────────────

const spawnVehicle: StepHandler<SpawnVehicleStep> = {
  enter(run, step) {
    run.addVehicle(step);
  },
  tick(run, step) {
    return !step.wait || run.entity(step.as)?.state !== 'pending';
  },
};

const spawnPeds: StepHandler<SpawnPedsStep> = {
  enter(run, step) {
    const activate = step.activate ?? TUNING.pedActivate;
    for (const ped of step.peds) run.addPed(ped, activate);
  },
  tick(run, step) {
    if (!step.wait) return true;
    for (let i = 0; i < step.peds.length; i++) if (run.entity(step.peds[i].as)?.state === 'pending') return false;
    return true;
  },
};

const spawnPickup: StepHandler<SpawnPickupStep> = {
  enter(run, step) {
    run.addPickup(step, step.as ?? `pickup${run.stepIndex}`);
  },
  tick: () => true,
};

const despawn: StepHandler<DespawnStep> = {
  enter(run, step) {
    for (const name of step.handles) {
      const e = run.entity(name);
      if (e) run.despawn(e);
    }
  },
  tick: () => true,
};

// ───────────────────────────── Trouble ─────────────────────────────

const eliminate: StepHandler<EliminateStep> = {
  enter(_run, _step, s) {
    s.n = -1;
  },
  tick(run, step, s) {
    const blips = step.blips !== false;
    let remaining = 0;
    for (let i = 0; i < step.targets.length; i++) {
      const name = step.targets[i];
      const e = run.entity(name);
      if (!e || unusable(e)) continue;
      if (e.state === 'pending') {
        remaining++;
        if (blips && e.blip === 0 && e.resolved) {
          e.blip = 1;
          run.setBlip(name, 'enemy', e.at.x, e.at.z);
        }
        continue;
      }
      const o = e.ped ?? e.vehicle;
      let alive = e.ped ? e.ped.alive : e.vehicle ? !e.vehicle.destroyed : false;
      // Fallen out of the world (physics hiccup, a chunk that unloaded under them): nobody can finish them
      // off down there, so they do not hold the mission up.
      if (alive && o && o.position.y < run.ctx.world.heightAt(o.position.x, o.position.z) - LOST_DEPTH) {
        run.despawn(e);
        continue;
      }
      alive = alive && e.state === 'live';
      if (alive && o) {
        remaining++;
        if (blips && e.blip !== 2) {
          e.blip = 2;
          run.setBlip(name, 'enemy', o.position.x, o.position.z, o);
        }
      } else if (e.blip !== 0) {
        e.blip = 0;
        run.removeBlip(name);
      }
    }
    if (remaining !== s.n) {
      s.n = remaining;
      if (step.objective) run.objective(step.objective.replace('{n}', String(remaining)));
    }
    return remaining === 0;
  },
};

const loseHeat: StepHandler<LoseHeatStep> = {
  enter(run, step, s) {
    s.flag = !!step.atLeast && !!step.holdFor;
    if (step.atLeast) run.raiseWanted(step.atLeast, s.flag);
    s.n = -1;
  },
  tick(run, step, s, dt) {
    const { ctx } = run;
    s.t += dt;
    if (s.flag && s.t >= step.holdFor!) {
      // The pursuit has had its run: from here the player can shake it.
      s.flag = false;
      run.releaseWanted();
    }
    if (step.vehicle !== undefined) {
      const v = run.vehicle(step.vehicle);
      if (v) {
        if (v.destroyed) {
          run.fail(`The ${v.spec.name} is a write-off`);
          return false;
        }
        const mode = ctx.player.vehicle === v ? 1 : 0;
        if (mode !== s.n) {
          s.n = mode;
          if (mode === 0) {
            run.objective(step.returnObjective ?? `Get back in the ${v.spec.name}`);
            run.setBlip('goal', 'vehicle', v.position.x, v.position.z, v);
          } else {
            run.objective(step.objective ?? null);
            run.removeBlip('goal');
          }
        }
        if (mode === 0) return false;
      }
    }
    // A beat of grace so heat raised this frame has registered.
    return !s.flag && s.t > 0.5 && ctx.police.level === 0;
  },
};

const setWanted: StepHandler<SetWantedStep> = {
  enter(run, step) {
    run.raiseWanted(step.level, false);
  },
  tick: () => true,
};

// ───────────────────────────── Time ─────────────────────────────

const wait: StepHandler<WaitStep> = {
  tick: (run, step) => run.stepTime >= step.seconds,
};

const survive: StepHandler<SurviveStep> = {
  enter(run, step) {
    run.startStepTimer(step.seconds, step.label ?? 'Hold out', null);
  },
  tick: (run) => run.stepTimer <= 0,
};

const startTimer: StepHandler<StartTimerStep> = {
  enter(run, step) {
    run.startMissionTimer(step.time);
  },
  tick: () => true,
};

const stopTimer: StepHandler<StopTimerStep> = {
  enter(run) {
    run.stopMissionTimer();
  },
  tick: () => true,
};

const say: StepHandler<SayStep> = {
  // The lines themselves are queued by the run (every step may carry `lines`).
  enter(run, _step, s) {
    s.a = run.ctx.player.position.x;
    s.b = run.ctx.player.position.z;
  },
  tick(run, step, s) {
    if (!step.block || !run.dialogueBusy) return true;
    // Walked off mid-briefing: the talk carries on in their ear, the job gets under way.
    const p = run.ctx.player.position;
    return Math.hypot(p.x - s.a, p.z - s.b) > TUNING.briefingLeash;
  },
};

const setBehaviour: StepHandler<SetBehaviourStep> = {
  enter(run, step) {
    for (const name of step.peds) {
      const e = run.entity(name);
      if (e) run.setBehaviour(e, step.behaviour);
    }
  },
  tick: () => true,
};

const setWeather: StepHandler<SetWeatherStep> = {
  enter(run, step) {
    run.ctx.env.setWeather(step.weather, step.transition);
  },
  tick: () => true,
};

function jumpClock(run: MissionRun, hour: number) {
  const clock = run.ctx.clock;
  clock.advanceHours((((hour - clock.hour) % 24) + 24) % 24);
}

const setTime: StepHandler<SetTimeStep> = {
  enter(run, step, s) {
    const h = run.ctx.clock.hour;
    const w = step.unlessBetween;
    if (w && (w[0] <= w[1] ? h >= w[0] && h <= w[1] : h >= w[0] || h <= w[1])) {
      s.phase = 2;
    } else if (step.fade) {
      s.phase = 1;
      run.freezePlayer(true);
      run.fadeOut(0.7);
    } else {
      jumpClock(run, step.hour);
      s.phase = 2;
    }
  },
  tick(run, step, s) {
    if (s.phase === 1) {
      if (!run.faded) return false;
      jumpClock(run, step.hour);
      run.fadeIn(0.7);
      run.freezePlayer(false);
      s.phase = 2;
    }
    return true;
  },
};

const giveWeapon: StepHandler<GiveWeaponStep> = {
  enter(run, step) {
    const { combat, player } = run.ctx;
    if (combat.weapons.has(step.weapon)) {
      combat.give(step.weapon, step.ammo);
      if (step.select) combat.select(step.weapon);
    } else {
      warnOnce(`missions: weapon "${step.weapon}" is not available yet`);
    }
    if (step.armour) player.addArmour(step.armour);
  },
  tick: () => true,
};

const custom: StepHandler<CustomStep> = {
  enter(run, step) {
    step.enter?.(run);
  },
  tick: (run, step, _s, dt) => (step.tick ? step.tick(run, dt) === true : true),
  exit(run, step) {
    step.exit?.(run);
  },
};

/** Instant: notes that the run got this far, so a failure later offers a retry from here. */
const checkpoint: StepHandler<CheckpointStep> = {
  enter(run, step) {
    run.reached = { index: run.stepIndex, label: step.label, at: step.at };
  },
  tick: () => true,
};

// ───────────────────────────── Racing ─────────────────────────────

interface RaceData {
  cps: Resolved[];
  total: number;
  /** Player's next checkpoint (counts through every lap). */
  next: number;
  rivals: Entity[];
  names: string[];
  rivalNext: number[];
  recover: number[];
  routed: boolean;
  go: boolean;
  countdown: number;
  shown: number;
  place: number;
  placeTimer: number;
  radius: number;
  /** Course length in metres (straight lines between checkpoints, every lap). */
  length: number;
}

/** Is there a vehicle (or the player) on this grid slot? Alongside is fine, nose-to-tail is not. */
function slotTaken(run: MissionRun, slot: Resolved): boolean {
  const sin = Math.sin(slot.heading);
  const cos = Math.cos(slot.heading);
  const hit = (x: number, z: number) => {
    const ahead = (x - slot.x) * sin + (z - slot.z) * cos;
    const beside = (x - slot.x) * cos - (z - slot.z) * sin;
    return Math.abs(ahead) < 6.5 && Math.abs(beside) < 2.4;
  };
  const p = run.ctx.player.position;
  if (hit(p.x, p.z)) return true;
  const all = run.ctx.vehicles.all;
  for (let i = 0; i < all.length; i++) if (hit(all[i].position.x, all[i].position.z)) return true;
  return false;
}

/**
 * Where rival `i` lines up: alongside the pole spot, then in rows behind it. A slot with something already
 * on it (the player, wherever in the box they stopped; traffic; an earlier rival) moves back a row.
 */
function gridSlot(run: MissionRun, grid: Resolved, i: number, out: Resolved): Resolved {
  const graph = run.ctx.world.graph;
  copyResolved(grid, out);
  const twoLanes = grid.edge !== null && grid.edge.lanes >= 2;
  const lane = twoLanes ? (i % 2 === 0 ? 1 : 0) : 0;
  let row = twoLanes ? Math.floor((i + 1) / 2) : i + 1;
  for (let attempt = 0; attempt < 6; attempt++, row++) {
    if (grid.edge) {
      // Back along the road from the pole spot (round the corner onto the previous road if the block is short).
      walkRoad(graph, grid.edge, grid.s, -grid.dir as 1 | -1, row * TUNING.gridRow, out);
      const edge = out.edge ?? grid.edge;
      const facing = -out.dir as 1 | -1;
      const lp = graph.lanePoint(edge, out.s, facing, edge.lanes >= 2 ? lane : 0);
      out.x = lp.x;
      out.z = lp.z;
      out.heading = lp.heading;
      out.dir = facing;
    } else {
      // No road under the grid: line up relative to its heading (lane 1 is to the right of lane 0).
      const sin = Math.sin(grid.heading);
      const cos = Math.cos(grid.heading);
      const back = row * TUNING.gridRow;
      const right = (i % 2 === 0 ? 1 : 0) * 3.6;
      out.x = grid.x - sin * back - cos * right;
      out.z = grid.z - cos * back + sin * right;
    }
    if (!slotTaken(run, out)) break;
  }
  return out;
}

function showCheckpoint(run: MissionRun, d: RaceData, s: StepScratch) {
  const cp = d.cps[d.next % d.cps.length];
  if (!s.marker) s.marker = run.acquireMarker('checkpoint');
  run.placeMarker(s.marker, cp.x, cp.z, d.radius);
  run.setBlip('goal', 'objective', cp.x, cp.z);
}

function raceObjective(run: MissionRun, step: RaceStep, d: RaceData) {
  const base = step.objective ?? 'Win the race';
  const field = d.rivals.length + 1;
  const position = field > 1 ? `  ·  ${ORDINALS[d.place - 1] ?? `${d.place}th`} of ${field}` : '';
  run.objective(`${base}  ·  checkpoint ${Math.min(d.next + 1, d.total)}/${d.total}${position}`);
}

const race: StepHandler<RaceStep> = {
  enter(run, step, s) {
    const { ctx } = run;
    const graph = ctx.world.graph;
    const cps: Resolved[] = [];
    for (const spot of step.checkpoints) {
      const r = run.resolve(spot, newResolved());
      if (r.ok) cps.push(r);
    }
    const d: RaceData = {
      cps,
      total: cps.length * Math.max(1, step.laps ?? 1),
      next: 0,
      rivals: [],
      names: [],
      rivalNext: [],
      recover: [],
      routed: false,
      go: false,
      countdown: step.countdown ?? 3,
      shown: -1,
      place: 1,
      placeTimer: 0,
      radius: step.radius ?? TUNING.checkpointRadius,
      length: 0,
    };
    s.data = d;
    if (!cps.length) return;
    const grid = run.resolve(step.grid, s.target);
    if (!grid.ok) {
      // Nowhere to line up: start from wherever the player is.
      grid.ok = true;
      grid.x = ctx.player.position.x;
      grid.z = ctx.player.position.z;
      grid.heading = ctx.player.heading;
    }
    let fromX = grid.x;
    let fromZ = grid.z;
    for (let i = 0; i < d.total; i++) {
      const cp = cps[i % cps.length];
      d.length += Math.hypot(cp.x - fromX, cp.z - fromZ);
      fromX = cp.x;
      fromZ = cp.z;
    }

    // One route for the whole field: off the grid, through every checkpoint in order, every lap.
    let route: Route | null = null;
    if (grid.edge) {
      try {
        route = [{ edge: grid.edge, dir: grid.dir }];
        let from = graph.endNode(grid.edge, grid.dir);
        for (let i = 0; i < d.total && route; i++) {
          const cp = cps[i % cps.length];
          const to = graph.nearestNode(cp.x, cp.z);
          if (to.index === from.index) continue;
          const leg = graph.route(from.index, to.index);
          if (!leg) route = null;
          else {
            for (const hop of leg) route.push(hop);
            from = to;
          }
        }
      } catch {
        route = null;
      }
    }
    d.routed = route !== null;

    for (let i = 0; i < step.rivals.length; i++) {
      const def = step.rivals[i];
      const slot = gridSlot(run, grid, i, _slot);
      const e = run.addRival(
        { kind: 'spawnVehicle', as: def.as, spec: def.spec, at: { x: slot.x, z: slot.z }, tags: ['racer'], ai: { aggression: def.aggression, cruiseSpeed: def.cruiseSpeed } },
        slot,
      );
      if (e.state !== 'live' || !e.autopilot) continue;
      // On the grid's own block the start position is known; from round the corner the autopilot finds its own way on.
      if (route) e.autopilot.setRoute(route.slice(), slot.edge === grid.edge ? slot.s : undefined);
      else e.autopilot.setTarget(cps[0].x, cps[0].z);
      d.rivals.push(e);
      d.names.push(def.name ?? 'A rival');
      d.rivalNext.push(0);
      d.recover.push(0);
    }
    run.freezePlayer(true);
    showCheckpoint(run, d, s);
    raceObjective(run, step, d);
  },

  tick(run, step, s, dt) {
    const { ctx } = run;
    const d = s.data as RaceData;
    const count = d.cps.length;
    if (!count) return true;

    if (!d.go) {
      d.countdown -= dt;
      const n = Math.ceil(d.countdown);
      if (n !== d.shown) {
        d.shown = n;
        if (n > 0) {
          ctx.ui.banner(String(n), '', 0.9, 'neutral');
          ctx.audio.play('uiMove');
        } else {
          ctx.ui.banner('Go!', '', 1.2, 'good');
          ctx.audio.play('uiSelect');
          d.go = true;
          run.freezePlayer(false);
          for (let i = 0; i < d.rivals.length; i++) run.startAi(d.rivals[i]);
          // Nobody to race (no traffic AI yet): make it a lap against the clock.
          if (!d.rivals.length && step.parSpeed) run.startStepTimer(Math.round(d.length / step.parSpeed) + 8, 'Par', 'Too slow');
        }
      }
      if (!d.go) return false;
    }

    for (let i = 0; i < d.rivals.length; i++) {
      const e = d.rivals[i];
      const v = e.vehicle;
      if (!v || v.destroyed) continue;
      const cp = d.cps[d.rivalNext[i] % count];
      if (Math.hypot(v.position.x - cp.x, v.position.z - cp.z) < d.radius + TUNING.rivalCheckpointSlack) {
        d.rivalNext[i]++;
        if (d.rivalNext[i] >= d.total) {
          run.fail(step.loseReason ?? `${d.names[i]} took the flag`);
          return false;
        }
        if (!d.routed && e.autopilot) {
          const nextCp = d.cps[d.rivalNext[i] % count];
          e.autopilot.setTarget(nextCp.x, nextCp.z);
        }
      }
      const ap = e.autopilot;
      d.recover[i] -= dt;
      if (ap && ap.stuckTime > TUNING.aiStuckSeconds && d.recover[i] <= 0) {
        d.recover[i] = TUNING.aiStuckSeconds;
        v.recover();
      }
    }

    const p = ctx.player.position;
    const cp = d.cps[d.next % count];
    const toCp = Math.hypot(p.x - cp.x, p.z - cp.z);
    let changed = false;
    if (ctx.player.vehicle && toCp < d.radius) {
      d.next++;
      ctx.audio.play('pickup');
      if (d.next >= d.total) {
        for (let i = 0; i < d.rivals.length; i++) run.stopAi(d.rivals[i]);
        return true;
      }
      showCheckpoint(run, d, s);
      changed = true;
    }

    d.placeTimer -= dt;
    if (d.placeTimer <= 0 || changed) {
      d.placeTimer = 0.4;
      const mine = d.cps[d.next % count];
      const mineD = Math.hypot(p.x - mine.x, p.z - mine.z);
      let place = 1;
      for (let i = 0; i < d.rivals.length; i++) {
        const v = d.rivals[i].vehicle;
        if (!v) continue;
        const theirs = d.rivalNext[i];
        if (theirs > d.next) place++;
        else if (theirs === d.next && Math.hypot(v.position.x - mine.x, v.position.z - mine.z) < mineD) place++;
      }
      if (place !== d.place) {
        d.place = place;
        changed = true;
      }
    }
    if (changed) raceObjective(run, step, d);
    return false;
  },

  exit(run, _step, s) {
    const d = s.data as RaceData | null;
    run.freezePlayer(false);
    if (d) for (let i = 0; i < d.rivals.length; i++) run.stopAi(d.rivals[i]);
  },
};

// ───────────────────────────── Chasing ─────────────────────────────

const chase: StepHandler<ChaseStep> = {
  enter(run, step, s) {
    run.resolve(step.to, s.target);
    s.a = step.arriveRadius ?? 60;
  },
  tick(run, step, s, dt) {
    const { ctx } = run;
    const e = run.entity(step.target);
    // No target (no traffic AI, or it never spawned): nothing to chase, carry on with the story.
    if (!e || unusable(e) || !s.target.ok) return true;
    if (e.state === 'pending') {
      if (s.phase === 0 && e.resolved) {
        s.phase = 1;
        run.setBlip('target', 'enemy', e.at.x, e.at.z);
      }
      return false;
    }
    const v = e.vehicle;
    // Wrecked, or the player has taken it off them: either way it is going nowhere.
    if (!v || v.destroyed || ctx.player.vehicle === v) return true;
    const t = s.target;
    if (s.phase < 2) {
      s.phase = 2;
      run.driveTo(e, t.x, t.z, step.cruiseSpeed, step.aggression);
      run.setBlip('target', 'enemy', v.position.x, v.position.z, v);
    }
    const p = ctx.player.position;
    if (Math.hypot(v.position.x - p.x, v.position.z - p.z) > step.maxDistance) {
      s.t += dt;
      if (s.t > (step.grace ?? 4)) {
        run.fail(step.lostReason ?? 'They got away');
        return false;
      }
    } else {
      s.t = 0;
    }
    const ap = e.autopilot;
    s.b -= dt;
    if (ap && ap.stuckTime > TUNING.aiStuckSeconds && s.b <= 0) {
      s.b = TUNING.aiStuckSeconds;
      v.recover();
    }
    const arrived = Math.hypot(v.position.x - t.x, v.position.z - t.z) < s.a || (ap !== null && ap.arrived);
    const beaten = Math.hypot(p.x - t.x, p.z - t.z) < s.a;
    if (!arrived && !beaten) return false;
    run.stopAi(e);
    return true;
  },
};

export const STEP_HANDLERS: { [K in Step['kind']]: StepHandler<Extract<Step, { kind: K }>> } = {
  goTo,
  enterVehicle,
  deliverVehicle,
  spawnVehicle,
  spawnPeds,
  spawnPickup,
  eliminate,
  loseHeat,
  wait,
  survive,
  race,
  chase,
  say,
  setBehaviour,
  setWeather,
  setTime,
  giveWeapon,
  setWanted,
  startTimer,
  stopTimer,
  despawn,
  custom,
  checkpoint,
};
