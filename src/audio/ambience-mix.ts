/**
 * What the world should sound like where the player is standing: bed levels and how often the wildlife pipes up.
 * Pure function of place, hour and weather, so it can be unit-tested; ambience.ts smooths towards these targets.
 */
import type { DistrictType, WeatherKind } from '../core/types';

export interface AmbienceInput {
  district: DistrictType;
  /** 0..24 */
  hour: number;
  /** 0 = day, 1 = night. */
  night: number;
  /** 0..1 */
  rain: number;
  /** Wind speed, m/s. */
  wind: number;
  weather: WeatherKind;
  /** 0 = inland, 1 = at the water's edge (sea or harbour). */
  coast: number;
  inVehicle: boolean;
  /** Player speed, m/s. */
  speed: number;
}

export interface AmbienceMix {
  // Bed gains (linear, applied to noise sources of RMS ≈ 0.25).
  city: number;
  traffic: number;
  windLow: number;
  windHigh: number;
  wires: number;
  rainHiss: number;
  rainPatter: number;
  roof: number;
  surf: number;
  crickets: number;
  // One-shot rates, events per second.
  bellbirds: number;
  chirps: number;
  magpies: number;
  gulls: number;
  sheep: number;
  moreporks: number;
  carPass: number;
}

/** How built-up each district sounds, 0..1. */
const URBAN: Record<DistrictType, number> = {
  cbd: 1,
  shops: 0.8,
  industrial: 0.7,
  port: 0.6,
  statehouse: 0.45,
  villa: 0.4,
  township: 0.35,
  park: 0.2,
  beach: 0.12,
  rural: 0.03,
};

const table = (o: Partial<Record<DistrictType, number>>, d: DistrictType): number => o[d] ?? 0;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 in the small hours, 1 through the working day. */
export function activity(hour: number): number {
  return smooth(5, 8, hour) * (1 - smooth(18.5, 23.5, hour)) * 0.9 + 0.1;
}

/** Birds are loudest around dawn and again towards dusk. */
export function chorus(hour: number): number {
  const dawn = Math.exp(-Math.pow((hour - 6.5) / 1.4, 2));
  const dusk = Math.exp(-Math.pow((hour - 18.5) / 1.6, 2));
  return 1 + 2.2 * dawn + 0.9 * dusk;
}

export function ambienceMix(i: AmbienceInput, out?: AmbienceMix): AmbienceMix {
  const o = out ?? ({} as AmbienceMix);
  const d = i.district;
  const day = 1 - i.night;
  const urban = URBAN[d];
  const busy = activity(i.hour);
  const windN = Math.min(1, i.wind / 16);
  const dry = 1 - Math.min(1, i.rain * 1.5);
  // Inside a car the world is quieter, and at speed it is lost under the road.
  const cabin = i.inVehicle ? 0.5 * (1 - 0.5 * smooth(8, 32, i.speed)) : 1;
  const norwester = i.weather === 'norwester' ? 1 : 0;

  o.city = urban * (0.45 + 0.55 * busy) * 0.3 * cabin;
  o.traffic = urban * busy * 0.22 * cabin;
  o.windLow = (0.03 + 0.34 * Math.pow(windN, 1.3)) * cabin * (d === 'rural' || d === 'beach' ? 1.2 : 0.85);
  // The nor'wester is a dry, rushing wind through shelter belts and long grass.
  o.windHigh = (norwester ? 0.12 + 0.3 * windN : 0.1 * windN * windN) * cabin;
  o.wires = (d === 'rural' || d === 'township' ? 1 : 0.2) * smooth(6, 14, i.wind) * 0.55 * cabin;
  o.rainHiss = i.rain * 0.3 * (i.inVehicle ? 0.5 : 1);
  o.rainPatter = i.rain * 0.3 * (i.inVehicle ? 0.3 : 1);
  o.roof = i.inVehicle ? i.rain * 0.55 : 0;
  o.surf = i.coast * (d === 'port' ? 0.25 : 0.55) * (0.8 + 0.4 * windN) * cabin;
  o.crickets =
    i.night * dry * table({ rural: 1, park: 0.9, township: 0.7, villa: 0.6, statehouse: 0.5, beach: 0.4, shops: 0.15, industrial: 0.15, cbd: 0.08, port: 0.1 }, d) * 0.12 * cabin * (0.85 + 0.3 * norwester);

  const birds = day > 0.5 ? (day - 0.5) * 2 * dry * (i.inVehicle ? 0.35 : 1) * chorus(i.hour) * (1 - 0.6 * smooth(9, 16, i.wind)) : 0;
  o.bellbirds = birds * table({ park: 0.16, villa: 0.1, rural: 0.05, township: 0.07, statehouse: 0.05, beach: 0.02, shops: 0.015, cbd: 0.01 }, d);
  o.chirps = birds * table({ shops: 0.07, villa: 0.1, cbd: 0.05, statehouse: 0.09, township: 0.09, park: 0.08, industrial: 0.04, rural: 0.03 }, d);
  o.magpies = birds * table({ rural: 0.045, township: 0.025, park: 0.025, villa: 0.008, statehouse: 0.008 }, d);
  o.gulls = birds * (i.coast * 0.11 + table({ port: 0.07, beach: 0.08, cbd: 0.006 }, d));
  o.sheep = table({ rural: 1, township: 0.1 }, d) * (0.02 + 0.06 * day) * (i.inVehicle ? 0.5 : 1);
  o.moreporks = i.night > 0.7 ? dry * table({ rural: 0.012, park: 0.016, villa: 0.005, township: 0.006 }, d) : 0;
  o.carPass = urban * busy * 0.09 * (i.inVehicle ? 0.3 : 1);
  return o;
}

/** Shape of one breaking wave over its cycle (phase 0..1): a slow gather, the crash, a long hiss away. */
export function surfEnvelope(phase: number): number {
  if (phase < 0.3) {
    const u = phase / 0.3;
    return 0.15 + 0.85 * u * u;
  }
  return 0.15 + 0.85 * Math.exp(-(phase - 0.3) * 4.2);
}

/** Slow, wandering gust factor around 1 (0.4..1.6) for wind beds. */
export function gust(t: number): number {
  return 1 + 0.3 * Math.sin(t * 0.31) + 0.18 * Math.sin(t * 0.83 + 1.3) + 0.12 * Math.sin(t * 1.9 + 2.1);
}
