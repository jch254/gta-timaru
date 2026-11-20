import type { Pt } from '../mapsource';
import { DEKKO_STAFF } from '../landmarks/timaru/dekko';
import { MILLSTONE_DOOR } from '../landmarks/timaru/millstone';
import { RINK_MALL_STAFF } from '../landmarks/timaru/rinkmall';
import { STOCKMANS_STAFF } from '../landmarks/timaru/stockmans';
import { type Author, facing, mark } from './helpers';
import { beside, sh1At } from './highway';

const TI = 'timaru' as const;
const WD = 'washdyke' as const;

/** A spot in a landmark's own frame (x across its front, z towards it, heading from its front). */
interface LocalSpot {
  x: number;
  z: number;
  heading: number;
  upstairs?: boolean;
}

/**
 * Places for the people who belong in a landmark (shop staff behind their counters, the door of a club), from
 * spots the landmark's builder publishes in its own frame. Tagged for the town-life system (missions/townlife.ts).
 */
function spots(a: Author, id: string, name: string, at: Pt, towards: Pt, list: readonly LocalSpot[], tags: string[]) {
  const h = facing(at, towards);
  const c = Math.cos(h);
  const s = Math.sin(h);
  list.forEach((p, i) => {
    const x = at[0] + p.x * c + p.z * s;
    const z = at[1] - p.x * s + p.z * c;
    a.b.place(`${id}-${i + 1}`, name, Math.round(x * 100) / 100, Math.round(z * 100) / 100, h + p.heading, TI, [...tags, ...(p.upstairs ? ['upstairs'] : [])]);
  });
}

