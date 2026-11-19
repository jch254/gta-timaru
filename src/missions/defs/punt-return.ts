import type { MissionDef, SpotObject } from '../types';
import { BRICK, crew, DAZZA, EASTERLY, handles, line, MACK } from './cast';

const SHEDS: SpotObject = { place: 'antigua-boatsheds' };
const ARTS: SpotObject = { place: 'arts-centre' };
const SHED_CREW = handles('shed', 4);
const ARTS_CREW = ['brick', ...handles('art', 4)];

/**
 * 5. Christchurch, after dark, around the Avon, on Saturday 23 September 1995: the day Canterbury lost the
 * Shield 0-35 to Auckland at Lancaster Park, with Ruapehu erupting on the same day's news. A bad day for
 * the whole town, fights in the pubs, the police stretched thin, which is exactly why the Easterlies chose
 * tonight to squeeze. They frightened the release papers for Dazza's container out of the shipping office
 * and want paying for them ("taxing" is the word) at the Antigua Boat Sheds. Two shoot-outs (the sheds,
 * then Brick in the Arts Centre quad), then get the papers home with half the city's police looking for you.
 */
export const puntReturn: MissionDef = {
  id: 'punt-return',
  title: 'Punt Return',
  giver: DAZZA,
  blurb: "The Easterlies have the release papers for Dazza's container and want five thousand for them tonight, at the Antigua Boat Sheds on the Avon. The town lost the Shield today and the police have their hands full. Dazza would rather you went and explained that he isn't paying.",
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
        line(DAZZA, "She handed them over. I'd have done the same. Now Harkness wants five grand for them, tonight, at the boat sheds on the Avon. He calls it taxing."),
        line(DAZZA, "Shield gone nil to thirty-five, Ruapehu all over the news, and every cop in town hauling drunks out of pub fights. He picked tonight on purpose."),
        line(MACK, "And you'd like me to pay him."),
        line(DAZZA, "I'd like you to take this, and a vest, and go and explain that we're not."),
      ],
    },
    { kind: 'setTime', hour: 21.5, unlessBetween: [20, 4], fade: true },
    { kind: 'giveWeapon', weapon: 'pistol', ammo: 72, select: true, armour: 100, toast: "Dazza's pistol and a padded vest" },

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
      cues: [{ at: 12, lines: [line('Radio, faintly', 'Nil to thirty-five at Lancaster Park this afternoon, and the Shield goes north. And Ruapehu has put ash twelve kilometres into the sky.')] }],
    },
    // The retry resumes short of the crew, by the health pack: "have another go" must not stand the player
    // back up inside four drawn pistols (the honest playtest died in nine seconds, three retries straight,
    // when the resume spot was the crew's own ground).
    { kind: 'checkpoint', label: 'the boat sheds', at: { ...SHEDS, snap: 'verge', along: -22 } },
    {
      kind: 'setBehaviour',
      peds: SHED_CREW,
      behaviour: 'attack',
      lines: [line(EASTERLY, "That's not Whitlock. Who's the meat worker?"), line(MACK, 'Dazza sends his apologies. And me.')],
    },
    // The law sits the shoot-outs themselves out, as at Stroud's yard: an honest playtest had patrol cars
    // join the quad fight at four lights and once arrest the player mid-fight. The police beat is scripted
    // right after Brick (loseHeat raises three lights regardless), so nothing is lost but the pile-on.
    { kind: 'eliminate', targets: SHED_CREW, police: { suspend: true }, objective: 'Deal to the Easterlies at the boat sheds ({n} left)' },
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
      cues: [{ at: 20, lines: [line(MACK, 'Stone arches and one working streetlight. If I ran a gang, this is where I\'d stand the big fella too.')] }],
    },
    { kind: 'checkpoint', label: 'the Arts Centre', at: { ...ARTS, snap: 'verge', along: -24 } },
    {
      kind: 'setBehaviour',
      peds: ARTS_CREW,
      behaviour: 'attack',
      lines: [line(BRICK, "You're the one from Ashburton. Flash said to bring him your hands."), line(MACK, 'He can come and ask for them.')],
    },
    {
      kind: 'eliminate',
      targets: ARTS_CREW,
      police: { suspend: true },
      objective: 'Put Brick and his crew down ({n} left)',
      cues: [{ at: 14, lines: [line(BRICK, "Still standing? Flash only wants the hands, Tully. The rest is for me.")] }],
    },
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
      toast: 'Break their line of sight and lie low, or buy a respray at the panel and paint shop',
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
        line(DAZZA, 'Harkness will come himself now. Five grand is carpet money. His takings wash through that new casino, the Avon Palace. First in the country.'),
        line(DAZZA, "And you'd better meet the silent partner. She's on the bus up from Timaru."),
        line(MACK, 'She.'),
        line(DAZZA, "Don't make me say it, mate."),
      ],
    },
  ],
};
