import type { QualityLevel } from '../core/types';

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
  /** Near (full-detail) chunk radius, in chunks. */
  chunkRadius: number;
  /** Multiplier for instanced vegetation / small props. */
  propDensity: number;
  /** Max simultaneous dynamic point lights at night. */
  pointLights: number;
  /** Seconds between image-based-lighting refreshes. */
  envInterval: number;
  rainDrops: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1, cascades: 1, shadowMapSize: 1024, shadowFar: 90, ao: 'off', aoSamples: 0, bloom: false, smaa: false, chunkRadius: 2, propDensity: 0.4, pointLights: 2, envInterval: 30, rainDrops: 1200 },
  medium: { pixelRatio: 1, cascades: 2, shadowMapSize: 1024, shadowFar: 150, ao: 'half', aoSamples: 8, bloom: true, smaa: true, chunkRadius: 3, propDensity: 0.7, pointLights: 4, envInterval: 12, rainDrops: 2500 },
  high: { pixelRatio: 1.5, cascades: 3, shadowMapSize: 2048, shadowFar: 240, ao: 'half', aoSamples: 16, bloom: true, smaa: true, chunkRadius: 4, propDensity: 1, pointLights: 6, envInterval: 6, rainDrops: 4000 },
  ultra: { pixelRatio: 2, cascades: 4, shadowMapSize: 2048, shadowFar: 340, ao: 'full', aoSamples: 16, bloom: true, smaa: true, chunkRadius: 5, propDensity: 1.3, pointLights: 8, envInterval: 4, rainDrops: 6000 },
};
