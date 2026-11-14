/**
 * Police radio chatter. Every line is spoken by the dispatcher ("Comms"); call signs and the Armed
 * Response Section are invented, place names come from the map. Pure text, unit-tested.
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
    '{unit}, complaint {where}. Probably nothing. Go and be seen.',
    '{unit}, someone {where} reckons a bloke is up to no good. Have a nosey.',
  ],
  level2: [
    "{unit}, he's not keen on a chat. Back-up is on its way, {where}.",
    'Units {where}: offender is doing a runner. Bring him in tidy.',
    "Second car wanted {where}. He's being a bit of an egg about it.",
  ],
  level3: [
    'All units {where}: offender is armed and not in a good mood. Firearms authorised.',
    'Roadblocks going in {where}. Firearms authorised. Nobody be a hero.',
    "All units: it's turned to custard {where}. Draw firearms.",
  ],
  level4: [
    'All units, he is {where}. This has gone well past a joke.',
    'Shotguns out of the boot. He is {where} and he is not to leave the district.',
    'Every spare car: he is {where}. And somebody ring the Superintendent. Not me.',
  ],
  level5: [
    'Armed Response is rolling. Last seen {where}. Right. That is quite enough of that.',
    '{unit} and everything else in Canterbury: he is {where}. Cancel smoko.',
    'Armed Response Section, offender {where}. He has had his chances.',
  ],
  lost: [
    '{unit} has lost him {where}. He cannot have gone far. Famous last words.',
    'No eyes on him. Last seen {where}. Check the side streets.',
    'Anyone see where he went? Last seen {where}. Anyone at all?',
  ],
  spotted: ['{unit} has him again {where}.', 'There he is, {where}. {unit} is on him.', 'Eyes on, {where}. Do not lose him twice.'],
  stepDown: ['Nothing seen {where}. Scale it back a notch.', 'Trail is going cold {where}. Keep half an eye out.', 'No sign of him. A couple of you can head back in.'],
  allClear: [
    'He has gone to ground. Stand down, everyone. Paperwork by Friday.',
    'Lost him. Stand down. He will turn up, they always do.',
    'All units stand down. Not our finest hour, team.',
  ],
  roadblock: ['{unit} has a block in {where}. He would be a mug to try it.', 'Road is shut {where}. See how he likes that.', 'Block is up {where}. Mind your paintwork, {unit}.'],
  officerDown: ['Officer down {where}! All units, all units!', 'We have a constable hurt {where}. Get an ambulance rolling.', 'Constable down {where}. Everybody. Now.'],
  carStolen: [
    '{unit}… please tell me you still have your patrol car. {unit}?',
    'He has pinched a patrol car {where}. The sergeant is going to love this.',
    'Be advised: the offender is now driving one of ours. Yes, really.',
  ],
  gunDrawn: ['He is waving a firearm about {where}. Mind yourselves.', '{unit}, back off a touch. He has pulled a gun {where}.'],
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
