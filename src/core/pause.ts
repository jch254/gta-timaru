import type { GameClock, GameContext } from './types';

type Owner = 'portrait' | 'menu' | 'external';
const holds = new WeakMap<GameClock, Set<Owner>>();

/** Menus and rotation may overlap. Only the last release restarts simulation and audio. */
export function setPauseHold({ clock, events }: GameContext, owner: Owner, held: boolean) {
  let owners = holds.get(clock);
  if (!owners) {
    if (!held && !clock.paused) return;
    owners = new Set(clock.paused ? ['external'] : []);
    holds.set(clock, owners);
  }
  if (held) owners.add(owner);
  else owners.delete(owner);
  const paused = owners.size > 0;
  if (!paused) holds.delete(clock);
  if (paused !== clock.paused) {
    clock.paused = paused;
    events.emit('pausedChanged', { paused });
  }
}
