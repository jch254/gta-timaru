/**
 * How instanced props behave when something runs into them. This is an overlay keyed by prop kind, so the
 * look of a prop (its `PropDef`) and its physics can be owned separately.
 *
 * - No entry and no `collider` on the def: set dressing with no collision at all.
 * - `solidTo: 'all'` (default): a world collider. Stops people, cars and bullets, blocks line of sight.
 * - `solidTo: 'vehicles'`: stops cars only. People walk through, bullets and sight pass (wire fences, pickets).
 * - `breakSpeed`: a vehicle arriving at or above this speed (m/s) knocks the prop over and loses `slow` of its
 *   speed instead of stopping dead. Below it the prop is as solid as a wall.
 */
export interface PropPhysics {
  /** Collision box: half-extents along the prop's local x and z, and full height. Omitted: the def's own `collider`. */
  box?: { hx: number; hz: number; height: number };
  solidTo?: 'all' | 'vehicles';
  breakSpeed?: number;
  /** Fraction of its speed the vehicle loses (default 0.1). */
  slow?: number;
  /** Mass of the knocked-over piece in kg (default 60): how far it is flung. */
  mass?: number;
}

const post = (r: number, height: number): PropPhysics['box'] => ({ hx: r, hz: r, height });

export const PROP_PHYSICS: Record<string, PropPhysics> = {
  // Street lighting and poles. A timber pole wins against a slow car and loses to a fast one.
  lamp: { breakSpeed: 11, slow: 0.32, mass: 260 },
  'chch-lamp-standard': { breakSpeed: 9, slow: 0.25, mass: 180 },
  'power-pole': { breakSpeed: 15, slow: 0.45, mass: 420 },

  // Street furniture.
  'phone-box': { breakSpeed: 7, slow: 0.22, mass: 150 },
  postbox: { breakSpeed: 5, slow: 0.14, mass: 90 },
  bin: { box: post(0.27, 1.1), breakSpeed: 2.5, slow: 0.05, mass: 18 },
  bench: { box: { hx: 0.85, hz: 0.25, height: 0.85 }, breakSpeed: 4, slow: 0.08, mass: 45 },
  'chch-bench': { box: { hx: 0.9, hz: 0.28, height: 0.85 }, breakSpeed: 4, slow: 0.08, mass: 55 },
  'chch-planter': { breakSpeed: 9, slow: 0.3, mass: 300 },
  'road-sign': { box: post(0.06, 2.4), breakSpeed: 2.5, slow: 0.04, mass: 14 },
  'junction-sign': { box: post(0.06, 2.6), breakSpeed: 2.5, slow: 0.04, mass: 16 },
  'marker-post': { box: post(0.05, 1), solidTo: 'vehicles', breakSpeed: 2, slow: 0.02, mass: 4 },
  'picnic-table': { box: { hx: 0.9, hz: 0.75, height: 0.78 }, breakSpeed: 5, slow: 0.12, mass: 70 },
  'bike-stand': { box: { hx: 0.9, hz: 0.25, height: 0.8 }, breakSpeed: 4, slow: 0.08, mass: 30 },
  'rubbish-bag': { box: post(0.3, 0.5), solidTo: 'vehicles', breakSpeed: 1.5, slow: 0.02, mass: 6 },
  'chess-piece': { box: post(0.22, 0.8), breakSpeed: 2, slow: 0.03, mass: 8 },
  'rural-letterbox': { box: post(0.12, 1.15), breakSpeed: 2.5, slow: 0.04, mass: 12 },
  'washing-line': { box: post(0.05, 2), breakSpeed: 3, slow: 0.05, mass: 20 },
  drum: { box: post(0.3, 0.9), breakSpeed: 2.5, slow: 0.06, mass: 25 },
  pallet: { box: { hx: 0.6, hz: 0.5, height: 0.16 }, solidTo: 'vehicles', breakSpeed: 2, slow: 0.03, mass: 20 },
  'hay-bale': { box: post(0.7, 1.2), breakSpeed: 9, slow: 0.35, mass: 300 },
  'water-trough': { box: { hx: 1.1, hz: 0.35, height: 0.5 }, breakSpeed: 8, slow: 0.25, mass: 200 },

  // Round 3: the shopping street and the yards.
  'parking-meter': { box: post(0.07, 1.3), breakSpeed: 3, slow: 0.05, mass: 20 },
  'zebra-pole': { box: post(0.07, 2.2), breakSpeed: 3, slow: 0.05, mass: 22 },
  'stop-sign': { box: post(0.06, 2.4), breakSpeed: 2.5, slow: 0.04, mass: 16 },
  'traffic-signal': { box: post(0.08, 3.7), breakSpeed: 7, slow: 0.2, mass: 120 },
  trampoline: { box: { hx: 1.25, hz: 1.25, height: 0.8 }, breakSpeed: 5, slow: 0.45, mass: 45 },
  kennel: { box: { hx: 0.45, hz: 0.5, height: 0.7 }, breakSpeed: 5, slow: 0.4, mass: 35 },
  'traffic-signal-cross': { box: post(0.08, 3.7), breakSpeed: 7, slow: 0.2, mass: 120 },
  'sandwich-board': { box: { hx: 0.3, hz: 0.2, height: 0.85 }, solidTo: 'vehicles', breakSpeed: 1.5, slow: 0.02, mass: 7 },
  'news-billboard': { box: { hx: 0.28, hz: 0.1, height: 0.85 }, solidTo: 'vehicles', breakSpeed: 1.5, slow: 0.02, mass: 4 },
  'shop-crates': { box: { hx: 0.75, hz: 0.3, height: 0.85 }, breakSpeed: 2.5, slow: 0.05, mass: 25 },
  woodpile: { box: { hx: 0.95, hz: 0.24, height: 0.85 }, breakSpeed: 3, slow: 0.08, mass: 40 },
  trailer: { box: { hx: 0.75, hz: 1.4, height: 0.95 }, breakSpeed: 7, slow: 0.25, mass: 220 },
  'boat-trailer': { box: { hx: 0.78, hz: 2.2, height: 1.15 }, breakSpeed: 8, slow: 0.3, mass: 320 },

  // Fences: cars go through with a bang; people, bullets and sight are not stopped.
  'picket-fence': { box: { hx: 1.2, hz: 0.06, height: 1.0 }, solidTo: 'vehicles', breakSpeed: 3, slow: 0.05, mass: 22 },
  'farm-fence': { box: { hx: 2, hz: 0.06, height: 1.1 }, solidTo: 'vehicles', breakSpeed: 3.5, slow: 0.06, mass: 25 },
  'chainlink-fence': { box: { hx: 1.5, hz: 0.05, height: 1.9 }, solidTo: 'vehicles', breakSpeed: 7, slow: 0.14, mass: 40 },
  'fence-post': { box: post(0.07, 1.2), solidTo: 'vehicles', breakSpeed: 3, slow: 0.03, mass: 10 },
  'farm-post': { box: post(0.07, 1.2), solidTo: 'vehicles', breakSpeed: 3, slow: 0.03, mass: 10 },
  'farm-gate': { box: { hx: 2.2, hz: 0.06, height: 1.15 }, solidTo: 'vehicles', breakSpeed: 5, slow: 0.1, mass: 45 },

  // Solid, never knocked over.
  hedge: { box: { hx: 1.02, hz: 0.36, height: 1.2 }, solidTo: 'vehicles' },
  'car-parked': { box: { hx: 0.84, hz: 2.1, height: 1.35 } },
  'car-parked-wagon': { box: { hx: 0.84, hz: 2.15, height: 1.38 } },
  'van-parked': { box: { hx: 0.88, hz: 2.22, height: 1.9 } },
  'skip-bin': { box: { hx: 0.86, hz: 1.7, height: 1.15 } },
  'timber-stack': { box: { hx: 0.6, hz: 2.1, height: 1.9 } },
  'water-tank': { box: post(0.95, 2.7) },
  // 4 m of macrocarpa shelter hedge: nothing gets through one.
  'hedge-shelter': { box: { hx: 2, hz: 0.85, height: 4.6 } },
  'rugby-posts': { box: { hx: 2.95, hz: 0.17, height: 3 }, solidTo: 'vehicles' },
  'chch-rugby-posts': { box: { hx: 2.95, hz: 0.17, height: 3 }, solidTo: 'vehicles' },
};
