import './ui.css';
import { setPauseHold } from '../core/pause';
import type { Blip, GameContext, System, UiApi } from '../core/types';
import { updates as tabUpdates, type UpdateWatch } from '../core/update';
import { ChooseDialog } from './choose';
import { el, Flag, hint, pixelRatio } from './dom';
import { bilingual, locationLines } from './format';
import { Hud } from './hud';
import { iconForTags } from './icons';
import { MapData } from './mapdata';
import { MapRaster, STREET_PALETTE } from './maprender';
import { Banner, Fader, Subtitles, Toasts } from './messages';
import { Minimap, MINIMAP_EM, type StaticMarker } from './minimap';
import { MenuNav } from './nav';
import { PauseMenu } from './pause';
import { Waypoint } from './waypoint';

/** Border of the minimap plate in em, taken off its edge to get the canvas size (see .nw-mini). */
const MINIMAP_BORDER_EM = 0.6;
/** Milliseconds per frame spent surveying land use for the maps: a trickle in play, more while paused. */
const SURVEY_MS_PLAY = 0.8;
const SURVEY_MS_PAUSED = 6;

const DEATH_LINES = ['Off to A&E with you.', 'She’ll be right. Eventually.', 'That’ll leave a mark.', 'Not your finest hour, mate.'];

/**
 * HUD, minimap, pause screen and dialogs.
 *
 * Layers, back to front: HUD → black fade → banner and subtitles → pause screen → choice dialog → toasts.
 * Everything is driven from `lateUpdate`, which keeps running while the game is paused.
 */
class Ui implements UiApi, System {
  readonly name = 'ui';
  menuOpen = false;

  private root: HTMLDivElement;
  private pausedFlag: Flag;
  private hud: Hud;
  private fader: Fader;
  private bigBanner: Banner;
  private subtitles: Subtitles;
  private toasts: Toasts;
  private dialog: ChooseDialog;
  private pauseLayer: HTMLDivElement;
  private shield: Flag;
  private nav = new MenuNav();

  private mapData: MapData | null = null;
  private minimap: Minimap | null = null;
  /** The player's own X on the island map, guided to with a pen line on both maps. */
  private waypoint = new Waypoint(() => this.toast("That's your X. You're there.", 4));
  private pause: PauseMenu | null = null;
  /** Shared (by reference) with the minimap and the island map; always mutated in place. */
  private blips: Blip[] = [];
  private markers: StaticMarker[] = [];

  private ready = false;
  private running = false;
  private layoutDirty = true;

  private relock = false;
  private wasLocked = false;
  /** Pointer lock has worked at least once this session (so asking for a click to get it back makes sense). */
  private everLocked = false;
  /** The pause screen came up because the browser dropped pointer lock (Esc), not because we released it. */
  private lockLost = false;
  /** Paused with the menu closed, waiting for a click so the browser will lock the pointer again. */
  private waitingForClick = false;
  private lastShot = -1e9;
  private lastFleshHit = -1e9;
  private hitPending = false;
  private hurt = 0;
  private lastHurt = -1e9;
  private deaths = 0;
  /** A newer build of the game has been deployed since this one started. */
  private updateReady = false;
  private updateToasted = false;
  private cleanups: (() => void)[] = [];

