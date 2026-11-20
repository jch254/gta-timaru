/** The shared identifiers fixed in docs/CONTRACT.md. Missions may reference only these. */

export const PLACE_IDS = [
  'timaru-spawn',
  'timaru-chipshop',
  'smithfield-carpark',
  'timaru-port-lockup',
  'timaru-hospital',
  'timaru-police',
  'timaru-gunshop',
  'timaru-panelbeater',
  'caroline-bay',
  'washdyke-saleyards',
  'temuka-pub',
  'rangitata-layby',
  'hinds-woolshed',
  'ashburton-stock-agent',
  'ashburton-police',
  'ashburton-panelbeater',
  'rakaia-salmon',
  'chch-garage',
  'four-aves-start',
  'cathedral-square',
  'arts-centre',
  'antigua-boatsheds',
  'chch-hospital',
  'chch-police',
  'chch-gunshop',
  'chch-panelbeater',
  'lancaster-park',
  'new-brighton-beach',
  'sign-of-the-kiwi',
  'lyttelton-wharf',
] as const;

export const VEHICLE_IDS = [
  'statesman', 'v8sedan', 'coupe', 'hatch', 'wagon', 'ute', 'farmtruck', 'van', 'bike', 'police', 'bus',
  // Added with the 1995 roster (docs/CONTRACT.md).
  'trafficcar', 'taxi', 'kingswood', 'valiant', 'cortina', 'mini', 'triumph', 'corolla', 'corona', 'sigma',
  'accord', 'datsun', 'leone', 'hothatch', 'import', 'lada', 'landrover', 'stocktruck', 'farmbike',
  // The quick cars and the old classics.
  'gtr', 'rx7', 'ae86', 'crx', 'legacy', 'commodore', 'falcon', 'escort', 'monaro', 'charger', 'morrie', 'm325',
] as const;

export const WEAPON_IDS = ['fists', 'knife', 'bat', 'katana', 'pistol', 'shotgun', 'rifle'] as const;

/** Kinds `ctx.combat.spawnPickup` understands besides weapon ids. */
export const PICKUP_KINDS = ['health', 'armour', 'cash'] as const;

/** Landmark kinds a mission may look up on the map (docs/CONTRACT.md, addendum). */
export const LANDMARK_KINDS = ['marae'] as const;
