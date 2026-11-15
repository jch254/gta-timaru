/**
 * Missions module: the story (six jobs from Timaru to Lyttelton), the places where jobs are picked up, and
 * the free-roam services that hang off places (gun shops, safehouses, world pickups).
 *
 *  runner.ts    mission book-keeping and the step interpreter       steps.ts   what each step kind does
 *  types.ts     the mission data format                             spots.ts   place-relative positions
 *  defs/        the six missions and the cast                       services.ts shops, safehouses, pickups
 *  markers.ts   in-world rings and beams                            tuning.ts  every number worth changing
 *  cameos.ts    familiar faces about town (cast: defs/cameos.ts)
 */
import type { GameContext, MissionsApi, MissionSummary, Place, System } from '../core/types';
import { Cameos } from './cameos';
import { MACK } from './defs/cast';
import { CAMEOS } from './defs/cameos';
import { MISSIONS } from './defs';
import { Dialogue } from './dialogue';
import { MarkerPool, type Marker } from './markers';
import { MissionRunner } from './runner';
import { Services } from './services';
import { findPlace, maraeAt } from './spots';
import { TUNING } from './tuning';
import type { Line, MissionDef } from './types';

/** A place the player can walk up to and use: a job on offer, a bed, a gun counter, or several at once. */
interface Point {
  place: Place;
  missions: MissionDef[];
  safehouse: boolean;
  gunshop: boolean;
}

/** Builds "F  Do the thing" only when the key label or the action changes, not every frame. */
class PromptMemo {
  private key = '';
  private action = '';
  private text = '';
  get(key: string, action: string): string {
    if (key !== this.key || action !== this.action) {
      this.key = key;
      this.action = action;
      this.text = `${key}  ${action}`;
    }
    return this.text;
  }
}

interface Beacon {
  id: string;
  marker: Marker;
}

const INTRO: readonly Line[] = [
  { who: MACK, text: 'Fourteen years on the chain at Smithfield, and they finish you with a letter and a frozen leg of lamb.' },
  { who: MACK, text: "Forty of us out the gate in one morning. The nor'wester's up and the whole town smells of hot tar and bad news." },
  { who: MACK, text: 'Aunty Rena said to come by the shop. She had that look. It usually costs somebody something.' },
];
const INTRO_OBJECTIVE = 'See Aunty Rena at her chip shop on the Bay Hill';

const TAKE_JOB = 'Take the job';
const KIP = 'Have a kip and save';
const NOT_NOW = 'Not now';

class Missions implements MissionsApi, System {
  readonly name = 'missions';

  private dialogue: Dialogue;
  private markers: MarkerPool;
  private runner: MissionRunner;
  private services: Services;
  private cameos: Cameos;
  private points: Point[] = [];
  private beacons: Beacon[] = [];
  private ready = false;
  /** A dialog or a kip is in progress. */
  private busy = false;
  private cooldown = 0;
  private introTimer = -1;
  private introSeen = false;
  private introObjective = false;
  private finaleTimer = -1;
  private prompts = new PromptMemo();
  /** "Talk to …" / "Browse …" lines, built once. */
  private talk = new Map<MissionDef, string>();
  private browse = new Map<Point, string>();
  private offs: (() => void)[] = [];

  constructor(private ctx: GameContext) {
    this.dialogue = new Dialogue(ctx);
    this.markers = new MarkerPool(ctx.scene);
    this.runner = new MissionRunner(ctx, MISSIONS, { markers: this.markers, dialogue: this.dialogue });
    this.services = new Services(ctx);
    this.cameos = new Cameos(ctx, CAMEOS, { talking: () => this.dialogue.busy });
    this.runner.onChange = () => this.sync();
    this.runner.onResult = (def, result) => {
      if (result === 'passed' && def.finale) this.finaleTimer = TUNING.finaleDelay;
    };
    ctx.save.register(
      'missions',
      () => this.serialize(),
      (data) => this.deserialize(data),
    );
    this.offs.push(
      ctx.events.on('playerRespawned', ({ reason }) => {
        if (reason === 'new') this.introTimer = TUNING.introDelay;
      }),
    );
  }

  init() {
    this.runner.validate();
    this.services.init();
    this.cameos.init();
    this.buildPoints();
    this.ready = true;
    this.sync();
  }

  // ───────────── MissionsApi ─────────────

