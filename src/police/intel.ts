import * as THREE from 'three';
import type { RoadHit } from '../core/types';
import { responseFor, type Response } from './response';

/** What the force collectively knows this frame. Written by the police system, read by units and officers. */
export class Intel {
  /** Heat level 0..5. */
  level = 0;
  response: Response = responseFor(0);
  /** Officers may open fire (the level calls for it and the combat system can fire for them). */
  shoot = false;
  /** Some officer has had eyes on the player within the last moment. */
  seen = false;
  /** The law is not acting: suspended by a mission, or the player is dead or already in cuffs. */
  suspended = false;
  /** Where the player was last seen or reported. */
  readonly lastKnown = new THREE.Vector3();
  /** Where units head: the player while seen, otherwise `lastKnown`. */
  readonly target = new THREE.Vector3();
  /** What officers shoot at. */
  readonly aimPoint = new THREE.Vector3();
  /** Where an officer stands to make the arrest (the driver's door when the player sits in a stopped car). */
  readonly arrestPoint = new THREE.Vector3();
  /** Player's velocity, m/s. */
  readonly playerVelocity = new THREE.Vector3();
  playerOnFoot = true;
  playerSpeed = 0;
  /** Nearest drivable road to `target`, if any is close. */
  targetRoad: RoadHit | null = null;
  playerOffRoad = false;
  /** Officers currently out of their cars (for the cap). */
  onFoot = 0;
}
