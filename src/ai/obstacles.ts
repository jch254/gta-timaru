import type { Vehicle } from '../core/types';

/**
 * Things on the road that move by themselves but are not vehicles in the game's sense (the tram). Autopilots
 * treat them as traffic: something to queue behind, or to pass when patience runs out. Only the fields the
 * autopilot reads have to be real.
 */
export type RoadObstacle = Pick<Vehicle, 'position' | 'velocity' | 'heading' | 'destroyed' | 'burning' | 'controller'> & {
  spec: Pick<Vehicle['spec'], 'width' | 'length'>;
  /** Non-null: somebody is "driving" it, so cars wait behind it before deciding to go round. */
  driver: object | null;
};

export const EXTRA_OBSTACLES: Vehicle[] = [];

export function addRoadObstacle(obstacle: RoadObstacle): () => void {
  const entry = obstacle as unknown as Vehicle;
  EXTRA_OBSTACLES.push(entry);
  return () => {
    const i = EXTRA_OBSTACLES.indexOf(entry);
    if (i >= 0) EXTRA_OBSTACLES.splice(i, 1);
  };
}
