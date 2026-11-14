import { angleDiff, clamp } from '../core/math';
import type { Autopilot, RoadEdge, RoadGraph, Vehicle } from '../core/types';

type Leg = { edge: RoadEdge; dir: 1 | -1 };

/** Bring a vehicle to rest and keep it there. (The brake pedal reverses a stopped car, so ease onto the handbrake.) */
export function holdStill(vehicle: Vehicle) {
  const c = vehicle.controls;
  const rolling = vehicle.speed > 1.5;
  c.throttle = 0;
  c.steer = 0;
  c.brake = rolling ? 1 : 0;
  c.handbrake = !rolling;
}

/**
 * Stand-in driver, used only when the traffic module's autopilot is unavailable (`createAutopilot` throws).
 * It follows a lane route or steers straight at a point; it does not look out for other road users.
 * The real Autopilot replaces it without any other change.
 */
export class SimplePilot implements Autopilot {
  cruiseSpeed = 14;
  aggression = 1;
  avoidObstacles = true;
  arrived = true;
  edge: RoadEdge | null = null;
  dir: 1 | -1 = 1;
  s = 0;
  stuckTime = 0;

  private route: Leg[] = [];
  private index = 0;
  private hasTarget = false;
  private tx = 0;
  private tz = 0;
  private resync = 0;
  private onEdge = (e: RoadEdge) => e === this.edge;

  constructor(
    readonly vehicle: Vehicle,
    private graph: RoadGraph,
  ) {}

  setRoute(route: Leg[], startS?: number) {
    this.route = route;
    this.index = 0;
    this.hasTarget = false;
    const first = route[0];
    if (!first) {
      this.edge = null;
      this.arrived = true;
      return;
    }
    this.edge = first.edge;
    this.dir = first.dir;
    this.s = clamp(startS ?? (first.dir === 1 ? 0 : first.edge.length), 0, first.edge.length);
    this.arrived = false;
    this.resync = 0.6;
  }

  setTarget(x: number, z: number) {
    this.route = [];
    this.edge = null;
    this.hasTarget = true;
    this.tx = x;
    this.tz = z;
    this.arrived = false;
  }

  stop() {
    this.route = [];
    this.edge = null;
    this.hasTarget = false;
    this.arrived = true;
    this.stuckTime = 0;
    holdStill(this.vehicle);
  }

  update(dt: number) {
    const v = this.vehicle;
    if (v.destroyed) return;
    let aimX: number;
    let aimZ: number;
    let limit = this.cruiseSpeed;
    if (this.hasTarget) {
      aimX = this.tx;
      aimZ = this.tz;
      const d = Math.hypot(aimX - v.position.x, aimZ - v.position.z);
      this.arrived = d < 6;
      if (this.arrived && this.avoidObstacles) {
        holdStill(v);
        this.stuckTime = 0;
        return;
      }
      // Ease off on the way in, unless the idea is to hit it.
      if (this.avoidObstacles && d < 30) limit = Math.min(limit, 5 + d * 0.6);
    } else if (this.edge) {
      this.advance(dt);
      if (this.arrived || !this.edge) {
        holdStill(v);
        this.stuckTime = 0;
        return;
      }
      const p = this.ahead(clamp(7 + Math.abs(v.speed) * 0.8, 8, 28));
      aimX = p.x;
      aimZ = p.z;
      limit = Math.min(limit, this.edge.speedLimit * Math.max(1, this.aggression));
    } else {
      holdStill(v);
      this.stuckTime = 0;
      return;
    }

    const c = v.controls;
    const turn = angleDiff(Math.atan2(aimX - v.position.x, aimZ - v.position.z), v.heading);
    c.steer = clamp(turn * 2, -1, 1);
    c.handbrake = false;
    const target = limit * clamp(1 - Math.abs(turn) * 0.75, 0.3, 1);
    const speed = v.speed;
    if (speed < target - 0.5) {
      c.throttle = clamp((target - speed) * 0.35, 0.25, 1);
      c.brake = 0;
    } else if (speed > target + 2.5) {
      c.throttle = 0;
      c.brake = clamp((speed - target) * 0.12, 0.1, 1);
    } else {
      c.throttle = 0.12;
      c.brake = 0;
    }
    if (c.throttle > 0.3 && Math.abs(speed) < 0.6) this.stuckTime += dt;
    else this.stuckTime = 0;
  }

  /** Track progress along the current leg and step to the next one at its end. */
  private advance(dt: number) {
    const v = this.vehicle;
    const edge = this.edge!;
    this.resync -= dt;
    if (this.resync <= 0) {
      this.resync = 0.6;
      const hit = this.graph.nearest(v.position.x, v.position.z, 30, this.onEdge);
      if (hit) this.s = hit.s;
    } else {
      this.s = clamp(this.s + Math.max(0, v.speed) * dt * this.dir, 0, edge.length);
    }
    const done = this.dir === 1 ? this.s >= edge.length - 2 : this.s <= 2;
    if (!done) return;
    this.index++;
    const next = this.route[this.index];
    if (!next) {
      this.arrived = true;
      return;
    }
    this.edge = next.edge;
    this.dir = next.dir;
    this.s = next.dir === 1 ? 0 : next.edge.length;
    this.resync = 0.6;
  }

  /** Lane point `distance` metres further along the route. */
  private ahead(distance: number) {
    let i = this.index;
    let leg = this.route[i];
    let at = this.s;
    let left = distance;
    for (;;) {
      const room = leg.dir === 1 ? leg.edge.length - at : at;
      const next = this.route[i + 1];
      if (left <= room || !next) {
        at += leg.dir * Math.min(left, room);
        break;
      }
      left -= room;
      i++;
      leg = next;
      at = leg.dir === 1 ? 0 : leg.edge.length;
    }
    return this.graph.lanePoint(leg.edge, at, leg.dir, 0);
  }
}
