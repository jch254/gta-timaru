import type { MissionDef, SpotObject } from '../types';
import { cameoCue, DAZZA, FLASH, line, MACK, onTheRadio, TAMA, TRACEY } from './cast';

/**
 * The corners of the four avenues, found by road name. If the names on the map differ, each falls back to
 * an offset from the start place (the avenues are a square of about 1.25 km) snapped to the nearest junction.
 */
const SIDE = 1250;
const CORNER_SE: SpotObject = { junction: ['moorhouse', 'fitzgerald'], place: 'four-aves-start', dx: SIDE, snap: 'node' };
const CORNER_NE: SpotObject = { junction: ['fitzgerald', 'bealey'], place: 'four-aves-start', dx: SIDE, dz: -SIDE, snap: 'node' };
const CORNER_NW: SpotObject = { junction: ['bealey', ['harper', 'deans']], place: 'four-aves-start', dz: -SIDE, snap: 'node' };
/** Where Harper Ave (round the top of Hagley Park) meets Deans Ave. No fallback: left out on a map without it. */
const PARK_CORNER: SpotObject = { junction: ['harper', 'deans'] };
const FINISH: SpotObject = { junction: ['moorhouse', 'deans'], place: 'four-aves-start', snap: 'node' };
/** On Moorhouse Ave, a little east of the Deans Ave corner, facing east. */
const GRID: SpotObject = { place: 'four-aves-start', snap: 'lane', road: 'moorhouse', toward: CORNER_SE, along: 40 };

const GARAGE_KERB: SpotObject = { place: 'chch-garage', snap: 'lane', along: 7, kerb: true };

/** The Easterlies' driver (the race rival of that name), when he mouths off. */
const SKIDS = 'Skids';

/**
 * 4. Christchurch, a Friday night in early September 1995. The first Mururoa test (Tuesday the 5th) is on
 * every radio and the town is angry about it; the Easterlies' legitimate face is Flash Harkness's car yard,
 * wound-back used imports ("clocked" was the period word, and a Customs inspector put it at 30 percent of
 * them). Win a lap of the four avenues in Dazza's V8 against the Friday-night regulars and Skids, the
 * Easterlies' own driver (with Flash Harkness watching his money), then lose the police who break up the
 * meet and get the car home.
 */
