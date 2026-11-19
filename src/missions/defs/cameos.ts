/**
 * Cameos: familiar faces about town. Each is an affectionate LOOK-ALIKE PARODY of the kind of public figure
 * every New Zealander knew in 1995, under an invented name. Nobody here is a real person, and no real
 * person's name appears anywhere in the game.
 *
 * This file is the whole cast. To change someone, edit their entry; to remove someone, delete their entry
 * (any lines they have in the story drop out with them: see `withCameo` in cast.ts). `src/missions/cameos.ts`
 * does the rest: it puts each one at their spot when the player is near, has them say their next line when
 * the player walks up, and takes them away again once the player has gone.
 *
 * House rules. Keep to them when adding or rewriting anyone:
 *  1. Invented names only. Never a real person's name, here or in a line.
 *  2. Benign. A cameo is never a criminal, a gang member or a mission target, and is never shown as corrupt,
 *     drunk, stupid or otherwise run down. Nothing sexual. The humour is warm.
 *  3. They cannot be hurt. The game takes care of that (no damage, no blood, no body): if the player takes a
 *     swing or a shot at one they say their `oi` line and get out of the way.
 *  4. Original lines only: no real brands, no song lyrics, nobody's actual catchphrase.
 *  5. Subtitles only. Lines are at most 150 characters.
 *  6. Māori and Pasifika characters, and te reo, are written with respect. No caricature, no mock accents.
 */
import type { HumanoidLook, WeatherKind } from '../../core/types';
import type { Spot } from '../types';

/** Somebody generic who stands with a cameo (a film crew). They never speak. */
export interface CameoExtra {
  name: string;
  look: HumanoidLook;
  /** Where they stand relative to the cameo, in the cameo's own frame: metres in front of them / to their left. */
  forward: number;
  left: number;
  /** A film camera on a tripod in front of them. */
  camera?: boolean;
}

export interface CameoDef {
  /** Stable id (kebab-case). The story refers to cameos by this. */
  id: string;
  /** The invented name shown with their subtitles. */
  name: string;
  /** For whoever edits this file: who they are in the game's world. Never shown to the player. */
  about: string;
  look: HumanoidLook;
  /**
   * Where they stand, and which way they face. Same format as mission spots (`Spot` in ../types.ts): a place
   * id, a landmark kind or `x, z`, then `forward` / `left` metres and a `turn` in that frame.
   */
  at: Spot;
  /** Hours of the day they are there, [from, to) on the 24-hour clock. Omit for always. */
  hours?: readonly [number, number];
  /** What they say, in order, one line each time the player walks up. Four to six. */
  lines: readonly string[];
  /** A line for the weather of the moment, said first whenever the weather has changed. */
  weather?: Partial<Record<WeatherKind, string>>;
  /** What they say if the player hits or shoots at them (then they move off). */
  oi: string;
  /** What they do while speaking: 'orate' = one hand up to the crowd, 'point' = pointing up at the sky. */
  gesture?: 'orate' | 'point';
  /** Strike that pose every few seconds whether or not anyone is listening. */
  restless?: boolean;
  /** Stands this many metres above the ground (the top of the speaker's ladder in the Square). */
  lift?: number;
  /** Something worn: a towel round the neck, or a number on the back of the jersey. */
  wears?: { towel?: number; number?: string };
  extras?: readonly CameoExtra[];
}

const BLACK = 0x121214;

