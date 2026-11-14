import { describe, expect, it } from 'vitest';
import { JunctionBook, movementRank, segmentDistance, segmentsCross } from './junction';
import { JUNCTION } from './tuning';

// A crossroads at the origin. Keep-left lanes sit 2.4 m from the centre lines; the junction box is ±5 m.
// North is −z. Northbound traffic drives on the west side (x = −2.4), southbound on the east (x = +2.4),
// eastbound on the north side (z = −2.4), westbound on the south side (z = +2.4).
const NORTHBOUND = [-2.4, 5, -2.4, -5] as const;
const SOUTHBOUND = [2.4, -5, 2.4, 5] as const;
const EASTBOUND = [-5, -2.4, 5, -2.4] as const;
const WESTBOUND = [5, 2.4, -5, 2.4] as const;
/** From the south, turning right (east): crosses the southbound lane. */
const NORTH_TO_EAST = [-2.4, 5, 5, -2.4] as const;
/** From the south, turning left (west): stays in its own corner. */
const NORTH_TO_WEST = [-2.4, 5, -5, 2.4] as const;

type Move = readonly [number, number, number, number];
const ask = (book: JunctionBook, id: number, rank: number, now: number, m: Move, node = 7) => book.request(node, id, rank, now, m[0], m[1], m[2], m[3]);

describe('segment geometry', () => {
  it('is zero for crossing segments and the gap for parallel ones', () => {
    expect(segmentsCross(-5, 0, 5, 0, 0, -5, 0, 5)).toBe(true);
    expect(segmentDistance(-5, 0, 5, 0, 0, -5, 0, 5)).toBe(0);
    expect(segmentDistance(-5, 0, 5, 0, -5, 3, 5, 3)).toBeCloseTo(3);
    expect(segmentDistance(0, 0, 1, 0, 4, 4, 4, 9)).toBeCloseTo(5);
    expect(segmentDistance(0, 0, 4, 0, 4, 0, 4, 6)).toBe(0);
  });
});

