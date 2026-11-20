import { Rng } from '../core/rng';
import type { GameContext, System, Vehicle } from '../core/types';

/**
 * Mack talking to himself: a dry, sweary line when he nicks a car, lands a jump, writes one off, picks up
 * the cops, loses them, ends up in hospital or the cells. Never more than one every few seconds, never the
 * same thing twice running, and never over the story's dialogue. Lines are at most 60 characters.
 */
export const QUIPS = {
  nicked: [
    'Borrowing it. Indefinitely.',
    'Smells like dog and regret. Ka pai.',
    'Fourteen seasons on the chain. This is my severance.',
    'Keys in the ignition. Basically an invitation.',
    'Nicked. Mum would be so disappointed.',
    'Sorry, mate. You’ll get her back. In bits.',
    'Pine tree air freshener. Classy owner.',
    'Like the works: grab it and don’t look back.',
    'Cassette deck. Somebody’s nan’s tapes. Mint.',
    'Car conversion, the cops call it. I call it Tuesday.',
    'Seat’s set for a garden gnome.',
    'Half a tank and a bag of lollies. Jackpot.',
    'Bugger it. Mine now.',
  ],
  crash: [
    'That was a wall. Good to know.',
    'Panelbeater’s going to buy a boat off me.',
    'Well, she’s buggered.',
    'Smooth, Mack. Real smooth.',
    'Insurance? Never heard of her.',
    'Who put that pole there? Bloody council.',
    'Still got all me teeth. Most of them.',
    'That’s pakaru. Properly pakaru.',
    'Rough as guts, but she’s still rolling. Sort of.',
    'Fourteen seasons without a scratch. Five minutes, this.',
    'Shit. Shit. That’s coming out of no one’s wages.',
    'Fuck me. Me neck.',
  ],
  air: [
    'Woo! Fuck me!',
    'Ha! Like a lamb in spring!',
    'I can see Aoraki from up here!',
    'Flying! Bloody flying!',
    'That’s not how cars work, Mack.',
    'Landing’s gonna hurt. Landing’s gonna hurt!',
    'Air time! The works never gave me air time.',
    'Somebody tell Mum I can fly!',
    'Gravity, you old bastard. Not today.',
    'Up the boohai and over the top!',
  ],
  heat: [
    'Oh, here we go. Blue lights.',
    'Cops. Lovely. Just lovely.',
    'Shit. Shit. Act natural.',
    'They’ve got me plate. Haven’t they.',
    'Easy, boys. I’m a taxpayer. Was a taxpayer.',
    'Should’ve stayed on the dole. Quieter.',
    'Police. And me with no licence. Again.',
    'Right. Foot down and pray.',
    'Nah, nah, nah. Not today, constable.',
    'Hōhā. Can’t a man steal in peace?',
  ],
  heavy: [
    'Half the cops in Canterbury are behind me.',
    'Is that the whole station? Flattered, really.',
    'They’ve called in the dog squad. And the dog’s mum.',
    'Roadblocks? For me? I’m a boner from Timaru!',
    'This has gone a bit past a parking ticket.',
    'Every cop from here to Kaikōura. Brilliant.',
    'Mum’s gonna see this on the news.',
    'That’s a lot of sirens for one laid-off bloke.',
    'Right. I’ve pissed off the whole constabulary.',
    'Okay. Maybe too far. Maybe.',
  ],
  lost: [
    'Lost ’em. Away laughing.',
    'Ha! Couldn’t catch a cold, that lot.',
    'Sweet as. Nobody saw nothing.',
    'Lost ’em in the wop-wops.',
    'Take that, constable. Tell your sergeant.',
    'And breathe. In. Out. Swear a bit.',
    'Quiet again. Like the works after the letter.',
    'Gone like a fart in a southerly.',
    'She’ll be right. She WAS right!',
    'Cops are up the boohai. I’m home free.',
  ],
  boom: [
    'Well, that’s gone up.',
    'Fuck! Me eyebrows!',
    'That’s one way to get a new car.',
    'Kaboom. Nobody’s driving that home.',
    'Smells like the works’ incinerator. Nostalgic.',
    'Pakaru. Totally, gloriously pakaru.',
    'Fireworks night came early.',
    'Ears are ringing. Can’t hear the cops, anyway.',
    'Auē. Was that my fault? Yep.',
    'Hope nobody needed that.',
  ],
  hitPed: [
    'Sorry! Sorry! Look both ways next time!',
    'Should’ve used the crossing, mate.',
    'Bounced off the bonnet. Tough bugger.',
    'That’s gonna sting in the morning.',
    'Oops. Nah, he was asking for it.',
    'Speed bump. Very lifelike speed bump.',
    'Tally of one. Old habits.',
    'Bloody pedestrians. Everywhere, like sheep.',
    'Aroha mai! Actually, no. Get off the road.',
    'He’ll be right. Probably. Maybe.',
    'That’s my no-claims bonus gone.',
    'Ka kite, e hoa. Mind the gutter.',
  ],
  died: [
    'Hospital again. They’ll name a bed after me.',
    'Not dead. Just disappointed.',
    'Nurse reckons I’m a regular. Rude.',
    'Woke up in a hospital gown. Arse out. Again.',
    'Still alive. Mum’s going to kill me anyway.',
    'Lost me wallet, me dignity and a fair bit of blood.',
    'Hospital food. Still beats the works canteen.',
    'Doctor says take it easy. Ha.',
    'Feels like I’ve been through the mincer.',
    'Right. Round two. Hopefully less dying.',
  ],
  busted: [
    'Released. They even gave me laces back.',
    'Cell was warmer than my flat.',
    'Lost me gear, kept me pride. Some of it.',
    'Out on bail. Or whatever that was.',
    'Night in the cells. Ka pai. Free breakfast.',
    'Cops took everything but the lint.',
    'Should’ve run faster. Or not at all.',
    'Back on the street. Still unemployed. Consistent.',
    'Next time I’m pleading pōrangi.',
    'Bloody hōhā, the paperwork in there.',
  ],
  water: [
    'Cold! Cold! Bloody cold!',
    'Can’t swim. Never needed to on the chain.',
    'Brass monkeys in here. Literally.',
    'Should’ve learnt to swim instead of to drive.',
    'Cars don’t float. Noted.',
    'Salty. Wet. Unemployed. Same day as ever.',
    'Southern Ocean says hello. Hello back.',
    'Blub. Blub. Bugger.',
    'Help! Or a boat! Or a tide that likes me!',
    'Fuck, that’s cold! Me nuts have gone to Ashburton!',
  ],
  speed: [
    'Flat stick! Flat bloody stick!',
    'Open road and nobody’s boss.',
    'Plains are flat, pedal’s flat. Perfect.',
    'Fastest I’ve moved since smoko.',
    'Paddocks are a blur. Sheep are white streaks.',
    'Wind in me hair. What’s left of it.',
    'Next stop: anywhere but Timaru.',
    'Away laughing!',
    'This car’s never gone this fast. Neither have I.',
    'Doing a ton on the Plains. Mum’d faint.',
  ],
  skids: [
    'Rubber on the road. Smells like freedom.',
    'Doughnuts! Beats the works any day.',
    'Watch this, you hoons. Taught by the best.',
    'Burnout! Tyres cost money I haven’t got.',
    'Smoke show! Somebody call the brigade.',
    'Round and round like the bloody chain.',
    'Skids! Mum always said I’d peak early.',
    'Ka pai. Lovely black circles.',
    'Boy racer? Nah. Middle-aged racer.',
    'Tyres are pakaru. Worth it.',
  ],
} as const;

