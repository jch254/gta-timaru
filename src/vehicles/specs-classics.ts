import type { VehicleSpec } from '../core/types';

/**
 * The older classics still on the road in 1995, and the one European: the cars somebody kept, polished and
 * drove on Sundays (docs/research/08-vehicle-reference-australian-british.md). Every make and model name is
 * invented; the real car each stands for is in the comment on it, with years and a source. Handling notes
 * are at the top of specs.ts.
 *
 * Marques: Lachlan = Ford, Holbrook = Holden, Carrington = Chrysler, Pemberton = the British group (Morris),
 * Isar = BMW.
 */
export const CLASSIC_SPECS: VehicleSpec[] = [
  // Ford Escort Mk II 1600 Sport, December 1974 to August 1980, assembled at Seaview, Lower Hutt until late
  // 1980; the Escort and Cortina "often topped the car monthly sales lists". Square-edged two-door three-box,
  // round lamps (base and Sport cars) in a black grille, black quarter bumpers, spot lamps and a side stripe
  // on some. Saloon 3975 x 1570 x 1414 mm, wheelbase 2400, 880 kg, 1.6 of 63 kW (the Ghia's figure: the
  // Sport's own is not in the research file), MacPherson struts and a leaf-sprung live axle: 72 kW per
  // tonne, light and tail-led, a rally car in spirit. https://en.wikipedia.org/wiki/Ford_Escort_(Europe)
  {
    id: 'escort',
    name: 'Lachlan Outrider 1600 Sport',
    cls: 'sedan',
    model: 'escort',
    length: 3.975,
    width: 1.57,
    height: 1.414,
    mass: 880,
    wheelRadius: 0.285,
    wheelWidth: 0.175,
    wheelbase: 2.4,
    track: 1.29,
    wheelCount: 4,
    engineForce: 3700, // 4.2 m/s².
    topSpeed: 45,
    reverseSpeed: 11,
    drive: 'rwd',
    brakeForce: 0.95,
    steerLock: 0.64,
    grip: 1,
    rearGripBias: 0.9,
    suspensionStiffness: 32,
    suspensionDamping: 0.85,
    suspensionTravel: 0.18,
    comDrop: 0.36,
    seats: 4,
    health: 75,
    colors: [0xf0ede2, 0xd2601f, 0xd9a70f, 0x4f8a3c, 0x8fb4cc, 0xb3202c, 0xbfa14d],
    value: 2000,
    spawn: { statehouse: 1.5, township: 1.5, villa: 1, rural: 1, shops: 0.8, beach: 1, industrial: 0.5 },
    spawnBy: { timaru: 1.4 },
    engineSound: 'four',
    traffic: true,
  },
  // Holden HQ Monaro GTS coupe, July 1971 to October 1974: the two-door of the HQ range, always fully
  // imported (the sedans were assembled at Trentham). Long-bonnet pillarless hardtop, coke-bottle hips,
  // chrome bumpers, four headlamps, bonnet blackouts, steel sports wheels. HQ: wheelbase 111 in (2819 mm),
  // length 187.5 in (4763), width 74.0 in (1880). The research file gives only the sedan's height (54.0 in,
  // 1372) and weight (Kingswood 2950 lb, 1338 kg): the coupe's roof is taken as about 25 mm lower and the
  // V8 GTS as about 60 kg heavier, both estimates. 5.0 "308" V8 of 161 kW (the HX/HZ figure; HQ power is
  // not in the file): 115 kW per tonne on soft coils. https://en.wikipedia.org/wiki/Holden_HQ
  {
    id: 'monaro',
    name: 'Holbrook Kiandra GTS',
    cls: 'coupe',
    model: 'monaro',
    length: 4.763,
    width: 1.88,
    height: 1.345,
    mass: 1400,
    wheelRadius: 0.345,
    wheelWidth: 0.24,
    wheelbase: 2.819,
    track: 1.55,
    wheelCount: 4,
    engineForce: 9400, // 6.7 m/s².
    topSpeed: 56,
    reverseSpeed: 12,
    drive: 'rwd',
    brakeForce: 0.9,
    steerLock: 0.55,
    grip: 0.95,
    rearGripBias: 0.84,
    suspensionStiffness: 25,
    suspensionDamping: 0.9,
    suspensionTravel: 0.24,
    comDrop: 0.4,
    seats: 4,
    health: 110,
    colors: [0xe0661c, 0xe2b714, 0x5a2a7a, 0x9bbf2a, 0xefede4, 0xb81f1c],
    value: 9500,
    spawn: { statehouse: 0.4, township: 0.4, villa: 0.3, beach: 0.4 },
    spawnBy: { timaru: 1.4 },
    engineSound: 'v8',
    traffic: true,
  },
  // Chrysler Valiant Charger VH 770, 1971 to 1973: Todd Motors assembled one Charger model at Petone (265
  // six, three-speed floor automatic, no bumper overriders), and Chryslers were "virtually unbeatable from
  // 1971 to 1979" in the B&H 500 at Pukekohe. Short-tailed fastback on a long wide "fuselage" bonnet, quad
  // round lamps in a full-width grille, wide rear pillars, kicked-up tail. Wheelbase 2667 mm and width
  // 1885 are from the research file; it has no other Charger body figure, only the VH sedan's 4897 x 1420
  // and 1406 kg, so the length (the 152 mm shorter wheelbase and a tail about 165 mm shorter), the roof
  // (50 mm lower) and the weight (about 50 kg less) are estimates. 265 Hemi six, 203 bhp gross (about
  // 151 kW; taken as 128 kW net, the same discount as the sedan's 245): 95 kW per tonne.
  // https://en.wikipedia.org/wiki/Chrysler_Valiant_(VH)
  {
    id: 'charger',
    name: 'Carrington Hussar 770',
    cls: 'coupe',
    model: 'charger',
    length: 4.58,
    width: 1.885,
    height: 1.37,
    mass: 1350,
    wheelRadius: 0.345,
    wheelWidth: 0.235,
    wheelbase: 2.667,
    track: 1.56,
    wheelCount: 4,
    engineForce: 7500, // 5.6 m/s².
    topSpeed: 52,
    reverseSpeed: 12,
    drive: 'rwd',
    brakeForce: 0.88,
    steerLock: 0.56,
    grip: 0.93,
    rearGripBias: 0.86,
    suspensionStiffness: 24,
    suspensionDamping: 0.88,
    suspensionTravel: 0.24,
    comDrop: 0.4,
    seats: 4,
    health: 105,
    colors: [0xdc5a1e, 0xd4a017, 0xa4c639, 0x6a2c82, 0xf0eee6, 0xc22a1e, 0x1f5fa8],
    value: 8500,
    spawn: { statehouse: 0.4, township: 0.4, villa: 0.3, beach: 0.3 },
    spawnBy: { timaru: 1.4 },
    engineSound: 'six',
    traffic: true,
  },
  // Morris Minor 1000, 1956 to 1971, assembled at Newmarket, Auckland from kits until 1974: "the Morrie".
  // Rounded 1940s body, headlamps up on bulging front wings, a raised rounded bonnet over a slatted grille,
  // one-piece screen, chrome blade bumpers, dome hubcaps. 148 in (3759 mm) x 60 in (1524) x 60 in (1524),
  // wheelbase 86 in (2184), 1708 lb (775 kg, the four-door, which is the body modelled), front torsion bars
  // and a leaf-sprung live axle. 948 then 1098 cc four; the research file found no power figure, so it is
  // set at the roster's floor (3.0 m/s²) with the lowest top speed of any car: slow, tall, narrow and soft.
  // https://en.wikipedia.org/wiki/Morris_Minor
  {
    id: 'morrie',
    name: 'Pemberton Minim 1000',
    cls: 'sedan',
    model: 'morrie',
    length: 3.759,
    width: 1.524,
    height: 1.524,
    mass: 775,
    wheelRadius: 0.3,
    wheelWidth: 0.14,
    wheelbase: 2.184,
    track: 1.28,
    wheelCount: 4,
    engineForce: 2325, // 3.0 m/s²: the floor.
    topSpeed: 33,
    reverseSpeed: 9,
    drive: 'rwd',
    brakeForce: 0.75,
    steerLock: 0.62,
    grip: 0.88,
    rearGripBias: 0.95,
    suspensionStiffness: 24,
    suspensionDamping: 0.8,
    suspensionTravel: 0.2,
    comDrop: 0.48,
    seats: 4,
    health: 70,
    colors: [0x8b9196, 0x4f6b52, 0xe8e0c6, 0x6a1f24, 0x9fb6c6, 0x15161a],
    value: 1300,
    spawn: { villa: 0.8, township: 0.7, rural: 0.5, shops: 0.3 },
    spawnBy: { timaru: 1.2 },
    engineSound: 'four',
    traffic: true,
  },
  // BMW E30 M325i, a New Zealand-only model: about 100 imported from late 1986 to at least 1990 (the M3
  // was never sold here), 2.5 six of 125 kW, M-Technic body kit, 15 inch BBS cross-spoke wheels. Crisp
  // upright two-door notchback, four round lamps either side of the twin kidney grille, deep air dam, side
  // skirts, boot spoiler. E30: 4320 to 4460 x 1645 x 1360 to 1400 mm, wheelbase 2570, 1080 to 1200 kg (the
  // six with the kit taken at the top of that range): 104 kW per tonne, the best-handling rear-driver of
  // the old cars. https://en.wikipedia.org/wiki/BMW_3_Series_(E30)
  {
    id: 'm325',
    name: 'Isar 325 Sport',
    cls: 'sedan',
    model: 'm325',
    length: 4.325,
    width: 1.645,
    height: 1.38,
    mass: 1200,
    wheelRadius: 0.3,
    wheelWidth: 0.205,
    wheelbase: 2.57,
    track: 1.41,
    wheelCount: 4,
    engineForce: 7300, // 6.1 m/s².
    topSpeed: 58,
    reverseSpeed: 12,
    drive: 'rwd',
    brakeForce: 1.15,
    steerLock: 0.62,
    grip: 1.12,
    rearGripBias: 0.93,
    suspensionStiffness: 38,
    suspensionDamping: 1.15,
    suspensionTravel: 0.17,
    comDrop: 0.4,
    seats: 4,
    health: 90,
    colors: [0xf1f1ec, 0xb5141c, 0x101114, 0x1c2a4a, 0xaeb4ba],
    value: 11000,
    spawn: { villa: 0.35, cbd: 0.3, shops: 0.15 },
    spawnBy: { christchurch: 1.2, timaru: 0.3, country: 0.3 },
    engineSound: 'six',
    traffic: true,
  },
];
