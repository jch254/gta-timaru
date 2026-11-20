/**
 * Police radio chatter, all shown under the "Comms" label: mostly the dispatcher, with some lines from the
 * units themselves (written "{unit}: …"). Call signs and the Armed Response Section are invented, place
 * names come from the map. Pure text, unit-tested. Everyone swears on air now and then; it's been a long shift.
 *
 * The register is plain-language NZ RT, 1995: "copy", "roger" sparingly, offences by their local names
 * (a burg, a vehicle conversion, a driver fled on foot). Never American ten-codes: in the NZ system
 * 10-4 means "repeat your last", so writing it for "OK" would be wrong twice over.
 */

export type RadioEvent =
  | 'level1'
  | 'level2'
  | 'level3'
  | 'level4'
  | 'level5'
  | 'lost'
  | 'spotted'
  | 'stepDown'
  | 'allClear'
  | 'roadblock'
  | 'officerDown'
  | 'carStolen'
  | 'gunDrawn';

/** Patrol car call signs (invented; Canterbury back-country flavour). */
export const CALL_SIGNS: readonly string[] = ['Tussock One', 'Braid One', 'Shingle One', 'Kea One', 'Tussock Two', 'Braid Two', 'Shingle Two', 'Kea Two'];
/** The Armed Response Section's van. */
export const VAN_CALL_SIGN = 'Hawk One';

