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
// Faded black band tees (the band is invented; think the Shingle FM playlist) and black jeans.
const BAND_TEES = [0x141416, 0x1e1c20, 0x2a282c, 0x241a1e];
const BLACK_JEANS = [0x17181c, 0x242228];
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

export type Outfit = 'stubbies' | 'bush' | 'jersey' | 'shell' | 'school' | 'hivis' | 'farmer' | 'suit' | 'office' | 'casual' | 'nana' | 'surfie' | 'bogan';

/** What people wear, by where they are. */
const OUTFIT_WEIGHTS: Record<DistrictType, Partial<Record<Outfit, number>>> = {
  cbd: { suit: 3, office: 4, casual: 4, shell: 1.5, jersey: 1, stubbies: 1, school: 1.5, nana: 1.5, bush: 0.5, bogan: 0.5 },
  shops: { casual: 4, stubbies: 2.5, shell: 2, jersey: 1.5, nana: 2.5, school: 2, office: 1.5, bush: 1, suit: 0.5, bogan: 1 },
  villa: { casual: 3, stubbies: 2.5, jersey: 1.5, nana: 2, school: 2, shell: 1.5, bush: 1, office: 1, bogan: 0.5 },
  statehouse: { stubbies: 3, casual: 2.5, jersey: 2.5, shell: 2, school: 2, bush: 1.5, nana: 1.5, hivis: 0.5, bogan: 2 },
  industrial: { hivis: 5, bush: 3, stubbies: 2, casual: 1, jersey: 1, bogan: 1 },
  port: { hivis: 5, bush: 3, stubbies: 1.5, casual: 1, bogan: 0.5 },
  township: { farmer: 2.5, bush: 2.5, stubbies: 2.5, casual: 2.5, jersey: 2, nana: 2, school: 1.5, hivis: 1, shell: 0.5, bogan: 1 },
  park: { casual: 3, shell: 2.5, stubbies: 2, jersey: 1.5, school: 1.5, nana: 1.5, bogan: 1 },
  rural: { farmer: 5, bush: 3, hivis: 2, stubbies: 2 },
  beach: { surfie: 4, stubbies: 3.5, casual: 2, nana: 1, shell: 1, bogan: 0.5 },
};

const OUTFITS: Outfit[] = ['stubbies', 'bush', 'jersey', 'shell', 'school', 'hivis', 'farmer', 'suit', 'office', 'casual', 'nana', 'surfie', 'bogan'];

export function pickOutfit(rng: Rand, district: DistrictType, hour: number, weekday: boolean): Outfit {
  const weights = OUTFIT_WEIGHTS[district] ?? OUTFIT_WEIGHTS.villa;
  // School uniforms only around the school day; suits and offices keep business hours.
  // Bogans own the night: once the shops shut, the boy racers come out.
  const school = weekday && hour >= 7.5 && hour <= 16.5;
  const business = weekday && hour >= 7 && hour <= 18.5;
  const late = hour >= 20.5 || hour < 5;
  let total = 0;
  for (const o of OUTFITS) total += weightOf(weights, o, school, business, late);
  let r = rng.next() * total;
  for (const o of OUTFITS) {
    r -= weightOf(weights, o, school, business, late);
    if (r <= 0) return o;
  }
  return 'casual';
}

