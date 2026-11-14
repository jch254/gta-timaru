import * as THREE from 'three';
import { angleDiff, clamp, damp, dampAngle } from '../core/math';
import { CollisionGroup, type GameContext } from '../core/types';

const _target = new THREE.Vector3();
const _want = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Third-person chase camera for both walking and driving. */
export class ChaseCamera {
  /** Heading the camera looks along. */
  yaw = Math.PI;
  pitch = 0.22;
  private sinceLook = 10;
  private distance = 4;
  private zoom = 1;
  private shake = 0;
  private fov = 60;

  constructor(private ctx: GameContext) {
    ctx.events.on('vehicleCrash', ({ vehicle, speed }) => {
      if (vehicle === ctx.player.vehicle) this.shake = Math.min(1, this.shake + speed * 0.07);
    });
  }

  addShake(amount: number) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt: number) {
    const { input, player, camera } = this.ctx;
    const vehicle = player.vehicle;
    if (input.lookYaw || input.lookPitch) this.sinceLook = 0;
    this.sinceLook += dt;
    this.yaw += input.lookYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, vehicle ? -0.05 : -0.9, 1.25);
    if (input.pressed('camera')) this.zoom = this.zoom >= 1.6 ? 0.7 : this.zoom + 0.45;

    let wantDist: number;
    let height: number;
    let side = 0;
    let wantFov = 58;
    if (vehicle) {
      const lookBack = input.held('lookBack');
      const target = vehicle.heading + (lookBack ? Math.PI : 0) + (vehicle.speed < -2 && !lookBack ? Math.PI : 0);
      // Swing back behind the car after a moment without mouse input.
      if (lookBack) this.yaw = target;
      else if (this.sinceLook > 1.1) {
        this.yaw = dampAngle(this.yaw, target, 2.6 + Math.abs(vehicle.speed) * 0.08, dt);
        this.pitch = damp(this.pitch, 0.2, 2, dt);
      }
      wantDist = (vehicle.spec.length * 1.25 + 2.6) * this.zoom;
      height = vehicle.spec.height * 0.55 + 0.9;
      wantFov = 58 + clamp(Math.abs(vehicle.speed) / 50, 0, 1) * 14;
    } else {
      if (player.aiming) {
        wantDist = 2.1;
        side = -0.55;
        height = 1.62;
        wantFov = 46;
      } else {
        wantDist = 3.7 * this.zoom;
        height = 1.55;
        // Drift behind the player while running without mouse input.
        if (this.sinceLook > 2.5 && player.velocity.lengthSq() > 4) {
          const diff = angleDiff(player.heading, this.yaw);
          if (Math.abs(diff) < 2.3) this.yaw += diff * Math.min(1, 1.2 * dt);
        }
      }
    }
    this.distance = damp(this.distance, wantDist, 6, dt);
    this.fov = damp(this.fov, wantFov, 5, dt);
    if (Math.abs(camera.fov - this.fov) > 0.05) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const base = vehicle ? vehicle.position : player.position;
    _target.set(base.x, base.y + height - (vehicle ? 0.55 : 0), base.z);
    // Shoulder offset to the right when aiming (right of forward is (-cos, 0, sin)).
    _target.x += -cos * side * -1;
    _target.z += sin * side * -1;
    // Aiming: the view elevation follows the mouse so you can shoot up at windows or down a bank.
    const aimElevation = !vehicle && player.aiming ? clamp(0.16 - this.pitch, -1.1, 1.1) : 0;
    const cp = Math.cos(this.pitch);
    _dir.set(-sin * cp, Math.sin(this.pitch), -cos * cp);
    // Pull the camera in if the world is in the way.
    let dist = this.distance;
    const hit = this.ctx.physics.raycast(_target, _dir, dist + 0.3, { mask: CollisionGroup.World });
    if (hit) dist = Math.max(0.5, hit.distance - 0.3);
    // Backed against a wall: rather than pressing the lens into the player's head, lift it over the shoulder.
    const squeeze = vehicle ? 0 : clamp(1 - dist / 1.8, 0, 1);
    if (squeeze > 0) {
      dist = Math.max(dist, 0.9);
      _target.y += squeeze * 0.55;
    }
    // Same idea in a vehicle: when there is no room behind, ride up over the roof instead of inside the body.
    if (vehicle && dist < this.distance * 0.75) {
      const crowd = clamp(1 - dist / (this.distance * 0.75), 0, 1);
      dist = Math.max(dist, vehicle.spec.length * 0.45);
      _target.y += crowd * (vehicle.spec.height * 0.9 + 0.6);
    }
    _want.copy(_target).addScaledVector(_dir, dist);
    const floor = this.ctx.world.heightAt(_want.x, _want.z) + 0.35;
    if (_want.y < floor) _want.y = floor;
    camera.position.copy(_want);

    if (this.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * this.shake * 0.35;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.35;
      this.shake = damp(this.shake, 0, 7, dt);
    }
    // Look slightly ahead of the subject so there is road in view.
    if (!vehicle && player.aiming) {
      const ce = Math.cos(aimElevation);
      _dir.set(sin * ce, Math.sin(aimElevation), cos * ce);
      camera.lookAt(_target.addScaledVector(_dir, 30));
    } else {
      _dir.set(sin, 0, cos);
      camera.lookAt(_target.addScaledVector(_dir, vehicle ? 2.5 : 0.5));
    }
  }
}
