import { JUNCTION } from './tuning';

/**
 * Give-way at junctions: a per-node reservation book. A vehicle approaching a node asks for its movement
 * (a straight segment from where it enters the junction box to where it leaves). It is granted when no
 * conflicting movement holds the node and no conflicting vehicle with better right of way is waiting.
 * Right of way: bigger road class first, then straight-on over turning, then first come first served; anyone
 * who has waited too long outranks everything, and a grant expires, so nobody waits forever.
 * Movements that do not cross (opposing through traffic, diverging turns) share the node freely.
 *
 * Pure logic: ids, numbers and a clock supplied by the caller.
 */

interface Claim {
  id: number;
  node: number;
  rank: number;
  /** When this vehicle first asked for this node. */
  since: number;
  /** Last time it asked. */
  seen: number;
  granted: boolean;
  grantedAt: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** Shortest distance between 2D segments a–b and c–d. */
export function segmentDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  if (segmentsCross(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  return Math.sqrt(
    Math.min(pointSegment2(ax, az, cx, cz, dx, dz), pointSegment2(bx, bz, cx, cz, dx, dz), pointSegment2(cx, cz, ax, az, bx, bz), pointSegment2(dx, dz, ax, az, bx, bz)),
  );
}

function pointSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return qx * qx + qz * qz;
}

/** Do the open segments a–b and c–d properly cross? */
export function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Priority of a movement: road class first, then (as the road code of the day had it) straight on beats a
 * right turn, which beats a left turn. `turn` is the signed heading change, + = left.
 */
export function movementRank(classRank: number, turn: number, straightAngle = 0.3): number {
  const kind = Math.abs(turn) < straightAngle ? 2 : turn < 0 ? 1 : 0;
  return classRank * 10 + kind;
}

export class JunctionBook {
  private claims: Claim[] = [];
  private byId = new Map<number, Claim>();
  private pool: Claim[] = [];

  /**
   * Ask for (or keep) the right to make a movement through `node`. Call every frame while approaching and
   * crossing; returns true while the vehicle may proceed.
   */
  request(node: number, id: number, rank: number, now: number, x1: number, z1: number, x2: number, z2: number): boolean {
    let claim = this.byId.get(id);
    if (claim && (claim.node !== node || now - claim.seen > JUNCTION.stale)) {
      // A different junction, or an old claim that lapsed: start again.
      claim.node = node;
      claim.since = now;
      claim.granted = false;
    }
    if (!claim) {
      claim = this.pool.pop() ?? { id, node, rank, since: now, seen: now, granted: false, grantedAt: 0, x1, z1, x2, z2 };
      claim.id = id;
      claim.node = node;
      claim.since = now;
      claim.granted = false;
      this.claims.push(claim);
      this.byId.set(id, claim);
    }
    claim.rank = rank;
    claim.seen = now;
    claim.x1 = x1;
    claim.z1 = z1;
    claim.x2 = x2;
    claim.z2 = z2;
    if (claim.granted) return true;

    const mine = this.effectiveRank(claim, now);
    for (let i = 0; i < this.claims.length; i++) {
      const other = this.claims[i];
      if (other === claim || other.node !== node) continue;
      if (now - other.seen > JUNCTION.stale) continue;
      if (segmentDistance(x1, z1, x2, z2, other.x1, other.z1, other.x2, other.z2) >= JUNCTION.conflictDistance) continue;
      if (other.granted) {
        if (now - other.grantedAt <= JUNCTION.holdMax) return false;
        continue;
      }
      const theirs = this.effectiveRank(other, now);
      if (theirs > mine) return false;
      if (theirs === mine && (other.since < claim.since || (other.since === claim.since && other.id < claim.id))) return false;
    }
    claim.granted = true;
    claim.grantedAt = now;
    return true;
  }

  /** Give the node up (after clearing it, or when the vehicle goes away). */
  release(id: number) {
    const claim = this.byId.get(id);
    if (!claim) return;
    this.byId.delete(id);
    const i = this.claims.indexOf(claim);
    if (i >= 0) {
      this.claims[i] = this.claims[this.claims.length - 1];
      this.claims.pop();
    }
    this.pool.push(claim);
  }

  /** Does this vehicle currently hold a grant? */
  holds(id: number): boolean {
    return this.byId.get(id)?.granted ?? false;
  }

  /** Drop claims nobody has refreshed for a while (vehicles that despawned without releasing). */
  prune(now: number) {
    for (let i = this.claims.length - 1; i >= 0; i--) {
      if (now - this.claims[i].seen > JUNCTION.stale * 4) this.release(this.claims[i].id);
    }
  }

  get size(): number {
    return this.claims.length;
  }

  private effectiveRank(claim: Claim, now: number): number {
    return now - claim.since > JUNCTION.waitMax ? claim.rank + 1000 : claim.rank;
  }
}
