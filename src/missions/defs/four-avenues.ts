import type { MissionDef, SpotObject } from '../types';
import { DAZZA, line, MACK, TAMA, TRACEY } from './cast';

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

/**
 * 4. Christchurch, at night. Win a lap of the four avenues in Dazza's V8 against the Friday-night regulars
 * and the Easterlies' own driver, then lose the police who break up the meet and get the car home.
 */
export const fourAvenues: MissionDef = {
  id: 'four-avenues',
  title: 'The Four Aves',
  giver: DAZZA,
  blurb: "Dazza fixes cars by day and, on Fridays, who wins. His driver is in hospital and Flash Harkness has money on his own boy tonight. Win the lap of the four avenues in Dazza's V8.",
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
        line(DAZZA, "So you're the one who left three Easterlies on East Street. Neville rang. He was whispering."),
        line(DAZZA, "I'm Dazza. I fix cars, and on a Friday night I fix who wins."),
        line(DAZZA, "Lap of the four aves tonight. My driver's in Christchurch Hospital with both hands broken. Flash Harkness's idea of a transfer fee."),
        line(DAZZA, "Harkness runs the Easterlies and he's got money on his own boy. Win it in my V8 and he's out five grand and a lot of face."),
        line(MACK, 'And if I lose?'),
        line(DAZZA, "Don't."),
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
      lines: [line(MACK, 'Pulls left under brakes, he says. He might have led with that.')],
    },
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
        line(TAMA, "Kia ora. Dazza's new driver? Hope you've brought more hands than the last one, e hoa."),
        line(TRACEY, 'Keep it off the tram tracks, Timaru.'),
      ],
    },
    {
      kind: 'loseHeat',
      vehicle: 'v8',
      atLeast: 3,
      holdFor: 25,
      objective: 'The police have broken up the meet. Lose them',
      returnObjective: "Get back in Dazza's V8",
      lines: [
        line(TAMA, "Ka pai, e hoa! First time Skids has seen anybody's tail-lights."),
        line(TRACEY, 'Blue lights on Deans Ave! Scatter!'),
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
    },
    {
      kind: 'say',
      lines: [
        line(DAZZA, 'Two grand, and Harkness is out five. He keeps a list, and you just went to the top of it.'),
        line(MACK, 'Is that good?'),
        line(DAZZA, "It's not boring. Get some sleep. Tomorrow I'll tell you what he's really after."),
      ],
    },
  ],
};
