import type { LandmarkBuilder } from '../../core/types';

/**
 * Bespoke landmark builders keyed by `LandmarkPlacement.kind`.
 * Register from your own folder: `LANDMARKS['chch-cathedral'] = (placement, out) => { … }`.
 */
export const LANDMARKS: Record<string, LandmarkBuilder> = {};
