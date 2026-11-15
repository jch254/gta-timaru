import type { MissionDef, SpotObject } from '../types';
import { crew, DAZZA, EASTERLY, FLASH, handles, line, MACK, onTheRadio, RENA, TIP, withCameo } from './cast';

/** The top of Dyers Pass, facing back down the hill towards the city: the side Mack arrives from. */
const PASS: SpotObject = { place: 'sign-of-the-kiwi', toward: 'chch-garage' };
const WHARF: SpotObject = { place: 'lyttelton-wharf' };
const PASS_CREW = handles('pass', 4);
const FIRST_WAVE = handles('gate', 4);
const LAST_WAVE = ['flash', ...handles('last', 4)];

/**
 * 6. The finale. Over Dyers Pass in a rising southerly: shoot through the Easterlies' roadblock at the Sign
 * of the Kiwi, stay on the van carrying their bolt cutters down to Lyttelton, then hold the wharf against
 * two waves, the second led by Flash Harkness, while Tip Waaka gets Rena's container onto a truck.
 */
export const southerlyChange: MissionDef = {
  id: 'southerly-change',
  title: 'Southerly Change',
  giver: RENA,
  initial: 'R',
  blurb: "Rena's twenty years of savings are in a container on the wharf at Lyttelton, and Flash Harkness is taking a crew over Dyers Pass to help himself. Get to Tip Waaka on the cranes before they do. There is a southerly coming.",
  reward: 5000,
  placeId: 'chch-garage',
  requires: ['punt-return'],
  finale: true,
  pedDensity: 0.4,
  onEnd(run, result) {
    // The port shut its gates on the whole business; nobody is looking for Mack when it is over.
    if (result === 'passed') run.ctx.police.clear();
  },
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(RENA, "Don't stand there with your mouth open. Yes, it's my money in that container. Twenty years of fish and chips."),
        line(RENA, "It was going to be the lease on the shop, and something for the whānau after I'm gone."),
        line(RENA, "Harkness's boys went through Jock's lock-up last night looking for it. Jock's in Timaru Hospital. Seventy-one, and they used a tyre iron."),
        line(DAZZA, 'Ana rang from the port. The box came off the ship an hour ago, and Harkness is taking a crew over Dyers Pass with bolt cutters.'),
        line(RENA, "Tip Waaka drives the crane at Lyttelton. He's whānau, near enough. Get to him before they do."),
        line(RENA, "And Mack. Come back. I've buried enough of this family."),
        line(DAZZA, "Shotgun's on the bench. V8's out front. Try and bring one of them home."),
      ],
    },
    {
      kind: 'setWeather',
      weather: 'southerly',
      transition: 240,
      // The weatherman, on the workshop radio (a cameo).
      lines: withCameo('jim-hickory', (jim) => [
        line(onTheRadio(jim), 'A warning for Canterbury tonight: a sharp southerly change is coming up the coast, with heavy rain close behind it.'),
      ]),
    },
    { kind: 'giveWeapon', weapon: 'pistol', ammo: 36 },
    { kind: 'giveWeapon', weapon: 'shotgun', ammo: 30, select: true, armour: 100, toast: 'Shotgun, shells and a vest from the bench' },
    { kind: 'spawnVehicle', as: 'v8', spec: 'v8sedan', at: { place: 'chch-garage', snap: 'lane', along: 7, kerb: true }, owned: true, health: 1.6 },

    // The Sign of the Kiwi: two cars across the road, four Easterlies, and the van with the cutters waiting behind them.
    { kind: 'spawnVehicle', as: 'block-ute', spec: 'ute', at: { ...PASS, snap: 'road', along: 16, left: 1.6, turn: Math.PI / 2 }, activate: 320 },
    { kind: 'spawnVehicle', as: 'block-sedan', spec: 'v8sedan', at: { ...PASS, snap: 'road', along: 21, left: -2.2, turn: -Math.PI / 2.3 }, activate: 320 },
    { kind: 'spawnVehicle', as: 'van', spec: 'van', at: { place: 'sign-of-the-kiwi', snap: 'lane', toward: 'lyttelton-wharf', along: 40 }, ai: { aggression: 1.7, cruiseSpeed: 24 }, activate: 320 },
    {
      kind: 'spawnPeds',
      peds: crew('pass', PASS, [{ weapon: 'pistol' }, { weapon: 'shotgun' }, { weapon: 'pistol' }, { weapon: 'bat', health: 130 }], 8, 3.5),
      activate: 120,
    },
    {
      kind: 'goTo',
      to: 'sign-of-the-kiwi',
      radius: 75,
      marker: false,
      objective: 'Take Dyers Pass Road up to the Sign of the Kiwi',
      cues: [{ at: 35, lines: [line(MACK, "Southerly's coming up the harbour. You can smell the rain in it.")] }],
    },
    {
      kind: 'eliminate',
      targets: PASS_CREW,
      objective: 'Clear the Easterlies off the pass ({n} left)',
      lines: [line(EASTERLY, "Road's closed, mate."), line(MACK, 'Not to me.')],
    },
    {
      kind: 'chase',
      target: 'van',
      to: 'lyttelton-wharf',
      maxDistance: 480,
      grace: 6,
      arriveRadius: 80,
      cruiseSpeed: 24,
      aggression: 1.7,
      objective: 'Their van is running for the port with the bolt cutters. Stay on it',
      lostReason: 'The van got clean away. By the time you reached the wharf the container was open and empty',
      lines: [line(EASTERLY, 'Go! Get the cutters down to the wharf!'), line(MACK, "Bolt cutters. They're going for the box now.")],
    },
    {
      kind: 'goTo',
      to: 'lyttelton-wharf',
      radius: 45,
      timer: { base: 50, perKm: 55, to: 'lyttelton-wharf', label: 'Bolt cutters', reason: 'They had the container open and empty before you got down the hill' },
      objective: 'Get down to the wharf at Lyttelton',
    },

    // Last stand. Tip shuts the port gates: no police, no ambulance, nobody until it is over.
    {
      kind: 'spawnPeds',
      peds: crew('gate', WHARF, [{ weapon: 'pistol' }, { weapon: 'pistol' }, { weapon: 'shotgun' }, { weapon: 'bat', health: 130 }], 30, 5),
      wait: true,
      police: { clear: true },
    },
    { kind: 'spawnPickup', pickup: 'armour', at: { ...WHARF, snap: 'verge', along: 9 } },
    {
      kind: 'eliminate',
      targets: FIRST_WAVE,
      police: { suspend: true },
      objective: 'Hold the wharf ({n} left)',
      lines: [
        line(TIP, "Kia ora. You'll be Rena's boy. She said you'd be late, and you'd look like your mother."),
        line(TIP, "I've shut the gates. No police, no ambulance, nobody till the southerly's through. Just us and them."),
        line(TIP, "I'll get the box onto the truck. You keep them off my crane."),
      ],
    },
    {
      kind: 'spawnPeds',
      peds: [
        { as: 'flash', at: { ...WHARF, snap: 'road', along: -42 }, name: FLASH, kind: 'gang', behaviour: 'attack', weapon: 'rifle', health: 260, look: { topStyle: 'jacket', top: 0x8a7350, legs: 0x2b2b30, hairStyle: 'mullet', hat: 'none' } },
        ...crew('last', WHARF, [{ weapon: 'shotgun' }, { weapon: 'pistol' }, { weapon: 'pistol' }, { weapon: 'pistol', health: 130 }], -34, -5),
      ],
      wait: true,
      police: { suspend: true },
    },
    {
      kind: 'eliminate',
      targets: LAST_WAVE,
      police: { suspend: true },
      objective: 'Flash Harkness has come himself. Finish it ({n} left)',
      lines: [
        line(FLASH, 'Fourteen years on a chain, Tully, and you think you can stand between me and my money?'),
        line(MACK, "It's not your money. It's twenty years of fish and chips."),
      ],
    },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(TIP, "Box is on the truck. And here's your southerly, right on time."),
        line(MACK, 'Harkness?'),
        line(TIP, "Somebody will have to tell his mother. He had one, you know. They all do."),
        line(MACK, 'Rena said to bring a coat.'),
        line(TIP, "She's usually right. Kia kaha, e hoa. Go home and tell her it's done."),
      ],
    },
  ],
};
