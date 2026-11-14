import { MapBuilder, type MapSource } from '../mapsource';
import { buildChristchurch } from './christchurch';
import { Author } from './helpers';
import { buildHighway } from './highway';
import { buildPortHills } from './porthills';
import { buildRural } from './rural';
import { buildSuburbs } from './suburbs';
import { buildTerrain } from './terrain';
import { buildTimaru } from './timaru';

/**
 * The authored map: Christchurch and Timaru c. 1995, joined by SH1 across the plains.
 * Geography is rotated and compressed (see docs/DESIGN.md): +x east, −z north, coast always on the east.
 */
export function buildMap(): MapSource {
  const b = new MapBuilder();
  const a = new Author(b);
  buildTerrain(a);
  const avon = buildChristchurch(a);
  buildSuburbs(a, avon);
  const governorsBay = buildPortHills(a);
  const rail = buildHighway(a);
  buildTimaru(a, rail);
  buildRural(a, governorsBay);
  // Last: every level crossing gets its no-build apron.
  a.levelCrossings();
  return b.source;
}