export type QuipKind = keyof typeof QUIPS;

export const QUIP_TUNING = {
  /** At most one quip this often (seconds), whatever happened. */
  gap: 9,
  /** The same kind of quip no more often than this. */
  kindGap: 30,
  /** A quip that has waited longer than this for a gap is dropped. */
  stale: 4,
  seconds: 2.8,
  /** Chance of a quip for the events that come often. */
  nickedChance: 0.6,
  crashChance: 0.5,
  hitPedChance: 0.5,
  airChance: 0.75,
  /** The player's car hitting something at least this hard (m/s). */
  crashSpeed: 16,
  hitPedSpeed: 6,
  /** All wheels off the ground this long (s), going at least airSpeed (m/s). */
  airSeconds: 0.7,
  airSpeed: 8,
  /** Held at or above this speed (m/s, about 130 km/h) for speedSeconds. */
  speedFast: 36,
  speedSeconds: 3,
  /** Sliding at least this much (0..1) for skidSeconds. */
  skidSlip: 0.55,
  skidSeconds: 1.2,
  /** An explosion this close (m) to the player. */
  boomRadius: 30,
};

interface Pending {
  kind: QuipKind;
  at: number;
  /** Ignores the gaps (coming round in hospital or out of the cells). */
  forced: boolean;
}

export class QuipsSystem implements System {
  readonly name = 'quips';
  private rng = new Rng(0x3ac4);
  private pending: Pending | null = null;
  private lastAt = -100;
  private lastKind = new Map<QuipKind, number>();
  private lastLine = new Map<QuipKind, string>();
  private airTime = 0;
  private airSaid = false;
  private fastTime = 0;
  private skidTime = 0;
  /** Dead or nicked and not yet back on his feet: the wanted level dropping then is not him getting away. */
  private down = false;

  constructor(private ctx: GameContext) {}