  list(): MissionSummary[] {
    return this.runner.list();
  }

  get active(): MissionSummary | null {
    return this.runner.active;
  }

  start(id: string): boolean {
    return this.runner.start(id);
  }

  abort(reason?: string) {
    this.runner.abort(reason);
  }

  serialize(): unknown {
    return { ...(this.runner.serialize() as object), intro: this.introSeen, pickups: this.services.serialize() };
  }

  deserialize(data: unknown) {
    const d = (data && typeof data === 'object' ? data : {}) as { intro?: unknown; pickups?: unknown };
    this.introSeen = d.intro === true;
    this.introTimer = -1;
    this.finaleTimer = -1;
    if (this.introObjective) {
      this.introObjective = false;
      this.ctx.ui.objective(null);
    }
    this.services.deserialize(d.pickups);
    this.runner.deserialize(data);
  }

  /** True once the whole story has been played through. */
  get completed(): boolean {
    return this.runner.completed;
  }

  // ───────────── Frame ─────────────

  update(dt: number) {
    this.dialogue.update(dt);
    this.runner.update(dt);
    this.services.update(dt);
    this.cameos.update(dt);
    this.updateStory(dt);
    this.updateInteraction(dt);
    this.updateBeacons();
    this.markers.update(dt);
  }

  private updateStory(dt: number) {
    const { ctx } = this;
    // New game: a couple of lines to set the scene and a pointer to the chip shop.
    if (this.introTimer >= 0) {
      this.introTimer -= dt;
      if (this.introTimer < 0 && !this.introSeen) {
        this.introSeen = true;
        if (!this.runner.run && this.runner.done.size === 0) {
          this.dialogue.say(INTRO);
          const first = this.runner.defs[0];
          if (first && this.runner.stateOf(first) === 'available') {
            this.introObjective = true;
            ctx.ui.objective(INTRO_OBJECTIVE);
          }
        }
      }
    }
    // After the last job: one more banner, then the province is theirs.
    if (this.finaleTimer >= 0) {
      this.finaleTimer -= dt;
      if (this.finaleTimer < 0) {
        ctx.ui.banner("You've done it", "Rena's money is safe and the southerly has blown through. Canterbury is yours.", 9, 'good');
        ctx.ui.toast('Story complete. Every road is still open.', 8);
      }
    }
  }

  // ───────────── Mission starts, safehouses and shops ─────────────

  private buildPoints() {
    const { world } = this.ctx;
    const byPlace = new Map<string, Point>();
    const at = (place: Place): Point => {
      let point = byPlace.get(place.id);
      if (!point) {
        point = { place, missions: [], safehouse: false, gunshop: false };
        byPlace.set(place.id, point);
        this.points.push(point);
      }
      return point;
    };
    for (const def of this.runner.defs) {
      if (this.runner.disabled.has(def.id)) continue;
      const place = findPlace(world, def.placeId);
      if (!place) continue;
      at(place).missions.push(def);
      this.talk.set(def, `Talk to ${def.giver}`);
    }
    // No shop counters or beds on a marae, whatever the map tags say.
    for (const place of world.placesTagged('safehouse')) if (!maraeAt(world, place.x, place.z, TUNING.maraeMargin)) at(place).safehouse = true;
    for (const place of world.placesTagged('gunshop')) if (!maraeAt(world, place.x, place.z, TUNING.maraeMargin)) at(place).gunshop = true;
    for (const point of this.points) if (point.gunshop) this.browse.set(point, `Browse ${point.place.name}`);
  }

  /** Re-sync start beacons and blips with mission state. */
  private sync() {
    if (!this.ready) return;
    const { ctx } = this;
    const active = this.runner.run !== null;
    if (active && this.introObjective) {
      // The mission's own objective takes over from the new-game pointer.
      this.introObjective = false;
      ctx.ui.objective(null);
    }
    for (const def of this.runner.defs) {
      const place = findPlace(ctx.world, def.placeId);
      const show = !active && place !== null && this.runner.stateOf(def) === 'available';
      const index = this.beacons.findIndex((b) => b.id === def.id);
      const blipId = `mission:${def.id}`;
      if (show && index < 0) {
        const marker = this.markers.acquire('mission');
        marker.place(place.x, ctx.world.groundAt(place.x, place.z), place.z, 1.2);
        this.beacons.push({ id: def.id, marker });
        ctx.ui.setBlip({ id: blipId, kind: 'mission', x: place.x, z: place.z, label: def.initial ?? def.giver.charAt(0), pinned: true });
      } else if (!show && index >= 0) {
        this.markers.release(this.beacons[index].marker);
        this.beacons.splice(index, 1);
        ctx.ui.removeBlip(blipId);
      }
    }
  }

