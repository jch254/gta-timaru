import { clamp } from './math';
import type { RoadEdge } from './types';

/** Offset of a lane centre from the centreline, positive = left of the direction of travel. Lane 0 is kerb-side.
 *  Keep left: two-way roads use their own half of the carriageway; one-way roads spread lanes across the whole width.
 *  The one formula behind RoadGraph.lanePoint and the AI's allocation-free lane maths. */
export function laneOffset(edge: RoadEdge, lane: number): number {
  const lanes = Math.max(1, edge.lanes);
  const k = clamp(lane, 0, lanes - 1);
  const laneWidth = edge.width / (lanes * 2);
  // One-way: the whole carriageway is split into `lanes` lanes.
  if (edge.oneway) return (lanes - 1 - 2 * k) * laneWidth;
  return (lanes - 0.5 - k) * laneWidth;
}

/** The footpath centreline sits this far beyond the carriageway edge, as the road mesher builds it.
 *  The graph's footpathPoint, the peds' walk offset and mission verge spots all stand on it. */
export const FOOTPATH_OFFSET = 1.7;
