import { describe, expect, it } from 'vitest';
import {
  bilingual,
  cityName,
  cityTeReo,
  compactCount,
  conditionWord,
  featureTeReo,
  formatClock,
  formatDelta,
  formatMoney,
  formatTimer,
  groupThousands,
  locationLines,
  minuteOfDay,
  parsePrompt,
  plateDigits,
  subtitleSeconds,
  toKmh,
  weekdayName,
} from './format';

describe('money', () => {
  it('groups thousands', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(999)).toBe('999');
    expect(groupThousands(1000)).toBe('1,000');
    expect(groupThousands(12345)).toBe('12,345');
    expect(groupThousands(1234567)).toBe('1,234,567');
    expect(groupThousands(-2500)).toBe('2,500');
    expect(groupThousands(Number.NaN)).toBe('0');
  });

  it('formats NZ dollars', () => {
    expect(formatMoney(0)).toBe('NZ$0');
    expect(formatMoney(1250)).toBe('NZ$1,250');
    expect(formatMoney(1250.6)).toBe('NZ$1,251');
    expect(formatMoney(-50)).toBe('−NZ$50');
    expect(formatMoney(1e6)).toBe('NZ$1,000,000');
  });

  it('formats signed changes', () => {
    expect(formatDelta(250)).toBe('+$250');
    expect(formatDelta(-1500)).toBe('−$1,500');
    expect(formatDelta(0)).toBe('+$0');
  });
});

describe('clock', () => {
  it('uses a 12-hour clock with am / pm', () => {
    expect(formatClock(0)).toBe('12:00 am');
    expect(formatClock(0.5)).toBe('12:30 am');
    expect(formatClock(9.5)).toBe('9:30 am');
    expect(formatClock(11.99)).toBe('11:59 am');
    expect(formatClock(12)).toBe('12:00 pm');
    expect(formatClock(12.25)).toBe('12:15 pm');
    expect(formatClock(13.1)).toBe('1:06 pm');
    expect(formatClock(23.999)).toBe('11:59 pm');
  });

  it('wraps at midnight and survives float error', () => {
    expect(formatClock(24)).toBe('12:00 am');
    expect(formatClock(25.5)).toBe('1:30 am');
    expect(minuteOfDay(9 + 30 / 60 - 1e-9)).toBe(570);
    expect(minuteOfDay(-1)).toBe(23 * 60);
  });

  it('names weekdays from the day counter (day 1 is a Friday)', () => {
    expect(weekdayName(1)).toBe('Friday');
    expect(weekdayName(2)).toBe('Saturday');
    expect(weekdayName(3)).toBe('Sunday');
    expect(weekdayName(4)).toBe('Monday');
    expect(weekdayName(8)).toBe('Friday');
    expect(weekdayName(1, true)).toBe('Fri');
    expect(weekdayName(0)).toBe('Thursday');
  });
});

describe('timer', () => {
  it('shows m:ss, rounding up', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(0.2)).toBe('0:01');
    expect(formatTimer(4.2)).toBe('0:05');
    expect(formatTimer(59)).toBe('0:59');
    expect(formatTimer(60)).toBe('1:00');
    expect(formatTimer(75)).toBe('1:15');
    expect(formatTimer(600)).toBe('10:00');
  });

  it('adds hours when needed and never goes negative', () => {
    expect(formatTimer(3700)).toBe('1:01:40');
    expect(formatTimer(-3)).toBe('0:00');
    expect(formatTimer(Number.NaN)).toBe('0:00');
  });
});

describe('prompt keycaps', () => {
  it('takes the token before two spaces as the key', () => {
    expect(parsePrompt('F  Nick the ute')).toEqual({ keys: ['F'], text: 'Nick the ute' });
    expect(parsePrompt('Space  Handbrake')).toEqual({ keys: ['Space'], text: 'Handbrake' });
    expect(parsePrompt('D-up  Change camera')).toEqual({ keys: ['D-up'], text: 'Change camera' });
  });

  it('splits several keys', () => {
    expect(parsePrompt('A / D  Steer')).toEqual({ keys: ['A', 'D'], text: 'Steer' });
    expect(parsePrompt('Shift+F  Shove')).toEqual({ keys: ['Shift', 'F'], text: 'Shove' });
  });

  it('leaves plain sentences alone', () => {
    expect(parsePrompt('Get to the chip shop')).toEqual({ keys: [], text: 'Get to the chip shop' });
    expect(parsePrompt('Wait for the lights to change  then go')).toEqual({ keys: [], text: 'Wait for the lights to change  then go' });
    expect(parsePrompt('F  ')).toEqual({ keys: [], text: 'F' });
    expect(parsePrompt('  Hello')).toEqual({ keys: [], text: 'Hello' });
    expect(parsePrompt('')).toEqual({ keys: [], text: '' });
  });
});