  init() {
    const { ctx } = this;
    const player = ctx.player;
    const driving = (v: Vehicle | null | undefined): v is Vehicle => !!v && v === player.vehicle && v.driver === player;
    ctx.events.on('vehicleEntered', ({ actor, vehicle, stolen }) => {
      if (actor === player && stolen && vehicle.driver === player && this.rng.chance(QUIP_TUNING.nickedChance)) this.queue('nicked', 0.8);
    });
    ctx.events.on('vehicleCrash', ({ vehicle, speed, other }) => {
      const mine = player.vehicle;
      if (!driving(mine) || (vehicle !== mine && other !== mine) || speed < QUIP_TUNING.crashSpeed) return;
      if (this.rng.chance(QUIP_TUNING.crashChance)) this.queue('crash', 0.6);
    });
    ctx.events.on('vehicleHitActor', ({ vehicle, speed, under }) => {
      if (under || !driving(vehicle) || speed < QUIP_TUNING.hitPedSpeed) return;
      if (this.rng.chance(QUIP_TUNING.hitPedChance)) this.queue('hitPed', 0.7);
    });
    ctx.events.on('vehicleDestroyed', ({ vehicle, source }) => {
      const near = vehicle.position.distanceTo(player.position) < QUIP_TUNING.boomRadius;
      if (near && (source === player || vehicle === player.vehicle || vehicle.tags.has('owned'))) this.queue('boom', 0.8);
    });
    ctx.events.on('wantedChanged', ({ level, previous }) => {
      if (!player.alive || this.down) return;
      if (previous === 0 && level > 0) this.queue('heat', 0.5);
      else if (level >= 3 && previous < 3) this.queue('heavy', 0.5);
      else if (level === 0 && previous > 0) this.queue('lost', 1.5);
    });
    ctx.events.on('actorDamaged', ({ actor, info }) => {
      if (actor === player && info.kind === 'drown') this.queue('water', 0);
    });
    // Whatever was about to be said is moot once he's dead or nicked; he has his say after coming round.
    ctx.events.on('playerDied', () => {
      this.pending = null;
      this.down = true;
    });
    ctx.events.on('playerBusted', () => {
      this.pending = null;
      this.down = true;
    });
    ctx.events.on('playerRespawned', ({ reason }) => {
      this.pending = null;
      this.down = false;
      if (reason === 'died' || reason === 'busted') this.queue(reason, 2, true);
    });
  }

  update(dt: number) {
    const { ctx } = this;
    const player = ctx.player;
    const v = player.vehicle;
    if (v && v.driver === player && player.alive) {
      const speed = Math.abs(v.speed);
      if (v.wheelsOnGround === 0 && speed > QUIP_TUNING.airSpeed) {
        this.airTime += dt;
        if (this.airTime > QUIP_TUNING.airSeconds && !this.airSaid) {
          this.airSaid = true;
          if (this.rng.chance(QUIP_TUNING.airChance)) this.queue('air', 0);
        }
      } else if (v.wheelsOnGround > 0) {
        this.airTime = 0;
        this.airSaid = false;
      }
      this.fastTime = speed >= QUIP_TUNING.speedFast ? this.fastTime + dt : 0;
      if (this.fastTime > QUIP_TUNING.speedSeconds) {
        this.fastTime = 0;
        this.queue('speed', 0);
      }
      this.skidTime = v.slip >= QUIP_TUNING.skidSlip && speed > 4 && v.wheelsOnGround > 0 ? this.skidTime + dt : 0;
      if (this.skidTime > QUIP_TUNING.skidSeconds) {
        this.skidTime = 0;
        this.queue('skids', 0);
      }
    } else {
      this.airTime = this.fastTime = this.skidTime = 0;
      this.airSaid = false;
    }
    this.flush();
  }

  /** Say `kind` after `delay` seconds, if nothing more important is already waiting. */
  private queue(kind: QuipKind, delay: number, forced = false) {
    const now = this.ctx.clock.elapsed;
    if (this.pending?.forced && !forced) return;
    if (this.pending?.kind === kind) return;
    if (!forced && now - (this.lastKind.get(kind) ?? -100) < QUIP_TUNING.kindGap) return;
    this.pending = { kind, at: now + delay, forced };
  }

  private flush() {
    const p = this.pending;
    if (!p) return;
    const { ctx } = this;
    const now = ctx.clock.elapsed;
    if (now < p.at) return;
    if (now - p.at > QUIP_TUNING.stale) {
      this.pending = null;
      return;
    }
    if (ctx.missions?.talking || !ctx.player.controlsEnabled) return;
    if (!p.forced && (now - this.lastAt < QUIP_TUNING.gap || !ctx.player.alive)) return;
    this.pending = null;
    this.lastAt = now;
    this.lastKind.set(p.kind, now);
    ctx.ui.subtitle(this.line(p.kind), QUIP_TUNING.seconds, 'Mack');
  }

  /** A line of the kind, never the one he said last time. */
  private line(kind: QuipKind): string {
    const lines: readonly string[] = QUIPS[kind];
    const last = this.lastLine.get(kind);
    let line = this.rng.pick(lines);
    if (line === last) line = lines[(lines.indexOf(line) + 1) % lines.length];
    this.lastLine.set(kind, line);
    return line;
  }
}

export function createQuips(ctx: GameContext): QuipsSystem {
  return new QuipsSystem(ctx);
}
