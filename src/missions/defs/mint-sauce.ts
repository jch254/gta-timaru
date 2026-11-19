import { TUNING } from '../tuning';
import type { MissionDef, SpotObject } from '../types';
import { cameoRemark, crew, EASTERLY, handles, line, MACK, NEVILLE } from './cast';

const YARD: SpotObject = { place: 'ashburton-stock-agent' };
const COLLECTORS = handles('collector', 3);

/**
 * 3. Mid Canterbury, Saturday 24 June 1995. Canterbury are playing Mid Canterbury for the Ranfurly Shield
 * in Ashburton that afternoon and the World Cup final is on television in the small hours: the whole
 * district is looking the other way, which is why tonight. Rustle a loaded stock truck from a woolshed near
 * Hinds (with the farmer still home), keep it rolling with the Hinds constable on the bumper of something
 * that corners like a wardrobe, and bring it to Neville Stroud's yard in Ashburton, where the Easterlies'
 * collectors are waiting for their cut. Neville is short because of the big works collapse the autumn
 * before last (never named in the game). First shoot-out.
 *
 * The truck is the slowest thing on the road bar the bus, so it is never asked to lose anybody: every patrol
 * car out-drags it, sits on its bumper with a clear view, and a respray is refused while they are watching.
 * (An honest playtest of the old "lose two lights" beat was arrested or shot every time.) What a truck can
 * do is refuse to stop, and an officer can only arrest a driver who has.
 */
