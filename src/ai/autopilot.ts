import * as THREE from 'three';
import { clamp, moveToward } from '../core/math';
import { EXTRA_OBSTACLES } from './obstacles';
import type { Actor, Autopilot, GameContext, RoadEdge, Vehicle } from '../core/types';
import { JunctionBook, movementRank } from './junction';
import { curveLimit, laneOffset, makePoint, projectOnEdge, projection, sampleEdge } from './lanes';
import { RouteFollower, type Leg } from './route';
import { arcOffset, boxHalfLat, boxHalfLon, brakingSpeed, followSpeed, lookAhead, pursuitCurvature, pursuitSteer, speedControl, toLocal, turnSpeed, type Local, type Pedals } from './steer';
import { CLASS_RANK, DRIVE, PURSUIT } from './tuning';

/** What every autopilot shares: the game, the junction reservations and this frame's people on foot. */
export interface PilotWorld {
  ctx: GameContext;
  book: JunctionBook;
  rng: { next(): number };
  /** Live actors on foot, refreshed once per frame by the traffic system (avoids iterating the Set per car). */
  walkers: Actor[];
}

const DRIVABLE = (e: RoadEdge) => e.drivable;
const _p = makePoint();
const _local: Local = { f: 0, l: 0 };
const _pedals: Pedals = { throttle: 0, brake: 0, handbrake: false };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Drives any vehicle by writing `vehicle.controls`.
 *  - Route mode follows lane centres with pure-pursuit steering and moves from leg to leg.
 *  - With no route it wanders, choosing a legal exit at each node.
 *  - Target mode steers at a world point (pursuit / off-road), taking to the roads when buildings are in the way.
 * Speed is the road limit × aggression (capped by cruiseSpeed), reduced for bends, junction turns, give-way
 * and whatever is in the corridor ahead.
 */
export class AutopilotImpl implements Autopilot {
  cruiseSpeed = 70;
  aggression = 1;
  avoidObstacles = true;
  /** Preferred lane on multi-lane roads (0 = kerb side). */
  lane = 0;
  /** Drive the route round and round (set before `setRoute`). */
  loop = false;
  /** Seconds spent stopped behind something (the traffic manager honks on this). */
  blockedTime = 0;
  /** The thing in the way is a person. */
  blockedByPerson = false;
  /** The thing in the way is other traffic that will move on by itself (a queue), not a parked car or a wreck. */
  blockedByTraffic = false;
  /** Waiting at a junction for right of way. */
  yielding = false;
  /** Reverse-and-retry manoeuvres since the vehicle last drove freely. */
  stuckCount = 0;

  private follower = new RouteFollower();
  private mode: 'idle' | 'route' | 'wander' | 'target' = 'wander';
  private tx = 0;
  private tz = 0;
  private reached = false;
  private stuck = 0;
  private freeTime = 0;
  private reverseTimer = 0;
  private reverseSteer = 0;
  private steer = 0;
  private curvature = 0;
  /** Sideways shift to the right of the lane centre, to pass things at the kerb. */
  private dodge = 0;
  private overtakeTimer = 0;
  private backedUp = false;
  private oncomingSeen = false;
  /** How far we still have to move over to clear what we are passing. */
  private deficit = 0;
  private slowTime = 0;
  private laneTimer = 0;
  private blockOff = 0;
  private blockGap = 0;
  /** Speed to hold until a junction turn is finished, and the same for the turn coming up. */
  private exitSpeed = Infinity;
  private comingTurnSpeed = Infinity;
  private claimNode = -1;
  private lastUpdate = -1;
  private acquireTimer = 0;
  // Target mode road assist.
  private assist = false;
  private recheck = 0;
  private planX = 0;
  private planZ = 0;
  private planTime = 0;

  constructor(
    public vehicle: Vehicle,
    private world: PilotWorld,
  ) {}

  // ───────────── Autopilot ─────────────

