/**
 * The cast, and a few helpers for writing missions. Everyone in the story is invented.
 *
 * The one exception in spirit is the cameos (./cameos.ts): familiar faces who turn up about town and, here
 * and there, in a mission. They are affectionate look-alike parodies of the kind of public figure everybody
 * knew in 1995, always under invented names; no real person's name is used anywhere. They are never part of
 * the crime: a cameo only ever passes the time of day, or is heard on the radio. Their lines reach a mission
 * through `withCameo`, `cameoCue` and `cameoRemark` below, so taking a cameo out of ./cameos.ts takes their
 * lines out of the story as well.
 *
 *  Mack Tully      the player. Fourteen years on the chain at Smithfield, laid off by letter.
 *  Aunty Rena      Mack's aunt. Ngāi Tahu, whānau at Arowhenua. Runs the chip shop on the Bay Hill, knows everyone.
 *  Hine            Rena's cousin; runs the kitchen for the hui at Arowhenua.
 *  Jock Ferrier    retired fisherman with a lock-up at Timaru port and no curiosity about paperwork.
 *  Shona Maddigan  publican of the Drover's Rest, Temuka.
 *  Russell         buys seafood out of a chiller van and asks nothing.
 *  Neville Stroud  stock agent, Stroud & Daughters, East Street, Ashburton. Bent, and behind on his payments.
 *  Dazza Whitlock  mechanic in Sydenham; fixes cars, and who wins on a Friday night.
 *  Tama, Tracey    regulars at the four-avenues meet. Skids drives for the Easterlies.
 *  Ana             runs the shipping office at Lyttelton that holds Dazza's release papers.
 *  Tip Waaka       crane driver on the Lyttelton wharves; an old friend of Rena's.
 *  The Easterlies  a New Brighton crew taking a cut of everything that moves on SH1. Named for the cold wind
 *                  that comes in off the sea every afternoon. Run by Flash Harkness, a car dealer; Brick is his
 *                  right hand.
 */
import type { GameContext, HumanoidLook } from '../../core/types';
import type { Cue, CustomStep, Line, PedDef, SpotObject } from '../types';
import { findCameo } from './cameos';

export const MACK = 'Mack';
export const RENA = 'Aunty Rena';
export const HINE = 'Hine';
export const JOCK = 'Jock';
export const SHONA = 'Shona';
export const RUSSELL = 'Russell';
export const NEVILLE = 'Neville';
export const DAZZA = 'Dazza';
export const TAMA = 'Tama';
export const TRACEY = 'Tracey';
export const TIP = 'Tip';
export const FLASH = 'Flash Harkness';
export const BRICK = 'Brick';
export const EASTERLY = 'Easterly';

/** One subtitled line. */
export const line = (who: string, text: string, seconds?: number): Line => (seconds === undefined ? { who, text } : { who, text, seconds });

/** Windbreakers and beanies off the New Brighton sea front. */
export const EASTERLY_LOOK: Partial<HumanoidLook> = { topStyle: 'jacket', top: 0x2c4a63, legs: 0x23272e, shoes: 0x15171a, hat: 'beanie', hatColor: 0x1b1d22 };

export interface CrewMember {
  weapon?: string;
  health?: number;
  name?: string;
  look?: Partial<HumanoidLook>;
}

/**
 * A group strung along the roadside near a spot: alternating sides of the road, `gap` metres apart, starting
 * `start` metres along it. Roadsides are always open ground, wherever the map owner put the buildings.
 */
export function crew(prefix: string, base: SpotObject, members: readonly CrewMember[], start: number, gap: number, behaviour: 'attack' | 'stand' = 'attack'): PedDef[] {
  return members.map((m, i) => ({
    as: `${prefix}${i + 1}`,
    at: { ...base, snap: 'verge' as const, side: (i % 2 === 0 ? 1 : -1) as 1 | -1, along: start + gap * i },
    name: m.name ?? EASTERLY,
    kind: 'gang' as const,
    behaviour,
    weapon: m.weapon,
    health: m.health,
    look: { ...EASTERLY_LOOK, ...m.look },
  }));
}

/** The handles `crew(prefix, …)` produced for `count` members. */
export function handles(prefix: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`${prefix}${i}`);
  return out;
}

// ───────────────────────────── Cameos in the story ─────────────────────────────

/** How a cameo heard over the air is named in the subtitles. */
export const onTheRadio = (name: string) => `${name}, on the radio`;

/**
 * Lines that feature a cameo (./cameos.ts), written given their name. An empty list if that cameo has been
 * taken out of the cast, so removing one never breaks a mission.
 */
export function withCameo(id: string, make: (name: string) => Line[]): Line[] {
  const cameo = findCameo(id);
  return cameo ? make(cameo.name) : [];
}

/** A cue carrying a cameo's lines `at` seconds into a step: spread it into `cues`. Nothing if they have left the cast. */
export function cameoCue(id: string, at: number, make: (name: string) => Line[]): Cue[] {
  const lines = withCameo(id, make);
  return lines.length ? [{ at, lines }] : [];
}

/** Is the cameo of this name standing within `distance` metres of the player right now? */
function cameoNearby(ctx: GameContext, name: string, distance: number): boolean {
  const p = ctx.player.position;
  for (const actor of ctx.actors.all) {
    if (actor.name === name && actor.invulnerable && actor.alive && Math.hypot(actor.position.x - p.x, actor.position.z - p.z) <= distance) return true;
  }
  return false;
}

/**
 * A passing remark from a cameo the player is standing near: a one-shot step that queues the lines only if
 * that cameo really is there (right hours, not scared off). It never waits, so it cannot hold a mission up.
 * `remark` is the lines, for tests to read.
 */
export function cameoRemark(id: string, make: (name: string) => Line[], within = 40): CustomStep & { remark: readonly Line[] } {
  const name = findCameo(id)?.name;
  const remark = withCameo(id, make);
  return {
    kind: 'custom',
    id: `cameo:${id}`,
    remark,
    enter(run) {
      if (name !== undefined && remark.length && cameoNearby(run.ctx, name, within)) run.say(remark);
    },
  };
}
