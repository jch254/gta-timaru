import * as THREE from 'three';
import type { Actor, GameContext, System } from '../core/types';

/** People further away than this stop casting shadows: at that size the shadow is a smudge, and every skinned
 *  figure is otherwise redrawn into each shadow cascade. */
const SHADOW_RANGE = 40;
const INTERVAL = 0.3;

/** Figure level of detail shared by everyone on foot, whichever system owns them. */
export function createFigureLod(ctx: GameContext): System {
  const meshes = new WeakMap<Actor, THREE.Mesh[]>();
  let clock = 0;
  const collect = (actor: Actor): THREE.Mesh[] => {
    const list: THREE.Mesh[] = [];
    actor.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.castShadow) list.push(o as THREE.Mesh);
    });
    return list;
  };
  return {
    name: 'figures',
    update(dt: number) {
      clock -= dt;
      if (clock > 0) return;
      clock = INTERVAL;
      const eye = ctx.camera.position;
      for (const actor of ctx.actors.all) {
        if (actor === ctx.player) continue;
        let list = meshes.get(actor);
        // (Collected once, the first time the figure is seen with its shadow-casting parts in place.)
        if (!list || list.length === 0) meshes.set(actor, (list = collect(actor)));
        const near = actor.position.distanceToSquared(eye) < SHADOW_RANGE * SHADOW_RANGE;
        for (const mesh of list) mesh.castShadow = near;
      }
    },
  };
}
