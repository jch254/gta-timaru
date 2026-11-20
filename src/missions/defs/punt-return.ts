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
        line(DAZZA, "There's a container landing at Lyttelton this week. Forty rebuilt engines out of Osaka. Every bloody cent I've got, and a silent partner's."),
        line(DAZZA, 'Ana at the shipping office holds the release papers. Yesterday two Easterly pricks told her they knew which school her tamariki go to.'),
        line(DAZZA, "She handed them over. I'd have done the same. Now Harkness wants five grand for them tonight at the Avon boat sheds. Calls it taxing, the arsehole."),
        line(DAZZA, "Shield gone nil to thirty-five, Ruapehu blowing its top, and every cop in town hauling pissheads out of pubs. He picked tonight on fucking purpose."),
        line(MACK, "And you'd like me to pay him."),
        line(DAZZA, "I'd like you to take this, and a vest, and go and explain that we're not."),
        line(MACK, 'Sweet as. I was only going to sit home and watch the bloody replay.'),
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
      cues: [
        { at: 12, lines: [line('Radio, faintly', 'Nil to thirty-five at Lancaster Park this afternoon, and the Shield goes north. And Ruapehu has put ash twelve kilometres into the sky.')] },
        { at: 30, lines: [line(MACK, "Whole town's gutted about the footy. Nobody's going to give a shit about one more scrap down by the river.")] },
      ],
    },
    // The retry resumes short of the crew, by the health pack: "have another go" must not stand the player
    // back up inside four drawn pistols (the honest playtest died in nine seconds, three retries straight,
    // when the resume spot was the crew's own ground).
    { kind: 'checkpoint', label: 'the boat sheds', at: { ...SHEDS, snap: 'verge', along: -22 } },
    {
      kind: 'setBehaviour',
      peds: SHED_CREW,
      behaviour: 'attack',
      lines: [
        line(EASTERLY, "Oi. That's not fucking Whitlock. Who's the meat worker?"),
        line(MACK, 'Dazza sends his apologies. And me.'),
        line(EASTERLY, 'Then you can have the hiding for him, ya dickhead.'),
      ],
    },
    // The law sits the shoot-outs themselves out, as at Stroud's yard: an honest playtest had patrol cars
    // join the quad fight at four lights and once arrest the player mid-fight. The police beat is scripted
    // right after Brick (loseHeat raises three lights regardless), so nothing is lost but the pile-on.
    {
      kind: 'eliminate',
      targets: SHED_CREW,
      police: { suspend: true },
      objective: 'Deal to the Easterlies at the boat sheds ({n} left)',
      cues: [
        { at: 12, lines: [line(EASTERLY, "Sort the bastard out, boys! He's just some egg from Timaru!")] },
        { at: 22, lines: [line(MACK, 'Fourteen seasons on the chain at Smithfield. You lot are fuck all on a Monday morning in the boning room.')] },
        { at: 34, lines: [line(EASTERLY, "Fuck this! Nobody said he'd be a bloody nutter!")] },
      ],
    },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [line(MACK, "No papers. Just a note. 'Arts Centre, the quad. Bring the money this time.' Course it was always going to be a bit of a fucking mission.")],
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
      cues: [
        { at: 20, lines: [line(MACK, 'Stone arches and one working streetlight. If I ran a gang, this is where I\'d stand the big bastard too.')] },
        { at: 42, lines: [line(MACK, 'Not a soul on Worcester Boulevard. Even the students are home packing a sad about the footy.')] },
      ],
    },
    { kind: 'checkpoint', label: 'the Arts Centre', at: { ...ARTS, snap: 'verge', along: -24 } },
    {
      kind: 'setBehaviour',
      peds: ARTS_CREW,
      behaviour: 'attack',
      lines: [
        line(EASTERLY, "That's him, Brick! The prick from the boat sheds!"),
        line(BRICK, "You're the one from Ashburton. Flash said to bring him your hands."),
        line(MACK, 'He can come and fucking ask for them.'),
      ],
    },
    {
      kind: 'eliminate',
      targets: ARTS_CREW,
      police: { suspend: true },
      objective: 'Put Brick and his crew down ({n} left)',
      cues: [
        { at: 14, lines: [line(BRICK, "Still standing, ya cheeky prick? Flash only wants the hands, Tully. The rest is for me.")] },
        { at: 24, lines: [line(EASTERLY, "Box the arsehole in by the arches! He's only got the one gun!")] },
        { at: 34, lines: [line(MACK, 'Brick by name. Thick as two short planks by nature, ya great knob.')] },
      ],
    },
    {
      kind: 'goTo',
      to: { entity: 'brick' },
      radius: 2.4,
      mode: 'foot',
      objective: 'Take the release papers off Brick',
      lines: [line(MACK, "Right, ya big lump. Let's have a look in your pockets.")],
    },
    {
      kind: 'loseHeat',
      atLeast: 3,
      holdFor: 20,
      objective: 'Half of Christchurch heard that. Lose the police',
      toast: 'Break their line of sight and lie low, or buy a respray at the panel and paint shop',
      lines: [line(MACK, "Release papers. Ana's signature still on them. Now piss off and let me get home.")],
      cues: [
        { at: 10, lines: [line(MACK, 'Sirens. For fuck\'s sake, I thought the cops were chocka with pub fights tonight.')] },
        { at: 28, lines: [line(MACK, "Keep the head down and stop driving like a hoon, Tully. She'll be right.")] },
      ],
    },
    {
      kind: 'goTo',
      to: 'chch-garage',
      radius: 8,
      objective: "Take the papers back to Dazza's workshop in Sydenham",
      cues: [{ at: 10, lines: [line(MACK, 'Back to Sydenham. Dazza had better have the bloody jug on.')] }],
    },
    {
      kind: 'say',
      lines: [
        line(DAZZA, "All there, good as gold. I'll ring Ana and tell her she can stop looking over her shoulder."),
        line(DAZZA, 'Harkness will come himself now. Five grand\'s carpet money. His takings wash through that new casino, the Avon Palace. First in the fucking country.'),
        line(DAZZA, "And you'd better meet the silent partner. She's on the bus up from Timaru."),
        line(MACK, 'She.'),
        line(DAZZA, "Don't make me say it, mate."),
        line(MACK, 'Oh, bugger. Oh, fuck me.'),
      ],
    },
  ],
};
