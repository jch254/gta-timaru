import type { MissionDef } from './types';

/** Every shared identifier and entity handle a mission definition mentions (functions are opaque and skipped). */
export interface MissionRefs {
  places: Set<string>;
  vehicles: Set<string>;
  weapons: Set<string>;
  pickups: Set<string>;
  /** Landmark kinds looked up on the map. */
  landmarks: Set<string>;
  /** Entity handles introduced with `as`. */
  defined: Set<string>;
  /** Entity handles used by later steps and fail conditions. */
  used: Set<string>;
}

/** Keys whose string value is a Spot, i.e. a place id. */
const SPOT_KEYS = new Set(['place', 'near', 'to', 'at', 'grid', 'toward', 'needs', 'checkpoints']);
/** Keys whose string value(s) name a spawned entity. */
const HANDLE_KEYS = new Set(['vehicle', 'target', 'targets', 'ped', 'peds', 'handles', 'entity']);

export function collectRefs(def: MissionDef): MissionRefs {
  const refs: MissionRefs = {
    places: new Set([def.placeId]),
    vehicles: new Set(),
    weapons: new Set(),
    pickups: new Set(),
    landmarks: new Set(),
    defined: new Set(),
    used: new Set(),
  };
  const seen = new Set<object>();
  const visit = (value: unknown, key: string) => {
    if (typeof value === 'string') {
      if (SPOT_KEYS.has(key)) refs.places.add(value);
      else if (key === 'spec') refs.vehicles.add(value);
      else if (key === 'weapon') refs.weapons.add(value);
      else if (key === 'pickup') refs.pickups.add(value);
      else if (key === 'landmark') refs.landmarks.add(value);
      else if (key === 'as') refs.defined.add(value);
      else if (HANDLE_KEYS.has(key)) refs.used.add(value);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(def.steps, 'steps');
  visit(def.failIf, 'failIf');
  return refs;
}
