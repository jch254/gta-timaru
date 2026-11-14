import * as THREE from 'three';
import type { GameContext } from '../core/types';

const _cam = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pt = new THREE.Vector3();

/** Beyond this a car is a speck; treat it as unseen. */
const VIEW_FAR = 380;
/** Cosine of the half-angle of the cone treated as "on screen" (generous: covers a wide window). */
const VIEW_COS = 0.55;

/** Could the player be watching this spot? Used to spawn and remove things where nobody is looking. */
export class View {
  constructor(private ctx: GameContext) {}

  /** Inside the camera's view cone, near enough to matter and not hidden behind the world. One ray cast at most. */
  visible(x: number, y: number, z: number): boolean {
    const { camera, env, physics } = this.ctx;
    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_fwd);
    const dx = x - _cam.x;
    const dy = y - _cam.y;
    const dz = z - _cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 2) return true;
    const far = env.visibility > 0 && env.visibility < VIEW_FAR ? env.visibility : VIEW_FAR;
    if (d > far) return false;
    if ((dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d < VIEW_COS) return false;
    return physics.lineOfSight(_cam, _pt.set(x, y, z));
  }

  /** Safe to make something at `position` disappear: far enough from the player and not in view. */
  canVanish(position: THREE.Vector3, minDistance = 60): boolean {
    const p = this.ctx.player.position;
    if (Math.hypot(position.x - p.x, position.z - p.z) < minDistance) return false;
    return !this.visible(position.x, position.y + 1, position.z);
  }
}
