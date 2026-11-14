import type { Pt } from '../mapsource';
import { type Author, CLEAR, gradedDescent, mark } from './helpers';

const CH = 'christchurch' as const;
const LY = 'lyttelton' as const;

/** Port Hills roads, the road tunnel, Heathcote Valley and Lyttelton on its harbour. Returns the Governors Bay road end. */
export function buildPortHills(a: Author): Pt {
  const b = a.b;
  const hill = { smooth: true, footpaths: false, speed: 50 };

  // Dyers Pass Road: from the end of Colombo Street at Cashmere, one long climb across the face of the hills past
  // the Sign of the Takahe to the Sign of the Kiwi on the saddle, then down the harbour side to Governors Bay.
  // Both legs are laid out at a steady gradient against the landform.
  const kiwi: Pt = [980, -2791];
  const north = gradedDescent(a.natural, [kiwi[0] - 14, kiwi[1] - 34], -1, 0.125, 9.5);
  north.reverse();
  b.road('Dyers Pass Road', 'street', [[0, -3262], ...north, kiwi], { footpaths: false, speed: 50 });
  // The Sign of the Takahe stands just above the road, a third of the way up.
  const ti = Math.round(north.length * 0.36);
  const tp = north[ti];
  const tq = north[ti + 3];
  const tl = Math.hypot(tq[0] - tp[0], tq[1] - tp[1]);
  let tn: Pt = [(tq[1] - tp[1]) / tl, -(tq[0] - tp[0]) / tl];
  if (a.natural(tp[0] + tn[0] * 30, tp[1] + tn[1] * 30) < a.natural(tp[0], tp[1])) tn = [-tn[0], -tn[1]];
  const takahe: Pt = [Math.round(tp[0] + tn[0] * 40), Math.round(tp[1] + tn[1] * 40)];
  const south = gradedDescent(a.natural, [kiwi[0] - 14, kiwi[1] + 34], -1, 0.125, 12);
  const bay = south[south.length - 1];
  b.road('Dyers Pass Road', 'street', [kiwi, ...south], { footpaths: false, speed: 50 });
  b.road('Governors Bay Road', 'street', [bay, [400, -2396], [800, -2386], [1150, -2374], [1300, -2365]], hill);

  // Summit Road along the crest to Evans Pass, then Sumner Road down to the east end of Lyttelton.
  const evans: Pt = [2460, -2799];
  b.road('Summit Road', 'street', [kiwi, [1060, -2800], [1140, -2786], [1220, -2798], [1300, -2800], [1400, -2790], [1500, -2806], [1600, -2792], [1705, -2796], [1800, -2782], [1900, -2792], [2000, -2776], [2120, -2790], [2240, -2784], [2360, -2800], evans], hill);
  // Sumner Road is the steepest and narrowest of them (a `lane`, which the compiler allows a 15% grade).
  // It comes in at the top of the town, where Winchester Street runs out to meet it.
  const sumner = gradedDescent(a.natural, [evans[0] - 14, evans[1] + 34], -1, 0.145, 14, 1668);
  const townEnd = sumner[sumner.length - 1];
  b.road('Sumner Road', 'lane', [evans, ...sumner], { speed: 50, width: 7.5 });

  // The road tunnel (1964): Heathcote Valley to Lyttelton.
  b.road('Tunnel Road', 'highway', [[1300, -3480], [1300, -3150]], { speed: 70 });
  b.road('Lyttelton Road Tunnel', 'highway', [[1300, -3150], [1300, -2440]], { tunnel: true, speed: 50, width: 8 });
  b.road('Tunnel Road', 'highway', [[1300, -2440], [1300, -2365]], { speed: 50 });
  mark(a, 'tunnel-portal', 'Lyttelton Tunnel, Heathcote Portal', [1300, -3150], [1300, -3250]);
  mark(a, 'tunnel-portal', 'Lyttelton Tunnel, Lyttelton Portal', [1300, -2440], [1300, -2365]);
  b.road('Bridle Path Road', 'street', [[1300, -3330], [1390, -3300], [1440, -3262], [1456, -3230]], { footpaths: false });
  b.road('Martindales Road', 'street', [[1390, -3300], [1560, -3330], [1700, -3440]], { footpaths: false });
  mark(a, 'gondola-base', 'Christchurch Gondola, Heathcote Station', [1508, -3214], [1456, -3230]);
  // `line` asks the builder to string the cableway down to the base station.
  b.landmark('gondola-summit', 'Christchurch Gondola, Mount Cavendish', 1705, -2842, Math.PI, CLEAR['gondola-summit'], { skyline: true, params: { line: true } });
  mark(a, 'sugarloaf-tower', 'Sugarloaf Transmitter', [1180, -2826], [1180, -2900]);
  mark(a, 'sign-of-the-takahe', 'Sign of the Takahe', takahe, tp);
  mark(a, 'sign-of-the-kiwi', 'Sign of the Kiwi', [kiwi[0] + 34, kiwi[1] - 40], kiwi);
  a.place('sign-of-the-kiwi', 'Sign of the Kiwi', [kiwi[0] + 10, kiwi[1] - 10], kiwi, CH, ['mission']);

  // Lyttelton: Norwich Quay along the waterfront, London Street a block up the hill, the wharves below.
  b.road('Norwich Quay', 'street', [[1300, -2365], [1640, -2365]]);
  b.road('London Street', 'street', [[1380, -2425], [1660, -2425]]);
  b.road('Winchester Street', 'street', [[1380, -2485], [1580, -2485], townEnd]);
  b.road('Dublin Street', 'street', [[1380, -2365], [1380, -2485]]);
  b.road('Canterbury Street', 'street', [[1480, -2365], [1480, -2485]]);
  b.road('Oxford Street', 'street', [[1580, -2365], [1580, -2485]]);
  b.road('Gladstone Quay', 'lane', [[1420, -2365], [1420, -2292]], { width: 8 });
  mark(a, 'lyttelton-port', 'Port of Lyttelton', [1690, -2186], [1690, -2100]);
  mark(a, 'timeball-station', 'Timeball Station', [1772, -2428], [1772, -2330]);
  mark(a, 'country-pub', 'The Lighterman Hotel', [1530, -2455], [1530, -2425]);
  mark(a, 'war-memorial', 'Lyttelton War Memorial', [1340, -2392], [1340, -2365]);
  a.place('lyttelton-wharf', 'Lyttelton Wharf', [1428, -2300], [1420, -2300], LY, ['mission']);

  a.poly('port-hills', 'Port Hills', CH, 'rural', [[-600, -3160], [150, -3090], [420, -3020], [840, -3120], [1290, -3180], [1700, -3190], [2500, -3220], [2800, -2900], [2500, -2440], [1720, -2520], [1290, -2500], [700, -2430], [-100, -2440], [-600, -2600]], 1, 'Ngā Kōhatu Whakarakaraka o Tamatea Pōkai Whenua');
  a.rect('lyttelton-harbour', 'Lyttelton Harbour', LY, 'rural', 960, 2900, -2340, -1960, 0, 'Whakaraupō');
  a.rect('heathcote', 'Heathcote Valley', CH, 'township', 1310, 1720, -3440, -3190, 3);
  a.rect('lyttelton', 'Lyttelton', LY, 'township', 1310, 1690, -2520, -2372, 4, 'Ōhinehou');
  a.rect('lyttelton-port', 'Port of Lyttelton', LY, 'port', 1300, 1980, -2358, -2120, 4, 'Ōhinehou');
  a.rect('governors-bay', 'Governors Bay', LY, 'township', bay[0] - 120, bay[0] + 220, -2440, -2370, 3);
  return bay;
}
