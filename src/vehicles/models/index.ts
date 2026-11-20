import type { VehicleModelBuilder } from '../../core/types';
import { SEDAN_MODELS } from './cars';
import { CLASSIC_MODELS } from './classics';
import { COMPACT_MODELS } from './compact';
import { SPORTS_MODELS } from './sports';
import { WORKING_MODELS } from './working';

/**
 * Model builders keyed by `VehicleSpec.model`. Each returns a fresh model (own geometry, own paint
 * material) facing +z with its origin on the ground under the centre. Five registries, one per
 * roster file: cars.ts (the big Australian and British cars), compact.ts (the rest of the cars),
 * sports.ts (the quick imports), classics.ts (the old classics and the European), working.ts (utes,
 * vans, trucks, bus, bikes).
 */
export const VEHICLE_MODELS: Record<string, VehicleModelBuilder> = {
  ...SEDAN_MODELS,
  ...COMPACT_MODELS,
  ...SPORTS_MODELS,
  ...CLASSIC_MODELS,
  ...WORKING_MODELS,
};
