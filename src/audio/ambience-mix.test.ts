import { describe, expect, it } from 'vitest';
import { activity, ambienceMix, chorus, gust, surfEnvelope, type AmbienceInput } from './ambience-mix';

const base: AmbienceInput = { district: 'rural', hour: 12, night: 0, rain: 0, wind: 4, weather: 'clear', coast: 0, inVehicle: false, speed: 0 };
const mix = (o: Partial<AmbienceInput>) => ambienceMix({ ...base, ...o });

describe('ambience mix', () => {
  it('the city hums and the plains do not', () => {
    expect(mix({ district: 'cbd' }).city).toBeGreaterThan(mix({ district: 'rural' }).city * 10);
    expect(mix({ district: 'cbd' }).traffic).toBeGreaterThan(mix({ district: 'villa' }).traffic);
    expect(mix({ district: 'cbd', hour: 3, night: 1 }).traffic).toBeLessThan(mix({ district: 'cbd' }).traffic * 0.3);
    expect(mix({ district: 'cbd' }).carPass).toBeGreaterThan(0);
  });

  it('birds by day, crickets and moreporks by night', () => {
    const day = mix({ district: 'park' });
    const night = mix({ district: 'park', hour: 23, night: 1 });
    expect(day.bellbirds).toBeGreaterThan(0);
    expect(day.crickets).toBe(0);
    expect(day.moreporks).toBe(0);
    expect(night.bellbirds).toBe(0);
    expect(night.chirps).toBe(0);
    expect(night.magpies).toBe(0);
    expect(night.crickets).toBeGreaterThan(0);
    expect(night.moreporks).toBeGreaterThan(0);
  });

  it('magpies and sheep belong to the country, gulls to the coast', () => {
    expect(mix({ district: 'rural' }).magpies).toBeGreaterThan(mix({ district: 'cbd' }).magpies);
    expect(mix({ district: 'cbd' }).sheep).toBe(0);
    expect(mix({ district: 'rural' }).sheep).toBeGreaterThan(0);
    expect(mix({ district: 'rural' }).gulls).toBe(0);
    expect(mix({ district: 'rural', coast: 1 }).gulls).toBeGreaterThan(0);
    expect(mix({ district: 'beach', coast: 1 }).gulls).toBeGreaterThan(mix({ district: 'beach', coast: 0 }).gulls);
  });

  it('the dawn chorus is the loudest part of the day', () => {
    expect(chorus(6.5)).toBeGreaterThan(chorus(13) * 2);
    expect(mix({ district: 'park', hour: 6.5 }).bellbirds).toBeGreaterThan(mix({ district: 'park', hour: 13 }).bellbirds * 2);
    expect(activity(3)).toBeLessThan(0.2);
    expect(activity(12)).toBeGreaterThan(0.9);
  });

  it('surf needs a coast; rain needs rain; and rain shuts the birds up', () => {
    expect(mix({}).surf).toBe(0);
    expect(mix({ district: 'beach', coast: 1 }).surf).toBeGreaterThan(0.3);
    expect(mix({}).rainHiss).toBe(0);
    const wet = mix({ rain: 0.85, weather: 'southerly', wind: 11, district: 'villa' });
    expect(wet.rainHiss).toBeGreaterThan(0.2);
    expect(wet.rainPatter).toBeGreaterThan(0.2);
    expect(wet.bellbirds).toBe(0);
    expect(wet.roof).toBe(0);
    const inCar = mix({ rain: 0.85, inVehicle: true });
    expect(inCar.roof).toBeGreaterThan(0.3);
    expect(inCar.rainHiss).toBeLessThan(wet.rainHiss);
  });

  it("a nor'wester is a dry rushing wind, with singing wires on the plains", () => {
    const calm = mix({ wind: 4 });
    const nw = mix({ wind: 15, weather: 'norwester' });
    const southerly = mix({ wind: 15, weather: 'southerly' });
    expect(nw.windLow).toBeGreaterThan(calm.windLow * 3);
    expect(nw.windHigh).toBeGreaterThan(southerly.windHigh * 2);
    expect(nw.wires).toBeGreaterThan(0.3);
    expect(calm.wires).toBe(0);
    expect(mix({ wind: 15, district: 'cbd' }).wires).toBeLessThan(nw.wires);
  });

  it('a closed car at speed hides most of it', () => {
    const out = mix({ district: 'shops' });
    const cabin = mix({ district: 'shops', inVehicle: true, speed: 30 });
    expect(cabin.city).toBeLessThan(out.city * 0.4);
    expect(cabin.chirps).toBeLessThan(out.chirps);
  });

  it('never produces a negative or absurd level', () => {
    const districts = ['cbd', 'shops', 'villa', 'statehouse', 'industrial', 'port', 'township', 'park', 'rural', 'beach'] as const;
    for (const district of districts) {
      for (const hour of [0, 6, 12, 18, 23.9]) {
        for (const weather of ['clear', 'norwester', 'southerly', 'fog', 'overcast'] as const) {
          const m = mix({ district, hour, night: hour < 6 || hour > 20 ? 1 : 0, weather, rain: weather === 'southerly' ? 0.85 : 0, wind: weather === 'norwester' ? 15 : 4, coast: 0.5, inVehicle: hour === 12 });
          for (const [key, value] of Object.entries(m)) {
            expect(Number.isFinite(value), key).toBe(true);
            expect(value, key).toBeGreaterThanOrEqual(0);
            expect(value, key).toBeLessThan(0.8);
          }
        }
      }
    }
  });

  it('waves gather, break and hiss away; gusts wander around one', () => {
    expect(surfEnvelope(0.3)).toBeCloseTo(1, 5);
    expect(surfEnvelope(0)).toBeLessThan(0.2);
    expect(surfEnvelope(0.99)).toBeLessThan(0.25);
    for (let p = 0; p < 1; p += 0.01) {
      expect(surfEnvelope(p)).toBeGreaterThan(0);
      expect(surfEnvelope(p)).toBeLessThanOrEqual(1);
    }
    let sum = 0;
    for (let t = 0; t < 600; t += 0.1) {
      const g = gust(t);
      expect(g).toBeGreaterThan(0.39);
      expect(g).toBeLessThan(1.61);
      sum += g;
    }
    expect(sum / 6000).toBeCloseTo(1, 1);
  });
});
