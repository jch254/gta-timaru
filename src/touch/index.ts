import type { GameContext, System, WeaponSpec } from '../core/types';
import { fireLabel, fireRepeat, interactLabel, isPortrait, visibleButtons, type ButtonId, type ControlState } from './controls';
import { deviceHints, isTouchFirst } from '../core/device';
import type { TouchFeed } from '../core/feed';
import { Overlay } from './overlay';
import { prepareTouchPage, watchViewport } from './page';
import { TouchRouter } from './router';

const KINDS: WeaponSpec['kind'][] = ['fists', 'melee', 'pistol', 'smg', 'shotgun', 'rifle'];

/**
 * The on-screen controller for touch screens. It shows on a phone or tablet from the start, on anything else
 * after the first touch, and goes away again when a key or a gamepad is used. Everything it does goes through
 * `feed` (Input.touch), so the rest of the game sees ordinary input.
 */
class TouchSystem implements System {
  readonly name = 'touch';

  private overlay = new Overlay();
  private router: TouchRouter;
  private state: ControlState = { menuOpen: false, free: true, driving: false, radio: false, weapon: 'fists', carried: 1, driveBy: false, prompt: false, talking: false };
  private signature = -1;
  private spec: WeaponSpec | null = null;
  private arsenal: WeaponSpec[] = [];
  private promptSeen = false;
  private promptText: string | null = null;
  private word = 'USE';
  private wasPlay = false;
  private heldForPortrait = false;
  private live: number[] = [];

  constructor(
    private ctx: GameContext,
    private feed: TouchFeed,
    canvas: HTMLElement,
  ) {
    const { overlay } = this;
    const router = (this.router = new TouchRouter(feed, overlay));
    if (isTouchFirst(deviceHints())) this.activate();

    // Any touch brings the controller up (back up, after a keyboard or gamepad took over).
    window.addEventListener('touchstart', () => this.activate(), { capture: true, passive: true });
    // Without this a tap on the game would also arrive as a mouse click a moment later, and throw a punch.
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    const ids = (list: TouchList) => {
      this.live.length = 0;
      for (let i = 0; i < list.length; i++) this.live.push(list[i].identifier);
      return this.live;
    };
    const root = overlay.root;
    root.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const button = overlay.buttonOf(t.target);
          // Free space only counts while the game is being played (not under a menu or the portrait card).
          if (button || this.wasPlay) router.start(t.identifier, t.clientX, t.clientY, button);
        }
        router.reconcile(ids(e.touches));
      },
      { passive: false },
    );
    root.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          router.move(t.identifier, t.clientX, t.clientY);
        }
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) router.end(e.changedTouches[i].identifier);
      router.reconcile(ids(e.touches));
    };
    root.addEventListener('touchend', end, { passive: false });
    root.addEventListener('touchcancel', end, { passive: false });
    document.addEventListener('visibilitychange', () => router.cancelAll());

    // iOS only starts sound (the audio context, and the radio's stream element) from inside a touch.
    const unlock = () => {
      try {
        ctx.audio.unlock();
      } catch {
        // Sound is optional.
      }
    };
    for (const type of ['touchend', 'pointerup', 'click']) document.addEventListener(type, unlock, { capture: true, passive: true });

    // The interact button shows when the game is offering something: that is whenever it sets a prompt.
    const ui = ctx.ui;
    const prompt = ui.prompt.bind(ui);
    ui.prompt = (text) => {
      if (text) {
        this.promptSeen = true;
        this.promptText = text;
      }
      prompt(text);
    };
    feed.setLabel('map', 'MAP');
  }

  private activate() {
    this.feed.active = true;
    prepareTouchPage();
  }

  lateUpdate(dt: number) {
    const { ctx, feed, overlay, router, state: s } = this;
    watchViewport();
    const on = feed.active;
    const portrait = on && isPortrait(window.innerWidth, window.innerHeight);
    this.holdFor(portrait);

    const player = ctx.player;
    const vehicle = player.vehicle;
    const combat = ctx.combat;
    const spec = combat.current;
    s.menuOpen = ctx.ui.menuOpen;
    s.free = player.alive && player.controlsEnabled;
    s.driving = vehicle !== null;
    s.radio = vehicle !== null && vehicle.spec.cls !== 'bike' && !vehicle.destroyed;
    s.weapon = spec.kind;
    s.carried = 0;
    s.driveBy = false;
    // (Indexed, over a list made once: nothing is allocated per frame.)
    if (this.arsenal.length !== combat.weapons.size) this.arsenal = [...combat.weapons.values()];
    for (let i = 0; i < this.arsenal.length; i++) {
      const w = this.arsenal[i];
      if (!combat.has(w.id)) continue;
      s.carried++;
      if (w.driveBy) s.driveBy = true;
    }
    s.prompt = this.promptSeen;
    this.promptSeen = false;
    const word = interactLabel(s.driving, s.prompt ? this.promptText : null);
    if (word !== this.word) {
      this.word = word;
      this.signature = -1;
    }
    s.talking = ctx.missions.talking;

    const play = on && !portrait && !s.menuOpen;
    feed.labelsOn = !s.menuOpen;
    overlay.setMode(on, play, portrait, s.driving);
    const signature =
      (on ? 1 : 0) | (portrait ? 2 : 0) | (s.menuOpen ? 4 : 0) | (s.free ? 8 : 0) | (s.driving ? 16 : 0) | (s.radio ? 32 : 0) | (s.prompt ? 64 : 0) | (s.talking ? 128 : 0) | (s.driveBy ? 256 : 0) | (s.carried > 1 ? 512 : 0) | (KINDS.indexOf(s.weapon) << 10);
    if (signature !== this.signature) {
      this.signature = signature;
      const visible: readonly ButtonId[] = on && !portrait ? visibleButtons(s) : [];
      overlay.word('fire', fireLabel(s.weapon, s.driving));
      overlay.word('interact', word);
      overlay.hot('interact', s.prompt);
      // Prompts name the button: "USE  Nick the ute", "OUT  Get out".
      feed.setLabel('interact', word);
      router.setDriving(s.driving);
      router.sync(overlay.show(visible));
    }
    if (spec !== this.spec) {
      this.spec = spec;
      feed.repeat('fire', fireRepeat(spec));
    }
    if (this.wasPlay && !play) router.cancelAll();
    this.wasPlay = play;
    if (!ctx.clock.paused) feed.tick(dt);
  }

  /** In portrait there is no layout to play with: the game waits behind the "turn your phone" card. */
  private holdFor(portrait: boolean) {
    const { clock, events, ui } = this.ctx;
    if (portrait && !this.heldForPortrait && !clock.paused) {
      this.heldForPortrait = true;
      clock.paused = true;
      events.emit('pausedChanged', { paused: true });
    } else if (!portrait && this.heldForPortrait) {
      this.heldForPortrait = false;
      if (clock.paused && !ui.menuOpen) {
        clock.paused = false;
        events.emit('pausedChanged', { paused: false });
      }
    }
  }
}

/** Starts the on-screen controller. `feed` is `Input.touch`; `canvas` is the game's drawing surface. */
export function createTouch(ctx: GameContext, feed: TouchFeed, canvas: HTMLElement): System {
  return new TouchSystem(ctx, feed, canvas);
}
