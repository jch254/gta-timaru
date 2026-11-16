import { describe, expect, it } from 'vitest';
import { TouchFeed } from './feed';

describe('TouchFeed presses and releases', () => {
  it('a button going down is held at once and pressed for exactly the next frame', () => {
    const feed = new TouchFeed();
    feed.hold('jump', true);
    expect(feed.held('jump')).toBe(true);
    // Not until the frame starts: events arrive between frames, like key events.
    expect(feed.pressed('jump')).toBe(false);
    feed.poll();
    expect(feed.pressed('jump')).toBe(true);
    expect(feed.held('jump')).toBe(true);
    feed.poll();
    expect(feed.pressed('jump')).toBe(false);
    expect(feed.held('jump')).toBe(true);
    feed.hold('jump', false);
    expect(feed.held('jump')).toBe(false);
    feed.poll();
    expect(feed.pressed('jump')).toBe(false);
  });

  it('a tap that starts and ends between two frames still counts as one press', () => {
    const feed = new TouchFeed();
    feed.hold('interact', true);
    feed.hold('interact', false);
    feed.poll();
    expect(feed.pressed('interact')).toBe(true);
    expect(feed.held('interact')).toBe(false);
    feed.poll();
    expect(feed.pressed('interact')).toBe(false);
  });

  it('holding down again while already down is not a second press', () => {
    const feed = new TouchFeed();
    feed.hold('horn', true);
    feed.poll();
    feed.hold('horn', true);
    feed.poll();
    expect(feed.pressed('horn')).toBe(false);
    expect(feed.held('horn')).toBe(true);
  });

  it('press() gives an edge with nothing held', () => {
    const feed = new TouchFeed();
    feed.press('pause');
    feed.poll();
    expect(feed.pressed('pause')).toBe(true);
    expect(feed.held('pause')).toBe(false);
  });

  it('a press queued during a frame is kept for the next one', () => {
    const feed = new TouchFeed();
    feed.poll();
    feed.press('fire');
    expect(feed.pressed('fire')).toBe(false);
    feed.poll();
    expect(feed.pressed('fire')).toBe(true);
  });

  it('poll reports whether the controller was touched since the last one', () => {
    const feed = new TouchFeed();
    expect(feed.poll()).toBe(false);
    feed.look(1, 0);
    expect(feed.poll()).toBe(true);
    expect(feed.poll()).toBe(false);
    feed.pedal('throttle', 1);
    expect(feed.poll()).toBe(true);
    feed.stick(0, 1);
    expect(feed.poll()).toBe(true);
  });
});

describe('TouchFeed axes and look', () => {
  it('adds up the look drag between frames and hands it over once', () => {
    const feed = new TouchFeed();
    feed.look(4, -2);
    feed.look(6, -3);
    feed.poll();
    expect(feed.lookX).toBe(10);
    expect(feed.lookY).toBe(-5);
    feed.poll();
    expect(feed.lookX).toBe(0);
    expect(feed.lookY).toBe(0);
  });

  it('keeps the stick and pedals until they are let go', () => {
    const feed = new TouchFeed();
    feed.stick(-0.5, 1);
    feed.pedal('throttle', 1);
    feed.poll();
    feed.poll();
    expect([feed.moveX, feed.moveZ, feed.throttle, feed.brake]).toEqual([-0.5, 1, 1, 0]);
    feed.pedal('throttle', 0);
    feed.pedal('brake', 1);
    expect([feed.throttle, feed.brake]).toEqual([0, 1]);
  });

  it('releaseAll lets go of everything, queued presses included', () => {
    const feed = new TouchFeed();
    feed.hold('fire', true);
    feed.hold('handbrake', true);
    feed.stick(1, 1);
    feed.pedal('brake', 1);
    feed.look(30, 30);
    feed.releaseAll();
    feed.poll();
    expect(feed.held('fire') || feed.held('handbrake') || feed.pressed('fire')).toBe(false);
    expect([feed.moveX, feed.moveZ, feed.throttle, feed.brake, feed.lookX, feed.lookY]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('TouchFeed hold-to-repeat', () => {
  const frames = (feed: TouchFeed, seconds: number, dt = 1 / 60) => {
    let presses = 0;
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      feed.poll();
      if (feed.pressed('fire')) presses++;
      feed.tick(dt);
    }
    return presses;
  };

  it('presses again at the interval for as long as the button is held', () => {
    const feed = new TouchFeed();
    feed.repeat('fire', 0.25);
    feed.hold('fire', true);
    // The landing press, then one every quarter second.
    expect(frames(feed, 1.1)).toBe(5);
    feed.hold('fire', false);
    expect(frames(feed, 1)).toBe(0);
  });

  it('starts the interval afresh on each new hold', () => {
    const feed = new TouchFeed();
    feed.repeat('fire', 0.5);
    feed.hold('fire', true);
    expect(frames(feed, 0.4)).toBe(1);
    feed.hold('fire', false);
    feed.hold('fire', true);
    // 0.4 s into the new hold: only the landing press, not a repeat left over from the last one.
    expect(frames(feed, 0.4)).toBe(1);
  });

  it('does nothing unless asked, and stops when switched off', () => {
    const feed = new TouchFeed();
    feed.hold('fire', true);
    expect(frames(feed, 1)).toBe(1);
    feed.repeat('fire', 0.2);
    expect(frames(feed, 0.5)).toBe(2);
    feed.repeat('fire', 0);
    expect(frames(feed, 1)).toBe(0);
  });

  it('a long frame gives one repeat, not a burst', () => {
    const feed = new TouchFeed();
    feed.repeat('fire', 0.1);
    feed.hold('fire', true);
    feed.poll();
    feed.tick(1);
    feed.poll();
    expect(feed.pressed('fire')).toBe(true);
    feed.tick(0.01);
    feed.poll();
    expect(feed.pressed('fire')).toBe(false);
  });
});

describe('TouchFeed slow frames and labels', () => {
  it('hides presses from the later slices of a slow frame and brings them back for the late update', () => {
    const feed = new TouchFeed();
    feed.press('interact');
    feed.hold('aim', true);
    feed.poll();
    feed.suspend();
    expect(feed.pressed('interact')).toBe(false);
    // Holds are not edges: they stay.
    expect(feed.held('aim')).toBe(true);
    feed.suspend();
    feed.resume();
    expect(feed.pressed('interact')).toBe(true);
    feed.resume();
    expect(feed.pressed('interact')).toBe(true);
    feed.poll();
    expect(feed.pressed('interact')).toBe(false);
  });

  it('names buttons for prompts, and keeps quiet while labels are off', () => {
    const feed = new TouchFeed();
    expect(feed.label('interact')).toBeUndefined();
    feed.setLabel('interact', 'USE');
    expect(feed.label('interact')).toBe('USE');
    feed.labelsOn = false;
    expect(feed.label('interact')).toBeUndefined();
    feed.labelsOn = true;
    feed.setLabel('interact', null);
    expect(feed.label('interact')).toBeUndefined();
  });
});
