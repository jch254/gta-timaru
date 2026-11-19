import type { VehicleModelBuilder } from '../../core/types';
import { buildBike } from './bike';
import { buildBus } from './bus';
import { buildFarmBike } from './farmbike';
import { buildLandRover } from './landrover';
import { buildFarmTruck, buildStockTruck } from './truck';
import { buildUte } from './ute';
import { buildVan } from './van';

/** Builders for the working vehicles (../specs-working.ts), keyed by `VehicleSpec.model`. */
export const WORKING_MODELS: Record<string, VehicleModelBuilder> = {
  ute: buildUte,
  farmtruck: buildFarmTruck,
  stocktruck: buildStockTruck,
  van: buildVan,
  bike: buildBike,
  farmbike: buildFarmBike,
  landrover: buildLandRover,
  bus: buildBus,
};
