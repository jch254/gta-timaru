import type { DistrictType, HumanoidLook, WeatherKind } from '../core/types';

/**
 * Who is on the street: clothes, builds, names and the things people say. Canterbury, 1995.
 * Pure data and seeded choices; every name and line here is invented.
 */

type Rand = { next(): number };
const pick = <T>(rng: Rand, list: readonly T[]): T => list[Math.floor(rng.next() * list.length) % list.length];
const chance = (rng: Rand, p: number) => rng.next() < p;
const range = (rng: Rand, lo: number, hi: number) => lo + (hi - lo) * rng.next();

// Skin tones in rough proportion to who lived here: mostly Pākehā, with Māori, Pasifika and Asian communities.
const SKIN_GROUPS: { weight: number; tones: number[]; hair: number[] }[] = [
  { weight: 0.73, tones: [0xe8b99a, 0xdcab8a, 0xf0c8ae, 0xd8a888, 0xe2b090, 0xd49a7c], hair: [0x3a2a1c, 0x5a4028, 0x241a12, 0x8a6a3a, 0xc8a860, 0x8a3a1c, 0x1c1612] },
  { weight: 0.14, tones: [0xb98058, 0xa87048, 0xc48f66], hair: [0x16110d, 0x1c1612, 0x2a1e14] },
  { weight: 0.06, tones: [0x9a6a44, 0x8a5c3a, 0xa87850], hair: [0x120e0a, 0x1c1612] },
  { weight: 0.05, tones: [0xe0b890, 0xd4a878, 0xc89a70], hair: [0x0e0c0a, 0x16110d] },
  { weight: 0.02, tones: [0x6e4a32, 0x7a5236, 0xc49a70], hair: [0x0e0c0a, 0x1c1612] },
];
const GREY_HAIR = [0xb8b8b4, 0xd8d6d0, 0x8a8a88, 0x9a968e];

const TEES = [0xd9d4c4, 0x2f5a8a, 0x8a2f2f, 0x2f6a4a, 0xe0c040, 0x3a3a40, 0xc86a2a, 0x7a9ab8, 0xf0f0ea, 0x5a2f6a];
const JEANS = [0x2c3a5c, 0x3a4a6a, 0x26304a, 0x4a5a78, 0x1e2433];
const STUBBIES = [0x8a6a44, 0x27324a, 0x2f4a36, 0x6a3a2a, 0x3a3a40, 0x9a8a6a];
const JANDALS = [0x1a2a5a, 0x151515, 0xa02020, 0x1f5a3a];
const SNEAKERS = [0xe8e8e4, 0xd0d0cc, 0x2a2a2e, 0xb8b0a0];
const BOOTS = [0x4a3626, 0x3a2a1c, 0x2a2420];
const GUMBOOTS = 0x15171a;
const DRESS_SHOES = [0x121214, 0x2a1a12];
// Limited palettes: patterned tops are cached per colour.
const BUSH_SHIRTS = [0xb3261e, 0x1f4a8a, 0x2f6a3a];
const JERSEYS = [0xb3261e, 0x1d3a8a, 0x1c6b3a, 0xd9a400, 0x7a1f2a, 0x303034];
const SHELL_SUITS = [0x6b2fa0, 0x12a39a, 0xd6337a, 0x2f6fd0, 0x1f8a4a];
const SUITS = [0x2b2e35, 0x1e2a44, 0x4a3a2c, 0x3a3f48];
const OFFICE_SHIRTS = [0xe8ecf0, 0xc8d8e8, 0xf0e8d8, 0xd8c8d8];
const SCHOOL_TOPS = [0x9aa0a6, 0x1e2a44, 0x2f5a3f, 0x7a1f2a];
const SCHOOL_BOTTOMS = [0x5a5f66, 0x1e2433, 0x3a3f48];
const WORK_LEGS = [0x27324a, 0x1e2433, 0x3a3a34, 0x4a4a3a];
const CARDIGANS = [0xc8a8b8, 0xa8b8c8, 0xb8c8a8, 0xd8c8a0, 0x8a6a8a];
const SLACKS = [0x6a6a5a, 0x4a4a52, 0x7a6a5a, 0x3a3f48, 0x8a8478];
const BOARDIES = [0xe05a2a, 0x2a9ad0, 0xe0c040, 0x3aa06a, 0xd6337a];
const CAPS = [0x25304a, 0xb3261e, 0x1c6b3a, 0x202024, 0xe8e8e4, 0xd9a400];
const BEANIES = [0x202024, 0x7a1f2a, 0x25304a, 0x2f5a3f, 0xb3261e];
const BRIMS = [0xc8b890, 0x8a7a5a, 0xe8e0c8, 0x4a4436];

