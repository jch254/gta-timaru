import type { CityId } from '../../core/types';
import type { Pt } from '../mapsource';
import { type Author, mark } from './helpers';

/** SH1 centreline from Sockburn to the top of Evans Street, Timaru (z strictly increasing). */
export const SH1: Pt[] = [
  [-1230, -3500],
  [-1300, -3380],
  [-1300, -300],
  [-1220, 60],
  [-1220, 960],
  [-1160, 1230],
  [-1140, 1330],
  [-1100, 1470],
  [-1100, 2040],
  [-1000, 2200],
  [-880, 2520],
  [-760, 2760],
  [-700, 2900],
  [-640, 3120],
  [-540, 3270],
  [-540, 3520],
  [-330, 3800],
  [-100, 4100],
  [60, 4400],
  [150, 4500],
];
/** The Main South Line runs this far east of the highway across the plains. */
export const RAIL_OFFSET = 32;

/** Point on SH1 at a given z. */
export function sh1At(z: number): Pt {
  for (let i = 0; i < SH1.length - 1; i++) {
    if (z <= SH1[i + 1][1]) {
      const t = (z - SH1[i][1]) / (SH1[i + 1][1] - SH1[i][1]);
      return [Math.round((SH1[i][0] + (SH1[i + 1][0] - SH1[i][0]) * t) * 10) / 10, z];
    }
  }
  return SH1[SH1.length - 1];
}
const sx = (z: number) => sh1At(z)[0];
/** Point `d` metres square off SH1 at a given z: positive = east (the railway side), negative = west. */
export function beside(z: number, d: number): Pt {
  const [x] = sh1At(z);
  const p0 = sh1At(z - 5);
  const p1 = sh1At(z + 5);
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const tx = (p1[0] - p0[0]) / len;
  const tz = (p1[1] - p0[1]) / len;
  return [Math.round((x + tz * d) * 10) / 10, Math.round((z - tx * d) * 10) / 10];
}

interface Street {
  name: string;
  z: number;
  /** x of the far end; west of SH1 if smaller, east (over the railway) if larger. */
  to: number;
}

/** A small town strung along SH1: side streets off the highway, optional back streets, a `township` district. */
function town(a: Author, id: string, name: string, city: CityId | null, z0: number, z1: number, streets: Street[], backs: { name: string; x: number; z0: number; z1: number }[] = [], teReo?: string) {
  let west = sx((z0 + z1) / 2) - 60;
  let east = sx((z0 + z1) / 2) + RAIL_OFFSET - 8;
  for (const s of streets) {
    a.b.road(s.name, 'street', [[sx(s.z), s.z], [s.to, s.z]], { footpaths: true });
    west = Math.min(west, s.to - 30);
    if (s.to > sx(s.z)) east = Math.max(east, s.to + 30);
  }
  for (const k of backs) a.b.road(k.name, 'street', [[k.x, k.z0], [k.x, k.z1]]);
  a.rect(id, name, city, 'township', west, east, z0, z1, 3, teReo);
}

/**
 * SH1 from Christchurch to the edge of Timaru, the towns along it, the rivers it crosses and the railway beside it.
 * Returns the Main South Line's points as far as Washdyke.
 */