/** Washdyke and Smithfield, then Timaru: the hill town, Caroline Bay, the port. Finishes the railway. */
export function buildTimaru(a: Author, rail: Pt[]) {
  const b = a.b;

  // ── Washdyke: the SH8 junction, saleyards, raceway and the industrial streets east of the highway.
  b.road('State Highway 8', 'highway', [sh1At(3900), [-700, 3860], [-1500, 3800], [-2300, 3790]], { speed: 100 });
  b.road('Meadows Road', 'street', [sh1At(4090), [-620, 4090]], { footpaths: false });
  b.road('Racecourse Road', 'street', [[-620, 4090], [-620, 4300], [-700, 4600], [-800, 4900]], { footpaths: false, speed: 70 });
  b.road('Treneglos Street', 'street', [sh1At(4040), [200, 4040]]);
  b.road('Elginshire Street', 'street', [sh1At(4180), [250, 4180]]);
  b.road('Sheffield Street', 'street', [[200, 4040], [200, 4180]]);
  mark(a, 'washdyke-saleyards', 'Washdyke Saleyards', [-300, 4010], [-300, 4090]);
  a.place('washdyke-saleyards', 'Washdyke Saleyards', [-300, 4082], [-300, 4090], WD, ['mission']);
  mark(a, 'phar-lap-raceway', 'Phar Lap Raceway', [-425, 4262], [-620, 4262]);
  mark(a, 'service-station', 'Washdyke Service Station', beside(4135, -36), sh1At(4135));
  mark(a, 'grain-silo', 'Washdyke Seed Store', [120, 4110], [120, 4040]);
  a.rect('washdyke', 'Washdyke', WD, 'industrial', -262, 420, 3930, 4335, 3, 'Waitarakao');

  // ── Smithfield: the freezing works on the shore between Washdyke and the bay.
  b.road('Bridge Road', 'street', [sh1At(4420), [230, 4522], [330, 4522], [362, 4500]], { footpaths: false });
  mark(a, 'smithfield-works', 'Smithfield Freezing Works', [340, 4368], [340, 4500]);
  a.place('smithfield-carpark', 'Smithfield Works Car Park', [352, 4494], [362, 4500], TI, ['mission']);
  a.rect('smithfield', 'Smithfield', TI, 'industrial', 130, 600, 4335, 4500, 3);

  // ── SH1 through town: Evans Street → Theodosia Street → Craigie Avenue → King Street.
  const evans: Pt[] = [sh1At(4500), [300, 4790]];
  b.road('Evans Street', 'highway', evans, { speed: 50, footpaths: true });
  b.road('Theodosia Street', 'highway', [[300, 4790], [308, 5000], [303, 5190]], { speed: 50, footpaths: true });
  b.road('Craigie Avenue', 'highway', [[303, 5190], [180, 5330]], { speed: 50, footpaths: true });
  b.road('King Street', 'highway', [[180, 5330], [165, 5600], [150, 5950]], { speed: 50, footpaths: true });

  // ── Stafford Street, one block seaward, kinking at North Street where two surveys met; the Bay Hill at its top.
  const stafford: Pt[] = [[430, 4790], [445, 4905], [452, 5000], [455, 5095], [452, 5190], [420, 5285], [392, 5380], [330, 5450], [172, 5490]];
  b.road('Stafford Street', 'street', stafford);
  b.road('Sophia Street', 'street', [[372, 4790], [378, 4905], [381, 5000], [385, 5095], [385, 5190], [385, 5285]]);
  b.road('The Bay Hill', 'street', [[430, 4790], [500, 4750], [565, 4735]]);
  b.road('Sefton Street', 'street', [[300, 4790], [372, 4790], [430, 4790]]);
  b.road('Le Cren Street', 'street', [[60, 4790], [300, 4790]]);
  b.road('Strathallan Street', 'street', [[60, 4905], [200, 4905], [305, 4905], [378, 4905], [445, 4905], [505, 4905]]);
  b.road('George Street', 'street', [[200, 5000], [308, 5000], [381, 5000], [452, 5000], [505, 5000]]);
  b.road('Church Street', 'street', [[60, 5095], [200, 5095], [305, 5095], [385, 5095], [455, 5095]]);
  // North Street runs on past Stafford Street and down the bank to the old flour mill by the railway.
  b.road('North Street', 'street', [[60, 5190], [200, 5190], [303, 5190], [385, 5190], [452, 5190], [492, 5193], [532, 5196]]);
  b.road('Canon Street', 'street', [[385, 5285], [420, 5285]]);
  b.road('Arthur Street', 'street', [[177, 5380], [392, 5380]]);
  b.road('Station Street', 'street', [[505, 4905], [505, 5000]]);
  b.road('Grey Road', 'street', [[200, 4790], [200, 5190]]);
  b.road('Selwyn Street', 'street', [[60, 4690], [60, 5380]]);
  b.road('Queen Street', 'street', [[60, 5060], [-12, 5060]]);
  b.road('Wai-iti Road', 'street', [[243, 4680], [60, 4690], [-200, 4720], [-500, 4800], [-800, 4900], [-1100, 4950], [-1500, 5000]], { smooth: true });
  b.road('Otipua Road', 'street', [[60, 5095], [-100, 5260], [-300, 5500], [-420, 5800], [-450, 5950]], { smooth: true });
  b.road('Morgans Road', 'street', [[-300, 4742.6], [-300, 5500]]);
  b.road('Elizabeth Street', 'street', [[60, 4905], [-300, 4905]]);
  b.road('Maltby Avenue', 'street', [[-80, 5239], [-300, 5239]]);
  b.road('Te Weka Street', 'street', [[186, 4570], [276, 4576]]);
  b.road('Wilson Street', 'street', [[165, 5600], [420, 5600]]);
  b.road('Hayes Street', 'street', [[392, 5380], [420, 5600], [420, 5800]]);
  b.road('Beverley Road', 'street', [[156, 5800], [420, 5800]]);
  // South Street, out along the top of the cliffs to the car park at Pātītī Point.
  b.road('South Street', 'street', [[404.5, 5480], [560, 5482], [702, 5478]]);

  // ── Caroline Bay below the Bay Hill, and the port on its moles and reclamation to the south-east.
  b.road('Virtue Avenue', 'street', [[565, 4735], [600, 4700], [606, 4480]], { footpaths: false, speed: 30 });
  b.road('Port Loop Road', 'street', [[565, 4735], [612, 4790], [632, 4860], [640, 4975], [640, 5100], [630, 5215]], { footpaths: false });
  b.road('Marine Parade', 'street', [[632, 4860], [700, 4832], [1080, 4830]], { footpaths: false, speed: 30 });
  b.road('Ritchie Street', 'lane', [[636.1, 5145], [930, 5145]], { width: 8 });
  b.road('Fraser Street', 'lane', [[630, 5215], [760, 5262]], { width: 8 });
  mark(a, 'caroline-bay-carnival', 'Caroline Bay Carnival', [520, 4532], [606, 4532]);
  mark(a, 'caroline-bay-soundshell', 'Caroline Bay Sound Shell', [545, 4655], [606, 4655]);
  mark(a, 'caroline-bay-tearooms', 'Caroline Bay Tearooms', [478, 4640], [545, 4655]);
  // The port stands on the reclamation with the harbour basin (and the wharf) behind it, to the north.
  mark(a, 'timaru-port', 'Port of Timaru', [800, 5009], [800, 5145]);
  mark(a, 'timaru-lighthouse', 'Blackett\'s Lighthouse', [300, 4592], [400, 4592]);
  mark(a, 'timaru-station', 'Timaru Railway Station', [562, 4952], [505, 4952]);
  mark(a, 'landing-service-building', 'Landing Service Building', [500, 5048], [500, 5000]);
  mark(a, 'timaru-basilica', 'Sacred Heart Basilica', [290, 5292], [241, 5262]);
  mark(a, 'timaru-hospital', 'Timaru Hospital', [-72, 4990], [-12, 5060]);
  mark(a, 'timaru-police', 'Timaru Police Station', [251, 5143], [251, 5190]);
  mark(a, 'country-church', "St Mary's Church", [345, 5049], [345, 5095]);
  mark(a, 'war-memorial', 'Timaru War Memorial', [130, 5000], [200, 5000]);
  mark(a, 'school', 'Highfield School', [-128, 4802], [-128, 4712]);
  mark(a, 'rugby-field', 'Fraser Park', [296, 5700], [296, 5600]);
  mark(a, 'service-station', 'Evans Street Service Station', [232, 4737], [264, 4720]);

  // ── The shops people remember (docs/research/11-timaru-landmarks.md), under invented names: the department
  // store and the discount store side by side on Stafford Street at Church Street, the arcade mall across the
  // road from them on the bank above the railway, the nightclub in the old flour mill at the bottom of North
  // Street, the Royal Arcade (under restoration in 1995), and the two suburban malls.
  mark(a, 'timaru-dept-store', 'Stockmans', [425.2, 5128], [454, 5128]);
  mark(a, 'timaru-discount-store', 'Dekko', [428.4, 5159], [453, 5159]);
  mark(a, 'timaru-arcade-mall', 'The Rink Mall', [482.7, 5122], [454.2, 5122]);
  mark(a, 'timaru-nightclub', 'The Millstone', [510, 5214.8], [510, 5190]);
  spots(a, 'staff-stockmans', 'Stockmans', [425.2, 5128], [454, 5128], STOCKMANS_STAFF, ['staff', 'shop:stockmans']);
  spots(a, 'staff-dekko', 'Dekko', [428.4, 5159], [453, 5159], DEKKO_STAFF, ['staff', 'shop:dekko']);
  spots(a, 'staff-rink', 'The Rink Mall', [482.7, 5122], [454.2, 5122], RINK_MALL_STAFF, ['staff', 'shop:rink']);
  spots(a, 'millstone-door', 'The Millstone', [510, 5214.8], [510, 5190], [MILLSTONE_DOOR], ['club-door']);
  // Friday and Saturday nights the boy racers park up at the Church Street lights and give it a bit.
  a.b.place('church-stafford', 'Church and Stafford', 455, 5095, 0, TI, ['burnouts']);
  mark(a, 'royal-arcade', 'Royal Arcade', [418.3, 5048], [453.6, 5048]);
  mark(a, 'northside-mall', 'Northside Mall', [290.7, 4680.7], [253.4, 4700]);
  mark(a, 'highfield-mall', 'Highfield Shopping Centre', [0, 4744.5], [3.5, 4697]);
  // ── Pātītī Point: the headland south of the port, its reserve, lookout and car park, South Beach below.
  mark(a, 'patiti-point', 'Patiti Point', [762, 5480], [700, 5478]);

  a.place('timaru-spawn', 'The Bay Hill', [503, 4756], [500, 4750], TI, ['spawn']);
  a.place('timaru-chipshop', "Aunty Rena's Chip Shop", [489, 4765], [485, 4758], TI, ['safehouse', 'mission']);
  a.place('timaru-port-lockup', 'Port Lock-up', [700, 5137], [700, 5145], TI, ['mission']);
  a.place('timaru-hospital', 'Timaru Hospital', [-10, 5052], [-10, 5060], TI, ['hospital']);
  a.place('timaru-police', 'Timaru Police Station', [251, 5182], [251, 5190], TI, ['police']);
  a.place('timaru-gunshop', 'South Canterbury Sports & Firearms', [439, 4950], [448, 4950], TI, ['gunshop']);
  a.place('timaru-panelbeater', 'Evans Street Panel & Paint', [203, 4625], [212, 4620], TI, ['spray']);
  a.place('caroline-bay', 'Caroline Bay Sound Shell', [597, 4655], [606, 4655], TI, ['mission']);

  // ── The Main South Line: in from Washdyke behind Smithfield, round the back of the bay, past the station.
  rail.push([250, 4482], [350, 4562], [402, 4640], [455, 4700], [545, 4744], [582, 4806], [586, 4905], [586, 5000], [583, 5100], [578, 5200], [572, 5262]);
  a.rail('Main South Line', rail);
  // Railway land (see Author.railReserve): wide at Washdyke, whose sheds have long frontages and whose line
  // stands well back from the highway; then round the back of the bay. The waterfront district covers the rest.
  a.railReserve('rail-washdyke', [[-298, 3800], [-40, 4100], [120, 4370]], 40, 10, 'Main South Line', WD);
  a.railReserve('rail-timaru', [[120, 4370], [250, 4482], [350, 4562], [402, 4640], [455, 4700], [545, 4744], [582, 4806]], 30, 30, 'Main South Line', TI);
  b.rail('Port Siding', [[586, 5010], [606, 5046], [630, 5066], [656, 5074]], 'siding');

  // ── Districts.
  a.rect('timaru-cbd', 'Timaru Central', TI, 'cbd', 405, 500, 4890, 5110, 6, 'Te Maru');
  a.rect('stafford', 'Timaru Central', TI, 'shops', 405, 548, 4790, 5300, 5, 'Te Maru');
  a.rect('bay-hill', 'The Bay Hill', TI, 'shops', 420, 580, 4722, 4800, 5);
  a.rect('timaru-central', 'Timaru Central', TI, 'township', 290, 405, 4790, 5400, 4, 'Te Maru');
  a.rect('caroline-bay-park', 'Caroline Bay', TI, 'park', 470, 614, 4430, 4700, 5);
  a.rect('caroline-bay', 'Caroline Bay', TI, 'beach', 614, 800, 4360, 4830, 5);
  a.rect('waterfront', 'Timaru Waterfront', TI, 'beach', 556, 624, 4790, 5300, 6);
  a.rect('port', 'Port of Timaru', TI, 'port', 624, 1140, 4800, 5320, 5);
  a.rect('maori-hill', 'Maori Hill', TI, 'villa', 100, 440, 4500, 4790, 3);
  a.rect('seaview', 'Seaview', TI, 'villa', 20, 290, 4790, 5400, 3);
  a.rect('highfield', 'Highfield', TI, 'villa', -340, 100, 4680, 5300, 2);
  a.rect('gleniti', 'Gleniti', TI, 'statehouse', -1150, -340, 4750, 5050, 2);
  a.rect('parkside', 'Parkside', TI, 'statehouse', 120, 480, 5400, 5960, 3);
  a.rect('watlington', 'Watlington', TI, 'statehouse', -480, 120, 5300, 5960, 2);
  a.rect('south-beach', 'South Beach', TI, 'beach', 755, 840, 5305, 5445, 5);
  a.rect('patiti-point', 'Patiti Point', TI, 'park', 600, 840, 5445, 5525, 5, 'Pātītī');
}