export const CAMEOS: readonly CameoDef[] = [
  {
    id: 'warlock',
    name: 'The Warlock of the Square',
    about: 'Cathedral Square’s resident orator, up his stepladder at Speakers’ Corner under the cathedral tower.',
    look: { skin: 0xe2b090, hair: 0xb8b8b4, hairStyle: 'long', top: 0x17171b, topStyle: 'jacket', legs: 0x17171b, shoes: BLACK, hat: 'brim', hatColor: 0x141416, height: 1, bulk: 0.96 },
    // The ladder the Square is built with: 14.5 m north of the west door's axis, 33 m out from the middle.
    at: { landmark: 'cathedral-square', forward: 33, left: -14.5, turn: 0.5 },
    hours: [10, 17.5],
    lift: 2.15,
    gesture: 'orate',
    restless: true,
    lines: [
      'Gather round! Every map of the world is printed upside down, and I alone in this Square am holding mine the right way up.',
      'Put the South Island at the top, where it belongs, and suddenly the rest of the planet is hanging on for dear life.',
      'I am a living work of art. You may look, you may argue, but kindly do not lean on the ladder.',
      'The farmers of Canterbury want rain. I shall dance for it on Thursday. Bring a coat: I am rarely wrong and never dry.',
      'You, in the work boots! You have the look of a man who thinks for himself. Stop it at once and listen to me.',
      'Heckle all you like. I have been shouted at by experts, and you, sir, are a keen amateur at best.',
    ],
    oi: 'Oi! You cannot assault a work of art. There is a by-law!',
  },
  {
    id: 'nicky-roe',
    name: 'Mayor Nicky Roe',
    about: 'The Mayor of Christchurch, on the Town Hall forecourt between openings.',
    look: { skin: 0xe8b99a, hair: 0xb89a5a, hairStyle: 'bob', top: 0xe0407a, topStyle: 'jacket', legs: 0x2b2e35, shoes: BLACK, hat: 'none', female: true, height: 0.97, bulk: 1 },
    // By the fountain on the forecourt.
    at: { landmark: 'town-hall', forward: 36 },
    hours: [9, 18],
    lines: [
      'Kia ora! Lovely to see you. I have opened a fountain, a footbridge and a fête today, and it is barely lunchtime.',
      'Isn’t this city marvellous? Mind the ribbon, dear. I haven’t cut that one yet.',
      'If it stands still in Christchurch for a fortnight, I will turn up with the big scissors and declare it open.',
      'Have you ridden the new tram? I declared it open in February and I have been back eleven times since, purely for quality control.',
      'Do come to the flower show. I am opening it. I am also judging the marrows, which is the dangerous part.',
      'You look as though you could use a good day. Have this one, with the compliments of the council.',
    ],
    oi: 'Oi! That is quite enough of that, thank you!',
  },
  {
    id: 'jase-cannon',
    name: 'Jase Cannon',
    about: 'Presenter of the after-school children’s television show, filming outside the Arts Centre.',
    look: { skin: 0xe8b99a, hair: 0x5a4028, hairStyle: 'short', top: 0xf07a1a, topStyle: 'tee', legs: 0x3a4a6a, shoes: 0xe8e8e4, hat: 'none', height: 1, bulk: 0.95 },
    // The forecourt on Worcester Boulevard, in front of the clock tower.
    at: { place: 'arts-centre', left: 7, forward: -1.5 },
    hours: [9, 17],
    gesture: 'orate',
    lines: [
      'Hey hey, look who it is! Give us a wave for the kids at home. No? A shy one. We love a shy one!',
      'We’re filming straight after the break. Stick around, you could win a T-shirt. Everybody wins a T-shirt!',
      'Big smiles, Canterbury! It’s a beautiful day and nobody has been gunged yet!',
      'The puppet’s in the van having a lie-down. Between you and me, he’s the real talent.',
      'After school, every weekday. Tell your nieces and nephews Jase said gidday!',
    ],
    oi: 'Hey! Not in front of the kids!',
  },
  {
    id: 'sione-lotu',
    name: 'Sione “Freight Train” Lotu',
    about: 'The young winger everybody is talking about, at the Lancaster Park gates after training.',
    look: { skin: 0x8a5c3a, hair: 0x120e0a, hairStyle: 'short', top: 0x101012, topStyle: 'jersey', legs: 0x101012, shorts: true, shoes: 0x151515, socks: 0x101012, hat: 'none', height: 1.13, bulk: 1.32 },
    // The footpath by the turnstiles on Stevens Street.
    at: { place: 'lancaster-park', left: -5, forward: 1 },
    hours: [8, 19],
    wears: { number: '11' },
    lines: [
      'Oh, hey. Yeah, that was me. The boys did all the hard work, I just ran where they put me.',
      'Everybody asks about the World Cup. Honest, I mostly remember being hungry.',
      'Coach says keep my feet on the ground. Then he says run over the top of people. Bit confusing, eh.',
      'Mum taped every game. She fast-forwards through my bits to get to the haka.',
      'Sorry, was I in your way? I get that a lot.',
      'You have a good one, eh. Look after yourself.',
    ],
    oi: 'Oi, easy, bro. I don’t want any trouble.',
  },
  {
    id: 'roger-hadfield',
    name: 'Sir Roger Hadfield',
    about: 'Retired fast bowler, in his whites, taking the air in Hagley Park.',
    look: { skin: 0xdcab8a, hair: 0x3a2a1c, hairStyle: 'short', top: 0xf2efe4, topStyle: 'uniform', legs: 0xf2efe4, shoes: 0xf0f0ea, hat: 'brim', hatColor: 0xf2efe4, height: 1.06, bulk: 0.95 },
    // South Hagley Park, a dozen metres back from Riccarton Avenue, across the road from the hospital.
    at: { x: -553, z: -3772, turn: 2.6 },
    hours: [9, 18],
    lines: [
      'Good length, just outside off stump, ten thousand times over. People call it a gift. It was arithmetic.',
      'Seventeen paces, not sixteen. I measured the run-up once and saw no reason to measure it again.',
      'Retirement is very like bowling into the wind at Lancaster Park. One simply gets on with it.',
      'You have a decent shoulder on you. Wasted, I expect, on whatever it is you do.',
      'I do not sign cricket balls on the seam. It spoils the seam.',
    ],
    oi: 'Oi. That was neither called for nor well aimed.',
  },
  {
    id: 'pete-blackwell',
    name: 'Skipper Pete Blackwell',
    about: 'Yachtsman, home since the five-nil Cup win in May 1995, on the waterfront at Lyttelton in his lucky red socks.',
    look: { skin: 0xd8a888, hair: 0x8a6a3a, hairStyle: 'short', top: 0x1e2a44, topStyle: 'jacket', legs: 0xe6dfc8, shorts: true, shoes: 0x6a4a2c, socks: 0xc8201e, hat: 'none', height: 1.04, bulk: 1.05 },
    // The harbour side of Norwich Quay, a hundred metres along from the wharf gate, with the port behind him.
    at: { place: 'lyttelton-wharf', dx: 102, dz: -50, snap: 'verge', road: 'norwich', turn: -Math.PI / 2 },
    hours: [7, 19],
    lines: [
      'Proper harbour, Lyttelton. Give me a week of this breeze and a decent crew and I’d sail her to San Diego.',
      'The Cup’s coming home, mate. The whole country held its breath and the boat did the rest.',
      'The red socks? Lucky. Haven’t lost in them yet, so nobody is game to put them through the wash.',
      'People think it’s about the fastest boat. It’s about forty people who never drop a spanner.',
      'Wind’s backing round to the south. You learn to smell it before you see it.',
    ],
    oi: 'Oi! Steady on, sailor!',
  },
  {
    id: 'jim-hickory',
    name: 'Jim Hickory',
    about: 'The six o’clock television weatherman, up on the Summit Road by the transmitter, reading the sky. 1995 gave him plenty: the big September snow, then a wet spring.',
    look: { skin: 0xe2b090, hair: 0x9a968e, hairStyle: 'short', top: 0x6a5a48, topStyle: 'jacket', legs: 0x3a3f48, shoes: 0x2a1a12, hat: 'none', height: 1, bulk: 1.06 },
    // The roadside below the Sugarloaf transmitter, facing the road.
    at: { landmark: 'sugarloaf-tower', snap: 'verge', road: 'summit', out: 3, turn: -Math.PI / 2 },
    hours: [6.5, 20.5],
    gesture: 'point',
    restless: true,
    weather: {
      clear: 'Not a cloud from here to the Alps. Enjoy it. Canterbury never lets a day like this go unpunished.',
      norwester: 'See that band of cloud standing over the Alps? That’s the nor’west arch. Warm, dry, and everyone scratchy by teatime.',
      southerly: 'There’s your southerly change, right on the hour. Ten degrees off the temperature and the washing back indoors.',
      fog: 'Fog’s sitting in the harbour like porridge in a bowl. It will lift about lunchtime, or I’ll eat my pointer.',
      overcast: 'High cloud, light easterly, nothing to frighten the sheep. Dull as a committee meeting, but it won’t rain.',
    },
    lines: [
      'I do this for the whole country at six o’clock. Up here I just do it for me.',
      'People blame me for the weather. I only read it out. Take it up with the Tasman Sea.',
      'That September snow put forty-five centimetres on Tekapo. I said “significant falls” the night before, and I have never been sorrier to be right.',
      'The trick is to wave an arm at the map with confidence. The isobars do the rest.',
      'Southerly, nor’wester, easterly off the sea. Canterbury gets all three before lunch and calls it a nice day.',
    ],
    oi: 'Oi! I only read the forecast, I don’t make it!',
  },
  {
    id: 'rochelle-huntley',
    name: 'Rochelle Huntley',
    about: 'Model, on New Brighton beach filming this summer’s ice-cream advertisement.',
    look: { skin: 0xf0c8ae, hair: 0xc8a860, hairStyle: 'long', top: 0xf2f0e8, topStyle: 'tee', legs: 0x7ab0d8, shorts: true, shoes: 0xe8e8e4, hat: 'none', female: true, height: 1.05, bulk: 0.92 },
    // Down on the sand, the sea behind her, facing the camera and the dunes.
    at: { place: 'new-brighton-beach', forward: -82, left: -20 },
    hours: [8, 18],
    extras: [
      { name: 'Camera operator', forward: 5.5, left: 0.9, camera: true, look: { skin: 0xdcab8a, hair: 0x241a12, hairStyle: 'short', top: 0x3a3a40, topStyle: 'tee', legs: 0x2c3a5c, shoes: 0x2a2a2e, hat: 'cap', hatColor: 0x25304a, height: 1, bulk: 1.05 } },
      { name: 'Director', forward: 6.2, left: -1.8, look: { skin: 0xe8b99a, hair: 0x8a8a88, hairStyle: 'short', top: 0x4a3a2c, topStyle: 'jacket', legs: 0x6a6a5a, shoes: 0x4a3626, hat: 'brim', hatColor: 0xc8b890, female: true, height: 0.96, bulk: 1 } },
    ],
    lines: [
      'Take fourteen. The ice cream keeps melting before the director is happy with the clouds.',
      'A hokey pokey cone, a sunny beach and a big smile. Hardest job in the world by about three o’clock.',
      'Mind the cables, eh. And if a seagull makes a move on the cone, you never saw me panic.',
      'They want summer in thirty seconds. I said, have you tried New Brighton in an easterly?',
      'I’ll be on your telly all summer. Sorry in advance about the jingle.',
    ],
    oi: 'Oi! Watch it! Cut, cut!',
  },
  {
    id: 'jim-boulder',
    name: 'Prime Minister Jim Boulder',
    about: 'The Prime Minister, a farmer first, shaking hands along East Street in Ashburton a year out from an election.',
    look: { skin: 0xe2b090, hair: 0xb8b8b4, hairStyle: 'short', top: 0x1e2a44, topStyle: 'jacket', legs: 0x1e2a44, shoes: BLACK, hat: 'none', height: 1.02, bulk: 1.2 },
    // The footpath outside the shops, a few doors along from the stock agent's, facing the street.
    at: { place: 'ashburton-stock-agent', snap: 'verge', along: -26, turn: -Math.PI / 2 },
    hours: [9, 17.5],
    lines: [
      'Jim Boulder. Good to meet you. Firm handshake, that. You’ll have done an honest day’s work or two.',
      'I was a farmer long before I was a politician. The sheep were the tougher crowd, and they never once asked for a recount.',
      'Everybody asks me when the election will be. When I call it, and not a day before. A farmer never names the day he starts shearing, either.',
      'Mid Canterbury. Best soil in the country, and people who tell you exactly what they think of you.',
      'No speeches today, I promise. A cup of tea at the hall and a look at the new irrigation scheme.',
    ],
    oi: 'Oi! Steady on. I have been kicked by professionals!',
  },
  {
    id: 'ted-hillsborough',
    name: 'Sir Ted Hillsborough',
    about: 'Mountaineer and beekeeper, elderly and very tall, down at Caroline Bay for the carnival.',
    look: { skin: 0xd49a7c, hair: 0xd8d6d0, hairStyle: 'short', top: 0x6f7a52, topStyle: 'jacket', legs: 0x6a6a5a, shoes: 0x4a3626, hat: 'brim', hatColor: 0xc8b890, height: 1.12, bulk: 1.02 },
    // The carnival's front lawn, facing Virtue Avenue.
    at: { landmark: 'caroline-bay-carnival', forward: 62 },
    hours: [9, 20],
    lines: [
      'Climbing? Oh, a bit, when I was younger. You go up, you have a look round, you come down. Nothing to it, really.',
      'I keep bees, mostly. Much harder than mountains. A mountain has never once gone off in a huff.',
      'It was rather cold near the top, as I recall. We had a cup of tea afterwards, which helped.',
      'Lovely carnival. I had a go on the hoopla. Didn’t win anything, but one doesn’t like to make a fuss.',
      'People are very kind about it all. Really, the hill did most of the work by staying where it was.',
    ],
    oi: 'Oi. I say, steady on.',
  },
  {
    id: 'danny-loadman',
    name: 'Danny Loadman',
    about: 'Timaru’s own swimmer, towel round his neck, between training sessions at Caroline Bay.',
    look: { skin: 0xdcab8a, hair: 0x3a2a1c, hairStyle: 'short', top: 0x1d3a8a, topStyle: 'singlet', legs: 0x151515, shorts: true, shoes: 0x1a2a5a, hat: 'none', height: 1.04, bulk: 1 },
    // The lawn above the beach, across Virtue Avenue from the carnival.
    at: { landmark: 'caroline-bay-carnival', forward: 106, left: 24, turn: Math.PI },
    hours: [7, 19.5],
    wears: { towel: 0xf2f0e8 },
    lines: [
      'Morning swim’s done, afternoon swim’s in an hour. Atlanta is next year and the clock doesn’t care how I feel.',
      'Six k in the pool before breakfast, then the Bay for fun. Yeah, I know. Mum says the same.',
      'The Bay’s freezing, eh. Good for the lungs. That’s what I tell my toes, anyway.',
      'Timaru born and bred. If I get on that plane to Atlanta, the whole town is coming in my togs bag.',
      'Sorry, can’t stop long. Coach times my walks to the dairy.',
    ],
    oi: 'Oi! What’s your problem, mate?',
  },
];

/** A cameo by id, or null if they have been taken out of the cast. */
export function findCameo(id: string): CameoDef | null {
  for (const cameo of CAMEOS) if (cameo.id === id) return cameo;
  return null;
}