export function buildHighway(a: Author): Pt[] {
  const b = a.b;

  // ── Rivers, west → east to the coast.
  a.river('Selwyn River', [[-3072, -2260], [-2200, -2150], [-1300, -2080], [-500, -2000], [300, -1650], [1200, -1460], [2000, -1420], [2700, -1400]], 30, { bridgeName: 'Selwyn River Bridge' });
  a.river('Rakaia River', [[-3072, -1000], [-2200, -940], [-1300, -900], [-400, -880], [600, -800], [1600, -760], [2600, -720]], 400, { braided: true, bridgeName: 'Rakaia Bridge' });
  a.river('Ashburton River', [[-3072, 560], [-2100, 640], [-1220, 680], [-300, 720], [800, 800], [1700, 860], [2400, 900]], 120, { braided: true, bridgeName: 'Ashburton River Bridge' });
  a.river('Rangitata River', [[-3072, 1500], [-2300, 1560], [-1700, 1600], [-1100, 1630], [-400, 1650], [300, 1760], [1200, 1820], [1950, 1850]], 140, { braided: true, bridgeName: 'Rangitata River Bridge' });
  a.river('Rangitata River South Branch', [[-1760, 1600], [-1450, 1830], [-1100, 1930], [-750, 1920], [-380, 1670]], 110, { braided: true, bridgeName: 'Rangitata South Branch Bridge' });
  a.river('Opihi River', [[-3072, 3270], [-2000, 3350], [-1100, 3390], [-540, 3400], [100, 3440], [700, 3460], [1450, 3470]], 160, { braided: true, bridgeName: 'Opihi River Bridge' });

  // The two riverbeds with well-attested te reo names get their own (empty, rural) districts so the HUD can show them.
  const riverbed = (id: string, name: string, pts: Pt[], half: number, teReo: string) => a.poly(id, name, null, 'rural', [...pts.map((p): Pt => [p[0], p[1] - half]), ...[...pts].reverse().map((p): Pt => [p[0], p[1] + half])], 1, teReo);
  riverbed('ashburton-river', 'Ashburton River', [[-3072, 560], [-2100, 640], [-1220, 680], [-300, 720], [800, 800], [1700, 860], [2400, 900]], 74, 'Hakatere');
  riverbed('opihi-river', 'Opihi River', [[-3072, 3270], [-2000, 3350], [-1100, 3390], [-540, 3400], [100, 3440], [700, 3460], [1450, 3470]], 94, 'Ōpihi');

  // ── SH1 itself, in stretches so the towns carry their own names and limits.
  const sh1 = (z0: number, z1: number, speed: number, name = 'State Highway 1', footpaths = false) => {
    const pts: Pt[] = [sh1At(z0), ...SH1.filter((p) => p[1] > z0 + 1 && p[1] < z1 - 1), sh1At(z1)];
    a.road(name, 'highway', pts, { speed, bridgeWidth: 7, footpaths });
  };
  b.road('Blenheim Road', 'arterial', [[-740, -3600], [-1000, -3570], SH1[0]]);
  sh1(-3500, -3090, 60, 'Main South Road'); // Sockburn, Hornby
  sh1(-3090, -3040, 100, 'Main South Road');
  sh1(-3040, -2880, 70, 'Main South Road'); // Templeton
  sh1(-2880, -2690, 100, 'Main South Road');
  sh1(-2690, -2510, 70, 'Main South Road'); // Rolleston
  sh1(-2510, -2360, 100);
  sh1(-2360, -2250, 80); // Burnham
  sh1(-2250, -1900, 100); // Selwyn River
  sh1(-1900, -1750, 70); // Dunsandel
  sh1(-1750, -640, 100); // Bankside, the Rakaia Bridge
  sh1(-640, -470, 70); // Rakaia
  sh1(-470, 60, 100); // Chertsey
  sh1(60, 575, 50, 'West Street', true); // Ashburton
  sh1(575, 790, 70); // Ashburton River
  sh1(790, 960, 50, 'Archibald Street', true); // Tinwald
  sh1(960, 1230, 100);
  sh1(1230, 1345, 70); // Hinds
  sh1(1345, 2180, 100); // both Rangitata bridges, by way of Rangitata Island
  sh1(2180, 2240, 70); // Orari
  sh1(2240, 2470, 100);
  sh1(2470, 2570, 70); // Winchester
  sh1(2570, 2740, 100);
  sh1(2740, 3090, 70); // Temuka (the highway skirts the town; King Street is the main street)
  sh1(3090, 3800, 100); // Arowhenua, the Opihi
  sh1(3800, 4500, 70, 'Hilton Highway'); // Washdyke, Smithfield

  // ── Main South Line: Addington, out beside Blenheim Road, then east of the highway all the way south.
  const rail: Pt[] = [[-600, -3545], [-740, -3540], [-1000, -3508], [-1130, -3470], [-1215, -3400], [-1262, -3320], [-1268, -3200]];
  for (const p of SH1) if (p[1] > -3200 && p[1] < 3900) rail.push([p[0] + RAIL_OFFSET, p[1]]);
  // Washdyke: the line swings seaward of the highway towards the Timaru waterfront (carried on in timaru.ts).
  rail.push([-40, 4100], [120, 4370]);

  // Country stations stand on the far side of the line from the highway: the builder's platform is behind the
  // building (local −z), 11 m from the placement, so the placement faces away from the track.
  const station = (name: string, z: number) => mark(a, 'rail-station-small', name, beside(z, RAIL_OFFSET + 11), beside(z, RAIL_OFFSET + 80));

  // ── Sockburn and Hornby.
  b.road('Shands Road', 'street', [[-1300, -3160], [-1560, -3160]]);
  b.road('Amyes Road', 'street', [[-1300, -3260], [-1560, -3260]]);
  b.road('Carmen Road', 'street', [[-1300, -3340], [-1560, -3340], [-1700, -3560], [-1700, -3900]]);
  b.road('Waterloo Road', 'street', [[-1560, -3340], [-1560, -3110]]);
  b.road('Witham Street', 'street', [[-1430, -3260], [-1430, -3160]]);
  b.road('Branston Street', 'street', [[-1300, -3210], [-1100, -3210]]);
  b.road('Tower Street', 'street', [[-1180, -3290], [-1180, -3130]]);
  mark(a, 'service-station', 'Hornby Service Station', [-1336, -3110], [-1300, -3110]);
  mark(a, 'country-pub', 'The Brick Kiln Tavern', [-1331, -3210], [-1300, -3210]);
  a.rect('sockburn', 'Sockburn', 'christchurch', 'industrial', -1560, -1000, -3640, -3380, 2);
  a.rect('hornby', 'Hornby', 'christchurch', 'township', -1420, -1276, -3380, -3090, 3);
  a.rect('hornby-works', 'Hornby', 'christchurch', 'industrial', -1720, -1420, -3600, -3090, 2);
  a.rect('hornby-east', 'Hornby', 'christchurch', 'statehouse', -1250, -1060, -3340, -3090, 2);

  // ── Templeton, Rolleston, Burnham, Dunsandel.
  town(a, 'templeton', 'Templeton', null, -3040, -2880, [
    { name: 'Jones Road', z: -3000, to: -1520 },
    { name: 'Kirk Road', z: -2900, to: -1520 },
  ], [{ name: 'Banks Street', x: -1420, z0: -3000, z1: -2900 }]);
  mark(a, 'country-pub', 'The Plough & Stook', [-1331, -2950], [-1300, -2950]);
  mark(a, 'country-church', 'Templeton Church', [-1470, -2950], [-1470, -2900]);

  town(a, 'rolleston', 'Rolleston', null, -2700, -2510, [
    { name: 'Rolleston Drive', z: -2650, to: -1560 },
    { name: 'Tennyson Street', z: -2560, to: -1560 },
    { name: 'Hoskyns Road', z: -2610, to: -1120 },
  ], [
    { name: 'Masefield Drive', x: -1430, z0: -2650, z1: -2560 },
    { name: 'Lowes Road', x: -1560, z0: -2690, z1: -2520 },
  ]);
  station('Rolleston Station', -2555);
  mark(a, 'service-station', 'Rolleston Service Station', [-1336, -2500], [-1300, -2500]);
  mark(a, 'school', 'Rolleston School', [-1665, -2605], [-1560, -2605]);
  mark(a, 'war-memorial', 'Rolleston War Memorial', [-1318, -2605], [-1300, -2605]);

  town(a, 'burnham', 'Burnham', null, -2365, -2245, [{ name: 'Burnham Road', z: -2300, to: -1700 }], [{ name: 'Aylesbury Road', x: -1500, z0: -2300, z1: -2180 }]);
  mark(a, 'rugby-field', 'Burnham Camp Sports Ground', [-1400, -2395], [-1400, -2300]);

  town(a, 'dunsandel', 'Dunsandel', null, -1905, -1745, [
    { name: 'Hororata Dunsandel Road', z: -1820, to: -1560 },
    { name: 'Irvines Road', z: -1765, to: -1560 },
    { name: 'Leeston Dunsandel Road', z: -1790, to: -1120 },
  ], [{ name: 'Browns Road', x: -1430, z0: -1820, z1: -1765 }]);
  mark(a, 'country-pub', 'The Gorse Hedge Hotel', [-1331, -1864], [-1300, -1864]);
  station('Dunsandel Station', -1850);
  mark(a, 'grain-silo', 'Dunsandel Grain Store', [-1240, -1730], [-1268, -1730]);

  // ── Rakaia: township on the south bank, the big salmon beside the highway.
  town(a, 'rakaia', 'Rakaia', 'rakaia', -645, -465, [
    { name: 'Elizabeth Avenue', z: -555, to: -1560 },
    { name: 'Mackie Street', z: -490, to: -1560 },
    { name: 'Dunford Street', z: -525, to: -1120 },
  ], [
    { name: 'Cridland Street', x: -1430, z0: -555, z1: -490 },
    { name: 'Rakaia Terrace', x: -1560, z0: -610, z1: -470 },
  ]);
  mark(a, 'rakaia-salmon', 'The Big Salmon', [-1326, -598], [-1300, -598]);
  a.place('rakaia-salmon', 'The Big Salmon, Rakaia', [-1310, -604], [-1300, -604], 'rakaia', ['mission']);
  mark(a, 'country-pub', 'The Shingle Bed Hotel', [-1331, -521], [-1300, -521]);
  station('Rakaia Station', -590);
  mark(a, 'service-station', 'Rakaia Service Station', [-1336, -435], [-1300, -435]);
  mark(a, 'grain-silo', 'Rakaia Grain Silos', [-1240, -450], [-1268, -450]);
  mark(a, 'country-church', 'Rakaia Church', [-1495, -522], [-1495, -555]);

  // ── Chertsey: a siding and silos.
  mark(a, 'grain-silo', 'Chertsey Silos', beside(-150, RAIL_OFFSET + 28), sh1At(-150));

  // ── Ashburton: SH1 is West Street; East Street with the shops is across the railway.
  const WEST = -1220;
  const EAST = WEST + RAIL_OFFSET * 2;
  b.road('East Street', 'street', [[EAST, 120], [EAST, 520]]);
  b.road('Walnut Avenue', 'street', [[-1700, 120], [-700, 120]]);
  b.road('Havelock Street', 'street', [[-1420, 200], [-960, 200]]);
  b.road('Burnett Street', 'street', [[-1420, 280], [-960, 280]]);
  b.road('Tancred Street', 'street', [[-1420, 360], [-960, 360]]);
  b.road('Moore Street', 'street', [[-1420, 440], [-700, 440]]);
  b.road('Kermode Street', 'street', [[-1420, 520], [-960, 520]]);
  b.road('Oak Grove', 'street', [[-1420, 120], [-1420, 520]]);
  b.road('Wills Street', 'street', [[-1320, 120], [-1320, 520]]);
  b.road('Cass Street', 'street', [[-1060, 120], [-1060, 520]]);
  b.road('Cameron Street', 'street', [[-960, 120], [-960, 520]]);
  b.road('Bridge Street', 'street', [[-700, 120], [-700, 440]]);
  mark(a, 'ashburton-clock-tower', 'Ashburton Clock Tower', [EAST + 30, 240], [EAST, 240]);
  mark(a, 'war-memorial', 'Ashburton War Memorial', [WEST - 30, 240], [WEST, 240]);
  station('Ashburton Station', 562);
  mark(a, 'country-church', 'St Stephens Church', [-1370, 240], [-1370, 200]);
  mark(a, 'country-pub', 'The Wool Bale Hotel', [-1108, 400], [EAST, 400]);
  mark(a, 'service-station', 'West Street Service Station', [WEST - 36, 560], [WEST, 560]);
  mark(a, 'school', 'Ashburton Borough School', [-830, 282], [-960, 282]);
  mark(a, 'rugby-field', 'Ashburton Showgrounds', [-1540, 480], [-1420, 480]);
  a.place('ashburton-stock-agent', 'Canterbury Plains Stock & Station', [EAST + 10, 320], [EAST, 320], 'ashburton', ['mission', 'yard']);
  a.place('ashburton-police', 'Ashburton Police Station', [-1010, 209], [-1010, 200], 'ashburton', ['police']);
  a.place('ashburton-panelbeater', 'Mid Canterbury Panel & Paint', [-1372, 449], [-1372, 440], 'ashburton', ['spray']);
  a.rect('ashburton-shops', 'Ashburton', 'ashburton', 'shops', EAST - 22, -1070, 110, 530, 5, 'Hakatere');
  a.rect('ashburton-west-st', 'Ashburton', 'ashburton', 'township', -1330, WEST + 24, 60, 600, 4, 'Hakatere');
  a.rect('ashburton', 'Ashburton', 'ashburton', 'villa', -1440, -940, 60, 600, 3, 'Hakatere');
  a.rect('ashburton-domain', 'Ashburton Domain', 'ashburton', 'park', -1720, -1432, 132, 590, 4);
  a.rect('allenton', 'Allenton', 'ashburton', 'statehouse', -1720, -1432, 20, 132, 3);
  a.rect('netherby', 'Netherby', 'ashburton', 'statehouse', -940, -660, 80, 480, 3);

  // ── Tinwald, across the river.
  town(a, 'tinwald', 'Tinwald', 'ashburton', 790, 965, [
    { name: 'Graham Street', z: 830, to: -1420 },
    { name: 'Jane Street', z: 910, to: -1420 },
    { name: 'Carters Terrace', z: 870, to: -1050 },
  ], [{ name: 'Thomson Street', x: -1330, z0: 830, z1: 910 }]);
  mark(a, 'country-pub', 'The Drovers Arms', [WEST - 31, 870], [WEST, 870]);

  // ── Hinds.
  town(a, 'hinds', 'Hinds', null, 1225, 1345, [
    { name: 'Boundary Road', z: 1250, to: -1400 },
    { name: 'Peters Street', z: 1326, to: -1400 },
  ], [{ name: 'Isleworth Road', x: -1300, z0: 1250, z1: 1326 }]);
  mark(a, 'country-pub', 'The Muster Inn', beside(1283, -31), sh1At(1283));
  station('Hinds Station', 1290);
  mark(a, 'service-station', 'Hinds Service Station', beside(1200, -36), sh1At(1200));
  mark(a, 'war-memorial', 'Hinds War Memorial', [-1230, 1288], [-1230, 1250]);
  a.place('rangitata-layby', 'Rangitata Lay-by', [-1109, 1502], [-1100, 1502], null, ['mission']);

  // ── Orari and Winchester.
  town(a, 'orari', 'Orari', null, 2175, 2245, [{ name: 'Orari Station Road', z: 2200, to: -1220 }]);
  mark(a, 'country-pub', 'The Shearers Rest', beside(2245, -31), sh1At(2245));
  station('Orari Station', 2215);
  town(a, 'winchester', 'Winchester', null, 2465, 2575, [
    { name: 'Rise Road', z: 2484, to: -1100 },
    { name: 'Harrison Street', z: 2556, to: -1100 },
  ], [{ name: 'Benhar Road', x: -1000, z0: 2484, z1: 2556 }]);
  mark(a, 'country-pub', 'The Black Stump Hotel', beside(2509, -32), sh1At(2509));
  mark(a, 'country-church', 'Winchester Church', [-1050, 2520], [-1050, 2484]);

  // ── Temuka: King Street is the main street; the highway keeps to the east of it.
  b.road('King Street', 'street', [sh1At(2740), [-850, 2810], [-850, 3030], sh1At(3090)]);
  for (const [name, z] of [['Domain Avenue', 2860], ['Commerce Street', 2920], ['Wood Street', 2980]] as const) b.road(name, 'street', [[-1060, z], [sx(z), z]]);
  b.road('Hayhurst Street', 'street', [[-960, 2810], [-960, 3030]]);
  b.road('Whitcombe Street', 'street', [[-1060, 2860], [-1060, 2980]]);
  mark(a, 'country-pub', 'The Potters Wheel Hotel', [-818, 2950], [-850, 2950]);
  a.place('temuka-pub', 'The Potters Wheel Hotel', [-841, 2950], [-850, 2950], 'temuka', ['mission']);
  mark(a, 'school', 'Temuka School', [-990, 2690], [-900, 2780]);
  mark(a, 'rugby-field', 'Temuka Domain', [-520, 2950], [sx(2950), 2950]);
  station('Temuka Station', 3030);
  mark(a, 'service-station', 'Temuka Service Station', beside(2795, -36), sh1At(2795));
  mark(a, 'war-memorial', 'Temuka War Memorial', [-870, 2890], [-850, 2890]);
  mark(a, 'country-church', 'St Peters Church, Temuka', [-1010, 2890], [-960, 2890]);
  a.rect('temuka-shops', 'Temuka', 'temuka', 'shops', -884, -812, 2812, 3030, 5, 'Te Umu Kaha');
  a.rect('temuka', 'Temuka', 'temuka', 'township', -1090, -690, 2740, 3100, 3, 'Te Umu Kaha');

  // ── Arowhenua, just south of Temuka: the marae is off the highway on its own side road.
  b.road('Huirapa Street', 'street', [sh1At(3170), [-330, 3175]], { footpaths: false });
  mark(a, 'marae', 'Arowhenua Marae', [-400, 3240], [-400, 3175]);
  a.rect('arowhenua', 'Arowhenua', 'temuka', 'rural', -640, -280, 3110, 3300, 2);

  // ── Railway land beside the track the whole way (see Author.railReserve): the strip between highway and line.
  a.railReserve('rail', rail, 18, 8);
  // Ashburton: the strip between West Street and East Street is the railway's, as it is in the real town.
  a.railReserve('rail-ashburton', [[WEST + RAIL_OFFSET, 60], [WEST + RAIL_OFFSET, 600]], 22, 22, 'Main South Line', 'ashburton');

  // The railway so far; timaru.ts carries it on round the bay to the port.
  return rail;
}
