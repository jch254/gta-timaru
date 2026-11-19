import type { MissionDef, SpotObject } from '../types';
import { EASTERLY, EASTERLY_LOOK, HINE, line, MACK, RENA, RUSSELL, SHONA } from './cast';

/**
 * The road outside Arowhenua marae, just south of Temuka. A marae is a place of respect: the only thing
 * that happens here is Mack dropping off kai for the hui. The steps that use it are skipped on a map
 * without the marae.
 */
const AROWHENUA_GATE: SpotObject = { landmark: 'marae', near: 'temuka-pub', edge: 1, snap: 'verge' };

/**
 * 2. Timaru → Arowhenua → Temuka → the Rangitata, on the morning of Sunday 14 May 1995: the country woke to
 * Black Magic winning the America's Cup 5-0 in San Diego, so the Drover's Rest is full by ten and everyone
 * in it is wearing red socks, which is why a stranger gets the driving job. Drop Rena's kai at the marae
 * gate (customary take for the hui, authorised and entirely lawful), then a run against the clock up SH1
 * with four chilly bins of off-the-books crayfish, sold for cash past the licensed fish receiver; the law
 * is waiting at the lay-by and has to be lost before the buyer will open his van. And there, Mack learns
 * the Easterlies have been watching the whole hand-over.
 */