function weightOf(weights: Partial<Record<Outfit, number>>, o: Outfit, school: boolean, business: boolean, late: boolean): number {
  const w = weights[o] ?? 0;
  if (o === 'school') return school ? w : 0;
  if (o === 'suit' || o === 'office') return business ? w : w * 0.15;
  if (o === 'bogan') return late ? w * 2.5 : w;
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
    case 'bogan':
      // Black band tee or singlet, black jeans, boots; a mullet more often than not.
      look.topStyle = chance(rng, 0.25) ? 'singlet' : 'tee';
      look.top = pick(rng, BAND_TEES);
      look.shorts = false;
      look.legs = chance(rng, 0.6) ? pick(rng, BLACK_JEANS) : pick(rng, JEANS);
      look.shoes = chance(rng, 0.55) ? pick(rng, BOOTS) : pick(rng, [0x2a2a2e, 0x1a1a1c]);
      if (!old) look.hairStyle = female ? pick(rng, ['long', 'long', 'mullet'] as const) : pick(rng, ['mullet', 'mullet', 'long'] as const);
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
 * Things people say. Short, dry and sweary, the way a Canterbury street talked in 1995. Everyday te reo Māori
 * turns up from anyone (kia ora, ka pai, e hoa, aroha mai, hōhā…), written with its macrons. The jokes are
 * aimed at the player, the weather, the town or the speaker; never at anyone's race, sexuality or disability
 * (see docs/research/10-slang-insults-and-banter.md before adding lines). No c-word, no slurs.
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
    'Oi! Watch it, dickhead!',
    'Eyes in the front of your head, mate.',
    'Steady on, ya egg.',
    'Bloody hell, mind out!',
    'Watch where you’re walking, ya knob.',
    'Who taught you to walk? A drunk weka?',
    'Footpath’s big enough for two, ya muppet.',
    'Taihoa, e hoa! Where’s the fire?',
    'Oi! Some of us live here, ya plonker.',
    'Watch it, or you’ll be wearing my chips.',
    'Sorry, bro. My fault. Nah, yours actually.',
    'Hōhā! Every bloody time.',
    'Mind the jandals, ya great lump.',
    'Manners cost nothing, ya know.',
    'Kia tūpato, e tama. Nearly flattened me.',
    'Bugger me, you’re solid. Built like a dunny.',
    'Piss off, ya clumsy prick.',
    'Christ on a bike! Look where you’re going!',
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
    'Hard case, that fella.',
    'Bit of a dag, your mate.',
    'She’s a hard road, eh.',
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
    'Yeah, nah. Yeah. Nah. Probably.',
    'Off to the dairy for a pie and a milk.',
    'She’ll be right. She usually is. Mostly.',
    'Been flat stick all week, me.',
    'Kia ora. Good to see a face I know.',
    'Hard yakka, this living business.',
    'Couldn’t run a piss-up in a brewery, that lot.',
    'Rough as guts, that new pub.',
    'Back to the mahi. Bloody hōhā.',
    'Got a puku on me like a ewe in lamb.',
    'Ka kite, e hoa. Don’t do anything I would.',
    'You lost? The wop-wops are that way.',
    'That idea’s gone up the boohai.',
    'Nothing on telly but the news and repeats.',
    'Saturday’s draw. I’m retiring Sunday.',
    'Fish and chips Friday. Non-negotiable.',
    'Dog ate me gumboot. Just the left one.',
    'Nan’s got the jug on if you want a cuppa.',
    'Off to the bach. No phone, no worries.',
    'Tell your mum I said kia ora.',
    'Mate of mine’s a cow cocky. Never sleeps.',
    'He’s a good bugger, that one.',
    'Useless as tits on a bull, my brother-in-law.',
    'Mad as a meat axe, my neighbour.',
    'Don’t be a nana. Come to the pub.',
    'Pōhara till payday. Same as always.',
    'E hika, the price of smokes.',
    'Bit of an ihu kurī, aren’t ya?',
    'What you staring at? Tō ihu, e hoa.',
    'Too whakamā to ask her to the dance, me.',
    'Koro’s ninety. Still drives. God help us.',
    'You look like a possum in the headlights.',
    'Stand there much longer, I’ll charge rent.',
    'Spit it out, mate. Haven’t got all day.',
    'Aunty’s cooking for forty. Again.',
    'Timaru: blink and you’ve missed it. Lucky you.',
    'Christchurch? Too many one-way streets.',
    'Auckland? Never been. Never going.',
    'Moko’s teething. Nobody’s slept since Easter.',
    'Car’s pakaru again. Walking’s good for me.',
    'Kia ora, love. You look like you need a pie.',
    'Bugger off, mate. I’m busy.',
    'Piss off, I’m not buying anything.',
    'Fuck me, it’s been a long week.',
    'Bloody government. Bloody everything.',
    'Shit weather, shit pay. Sweet as, otherwise.',
    'The works? Bastards laid off half me street.',
    'What are you looking at, ya egg?',
  ],
  norwester: [
    'This nor’wester’s doing my head in.',
    'Look at that arch over the Alps, eh.',
    'Warm wind today. Washing’ll be dry by lunch.',
    'Hot, dry and grumpy. Me and the wind both.',
    'Washing’s dry. Washing’s also in Ashburton.',
    'Nor’wester. Everyone’s a prick today. Me too.',
    'Hair like a haystack. Cheers, nor’wester.',
    'Dust in me eyes, grit in me teeth. Lovely.',
    'Wind’s so hot the dog won’t go outside.',
    'Hōhā, this wind. Can’t think straight.',
    'Shut the bloody door, you’re letting it in.',
    'Trampoline’s in the neighbour’s yard again.',
    'Nor’west arch. Rain by Thursday, you watch.',
    'Hot as hell and twice as windy.',
  ],
  southerly: [
    'Southerly’s come through. Told ya it would.',
    'Brass monkey weather, this.',
    'Should’ve brought a jersey.',
    'Bloody southerly. Should’ve worn a jersey.',
    'Straight off the ice, this one.',
    'Southerly buster. Hang onto your hat.',
    'My nose has gone. Haven’t seen it since ten.',
    'Hot one minute, Antarctica the next.',
    'Rain sideways. Classic Canterbury.',
    'Wind chill’s taken me ears off.',
    'Hope the lambs are in. Poor buggers.',
    'Took me washing, me hat and me will to live.',
    'Cold as a mother-in-law’s kiss, this.',
  ],
  fog: [
    'Can’t see the Port Hills for the fog.',
    'Proper pea-souper this morning.',
    'Can’t see me hand in front of me face.',
    'Fog’s so thick you could spread it on toast.',
    'Is that a car or a cow? Can’t tell.',
    'Kia tūpato on the roads, eh. Thick out.',
    'Drive slow. Or don’t. Your funeral.',
    'Fog’s in. Even the gulls are walking.',
    'Like walking through wet cotton wool.',
    'Headlights on, ya egg. It’s fog.',
  ],
  morning: [
    'Mōrena.',
    'Morning.',
    'Up with the sparrows, eh.',
    'Mōrena, e hoa. Early start?',
    'Morning. Too early for talking.',
    'Don’t talk to me till I’ve had a cuppa.',
    'Morning. Bloody frost on the ute again.',
    'Paper boy’s late again. Little ratbag.',
    'Morning. Don’t look at me, I’m not awake.',
    'Rooster woke me at four. He’s dinner.',
  ],
  night: [
    'Bit late to be wandering about, eh.',
    'Pubs are shut, mate. Go home.',
    'Mind how you go.',
    'Bloody boy racers, all hours.',
    'Pubs are shut. Go home, ya hoon.',
    'Last bus left an hour ago, mate.',
    'Chippy’s shut. Life’s cruel.',
    'Off home before the missus locks me out.',
    'Late night? You look rough as guts, mate.',
    'Taxi! Nah, he’s not stopping. Prick.',
    'Pōrangi, wandering about after midnight.',
    'Ka kite. Don’t let the possums get ya.',
    'Dark as the inside of a cow out here.',
    'I’m not pissed. You’re pissed.',
  ],
  flee: [
    'Leg it!',
    'Crikey!',
    'Get down!',
    'Somebody ring the cops!',
    'Run for it!',
    'Strewth!',
    'Auē!',
    'Run! Run, ya idiots!',
    'Holy shit! Go! Go!',
    'Auē! Get out of here!',
    'Bugger this for a joke!',
    'Mum! MUM!',
    'I’m too young to die! Well, ish!',
    'Every man for himself!',
    'Shit, shit, shit, shit!',
    'He’s pōrangi! Run!',
    'Get behind the car! Not that one!',
    'Auē taukuri ē! Move!',
    'Fuck this! I’m out!',
  ],
  cower: [
    'Don’t hurt me!',
    'Take it easy, mate!',
    'I didn’t see nothing!',
    'Don’t hurt me! I’ve got kids! Probably!',
    'Please, mate! I’m just a meter reader!',
    'Take the wallet! There’s four bucks in it!',
    'Aroha mai! Whatever I did, aroha mai!',
    'I’m nobody! Ask my wife!',
    'Have the car! Have the dog! Just go!',
    'Please! My nan’s waiting for her pie!',
    'E hoa, please. I’m just going to work.',
    'Don’t shoot! I’m only from Ashburton!',
  ],
  hijacked: [
    'Oi! That’s my car!',
    'Give it back, ya egg!',
    'Mum’s gonna kill me!',
    'I’ve only just got her warranted!',
    'Bring it back with a full tank, eh!',
    'Oi! That’s my car, ya bastard!',
    'Get out of my car, ya thieving prick!',
    'Not the ute! Anything but the ute!',
    'She’s not even paid off, ya mongrel!',
    'Auē! My car! My kai’s in the back!',
    'Hope the clutch bites ya, ya wanker!',
    'Nan’s tapes are in the deck, ya mongrel!',
    'That’s my bloody car! Tūtae!',
    'Ka kite, car. You were a good one.',
    'Twenty years I’ve had her! Bastard!',
  ],
  fight: [
    'Right, you asked for it.',
    'Come here, ya egg!',
    'Have a go, then!',
    'You picked the wrong bloke.',
    'Carry on and you’ll get a rark-up.',
    'You picked the wrong bloke, dickhead.',
    'Put ’em up, ya big sook.',
    'I’ve dropped bigger blokes than you.',
    'E hoa, you’ve done it now.',
    'Get off the grass! Come on, then!',
    'Fists up, ya useless tosser.',
    'My nan hits harder than you, ya knob.',
    'Dropkick. Let’s go.',
    'Right, ya prick. You’re getting a hiding.',
  ],
  hit: [
    'Learn to drive, ya muppet!',
    'My hip!',
    'You could’ve killed me!',
    'Indicate next time!',
    'Ya bloody hoon!',
    'Indicate next time, ya bastard!',
    'Ow! Who gave you a licence?',
    'Auē, my leg! My bloody leg!',
    'Hit and run, is it? Ya gutless prick!',
    'Bugger me, that hurt!',
    'I’ll have your plates, ya dickhead!',
    'That’s going in the paper, you!',
    'I’m a pedestrian, not a speed bump!',
    'Shit! Ow! I’ve bitten me tongue!',
  ],
  theft: [
    'Oi! That’s not yours!',
    'I saw that!',
    'Cheeky beggar.',
    'I saw that! I saw that, ya thief!',
    'Somebody ring the cops! Car thief!',
    'That’s Kev’s car! Kev! KEV!',
    'Bold as brass, that one.',
    'Car conversion in broad daylight!',
    'Ya thieving mongrel!',
    'In front of God and Nan and everyone!',
    'Bet he hasn’t even got a licence.',
    'E hoa! That’s not your waka!',
  ],
  /** A car the player is driving came within a whisker. */
  nearMiss: [
    'Jesus! Watch it!',
    'Bloody hell, that was close!',
    'Ya maniac! Slow down!',
    'Shit! Nearly wore that!',
    'Missed me, ya hoon! Ha!',
    'Auē! Felt the wind off that!',
    'Need a change of undies now, cheers.',
    'Speed limit’s not a target, ya dick!',
    'Thought me number was up!',
    'Ya tosser! There’s kids about!',
    'Kia tūpato, ya pōrangi egg!',
    'Who d’ya think you are, a rally driver?',
    'Nearly a hood ornament, me.',
    'Missed me by a whisker, ya prick!',
    'Fuck me dead, that was close!',
  ],
  /** Watching the player's car hit something hard. */
  crash: [
    'Ooh. That’s a write-off.',
    'Who taught that clown to drive?',
    'That’s gonna leave a mark.',
    'Bugger. Hope they’re insured.',
    'That car’s pakaru now, eh.',
    'Ha! Pay for that, ya egg!',
    'Rough as guts, that driving.',
    'Panelbeater’s gonna love you.',
    'Like a tractor falling down the stairs.',
    'Oh, the paintwork. The poor paintwork.',
    'Well, she’s buggered now.',
    'Auē! Car’s had it!',
    'Absolute dropkick. Did you see that?',
    'Holy shit. Did you see that?',
  ],
  /** A car going up in flames nearby. */
  boom: [
    'Holy shit! It blew up!',
    'Get down! It’s gonna go again!',
    'Auē! Fireball!',
    'Bloody hell! Me eyebrows!',
    'That’s not meant to happen to cars!',
    'Somebody get the fire brigade!',
    'I felt that in me fillings!',
    'Fireworks are meant to be in November!',
    'Bang goes somebody’s no-claims bonus!',
    'Tūtae! Me ears are ringing!',
    'Who blows up a car on a weekday?',
    'That’ll be on the six o’clock news.',
    'Smells like the works’ rubbish fire.',
    'Fuck! Me bloody ears!',
  ],
  /** The player tearing past with the cops after them. */
  chase: [
    'Go on, cops! Get him!',
    'Ha! Cops’ll never catch that!',
    'There he goes, flat stick!',
    'Bloody hell, the whole station’s out!',
    'Sirens again. Every bloody night.',
    'Hope they get the bastard.',
    'He’s away laughing, that one.',
    'Cop car’s eating his dust!',
    'Like the telly, but closer.',
    'Ten bucks on the hoon!',
    'E hoa, slow down! You’ll kill someone!',
    'Where’s he think he’s going? Dunedin?',
    'Bit of excitement for a Tuesday!',
    'Go on, son! Leg it! Er, I mean, stop!',
  ],
  /** The player aiming a gun their way. */
  armed: [
    'Whoa! Put that away, mate!',
    'Easy! Easy with that!',
    'Is that real? Shit, it’s real!',
    'I’m just here for the milk!',
    'Take what you want! Take the lot!',
    'Auē! Don’t shoot!',
    'Bloody hell, he’s got a gun!',
    'Mate, I’ve got a mortgage!',
    'Point that somewhere else, ya egg!',
    'This is Canterbury, not America!',
    'Please, e hoa. Think of your nan.',
    'Okay! Okay! Hands up! Both of ’em!',
    'Don’t do anything pōrangi, bro.',
    'I owe you nothing! I owe everyone else!',
  ],
  /** A driver the player has just run into. */
  rammed: [
    'What the hell?! You rammed me!',
    'Ya bloody lunatic!',
    'My car! My bloody car!',
    'Get out and say that to my face!',
    'Insurance details, ya dickhead! Now!',
    'That’s my no-claims gone, ya prick!',
    'Are you blind or just stupid?',
    'Bastard! It’s a company car!',
    'You’ll pay for that panel, ya egg!',
    'Auē! My boot’s pakaru!',
    'Tūtae! Learn to drive!',
    'I’m getting your plate, ya mongrel!',
    'Ram me again and see what happens!',
    'Is this how they drive in Auckland?',
    'Fuck’s sake! I only just had her washed!',
  ],
  /** Tooted at by the player. */
  horn: [
    'Yeah, yeah. I heard ya.',
    'Toot me again, I dare ya.',
    'Don’t you toot at me, ya knob!',
    'Hold your horses, ya egg!',
    'Taihoa! I’m walking!',
    'I’m crossing! Wait your turn!',
    'Toot toot yourself, dickhead.',
    'Is that for me? Charming.',
    'Ooh, big man with a horn.',
    'Push that again and I’ll push you.',
    'Hōhā! I’m going, I’m going!',
    'Nice horn. Shame about the car.',
    'Wanker.',
    'Kia ora to you too, ya prick.',
  ],
} as const;

