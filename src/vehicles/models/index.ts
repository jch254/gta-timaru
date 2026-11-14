import type { VehicleModelBuilder } from '../../core/types';
import { buildBike } from './bike';
import { buildBus } from './bus';
import { buildCoupe, buildHatch, buildPolice, buildSedan, buildV8Sedan, buildWagon } from './cars';
import { buildFarmTruck } from './truck';
import { buildUte } from './ute';
import { buildVan } from './van';

/**
 * Model builders keyed by `VehicleSpec.model`. Each returns a fresh model (own geometry, own paint
 * material) facing +z with its origin on the ground under the centre.
 */
export const VEHICLE_MODELS: Record<string, VehicleModelBuilder> = {
  sedan: buildSedan,
  v8sedan: buildV8Sedan,
  coupe: buildCoupe,
  hatch: buildHatch,
  wagon: buildWagon,
  ute: buildUte,
  farmtruck: buildFarmTruck,
  van: buildVan,
  bike: buildBike,
  police: buildPolice,
  bus: buildBus,
};
