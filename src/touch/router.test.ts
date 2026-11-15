import { describe, expect, it } from 'vitest';
import type { ButtonId } from './controls';
import { TouchFeed } from './feed';
import { TouchRouter, type RouterView } from './router';
import { STICK_RADIUS, steerCurve } from './stick';

const W = 844;
const H = 390;

/** Stands in for the overlay: remembers what it was told to draw. Pedals sit side by side at the bottom right. */
function setup() {
  const feed = new TouchFeed();
  const down = new Set<ButtonId>();
  const stick = { on: false, x: 0, y: 0, sprint: false };
  const view: RouterView = {
    width: () => W,
    height: () => H,
    pedalAt: (x, y) => (y < 240 ? null : x >= 740 ? 'gas' : x >= 640 ? 'brake' : null),
    stick(on, baseX, baseY, state) {
      stick.on = on;
      stick.x = baseX;
      stick.y = baseY;
      stick.sprint = state.sprint;
    },
    button(id, isDown) {
      if (isDown) down.add(id);
      else down.delete(id);
    },
  };
  return { feed, down, stick, router: new TouchRouter(feed, view) };
}

describe('TouchRouter: one finger, one job', () => {
  it('a touch on the left starts the stick where it lands; pushing up walks forward', () => {
    const { feed, stick, router } = setup();
    router.start(1, 150, 250, null);
    expect(stick).toMatchObject({ on: true, x: 150, y: 250 });
    router.move(1, 150, 250 - STICK_RADIUS / 2);
    expect(feed.moveZ).toBeGreaterThan(0.3);
    expect(feed.moveZ).toBeLessThan(0.6);
    expect(feed.moveX).toBeCloseTo(0);
    expect(feed.held('sprint')).toBe(false);
  });

  it('pushing to the rim sprints; easing off walks again', () => {
    const { feed, stick, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150, 250 - STICK_RADIUS);
    expect(feed.moveZ).toBeCloseTo(1);
    expect(feed.held('sprint')).toBe(true);
    expect(stick.sprint).toBe(true);
    router.move(1, 150, 250 - STICK_RADIUS * 0.5);
    expect(feed.held('sprint')).toBe(false);
  });

  it('stick left is moveX +1 (the game counts left as positive)', () => {
    const { feed, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150 - STICK_RADIUS, 250);
    expect(feed.moveX).toBeCloseTo(1);
    expect(feed.moveZ).toBeCloseTo(0);
  });

  it('letting go centres the stick and stops sprinting', () => {
    const { feed, stick, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150, 100);
    router.end(1);
    expect([feed.moveX, feed.moveZ]).toEqual([0, 0]);
    expect(feed.held('sprint')).toBe(false);
    expect(stick.on).toBe(false);
    expect(router.touches).toBe(0);
  });

  it('the base follows a thumb that overshoots, so reversing is quick', () => {
    const { feed, stick, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150 + STICK_RADIUS + 40, 250);
    expect(stick.x).toBeCloseTo(190);
    router.move(1, 150 + 40 - STICK_RADIUS, 250);
    expect(feed.moveX).toBeCloseTo(1);
  });

  it('a touch on the right looks around by however far it moves', () => {
    const { feed, stick, router } = setup();
    router.start(1, 600, 150, null);
    expect(stick.on).toBe(false);
    router.move(1, 630, 140);
    router.move(1, 650, 145);
    feed.poll();
    expect(feed.lookX).toBe(50);
    expect(feed.lookY).toBe(-5);
    expect([feed.moveX, feed.moveZ]).toEqual([0, 0]);
  });
});

describe('TouchRouter: several fingers at once', () => {
  it('stick, look and a button each keep their own finger', () => {
    const { feed, down, router } = setup();
    router.start(7, 150, 250, null);
    router.move(7, 150, 250 - STICK_RADIUS);
    router.start(3, 600, 150, null);
    router.start(9, 700, 330, 'jump');
    router.move(3, 640, 150);
    router.move(7, 150 - STICK_RADIUS, 250 - STICK_RADIUS);
    feed.poll();
    expect(feed.pressed('jump')).toBe(true);
    expect(down.has('jump')).toBe(true);
    expect(feed.lookX).toBe(40);
    expect(feed.moveX).toBeGreaterThan(0.5);
    expect(feed.moveZ).toBeGreaterThan(0.5);
    // Lifting the look finger leaves the other two alone.
    router.end(3);
    expect(feed.held('jump')).toBe(true);
    expect(feed.moveZ).toBeGreaterThan(0.5);
    router.end(9);
    expect(feed.held('jump')).toBe(false);
    expect(down.has('jump')).toBe(false);
    expect(feed.moveZ).toBeGreaterThan(0.5);
  });

  it('a second finger on the left looks instead of fighting over the stick', () => {
    const { feed, stick, router } = setup();
    router.start(1, 150, 250, null);
    router.start(2, 200, 100, null);
    router.move(2, 230, 100);
    feed.poll();
    expect(feed.lookX).toBe(30);
    expect(stick).toMatchObject({ x: 150, y: 250 });
    // Once the stick finger lifts, the next touch on the left takes the stick.
    router.end(1);
    router.start(3, 100, 300, null);
    expect(stick).toMatchObject({ on: true, x: 100, y: 300 });
  });

  it('two fingers on one button: it stays down until both have lifted', () => {
    const { feed, router } = setup();
    router.start(1, 800, 300, 'handbrake');
    router.start(2, 805, 305, 'handbrake');
    router.end(1);
    expect(feed.held('handbrake')).toBe(true);
    router.end(2);
    expect(feed.held('handbrake')).toBe(false);
  });

  it('an identifier reused by the browser starts a fresh touch', () => {
    const { feed, router } = setup();
    router.start(0, 700, 330, 'jump');
    router.start(0, 600, 100, null);
    expect(feed.held('jump')).toBe(false);
    expect(router.touches).toBe(1);
  });

  it('a touch the browser stops reporting is dropped, so nothing sticks', () => {
    const { feed, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150, 150);
    router.start(2, 800, 300, 'gas');
    router.reconcile([2]);
    expect([feed.moveX, feed.moveZ]).toEqual([0, 0]);
    expect(feed.throttle).toBe(1);
    router.reconcile([]);
    expect(feed.throttle).toBe(0);
    expect(router.touches).toBe(0);
  });
});