  setRoute(route: Leg[], startS?: number) {
    const v = this.vehicle;
    this.releaseClaim();
    this.mode = 'route';
    this.reached = false;
    this.assist = false;
    this.exitSpeed = this.comingTurnSpeed = Infinity;
    this.follower.lane = this.lane;
    this.follower.startRoute(this.world.ctx.world.graph, route, startS, v.position.x, v.position.z, this.world.rng, this.loop);
  }

  setTarget(x: number, z: number) {
    if (this.mode !== 'target') {
      this.releaseClaim();
      this.mode = 'target';
      this.follower.clear();
      this.assist = false;
      this.recheck = 0;
    }
    this.tx = x;
    this.tz = z;
    this.reached = false;
  }

  stop() {
    this.releaseClaim();
    this.mode = 'idle';
    this.follower.clear();
    this.assist = false;
  }

  /** Back to aimless driving (the default with no route or target). */
  wander() {
    this.releaseClaim();
    this.mode = 'wander';
    this.follower.clear();
    this.assist = false;
    this.acquireTimer = 0;
  }

  /** Start wandering from a known place on the road (saves a nearest-road query at spawn). */
  startOn(edge: RoadEdge, dir: 1 | -1, s: number) {
    this.releaseClaim();
    this.mode = 'wander';
    this.assist = false;
    this.follower.lane = this.lane;
    this.follower.startWander(this.world.ctx.world.graph, edge, dir, s, this.world.rng);
  }

  get arrived(): boolean {
    return this.reached;
  }
  get edge(): RoadEdge | null {
    return this.follower.edge;
  }
  get dir(): 1 | -1 {
    return this.follower.dir;
  }
  get s(): number {
    return this.follower.s;
  }
  get stuckTime(): number {
    return this.stuck;
  }
  /** Wandering has all but reached a dead end (about to turn round, or with nowhere to go at all). */
  get deadEnd(): boolean {
    return this.mode === 'wander' && this.follower.deadEnd && this.follower.remaining < 30;
  }
  /** Is the autopilot wandering (as opposed to following a route / target / holding)? */
  get wandering(): boolean {
    return this.mode === 'wander';
  }

  dispose() {
    this.releaseClaim();
  }

  update(dt: number) {
    const now = this.world.ctx.clock.elapsed;
    // Shared between the traffic system and whoever asked for this autopilot: drive once per frame.
    if (now === this.lastUpdate) return;
    this.lastUpdate = now;
    const v = this.vehicle;
    const c = v.controls;
    if (v.destroyed || v.burning) {
      c.throttle = 0;
      c.brake = 0;
      c.steer = 0;
      c.handbrake = true;
      return;
    }
    // Backing out of trouble takes over completely.
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      c.throttle = 0;
      c.brake = 1;
      c.steer = this.reverseSteer;
      c.handbrake = false;
      return;
    }
    this.steer = 0;
    this.curvature = 0;
    this.yielding = false;
    let want = 0;
    if (this.mode === 'target') want = this.driveTarget(dt);
    else if (this.mode !== 'idle') want = this.driveRoad(dt);
    if (this.reverseTimer > 0) return;