export const onIce: MissionDef = {
  id: 'on-ice',
  title: 'On Ice',
  giver: RENA,
  initial: 'R',
  blurb: "The morning after the Cup: five nil, and the Drover's Rest is full by ten. Rena has kai to go out to the hui at Arowhenua first. Then Shona in Temuka needs a driver for a load that can't wait and can't be seen. The buyer is parked up past the Rangitata bridges.",
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
        line(RENA, "First job's for the whānau. There's a hui at Arowhenua tonight and I've been cooking since five. Cup or no Cup, people have to eat."),
        line(RENA, "Chilly bin's by the door. Take it out to the marae and give it to Hine at the gate. Mind your manners, you're not at the works now."),
      ],
    },
    {
      kind: 'say',
      block: true,
      lines: [
        line(RENA, "After that, Shona at the Drover's Rest in Temuka has paying mahi for you. The kind that doesn't go on a tax return."),
        line(MACK, "A pub with work going? It's ten o'clock on a Sunday morning."),
        line(RENA, "We won the Cup at breakfast, dear. Five races to nil. There isn't an empty pub between here and the Bluff. Off you go."),
      ],
    },
    {
      kind: 'goTo',
      needs: AROWHENUA_GATE,
      to: AROWHENUA_GATE,
      radius: 14,
      stop: true,
      objective: "Take Rena's kai out to the hui at Arowhenua marae, south of Temuka",
      cues: [{ at: 40, lines: [line(MACK, 'Red socks on every second clothesline from Washdyke up. The whole country was awake at six for a yacht race, me included.')] }],
    },
    {
      kind: 'say',
      block: true,
      needs: AROWHENUA_GATE,
      objective: null,
      lines: [
        line(HINE, 'Mack! Look at the size of you. Last time I saw you, you were under a table in the wharekai eating all the fried bread.'),
        line(HINE, "And you're the first thing out of Te Maru this morning that isn't wearing red socks. Did you not stay up for it?"),
        line(MACK, 'Kia ora, Aunty Hine. I heard it on the wireless. Rena sent kai for the hui. The good chowder, she said to say.'),
        line(HINE, "Ka pai. All signed off with the rūnanga, this, so stop looking at the road. And we heard about the works, e hoa. You need anything, you come here."),
        line(MACK, 'Cheers, Aunty. I will.'),
        line(HINE, "That's whānau, not charity. Now away with you, Shona will be three deep at the bar by now."),
      ],
    },
    { kind: 'checkpoint', label: 'Temuka', at: 'temuka-pub' },
    // A tray full of ice chests that can take a knock: it has to survive two bridges and a chase and still
    // count as "sound". Generously tough on purpose: this is an early job and the fail is for genuinely
    // wrecking it, not for a few dents picked up outrunning a tail.
    { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: { place: 'temuka-pub', snap: 'lane', along: 7, kerb: true }, owned: true, health: 2 },
    { kind: 'spawnVehicle', as: 'chiller', spec: 'van', at: { place: 'rangitata-layby', snap: 'verge', along: 10, out: 2.6 } },
    // Shona wasn't exaggerating: across the road sits a black and white, an old traffic patrol car, with a
    // fisheries officer in it. Scenery with no controller; the trafficcar spec reads exactly right for 1995.
    { kind: 'spawnVehicle', as: 'fisheries', spec: 'trafficcar', at: { place: 'temuka-pub', snap: 'lane', along: -18, kerb: true } },
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
        line(SHONA, "You're Rena's nephew. Good. Look at this bar. Five nil, every sock in Temuka is red, and I haven't had a hand free since seven."),
        line(SHONA, "Four chilly bins of crays in my ute out front. They never met a licensed fish receiver, and they're not about to."),
        line(SHONA, 'Russell is parked at the lay-by north of the Rangitata bridges. He leaves when the ice does.'),
        line(MACK, 'And the law?'),
        line(SHONA, "See the black and white over the road? Fisheries, with the Temuka constable keeping him company since opening. So, briskly."),
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
      minHealth: 0.2,
      objective: 'Run the crays up SH1 to the lay-by past the Rangitata bridges',
      returnObjective: "Get back in Shona's ute",
      damageReason: 'The ute shook itself to bits, and the crays went over the road',
      // The run is against the clock, not a gunfight. An honest playtest showed that holding a police chase
      // on this fragile-cargo timed leg was unwinnable: contact with a pursuer escalates past any floor, and
      // a third light's gunfire shreds the ute under the "keep it sound" rule. The law converges at the
      // lay-by instead (the loseHeat step below), where there is no cargo-health gate to fight.
      lines: [line(MACK, "Right. Four bins, two bridges, and the ice already sweating. Let's go.")],
      cues: [
        { at: 3, lines: [line(MACK, "Black and white hasn't moved. He'll radio ahead, but he won't catch this.")] },
        { at: 18, lines: [line('Radio, faintly', 'Five races to nil in San Diego! The oldest cup in sport is coming home, and the whole country is wearing red socks to church!')] },
        { at: 35, lines: [line(MACK, "Rangitata bridges coming up. Bet there's a welcome on the far side.")] },
        { at: 75, lines: [line(MACK, "Hold together, you lot. You're worth more than I am.")] },
      ],
    },
    { kind: 'stopTimer' },
    { kind: 'checkpoint', label: 'the Rangitata lay-by', at: 'rangitata-layby' },
    // One light, not two: this is where being wanted is taught, on open plains with no corner to hide
    // behind. A single patrol car (cruising at 28 m/s) is one the ute can simply outrun; at two lights the
    // pursuit matches the ute's top speed down a road with 260 m of clear view, and an honest playtest was
    // arrested there every time.
    {
      kind: 'loseHeat',
      vehicle: 'ute',
      atLeast: 1,
      holdFor: 12,
      objective: "Russell won't open the van with the law watching. Lose them",
      returnObjective: "Get back in Shona's ute",
      toast: 'Break their line of sight and lie low, or get a respray at a panel and paint shop',
      lines: [line(RUSSELL, "You've brought half the South Canterbury police to a lay-by, mate. Come back when you're on your own.")],
    },
    // Two men by a black V8, pricing the load from across the lay-by. They were here before Mack was.
    {
      kind: 'spawnPeds',
      peds: [
        { as: 'watcher1', at: { place: 'rangitata-layby', snap: 'verge', side: 1, along: -26 }, name: EASTERLY, kind: 'scripted', behaviour: 'stand', look: EASTERLY_LOOK },
        { as: 'watcher2', at: { place: 'rangitata-layby', snap: 'verge', side: -1, along: -22 }, name: EASTERLY, kind: 'scripted', behaviour: 'stand', look: EASTERLY_LOOK },
      ],
      activate: 400,
    },
    { kind: 'spawnVehicle', as: 'watchers-car', spec: 'v8sedan', color: 0x15161a, at: { entity: 'watcher1', snap: 'lane', along: 6, kerb: true }, activate: 400 },
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
        line(EASTERLY, "That's him. Shona's new driver. Flash will want the name."),
        line(RUSSELL, 'Eyes front. Still kicking, the lot of them. Five hundred, as agreed with Shona.'),
        line(MACK, 'The two by the black V8. Friends of yours?'),
        line(RUSSELL, "Nobody's friends. Easterlies, out of Christchurch. They tax every load on this road now, and they've just priced yours. Don't meet them at night."),
        line(RUSSELL, 'Half the 03 pays them already. Every wharf, every lay-by, Kaikōura on down. Not my fight.'),
        line(RUSSELL, 'Shona says hang on to the ute for the week. She wants it back with the same number of doors.'),
        line(RUSSELL, 'Neville Stroud, the stock agent in Ashburton, is short a driver. Tell him I sent you. Then count your change.'),
      ],
    },
  ],
};