export type Outfit = 'stubbies' | 'bush' | 'jersey' | 'shell' | 'school' | 'hivis' | 'farmer' | 'suit' | 'office' | 'casual' | 'nana' | 'surfie';

/** What people wear, by where they are. */
const OUTFIT_WEIGHTS: Record<DistrictType, Partial<Record<Outfit, number>>> = {
  cbd: { suit: 3, office: 4, casual: 4, shell: 1.5, jersey: 1, stubbies: 1, school: 1.5, nana: 1.5, bush: 0.5 },
  shops: { casual: 4, stubbies: 2.5, shell: 2, jersey: 1.5, nana: 2.5, school: 2, office: 1.5, bush: 1, suit: 0.5 },
  villa: { casual: 3, stubbies: 2.5, jersey: 1.5, nana: 2, school: 2, shell: 1.5, bush: 1, office: 1 },
  statehouse: { stubbies: 3, casual: 2.5, jersey: 2.5, shell: 2, school: 2, bush: 1.5, nana: 1.5, hivis: 0.5 },
  industrial: { hivis: 5, bush: 3, stubbies: 2, casual: 1, jersey: 1 },
  port: { hivis: 5, bush: 3, stubbies: 1.5, casual: 1 },
  township: { farmer: 2.5, bush: 2.5, stubbies: 2.5, casual: 2.5, jersey: 2, nana: 2, school: 1.5, hivis: 1, shell: 0.5 },
  park: { casual: 3, shell: 2.5, stubbies: 2, jersey: 1.5, school: 1.5, nana: 1.5 },
  rural: { farmer: 5, bush: 3, hivis: 2, stubbies: 2 },
  beach: { surfie: 4, stubbies: 3.5, casual: 2, nana: 1, shell: 1 },
};

const OUTFITS: Outfit[] = ['stubbies', 'bush', 'jersey', 'shell', 'school', 'hivis', 'farmer', 'suit', 'office', 'casual', 'nana', 'surfie'];

export function pickOutfit(rng: Rand, district: DistrictType, hour: number, weekday: boolean): Outfit {
  const weights = OUTFIT_WEIGHTS[district] ?? OUTFIT_WEIGHTS.villa;
  // School uniforms only around the school day; suits and offices keep business hours.
  const school = weekday && hour >= 7.5 && hour <= 16.5;
  const business = weekday && hour >= 7 && hour <= 18.5;
  let total = 0;
  for (const o of OUTFITS) total += weightOf(weights, o, school, business);
  let r = rng.next() * total;
  for (const o of OUTFITS) {
    r -= weightOf(weights, o, school, business);
    if (r <= 0) return o;
  }
  return 'casual';
}

function weightOf(weights: Partial<Record<Outfit, number>>, o: Outfit, school: boolean, business: boolean): number {
  const w = weights[o] ?? 0;
  if (o === 'school') return school ? w : 0;
  if (o === 'suit' || o === 'office') return business ? w : w * 0.15;
  return w;
}

export interface LookContext {
  district: DistrictType;
  hour: number;
  /** Monday–Friday. */
  weekday: boolean;
  /** Cold or wet: more beanies and long trousers. */
  cold: boolean;
}

