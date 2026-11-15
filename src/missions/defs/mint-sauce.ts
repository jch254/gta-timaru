import type { MissionDef, SpotObject } from '../types';
import { cameoRemark, crew, EASTERLY, handles, line, MACK, NEVILLE } from './cast';

const YARD: SpotObject = { place: 'ashburton-stock-agent' };
const COLLECTORS = handles('collector', 3);

/**
 * 3. Mid Canterbury. Rustle a loaded stock truck from a woolshed near Hinds, shake the police in something
 * that corners like a wardrobe, and bring it to Neville Stroud's yard in Ashburton, where the Easterlies'
 * collectors are waiting for their cut. First shoot-out.
 */
export const mintSauce: MissionDef = {
  id: 'mint-sauce',
  title: 'Mint Sauce',
  giver: 'Neville Stroud',
  initial: 'N',
  blurb: "Neville Stroud of Stroud & Daughters has a buyer for two-tooth ewes and no ewes. There is a truck already loaded at a woolshed out Hinds way. Lose the police before you bring it back to East Street.",
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
        line(NEVILLE, "There's a Christchurch outfit takes a third of everything I move. The Easterlies. This month I'm short."),
        line(NEVILLE, "So somebody's sheep are making up the difference. Woolshed out Hinds way, truck's loaded for Tuesday's sale, keys on the visor."),
        line(MACK, 'And the cops?'),
        line(NEVILLE, "Lose them before you come back. I've a reputation in this town."),
        line(MACK, 'For what?'),
        line(NEVILLE, 'Exactly.'),
      ],
    },
    // Out on East Street the Prime Minister is shaking hands (a cameo: he says this only if he is really there).
    cameoRemark('jim-boulder', (pm) => [
      line(pm, "Gidday! Jim Boulder. Off to work, are you? Good on you. It's people like you who keep this country going."),
      line(MACK, 'Something like that, Prime Minister.'),
    ]),
    { kind: 'spawnVehicle', as: 'truck', spec: 'farmtruck', at: { place: 'hinds-woolshed', snap: 'verge', out: 2.8 }, health: 1.4 },
    {
      kind: 'goTo',
      to: 'hinds-woolshed',
      radius: 45,
      marker: false,
      objective: 'Drive out to the woolshed on the gravel road near Hinds',
    },
    {
      kind: 'enterVehicle',
      vehicle: 'truck',
      objective: 'Nick the loaded stock truck',
      lines: [line(MACK, 'Forty-two two-tooths and the keys on the visor. Somebody trusts his neighbours.')],
    },
    {
      kind: 'loseHeat',
      vehicle: 'truck',
      atLeast: 2,
      holdFor: 35,
      objective: "Lose the cops. Neville won't take hot stock",
      returnObjective: 'Get back in the stock truck',
      failIf: [{ kind: 'abandoned', vehicle: 'truck', distance: 160, reason: 'You left the truck, and the sheep, behind' }],
      lines: [line('Farmer', "Oi! That's the Tuesday draft! Maureen, ring the constable!"), line(MACK, 'Sorry, mate. Truly.')],
      cues: [
        { at: 5, sfx: 'sheep' },
        { at: 22, sfx: 'sheep', lines: [line(MACK, "Somebody's whole season in the back of this. Don't think about it, Mack.")] },
        { at: 45, sfx: 'sheep' },
      ],
    },
    // The collectors are already waiting by their car when the truck pulls in.
    {
      kind: 'spawnPeds',
      peds: crew('collector', YARD, [{ weapon: 'pistol' }, { weapon: 'bat' }, { weapon: 'pistol', health: 130 }], 16, 4, 'stand'),
      activate: 160,
    },
    { kind: 'spawnVehicle', as: 'collectors-car', spec: 'v8sedan', at: { entity: 'collector1', snap: 'lane', along: 7, kerb: true }, activate: 260 },
    {
      kind: 'deliverVehicle',
      vehicle: 'truck',
      to: 'ashburton-stock-agent',
      radius: 14,
      minHealth: 0.3,
      clean: true,
      objective: "Get the truck to Stroud's yard on East Street, Ashburton",
      returnObjective: 'Get back in the stock truck',
      damageReason: 'The truck gave out. Neville is not buying mutton by the roadside',
      cues: [
        { at: 8, sfx: 'sheep' },
        { at: 40, sfx: 'sheep' },
      ],
    },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(NEVILLE, 'Forty-one. The docket said forty-two.'),
        line(MACK, 'One got off at Hinds. Said she had family there.'),
        line(NEVILLE, "Hm. Get inside, quick. That's their car."),
        line(EASTERLY, "Stroud! You're light again. And who's the driver?"),
        line(NEVILLE, "Under the counter, Tully. It's loaded. I've never had the nerve."),
      ],
    },
    { kind: 'giveWeapon', weapon: 'shotgun', ammo: 20, select: true, toast: "Neville's shotgun, from under the counter" },
    { kind: 'setBehaviour', peds: COLLECTORS, behaviour: 'attack' },
    {
      kind: 'eliminate',
      targets: COLLECTORS,
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
