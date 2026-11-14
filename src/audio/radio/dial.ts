/**
 * The dial: six invented Canterbury stations, what each one plays, and the order things go to air.
 * Station names were chosen to sound like mid-90s provincial radio without matching any real station.
 */
import { hashInts } from '../../core/rng';
import type { Kit } from './kit';
import { AD_KIT, COUNTRY_KIT, DANCE_KIT, DUB_KIT, INDIE_KIT, ROCK_KIT, TALK_KIT } from './kits';
import type { Plan, Style } from './song';
import { babble, identStyle, jingle, news } from './stings';
import { country, dance, dub, indie, lounge, rock } from './styles';
import { STEPS_PER_BAR, stepDuration } from './timing';

export interface StationInfo {
  id: string;
  name: string;
  blurb: string;
}

interface StationDef extends StationInfo {
  genre: string;
  kit: Kit;
  /** What goes to air, as a repeating cycle of item kinds. */
  cycle: readonly ItemKind[];
  music: Style;
}

export type ItemKind = 'track' | 'break' | 'ident' | 'ad' | 'talk' | 'news';

const MUSIC_CYCLE: readonly ItemKind[] = ['track', 'break'];

export const STATION_DEFS: readonly StationDef[] = [
  { id: 'shingle', name: 'Shingle FM 93.4', blurb: 'Pub rock for the province. Loud guitars, warm jugs.', genre: 'classic / pub rock', kit: ROCK_KIT, cycle: MUSIC_CYCLE, music: rock },
  { id: 'strobe', name: 'Strobe 99.3 FM', blurb: 'Synths and drum machines, all night, every night.', genre: 'synth-pop / dance', kit: DANCE_KIT, cycle: MUSIC_CYCLE, music: dance },
  { id: 'drover', name: 'Radio Drover 1206 AM', blurb: 'Country & western for the plains. Stock sale prices on the hour.', genre: 'country & western', kit: COUNTRY_KIT, cycle: MUSIC_CYCLE, music: country },
  { id: 'lowtide', name: 'Low Tide 88.6 FM', blurb: 'Dub and roots from a garage in New Brighton.', genre: 'dub / roots reggae', kit: DUB_KIT, cycle: MUSIC_CYCLE, music: dub },
  { id: 'flatmate', name: 'Flatmate FM 90.9', blurb: 'Student radio. Four-track tapes and borrowed amps.', genre: 'lo-fi indie', kit: INDIE_KIT, cycle: MUSIC_CYCLE, music: indie },
  { id: 'partyline', name: 'Partyline 1017 AM', blurb: 'Talkback. All our lines are busy: please hold.', genre: 'talkback: hold music and news stings', kit: TALK_KIT, cycle: ['track', 'talk', 'ident', 'track', 'news', 'ad'], music: lounge },
];

export const STATIONS: StationInfo[] = STATION_DEFS.map(({ id, name, blurb }) => ({ id, name, blurb }));

export const stationDef = (id: string): StationDef | undefined => STATION_DEFS.find((s) => s.id === id);

/** The dial position after `current`: through the stations in order, then off (null), then round again. */
export function nextStation(current: string | null, ids: readonly string[] = STATION_DEFS.map((s) => s.id)): string | null {
  if (current === null) return ids.length ? ids[0] : null;
  const i = ids.indexOf(current);
  if (i < 0) return ids.length ? ids[0] : null;
  return i + 1 < ids.length ? ids[i + 1] : null;
}

/** What `radioChanged` should call the dial position. */
export function stationName(id: string | null): string {
  if (id === null) return 'Radio off';
  return stationDef(id)?.name ?? 'Radio off';
}

/** One thing going to air: a track, an ident, an ad, a talk segment. */
export interface Item {
  kind: ItemKind;
  style: Style;
  kit: Kit;
  plan: Plan;
  /** Total length in seconds, including the breath before the next item. */
  duration: number;
  stepDur: number;
  steps: number;
}

const stationSeed = (id: string): number => {
  let h = 0x1995;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 33) + id.charCodeAt(i)) | 0;
  return h;
};

/** Seconds of air between items. */
const GAP = 0.45;

/**
 * The n-th item a station broadcasts. Deterministic: station + index decide everything, so the schedule can
 * be walked forwards from any point without having played what came before.
 */
export function programItem(stationId: string, index: number, session = 0): Item {
  const def = stationDef(stationId) ?? STATION_DEFS[0];
  const seed = hashInts(stationSeed(def.id), index, session);
  let kind = def.cycle[index % def.cycle.length];
  // Between tracks: mostly the station ident, now and then an ad.
  if (kind === 'break') kind = seed % 3 === 0 ? 'ad' : 'ident';
  let style: Style;
  let kit = def.kit;
  switch (kind) {
    case 'ident':
      style = identStyle(def.id);
      break;
    case 'ad':
      style = jingle;
      // Ads go out through the station's own transmitter.
      kit = { ...AD_KIT, tone: def.kit.tone };
      break;
    case 'talk':
      style = babble;
      break;
    case 'news':
      style = news;
      break;
    default:
      style = def.music;
  }
  const plan = style.plan(seed);
  const stepDur = stepDuration(plan.bpm);
  const steps = plan.bars * STEPS_PER_BAR;
  return { kind, style, kit, plan, stepDur, steps, duration: steps * stepDur + GAP };
}
