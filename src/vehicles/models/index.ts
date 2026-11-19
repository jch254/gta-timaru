import type { VehicleModelBuilder } from '../../core/types';
import { SEDAN_MODELS } from './cars';
import { COMPACT_MODELS } from './compact';
import { WORKING_MODELS } from './working';

/**
 * Model builders keyed by `VehicleSpec.model`. Each returns a fresh model (own geometry, own paint
 * material) facing +z with its origin on the ground under the centre. Three registries, one per
 * roster file: cars.ts (the big Australian and British cars), compact.ts (the rest of the cars),
 * working.ts (utes, vans, trucks, bus, bikes).
 */
export const VEHICLE_MODELS: Record<string, VehicleModelBuilder> = {
  ...SEDAN_MODELS,
  ...COMPACT_MODELS,
  ...WORKING_MODELS,
};
