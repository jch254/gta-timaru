import type { Scatterer } from '../../core/types';

/**
 * Ambient detail generators, run once per chunk after buildings and landmarks.
 * Register from your own file: `SCATTERERS.push((area, out) => { … })`.
 */
export const SCATTERERS: Scatterer[] = [];
