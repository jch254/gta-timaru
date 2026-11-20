import type { Snapshot } from '../core/saveFormat';
import type { World } from '../world/world';

export async function loadInitialRegion(world: Pick<World, 'places' | 'placesTagged' | 'loadAround'>,
  snapshot: Snapshot | undefined, spawnAt: string | undefined, progress: (fraction: number) => void) {
  const spawn = snapshot?.player ?? world.places.find(p => p.id === spawnAt) ?? world.placesTagged('spawn')[0] ?? { x: 0, z: 0 };
  await world.loadAround(spawn.x, spawn.z, progress);
  return { x: spawn.x, z: spawn.z, heading: typeof spawn.heading === 'number' ? spawn.heading : 0 };
}