/** A complete, varied look for an ambient pedestrian. */
export function randomLook(rng: Rand, ctx: LookContext): HumanoidLook {
  const female = chance(rng, 0.5);
  let r = rng.next();
  let group = SKIN_GROUPS[0];
  for (const g of SKIN_GROUPS) {
    r -= g.weight;
    if (r <= 0) {
      group = g;
      break;
    }
  }
  const outfit = pickOutfit(rng, ctx.district, ctx.hour, ctx.weekday);
  // Age: school kids are young, nanas are not; everyone else spans the range.
  const age = outfit === 'school' ? 0 : outfit === 'nana' ? range(rng, 0.75, 1) : rng.next();
  const old = age > 0.72;
  const look: HumanoidLook = {
    skin: pick(rng, group.tones),
    hair: old && chance(rng, 0.8) ? pick(rng, GREY_HAIR) : pick(rng, group.hair),
    top: pick(rng, TEES),
    topStyle: 'tee',
    legs: pick(rng, JEANS),
    shorts: false,
    shoes: pick(rng, SNEAKERS),
    hat: 'none',
    female,
    height: range(rng, 0.94, 1.07) * (old ? 0.97 : 1),
    bulk: range(rng, 0.9, 1.12) + (old ? 0.05 : 0) + (chance(rng, 0.12) ? 0.1 : 0),
  };
  look.hairStyle = female
    ? pick(rng, ['long', 'long', 'long', 'bob', 'bob', 'short', 'mullet'] as const)
    : pick(rng, ['short', 'short', 'short', 'short', 'mullet', 'mullet', 'bald', 'long'] as const);
  if (old && !female && chance(rng, 0.35)) look.hairStyle = 'bald';
  if (old && female) look.hairStyle = chance(rng, 0.7) ? 'bob' : 'short';

  const warm = !ctx.cold && ctx.hour > 8 && ctx.hour < 20;
  switch (outfit) {
    case 'stubbies':
      look.topStyle = chance(rng, female ? 0.15 : 0.35) ? 'singlet' : 'tee';
      look.legs = pick(rng, STUBBIES);
      look.shorts = true;
      look.shoes = pick(rng, JANDALS);
      break;
    case 'bush':
      look.topStyle = 'bushShirt';
      look.top = pick(rng, BUSH_SHIRTS);
      look.shorts = chance(rng, warm ? 0.6 : 0.25);
      look.legs = look.shorts ? pick(rng, STUBBIES) : pick(rng, WORK_LEGS);
      look.shoes = chance(rng, 0.4) ? GUMBOOTS : pick(rng, BOOTS);
      break;
    case 'jersey':
      look.topStyle = 'jersey';
      look.top = pick(rng, JERSEYS);
      look.shorts = chance(rng, warm ? 0.55 : 0.2);
      look.legs = look.shorts ? pick(rng, [0x151515, 0xe8e8e4, 0x1e2433]) : pick(rng, JEANS);
      break;
    case 'shell': {
      const colour = pick(rng, SHELL_SUITS);
      look.topStyle = 'jacket';
      look.top = colour;
      look.legs = chance(rng, 0.7) ? colour : pick(rng, SHELL_SUITS);
      look.shoes = SNEAKERS[0];
      break;
    }
    case 'school':
      look.topStyle = 'uniform';
      look.top = pick(rng, SCHOOL_TOPS);
      look.legs = pick(rng, SCHOOL_BOTTOMS);
      look.shorts = !female || chance(rng, 0.4);
      look.shoes = DRESS_SHOES[0];
      look.height = range(rng, 0.78, 0.9);
      look.bulk = range(rng, 0.86, 0.98);
      look.hairStyle = female ? pick(rng, ['long', 'bob'] as const) : pick(rng, ['short', 'short', 'mullet'] as const);
      break;
    case 'hivis':
      look.topStyle = 'hiVis';
      look.legs = pick(rng, WORK_LEGS);
      look.shorts = chance(rng, warm ? 0.5 : 0.15);
      look.shoes = chance(rng, 0.55) ? GUMBOOTS : pick(rng, BOOTS);
      break;
    case 'farmer':
      look.topStyle = chance(rng, 0.6) ? 'bushShirt' : warm && !female ? 'singlet' : 'tee';
      look.top = look.topStyle === 'bushShirt' ? pick(rng, BUSH_SHIRTS) : pick(rng, [0x1e2433, 0x3a3a40, 0x2f4a36]);
      look.shorts = chance(rng, 0.7);
      look.legs = look.shorts ? pick(rng, STUBBIES) : pick(rng, WORK_LEGS);
      look.shoes = GUMBOOTS;
      break;
    case 'suit': {
      const colour = pick(rng, SUITS);
      look.topStyle = 'jacket';
      look.top = colour;
      look.legs = colour;
      look.shoes = pick(rng, DRESS_SHOES);
      if (!female && look.hairStyle === 'mullet') look.hairStyle = 'short';
      break;
    }
    case 'office':
      look.topStyle = 'uniform';
      look.top = pick(rng, OFFICE_SHIRTS);
      look.legs = pick(rng, SLACKS);
      look.shoes = pick(rng, DRESS_SHOES);
      break;
    case 'nana':
      look.topStyle = 'jacket';
      look.top = pick(rng, CARDIGANS);
      look.legs = pick(rng, SLACKS);
      look.shoes = pick(rng, [0x4a3626, 0x2a2420, 0xb8b0a0]);
      break;
    case 'surfie':
      look.topStyle = chance(rng, 0.5) ? 'singlet' : 'tee';
      look.legs = pick(rng, BOARDIES);
      look.shorts = true;
      look.shoes = pick(rng, JANDALS);
      if (!old) look.hairStyle = chance(rng, 0.5) ? 'long' : look.hairStyle;
      break;
    case 'casual':
      look.topStyle = chance(rng, 0.25) ? 'jacket' : 'tee';
      look.top = look.topStyle === 'jacket' ? pick(rng, [0x3a3a40, 0x4a3a2c, 0x25304a, 0x6a2f2f, 0x2f4a36]) : pick(rng, TEES);
      look.shorts = chance(rng, warm ? 0.3 : 0.05);
      look.legs = look.shorts ? pick(rng, STUBBIES) : pick(rng, JEANS);
      break;
  }

  // Hats.
  const hatRoll = rng.next();
  if (outfit === 'farmer') {
    if (hatRoll < 0.6) setHat(look, 'brim', pick(rng, BRIMS));
    else if (hatRoll < 0.8) setHat(look, 'cap', pick(rng, CAPS));
  } else if (outfit === 'hivis' || outfit === 'bush') {
    if (hatRoll < 0.25) setHat(look, 'cap', pick(rng, CAPS));
    else if (hatRoll < (ctx.cold ? 0.6 : 0.38)) setHat(look, 'beanie', pick(rng, BEANIES));
  } else if (outfit === 'school' || outfit === 'surfie') {
    if (hatRoll < 0.3) setHat(look, outfit === 'school' ? 'brim' : 'cap', outfit === 'school' ? look.top : pick(rng, CAPS));
  } else if (outfit !== 'suit' && outfit !== 'office') {
    if (hatRoll < 0.14) setHat(look, 'cap', pick(rng, CAPS));
    else if (hatRoll < (ctx.cold ? 0.3 : 0.17)) setHat(look, 'beanie', pick(rng, BEANIES));
    else if (hatRoll < (ctx.cold ? 0.3 : 0.23) && warm) setHat(look, 'brim', pick(rng, BRIMS));
  }
  return look;
}

