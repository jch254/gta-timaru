import type * as THREE from 'three';
import { hashInts } from '../../core/rng';
import type { LandmarkPlacement, MaterialLibrary, MaterialOptions, SurfaceKind } from '../../core/types';
import { weathered, type Wear } from '../buildings/weathering';
import { ROUND3_OFF } from '../scatter/util';

/**
 * Landmarks weather like the buildings round them (see ../buildings/weathering.ts): grime at the foot of the
 * walls, streaks, lichen on the south faces, rust runs on iron, bleached paint. Both landmark kits take their
 * materials from the library through one field, so the weathering is put in there: `agedLibrary` hands back
 * the same library, except that a plain request for a wall or roof cladding (surface, and at most a colour)
 * comes back as the weathered piece of it. Anything else passes straight through: glass, ground covers,
 * paint and metalwork, emitters, signs, and any cladding asked for with more than a colour and a finish.
 */

const CLADDING: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['brick', 'bluestone', 'limestone', 'plaster', 'weatherboard', 'corrugated', 'rooftile', 'slate']);

/** How far gone each kind of landmark is, 0 (kept up) to 7 (derelict). Anything not listed: 3. */
const AGE: Record<string, number> = {
  marae: 1,
  'town-hall': 2,
  'chch-hospital': 2,
  'timaru-hospital': 2,
  'chch-police': 2,
  'timaru-police': 2,
  'chch-cathedral': 4,
  'arts-centre': 4,
  'canterbury-museum': 4,
  'old-railway-station': 4,
  'antigua-boatsheds': 4,
  'lancaster-park': 4,
  'timeball-station': 4,
  'sign-of-the-kiwi': 4,
  'sign-of-the-takahe': 4,
  'country-church': 4,
  'timaru-station': 4,
  'grain-silo': 4,
  'addington-station': 5,
  'lyttelton-port': 5,
  'timaru-port': 5,
  'landing-service-building': 5,
  'smithfield-works': 5,
  'country-pub': 5,
  'rail-station-small': 5,
  'service-station': 4,
  woolshed: 6,
  'washdyke-saleyards': 6,
};

export function wearOf(p: LandmarkPlacement, ground: number): Wear {
  return { ground, seed: hashInts(Math.round(p.x), Math.round(p.z), 91) & 63, age: AGE[p.kind] ?? 3 };
}

const plainRequest = (options?: MaterialOptions): boolean => !options || Object.keys(options).every((key) => key === 'color' || key === 'metalness' || key === 'roughness');

const libraries = new WeakMap<LandmarkPlacement, { lib: MaterialLibrary; aged: MaterialLibrary }>();

/** The library as one landmark sees it: claddings weathered for that landmark's age, its own shade and its ground. */
export function agedLibrary(lib: MaterialLibrary, p: LandmarkPlacement, ground: number): MaterialLibrary {
  if (ROUND3_OFF) return lib;
  const known = libraries.get(p);
  if (known && known.lib === lib) return known.aged;
  const wear = wearOf(p, ground);
  const get = (surface: SurfaceKind, options?: MaterialOptions): THREE.MeshStandardMaterial => {
    if (CLADDING.has(surface) && plainRequest(options)) {
      const piece = weathered(lib, surface, options?.color, wear);
      if (piece) return piece as THREE.MeshStandardMaterial;
    }
    return lib.get(surface, options);
  };
  const aged = new Proxy(lib, {
    get(target, key) {
      if (key === 'get') return get;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  libraries.set(p, { lib, aged });
  return aged;
}
