import type { VehicleModelBuilder } from '../../core/types';
import { buildAccord, buildCorona, buildCoupe, buildDatsun, buildImport, buildLada, buildSigma } from './japanese';
import { buildCorolla, buildHatch, buildHotHatch, buildLeone } from './small';

/**
 * Builders for the cars in ../specs-cars.ts, keyed by `VehicleSpec.model`: the Japanese (and one Soviet)
 * cars of the roster. The three-box saloons and the coupe live in japanese.ts, the hatchbacks and the
 * light wagon in small.ts.
 */
export const COMPACT_MODELS: Record<string, VehicleModelBuilder> = {
  coupe: buildCoupe,
  hatch: buildHatch,
  corolla: buildCorolla,
  corona: buildCorona,
  sigma: buildSigma,
  accord: buildAccord,
  datsun: buildDatsun,
  leone: buildLeone,
  hothatch: buildHotHatch,
  import: buildImport,
  lada: buildLada,
};
