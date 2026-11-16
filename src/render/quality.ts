import type { QualityLevel } from '../core/types';
import { deviceHints, isPhone } from '../core/device';

export interface QualityPreset {
  /** Max device pixel ratio. */
  pixelRatio: number;
  /** Shadow cascades, map size and far distance (m). */
  cascades: number;
  shadowMapSize: number;
  shadowFar: number;
  ao: 'off' | 'half' | 'full';
  aoSamples: number;
  bloom: boolean;
  smaa: boolean;
  /** Anti-aliasing effort where `smaa` is on: how far along an edge it searches. */
  smaaPreset: 'medium' | 'high' | 'ultra';
  /** Slices the cloud slab is read in (three texture reads each): more gives the clouds undersides and sides. */
  cloudSteps: number;
  /** The haze lights up towards the sun. */
  airSun: boolean;
  /** Cloud shadows cross the ground (one texture read per pixel). */
  cloudShadows: boolean;
  /** Coloured film grain; off leaves the grade in its cheapest form (the grain is then one tone). */
  filmFull: boolean;
  /** Strength of the sharpening pass (one extra full-screen pass), 0 = no pass. */
  sharpen: number;
  /** Near (full-detail) chunk radius, in chunks. */
  chunkRadius: number;
  /** Multiplier for instanced vegetation / small props. */
  propDensity: number;
  /** Max simultaneous dynamic point lights at night. */
  pointLights: number;
  /** Seconds between image-based-lighting refreshes. */
  envInterval: number;
  rainDrops: number;
  /** Shadow filtering: 'soft' is the wide filter, 'plain' the cheap four-tap one. */
  shadowFilter: 'soft' | 'plain';
  /** How far dynamic resolution may take the render scale down (a fraction of `pixelRatio`). */
  minScale: number;
  /** Multiplier on the distances at which plants, vehicles and figures switch to their cheap versions. */
  detailRange: number;
  /** Multiplier on how many pedestrians and vehicles the ambient population keeps alive. */
  crowd: number;
  /** Highest texture anisotropy asked for. */
  anisotropy: number;
}

const DESKTOP = { shadowFilter: 'soft', minScale: 0.55, detailRange: 1, crowd: 1, anisotropy: 8 } as const;

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { ...DESKTOP, pixelRatio: 1, cascades: 1, shadowMapSize: 1024, shadowFar: 90, ao: 'off', aoSamples: 0, bloom: false, smaa: false, smaaPreset: 'medium', cloudSteps: 1, airSun: false, cloudShadows: false, filmFull: false, sharpen: 0, chunkRadius: 2, propDensity: 0.4, pointLights: 2, envInterval: 30, rainDrops: 1200 },
  medium: { ...DESKTOP, pixelRatio: 1, cascades: 2, shadowMapSize: 1024, shadowFar: 150, ao: 'half', aoSamples: 8, bloom: true, smaa: true, smaaPreset: 'medium', cloudSteps: 2, airSun: true, cloudShadows: true, filmFull: true, sharpen: 0, chunkRadius: 3, propDensity: 0.7, pointLights: 4, envInterval: 12, rainDrops: 2500 },
  high: { ...DESKTOP, pixelRatio: 1.5, cascades: 3, shadowMapSize: 2048, shadowFar: 240, ao: 'half', aoSamples: 16, bloom: true, smaa: true, smaaPreset: 'high', cloudSteps: 4, airSun: true, cloudShadows: true, filmFull: true, sharpen: 0.4, chunkRadius: 4, propDensity: 1, pointLights: 6, envInterval: 6, rainDrops: 4000 },
  ultra: { ...DESKTOP, pixelRatio: 2, cascades: 4, shadowMapSize: 2048, shadowFar: 340, ao: 'full', aoSamples: 16, bloom: true, smaa: true, smaaPreset: 'ultra', cloudSteps: 6, airSun: true, cloudShadows: true, filmFull: true, sharpen: 0.4, chunkRadius: 5, propDensity: 1.3, pointLights: 8, envInterval: 4, rainDrops: 6000 },
};

/**
 * What changes on a phone. The levels were tuned on Apple-silicon laptops, where one rendered pixel per CSS
 * pixel is sharp enough; on a 3x phone screen it is a visibly blocky picture, and a phone has a fraction of
 * the fill rate, memory and CPU. So a phone's Low is a tier of its own: up to two rendered pixels per CSS
 * pixel (1688 x 780 on an iPhone 14, about two thirds of the pixels of a 1080p laptop frame) with dynamic
 * resolution free to take that down to 1.2; one shadow map over the nearest 55 m with the cheap filter, which
 * still grounds cars and people; no ambient occlusion, bloom or anti-aliasing pass (Low never had them), the
 * film grade kept because it shares the one full-screen pass with the tone map; a shorter detailed radius;
 * cheap versions of plants, cars and figures from 60 % of the usual distances; half the crowd. The other
 * levels only get the sharper pixel ratio: somebody who asks a phone for High gets High.
 */
const PHONE: Record<QualityLevel, Partial<QualityPreset>> = {
  low: { pixelRatio: 2, minScale: 0.6, shadowFar: 55, shadowFilter: 'plain', chunkRadius: 1.5, detailRange: 0.6, crowd: 0.5, pointLights: 2, envInterval: 60, rainDrops: 800, anisotropy: 2 },
  medium: { pixelRatio: 1.5, minScale: 0.6, shadowFilter: 'plain', anisotropy: 4 },
  high: { pixelRatio: 1.75, minScale: 0.6, anisotropy: 4 },
  ultra: { pixelRatio: 2, minScale: 0.6, anisotropy: 4 },
};

let phone: boolean | null = null;
/** Whether this is a phone (asked once; see `src/core/device.ts`). */
export const onPhone = () => (phone ??= isPhone(deviceHints()));

/** The preset for a level on this device. */
export function presetFor(level: QualityLevel, isAPhone = onPhone()): QualityPreset {
  if (!isAPhone) return QUALITY[level];
  return (phonePresets[level] ??= { ...QUALITY[level], ...PHONE[level] });
}
const phonePresets: Partial<Record<QualityLevel, QualityPreset>> = {};