  private updateBeacons() {
    const p = this.ctx.player.position;
    for (let i = 0; i < this.beacons.length; i++) {
      const m = this.beacons[i].marker;
      m.group.visible = Math.hypot(m.x - p.x, m.z - p.z) < TUNING.beaconDistance;
    }
  }

  /** The job on offer at a point right now, if any. */
  private offerAt(point: Point): MissionDef | null {
    if (this.runner.run) return null;
    for (let i = 0; i < point.missions.length; i++) if (this.runner.stateOf(point.missions[i]) === 'available') return point.missions[i];
    return null;
  }

  /** Is the player standing where their own "get in" prompt applies? Then that prompt (and key press) wins. */
  private byAVehicle(): boolean {
    const p = this.ctx.player.position;
    const all = this.ctx.vehicles.all;
    for (let i = 0; i < all.length; i++) {
      const v = all[i];
      if (!v.destroyed && Math.hypot(v.position.x - p.x, v.position.z - p.z) < v.spec.length * 0.5 + 2.2) return true;
    }
    return false;
  }

  private updateInteraction(dt: number) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.busy || this.cooldown > 0) return;
    const { ctx } = this;
    const { player, ui, input } = ctx;
    if (!player.alive || player.vehicle || !player.controlsEnabled || ui.menuOpen) return;
    const p = player.position;
    let point: Point | null = null;
    let nearest = TUNING.reach;
    for (let i = 0; i < this.points.length; i++) {
      const place = this.points[i].place;
      const d = Math.hypot(place.x - p.x, place.z - p.z);
      if (d <= nearest) {
        nearest = d;
        point = this.points[i];
      }
    }
    if (!point || this.byAVehicle()) return;

    const key = input.label('interact');
    // Business, beds and shop counters are for quiet moments: nobody wants the police following the player in.
    const hot = ctx.police.level > 0;
    const job = this.offerAt(point);
    if (job) {
      if (hot) ui.prompt('Lose the police before you talk business');
      else {
        ui.prompt(this.prompts.get(key, this.talk.get(job) ?? 'Talk'));
        if (input.pressed('interact')) void this.offer(point, job);
      }
      return;
    }
    if (point.safehouse && !this.runner.run) {
      if (hot) ui.prompt("Can't have a kip with the police about");
      else {
        ui.prompt(this.prompts.get(key, KIP));
        if (input.pressed('interact')) void this.guard(this.services.kip());
      }
    } else if (point.gunshop) {
      if (hot) ui.prompt("They've locked the door. Lose the police first");
      else {
        ui.prompt(this.prompts.get(key, this.browse.get(point) ?? 'Browse'));
        if (input.pressed('interact')) void this.guard(this.services.shop(point.place));
      }
    }
  }

  /** Run a dialog / kip with prompts held off until it is over. */
  private async guard(task: Promise<void>) {
    this.busy = true;
    try {
      await task;
    } catch (err) {
      console.warn('missions: interaction failed', err);
    } finally {
      this.busy = false;
      this.cooldown = TUNING.interactCooldown;
    }
  }

  private offer(point: Point, def: MissionDef): Promise<void> {
    const options = point.safehouse ? [TAKE_JOB, KIP, NOT_NOW] : [TAKE_JOB, NOT_NOW];
    return this.guard(
      this.ctx.ui.choose(def.title, `${def.blurb} Pays $${def.reward}.`, options).then((pick) => {
        if (pick === 0) this.runner.start(def.id);
        else if (point.safehouse && pick === 1 && this.ctx.police.level === 0) return this.services.kip();
        return undefined;
      }),
    );
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.runner.dispose();
    this.services.dispose();
    this.cameos.dispose();
    for (const beacon of this.beacons) this.ctx.ui.removeBlip(`mission:${beacon.id}`);
    this.beacons.length = 0;
    this.markers.dispose();
    this.dialogue.clear();
  }
}

export function createMissions(ctx: GameContext): MissionsApi & System {
  return new Missions(ctx);
}
