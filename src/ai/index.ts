import type { GameContext, PedsApi, System, TrafficApi } from '../core/types';
import { PedsSystem } from './peds';
import { TrafficSystem } from './traffic';

/**
 * Pedestrians and traffic.
 *
 *  tuning.ts     every tunable constant (DRIVE, PURSUIT, JUNCTION, TRAFFIC, PEDS)
 *  lanes.ts      allocation-free lane / edge geometry            (pure)
 *  steer.ts      pure-pursuit steering, speed planning, corridor (pure)
 *  junction.ts   per-node give-way reservations                  (pure)
 *  route.ts      route-following state, wander exit choice       (pure)
 *  spawn.ts      spawn-ring selection, time-of-day curves        (pure)
 *  walk.ts       footpath navigation for pedestrians             (pure)
 *  looks.ts      clothes, names, barks                           (pure)
 *  autopilot.ts  Autopilot implementation
 *  traffic.ts    ambient traffic system (TrafficApi)
 *  ped.ts        one pedestrian (PedHandle)
 *  peds.ts       pedestrian system (PedsApi)
 */
export function createPeds(ctx: GameContext): PedsApi & System {
  return new PedsSystem(ctx);
}

export function createTraffic(ctx: GameContext): TrafficApi & System {
  return new TrafficSystem(ctx);
}