function setHat(look: HumanoidLook, hat: 'cap' | 'beanie' | 'brim', colour: number) {
  look.hat = hat;
  look.hatColor = colour;
}

/** Fill in whatever a scripted spawn left unspecified. */
export function completeLook(rng: Rand, partial: Partial<HumanoidLook> | undefined, ctx: LookContext): HumanoidLook {
  const base = randomLook(rng, ctx);
  if (!partial) return base;
  // An explicit hat or hair choice must not inherit a random hat colour / clash with it.
  const merged = { ...base, ...partial };
  if (partial.hat && partial.hatColor === undefined && partial.hat !== base.hat) delete merged.hatColor;
  if (partial.female !== undefined && partial.hairStyle === undefined && partial.female !== base.female) merged.hairStyle = partial.female ? 'long' : 'short';
  return merged;
}

// First names only, a mix heard around Canterbury at the time. None refers to a real person.
const NAMES_F = ['Shaz', 'Raewyn', 'Bev', 'Colleen', 'Mere', 'Ngaire', 'Aroha', 'Trish', 'Donna', 'Kiri', 'Losa', 'Mei', 'Priya', 'Jan', 'Tracey', 'Hine', 'Cheryl', 'Sina', 'Jo', 'Noeline'];
const NAMES_M = ['Gaz', 'Trev', 'Kev', 'Daz', 'Hemi', 'Tama', 'Wiremu', 'Sione', 'Bruce', 'Murray', 'Stu', 'Rangi', 'Tavita', 'Raj', 'Wei', 'Nige', 'Grant', 'Baz', 'Col', 'Smithy'];