describe('junction reservations', () => {
  it('grants a free node and makes a crossing movement wait until it is released', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, NORTHBOUND)).toBe(true);
    expect(book.holds(1)).toBe(true);
    expect(ask(book, 2, 30, 0.1, EASTBOUND)).toBe(false);
    expect(ask(book, 1, 30, 0.2, NORTHBOUND)).toBe(true);
    expect(ask(book, 2, 30, 0.3, EASTBOUND)).toBe(false);
    book.release(1);
    expect(ask(book, 2, 30, 0.4, EASTBOUND)).toBe(true);
  });

  it('never lets two conflicting movements hold the node together', () => {
    const book = new JunctionBook();
    const moves: Move[] = [NORTHBOUND, EASTBOUND, WESTBOUND, NORTH_TO_EAST];
    let now = 0;
    for (let round = 0; round < 200; round++) {
      now += 0.1;
      const granted: Move[] = [];
      moves.forEach((m, id) => {
        if (ask(book, id, 30, now, m)) granted.push(m);
      });
      for (let i = 0; i < granted.length; i++) {
        for (let j = i + 1; j < granted.length; j++) {
          const a = granted[i];
          const b = granted[j];
          expect(segmentDistance(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3])).toBeGreaterThanOrEqual(JUNCTION.conflictDistance);
        }
      }
      // Whoever holds it clears the junction after a second.
      if (round % 10 === 9) moves.forEach((_, id) => book.holds(id) && book.release(id));
    }
  });

  it('lets opposing through traffic and a tucked-in left turn share the node', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, NORTHBOUND)).toBe(true);
    expect(ask(book, 2, 30, 0, SOUTHBOUND)).toBe(true);
    expect(ask(book, 3, 30, 0, WESTBOUND)).toBe(false);
    const other = new JunctionBook();
    expect(ask(other, 1, 30, 0, SOUTHBOUND)).toBe(true);
    expect(ask(other, 2, 30, 0, NORTH_TO_WEST)).toBe(true);
    expect(ask(other, 3, 30, 0, NORTH_TO_EAST)).toBe(false);
  });

  it('gives way to the larger road, whoever asked first', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, NORTH_TO_EAST)).toBe(true);
    // A side-street car arrives first and waits; a main-road car whose path crosses its own arrives after it.
    expect(ask(book, 2, 30, 0.5, SOUTHBOUND)).toBe(false);
    expect(ask(book, 1, 30, 1, NORTH_TO_EAST)).toBe(true);
    expect(ask(book, 2, 30, 1, SOUTHBOUND)).toBe(false);
    expect(ask(book, 3, 40, 1, WESTBOUND)).toBe(false);
    book.release(1);
    expect(ask(book, 2, 30, 1.1, SOUTHBOUND)).toBe(false);
    expect(ask(book, 3, 40, 1.1, WESTBOUND)).toBe(true);
    expect(ask(book, 2, 30, 1.2, SOUTHBOUND)).toBe(false);
    book.release(3);
    expect(ask(book, 2, 30, 1.3, SOUTHBOUND)).toBe(true);
  });

  it('is first come, first served between equals', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, SOUTHBOUND)).toBe(true);
    expect(ask(book, 5, 30, 0.3, WESTBOUND)).toBe(false);
    expect(ask(book, 1, 30, 0.6, SOUTHBOUND)).toBe(true);
    expect(ask(book, 5, 30, 0.6, WESTBOUND)).toBe(false);
    expect(ask(book, 2, 30, 0.6, NORTH_TO_EAST)).toBe(false);
    book.release(1);
    // Asked in the other order this frame; the earlier arrival still goes first.
    expect(ask(book, 2, 30, 0.7, NORTH_TO_EAST)).toBe(false);
    expect(ask(book, 5, 30, 0.7, WESTBOUND)).toBe(true);
  });

  it('nobody waits forever: a long wait outranks a bigger road', () => {
    const book = new JunctionBook();
    let now = 0;
    let granted = false;
    // A stream of main-road cars, each asking before the last has cleared.
    for (let i = 0; i < 400 && !granted; i++) {
      now += 0.1;
      const main = 100 + Math.floor(i / 20);
      ask(book, main, 40, now, i % 40 < 20 ? WESTBOUND : EASTBOUND);
      ask(book, main + 1, 40, now, i % 40 < 20 ? EASTBOUND : WESTBOUND);
      granted = ask(book, 1, 30, now, NORTHBOUND);
      if (i % 20 === 19) book.release(main);
    }
    expect(granted).toBe(true);
    expect(now).toBeLessThan(JUNCTION.waitMax + JUNCTION.holdMax + 2);
  });

  it('a grant expires if the holder never clears the junction', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, NORTHBOUND)).toBe(true);
    let now = 0;
    let through = false;
    while (now < JUNCTION.holdMax + 1 && !through) {
      now += 0.25;
      ask(book, 1, 30, now, NORTHBOUND);
      through = ask(book, 2, 30, now, EASTBOUND);
    }
    expect(through).toBe(true);
    expect(now).toBeGreaterThan(JUNCTION.holdMax);
  });

  it('forgets vehicles that stop asking', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, NORTHBOUND)).toBe(true);
    expect(ask(book, 2, 30, 0.1, EASTBOUND)).toBe(false);
    // Vehicle 1 despawned without releasing.
    expect(ask(book, 2, 30, JUNCTION.stale + 0.2, EASTBOUND)).toBe(true);
    book.prune(100);
    expect(book.size).toBe(0);
  });

  it('keeps junctions separate and restarts a claim at a new node', () => {
    const book = new JunctionBook();
    expect(ask(book, 1, 30, 0, NORTHBOUND, 7)).toBe(true);
    expect(ask(book, 2, 30, 0, EASTBOUND, 8)).toBe(true);
    // Vehicle 1 moves on to node 8 where vehicle 2 holds a crossing movement.
    expect(ask(book, 1, 30, 0.5, NORTHBOUND, 8)).toBe(false);
    // …which frees node 7 for somebody else.
    expect(ask(book, 3, 30, 0.6, EASTBOUND, 7)).toBe(true);
  });
});

describe('movement rank', () => {
  it('puts road class first, then straight over right turn over left turn', () => {
    const straight = movementRank(3, 0.05);
    const right = movementRank(3, -1.5);
    const left = movementRank(3, 1.5);
    expect(straight).toBeGreaterThan(right);
    expect(right).toBeGreaterThan(left);
    expect(movementRank(4, 1.5)).toBeGreaterThan(straight);
  });
});