export type BarkKind = keyof typeof BARKS;

/**
 * Two passers-by having a yarn: lines alternate between them, starting with whoever is picked first.
 * Lines can run longer than a bark (up to 60 characters). Nothing here is tied to a date in 1995.
 */
export const CONVOS = {
  general: [
    ['Hear the works are laying off again?', 'Again? There’s no one left to lay off.', 'They’ll lay off the bloody chain next.'],
    ['Still on the dole?', '“Between seasons”, thanks.', 'Long season, mate. Three years.'],
    ['How’s the whānau?', 'Moko’s walking. Koro’s not.', 'Swings and roundabouts, eh.'],
    ['Saturday’s draw, I’m buying a bach.', 'You said that last week.', 'And I’ll say it next week, ya egg.'],
    ['Christchurch? Bunch of snobs with a tram.', 'Better than Timaru.', 'Timaru’s got a beach. You’ve got a swamp.'],
    ['Ever been to Auckland?', 'Once. Couldn’t find a park.', 'Or a reason to stay.'],
    ['Your cousin still up in Auckland?', 'Yeah. Calls us “the provinces” now.', 'JAFA. Just another... yeah.'],
    ['Kia ora, Aunty. Kai smells good.', 'Hands off, it’s for the hui.', 'Just a taste?', 'Taihoa! Wait like everyone else.'],
    ['Bro, your car’s pakaru.', 'She’s just resting.', 'She’s been resting since Easter.'],
    ['Seen my new ute?', 'Is that rust or paint?', 'Bit of both. Holds her together.'],
    ['Nan won forty bucks. She’s shouting fish and chips.', 'Forty bucks between twenty of us?', 'A chip each. Don’t be hōhā.'],
    ['He’s a bit of a dag, your brother.', 'Hard case. Mum says he gets it from Dad.', 'Your dad’s a dag?', 'Nah. Mum’s being polite.'],
    ['Going to the A&P show?', 'Only for the sheep.', 'You’re there for the candy floss.', 'And the sheep.'],
    ['Read the paper? Another works closing.', 'Mainland’s buggered, eh.', 'Rest of the country’s not far behind.'],
    ['Got a smoke?', 'Pōhara, bro. Rolled me last one.', 'Story of the South Island.'],
    ['Met the new bloke at the pub?', 'Waha pakaru. Never shuts up.', 'Talks more than your nan.', 'Nobody talks more than my nan.'],
    ['Clubrooms Saturday?', 'Free sausages?', 'Sausages. Not free.', 'Then I’ve got a thing.'],
    ['Jandals in the supermarket? Bit common.', 'Gumboots at the bank. Who’s common now?'],
    ['Talofa! How’s your mum?', 'Running the church fundraiser. Again.', 'Tell her I’ll buy a raffle.', 'Buy ten. She’ll know.'],
    ['You told Dad I pranged the car?', 'Nah. I told Mum.', 'Auē. That’s way worse.'],
    ['Why’s he so whakamā?', 'Asked a girl to the dance.', 'And?', 'Her dad answered the phone.'],
    ['They reckon MMP’s next year. Two votes.', 'Two votes? I can’t be bothered with one.'],
    ['Roof’s leaking. She’ll be right.', 'You said that in March.', 'And it’s still mostly a roof.'],
    ['Who’s that bloke staring at us?', 'Dunno. Ihu kurī, whoever he is.', 'Tō ihu, mate! Yeah, you!'],
    ['My boss is useless as tits on a bull.', 'Least you’ve got a boss.', 'Fair point. Shout you a beer?'],
    ['Mum wants us at church Sunday.', 'Both services?', 'And the lunch.', 'Auē. Kiss the footy goodbye.'],
    ['Bro, you’re tutū with my radio again.', 'Finding a better station.', 'There isn’t one. It’s Timaru.'],
    ['Got laid off Friday. By letter.', 'Bastards. Fourteen years, wasn’t it?', 'Sixteen. Didn’t even spell me name right.'],
    ['Fuck me, have you seen the price of petrol?', 'I’m walking. Have you seen the price of shoes?'],
    ['Your dog shat on my lawn again.', 'He’s making a statement.', 'Tell him to make it on his own bloody lawn.'],
    ['Kev’s selling his Chancellor.', 'That shitbox? Who’d buy it?', 'You, if he gets you pissed first.'],
  ],
  night: [
    ['Where you off to this late?', 'Home. Eventually.', 'That’s not a direction, mate.'],
    ['Bouncer reckons I’m too pissed.', 'You’re holding a lamppost.', 'It’s holding me.'],
    ['Got any money for a taxi?', 'Twenty cents and a button.', 'Walking it is.'],
    ['Hear that?', 'Boy racers on the main drag.', 'Every Friday, like a bloody choir.'],
    ['Stop being tutū. Leave the dog alone.', 'He started it.', 'He’s asleep, ya egg.'],
    ['Chippy’s shut.', 'Dairy?', 'Shut.', 'Auē. We’ll starve by morning.'],
    ['You walking me home?', 'Halfway. Then you’re on your own.', 'Ka pai. Halfway’s my favourite.'],
    ['Pub was rough as guts tonight.', 'You started the fight.', 'Only a little one.'],
    ['I’m gonna spew.', 'Not on me shoes, ya dickhead!', 'Too late.'],
  ],
  norwester: [
    ['This wind’s making everyone a prick.', 'You were a prick before the wind.', 'Fair.'],
    ['Washing’ll be dry in five minutes.', 'Dry and halfway to Rangiora.'],
    ['Hot one, eh?', 'Hot, dry, and the dog’s growling at the sky.'],
    ['Look at that arch.', 'Rain by the weekend.', 'Or a southerly. Or both. It’s Canterbury.'],
    ['Nor’wester’s got my head pounding.', 'That’s the beer.', 'Beer doesn’t have dust in it.'],
    ['Hōhā, this wind.', 'Wind’s not listening, e hoa.', 'Nobody ever listens to me.'],
  ],
  southerly: [
    ['Southerly’s in.', 'Told ya this morning.', 'You say that every morning.'],
    ['Brass monkeys.', 'Should’ve brought a jersey.', 'Should’ve stayed in bed.'],
    ['Lambs’ll cop it tonight.', 'Poor buggers. Hope they got ’em in.'],
    ['Thirty degrees at lunch, eight now.', 'Welcome to Canterbury, mate.'],
    ['My ears have gone.', 'Your hat’s gone too.', 'Where?', 'Ashburton, probably.'],
    ['Snow on the hills tomorrow.', 'Kids’ll love it.', 'Kids’ll be off school. I’ll hate it.'],
  ],
  rain: [
    ['Raining again.', 'Good for the farmers.', 'Farmers are never happy.', 'True.'],
    ['You’re soaked.', 'Umbrella turned inside out.', 'So did your hair.'],
    ['Coming down like a cow pissing on a flat rock.', 'Lovely image. Cheers for that.'],
    ['Gumboots or jandals?', 'Both. Covering my options.'],
    ['River’s up.', 'Brown as gravy.', 'Don’t go fishing, then.'],
    ['Rain’s ruined the footy.', 'Mud’s half the fun.', 'Mud’s all the fun, e hoa.'],
  ],
} as const satisfies Record<string, readonly (readonly string[])[]>;

