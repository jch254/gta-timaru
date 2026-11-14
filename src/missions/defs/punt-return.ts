import type { MissionDef, SpotObject } from '../types';
import { BRICK, crew, DAZZA, EASTERLY, handles, line, MACK } from './cast';

const SHEDS: SpotObject = { place: 'antigua-boatsheds' };
const ARTS: SpotObject = { place: 'arts-centre' };
const SHED_CREW = handles('shed', 4);
const ARTS_CREW = ['brick', ...handles('art', 4)];

/**
 * 5. Christchurch, around the Avon. The Easterlies frightened the release papers for Dazza's container out
 * of the shipping office and want paying for them at the Antigua Boat Sheds. Two shoot-outs (the sheds, then
 * the Arts Centre), then get the papers home with half the city's police looking for you.
 */
export const puntReturn: MissionDef = {
  id: 'punt-return',
  title: 'Punt Return',
  giver: DAZZA,
  blurb: "The Easterlies have the release papers for Dazza's container and want five thousand for them tonight, at the Antigua Boat Sheds on the Avon. Dazza would rather you went and explained that he isn't paying.",
  reward: 3200,
  placeId: 'chch-garage',
  requires: ['four-avenues'],
  pedDensity: 0.35,
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(DAZZA, "There's a container landing at Lyttelton this week. Forty rebuilt engines out of Osaka. Every cent I've got, and a silent partner's."),
        line(DAZZA, 'Ana at the shipping office holds the release papers. Yesterday two Easterlies told her they knew which school her tamariki go to.'),
        line(DAZZA, "She handed the papers over. I'd have done the same. Now Harkness wants five grand for them, tonight, at the boat sheds on the Avon."),
        line(MACK, "And you'd like me to pay him."),
        line(DAZZA, "I'd like you to take this, and a vest, and go and explain that we're not."),
      ],
    },
    { kind: 'giveWeapon', weapon: 'pistol', ammo: 54, select: true, armour: 50, toast: "Dazza's pistol and a padded vest" },

    // The boat sheds: they are expecting a mechanic with an envelope.
    {
      kind: 'spawnPeds',
      peds: crew('shed', SHEDS, [{ weapon: 'pistol' }, { weapon: 'bat' }, { weapon: 'pistol' }, { weapon: 'bat', health: 130 }], 9, 4, 'stand'),
      activate: 150,
    },
    { kind: 'spawnVehicle', as: 'sheds-car', spec: 'v8sedan', at: { entity: 'shed1', snap: 'lane', along: 8, kerb: true }, activate: 240 },
    { kind: 'spawnPickup', pickup: 'health', at: { ...SHEDS, snap: 'verge', along: -16 } },
    {
      kind: 'goTo',
      to: 'antigua-boatsheds',
      radius: 30,
      marker: false,
      objective: 'Get to the Antigua Boat Sheds on the Avon',
    },
    {
      kind: 'setBehaviour',
      peds: SHED_CREW,
      behaviour: 'attack',
      lines: [line(EASTERLY, "That's not Whitlock. Who's the meat worker?"), line(MACK, 'Dazza sends his apologies. And me.')],
    },
    { kind: 'eliminate', targets: SHED_CREW, objective: 'Deal to the Easterlies at the boat sheds ({n} left)' },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [line(MACK, "No papers. Just a note. 'Arts Centre, the quad. Bring the money this time.' So it was never going to be simple.")],
    },

    // The Arts Centre: Brick, and the papers.
    {
      kind: 'spawnPeds',
      peds: [
        { as: 'brick', at: { ...ARTS, snap: 'verge', along: 8 }, name: BRICK, kind: 'gang', behaviour: 'stand', weapon: 'shotgun', health: 220, look: { topStyle: 'jacket', top: 0x4a2f24, legs: 0x23272e, hairStyle: 'bald', bulk: 1.25, height: 1.06 } },
        ...crew('art', ARTS, [{ weapon: 'pistol' }, { weapon: 'pistol' }, { weapon: 'bat' }, { weapon: 'pistol', health: 130 }], 13, 4, 'stand'),
      ],
      activate: 160,
    },
    { kind: 'spawnVehicle', as: 'arts-van', spec: 'van', at: { entity: 'brick', snap: 'lane', along: -8, kerb: true }, activate: 260 },
    { kind: 'spawnPickup', pickup: 'armour', at: { ...ARTS, snap: 'verge', along: -18 } },
    {
      kind: 'goTo',
      to: 'arts-centre',
      radius: 34,
      marker: false,
      objective: 'Find Brick at the Arts Centre on Worcester Boulevard',
    },
    {
      kind: 'setBehaviour',
      peds: ARTS_CREW,
      behaviour: 'attack',
      lines: [line(BRICK, "You're the one from Ashburton. Flash said to bring him your hands."), line(MACK, 'He can come and ask for them.')],
    },
    { kind: 'eliminate', targets: ARTS_CREW, objective: 'Put Brick and his crew down ({n} left)' },
    {
      kind: 'goTo',
      to: { entity: 'brick' },
      radius: 2.4,
      mode: 'foot',
      objective: 'Take the release papers off Brick',
    },
    {
      kind: 'loseHeat',
      atLeast: 3,
      holdFor: 20,
      objective: 'Half of Christchurch heard that. Lose the police',
      lines: [line(MACK, "Release papers. Ana's signature is still on them.")],
    },
    {
      kind: 'goTo',
      to: 'chch-garage',
      radius: 8,
      objective: "Take the papers back to Dazza's workshop in Sydenham",
    },
    {
      kind: 'say',
      lines: [
        line(DAZZA, "All there. I'll ring Ana and tell her she can stop looking over her shoulder."),
        line(DAZZA, "Harkness will come himself now. And you'd better meet the silent partner. She's on the bus up from Timaru."),
        line(MACK, 'She.'),
        line(DAZZA, "Don't make me say it, mate."),
      ],
    },
  ],
};
