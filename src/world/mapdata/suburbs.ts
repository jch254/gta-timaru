import { X, Z } from './christchurch';
import { type Author, mark, type RiverLine } from './helpers';

const CH = 'christchurch' as const;
const NB = 'newbrighton' as const;

/** The ring of Christchurch suburbs outside the four avenues, and New Brighton on the coast. */
export function buildSuburbs(a: Author, avon: RiverLine) {
  const b = a.b;

  // ── North: Merivale (west of Papanui Road) and St Albans.
  b.road('Papanui Road', 'arterial', [[-300, Z.bealey], [-320, -5300], [-350, -5650], [-370, -5960]], { lanes: 1, width: 11 });
  b.road('Colombo Street', 'street', [[0, Z.bealey], [0, -5700]]);
  b.road('Springfield Road', 'street', [[-150, Z.bealey], [-150, -5590]]);
  b.road('Manchester Street', 'street', [[X.manchester, Z.bealey], [X.manchester, -5350]]);
  b.road('Madras Street', 'street', [[X.madras, Z.bealey], [X.madras, -5350]]);
  b.road('Barbadoes Street', 'street', [[X.barbadoes, Z.bealey], [X.barbadoes, -5590]]);
  b.road('Hills Road', 'arterial', [[X.fitz, Z.bealey], [X.fitz, -5700], [600, -5960]], { lanes: 1, width: 11 });
  b.road('Purchas Street', 'street', [[-150, -5120], [X.fitz, -5120]]);
  b.road('Bishop Street', 'street', [[-150, -5235], [X.fitz, -5235]]);
  b.road('Edgeware Road', 'street', [[-323, -5350], [X.fitz, -5350]]);
  b.road('St Albans Street', 'street', [[-333, -5470], [0, -5470]]);
  b.road('Warrington Street', 'street', [[-150, -5590], [X.fitz, -5590]]);
  b.road('Innes Road', 'street', [[-354, -5700], [X.fitz, -5700]]);
  b.road('Carlton Mill Road', 'street', [[-305, -5120], [-520, -5120]]);
  b.road('Rossall Street', 'street', [[-520, -5120], [-520, -5590]]);
  b.road('Office Road', 'street', [[-316, -5235], [-700, -5235]]);
  b.road('Aikmans Road', 'street', [[-324, -5350], [-700, -5350]]);
  b.road('Rugby Street', 'street', [[-334, -5470], [-520, -5470]]);
  b.road('Heaton Street', 'street', [[-345, -5590], [-900, -5590]]);
  b.road('Glandovey Road', 'street', [[-700, -5235], [-700, -5350], [-900, -5590], [-1150, -5700]]);
  mark(a, 'marae', 'Rehua Marae', [-232, -5235], [-150, -5235]);
  mark(a, 'country-church', 'St Albans Church', [75, -5177], [75, -5120]);
  mark(a, 'school', 'St Albans School', [200, -5470], [200, -5350]);
  mark(a, 'war-memorial', 'Merivale War Memorial', [-290, -5268], [-316, -5268]);
  a.rect('merivale', 'Merivale', CH, 'villa', -800, -236, -5800, Z.bealey, 2);
  a.rect('merivale-shops', 'Merivale', CH, 'shops', -362, -275, -5330, -5140, 4);
  a.rect('st-albans', 'St Albans', CH, 'villa', -236, 600, -5800, Z.bealey, 2);
  a.rect('edgeware-shops', 'Edgeware', CH, 'shops', -40, 190, -5385, -5315, 4);
  a.rect('papanui', 'Papanui', CH, 'statehouse', -800, 700, -5990, -5800, 2);

  // ── West: Fendalton, Riccarton, Ilam. Riccarton Road is SH73, not SH1.
  b.road('Fendalton Road', 'arterial', [[X.deans, -4850], [-1150, -4880], [-1600, -4900]], { lanes: 1, width: 11 });
  b.road('Memorial Avenue', 'arterial', [[-1600, -4900], [-2100, -5000], [-2380, -5130]], { lanes: 1, width: 11, footpaths: false, speed: 70 });
  b.road('Riccarton Road', 'arterial', [[X.deans, -3900], [-1700, -3900]], { lanes: 1, width: 11 });
  b.road('Yaldhurst Road', 'arterial', [[-1700, -3900], [-2050, -3880], [-2380, -3856]], { lanes: 1, width: 11, footpaths: false, speed: 70 });
  b.road('Clarence Street', 'street', [[-900, -3581], [-900, -3900]]);
  b.road('Straven Road', 'street', [[-900, -3900], [-900, -4862]]);
  b.road('Matipo Street', 'street', [[-1100, -3540], [-1100, -3900]]);
  b.road('Clyde Road', 'street', [[-1100, -3900], [-1100, -4877], [-1100, -5060]]);
  b.road('Middleton Road', 'street', [[-1350, -3650], [-1350, -3900]]);
  b.road('Ilam Road', 'street', [[-1350, -3900], [-1350, -4890]]);
  b.road('Waimairi Road', 'street', [[-1700, -3900], [-1700, -4905]]);
  b.road('Peverel Street', 'street', [[-900, -3760], [-1350, -3760]]);
  b.road('Kilmarnock Street', 'street', [[X.deans, -4060], [-900, -4060]]);
  b.road('Rata Street', 'street', [[-1100, -4060], [-1350, -4060]]);
  b.road('Kahu Road', 'street', [[X.deans, -4300], [-900, -4300]]);
  b.road('Creyke Road', 'street', [[-1100, -4300], [-1700, -4300]]);
  b.road('Totara Street', 'street', [[X.deans, -4560], [-1350, -4560]]);
  b.road('Maidstone Road', 'street', [[-1350, -4560], [-1700, -4560], [-2050, -4560]]);
  b.road('Peer Street', 'street', [[-1700, -4120], [-2050, -4120]]);
  b.road('Avonhead Road', 'street', [[-2050, -3880], [-2050, -4120], [-2050, -4560], [-2100, -5000]]);
  mark(a, 'rugby-field', 'Ilam Fields', [-1525, -4430], [-1525, -4300]);
  mark(a, 'school', 'Riccarton High School', [-1225, -3655], [-1225, -3760]);
  mark(a, 'service-station', 'Riccarton Road Service Station', [-1500, -3862], [-1500, -3900]);
  a.rect('fendalton', 'Fendalton', CH, 'villa', -2000, X.deans, -5400, -4440, 2);
  a.rect('riccarton', 'Riccarton', CH, 'villa', -1720, X.deans, -4440, -3640, 2);
  a.rect('riccarton-shops', 'Riccarton', CH, 'shops', -1400, X.deans - 20, -3935, -3865, 4);
  a.rect('riccarton-bush', 'Riccarton Bush', CH, 'park', -1090, -910, -4290, -4070, 5);
  a.rect('ilam', 'Ilam', CH, 'statehouse', -2300, -1720, -4700, -3700, 2);
  a.rect('avonhead', 'Avonhead', CH, 'statehouse', -2300, -2000, -5100, -4700, 2);

  // ── South: Sydenham (the Moorhouse Avenue strip), Addington, Beckenham, Cashmere at the foot of the hills.
  b.road('Colombo Street', 'street', [[0, Z.moorhouse], [0, -3262]]);
  b.road('Durham Street South', 'street', [[X.durham, Z.moorhouse], [X.durham, -3440]]);
  b.road('Wordsworth Street', 'street', [[X.durham, -3520], [0, -3520]]);
  b.road('Brougham Street', 'arterial', [[X.barbadoes, -3440], [-623, -3440]], { lanes: 1, width: 11 });
  b.road('Waltham Road', 'street', [[X.barbadoes, Z.moorhouse], [X.barbadoes, -3262]]);
  b.road('Selwyn Street', 'street', [[X.park, Z.moorhouse], [X.park, -3268]]);
  b.road('Milton Street', 'street', [[X.park, -3345], [0, -3345]]);
  b.road('Tennyson Street', 'street', [[0, -3345], [X.barbadoes, -3345]]);
  b.road('Lincoln Road', 'arterial', [[X.park, Z.moorhouse], [-800, -3300]], { lanes: 1, width: 11 });
  b.road('Halswell Road', 'arterial', [[-800, -3300], [-1000, -3050], [-1060, -2850]], { lanes: 1, width: 11, footpaths: false, speed: 70 });
  b.road('Halswell Junction Road', 'street', [[-1060, -2850], [-1300, -2760]], { footpaths: false, speed: 70 });
  b.road('Whiteleigh Avenue', 'street', [[-860, -3586], [-860, -3440], [-800, -3300]]);
  b.road('Jerrold Street', 'street', [[-623, -3440], [-860, -3440]]);
  b.road('Cashmere Road', 'street', [[-800, -3300], [X.park, -3268], [0, -3262]]);
  b.road('Centaurus Road', 'street', [[0, -3262], [X.barbadoes, -3262], [815, -3255]]);
  b.road('Port Hills Road', 'street', [[815, -3255], [1050, -3275], [1300, -3330]], { footpaths: false, speed: 60 });
  mark(a, 'addington-station', 'Christchurch Railway Station', [-675, -3518], [-675, -3545]);
  mark(a, 'country-pub', 'The Tannery Arms', [35, -3400], [0, -3400]);
  a.place('chch-garage', "Dazza's Workshop", [-320, Z.moorhouse + 11.5], [-320, Z.moorhouse], CH, ['safehouse', 'mission']);
  a.place('chch-panelbeater', 'Sydenham Panel & Paint', [X.durham + 12, -3478], [X.durham, -3478], CH, ['spray']);
  a.rect('sydenham', 'Sydenham', CH, 'industrial', X.park, X.fitz, Z.stAsaph, -3440, 3);
  a.rect('addington', 'Addington', CH, 'villa', -1000, X.park, Z.moorhouse, -3290, 2);
  a.rect('addington-yards', 'Addington', CH, 'industrial', -820, -560, Z.moorhouse + 20, -3450, 3);
  a.rect('beckenham', 'Beckenham', CH, 'villa', X.park, X.barbadoes, -3440, -3270, 2);
  a.poly('cashmere', 'Cashmere', CH, 'villa', [[-460, -3270], [840, -3262], [840, -3120], [420, -3020], [150, -3090], [-460, -3160]], 2);

  // ── South-east: Waltham and Lancaster Park, Woolston along Ferry Road, Heathcote Valley and the tunnel road.
  b.road('Ferry Road', 'arterial', [[X.fitz, -3655], [760, -3602], [1000, -3548], [1300, -3480], [1700, -3440], [1900, -3430]], { lanes: 1, width: 11 });
  b.road('Lancaster Street', 'street', [[585, -3642], [585, -3325]]);
  b.road('Stevens Street', 'street', [[585, -3555], [815, -3555]]);
  b.road('Wilsons Road', 'street', [[815, -3590], [815, -3255]]);
  b.road('Shakespeare Road', 'street', [[X.barbadoes, -3325], [585, -3325], [815, -3325]]);
  b.road('Ensors Road', 'street', [[1000, -3548], [1000, -3285]]);
  b.road('Rutherford Street', 'street', [[1150, -3514], [1150, -3298]]);
  b.road('Garlands Road', 'street', [[815, -3420], [1300, -3420]]);
  mark(a, 'lancaster-park', 'Lancaster Park', [700, -3440], [700, -3555]);
  a.place('lancaster-park', 'Lancaster Park Gates', [700, -3548], [700, -3555], CH, ['mission']);
  mark(a, 'grain-silo', 'Woolston Maltworks', [1420, -3412], [1420, -3458]);
  a.rect('waltham', 'Waltham', CH, 'statehouse', X.barbadoes, 1000, Z.moorhouse, -3262, 2);
  a.rect('phillipstown', 'Phillipstown', CH, 'statehouse', X.fitz, 1000, -3815, Z.moorhouse, 2);
  a.rect('woolston', 'Woolston', CH, 'industrial', 1000, 1900, -3640, -3345, 2);
  a.rect('opawa', 'Opawa', CH, 'villa', 1000, 1290, -3345, -3270, 3);

  // ── East: Linwood (state houses), Richmond north of the river, Aranui, Bromley.
  b.road('England Street', 'street', [[645, Z.armagh], [645, Z.cashel]]);
  a.road('Stanmore Road', 'street', [[760, -4900], [760, -3602]]);
  b.road('Olliviers Road', 'street', [[880, Z.armagh], [880, Z.tuam]]);
  a.road('Swanns Road', 'street', [[1000, -4900], [1000, Z.armagh]]);
  b.road('Aldwins Road', 'street', [[1000, Z.armagh], [1000, -3548]]);
  a.terrace('Avonside Drive', avon, -1, [X.fitz, -4650], [1000, -4776], 24);
  b.road('North Avon Road', 'street', [[X.fitz, -4900], [1150, -4900]]);
  b.road('New Brighton Road', 'street', [[1150, -4900], [1420, -4865], [1660, -4800], [1900, -4735], [2060, -4660], [2300, -4630], [2530, -4630]], { smooth: true });
  b.road('Linwood Avenue', 'arterial', [[1000, Z.cashel], [1300, -3900]], { lanes: 1, width: 11 });
  a.road('Pages Road', 'arterial', [[1000, Z.gloucester], [1500, -4420], [2000, -4420], [2200, -4410]], { lanes: 1, width: 11, bridgeName: 'Pages Road Bridge' });
  b.road('Wainoni Road', 'street', [[1150, -4900], [1300, -4580], [1950, -4580]]);
  b.road('Breezes Road', 'street', [[1300, -4580], [1300, -4280]]);
  b.road('Dyers Road', 'arterial', [[1300, -4280], [1300, -3480]], { lanes: 1, width: 11, footpaths: false, speed: 70 });
  b.road('Shortland Street', 'street', [[1500, -4580], [1500, -4280]]);
  b.road('Portsmouth Street', 'street', [[1800, -4580], [1800, -4280]]);
  b.road('Hampshire Street', 'street', [[1300, -4280], [1950, -4280]]);
  b.road('Bexley Road', 'street', [[1950, -4580], [1950, -4280]]);
  // North-east: Marshland Road and the road round the top of the city to North Beach.
  b.road('Marshland Road', 'street', [[1150, -4900], [1150, -5700], [1150, -5940]], { footpaths: false, speed: 70 });
  b.road('Queen Elizabeth II Drive', 'arterial', [[X.fitz, -5700], [1150, -5700], [2000, -5700], [2530, -5700]], { lanes: 1, width: 11, footpaths: false, speed: 70 });
  b.road('Burwood Road', 'street', [[1600, -4816], [1600, -5700]]);
  b.road('Mairehau Road', 'street', [[1150, -5300], [1600, -5300]]);
  a.rect('burwood', 'Burwood', CH, 'statehouse', 1160, 2100, -5690, -5000, 1);
  a.rect('north-beach', 'North New Brighton', NB, 'statehouse', 2300, 2552, -5690, -4800, 2);
  mark(a, 'marae', 'Ngā Hau e Whā', [1650, -4350], [1650, -4420]);
  mark(a, 'school', 'Linwood High School', [1150, -4290], [1150, -4415]);
  mark(a, 'rugby-field', 'Linwood Park', [1130, -4135], [1000, -4135]);
  mark(a, 'service-station', 'Pages Road Service Station', [1400, -4458], [1400, -4420]);
  a.rect('linwood', 'Linwood', CH, 'statehouse', X.fitz, 1290, -4640, -3815, 2);
  a.rect('linwood-shops', 'Linwood', CH, 'shops', 700, 820, -4450, -4380, 4);
  a.rect('avonside', 'Avonside', CH, 'villa', X.fitz, 1150, -4720, -4640, 3);
  a.rect('richmond', 'Richmond', CH, 'villa', X.fitz, 1150, -5300, -4720, 2);
  a.rect('wainoni', 'Wainoni', CH, 'statehouse', 1150, 2080, -5000, -4590, 2);
  a.rect('aranui', 'Aranui', CH, 'statehouse', 1290, 2040, -4590, -4150, 2);
  a.rect('bromley', 'Bromley', CH, 'industrial', 1150, 1500, -4150, -3640, 2);

  // ── New Brighton: Seaview Road, the pedestrian mall (in decline by 1995), Marine Parade, the beach. No pier yet.
  b.road('Seaview Road', 'street', [[2200, -4410], [2360, -4410]]);
  b.road('New Brighton Mall', 'pedestrian', [[2360, -4410], [2530, -4410]], { width: 14 });
  b.road('Marine Parade', 'street', [[2530, -5700], [2530, -4110]]);
  b.road('Hawke Street', 'street', [[2200, -4520], [2530, -4520]]);
  b.road('Beresford Street', 'street', [[2200, -4300], [2530, -4300]]);
  b.road('Union Street', 'street', [[2200, -4636], [2200, -4300]]);
  b.road('Oram Avenue', 'street', [[2360, -4630], [2360, -4190], [2530, -4190]]);
  mark(a, 'new-brighton-mall', 'New Brighton Mall', [2445, -4410], [2530, -4410]);
  mark(a, 'war-memorial', 'New Brighton War Memorial', [2556, -4372], [2530, -4372]);
  a.place('new-brighton-beach', 'New Brighton Beach', [2540, -4416], [2530, -4416], NB, ['mission']);
  a.rect('new-brighton', 'New Brighton', NB, 'statehouse', 2120, 2552, -4800, -4090, 3);
  a.rect('new-brighton-shops', 'New Brighton', NB, 'shops', 2210, 2520, -4460, -4360, 5);
  a.rect('new-brighton-beach', 'New Brighton Beach', NB, 'beach', 2552, 2800, -5900, -4040, 4);
  a.rect('estuary', 'Avon-Heathcote Estuary', CH, 'beach', 2080, 2800, -4040, -3520, 3);
}