    const speed = v.speed;
    const pursuit = this.aggression >= PURSUIT.aggression;
    if (want > 1 && Math.abs(speed) < 0.5) this.stuck += dt;
    else this.stuck = 0;
    if (Math.abs(speed) > 3) {
      this.freeTime += dt;
      if (this.freeTime > 6) this.stuckCount = 0;
    } else this.freeTime = 0;
    if (this.stuck > (pursuit ? PURSUIT.stuckAfter : DRIVE.stuckAfter)) {
      this.backUp(pursuit ? PURSUIT.reverseTime : DRIVE.reverseTime);
      this.stuckCount++;
    }
    speedControl(speed, want, _pedals);
    c.throttle = _pedals.throttle;
    c.brake = _pedals.brake;
    c.handbrake = _pedals.handbrake;
    c.steer = this.steer;
  }

  // ───────────── Roads ─────────────

  /** Follow the route / wander. Returns the speed to aim for and leaves the steering in `this.steer`. */
  private driveRoad(dt: number): number {
    const { ctx, book, rng } = this.world;
    const graph = ctx.world.graph;
    const v = this.vehicle;
    const f = this.follower;
    const x = v.position.x;
    const z = v.position.z;
    const speed = Math.max(0, v.speed);
    if (!f.edge) {
      if (this.mode === 'route') this.reached = true;
      if (this.mode !== 'wander') return 0;
      // Find the road we are on (or near) and join it facing the way we already point.
      this.acquireTimer -= dt;
      if (this.acquireTimer > 0) return 0;
      this.acquireTimer = 1;
      const hit = graph.nearest(x, z, 45, DRIVABLE);
      if (!hit) return 0;
      sampleEdge(hit.edge, hit.s, _p);
      const facing = Math.sin(v.heading) * _p.tx + Math.cos(v.heading) * _p.tz;
      f.lane = this.lane;
      f.startWander(graph, hit.edge, hit.edge.oneway || facing >= 0 ? 1 : -1, hit.s, rng);
    }
    if (f.finished) {
      if (this.mode === 'route') this.reached = true;
      return 0;
    }
    f.lane = this.lane;
    if (f.track(graph, x, z, rng)) this.exitSpeed = this.comingTurnSpeed;
    // Pushed well off the lane (knocked aside, or a sharp turn overshot on to the footpath): drop the path
    // and rejoin the road properly, instead of chasing a path point from the far side of whatever is in
    // between. Near the end of the leg the car may legitimately be away from this edge's centreline — but
    // only within the junction it is crossing, so being far from that too is the same fault.
    if (f.edge && f.u > f.trimStart + 2) {
      projectOnEdge(f.edge, x, z, f.s, 4);
      if (projection.distance > f.edge.width / 2 + 3 && (f.remaining > 2 || Math.hypot(x - f.midX, z - f.midZ) > f.connLength + 10)) {
        // A route (police patrol, a mission) reads as arrived and plans afresh from wherever this is.
        f.clear();
        this.acquireTimer = 0.4;
        return 3;
      }
    }
    const edge = f.edge!;
    const halfLen = v.spec.length / 2;
    if (this.claimNode >= 0 && this.claimNode !== f.node && f.u > f.trimStart + halfLen) this.releaseClaim();

    const pursuit = this.aggression >= PURSUIT.aggression;
    const keen = 0.75 + 0.25 * this.aggression;
    const brake = pursuit ? PURSUIT.brake : DRIVE.brake * keen;
    const lateral = pursuit ? PURSUIT.bendLateral : DRIVE.lateral * keen;
    const look = (speed * speed) / (2 * brake) + 14;
    const rem = f.remaining;
    const next = f.nextEdge;

    let limit = Math.min(this.cruiseSpeed, edge.speedLimit * this.aggression);
    limit = Math.min(limit, curveLimit(edge, f.dir, f.u, 0, look, lateral, brake));
    let turn = Infinity;
    if (next) {
      const lead = Math.max(0, rem) + f.connLength;
      if (lead < look) limit = Math.min(limit, curveLimit(next, f.nextDir, f.nextTrimStart, lead, look, lateral, brake));
      turn = turnSpeed(f.turn, f.chord, pursuit ? PURSUIT.junctionLateral : DRIVE.turnLateral * keen);
      if (turn < Infinity) limit = Math.min(limit, brakingSpeed(turn, rem, brake));
      // The next road's limit applies from the junction on.
      limit = Math.min(limit, brakingSpeed(Math.min(this.cruiseSpeed, next.speedLimit * this.aggression), lead, brake));
      if (f.junction && !pursuit) {
        // Coming off the smaller road: slow right down for a look.
        if (CLASS_RANK[edge.cls] < f.majorRank) limit = Math.min(limit, brakingSpeed(DRIVE.giveWaySpeed * keen, rem - halfLen, brake));
        if (rem < look + DRIVE.approachPad - 14) {
          const granted = book.request(f.node, v.id, movementRank(CLASS_RANK[edge.cls], f.turn, DRIVE.straightAngle), ctx.clock.elapsed, f.inX, f.inZ, f.outX, f.outZ);
          this.claimNode = f.node;
          const stopDistance = rem - halfLen - DRIVE.stopLineGap;
          // Not ours yet: stop at the line (unless already out in the junction, where stopping helps nobody).
          if (!granted && stopDistance > -2) {
            limit = Math.min(limit, brakingSpeed(0, stopDistance, brake));
            this.yielding = true;
          }
        }
      }
    } else {
      // End of the route or of the road: pull up there.
      limit = Math.min(limit, brakingSpeed(0, edge.length - f.u - 1, brake));
    }
    // Still completing the previous turn.
    if (f.u < f.trimStart && this.exitSpeed < limit) limit = this.exitSpeed;
    this.comingTurnSpeed = turn;

    let reach = lookAhead(speed);
    // Pulling out from behind something at a crawl: aim close in, which puts plenty of lock on.
    if (this.deficit > 0.5 && speed < 5) reach = Math.min(reach, DRIVE.pullOutLook);
    const near = reach * 0.6;
    f.pathPoint(reach, this.dodge, _p);
    toLocal(x, z, v.heading, _p.x, _p.z, _local);
    // On the inside of a sharp bend the lane line doubles back on itself: reach further along it until the
    // aim point is properly ahead, or the car would creep up to the fold and stop.
    for (let k = 0; k < 7 && _local.f * _local.f + _local.l * _local.l < near * near; k++) {
      reach += 2.5;
      f.pathPoint(reach, this.dodge, _p);
      toLocal(x, z, v.heading, _p.x, _p.z, _local);
    }
    this.curvature = _local.f > 0.5 ? pursuitCurvature(_local.f, _local.l) : 0;
    this.steer = pursuitSteer(_local.f, _local.l, v.spec.wheelbase, v.steeringLimit);

    if (this.avoidObstacles) limit = Math.min(limit, this.scan(dt, limit, brake, pursuit, true));
    else {
      this.dodge = moveToward(this.dodge, 0, DRIVE.dodgeDecay * dt);
      this.deficit = 0;
    }
    return Math.max(0, limit);
  }

  // ───────────── Obstacles ─────────────

  /**
   * Look along the corridor the car is about to sweep (an arc matching its steering) for vehicles and people.
   * Returns the speed that keeps a safe gap. On roads (`lanes`) it also works out how far to move over to
   * squeeze past parked cars, and when patience runs out, how to get round whatever has stopped the lane.
   */
  private scan(dt: number, limit: number, brake: number, pursuit: boolean, lanes: boolean): number {
    const { ctx, walkers } = this.world;
    const v = this.vehicle;
    const x = v.position.x;
    const y = v.position.y;
    const z = v.position.z;
    const sin = Math.sin(v.heading);
    const cos = Math.cos(v.heading);
    const speed = Math.max(0, v.speed);
    const halfW = v.spec.width / 2;
    const halfL = v.spec.length / 2;
    const range = Math.min(DRIVE.scanRange, (speed * speed) / (2 * brake) + speed * 1.2 + 16);
    const range2 = (range + 8) * (range + 8);
    // Oncoming traffic is watched for much further out than anything we might have to stop for.
    const far2 = lanes ? Math.max(range2, DRIVE.oncomingRange * DRIVE.oncomingRange) : range2;
    const overtaking = pursuit || this.overtakeTimer > 0;
    const maxDodge = overtaking ? DRIVE.overtakeMax : DRIVE.dodgeMax;
    const dodgeLook = Math.max(16, speed * 3);
    const quarry = this.mode === 'target' && !this.assist;
    const quarry2 = PURSUIT.quarryRadius * PURSUIT.quarryRadius;
    const curvature = this.curvature;
    // On a road, things are placed relative to the lane itself (steadier than the arc while swerving).
    const edge = lanes ? this.follower.edge : null;
    const dir = this.follower.dir;
    const myS = this.follower.s;
    const laneAt = edge ? laneOffset(edge, this.lane) : 0;
    const window = Math.ceil(dodgeLook / 4) + 2;
    // Our own sideways position and the lane's direction, for judging whether we will clear things we pass.
    let myLat = -this.dodge;
    let laneHeading = v.heading;
    if (edge) {
      projectOnEdge(edge, x, z, myS, 2);
      myLat = projection.offset * dir - laneAt;
      sampleEdge(edge, myS, _p);
      laneHeading = Math.atan2(_p.tx * dir, _p.tz * dir);
    }
    let allowed = Infinity;
    let wantDodge = 0;
    let still = false;
    let person = false;
    let slow = false;
    let oncoming = false;
    let gapMin = Infinity;
    let blockOff = 0;
    let live = false;
    let waiting = false;

    const all = ctx.vehicles.all;
    const obstacles = all.length + EXTRA_OBSTACLES.length;
    for (let i = 0; i < obstacles; i++) {
      // Other vehicles, then anything else that drives itself along the road (the tram).
      const o = i < all.length ? all[i] : EXTRA_OBSTACLES[i - all.length];
      if (o === v) continue;
      const dx = o.position.x - x;
      const dz = o.position.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2 || Math.abs(o.position.y - y) > 3) continue;
      const fwd = dx * sin + dz * cos;
      if (d2 > range2) {
        // Too far to matter except as something coming the other way on this road.
        if (edge && fwd > 0 && o.velocity.x * sin + o.velocity.z * cos < -2) {
          const s = projectOnEdge(edge, o.position.x, o.position.z, myS, 32);
          const side = projection.offset * dir - laneAt;
          if (s > 0.5 && s < edge.length - 0.5 && side < -0.4 && side > -(DRIVE.overtakeMax + 3)) oncoming = true;
        }
        continue;
      }
      if (quarry && (o.position.x - this.tx) * (o.position.x - this.tx) + (o.position.z - this.tz) * (o.position.z - this.tz) < quarry2) continue;
      const delta = o.heading - v.heading;
      const oLon = boxHalfLon(o.spec.width, o.spec.length, delta);
      // Fully behind us.
      if (fwd < -(halfL + oLon + 1)) continue;
      const lat = dx * cos - dz * sin;
      const gap = fwd - halfL - oLon;
      const off = arcOffset(fwd, lat, curvature);
      const clear = halfW + boxHalfLat(o.spec.width, o.spec.length, delta) + DRIVE.corridorMargin;
      const along = o.velocity.x * sin + o.velocity.z * cos;
      const moving = o.velocity.x * o.velocity.x + o.velocity.z * o.velocity.z > 0.8;
      // Where it sits relative to the lane line we would be on without having moved over, and how much room
      // it needs, both measured across the road (so a car at an angle while pulling out judges it the same).
      let nominal = off - this.dodge;
      let across = clear;
      let onLane = false;
      if (edge && gap < dodgeLook) {
        const s = projectOnEdge(edge, o.position.x, o.position.z, myS, window);
        if (s > 0.5 && s < edge.length - 0.5) {
          nominal = projection.offset * dir - laneAt;
          across = halfW + boxHalfLat(o.spec.width, o.spec.length, o.heading - laneHeading) + DRIVE.corridorMargin;
          onLane = true;
        }
      }
      if (along < -2 && fwd > 0 && nominal < -0.4 && nominal > -(DRIVE.overtakeMax + across)) oncoming = true;
      let passing = false;
      let held = false;
      // Empty cars at the kerb are passed as a matter of course; anything with someone at the wheel only once
      // patience has run out (it may be about to move).
      const occupied = o.driver !== null && !o.destroyed;
      if (lanes && gap < dodgeLook && ((!moving && !occupied) || (overtaking && along > -1))) {
        const need = across - nominal;
        if (need > 0 && need <= maxDodge) {
          // Pulling out over the centre line waits for a gap in the oncoming traffic (unless already committed).
          held = this.oncomingSeen && !pursuit && gap > 0 && edge !== null && !edge.oneway && laneAt - need - halfW < 0.2;
          if (!held) {
            if (need > wantDodge) wantDodge = need;
            passing = true;
          }
        }
      }
      // Already alongside: braking will not help.
      if (fwd <= 0 || gap < -1) continue;
      // In our way? While squeezing past, judge it across the road, and a little less than full clearance will do.
      if (passing && onLane ? nominal - myLat >= across - 0.3 : Math.abs(off) >= clear) continue;
      let a = followSpeed(Math.max(0, gap), along, brake, occupied ? DRIVE.standoff : DRIVE.standoffParked);
      if (passing && gap > 0.8) a = Math.max(a, pursuit ? PURSUIT.passSpeed : DRIVE.passCrawl);
      if (a < allowed) {
        allowed = a;
        still = !moving;
        person = false;
        slow = moving && along > 1;
        gapMin = gap;
        blockOff = off;
        live = o.driver !== null && !o.destroyed && !o.burning && (o.controller === 'traffic' || o.controller === 'police' || o.controller === 'mission');
        waiting = held;
      }
    }

    for (let i = 0; i < walkers.length; i++) {
      const o = walkers[i];
      const dx = o.position.x - x;
      const dz = o.position.z - z;
      if (dx * dx + dz * dz > range2 || Math.abs(o.position.y - y) > 3) continue;
      if (quarry && (o.position.x - this.tx) * (o.position.x - this.tx) + (o.position.z - this.tz) * (o.position.z - this.tz) < quarry2) continue;
      const fwd = dx * sin + dz * cos;
      if (fwd < -(halfL + 1)) continue;
      const lat = dx * cos - dz * sin;
      const gap = fwd - halfL - 0.4;
      const off = arcOffset(fwd, lat, curvature);
      const clear = halfW + 0.65 + DRIVE.corridorMargin;
      const moving = o.velocity.x * o.velocity.x + o.velocity.z * o.velocity.z > 0.3;
      let passing = false;
      // Only once patience has run out does anyone drive round a person standing in the road.
      if (lanes && overtaking && !moving && gap < dodgeLook) {
        let nominal = off - this.dodge;
        if (edge) {
          const s = projectOnEdge(edge, o.position.x, o.position.z, myS, window);
          if (s > 0.5 && s < edge.length - 0.5) nominal = projection.offset * dir - laneAt;
        }
        const need = clear - nominal;
        if (need > 0 && need <= maxDodge) {
          if (need > wantDodge) wantDodge = need;
          passing = true;
        }
      }
      if (fwd <= 0 || gap < -1 || Math.abs(off) >= (passing ? clear - 0.3 : clear)) continue;
      let a = followSpeed(Math.max(0, gap), 0, brake, DRIVE.standoffPerson);
      if (passing && gap > 0.8) a = Math.max(a, DRIVE.passCrawl);
      if (a < allowed) {
        allowed = a;
        still = !moving;
        person = true;
        slow = false;
        gapMin = gap;
        blockOff = off;
        live = false;
        waiting = false;
      }
    }

    this.oncomingSeen = oncoming;
    this.deficit = wantDodge + myLat;
    this.blockOff = blockOff;
    this.blockGap = gapMin;
    if (!lanes) return allowed;

    // Ease back to the lane afterwards; get back smartly if something is coming.
    this.dodge = moveToward(this.dodge, wantDodge, (wantDodge > this.dodge ? DRIVE.dodgeRate * (1 + 6 / (1 + speed)) : oncoming ? DRIVE.dodgeRate : DRIVE.dodgeDecay) * dt);
    if (this.overtakeTimer > 0) {
      this.overtakeTimer -= dt;
      // Something coming the other way: tuck back in.
      if (oncoming && !still && !pursuit) this.overtakeTimer = 0;
    }
    if (this.laneTimer > 0) this.laneTimer -= dt;

    const blocked = allowed < 0.6 && v.speed < 0.6;
    if (blocked && waiting) {
      // Sitting behind a parked car until the road is clear to pull out: giving way, not held up.
      this.yielding = true;
      this.blockedTime = 0;
    } else if (blocked) {
      this.blockedTime += dt;
      this.blockedByPerson = person;
      this.blockedByTraffic = live;
      // Whatever it is has not moved for a while: go round it, backing up first if there is no room to pull out.
      // (A queue of live traffic gets a lot more patience than a parked car, a wreck or a person.)
      if (still && this.overtakeTimer <= 0 && this.blockedTime > DRIVE.overtakeAfter * (person ? 1.6 : live ? DRIVE.queuePatience : 1)) {
        this.overtakeTimer = 9;
        if (gapMin < 6 && !this.backedUp) {
          this.backedUp = true;
          this.backUp(DRIVE.pullOutReverse, true);
        }
      }
    } else if (v.speed > 2 || allowed > 3) {
      this.blockedTime = 0;
      this.backedUp = false;
    }

    // Impatient drivers do not sit behind slower traffic.
    if (slow && this.aggression >= DRIVE.overtakeAggression && allowed < limit - 4) {
      this.slowTime += dt;
      if (this.slowTime > 0.8) {
        this.slowTime = 0;
        const edge = this.follower.edge;
        if (edge && edge.lanes > 1) {
          if (this.laneTimer <= 0) {
            this.lane = this.lane === 0 ? 1 : 0;
            this.laneTimer = 4;
          }
        } else if (!oncoming) this.overtakeTimer = Math.max(this.overtakeTimer, 4);
      }
    } else this.slowTime = 0;
    return allowed;
  }

  private backUp(seconds: number, straight = false) {
    this.reverseTimer = seconds;
    // Opposite lock while reversing swings the nose towards where we were trying to go.
    const side = Math.abs(this.steer) > 0.1 ? Math.sign(this.steer) : this.world.rng.next() < 0.5 ? 1 : -1;
    this.reverseSteer = straight ? 0 : -side * 0.85;
    this.stuck = 0;
  }

  private releaseClaim() {
    this.world.book.release(this.vehicle.id);
    this.claimNode = -1;
  }

  // ───────────── Pursuit / off-road ─────────────

  private driveTarget(dt: number): number {
    const { ctx } = this.world;
    const v = this.vehicle;
    const x = v.position.x;
    const z = v.position.z;
    const speed = v.speed;
    const d = Math.hypot(this.tx - x, this.tz - z);
    const pursuit = this.aggression >= PURSUIT.aggression;
    if (d < PURSUIT.arriveRadius) {
      this.reached = true;
      if (this.assist) {
        this.assist = false;
        this.follower.clear();
        this.releaseClaim();
      }
      return 0;
    }
    this.reached = false;

    if (PURSUIT.roadAssist) {
      this.recheck -= dt;
      if (this.recheck <= 0) {
        this.recheck = PURSUIT.recheck;
        if (d < PURSUIT.directRange || this.clearLine()) {
          if (this.assist) {
            this.assist = false;
            this.follower.clear();
            this.releaseClaim();
          }
        } else if (
          !this.assist ||
          this.follower.finished ||
          Math.hypot(this.tx - this.planX, this.tz - this.planZ) > PURSUIT.replanDistance ||
          ctx.clock.elapsed - this.planTime > PURSUIT.replanSeconds
        ) {
          this.assist = this.plan();
        }
      }
      if (this.assist && this.follower.edge && !this.follower.finished) return this.driveRoad(dt);
    }

    // Straight at it: steer for a point on the line to the target, a look-ahead distance away.
    toLocal(x, z, v.heading, this.tx, this.tz, _local);
    let lf = _local.f;
    let ll = _local.l;
    const look = clamp(PURSUIT.lookMin + PURSUIT.lookGain * Math.abs(speed), PURSUIT.lookMin, PURSUIT.lookMax);
    if (d > look) {
      lf *= look / d;
      ll *= look / d;
    }
    const bearing = Math.atan2(ll, lf);
    // Behind us and close, or inside our turning circle: back up and swing the nose round.
    if (Math.abs(speed) < 7 && ((Math.abs(bearing) > PURSUIT.behindAngle && d < PURSUIT.jTurnRange) || (Math.abs(bearing) > 1 && d < DRIVE.minTurnRadius * 2))) {
      this.reverseTimer = 1.1;
      this.reverseSteer = bearing > 0 ? -0.9 : 0.9;
      return 0;
    }
    this.curvature = lf > 0.5 ? pursuitCurvature(lf, ll) : ll >= 0 ? 0.25 : -0.25;
    this.steer = pursuitSteer(lf, ll, v.spec.wheelbase, v.steeringLimit);
    const brake = pursuit ? PURSUIT.brake : DRIVE.brake;
    let limit = this.cruiseSpeed;
    const k = Math.abs(this.curvature);
    if (k > 0.002) limit = Math.min(limit, Math.max(PURSUIT.minTurnSpeed, Math.sqrt((PURSUIT.lateral * clamp(this.aggression / 2, 0.45, 1.2)) / k)));
    // Unhurried drivers ease up to the point; pursuers arrive at speed.
    if (!pursuit) limit = Math.min(limit, brakingSpeed(1.5, d - PURSUIT.arriveRadius, brake));
    if (this.avoidObstacles) {
      const allowed = this.scan(dt, limit, brake, pursuit, false);
      if (allowed < limit) {
        if (pursuit) {
          // Do not queue: aim off to the open side and keep some speed on.
          const aim = ll - Math.sign(this.blockOff || 1) * PURSUIT.swerve * clamp(1 - this.blockGap / 30, 0.3, 1);
          this.steer = pursuitSteer(lf, aim, v.spec.wheelbase, v.steeringLimit);
          limit = Math.max(allowed, Math.min(limit, PURSUIT.passSpeed));
        } else limit = allowed;
      }
    }
    return Math.max(0, limit);
  }

  /** Nothing solid between the vehicle and the target point? */
  private clearLine(): boolean {
    const { ctx } = this.world;
    const v = this.vehicle;
    _a.set(v.position.x, v.position.y + 1.2, v.position.z);
    _b.set(this.tx, ctx.world.groundAt(this.tx, this.tz) + 1.4, this.tz);
    return ctx.physics.lineOfSight(_a, _b);
  }

  /** Plan a road route towards the target from wherever the vehicle is. */
  private plan(): boolean {
    const { ctx, rng } = this.world;
    const graph = ctx.world.graph;
    const v = this.vehicle;
    const from = graph.nearest(v.position.x, v.position.z, PURSUIT.roadSnap, DRIVABLE);
    if (!from) return false;
    const to = graph.nearest(this.tx, this.tz, 60, DRIVABLE);
    const goal = to ? (to.s < to.edge.length / 2 ? to.edge.a : to.edge.b) : graph.nearestNode(this.tx, this.tz).index;
    const e = from.edge;
    sampleEdge(e, from.s, _p);
    const facing = Math.sin(v.heading) * _p.tx + Math.cos(v.heading) * _p.tz;
    let best: Leg[] | null = null;
    let bestCost = Infinity;
    for (let k = 0; k < 2; k++) {
      const dir: 1 | -1 = k === 0 ? 1 : -1;
      if (dir === -1 && e.oneway) continue;
      const rest = graph.route(dir === 1 ? e.b : e.a, goal);
      if (!rest) continue;
      let cost = (dir === 1 ? e.length - from.s : from.s) / e.speedLimit;
      for (let i = 0; i < rest.length; i++) cost += rest[i].edge.length / rest[i].edge.speedLimit;
      // Turning round first costs time.
      if (facing * dir < 0) cost += 5;
      if (cost < bestCost) {
        bestCost = cost;
        best = [{ edge: e, dir }, ...rest];
      }
    }
    if (!best) return false;
    this.releaseClaim();
    this.follower.lane = this.lane;
    this.follower.startRoute(graph, best, from.s, v.position.x, v.position.z, rng);
    this.exitSpeed = this.comingTurnSpeed = Infinity;
    this.planX = this.tx;
    this.planZ = this.tz;
    this.planTime = ctx.clock.elapsed;
    return true;
  }
}
