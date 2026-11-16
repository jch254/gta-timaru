import { BUTTONS, zoneAt, type ButtonId } from './controls';
import type { TouchFeed } from '../core/feed';
import { clampBase, emptyStick, followBase, steerCurve, stickVector, type StickState } from './stick';

/** What the router needs from whatever draws the controller. Tests pass a stand-in. */
export interface RouterView {
  /** Viewport size in CSS pixels. */
  width(): number;
  height(): number;
  /** Which pedal is under this point, if either (a thumb may slide from one to the other). */
  pedalAt(x: number, y: number): 'gas' | 'brake' | null;
  /** Draw the stick with its base at `baseX, baseY`; `on` false puts it away. */
  stick(on: boolean, baseX: number, baseY: number, state: StickState): void;
  /** A button is now down (or, for a toggle, switched on) or not. */
  button(id: ButtonId, down: boolean): void;
}

type Role = { kind: 'stick' } | { kind: 'look'; x: number; y: number } | { kind: 'button'; id: ButtonId; x: number; y: number };

/**
 * Follows every finger by its touch identifier and gives each one job for as long as it stays down: the
 * stick, looking around, or a button. That is what lets the stick, a look drag and a button work at once.
 * No DOM: the overlay hands it identifiers and coordinates.
 */
export class TouchRouter {
  private roles = new Map<number, Role>();
  private stickId: number | null = null;
  private base = { x: 0, y: 0 };
  private state = emptyStick();
  private counts = new Map<ButtonId, number>();
  private latched = new Set<ButtonId>();
  private driving = false;

  constructor(
    private feed: TouchFeed,
    private view: RouterView,
  ) {}

  /** Fingers currently down. */
  get touches(): number {
    return this.roles.size;
  }

  /** In a car the stick only steers. */
  setDriving(driving: boolean) {
    if (driving === this.driving) return;
    this.driving = driving;
    if (this.stickId !== null) this.applyStick();
  }

  /** A finger landed, on `button` or on free space. */
  start(id: number, x: number, y: number, button: ButtonId | null) {
    if (this.roles.has(id)) this.end(id);
    if (button) {
      this.roles.set(id, { kind: 'button', id: button, x, y });
      this.press(button);
    } else if (this.stickId === null && zoneAt(x, this.view.width()) === 'stick') {
      this.stickId = id;
      this.roles.set(id, { kind: 'stick' });
      const at = clampBase(x, y, this.view.width(), this.view.height());
      this.base.x = at.x;
      this.base.y = at.y;
      stickVector(x - this.base.x, y - this.base.y, this.state);
      this.applyStick();
    } else {
      // Anywhere else, or a second finger on the left: look around.
      this.roles.set(id, { kind: 'look', x, y });
    }
  }

  move(id: number, x: number, y: number) {
    const role = this.roles.get(id);
    if (!role) return;
    if (role.kind === 'stick') {
      followBase(this.base, x, y);
      stickVector(x - this.base.x, y - this.base.y, this.state);
      this.applyStick();
      return;
    }
    const dx = x - role.x;
    const dy = y - role.y;
    role.x = x;
    role.y = y;
    if (role.kind === 'look') {
      this.feed.look(dx, dy);
      return;
    }
    const def = BUTTONS[role.id];
    if (def.look) this.feed.look(dx, dy);
    if (def.mode === 'pedal') {
      const under = this.view.pedalAt(x, y);
      if (under && under !== role.id) {
        this.release(role.id);
        role.id = under;
        this.press(under);
      }
    }
  }

  /** The finger lifted (or the browser cancelled the touch). */
  end(id: number) {
    const role = this.roles.get(id);
    if (!role) return;
    this.roles.delete(id);
    if (role.kind === 'stick') {
      this.stickId = null;
      stickVector(0, 0, this.state);
      this.feed.stick(0, 0);
      this.feed.hold('sprint', false);
      this.view.stick(false, this.base.x, this.base.y, this.state);
    } else if (role.kind === 'button') this.release(role.id);
  }

  /** Drop any finger the browser no longer reports: a lost touchend must never leave a button stuck down. */
  reconcile(live: readonly number[]) {
    for (const id of [...this.roles.keys()]) if (!live.includes(id)) this.end(id);
  }

  /** Buttons that have just been hidden let go, and a hidden toggle switches off. */
  sync(visible: ReadonlySet<ButtonId>) {
    for (const [id, role] of this.roles) {
      if (role.kind !== 'button' || visible.has(role.id)) continue;
      this.release(role.id);
      this.roles.set(id, { kind: 'look', x: role.x, y: role.y });
    }
    for (const id of [...this.latched]) if (!visible.has(id)) this.unlatch(id);
  }

  /** Let go of everything (a menu opened, the controller was hidden, the page lost focus). */
  cancelAll() {
    for (const id of [...this.roles.keys()]) this.end(id);
    for (const id of [...this.latched]) this.unlatch(id);
    this.counts.clear();
    this.feed.releaseAll();
  }

  private applyStick() {
    const s = this.state;
    if (this.driving) {
      // Steering only: there is no sprint to show at the rim.
      s.sprint = false;
      this.feed.stick(-steerCurve(s.x), 0);
      this.feed.hold('sprint', false);
    } else {
      this.feed.stick(-s.x, s.y);
      this.feed.hold('sprint', s.sprint);
    }
    this.view.stick(true, this.base.x, this.base.y, s);
  }

  private press(id: ButtonId) {
    const count = this.counts.get(id) ?? 0;
    this.counts.set(id, count + 1);
    if (count > 0) return;
    const def = BUTTONS[id];
    if (def.mode === 'toggle') {
      if (this.latched.has(id)) this.unlatch(id);
      else {
        this.latched.add(id);
        if (def.action) this.feed.hold(def.action, true);
        this.view.button(id, true);
      }
      return;
    }
    if (def.mode === 'pedal' && def.axis) this.feed.pedal(def.axis, 1);
    else if (def.mode === 'hold' && def.action) this.feed.hold(def.action, true);
    else if (def.mode === 'tap' && def.action) this.feed.press(def.action);
    this.view.button(id, true);
  }

  private release(id: ButtonId) {
    const count = (this.counts.get(id) ?? 0) - 1;
    if (count > 0) {
      this.counts.set(id, count);
      return;
    }
    this.counts.delete(id);
    const def = BUTTONS[id];
    if (def.mode === 'toggle') return;
    if (def.mode === 'pedal' && def.axis) this.feed.pedal(def.axis, 0);
    else if (def.mode === 'hold' && def.action) this.feed.hold(def.action, false);
    this.view.button(id, false);
  }

  private unlatch(id: ButtonId) {
    this.latched.delete(id);
    const action = BUTTONS[id].action;
    if (action) this.feed.hold(action, false);
    this.view.button(id, false);
  }
}
