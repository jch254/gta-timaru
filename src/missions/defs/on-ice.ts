import type { MissionDef, SpotObject } from '../types';
import { HINE, line, MACK, RENA, RUSSELL, SHONA } from './cast';

/**
 * The road outside Arowhenua marae, just south of Temuka. A marae is a place of respect: the only thing
 * that happens here is Mack dropping off kai for the hui. The steps that use it are skipped on a map
 * without the marae.
 */
const AROWHENUA_GATE: SpotObject = { landmark: 'marae', near: 'temuka-pub', edge: 1, snap: 'verge' };

/**
 * 2. Timaru → Arowhenua → Temuka → the Rangitata. Drop Rena's kai at the marae gate, then a timed run up
 * SH1 with four chilly bins of off-the-books crayfish in the tray while the police pile on; lose them
 * before the buyer will open his van.
 */
export const onIce: MissionDef = {
  id: 'on-ice',
  title: 'On Ice',
  giver: RENA,
  initial: 'R',
  blurb: "Rena has kai to go out to the hui at Arowhenua. After that, Shona at the Drover's Rest in Temuka needs a driver for a load that can't wait and can't be seen. The buyer is parked up past the Rangitata bridges.",
  reward: 500,
  placeId: 'timaru-chipshop',
  requires: ['severance-pay'],
  failIf: [{ kind: 'vehicleDestroyed', vehicle: 'ute', reason: "Shona's ute is a write-off, and the crays with it" }],
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [line(RENA, "Kia ora, boy. Have you eaten? Don't lie to me, I can hear your stomach from here.")],
    },
    {
      kind: 'say',
      block: true,
      needs: AROWHENUA_GATE,
      lines: [
        line(RENA, "First job's for the whānau. There's a hui at Arowhenua tonight and I've been cooking since five."),
        line(RENA, "Chilly bin's by the door. Take it out to the marae and give it to Hine at the gate. Mind your manners, you're not at the works now."),
      ],
    },
    {
      kind: 'say',
      block: true,
      lines: [
        line(RENA, "Shona at the Drover's Rest in Temuka has paying mahi for you. The kind that doesn't go on a tax return."),
        line(MACK, 'What kind is that?'),
        line(RENA, 'The kind that keeps the lights on. Off you go.'),
      ],
    },
    {
      kind: 'goTo',
      needs: AROWHENUA_GATE,
      to: AROWHENUA_GATE,
      radius: 14,
      stop: true,
      objective: "Take Rena's kai out to the hui at Arowhenua marae, south of Temuka",
    },
    {
      kind: 'say',
      block: true,
      needs: AROWHENUA_GATE,
      objective: null,
      lines: [
        line(HINE, 'Kia ora, Mack! Look at the size of you. Last time you were under a table in the wharekai eating all the fried bread.'),
        line(MACK, "Kia ora, Aunty Hine. Rena sent kai. She said to tell you it's the good chowder."),
        line(HINE, "It's always the good chowder. Tell her ka pai, and tell her to bring it herself next time."),
        line(HINE, "We heard about the works. You need anything, e hoa, you come here. That's not charity. That's whānau."),
        line(MACK, 'Cheers, Aunty. I will.'),
      ],
    },
    { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: { place: 'temuka-pub', snap: 'lane', along: 7, kerb: true }, owned: true },
    { kind: 'spawnVehicle', as: 'chiller', spec: 'van', at: { place: 'rangitata-layby', snap: 'verge', along: 10, out: 2.6 } },
    {
      kind: 'goTo',
      to: 'temuka-pub',
      radius: 14,
      objective: "Go and see Shona at the Drover's Rest on King Street, Temuka",
    },
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(SHONA, "You're Rena's nephew. Good. I need someone who drives like the bank's behind him."),
        line(SHONA, "Four chilly bins of crays in my ute out front. They didn't come over any wharf with a clipboard on it."),
        line(SHONA, 'Russell is parked at the lay-by north of the Rangitata bridges. He leaves when the ice does.'),
        line(MACK, 'And the law?'),
        line(SHONA, "Fisheries has been parked across the road since lunch, and he's brought the Temuka constable. So, briskly."),
      ],
    },
    { kind: 'enterVehicle', vehicle: 'ute', objective: "Get in Shona's ute" },
    {
      kind: 'startTimer',
      time: { base: 45, perKm: 60, to: 'rangitata-layby', label: 'Ice', reason: 'The ice gave out, and Russell with it' },
    },
    {
      kind: 'deliverVehicle',
      vehicle: 'ute',
      to: 'rangitata-layby',
      radius: 12,
      minHealth: 0.3,
      objective: 'Run the crays up SH1 to the lay-by past the Rangitata bridges',
      returnObjective: "Get back in Shona's ute",
      damageReason: 'The ute shook itself to bits, and the crays went over the road',
      police: { minLevel: 2 },
      lines: [line(MACK, "Right. Four bins, two bridges, one constable. Let's go.")],
      cues: [
        { at: 30, wanted: 3, lines: [line(MACK, "That'll be Geraldine's car joining in. All this for crayfish.")] },
        { at: 70, lines: [line(MACK, "Hold together, you lot. You're worth more than I am.")] },
      ],
    },
    { kind: 'stopTimer' },
    {
      kind: 'loseHeat',
      vehicle: 'ute',
      objective: "Russell won't open the van with the law watching. Lose them",
      returnObjective: "Get back in Shona's ute",
      toast: 'Break their line of sight and lie low, or get a respray at a panel and paint shop',
      lines: [line(RUSSELL, "You've brought half the South Canterbury police to a lay-by, mate. Come back when you're on your own.")],
    },
    {
      kind: 'deliverVehicle',
      vehicle: 'ute',
      to: 'rangitata-layby',
      radius: 12,
      clean: true,
      objective: 'Take the crays back to Russell at the lay-by',
      returnObjective: "Get back in Shona's ute",
    },
    {
      kind: 'say',
      lines: [
        line(RUSSELL, 'Still kicking, the lot of them. Five hundred, as agreed with Shona.'),
        line(RUSSELL, 'She says hang on to the ute till the weekend. She wants it back with the same number of doors.'),
        line(RUSSELL, "Word of advice. There's a Christchurch mob taxing every load on this road now. Call themselves the Easterlies. Don't meet them at night."),
        line(RUSSELL, 'Neville Stroud, the stock agent in Ashburton, is short a driver. Tell him I sent you. Then count your change.'),
      ],
    },
  ],
};
