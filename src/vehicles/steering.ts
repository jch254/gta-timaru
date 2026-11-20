import type { VehicleSpec } from '../core/types';

/** Peak friction for a grip-1 vehicle on dry seal. */
export const DRY_ROAD_MU = 1.12;

/** Full parking lock, tapering at speed to slightly beyond the tyres' lateral grip limit. */
export function steeringLimit(spec: Pick<VehicleSpec, 'wheelbase' | 'steerLock'>, speed: number, mu: number): number {
  return Math.min(spec.steerLock, Math.atan((spec.wheelbase * 1.22 * mu * 9.81) / Math.max(1, speed * speed)));
}