export function pedName(rng: Rand, female: boolean): string {
  return pick(rng, female ? NAMES_F : NAMES_M);
}

/**
 * Things people say. Short, dry, friendly. Everyday te reo Māori turns up the way it did on any Canterbury
 * street in 1995 (kia ora, ka pai, e hoa, aroha mai…), from anyone, written with its macrons.
 */
export const BARKS = {
  bump: [
    'Oi, steady on, mate!',
    'Watch where you’re going, eh.',
    'Whoa! Easy there.',
    'Mind out, love.',
    'Careful! Nearly lost me pie.',
    'You right there?',
    'Aw, come on, mate.',
    '’Scuse you!',
    'Bit of room, eh?',
    'Steady, tiger.',
    'Aroha mai, e hoa. Didn’t see you.',
    'Taihoa, mate!',
    'Auē! Watch it, eh.',
  ],
  chat: [
    'Gidday.',
    'How’s it going?',
    'Not a bad day for it, eh.',
    'Sweet as.',
    'She’ll be right.',
    'Yeah, nah, can’t stop.',
    'See the footy on Saturday?',
    'Kia ora.',
    'Kia ora, e hoa.',
    'Ka pai.',
    'Chur.',
    'Off to get some kai.',
    'Back to the mahi, eh.',
    'Ka kite.',
    'Whānau’s coming round for tea.',
    'Got to pick up the tamariki.',
    'You lost, mate?',
    'Just popping down the dairy.',
    'Good as gold.',
    'Can’t complain. Well, I could.',
    'Box of birds, thanks.',
    'Couldn’t pay me to live outside the 03.',
    'Best fish and chips in the 03, that place.',
  ],
  norwester: ['This nor’wester’s doing my head in.', 'Look at that arch over the Alps, eh.', 'Warm wind today. Washing’ll be dry by lunch.'],
  southerly: ['Southerly’s come through. Told ya it would.', 'Brass monkey weather, this.', 'Should’ve brought a jersey.'],
  fog: ['Can’t see the Port Hills for the fog.', 'Proper pea-souper this morning.'],
  morning: ['Mōrena.', 'Morning.', 'Up with the sparrows, eh.'],
  night: ['Bit late to be wandering about, eh.', 'Pubs are shut, mate. Go home.', 'Mind how you go.'],
  flee: ['Leg it!', 'Crikey!', 'Get down!', 'Somebody ring the cops!', 'Run for it!', 'Strewth!', 'Auē!'],
  cower: ['Don’t hurt me!', 'Take it easy, mate!', 'I didn’t see nothing!'],
  hijacked: ['Oi! That’s my car!', 'Give it back, ya egg!', 'Mum’s gonna kill me!', 'I’ve only just got her warranted!', 'Bring it back with a full tank, eh!'],
  fight: ['Right, you asked for it.', 'Come here, ya egg!', 'Have a go, then!', 'You picked the wrong bloke.'],
  hit: ['Learn to drive, ya muppet!', 'My hip!', 'You could’ve killed me!', 'Indicate next time!'],
  theft: ['Oi! That’s not yours!', 'I saw that!', 'Cheeky beggar.'],
} as const;

export type BarkKind = keyof typeof BARKS;

/** A line for small talk, coloured by the weather and the hour. */
export function chatLine(rng: Rand, weather: WeatherKind, night: boolean, hour = 12): string {
  if (chance(rng, 0.4)) {
    if (night) return pick(rng, BARKS.night);
    if (hour >= 5 && hour < 10 && chance(rng, 0.5)) return pick(rng, BARKS.morning);
    if (weather === 'norwester') return pick(rng, BARKS.norwester);
    if (weather === 'southerly') return pick(rng, BARKS.southerly);
    if (weather === 'fog') return pick(rng, BARKS.fog);
  }
  return pick(rng, BARKS.chat);
}

export function barkLine(rng: Rand, kind: BarkKind): string {
  return pick(rng, BARKS[kind]);
}
