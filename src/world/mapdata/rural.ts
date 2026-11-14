import type { Pt } from '../mapsource';
import { type Author, mark } from './helpers';
import { sh1At } from './highway';

/** The country between the towns: long straight shingle roads, woolsheds, and the odd crossroads settlement. */
export function buildRural(a: Author, governorsBay: Pt) {
  const gravel = (name: string, pts: Pt[]) => a.road(name, 'gravel', pts);
  const woolshed = (name: string, at: Pt, road: Pt) => mark(a, 'woolshed', name, at, road);

  // ── North of the Selwyn.
  gravel('Old West Coast Road', [[-2380, -3856], [-2350, -3600], [-2350, -2300]]);
  gravel('Shands Road', [[-1560, -3160], [-2350, -3160]]);
  gravel('Weedons Ross Road', [[-1300, -2760], [-2350, -2760]]);
  gravel('Burnham Road', [[-1700, -2300], [-2350, -2300]]);
  gravel('Dawsons Road', [[-1850, -3891], [-1850, -2300]]);
  gravel('Marshs Road', [[-1300, -3070], [-1000, -3050]]);
  gravel('Springs Road', [[-1060, -2850], [-900, -2650], [-800, -2500], [-700, -2200], [-700, -2110]]);
  gravel('Lincoln Rolleston Road', [[-1120, -2610], [-866, -2599]]);
  gravel('Tai Tapu Road', [[-800, -2500], [-500, -2380], [-200, -2335], governorsBay]);
  woolshed('Shands Road Woolshed', [-2050, -3118], [-2050, -3160]);
  woolshed('Weedons Woolshed', [-1600, -2718], [-1600, -2760]);
  mark(a, 'country-church', 'Lincoln Union Church', [-748, -2548], [-800, -2500]);
  a.rect('lincoln', 'Lincoln', null, 'township', -900, -690, -2600, -2420, 2);

  // ── Selwyn to the Rakaia.
  gravel('Hororata Dunsandel Road', [[-1560, -1820], [-2350, -1800]]);
  gravel('Leeston Dunsandel Road', [[-1120, -1790], [-500, -1720], [-150, -1620]]);
  gravel('Bankside Road', [[-2350, -1400], [-1300, -1400], [-500, -1380], [300, -1330]]);
  gravel('Sharlands Road', [[-1900, -1811], [-1900, -1400]]);
  gravel('Heslerton Road', [[-500, -1720], [-500, -1380]]);
  gravel('Southbridge Road', [[-150, -1620], [300, -1330], [900, -1260]]);
  woolshed('Bankside Woolshed', [-1700, -1358], [-1700, -1400]);
  woolshed('Heslerton Woolshed', [-640, -1340], [-640, -1384]);
  a.rect('leeston', 'Leeston', null, 'township', -260, -60, -1700, -1560, 2);
  a.rect('bankside', 'Bankside', null, 'rural', -3072, 2600, -1560, -1130, 0);

  // ── Rakaia to the Ashburton.
  gravel('Thompsons Track', [[-2350, -350], [-1300, -350]]);
  gravel('Dorie Road', [[-1300, -350], [0, -330], [1000, -300]]);
  gravel('Chertsey Road', [sh1At(-150), [-2350, -160]]);
  gravel('Chertsey Kyle Road', [sh1At(-60), [0, -40], [1000, -20]]);
  gravel('Winchmore Road', [[-1700, 120], [-2350, 140]]);
  gravel('Wakanui Road', [[-700, 440], [0, 450], [1000, 480], [1500, 500]]);
  gravel('Seafield Road', [[-700, 120], [500, 100], [1400, 80]]);
  gravel('Mitcham Road', [[-1950, -350], [-1950, 128]]);
  gravel('Pendarves Road', [[0, -330], [0, 450]]);
  gravel('Wakanui Beach Road', [[1000, -300], [1000, 480]]);
  woolshed('Thompsons Track Woolshed', [-1700, -308], [-1700, -350]);
  woolshed('Dorie Woolshed', [500, -272], [500, -315]);
  woolshed('Seafield Woolshed', [700, 55], [700, 97]);
  a.rect('chertsey', 'Chertsey', null, 'township', -1440, -1258, -200, -100, 2);

  // ── Ashburton to the Rangitata.
  gravel('Lagmhor Road', [sh1At(1040), [-2350, 1060]]);
  gravel('Longbeach Road', [sh1At(1040), [-300, 1060], [700, 1100], [1300, 1120]]);
  gravel('Boundary Road', [[-1400, 1250], [-2350, 1270]]);
  gravel('Hinds Lowcliffe Road', [sh1At(1390), [-300, 1400], [600, 1440]]);
  gravel('Maronan Road', [[-1900, 1050], [-1900, 1420]]);
  gravel('Coldstream Road', [[600, 1096], [600, 1440]]);
  woolshed('Boundary Road Woolshed', [-1800, 1216], [-1800, 1258]);
  a.place('hinds-woolshed', 'Boundary Road Woolshed', [-1800, 1250], [-1800, 1258], null, ['mission']);
  woolshed('Longbeach Woolshed', [-500, 1012], [-500, 1056]);
  gravel('Rangitata Island Road', [[-1100, 1790], [-760, 1790]]);
  a.poly('rangitata-island', 'Rangitata Island', null, 'rural', [[-1700, 1640], [-1100, 1720], [-450, 1720], [-750, 1860], [-1100, 1870], [-1450, 1780]], 2);

  // ── Rangitata to the Opihi.
  gravel('Orari Station Road', [[-1220, 2200], [-2350, 2180]]);
  gravel('Clandeboye Road', [sh1At(2260), [0, 2300], [900, 2330]]);
  gravel('Rangitata Mouth Road', [[900, 2330], [1150, 1970]]);
  gravel('Winchester Geraldine Road', [[-1100, 2484], [-2350, 2470]]);
  gravel('Milford Clandeboye Road', [sh1At(2620), [0, 2640], [700, 2660]]);
  gravel('Waitohi Road', [[-1060, 2860], [-2350, 2900]]);
  gravel('Milford Lagoon Road', [sh1At(2830), [0, 2850], [600, 2880]]);
  gravel('Coach Road', [[-1800, 2189], [-1800, 2883]]);
  gravel('Canal Road', [[0, 2300], [0, 2850]]);
  woolshed('Orari Station Woolshed', [-1500, 2152], [-1500, 2195]);
  woolshed('Clandeboye Woolshed', [300, 2692], [300, 2648]);
  woolshed('Waitohi Woolshed', [-1500, 2832], [-1500, 2874]);

  // ── Opihi to Timaru: the Levels plain and the downs behind the town.
  gravel('Levels Plain Road', [sh1At(3640), [-2300, 3600]]);
  gravel('Seadown Road', [sh1At(3700), [300, 3740], [700, 3760]]);
  gravel('Seadown Road', [[300, 3740], [200, 4040]]);
  gravel('Brosnan Road', [[-1500, 3617], [-1500, 3800]]);
  gravel('Gleniti Road', [[-1500, 3800], [-1500, 5000]]);
  gravel('Claremont Road', [[-1500, 5000], [-1900, 5100], [-2300, 5150]]);
  gravel('Beaconsfield Road', [[-300, 5500], [-1500, 5600], [-2200, 5650]]);
  woolshed('Levels Woolshed', [-1300, 3578], [-1300, 3622]);
  woolshed('Gleniti Woolshed', [-1542, 4400], [-1500, 4400]);
  woolshed('Seadown Woolshed', [520, 3708], [520, 3750]);
}