export type ConvoKind = keyof typeof CONVOS;

/**
 * Conversations that only make sense from a point in 1995, gated on the story. `from` (and `until`, exclusive)
 * count the jobs done: the six run in order through the year (src/missions/defs/cast.ts), so with n done it is
 * somewhere between job n's date and job n + 1's.
 *   2 done: after 14 May (the Cup)        3 done: after 24 June (the World Cup final, Mururoa announced)
 *   4 done: September (the first test)    5 done: after 23 September (Ruapehu, the Shield lost)
 */
export const DATED_CONVOS: readonly { from: number; until?: number; lines: readonly string[] }[] = [
  { from: 2, until: 4, lines: ['Five-nil, bro! The Cup’s ours!', 'Never sailed a boat in me life.', 'Me neither. Best day ever.'] },
  { from: 2, until: 4, lines: ['Still got your red socks on?', 'Haven’t washed ’em since San Diego.', 'I can tell from here, mate.'] },
  { from: 3, lines: ['Still reckon somebody poisoned the boys.', 'Dodgy kai, the night before.', 'Dodgy something, that’s for sure.'] },
  { from: 3, lines: ['Not drinking French wine any more.', 'You never drank wine.', 'Well, now it’s political.'] },
  { from: 4, lines: ['Hear the French let one off?', 'Bastards. Do it in their own backyard.', 'Navy’s up there. Should’ve sent my nan.'] },
  { from: 5, lines: ['Ruapehu’s blowing its top again.', 'North Island problems.', 'Ash’ll blow down here, you watch.'] },
  { from: 5, lines: ['Shield’s gone. Nil to thirty-five.', 'To bloody Auckland.', 'Don’t. I’m still in mourning.'] },
  { from: 5, lines: ['Nil. We scored nil. At home.', 'I was there. I’ve blocked it out.', 'Lucky bugger. I watched the replay.'] },
];

/** The dated conversations that fit the story so far. */
export function datedConvos(jobsDone: number): readonly (readonly string[])[] {
  return DATED_CONVOS.filter((c) => jobsDone >= c.from && (c.until === undefined || jobsDone < c.until)).map((c) => c.lines);
}

/** A conversation for two passers-by, coloured by the hour, the weather and (given `jobsDone`) the news. */
export function convoLines(rng: Rand, weather: WeatherKind, night: boolean, rain: number, jobsDone = 0): readonly string[] {
  const news = datedConvos(jobsDone);
  if (news.length && chance(rng, 0.25)) return pick(rng, news);
  if (chance(rng, 0.45)) {
    if (night) return pick(rng, CONVOS.night);
    if (rain > 0.3) return pick(rng, CONVOS.rain);
    if (weather === 'norwester') return pick(rng, CONVOS.norwester);
    if (weather === 'southerly') return pick(rng, CONVOS.southerly);
  }
  return pick(rng, CONVOS.general);
}

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