export const fourAvenues: MissionDef = {
  id: 'four-avenues',
  title: 'The Four Aves',
  giver: DAZZA,
  blurb: "Dazza fixes cars by day and, on Fridays, who wins. His driver is in hospital, Flash Harkness has money on his own boy, and the whole town is too busy being furious about Mururoa to watch the back streets. Win the lap of the four avenues in Dazza's V8.",
  reward: 2000,
  placeId: 'chch-garage',
  requires: ['mint-sauce'],
  trafficDensity: 0.5,
  failIf: [{ kind: 'vehicleDestroyed', vehicle: 'v8', reason: "Dazza's V8 is scrap. He will want a word" }],
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(DAZZA, "So you're the hard case who left three Easterlies on East Street. Neville rang. Silly prick was whispering."),
        line(DAZZA, "I'm Dazza. I fix cars, and on a Friday night I fix who wins."),
        line(DAZZA, "Lap of the four aves tonight. My driver's in Christchurch Hospital, both hands munted. Flash Harkness's idea of a fucking transfer fee."),
        line(DAZZA, "Harkness runs the Easterlies out of a car yard. Clocked imports: speedos wound halfway back to new on the boat over. His boy Skids is on pole."),
        line(DAZZA, "Flash has five grand on Skids tonight, and the bastard'll be there to watch it come in."),
        line(MACK, 'And if I lose?'),
        line(DAZZA, "Don't."),
        line(DAZZA, "Oh, and she pulls left under brakes, the cow. Otherwise she's grunty as. Give her some herbs."),
      ],
    },
    { kind: 'setTime', hour: 22, unlessBetween: [20.5, 4.5], fade: true },
    { kind: 'setWeather', weather: 'clear', transition: 20 },
    { kind: 'spawnVehicle', as: 'v8', spec: 'v8sedan', at: GARAGE_KERB, owned: true, health: 1.5 },
    { kind: 'enterVehicle', vehicle: 'v8', objective: "Get in Dazza's V8 outside the workshop" },
    {
      kind: 'goTo',
      to: GRID,
      radius: 9,
      mode: 'vehicle',
      vehicle: 'v8',
      stop: true,
      objective: 'Line up on Moorhouse Ave, by the Deans Ave corner',
      lines: [line(MACK, 'Pulls left under brakes, he says. Could have fucking led with that.')],
      // The Mayor, on the car radio (a cameo), then the news everybody is angry about, and Mack's view of it.
      cues: [
        ...cameoCue('nicky-roe', 9, (mayor) => [
          line(onTheRadio(mayor), 'And it gives me enormous pleasure to declare the Friday night market open. Seven months I have had the new tram, and I still wave at it. Safe home!'),
          line(MACK, 'Will do, Your Worship.'),
        ]),
        { at: 24, lines: [line('Radio, faintly', "Paris has confirmed a second test will follow Tuesday's blast at Mururoa. Wellington has already called our ambassador home.")] },
        { at: 36, lines: [line(MACK, "Blowing up the bloody Pacific on our doorstep. Whole country's ropeable, and fair enough.")] },
      ],
    },
    { kind: 'checkpoint', label: 'the grid', at: GRID },
    {
      kind: 'race',
      grid: GRID,
      checkpoints: [CORNER_SE, CORNER_NE, CORNER_NW, PARK_CORNER, FINISH],
      radius: 24,
      countdown: 4,
      parSpeed: 23,
      rivals: [
        { as: 'skids', spec: 'v8sedan', name: 'Skids', aggression: 1.85, cruiseSpeed: 37 },
        { as: 'tama', spec: 'coupe', name: 'Tama', aggression: 1.7, cruiseSpeed: 36 },
        { as: 'tracey', spec: 'hatch', name: 'Tracey', aggression: 1.55, cruiseSpeed: 33 },
      ],
      police: { suspend: true, clear: true },
      objective: 'Win the lap: Moorhouse, Fitzgerald, Bealey, and home past the park',
      loseReason: 'Beaten to the line. Dazza has stopped answering to his name',
      lines: [
        line(TAMA, "Kia ora. Dazza's new driver? That's Skids on pole. Easterly money says you eat his exhaust, e hoa."),
        line(SKIDS, "Timaru, eh? Hope that shitheap's got more grunt than your town, ya wanker."),
        line(TAMA, 'Ignore the knob, bro. Skids is all mouth. Win it and the whole 03 hears by smoko.'),
        line(TRACEY, "Whole town's been pissed off since Mururoa on Tuesday. Good night to be bloody loud."),
        line(TRACEY, 'Keep it off the tram tracks, Timaru.'),
      ],
      cues: [
        { at: 32, lines: [line(SKIDS, "Gutless as, that V8! Dazza should've left the fucking thing up on the hoist!")] },
        { at: 45, lines: [line(TRACEY, 'Skids is cutting the park corner! Cheeky prick always cuts the park corner!')] },
        { at: 70, lines: [line(TAMA, 'Hard out, Timaru! Foot to the fucking floor and give it some herbs!')] },
        { at: 95, lines: [line(TRACEY, "If Skids loses this he'll spit the dummy all the way home to New Brighton, the tosser.")] },
      ],
    },
    { kind: 'checkpoint', label: 'the finish line', at: FINISH },
    {
      kind: 'loseHeat',
      vehicle: 'v8',
      atLeast: 3,
      holdFor: 25,
      objective: 'The police have broken up the meet. Lose them',
      returnObjective: "Get back in Dazza's V8",
      // They know this car, and it has to come home: the respray is the intended way out, so say so.
      toast: 'They know the V8 and Dazza wants it back. A panel and paint shop can make it a different car',
      lines: [
        line(TAMA, "Ka pai, e hoa! First time Skids has seen anybody's tail-lights."),
        line(SKIDS, 'That was a fucking fluke, ya egg! A fluke!'),
        line(FLASH, "Enjoy it, Timaru. I'm Flash Harkness. You just cost me five fucking grand, and I collect in person."),
        line(TRACEY, 'Shit, blue lights on Deans Ave! Rattle your dags and scatter!'),
      ],
      cues: [
        { at: 22, lines: [line(MACK, "Fourteen seasons on the chain, and now I'm a bloody boy racer with the cops up my arse. Mum would've had kittens.")] },
        { at: 40, lines: [line(MACK, "Panel and paint shop. New coat of paint, new car, and nobody's the wiser. She'll be right.")] },
      ],
    },
    {
      kind: 'deliverVehicle',
      vehicle: 'v8',
      to: 'chch-garage',
      radius: 10,
      minHealth: 0.2,
      clean: true,
      handover: true,
      objective: "Take the V8 home to Dazza's workshop in Sydenham",
      returnObjective: "Get back in Dazza's V8",
      damageReason: "There's not enough V8 left to take home",
      cues: [{ at: 5, lines: [line(MACK, "Easy does it. Dazza'll do his bloody nut if I bring her home munted.")] }],
    },
    {
      kind: 'say',
      lines: [
        line(DAZZA, "Tama's already rung. Says Skids packed a proper sad on the finish line. Threw his fucking steering lock."),
        line(DAZZA, 'Two grand, and Harkness is out five. He keeps a list, the prick, and you just went straight to the top of it.'),
        line(MACK, 'Is that good?'),
        line(DAZZA, "It's not boring. Go and get your head down. Tomorrow I'll tell you what that wanker's really after."),
      ],
    },
  ],
};
