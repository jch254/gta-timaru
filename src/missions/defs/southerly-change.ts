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
 * two waves — the second led by Flash Harkness in person — while Tip Waaka gets Rena's container onto a
 * truck. Rena comes up for what is hers, and the story ends where it started: with the whānau.
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
      // A roadblock stands its ground: hostile-from-spawn had them charging the car 120 m down the hill
      // (and converging on the retry's resume spot during the fade). The turn comes with the line below.
      // Boat-sheds weight (the finale's fights escalate from there: three guns at the gate, four with
      // Flash): with a shotgun in this crew the opening fight alone cost the honest playtest its whole
      // 200-point pool three attempts in four, with two more waves still to come.
      peds: crew('pass', PASS, [{ weapon: 'pistol' }, { weapon: 'bat' }, { weapon: 'pistol' }, { weapon: 'bat', health: 130 }], 8, 3.5, 'stand'),
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
    // The retry resumes down the road on the city side, V8 at the kerb, the roadblock ahead — the same
    // ground a fresh arrival meets it from. Resumed on the crew's own spot, the honest playtest lost its
    // whole pool in eight seconds, three retries straight.
    { kind: 'checkpoint', label: 'the Sign of the Kiwi', at: { ...PASS, snap: 'verge', along: 45 } },
    {
      kind: 'setBehaviour',
      peds: PASS_CREW,
      behaviour: 'attack',
      lines: [line(EASTERLY, "Road's closed, mate."), line(MACK, 'Not to me.')],
    },
    {
      kind: 'eliminate',
      targets: PASS_CREW,
      // The law sits the scripted shoot-outs out (the rule findings 7 and 9 set): there is nobody on the
      // summit to ring it in but the Easterlies, and a patrol car up the pass mid-fight wrecks the van
      // chase the next step depends on. The wharf half already stages the police out explicitly.
      police: { suspend: true },
      objective: 'Clear the Easterlies off the pass ({n} left)',
    },
    {
      kind: 'chase',
      target: 'van',
      // The summit is the end of anyone's patch: a stray light picked up on the drive stood the player
      // under arrest while walking back to the V8. What is left is the chase.
      police: { clear: true },
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
      // Roomy on purpose: the chase supplies the urgency, the timer only stops a player walking it. At 55
      // s/km an honest descent of a wet pass at night — straight after the roadblock fight — kept running
      // out with the wharf in sight.
      timer: { base: 70, perKm: 75, to: 'lyttelton-wharf', label: 'Bolt cutters', reason: 'They had the container open and empty before you got down the hill' },
      objective: 'Get down to the wharf at Lyttelton',
    },

    // Last stand. Tip shuts the port gates: no police, no ambulance, nobody until it is over.
    {
      kind: 'spawnPeds',
      // Two guns a wave is the measured ceiling for honest stand-and-fight play (each gun lands 15–20
      // points per six seconds; three converging out-sustain pool plus kit). The waves escalate by the
      // leader, not the gun count: nobody here, Flash at 260 behind the second.
      peds: crew('gate', WHARF, [{ weapon: 'pistol' }, { weapon: 'bat' }, { weapon: 'pistol' }, { weapon: 'bat', health: 130 }], 30, 5),
      wait: true,
      police: { clear: true },
    },
    // Holding a wharf against two waves costs more than one vest: the pass fight honestly costs well over
    // half the pool, so kit waits at the gate and again between the waves (the honest playtest reached the
    // wharf on 38–63 health, bare, and died there every attempt).
    { kind: 'spawnPickup', pickup: 'armour', at: { ...WHARF, snap: 'verge', along: 9 }, respawn: 40 },
    { kind: 'spawnPickup', pickup: 'health', at: { ...WHARF, snap: 'verge', along: 12 }, respawn: 40 },
    { kind: 'checkpoint', label: 'the wharf gate', at: 'lyttelton-wharf' },
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
    // The crane crew's first-aid box and a spare vest, by the gatehouse, before Flash's wave comes through.
    { kind: 'spawnPickup', pickup: 'health', at: { ...WHARF, snap: 'verge', along: 4 }, respawn: 40 },
    { kind: 'spawnPickup', pickup: 'armour', at: { ...WHARF, snap: 'verge', along: 6 }, respawn: 40 },
    { kind: 'checkpoint', label: 'the last wave', at: 'lyttelton-wharf' },
    {
      kind: 'spawnPeds',
      // The wave walks in standing: Flash is the kind of man who monologues before the shooting, and the
      // beat of talk below is what makes the resume (and the dash for the gatehouse kit) survivable against
      // a rifle that distance alone cannot answer.
      peds: [
        // Flash collects in person: a shotgun and 260 points, a boss who has to close rather than a rifle
        // that shreds the whole pool from range — measured honestly, the rifle wave dealt 188 points in six
        // seconds, more than any kit survives. His crew matches the gate wave; he is the escalation.
        { as: 'flash', at: { ...WHARF, snap: 'road', along: -42 }, name: FLASH, kind: 'gang', behaviour: 'stand', weapon: 'shotgun', health: 260, look: { topStyle: 'jacket', top: 0x8a7350, legs: 0x2b2b30, hairStyle: 'mullet', hat: 'none' } },
        ...crew('last', WHARF, [{ weapon: 'pistol' }, { weapon: 'bat' }, { weapon: 'bat' }, { weapon: 'pistol', health: 130 }], -34, -5, 'stand'),
      ],
      wait: true,
      police: { suspend: true },
      lines: [
        line(TIP, "Second lot coming through the gate. Big fella out front in the long coat — that'll be your Harkness."),
        line(FLASH, 'TULLY!'),
      ],
    },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(FLASH, 'Fourteen years on a chain, Tully, and you think you can stand between me and my money?'),
        line(MACK, "It's not your money. It's twenty years of fish and chips."),
      ],
    },
    { kind: 'setBehaviour', peds: LAST_WAVE, behaviour: 'attack' },
    {
      kind: 'eliminate',
      targets: LAST_WAVE,
      police: { suspend: true },
      objective: 'Flash Harkness has come himself. Finish it ({n} left)',
      cues: [{ at: 15, lines: [line(FLASH, 'I built the Easterlies out of nothing, you freezing-works nobody! NOTHING!')] }],
    },
    // Rena was never going to wait in Sydenham for news. She came up for what is hers.
    {
      kind: 'spawnPeds',
      peds: [
        {
          as: 'rena',
          at: { ...WHARF, snap: 'verge', along: -8 },
          name: RENA,
          kind: 'scripted',
          behaviour: 'stand',
          look: { female: true, hairStyle: 'bob', hair: 0xb8b2a8, topStyle: 'jacket', top: 0x6a3b4a, legs: 0x3a3f48, shoes: 0x2a1a12, height: 0.94, bulk: 1.05 },
        },
      ],
      wait: true,
    },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(TIP, "Box is on the truck. And here's your southerly, right on time."),
        line(MACK, 'Harkness?'),
        line(TIP, "Somebody will have to tell his mother. He had one, you know. They all do."),
        line(RENA, 'Tip Waaka. You shut those gates with my nephew inside them?'),
        line(TIP, "He's standing, isn't he? Kia ora, Rena."),
        line(RENA, "Twenty years of fish and chips in one steel box. Well. Now it's the lease on the shop, and something for the whānau — with both of us alive to see it."),
        line(MACK, "You shouldn't have come up, Aunty."),
        line(RENA, "Boy, I buried your mother. I wasn't going to hear about you from a crane driver. Come home — the fryer's on, and you still look like a dropped pie."),
        line(TIP, "Kia kaha, e hoa. Go on home, and tell the Bay it's done."),
      ],
    },
  ],
};
