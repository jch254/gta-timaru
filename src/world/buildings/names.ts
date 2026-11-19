import type { Mat, Rand, Site } from './kit';
import { agedSign } from './weathering';

/**
 * Every business in the game is invented here. Real place names are fine (and used for "<suburb> Dairy"),
 * but no real company, chain, brand or person. Names lean on Canterbury: nor'westers, braided rivers,
 * sheep, pies and the odd pun.
 *
 * Signs share texture atlas pages, and each distinct (text, look, aspect) takes a cell for the whole
 * session, so the look of a sign is derived from its text (never rolled per building) and the pools are
 * kept to a few hundred strings in total.
 */

export interface Look {
  bg: string;
  fg: string;
  style: 'paint' | 'block' | 'script' | 'neon';
  border?: false;
}

const k = (bg: string, fg: string, style: Look['style'] = 'paint'): Look => ({ bg, fg, style });

/** Hand-painted shop boards. */
export const CLASSIC: readonly Look[] = [
  k('#f2ead6', '#1d2a44'),
  k('#8a1f1f', '#f6edd0'),
  k('#1f4a36', '#f6edd0'),
  k('#f0c33a', '#1c1c1c', 'block'),
  k('#1d2a44', '#f6edd0'),
  k('#f6edd0', '#8a1f1f', 'block'),
  k('#2b2b2b', '#f0c33a', 'block'),
  k('#e8dcc0', '#3a2a1a', 'script'),
  k('#d8e6e2', '#1f4a4a'),
  k('#6b3a2a', '#f2e2b8', 'script'),
];
/** Plain trade signage for sheds and yards. */
export const TRADE: readonly Look[] = [
  k('#e9e4d6', '#222222', 'block'),
  k('#1d2a44', '#f6edd0', 'block'),
  k('#b5261e', '#fff6e0', 'block'),
  k('#f0c33a', '#1c1c1c', 'block'),
  k('#2d5f3b', '#f6edd0', 'block'),
  k('#f6f2e6', '#1f3f7a', 'block'),
];
/** Lettering cut into or painted onto stonework. */
export const STONE: readonly Look[] = [
  { bg: '#d9d2bd', fg: '#3a352c', style: 'paint', border: false },
  { bg: '#cfc8b6', fg: '#2c2a26', style: 'paint', border: false },
];
/** Faded lettering painted straight onto a brick or iron wall. */
export const WALL_PAINT: readonly Look[] = [
  { bg: '#e6e0d0', fg: '#2a2a2a', style: 'block', border: false },
  { bg: '#d8d0bc', fg: '#5a1f1a', style: 'paint', border: false },
];
export const NEON: readonly Look[] = [
  k('#15121a', '#ff5a4a', 'neon'),
  k('#10161c', '#4ad8ff', 'neon'),
  k('#14140f', '#ffd84a', 'neon'),
  k('#101a12', '#7dff8a', 'neon'),
  k('#1a1016', '#ff7ad0', 'neon'),
];
export const CHALK: readonly Look[] = [k('#22272a', '#f2f2ea', 'script'), k('#f6edd0', '#8a1f1f'), k('#f0c33a', '#1c1c1c', 'block')];
const RED_WHITE: readonly Look[] = [k('#f6f0e2', '#9a1c1c', 'block'), k('#9a1c1c', '#fff6e0'), k('#1d2a44', '#f6edd0')];
const APOTHECARY: readonly Look[] = [k('#f4f1e6', '#1f4a36'), k('#1f4a36', '#f6edd0'), k('#f4f1e6', '#1f3f7a', 'block')];
const SCRIPTY: readonly Look[] = [k('#e8dcc0', '#3a2a1a', 'script'), k('#6b3a2a', '#f2e2b8', 'script'), k('#f2d9d9', '#6a1f3a', 'script'), k('#d8e6e2', '#1f4a4a', 'script')];
const NAVY: readonly Look[] = [k('#1d2a44', '#f6edd0', 'block'), k('#f6edd0', '#1d2a44', 'block')];
const BETTING: readonly Look[] = [k('#1d2a44', '#f0c33a', 'block')];

export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ (h >>> 15)) >>> 0;
}