describe('places and misc', () => {
  it('names towns', () => {
    expect(cityName('christchurch')).toBe('Christchurch');
    expect(cityName('newbrighton')).toBe('New Brighton');
    expect(cityName(null)).toBe('Canterbury');
  });

  it('builds the location lines without repeats, with te reo names alongside', () => {
    expect(locationLines('Colombo Street', 'Central City', 'christchurch')).toEqual({ title: 'Colombo Street', sub: 'Central City · Christchurch · Ōtautahi', teReo: '' });
    expect(locationLines('Sydenham', 'Sydenham', 'christchurch')).toEqual({ title: 'Sydenham', sub: 'Christchurch · Ōtautahi', teReo: '' });
    expect(locationLines('Timaru', 'Timaru', 'timaru')).toEqual({ title: 'Timaru', sub: 'Te Tihi-o-Maru', teReo: '' });
    expect(locationLines('Stafford Street', 'Timaru', 'timaru')).toEqual({ title: 'Stafford Street', sub: 'Timaru · Te Tihi-o-Maru', teReo: '' });
    expect(locationLines('Seaview Road', 'New Brighton', 'newbrighton')).toEqual({ title: 'Seaview Road', sub: 'New Brighton', teReo: '' });
  });

  it('shows the te reo name of a suburb or feature as its own line', () => {
    expect(locationLines('State Highway 1', 'Canterbury Plains', null)).toEqual({
      title: 'State Highway 1',
      sub: 'Canterbury Plains · Canterbury',
      teReo: 'Kā Pākihi-whakatekateka-a-Waitaha',
    });
    expect(locationLines('Summit Road', 'Port Hills', 'christchurch').teReo).toBe('Ngā Kōhatu Whakarakaraka o Tamatea Pōkai Whenua');
    // The map's own name wins over the shared list, and is not repeated if it is the town's name.
    expect(locationLines('Pages Road', 'Aranui', 'christchurch', 'Test Name').teReo).toBe('Test Name');
    expect(locationLines('King Street', 'Temuka', 'temuka', 'Te Umu Kaha')).toEqual({ title: 'King Street', sub: 'Temuka · Te Umu Kaha', teReo: '' });
  });

  it('keeps macrons intact', () => {
    expect(cityTeReo('christchurch')).toBe('Ōtautahi');
    expect(cityTeReo('christchurch').charCodeAt(0)).toBe(0x14c);
    expect(cityTeReo('rakaia')).toBe('');
    expect(cityTeReo(null)).toBe('');
    expect(bilingual('Christchurch', cityTeReo('christchurch'))).toBe('Christchurch · Ōtautahi');
    expect(bilingual('Rakaia', '')).toBe('Rakaia');
    expect(bilingual('Hakatere', 'Hakatere')).toBe('Hakatere');
    expect(featureTeReo('Avon River')).toBe('Ōtākaro');
    expect(featureTeReo('Avon River', 'Own')).toBe('Own');
    expect(featureTeReo('Nowhere')).toBe('');
  });

  it('picks subtitle durations within limits', () => {
    expect(subtitleSeconds('Oi.')).toBe(2.2);
    expect(subtitleSeconds('x'.repeat(40))).toBeCloseTo(3.6);
    expect(subtitleSeconds('x'.repeat(400))).toBe(7);
  });

  it('formats speed for the plate', () => {
    expect(toKmh(0)).toBe(0);
    expect(toKmh(27.78)).toBe(100);
    expect(toKmh(-10)).toBe(36);
    expect(plateDigits(7)).toBe('007');
    expect(plateDigits(64)).toBe('064');
    expect(plateDigits(123)).toBe('123');
    expect(plateDigits(4000)).toBe('999');
  });

  it('describes vehicle condition', () => {
    expect(conditionWord(1, false)).toBe('Sweet as');
    expect(conditionWord(0.6, false)).toBe('Bit rough');
    expect(conditionWord(0.3, false)).toBe('Pretty rough');
    expect(conditionWord(0.1, false)).toBe('Munted');
    expect(conditionWord(0.9, true)).toBe('On fire');
  });

  it('compacts big counts', () => {
    expect(compactCount(312)).toBe('312');
    expect(compactCount(1500)).toBe('1.5k');
    expect(compactCount(540000)).toBe('540k');
    expect(compactCount(1234567)).toBe('1.2M');
  });
});
