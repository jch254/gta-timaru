import * as THREE from 'three';
import type { Actor, GameContext, QualityLevel, System } from '../core/types';
import { crowdDebug, crowdStats, updateCrowd } from './gltf/crowd';
import { detailDebug } from './gltf/detail';
import { presetFor } from '../render/quality';

/** People further away than this stop casting shadows: at that size the shadow is a smudge, and every skinned
 *  figure is otherwise redrawn into each shadow cascade. */
const SHADOW_RANGE = 40;
const INTERVAL = 0.3;
/** How far out each quality setting keeps the fuller versions of a figure (multiplies the switch distances). */
const DETAIL: Record<QualityLevel, number> = { low: 0.6, medium: 0.8, high: 1, ultra: 1.4 };

/**
 * Figure level of detail shared by everyone on foot, whichever system owns them. Rigged figures are handled
 * by the crowd manager (levels of detail, shadow stand-ins, animation only where it can be seen); anything
 * else an actor is drawn with (the code-built fallback figure, things it carries) just stops casting shadows
 * at a distance.
 */
export function createFigureLod(ctx: GameContext): System {
  const meshes = new WeakMap<Actor, THREE.Mesh[]>();
  let clock = 0;
  let pass = 0;
  const collect = (actor: Actor): THREE.Mesh[] => {
    const list: THREE.Mesh[] = [];
    actor.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.castShadow && !o.userData.figure) list.push(o as THREE.Mesh);
    });
    return list;
  };
  // For the developer console: `dev.ctx` has no handle on this system, so the numbers hang off the scene.
  ctx.scene.userData.crowd = crowdStats;
  ctx.scene.userData.crowdDebug = crowdDebug;
  ctx.scene.userData.detailDebug = detailDebug;
  return {
    name: 'figures',
    update(dt: number) {
      clock -= dt;
      if (clock > 0) return;
      clock = INTERVAL;
      // Look again for things to switch off every couple of seconds (a weapon drawn since, say).
      const again = ++pass % 8 === 0;
      const eye = ctx.camera.position;
      for (const actor of ctx.actors.all) {
        if (actor === ctx.player) continue;
        let list = meshes.get(actor);
        if (!list || (again && list.length === 0)) meshes.set(actor, (list = collect(actor)));
        const near = actor.position.distanceToSquared(eye) < SHADOW_RANGE * SHADOW_RANGE;
        for (const mesh of list) mesh.castShadow = near;
      }
    },
    // After the camera has moved for this frame, so nothing is a frame late when the view swings round.
    lateUpdate() {
      // A phone brings the switches in further still (`detailRange`), and its one short shadow map ends sooner.
      const preset = presetFor(ctx.gfx.quality);
      updateCrowd(ctx.camera as THREE.PerspectiveCamera, { detail: (DETAIL[ctx.gfx.quality] ?? 1) * preset.detailRange, shadowRange: Math.min(SHADOW_RANGE, preset.shadowFar * 0.6) });
    },
  };
}