/** Break a long name over two lines near its middle. */
export function wrap(text: string, limit = 13): string {
  if (text.length <= limit || text.includes('\n')) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** Sign material for a text; its colours and lettering always come out the same for the same words. */
export function signMat(s: Site, text: string, aspect: number, looks: readonly Look[] = CLASSIC): Mat {
  const h = hashText(text);
  const look = looks[h % looks.length];
  const m = look.border === false ? s.m.sign(text, { bg: look.bg, fg: look.fg, style: look.style, aspect, border: false }) : s.m.sign(text, { bg: look.bg, fg: look.fg, style: look.style, aspect });
  if (look.style === 'neon') return m;
  // Nobody has repainted it lately: some boards a little, some a lot, lettering on a bare wall most of all.
  const wear = { ...s.wear, seed: (s.wear.seed + (h >>> 5)) & 63, age: Math.max(0, Math.min(7, s.wear.age + ((h >>> 3) % 4) - 2)) };
  return agedSign(s.m, m, wear, looks === WALL_PAINT);
}

/** A sign board centred at (x, y, z), `w` wide, on a wall facing `yaw`. */
export function board(s: Site, text: string, x: number, y: number, z: number, w: number, aspect: number, looks: readonly Look[] = CLASSIC, yaw = 0) {
  s.out.quad(s.f, x, y, z, w, w / aspect, signMat(s, text, aspect, looks), yaw);
}

/** The suburb or town in capitals, when it is short enough to head a sign. */
export function locality(s: Site, max = 11): string | null {
  const name = s.lot.district.name
    .toUpperCase()
    .replace(/\s+(CENTRAL|CITY|NORTH|SOUTH|EAST|WEST)$/, '')
    .replace(/^THE\s+/, '');
  if (name.length < 3 || name.length > max || name.includes('PLAINS')) return null;
  return name;
}

// ───────────────────────────── Shop trades ─────────────────────────────

export type StreetItem = 'board' | 'bench' | 'bin' | 'cone' | 'postbox' | 'phone' | 'crates';

export interface Trade {
  id: string;
  /** Relative frequency: suburban shop strips, small-town main streets, the central city. */
  mix: readonly [shops: number, township: number, cbd: number];
  /** Weight multiplier on a street corner. */
  corner?: number;
  names: readonly string[];
  /** Makes "<SUBURB> <local>" an option, e.g. MERIVALE DAIRY. */
  local?: string;
  /** Second line of signage for the verandah fascia. */
  tags: readonly string[];
  looks?: readonly Look[];
  neon?: readonly string[];
  /** Sandwich-board texts. */
  boards?: readonly string[];
  street?: readonly StreetItem[];
  /** Chance of a light under the verandah at night. */
  light?: number;
}

export const TRADES: readonly Trade[] = [
  {
    id: 'dairy',
    mix: [10, 6, 1],
    corner: 3,
    names: ['KOWHAI DAIRY', 'SUNRISE DAIRY', 'FANTAIL DAIRY', 'BLUE GATE DAIRY', 'HILLTOP DAIRY', 'THE LOLLY JAR', 'HAPPY DAYS DAIRY', 'DAWN TO DUSK DAIRY'],
    local: 'DAIRY',
    tags: ['MILK · BREAD · PAPERS', 'ICE CREAMS · LOLLIES · PIES', 'SCRATCH & WIN · OPEN 7 DAYS'],
    boards: ['ICE\nCREAM', 'PIES\n$2', 'MILK &\nBREAD'],
    street: ['cone', 'board', 'bin', 'crates', 'phone'],
    light: 0.55,
  },
  {
    id: 'chippy',
    mix: [7, 5, 1],
    corner: 1.5,
    names: ['THE BATTERED COD', 'OH MY COD', 'THE GOLDEN FRYER', 'THE SALTY SCOOP', 'SCOOP & SHAKE', "NEPTUNE'S BASKET", 'THE CHIP INN'],
    tags: ['FISH & CHIPS', 'BURGERS · HOT DOGS · SHAKES', 'FRESH BLUE COD DAILY'],
    neon: ['FISH & CHIPS', 'OPEN'],
    boards: ['FISH &\nCHIPS', 'SCOOP\n$1', 'WHITEBAIT\nIN SEASON'],
    street: ['board', 'bin', 'bench'],
    light: 0.85,
  },
  {
    id: 'takeaways',
    mix: [5, 3, 2],
    names: ['THE PIE CART', 'THE HUNGRY WEKA', "BIG AL'S BURGER BAR", 'LUCKY STAR TAKEAWAYS', 'THE BURGER SHED', 'PIE IN THE SKY'],
    tags: ['BURGERS · CHIPS · SHAKES', 'CHINESE & EUROPEAN MEALS', 'OPEN LATE'],
    neon: ['TAKEAWAYS', 'OPEN', 'BURGERS'],
    boards: ['OPEN\nLATE', 'BURGER\n$3'],
    street: ['bin', 'board'],
    light: 0.85,
  },
  {
    id: 'video',
    mix: [6, 2, 2],
    names: ['REWIND VIDEO', 'BE KIND VIDEO HIRE', 'NIGHT OWL VIDEO', 'SILVER SCREEN VIDEO', 'TRACKING VIDEO', 'THE VIDEO CABIN'],
    tags: ['NEW RELEASES · WEEKLIES', '5 WEEKLIES $5 TUESDAYS', 'MOVIES · GAMES · SNACKS'],
    neon: ['VIDEO', 'OPEN'],
    boards: ['NEW\nMOVIES', 'VIDEOS\n$2'],
    street: ['board', 'bin'],
    light: 0.6,
  },
  {
    id: 'bakery',
    mix: [6, 5, 2],
    names: ["BAKER'S DOZEN BAKERY", 'CRUMB & CRUST BAKERY', 'THE PIE WARMER', "CRUSTY'S BAKEHOUSE", 'RISE & SHINE BAKERY', 'LAMINGTON LANE'],
    tags: ['HOT PIES · FILLED ROLLS', 'FRESH BREAD DAILY', 'CREAM BUNS · SLICES · LAMINGTONS'],
    boards: ['HOT\nPIES', 'FRESH\nBREAD'],
    street: ['board', 'bench', 'bin'],
    light: 0.3,
  },
  {
    id: 'butcher',
    mix: [5, 5, 1],
    names: ['GLEESON & SONS BUTCHERS', 'THE CHOP SHOP', 'PLAINS BUTCHERY', 'HALLORAN FAMILY BUTCHER', 'SNARLERS & CHOPS', 'TOP PADDOCK MEATS'],
    tags: ['SMALLGOODS · HOMEKILL', 'SAUSAGES OUR SPECIALTY', 'CANTERBURY LAMB'],
    looks: RED_WHITE,
    boards: ['SNAGS\n$4 KG', 'LAMB\nCHOPS'],
    street: ['board'],
  },
  {
    id: 'chemist',
    mix: [5, 4, 3],
    names: ['CORNER CHEMIST', 'THE DISPENSARY', "TREGEAR'S PHARMACY", 'PESTLE & MORTAR', 'QUINN & DAUGHTERS CHEMISTS'],
    local: 'PHARMACY',
    tags: ['PRESCRIPTIONS · COSMETICS', 'PHOTOS IN 1 HOUR', 'FILMS DEVELOPED HERE'],
    looks: APOTHECARY,
    street: ['bench'],
  },
  {
    id: 'opshop',
    mix: [4, 3, 1],
    names: ['SECOND CHANCE OP SHOP', 'NIFTY THRIFTY', 'HAND-ME-DOWNS', "ST. MARTHA'S OPPORTUNITY SHOP", 'THE TROVE'],
    tags: ['CLOTHING · BOOKS · BRIC-A-BRAC', 'DONATIONS WELCOME'],
    boards: ['BAG\nSALE', 'ALL\n50c'],
    street: ['board', 'crates'],
  },
  {
    id: 'post',
    mix: [3, 4, 1],
    names: ['POST SHOP'],
    local: 'POST SHOP',
    tags: ['STAMPS · PARCELS · STATIONERY', 'POST · PAY BILLS HERE'],
    looks: NAVY,
    street: ['postbox', 'phone', 'bench'],
  },
  {
    // Racing bets only in 1995: gallops, trots and the dogs. Sports betting came later.
    id: 'tab',
    mix: [3, 2, 2],
    names: ['TOTE AGENCY'],
    tags: ['RACING · TROTS · DOGS', 'GALLOPS · HARNESS · GREYHOUNDS'],
    looks: BETTING,
    boards: ['TOTE\nOPEN', 'SAT\nGALLOPS'],
    street: ['bin', 'board'],
  },
  {
    id: 'hair',
    mix: [5, 3, 3],
    names: ['HAIR BY SHAZ', 'SHEAR DELIGHT', 'THE CUTTING SHED', "KEV'S BARBER SHOP", 'A CUT ABOVE', "SNIP 'N' SET"],
    tags: ['PERMS · SETS · TINTS', 'GENTS CUTS $8', 'UNISEX SALON'],
    looks: SCRIPTY,
  },
  {
    id: 'books',
    mix: [3, 2, 4],
    names: ['THE DOG-EARED PAGE', 'BOOK EXCHANGE', 'PAGE & TURNER BOOKSELLERS', 'PENNY DREADFULS', 'INKWELL STATIONERS'],
    tags: ['BOOKS BOUGHT & SOLD', 'COMICS · MAGAZINES · SWAPS', 'CARDS · MAPS · STATIONERY'],
    boards: ['BOOKS\n50c'],
    street: ['board', 'crates'],
  },
  {
    id: 'hardware',
    mix: [3, 4, 1],
    names: ['NUTS & BOLTS HARDWARE', 'HALF-INCH HARDWARE', "THE HANDYMAN'S SHED", 'TREGEAR & SONS IRONMONGERS'],
    tags: ['PAINT · TOOLS · KEYS CUT', 'GARDEN & FARM SUPPLIES'],
    street: ['crates'],
  },
  {
    id: 'drapery',
    mix: [3, 3, 5],
    names: ["PEMBERTON'S MENSWEAR", 'THE GENTS OUTFITTER', 'WOOL & WORSTED DRAPERS', 'SUNDAY BEST FASHIONS', 'FROCKS & SMOCKS'],
    tags: ['SUITS · SCHOOL UNIFORMS', 'LADIES & GENTS FASHIONS', 'WALK SHORTS · SOCKS · TIES'],
  },
  {
    id: 'appliances',
    mix: [3, 2, 3],
    names: ["SPARKY'S APPLIANCES", 'SPARKS & VALVES RADIO SERVICE', 'TELLY & TOASTER', "REID'S RADIO & TELEVISION"],
    tags: ['TV · VIDEO · WHITEWARE', 'RENTALS · REPAIRS · AERIALS'],
    light: 0.4,
  },
  {
    id: 'fruit',
    mix: [4, 3, 1],
    names: ['THE APPLE CART', 'ORCHARD GATE FRUIT & VEG', 'SPUD & SPROUT GREENGROCER', 'GREEN FINGERS PRODUCE'],
    tags: ['FRESH FRUIT & VEGETABLES', 'SPUDS · PUMPKINS · NEW SEASON APPLES'],
    boards: ['SPUDS\n$2 BAG', 'FRESH\nPEAS'],
    street: ['crates', 'board'],
  },
  {
    id: 'sports',
    mix: [2, 2, 3],
    names: ['THE SCRUM SPORTS', 'FULLBACK SPORTS', 'HOOK, LINE & SINKER', 'SPORTS & TROPHIES'],
    tags: ['RUGBY · CRICKET · NETBALL', 'FISHING · CAMPING · TROPHIES'],
  },
  {
    id: 'records',
    mix: [2, 0, 4],
    names: ['SIDE B RECORDS & TAPES', 'SPIN CYCLE RECORDS', 'NEEDLE DROP RECORDS', '03 RECORDS'],
    tags: ['CDs · TAPES · VINYL', 'CONCERT TICKETS HERE'],
    neon: ['RECORDS'],
  },
  {
    id: 'wool',
    mix: [2, 2, 2],
    names: ['KNIT ONE PURL ONE', 'THE WOOL BASKET', 'BUTTONS & BOWS'],
    tags: ['KNITTING WOOL · PATTERNS', 'HABERDASHERY · FABRICS'],
    looks: SCRIPTY,
  },
  {
    id: 'florist',
    mix: [2, 1, 3],
    names: ['PETAL PUSHERS', 'THE POSY PLACE', 'DAFFODIL DELL FLORIST'],
    tags: ['FLOWERS · WREATHS · GIFTS'],
    looks: SCRIPTY,
    street: ['crates'],
  },
  {
    id: 'shoes',
    mix: [2, 1, 3],
    names: ['SOLE MAN SHOE REPAIRS', 'WELL HEELED SHOES', 'JANDAL & BOOT'],
    tags: ['SHOE REPAIRS · KEYS CUT', 'GUMBOOTS · JANDALS · SCHOOL SHOES'],
  },
  {
    id: 'tearooms',
    mix: [4, 5, 5],
    names: ['THE WHISTLING KETTLE', 'DEVONSHIRE TEAROOMS', 'AORAKI TEAROOMS', 'THE LAMINGTON TEAROOMS', 'STARLIGHT MILK BAR', 'CUPPA & CAKE'],
    tags: ['MORNING TEAS · LUNCHES', 'CHEESE ROLLS · SCONES · SAVOURIES', 'MILKSHAKES · THICKSHAKES · SPIDERS'],
    looks: SCRIPTY,
    boards: ['CUPPA\n& SCONE', 'HOT\nLUNCH'],
    street: ['board', 'bench'],
    light: 0.3,
  },
  {
    id: 'bikes',
    mix: [2, 1, 2],
    names: ["PUSHBIKE PETE'S", 'FREEWHEEL CYCLES', 'TEN SPEED CYCLES'],
    tags: ['CYCLES · REPAIRS · PARTS'],
  },
  {
    id: 'pets',
    mix: [1, 0, 1],
    names: ['FUR, FIN & FEATHER'],
    tags: ['BUDGIES · GOLDFISH · PET FOOD'],
  },
  {
    id: 'realty',
    mix: [2, 2, 4],
    names: ['QUARTER ACRE REALTY', 'SOLD ON IT REAL ESTATE'],
    tags: ['HOUSES · SECTIONS · FARMS', 'OPEN SATURDAYS · PH 03 365 1903'],
    looks: NAVY,
  },
  {
    id: 'travel',
    mix: [1, 0, 4],
    names: ['LONG HAUL TRAVEL', 'BIG O.E. TRAVEL'],
    tags: ['FLIGHTS · COACH TOURS · CRUISES', 'BOOKINGS · PH 03 379 0103'],
  },
  {
    id: 'jeweller',
    mix: [1, 1, 4],
    names: ['TICK TOCK WATCHMAKERS', 'POUNAMU & PEARL JEWELLERS'],
    tags: ['WATCHES · RINGS · ENGRAVING'],
    looks: SCRIPTY,
  },
  {
    id: 'laundrette',
    mix: [2, 0, 1],
    names: ['SUDS LAUNDRETTE', 'SPIN & GRIN LAUNDROMAT'],
    tags: ['COIN LAUNDRY · DRY CLEANING'],
    light: 0.5,
  },
  {
    id: 'hobbies',
    mix: [1, 0, 3],
    names: ['THE HOBBY HORSE'],
    tags: ['MODELS · TRAINS · KITES'],
  },
  {
    id: 'secondhand',
    mix: [2, 2, 1],
    names: ["DAD'S OLD SHED SECOND-HAND", 'THE JUNK DRAWER'],
    tags: ['FURNITURE · TOOLS · CURIOS', 'WE BUY & SELL'],
    street: ['crates'],
  },
  {
    id: 'farmsupplies',
    mix: [0, 4, 0],
    names: ['CANTERBURY GRAIN & SEED', 'THE GUMBOOT DEPOT', 'TOP DRESSING & SEED CO.'],
    tags: ['DRENCH · FENCING · DOG TUCKER', 'SEEDS · GRAIN · FERTILISER'],
    looks: TRADE,
    street: ['crates'],
  },
];

/** Shop name for a trade, sometimes built on the suburb. */
export function tradeName(s: Site, t: Trade): string {
  const place = t.local ? locality(s) : null;
  if (place && s.rng.chance(t.names.length <= 1 ? 0.8 : 0.3)) return `${place} ${t.local}`;
  return s.rng.pick(t.names);
}

/** Weighted trade for a district column of `mix` (0 shops, 1 township, 2 cbd). */
export function pickTrade(rng: Rand, column: 0 | 1 | 2, corner: boolean, avoid?: Trade): Trade {
  let total = 0;
  for (const t of TRADES) if (t !== avoid) total += t.mix[column] * (corner ? (t.corner ?? 1) : 1);
  let r = rng.next() * total;
  for (const t of TRADES) {
    if (t === avoid) continue;
    r -= t.mix[column] * (corner ? (t.corner ?? 1) : 1);
    if (r <= 0) return t;
  }
  return TRADES[0];
}

// ───────────────────────────── Other pools ─────────────────────────────

export const PUBS = ['THE DROVERS ARMS', 'THE THIRSTY RAM', "THE NOR'WESTER TAVERN", 'THE BRIDLE & BIT', 'THE SHEARERS REST', 'THE STAG & THISTLE', 'THE RAILWAY TAVERN'] as const;
export const CITY_HOTELS = ['THE FOUR SHIPS HOTEL', 'THE PILGRIM HOTEL', 'THE GOLDEN PLOUGH HOTEL', "HOTEL NOR'WESTER"] as const;
export const TIMARU_HOTELS = ['THE BULLOCK TRACK HOTEL', "THE WHALER'S REST", 'THE BREAKWATER HOTEL'] as const;
export const PUB_TAGS = ['PUBLIC BAR · BOTTLE STORE', 'COLD BEER · HOT PIES · POOL', 'LOUNGE BAR · BISTRO MEALS'] as const;
export const PUB_NEON = ['PUBLIC BAR', 'BOTTLE STORE', 'COLD BEER'] as const;
export const PUB_BOARDS = ['JUG\nNIGHT', 'PUB\nLUNCH', 'COLD\nBEER'] as const;

export const BANKS = ['CANTERBURY PERMANENT BUILDING SOCIETY', 'SOUTHERN PASTORAL BANK', 'BANK OF AORAKI', 'THE TUSSOCK SAVINGS BANK'] as const;
export const CINEMAS = ['THE PLAZA', 'STARLIGHT CINEMA', 'THE EMPRESS', 'THE GAIETY'] as const;
export const DEPARTMENT_STORES = ["PEMBERTON'S", 'HOLLINGWORTH & LOW', "TREGEAR'S", "FAIRWEATHER'S", 'McCRORIE & SONS'] as const;
export const DEPARTMENT_TAGS = ['DRAPERS · OUTFITTERS · FURNISHERS', 'THE FAMILY DEPARTMENT STORE', 'MANCHESTER · CHINA · HABERDASHERY'] as const;
/** Carved into Edwardian parapets. */
export const BUILDING_NAMES = ["HALLORAN'S BUILDINGS", 'EXCHANGE CHAMBERS', 'PLAINS CHAMBERS', 'MERCANTILE BUILDINGS', 'UNION CHAMBERS', 'TUSSOCK HOUSE', 'A.D. 1906', 'ESTD 1898', '1903', '1911'] as const;
/** Office block tenants. */
export const OFFICES = ['PLAINS ASSURANCE', 'SOUTHERN MUTUAL LIFE', "NOR'WEST HOUSE", 'KEA HOUSE', 'TORLESSE TOWER', 'RAKAIA HOUSE', 'PACIFIC & ALPINE INSURANCE', 'CANTERBURY PROVIDENT', 'THE 03 HERALD'] as const;

export const STOCK_AGENTS = ['DRUMMOND & PEAKE LTD', 'HARGREAVES & DAUGHTERS', 'McALISTER STOKES & CO'] as const;
export const STOCK_TAGS = ['STOCK & STATION AGENTS', 'WOOL · GRAIN · SEEDS · INSURANCE'] as const;
export const GARAGES = ['MAIN ROAD MOTORS', 'PIT STOP GARAGE', 'BIG END MOTORS', 'CRANK & SUMP SERVICE STATION'] as const;
export const GARAGE_TAGS = ['WOFs · TYRES · LUBES', 'PETROL · DIESEL · OIL', 'BREAKDOWNS · PH 03 688 2141'] as const;
/** The invented petrol brand. */
export const FUEL_BRAND = 'WEKA';
export const GROCERS = ['HALF CROWN GROCER'] as const;
export const GROCER_TAGS = ['GROCERIES · FRUIT · FROZENS', "THIS WEEK'S SPECIALS"] as const;
export const HALLS = ['MEMORIAL HALL', 'DISTRICT HALL', "WORKINGMEN'S CLUB", "RETURNED MEN'S CLUB", 'BAND ROOMS'] as const;
export const CHURCH_HALLS = ["ST. AIDAN'S HALL", "ST. COLUMBA'S PARISH HALL", 'ALL SAINTS HALL', 'GOSPEL HALL'] as const;
/** The invented ice-cream brand on the tin sign outside every dairy. */
export const ICE_CREAM = 'SNOWLINE\nICE CREAM';
export const ICE_CREAM_LOOK: readonly Look[] = [{ bg: '#f6f2e6', fg: '#1f6a8a', style: 'script' }];

export const WORKS = [
  'TREGEAR ENGINEERING LTD',
  'PLAINS PRECISION ENGINEERING',
  'SOUTHERN STEEL FABRICATORS',
  'HALLORAN TRANSPORT',
  "NOR'WEST CARRIERS LTD",
  'BRAIDED RIVER CARRIERS',
  'PLAINS JOINERY & KITCHENS',
  'TUSSOCK TYRES',
  'TREAD LIGHTLY TYRES',
  'AGRI-PARTS CANTERBURY',
  'DRUMMOND BEARINGS & BELTS',
  'SOUTH ISLAND SPRINGS & AXLES',
  'PEAKE ELECTRICAL WHOLESALE',
  'THREE RIVERS CONCRETE',
] as const;
export const FACTORIES = ['PLAINS WOOLLEN MILLS', 'SOUTHERN BOOT & SHOE CO.', 'KOWHAI CONFECTIONERY WORKS', 'PIONEER STOVE & RANGE WORKS', 'NODOFF BEDDING CO.', 'FANTAIL FOODS CANNERY'] as const;
export const WOOL_STORES = ['SOUTHERN FLEECE WOOL BROKERS', 'PLAINS WOOL & SKIN CO.', 'HIGH COUNTRY WOOL SCOURERS'] as const;
export const PANEL_BEATERS = ['KNOCK-OUT PANEL & PAINT', 'DING DOCTOR PANELBEATERS', 'STRAIGHT & TRUE PANEL & PAINT', 'BOG & BUFF PANEL SHOP', 'SMASH HITS COLLISION REPAIRS'] as const;
export const PANEL_TAGS = ['INSURANCE WORK · RUST REPAIRS', 'SPRAY PAINTING · WOFs', 'FREE QUOTES · PH 03 684 9077'] as const;
export const TIMBER_YARDS = ['TWO-BY-FOUR TIMBER', 'RIMU & PINE TIMBER YARD', 'PLAINS TIMBER & HARDWARE'] as const;
export const TIMBER_TAGS = ['FENCING · DECKING · FIREWOOD', 'TRADE & PUBLIC WELCOME', 'DELIVERIES · PH 03 693 7415'] as const;
export const CAR_YARDS = ["TRUSTY TREV'S MOTORS", "BARRY'S BARGAIN CARS", 'WHEEL DEALS CAR COURT'] as const;
export const CAR_TAGS = ['QUALITY USED CARS', 'NO DEPOSIT · EASY TERMS', 'JAPANESE IMPORTS · TRADE-INS WELCOME', 'AFTER HOURS · PH 03 615 8362'] as const;

export const SHIPPERS = ["SOU'WESTER SHIPPING CO.", 'BREAKWATER STEVEDORING CO.', 'PORT & COASTAL CARRIERS', 'BOLLARD & HAWSER SHIP CHANDLERS'] as const;
export const COOLSTORES = ['FROSTLINE COLD STORAGE', 'SOUTHERN ICE COOLSTORES', 'BLUE ICE COOLSTORES'] as const;
export const TANK_FARMS = ['WEKA PETROLEUM · BULK DEPOT', 'COASTAL BULK LIQUIDS', 'TALLOW & MOLASSES TERMINAL'] as const;
export const FISHERIES = ['BLUE COD FISHERIES LTD', 'SOUTHERN TRAWLERS CO-OP', 'STORMY PETREL FISHING CO.', 'HOKI & LING SEAFOODS'] as const;
export const FISH_TAGS = ['WET FISH SALES · ICE · BAIT', 'BLUE COD · WHITEBAIT IN SEASON'] as const;

/** Painted advertisements going ghostly on brick side walls: invented products only. */
export const GHOST_SIGNS = ['KOWHAI\nBAKING POWDER', 'WEKA\nMOTOR SPIRIT', 'TUSSOCK\nTEA', 'SNOWLINE\nICE CREAM', 'PLAINS\nALES & STOUT', 'FANTAIL\nJAMS', 'NODOFF\nBEDDING', 'RIMU\nSOAP'] as const;

/** Spray-can tags down the service lanes: the game's name and the area code, worn as a badge. */
export const TAGS = ['03 QUEST', '03'] as const;
/** The tag look: a bright scrawl over a patch the council painted grey last time. */
export const SPRAY: readonly Look[] = [
  { bg: '#b9b4a8', fg: '#8a1f1f', style: 'script', border: false },
  { bg: '#9a968c', fg: '#1d2a44', style: 'script', border: false },
];

export const FARMS = ['GLENBRAE', 'TUSSOCK DOWNS', 'STONY CREEK', "NOR'WEST DOWNS", 'THE TERRACES', 'LONG PADDOCK', 'KOWHAI FLAT'] as const;
