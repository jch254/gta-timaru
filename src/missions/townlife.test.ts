import { describe, expect, it } from 'vitest';
import { weekday, weekendNight } from '../core/calendar';
import { clubNight, cornerNight, shopOpen, tyreShow } from './townlife';

// Day 1 is a Friday (the story opens on one), so 2 is Saturday, 3 Sunday, 4 Monday.
describe('the week in town', () => {
  it('counts the days the way the HUD does', () => {
    expect(weekday(1)).toBe(4);
    expect(weekday(2)).toBe(5);
    expect(weekday(3)).toBe(6);
    expect(weekday(4)).toBe(0);
    expect(weekday(8)).toBe(4);
  });

  it('keeps 1995 shop hours, with late night on Friday', () => {
    expect(shopOpen(8.5, 4)).toBe(false);
    expect(shopOpen(10, 4)).toBe(true);
    expect(shopOpen(18, 4)).toBe(false);
    expect(shopOpen(20, 1)).toBe(true);
    expect(shopOpen(21.5, 1)).toBe(false);
    expect(shopOpen(15, 2)).toBe(true);
    expect(shopOpen(16.5, 2)).toBe(false);
    expect(shopOpen(9.5, 3)).toBe(false);
    expect(shopOpen(11, 3)).toBe(true);
  });

  it('opens the club and fills the corner on Friday and Saturday nights only', () => {
    expect(weekendNight(22, 1)).toBe(true);
    expect(clubNight(22, 1)).toBe(true);
    expect(clubNight(1, 2)).toBe(true); // the small hours of Saturday belong to Friday night
    expect(clubNight(22, 2)).toBe(true);
    expect(clubNight(2, 3)).toBe(true);
    expect(clubNight(22, 3)).toBe(false); // Sunday
    expect(clubNight(22, 6)).toBe(false); // Wednesday
    expect(clubNight(20, 1)).toBe(false);
    expect(clubNight(3.5, 2)).toBe(false);
    expect(cornerNight(21, 1)).toBe(false);
    expect(cornerNight(23, 1)).toBe(true);
    expect(cornerNight(2.6, 2)).toBe(false);
  });

  it('sees a burnout or a slide, not ordinary driving', () => {
    expect(tyreShow({ speed: 0.5, slip: 0, wheelsOnGround: 4, wheelspin: 1 })).toBe(1);
    expect(tyreShow({ speed: 12, slip: 0.1, wheelsOnGround: 4 })).toBe(0);
    expect(tyreShow({ speed: 10, slip: 0.9, wheelsOnGround: 4 })).toBe(1);
    expect(tyreShow({ speed: 30, slip: 0.9, wheelsOnGround: 4 })).toBe(0);
    expect(tyreShow({ speed: 0, slip: 0, wheelsOnGround: 0, wheelspin: 1 })).toBe(0);
  });
});
