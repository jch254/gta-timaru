import { Rng } from '../../core/rng';
import type { ChunkBuilder, DistrictType, Lot } from '../../core/types';
import { CBD } from './cbd';
import { INDUSTRIAL } from './industrial';
import type { Archetype } from './kit';
import { PORT } from './port';
import { RURAL } from './rural';
import { SHOPS } from './shops';
import { STATEHOUSE } from './statehouse';
import { TOWNSHIP } from './township';
import { VILLA } from './villa';

/**
 * Building archetypes per district type. Each entry is a weighted choice; `buildLot` picks one
 * deterministically from the lot seed. An entry's optional `fit(lot)` scales its weight for a particular
 * plot (corner sites, the city it is in, plots too small for it). Add archetypes by pushing to this table.
 */
export const LOT_BUILDERS: Partial<Record<DistrictType, Archetype[]>> = {
  cbd: CBD,
  shops: SHOPS,
  township: TOWNSHIP,
  villa: VILLA,
  statehouse: STATEHOUSE,
  industrial: INDUSTRIAL,
  port: PORT,
  rural: RURAL,
};

export function buildLot(lot: Lot, out: ChunkBuilder) {
  const options = LOT_BUILDERS[lot.district.type];
  if (!options || options.length === 0) return;
  const rng = new Rng(lot.seed);
  const weight = (o: Archetype) => Math.max(0, o.weight * (o.fit ? o.fit(lot) : 1));
  // If nothing claims to fit (an odd-sized plot), fall back to the district's first archetype.
  const suitable = options.filter((o) => weight(o) > 0);
  const choice = suitable.length > 0 ? rng.weighted(suitable, weight) : options[0];
  choice.build(lot, out, rng);
}