  constructor(
    private ctx: GameContext,
    private updates: UpdateWatch = tabUpdates,
  ) {
    // Only DOM here: the other systems do not exist yet (see init()).
    const root = (this.root = el('div', 'nw-ui'));
    this.pausedFlag = new Flag(root, 'nw-paused');
    this.hud = new Hud(root);
    this.fader = new Fader(root);
    const over = el('div', 'nw-over nw-layer', root);
    this.bigBanner = new Banner(over);
    this.subtitles = new Subtitles(over);
    this.pauseLayer = el('div', 'nw-layer', root);
    const shield = el('div', 'nw-shield', root);
    hint(el('div', 'nw-shield-plate', shield), ['Click'], 'to carry on');
    this.shield = new Flag(shield, 'on');
    shield.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.carryOn();
    });
    this.dialog = new ChooseDialog(
      root,
      () => this.syncMenu(),
      (id) => this.sound(id),
    );
    this.toasts = new Toasts(root);
    document.body.appendChild(root);
  }

  // ───────────── Setup ─────────────

  init() {
    if (this.ready) return;
    this.ready = true;
    const { ctx } = this;
    const { events } = ctx;

    // Maps. A failure here must never stop the game starting: the HUD works without them.
    try {
      const data = (this.mapData = new MapData(ctx.world));
      data.buildNetwork();
      const raster = new MapRaster(data, STREET_PALETTE);
      this.minimap = new Minimap(this.hud.root, data, raster);
      for (const place of ctx.world.places) {
        const icon = iconForTags(place.tags);
        if (icon) this.markers.push({ x: place.x, z: place.z, icon, label: bilingual(place.name, place.teReo) });
      }
      const pause = (this.pause = new PauseMenu(
        this.pauseLayer,
        { ctx, resume: (gesture) => this.resume(gesture), toast: (text, seconds) => this.toast(text, seconds), sound: (id) => this.sound(id) },
        data,
        this.blips,
        this.markers,
        this.waypoint,
      ));
      data.onCells = (c0, r0, c1, r1) => {
        raster.paint(c0, r0, c1, r1);
        pause.map.cellsChanged(c0, r0, c1, r1);
      };
    } catch (err) {
      console.warn('ui: map setup failed; carrying on without the minimap', err);
    }

    this.cleanups.push(
      this.updates.onAvailable(() => {
        this.updateReady = true;
        this.pause?.showUpdate();
      }),
    );

    this.cleanups.push(
      events.on('zoneChanged', ({ name, city }) => {
        const p = ctx.player.position;
        const district = ctx.world.districtAt(p.x, p.z);
        const lines = locationLines(name, district.name, city ?? district.city, district.teReo);
        this.hud.location(lines.title, lines.sub, lines.teReo);
      }),
      events.on('vehicleEntered', ({ actor, vehicle }) => {
        if (actor === ctx.player) this.hud.vehicle(vehicle.spec.name);
      }),
      events.on('radioChanged', ({ stationId, name }) => {
        const station = stationId ? ctx.audio?.radio.stations.find((s) => s.id === stationId) : undefined;
        this.hud.radio(stationId ? name || station?.name || 'Radio' : 'Radio off', station?.blurb ?? '');
      }),
      events.on('moneyChanged', ({ delta }) => this.hud.moneyChanged(delta)),
      events.on('playerDied', () => this.bigBanner.show('Carked it', DEATH_LINES[this.deaths++ % DEATH_LINES.length], 4.5, 'bad')),
      events.on('weaponChanged', () => this.hud.ammoChanged()),
      events.on('pickup', () => this.hud.ammoChanged()),
      events.on('actorDamaged', ({ actor, info }) => {
        if (actor === ctx.player) this.hurt += info.amount;
      }),
      // Hit marker: a flesh impact that belongs to the player's own shot (the two events arrive together,
      // in either order), and is not the player being hit.
      events.on('gunshot', ({ shooter }) => {
        if (shooter !== ctx.player) return;
        const now = performance.now();
        this.hud.ammoChanged();
        if (now - this.lastFleshHit < 40) this.hitPending = true;
        this.lastShot = now;
      }),
      events.on('impact', ({ surface, position }) => {
        if (surface !== 'flesh') return;
        const p = ctx.player.position;
        const dx = position.x - p.x;
        const dz = position.z - p.z;
        if (dx * dx + dz * dz < 1) return;
        const now = performance.now();
        if (now - this.lastShot < 120) this.hitPending = true;
        else this.lastFleshHit = now;
      }),
    );

    const onResize = () => {
      this.layoutDirty = true;
    };
    window.addEventListener('resize', onResize);
    this.cleanups.push(() => window.removeEventListener('resize', onResize));

    // Losing pointer lock (Esc, alt-tab) while playing brings up the pause screen.
    const onLock = () => {
      const locked = document.pointerLockElement !== null;
      if (locked) {
        this.everLocked = true;
        this.lockLost = false;
      } else if (this.wasLocked && this.running && !this.menuOpen && !ctx.clock.paused) {
        this.lockLost = true;
        this.openPause('menu', true);
      }
      this.wasLocked = locked;
    };
    document.addEventListener('pointerlockchange', onLock);
    this.cleanups.push(() => document.removeEventListener('pointerlockchange', onLock));

    // Browsers refuse to re-lock the pointer without a fresh click after Esc, so a click on the game takes it back.
    const canvas = ctx.gfx?.renderer?.domElement;
    if (canvas) {
      const onDown = (e: MouseEvent) => {
        if (e.button === 0 && this.running && !this.menuOpen && !ctx.clock.paused && !ctx.input.captured && !ctx.input.gamepadActive) ctx.input.capture(e);
      };
      // Claim the lock gesture before Input's gameplay listener sees the press.
      canvas.addEventListener('mousedown', onDown, true);
      this.cleanups.push(() => canvas.removeEventListener('mousedown', onDown, true));
    }
  }

  dispose() {
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    this.dialog.cancel();
    this.fader.dispose();
    this.root.remove();
  }

  private sound(id: 'uiMove' | 'uiSelect') {
    this.ctx.audio?.play(id);
  }

  private layout() {
    this.layoutDirty = false;
    const fontPx = parseFloat(getComputedStyle(this.root).fontSize) || 16;
    const dpr = pixelRatio(2);
    this.hud.layout(fontPx, dpr);
    this.minimap?.layout((MINIMAP_EM - MINIMAP_BORDER_EM) * fontPx, dpr);
    this.pause?.layout(window.innerWidth, window.innerHeight, dpr, fontPx);
  }

  // ───────────── Pausing and pointer lock ─────────────

  private openPause(screen: 'menu' | 'map', lockLoss = false) {
    const { pause, ctx } = this;
    if (!pause || pause.isOpen) return;
    setPauseHold(ctx, 'menu', true);
    pause.open(screen, lockLoss);
    this.syncMenu();
    // A natural moment to ask whether a newer build is out (spaced out by the watch itself).
    void this.updates.check();
  }

  private resume(gesture: boolean) {
    const { pause, ctx } = this;
    if (!pause || !pause.isOpen) return;
    pause.close();
    // After the player's own Esc the browser only gives the pointer back on a click or a key other than Esc.
    // Resuming on a bare Esc would leave the mouse loose, so hold the game until they click.
    if (this.lockLost && !gesture && this.everLocked && !ctx.input.gamepadActive) {
      this.waitingForClick = true;
      this.shield.set(true);
      this.syncMenu();
      return;
    }
    this.finishResume();
  }

  /** The click (or confirm key) that ends the "click to carry on" wait. */
  private carryOn() {
    if (!this.waitingForClick) return;
    this.waitingForClick = false;
    this.shield.set(false);
    this.finishResume();
  }

  private finishResume() {
    setPauseHold(this.ctx, 'menu', false);
    this.syncMenu();
  }

  /** Keeps `menuOpen`, the HUD's visibility and pointer lock in step with whatever is open. */
  private syncMenu() {
    const pauseOpen = !!this.pause?.isOpen;
    this.pausedFlag.set(pauseOpen);
    const open = pauseOpen || this.dialog.open || this.waitingForClick;
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    const input = this.ctx.input;
    if (open) {
      // Take the pointer back afterwards unless the player is on a gamepad and never had it locked.
      this.relock = input.captured || this.wasLocked || this.lockLost || !input.gamepadActive;
      this.nav.reset(input);
      input.release();
    } else if (this.relock) {
      input.capture();
    }
  }

  // ───────────── UiApi ─────────────

  prompt(text: string | null) {
    this.hud.prompt(text);
  }

  private minimapClock = 1;

  subtitle(text: string, seconds?: number, speaker?: string) {
    this.subtitles.push(text, seconds, speaker);
  }

  skipSubtitle() {
    this.subtitles.skip();
  }

  banner(title: string, sub?: string, seconds?: number, tone?: 'neutral' | 'good' | 'bad') {
    this.bigBanner.show(title, sub, seconds, tone);
  }

  toast(text: string, seconds?: number) {
    this.toasts.push(text, seconds);
  }

  objective(text: string | null) {
    this.hud.objective(text);
  }

  timer(label: string | null, seconds?: number) {
    this.hud.timer(label, seconds);
  }

  setBlip(blip: Blip) {
    const at = this.blips.findIndex((b) => b.id === blip.id);
    if (at >= 0) this.blips[at] = blip;
    else this.blips.push(blip);
    this.pause?.map.invalidate();
  }

  removeBlip(id: string) {
    const at = this.blips.findIndex((b) => b.id === id);
    if (at >= 0) this.blips.splice(at, 1);
    this.pause?.map.invalidate();
  }

  fade(toBlack: boolean, seconds?: number): Promise<void> {
    return this.fader.fade(toBlack, seconds);
  }

  choose(title: string, body: string, options: string[]): Promise<number> {
    return this.dialog.show(title, body, options);
  }

  // ───────────── Frame ─────────────

  lateUpdate(dt: number) {
    if (!this.ready) this.init();
    this.running = true;
    if (this.layoutDirty) this.layout();
    const { ctx, pause } = this;
    const input = ctx.input;
    // The waypoint re-plans paused or live: the island map wants a fresh pen line while it is being marked.
    this.waypoint.update(ctx, dt);

    // Menus first. The frame a menu opens on never also feeds it input (the opening press is spent).
    if (this.dialog.open) {
      this.nav.update(input, dt);
      this.dialog.update(this.nav);
    } else if (pause?.isOpen) {
      this.nav.update(input, dt);
      pause.update(this.nav, dt);
    } else if (this.waitingForClick) {
      // Enter / Space count as a gesture too; Esc goes back to the menu.
      this.nav.update(input, dt);
      if (this.nav.confirm) this.carryOn();
      else if (this.nav.back && pause) {
        this.waitingForClick = false;
        this.shield.set(false);
        pause.open('menu', false);
        this.syncMenu();
      }
    } else if (pause && input.pressed('pause')) {
      this.openPause('menu');
    } else if (pause && input.pressed('map')) {
      this.openPause('map');
    }

    const paused = ctx.clock.paused;
    const live = paused ? 0 : dt;
    this.hud.update(ctx, dt, paused);

    // At most one tick per frame, however many pellets landed.
    if (this.hitPending) {
      this.hitPending = false;
      this.hud.hitMarker();
    }

    // Damage adds up between pulses so a trickle (drowning, fire) throbs instead of strobing.
    if (this.hurt >= 1.5) {
      const now = performance.now();
      if (now - this.lastHurt > 220) {
        this.hud.hurtPulseNow(this.hurt / 40);
        this.hurt = 0;
        this.lastHurt = now;
      }
    }

    this.subtitles.update(live);
    this.bigBanner.update(live);
    // A newer build: said once, in free roam, never over a menu or in the middle of a job.
    if (this.updateReady && !this.updateToasted && !this.menuOpen && !paused && !ctx.missions?.active) {
      this.updateToasted = true;
      this.toast(pause ? 'A new version of 03 Quest is out. Pause to get it.' : 'A new version of 03 Quest is out. Reload the page to get it.', 8);
    }
    this.toasts.update(dt);

    const player = ctx.player;
    if (!player) return;
    const pauseOpen = !!pause?.isOpen;
    // The minimap is a full 2D canvas repaint: thirty times a second is plenty.
    this.minimapClock += dt;
    if (this.minimap && !pauseOpen && this.minimapClock >= 1 / 30) {
      this.minimap.draw(ctx, this.blips, this.markers, this.waypoint, this.minimapClock);
      this.minimapClock = 0;
    }
    const data = this.mapData;
    if (data && !data.done) data.survey(pauseOpen ? SURVEY_MS_PAUSED : SURVEY_MS_PLAY, player.position.x, player.position.z);
  }
}

export function createUi(ctx: GameContext, updates?: UpdateWatch): UiApi & System {
  return new Ui(ctx, updates);
}