describe('TouchRouter: buttons', () => {
  it('a tap button presses once and holds nothing', () => {
    const { feed, router } = setup();
    router.start(1, 30, 30, 'pause');
    feed.poll();
    expect(feed.pressed('pause')).toBe(true);
    expect(feed.held('pause')).toBe(false);
    router.end(1);
    feed.poll();
    expect(feed.pressed('pause')).toBe(false);
  });

  it('back is the pause action, which is what menus read as "back"', () => {
    const { feed, router } = setup();
    router.start(1, 800, 30, 'back');
    feed.poll();
    expect(feed.pressed('pause')).toBe(true);
  });

  it('aim latches: tap on, tap off, with the finger free in between', () => {
    const { feed, down, router } = setup();
    router.start(1, 700, 250, 'aim');
    router.end(1);
    expect(feed.held('aim')).toBe(true);
    expect(down.has('aim')).toBe(true);
    router.start(2, 700, 250, 'aim');
    router.end(2);
    expect(feed.held('aim')).toBe(false);
    expect(down.has('aim')).toBe(false);
  });

  it('dragging a finger that is holding fire also turns the camera', () => {
    const { feed, router } = setup();
    router.start(1, 780, 290, 'fire');
    router.move(1, 760, 280);
    feed.poll();
    expect(feed.held('fire')).toBe(true);
    expect(feed.lookX).toBe(-20);
    expect(feed.lookY).toBe(-10);
    // …but dragging on jump does not.
    router.start(2, 700, 330, 'jump');
    router.move(2, 650, 330);
    feed.poll();
    expect(feed.lookX).toBe(0);
  });

  it('pedals are axes, and a thumb slides from one to the other without lifting', () => {
    const { feed, down, router } = setup();
    router.start(1, 790, 300, 'gas');
    expect([feed.throttle, feed.brake]).toEqual([1, 0]);
    router.move(1, 700, 300);
    expect([feed.throttle, feed.brake]).toEqual([0, 1]);
    expect(down.has('brake') && !down.has('gas')).toBe(true);
    // Off both pedals: keep braking rather than drop it under a sloppy thumb.
    router.move(1, 600, 200);
    expect(feed.brake).toBe(1);
    router.end(1);
    expect([feed.throttle, feed.brake]).toEqual([0, 0]);
  });
});

describe('TouchRouter: mode changes', () => {
  it('in a car the stick only steers, with the steering curve, and never sprints', () => {
    const { feed, router } = setup();
    router.setDriving(true);
    router.start(1, 150, 250, null);
    router.move(1, 150 - STICK_RADIUS, 250 - STICK_RADIUS);
    expect(feed.moveZ).toBe(0);
    expect(feed.held('sprint')).toBe(false);
    expect(feed.moveX).toBeGreaterThan(0);
    expect(feed.moveX).toBeCloseTo(steerCurve(Math.SQRT1_2));
    router.end(1);
    router.start(2, 150, 250, null);
    router.move(2, 150 - STICK_RADIUS * 3, 250);
    expect(feed.moveX).toBeCloseTo(1);
    router.move(2, 150 + STICK_RADIUS * 3, 250);
    expect(feed.moveX).toBeCloseTo(-1);
  });

  it('getting into a car with the stick held switches it to steering there and then', () => {
    const { feed, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150, 250 - STICK_RADIUS);
    expect(feed.held('sprint')).toBe(true);
    router.setDriving(true);
    expect(feed.moveZ).toBe(0);
    expect(feed.held('sprint')).toBe(false);
  });

  it('a button that is hidden lets go, and a hidden toggle switches off', () => {
    const { feed, down, router } = setup();
    router.start(1, 790, 300, 'gas');
    router.start(2, 700, 250, 'aim');
    router.end(2);
    router.sync(new Set<ButtonId>(['pause', 'map', 'camera', 'jump', 'fire']));
    expect(feed.throttle).toBe(0);
    expect(feed.held('aim')).toBe(false);
    expect(down.size).toBe(0);
    // The finger that was on the pedal is still down; it just looks around now.
    router.move(1, 800, 300);
    feed.poll();
    expect(feed.lookX).toBe(10);
  });

  it('cancelAll lets go of everything', () => {
    const { feed, down, stick, router } = setup();
    router.start(1, 150, 250, null);
    router.move(1, 150, 150);
    router.start(2, 780, 290, 'fire');
    router.start(3, 700, 250, 'aim');
    router.cancelAll();
    feed.poll();
    expect(router.touches).toBe(0);
    expect(feed.held('fire') || feed.held('aim') || feed.held('sprint') || feed.pressed('fire')).toBe(false);
    expect([feed.moveX, feed.moveZ]).toEqual([0, 0]);
    expect(stick.on).toBe(false);
    expect(down.size).toBe(0);
  });
});
