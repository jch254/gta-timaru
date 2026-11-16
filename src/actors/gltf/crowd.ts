import * as THREE from 'three';
import { figures } from './rig';

/**
 * Level of detail for every rigged figure, decided once a frame from the camera:
 *
 *   level 0  full model                 closer than about 8 m
 *   level 1  a quarter of the triangles to about 20 m
 *   level 2  a tenth                    to about 50 m
 *   level 3  a few hundred, one draw    beyond
 *
 * The distances stretch and shrink with the quality setting and with the lens (a figure fills more of a
 * narrow view). Shadows come from a level-2 stand-in and stop at `shadowRange`. Figures outside the view
 * and not close by are left un-animated until they come back into it.
 */

export interface CrowdOptions {
  /** Multiplier on the switch distances (1 = High quality). */
  detail: number;
  /** Figures further than this cast no shadow (metres). */
  shadowRange: number;
}

/** Distance at which each level gives way to the next, and how far back inside it the figure must come to switch back. */
const SWITCH = [8, 20, 50];
const HYSTERESIS = 0.88;
/** Figures this close are animated whether or not they are in view: their shadows may be, and the camera turns fast. */
const ALWAYS_AWAKE = 12;
/** Vertical field of view the switch distances were chosen at (degrees). */
const REFERENCE_FOV = 58;

const frustum = new THREE.Frustum();
const matrix = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1.7);
const eye = new THREE.Vector3();
const at = new THREE.Vector3();
const levels = new WeakMap<object, number>();

export interface CrowdStats {
  figures: number;
  byLevel: [number, number, number, number];
  asleep: number;
  shadows: number;
}
export const crowdStats: CrowdStats = { figures: 0, byLevel: [0, 0, 0, 0], asleep: 0, shadows: 0 };
/** Development aid: a level from 0 to 3 here is drawn for every figure regardless of distance (−1 = off). */
export const crowdDebug = {
  force: -1,
  /** Draw every figure the way it was before there were levels: full detail, casting its own shadow, always animated. */
  legacy: false,
};

export function updateCrowd(camera: THREE.PerspectiveCamera, options: CrowdOptions) {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  eye.setFromMatrixPosition(camera.matrixWorld);
  const lens = Math.tan(THREE.MathUtils.degToRad(REFERENCE_FOV / 2)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const scale = options.detail * lens;
  const stats = crowdStats;
  stats.figures = stats.asleep = stats.shadows = 0;
  stats.byLevel[0] = stats.byLevel[1] = stats.byLevel[2] = stats.byLevel[3] = 0;
  for (const figure of figures) {
    if (!figure.attached) continue;
    figure.group.getWorldPosition(at);
    const distance = at.distanceTo(eye);
    let level = levels.get(figure) ?? 0;
    // Step towards the right level, with a margin so a figure hovering at a boundary does not flicker.
    while (level < 3 && distance > SWITCH[level] * scale) level++;
    while (level > 0 && distance < SWITCH[level - 1] * scale * HYSTERESIS) level--;
    levels.set(figure, level);
    if (crowdDebug.force >= 0) level = crowdDebug.force;
    sphere.center.set(at.x, at.y + 0.9, at.z);
    const awake = distance < ALWAYS_AWAKE || frustum.intersectsSphere(sphere);
    const shadow = distance < options.shadowRange;
    if (crowdDebug.legacy) figure.setDetail(0, shadow, true, true);
    else figure.setDetail(level, shadow, awake);
    stats.figures++;
    stats.byLevel[level]++;
    if (!awake) stats.asleep++;
    if (shadow) stats.shadows++;
  }
}