/** `{unit}` is a call sign; `{where}` already carries its preposition ("on Colombo St", "around Sydenham"). */
const LINES: Record<RadioEvent, readonly string[]> = {
  level1: [
    '{unit}, bit of a carry-on reported {where}. Pop round and have a look.',
    'Comms to {unit}: possible burg {where}. Probably kids. Go and be seen.',
    '{unit}, someone {where} reckons a bloke is up to no good. Have a nosey.',
    'Kia ora, {unit}. Neighbour {where} has rung in about a hoon. Wander past when you can.',
    '{unit}, caller {where} says some dickhead is making a nuisance of himself. Have a word.',
    'Comms to {unit}: the dairy {where} reckons someone is acting a bit dodgy. Swing by.',
    '{unit}, caller {where} reckons she heard a window go. Might be nothing. Have a look.',
    "{unit}, the publican {where} says a bloke's pissed as a fart and won't leave. Have a word.",
  ],
  level2: [
    "{unit}, he's not keen on a chat. Back-up is on its way, {where}.",
    'Units {where}: offender is doing a runner. Bring him in tidy.',
    "Second car wanted {where}. He's being a bit of an egg about it.",
    "{unit}: he's legged it {where}. Bloody hell. Need a second car.",
    "{unit} here, he's fucking off {where}. Any car free, give us a hand.",
    "{unit} reports he's away laughing {where}. Not for long, I'd hope.",
    'Bloody hoon, this one. Keep him in sight {where} and keep it tidy.',
    "{unit}: the little prick's taking us on a tiki tour {where}. Second car, please.",
  ],
  level3: [
    'All units {where}: offender is armed and not in a good mood. Firearms authorised.',
    'Roadblocks going in {where}. Firearms authorised. Nobody be a hero.',
    "All units: it's turned to custard {where}. Draw firearms.",
    "All units, this one's gone pear-shaped {where}. Firearms authorised. Mind the public.",
    "He's not stopping for anyone {where}. Firearms authorised. Cordon and contain, team.",
    "{unit}: he's armed {where} and he's bloody cross about it. Don't anyone get clever.",
    "Right, that's enough buggering about {where}. Firearms authorised. Heads down.",
    '{unit}: this has gone to shit {where}. Firearms out, everyone.',
  ],
  level4: [
    'All units, he is {where}. This has gone well past a joke.',
    'Shotguns out of the boot. He is {where} and he is not to leave the district.',
    'Every spare car: he is {where}. And somebody ring the Superintendent. Not me.',
    'All units {where}: box him in or put him off the road. Shotguns authorised.',
    "He's {where} and he's munted half the bloody town getting there. Shotguns out.",
    "Every bloody car in the district, rattle your dags. He's {where}.",
    "{unit}: we've lost another car {where}. Bastard rammed us. Shotguns out.",
    "{unit}: for fuck's sake, he's {where} again. Somebody put him in a hedge.",
  ],
  level5: [
    'Armed Response is rolling. Last seen {where}. Right. That is quite enough of that.',
    '{unit} and everything else in Canterbury: he is {where}. Cancel smoko.',
    'Armed Response Section, offender {where}. He has had his chances.',
    "All units {where}: Armed Response is coming. Keep him boxed in and keep out of their way.",
    'Every car from here to the wop-wops wants him. He is {where}. Armed Response rolling.',
    'Armed Response on its way {where}. Bugger knocking off on time today, team.',
    "{unit}: Christ almighty, he's still going {where}. Where's bloody Armed Response?",
    "He's {where} and he's a fucking menace. Armed Response, he's all yours.",
  ],
  lost: [
    '{unit} has lost him {where}. He cannot have gone far. Famous last words.',
    'Driver has fled on foot {where}. Check the side streets and the back sections.',
    'Anyone see where the bugger went? Last seen {where}. Anyone at all?',
    "{unit}: lost the little prick {where}. He's gone to ground somewhere.",
    "He's done a runner {where}. Check the carports and the garden sheds.",
    '{unit}: bugger. Lost sight of him {where}. Eyes peeled, everyone.',
    "Lost him {where}. Somebody check the hedges. He's in one of them, I'd put money on it.",
    "{unit}: for fuck's sake. He was right there, {where}. Gone.",
  ],
  spotted: [
    '{unit} has him again {where}. Good stuff. Stay with him.',
    'There he is, {where}. {unit} is on him.',
    "Sighted again {where}. Let's not bloody lose him twice, eh.",
    '{unit} has picked him up again {where}. Sweet as. Stay on him.',
    "{unit}: got the bastard again {where}. Not letting him go this time.",
    'Panic over, {unit} has him {where}. All cars close up.',
    "He's popped up again {where}, bold as brass. {unit} is with him.",
    "{unit}: there's the dickhead, {where}. Back on him.",
  ],
  stepDown: [
    'Roger, nothing seen {where}. Scale it back a notch.',
    'Trail is going cold {where}. Keep half an eye out.',
    'No sign of him. A couple of you can head back in.',
    'Nothing doing {where}. Ease off a bit, but keep your eyes peeled.',
    "{unit}: no bloody joy {where}. Knocking it back a gear.",
    'All quiet {where}. Some of you can peel off. Not you, {unit}.',
    "{unit}: bugger all happening {where}. He's lying low, the little shit.",
    'Sod all doing {where}. Wind it back, team. Cheers.',
  ],
  allClear: [
    'He has gone to ground. Stand down, everyone. Paperwork by Friday.',
    "Lost him. Stand down. The bugger'll turn up, they always do.",
    'All units stand down. Not our finest hour, team.',
    "Stand down, all units. He's away laughing. Kettle's on back at the station.",
    "That's it, call it off. Ta for your efforts, such as they were.",
    "{unit}: well, that was a bloody shambles. Heading back in.",
    'Stand down, all units. Hope nobody stuffed a car. The sergeant is counting.',
    '{unit}: lost the bastard. Useless, the lot of us. Heading in.',
  ],
  roadblock: [
    '{unit} has a block in, {where}. He would be a mug to try it.',
    'Road is shut {where}. See how the bugger likes that.',
    'Block is up {where}. Mind your paintwork, {unit}.',
    "{unit} reports a block in place {where}. Cars across the road. She's all go.",
    "Roadblock {where}, courtesy of {unit}. Let's see him get round that.",
    "{unit}: block's up {where}. Come on then, dickhead.",
    '{unit} has the road shut {where}. Tidy work. Now we wait.',
    "{unit}: we're across the road {where}. If he rams it, he's a bigger prick than I thought.",
  ],
  officerDown: [
    'Officer down {where}! All units, all units!',
    'We have a constable hurt {where}. Get an ambulance rolling.',
    'Constable down {where}. Everybody. Now.',
    'Constable hurt {where}! Ambulance on its way. All units close in.',
    '{unit}: shit. One of ours is down {where}. Get here. Now.',
    'Urgent, all units: officer down {where}. St John is rolling.',
    "All units, all units: constable down {where}. Drop whatever you're doing.",
  ],
  carStolen: [
    '{unit}… please tell me you still have your patrol car. {unit}?',
    'He has pinched a bloody patrol car {where}. The sergeant is going to love this.',
    'All units: vehicle conversion {where}, and the vehicle converted is one of ours.',
    '{unit} has lost the car {where}. Not him. The car. Our bloody car.',
    "He's nicked {unit}'s car {where}. Somebody go and pick up the crew.",
    'All units: one of ours has been nicked {where}. Check the rego before you wave at anyone.',
    "{unit}, you left the keys in it, didn't you. He has it {where}.",
    "{unit}: the cheeky bastard's taken our car {where}! My lunch is in that.",
  ],
  gunDrawn: [
    "He's waving a bloody firearm about {where}. Mind yourselves.",
    '{unit}, back off a touch. He has pulled a gun {where}.',
    'Man with a gun {where}. Keep your distance and keep the public back.',
    '{unit}, he has a firearm out {where}. Use the car for cover.',
    "{unit}: shit, he's pointing a gun at us {where}. Backing off.",
    'Firearm seen {where}. Clear the footpaths and stay behind your cars, team.',
    "He's showing a gun {where}. Treat him as armed. Cordon and contain.",
    "{unit}: the stupid bastard's got a gun out {where}. Get your heads down.",
  ],
};

/** Radio event for a rise to `level` (1..5). */
export function levelEvent(level: number): RadioEvent {
  return (['level1', 'level1', 'level2', 'level3', 'level4', 'level5'] as const)[Math.min(5, Math.max(0, Math.round(level)))];
}

/**
 * "on Colombo St" when `location` is a street, "around Sydenham" when it is only the suburb.
 * `location` is `world.locationName()`, `district` the suburb name at the same point.
 */
export function whereText(location: string, district: string): string {
  return location === district ? `around ${location}` : `on ${location}`;
}

/** One line of chatter. `pick(n)` returns an index 0..n−1 (from the module's seeded Rng). */
export function radioLine(event: RadioEvent, unit: string, where: string, pick: (count: number) => number): string {
  const options = LINES[event];
  const i = Math.min(options.length - 1, Math.max(0, Math.floor(pick(options.length))));
  return options[i].replaceAll('{unit}', unit).replaceAll('{where}', where);
}

/** Every template for an event (for tests). */
export function radioLines(event: RadioEvent): readonly string[] {
  return LINES[event];
}
