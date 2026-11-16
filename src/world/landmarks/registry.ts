import type { ChunkBuilder, LandmarkBuilder, LandmarkPlacement } from '../../core/types';

/**
 * Bespoke landmark builders keyed by `LandmarkPlacement.kind`.
 * Register from your own folder: `LANDMARKS['chch-cathedral'] = (placement, out) => { … }`.
 */
export const LANDMARKS: Record<string, LandmarkBuilder> = {};

/** Run a builder to completion in one go (loading screens, tools, tests): a sliceable one is exhausted. */
export function runLandmark(builder: LandmarkBuilder, placement: LandmarkPlacement, out: ChunkBuilder): void {
  const r = builder(placement, out);
  if (r) while (!r.next().done);
}