export const mintSauce: MissionDef = {
  id: 'mint-sauce',
  title: 'Mint Sauce',
  giver: 'Neville Stroud',
  initial: 'N',
  blurb: "Neville Stroud of Stroud & Daughters has a buyer for two-tooth ewes and no ewes, and a truck already loaded at a woolshed out Hinds way. The whole district is looking at the Shield game. The truck cannot outrun the Hinds constable, so do not stop for him.",
  reward: 1200,
  placeId: 'ashburton-stock-agent',
  requires: ['on-ice'],
  failIf: [{ kind: 'vehicleDestroyed', vehicle: 'truck', reason: 'The truck is wrecked, and forty-two ewes are loose on the plains' }],
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(NEVILLE, "Tully. Russell says you can drive and you don't ask why. Both rare in Mid Canterbury."),
        line(NEVILLE, "A Christchurch outfit takes a third of everything I move. The Easterlies. Since the big works group went under owing every farmer here, I'm short."),
        line(NEVILLE, "So somebody's sheep are making up the difference, and today the whole district is at the Shield game or waiting up for Johannesburg."),
        line(NEVILLE, "Woolshed out Hinds way, truck's loaded for Tuesday's sale, keys on the visor."),
        line(MACK, 'And the cops?'),
        line(NEVILLE, "One constable, at Hinds, and his patch stops where the gravel does. Don't bring him back here. I've a reputation in this town."),
        line(MACK, 'For what?'),
        line(NEVILLE, 'Exactly.'),
      ],
    },
    // Out on East Street the Prime Minister is shaking hands (a cameo: he says this only if he is really there).
    cameoRemark('jim-boulder', (pm) => [
      line(pm, "Gidday! Jim Boulder. Flags the whole length of East Street, eh. Shield day in Ashburton. You couldn't script it better, and believe me, we tried."),
      line(MACK, 'Something like that, Prime Minister.'),
    ]),
    { kind: 'spawnVehicle', as: 'truck', spec: 'farmtruck', at: { place: 'hinds-woolshed', snap: 'verge', out: 2.8 }, health: 1.4 },
    // The farmer is in. His dogs will hear the diff lock before he hears the dogs.
    {
      kind: 'spawnPeds',
      peds: [
        {
          as: 'farmer',
          at: { place: 'hinds-woolshed', snap: 'verge', along: -12 },
          name: 'Farmer',
          kind: 'scripted',
          behaviour: 'wander',
          look: { topStyle: 'tee', top: 0x44503a, legs: 0x6a6a5a, shoes: 0x3a2a1c, hat: 'brim', hatColor: 0x7a6a4a, bulk: 1.12 },
        },
      ],
    },
    {
      kind: 'goTo',
      to: 'hinds-woolshed',
      radius: 45,
      marker: false,
      objective: 'Drive out to the woolshed on the gravel road near Hinds',
      cues: [
        { at: 20, lines: [line(MACK, "Flags on the verandahs and not a car on the road. The whole of Mid Canterbury is at kickoff, and I'm off to work.")] },
        { at: 50, lines: [line(MACK, "Flat as a griddle out here. A man could watch his dog run away for three days.")] },
      ],
    },
    { kind: 'checkpoint', label: 'the woolshed', at: 'hinds-woolshed' },
    {
      kind: 'enterVehicle',
      vehicle: 'truck',
      objective: 'Nick the loaded stock truck',
      lines: [line(MACK, 'Forty-two two-tooths and the keys on the visor. Somebody trusts his neighbours.')],
    },
    {
      kind: 'survive',
      seconds: TUNING.constableSeconds,
      label: 'Constable',
      police: { minLevel: 1 },
      objective: "The Hinds constable can't arrest a truck that won't stop. Keep it rolling till he gives it away",
      toast: "The truck won't outrun anybody, and it doesn't have to: he can only pull you out if you stop",
      failIf: [{ kind: 'abandoned', vehicle: 'truck', distance: 160, reason: 'You left the truck, and the sheep, behind' }],
      lines: [line('Farmer', "Oi! That's the Tuesday draft! Maureen, ring the constable!"), line(MACK, 'Sorry, mate. Truly.')],
      cues: [
        { at: 5, sfx: 'sheep' },
        { at: 16, sfx: 'sheep', lines: [line(MACK, "One constable for forty miles of gravel, and he's missing the Shield for me. Don't stall, Mack.")] },
        { at: 31, sfx: 'sheep', lines: [line(MACK, "Somebody's whole season in the back of this. Don't think about it.")] },
      ],
    },
    // The collectors are already waiting by their car when the truck pulls in.
    {
      kind: 'spawnPeds',
      // Debt muscle, not a firing squad: two bat men who have to close the yard, and the leader with the
      // pistol. This is the game's first shoot-out (mission three); the four-pistol fights live in mission
      // five and the finale. With pistol/bat/pistol the honest bot dropped two and died to the third, every
      // attempt, through the full 150 points of health and oilskin.
      peds: crew('collector', YARD, [{ weapon: 'bat' }, { weapon: 'bat' }, { weapon: 'pistol', health: 130 }], 16, 4, 'stand'),
      activate: 160,
    },
    { kind: 'spawnVehicle', as: 'collectors-car', spec: 'v8sedan', at: { entity: 'collector1', snap: 'lane', along: 7, kerb: true }, activate: 260 },
    {
      kind: 'deliverVehicle',
      vehicle: 'truck',
      to: 'ashburton-stock-agent',
      radius: 14,
      minHealth: 0.3,
      // The end of his patch: the constable gives it away, and what is left is the drive. No "arrive
      // clean" rule: a truck that picks up a light on the way in (a clipped mirror in front of the
      // Ashburton patrol) has no way of losing it, so the yard door does that instead.
      police: { clear: true },
      // The shed swallows the truck on arrival ("Door's down"): once delivered it is out of reach, so the
      // collectors' stray rounds in the fight that follows cannot retroactively fail a job already done.
      handover: true,
      objective: "Get the truck to Stroud's yard on East Street, Ashburton",
      returnObjective: 'Get back in the stock truck',
      damageReason: 'The truck gave out. Neville is not buying mutton by the roadside',
      lines: [line(MACK, "He's dropping back. End of his gravel, or he wants his radio and the second half. Bless you, Hinds.")],
      cues: [
        { at: 8, sfx: 'sheep' },
        { at: 40, sfx: 'sheep' },
      ],
    },
    { kind: 'checkpoint', label: "Stroud's yard", at: 'ashburton-stock-agent' },
    {
      kind: 'say',
      block: true,
      objective: null,
      // Truck in the shed, door down: whatever followed it up East Street has nothing left to look at.
      police: { clear: true },
      lines: [
        line(NEVILLE, "In, in, in. Door's down. What the law can't see, it can't count."),
        line(NEVILLE, 'Forty-one. The docket said forty-two.'),
        line(MACK, 'One got off at Hinds. Said she had family there.'),
        line(NEVILLE, "Hm. Get inside, quick. That's their car."),
        line(EASTERLY, "Stroud! You're light again. And Flash keeps a book. You're in it twice."),
        line(EASTERLY, "And who's the driver? New face. Flash likes new faces. They owe him money sooner."),
        line(NEVILLE, "Under the counter, Tully. It's loaded. I've never had the nerve."),
      ],
    },
    // The game's first shoot-out, on a bare 100-point pool: the comparable boat-sheds fight measured 57 to 114
    // damage against an aim-and-fire bot, so the counter gun comes with something to soak the difference.
    { kind: 'giveWeapon', weapon: 'shotgun', ammo: 20, select: true, armour: 50, toast: "Neville's shotgun from under the counter, and his oilskin off the hook" },
    { kind: 'setBehaviour', peds: COLLECTORS, behaviour: 'attack' },
    {
      kind: 'eliminate',
      targets: COLLECTORS,
      // The law sits this one out: the truck is in the shed with the door down, and an honest playtest had
      // the Ashburton patrol arrive mid-fight, climb to three lights and shoot the delivered truck, failing
      // a job the player had already done. The Easterlies are the beat here; Neville's gun deals with them.
      police: { suspend: true },
      objective: "Deal to the Easterlies' collectors ({n} left)",
    },
    {
      kind: 'say',
      lines: [
        line(NEVILLE, "Well. That's torn it. They'll send more than three next time."),
        line(MACK, "Then you'd better pay me before they get here."),
        line(NEVILLE, "Twelve hundred. And a name: Dazza, in Sydenham. Only man I know who's told the Easterlies no and still has a workshop."),
      ],
    },
  ],
};
