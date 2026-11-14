import { el, Flag, Retrigger, TextCache } from './dom';
import { subtitleSeconds } from './format';

/** Timed text that sits above the game: subtitles, the big banner, corner toasts and the black fade. */

interface Line {
  text: string;
  seconds: number;
  speaker: string;
}

const QUEUE_MAX = 3;

/** Dialogue at the bottom of the screen. New lines queue behind the current one; repeats just refresh it. */
export class Subtitles {
  private root: HTMLDivElement;
  private speaker: TextCache;
  private text: TextCache;
  private shown: Flag;
  private hasSpeaker: Flag;
  private current: Line | null = null;
  private time = 0;
  private queue: Line[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'nw-sub', parent);
    this.speaker = new TextCache(el('span', 'nw-sub-who', this.root));
    this.text = new TextCache(el('span', 'nw-sub-text', this.root));
    this.shown = new Flag(this.root, 'on');
    this.hasSpeaker = new Flag(this.root, 'who');
  }

  push(text: string, seconds?: number, speaker?: string) {
    const clean = (text ?? '').trim();
    if (!clean) return;
    const line: Line = { text: clean, seconds: seconds && seconds > 0 ? seconds : subtitleSeconds(clean), speaker: (speaker ?? '').trim() };
    const cur = this.current;
    if (cur && cur.text === line.text && cur.speaker === line.speaker) {
      // The same line again (some callers repeat it every frame): keep it up.
      this.time = Math.max(this.time, line.seconds);
      return;
    }
    const last = this.queue[this.queue.length - 1];
    if (last && last.text === line.text && last.speaker === line.speaker) return;
    if (!cur) {
      this.show(line);
      return;
    }
    if (this.queue.length >= QUEUE_MAX) this.queue.shift();
    this.queue.push(line);
    // Do not let a long line hold up the ones behind it.
    this.time = Math.min(this.time, 1.6);
  }

  clear() {
    this.queue.length = 0;
    this.current = null;
    this.shown.set(false);
  }

  /** End the line on screen now; the next queued one, if any, follows on the next update. */
  skip() {
    this.time = 0;
  }

  private show(line: Line) {
    this.current = line;
    this.time = line.seconds;
    this.speaker.set(line.speaker);
    this.hasSpeaker.set(line.speaker.length > 0);
    this.text.set(line.text);
    this.shown.set(true);
  }

  update(dt: number) {
    if (!this.current) return;
    this.time -= dt;
    if (this.time > 0) return;
    const next = this.queue.shift();
    if (next) this.show(next);
    else {
      this.current = null;
      this.shown.set(false);
    }
  }
}

export type BannerTone = 'neutral' | 'good' | 'bad';

/** The big sign-written moment in the upper middle of the screen. */
export class Banner {
  private root: HTMLDivElement;
  private title: TextCache;
  private sub: TextCache;
  private shown: Flag;
  private hasSub: Flag;
  private anim: Retrigger;
  private tone: BannerTone = 'neutral';
  private time = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'nw-banner tone-neutral', parent);
    const inner = el('div', 'nw-banner-inner', this.root);
    this.title = new TextCache(el('div', 'nw-banner-title', inner));
    this.sub = new TextCache(el('div', 'nw-banner-sub', inner));
    this.shown = new Flag(this.root, 'on');
    this.hasSub = new Flag(this.root, 'sub');
    this.anim = new Retrigger(inner, 'in-a', 'in-b');
  }

  show(title: string, sub = '', seconds = 3, tone: BannerTone = 'neutral') {
    this.title.set(title ?? '');
    this.sub.set(sub ?? '');
    this.hasSub.set(!!sub);
    if (tone !== this.tone) {
      this.root.classList.remove(`tone-${this.tone}`);
      this.root.classList.add(`tone-${tone}`);
      this.tone = tone;
    }
    this.time = seconds > 0 ? seconds : 3;
    this.shown.set(true);
    this.anim.fire();
  }

  hide() {
    this.time = 0;
    this.shown.set(false);
  }

  update(dt: number) {
    if (this.time <= 0) return;
    this.time -= dt;
    if (this.time <= 0) this.shown.set(false);
  }
}

const TOAST_SLOTS = 4;

interface ToastSlot {
  text: TextCache;
  shown: Flag;
  anim: Retrigger;
  time: number;
  value: string;
  born: number;
}

/** Small docket-slip notifications down the right-hand side. */
export class Toasts {
  private slots: ToastSlot[] = [];
  private counter = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'nw-toasts', parent);
    for (let i = 0; i < TOAST_SLOTS; i++) {
      const node = el('div', 'nw-toast', root);
      this.slots.push({ text: new TextCache(node), shown: new Flag(node, 'on'), anim: new Retrigger(node, 'in-a', 'in-b'), time: 0, value: '', born: 0 });
    }
  }

  push(text: string, seconds = 3.5) {
    const value = (text ?? '').trim();
    if (!value) return;
    const life = seconds > 0 ? seconds : 3.5;
    let target: ToastSlot | null = null;
    // Same message again: refresh it rather than stacking a copy.
    for (const slot of this.slots) if (slot.time > 0 && slot.value === value) target = slot;
    if (target) {
      target.time = Math.max(target.time, life);
      return;
    }
    for (const slot of this.slots) {
      if (slot.time <= 0) {
        target = slot;
        break;
      }
    }
    if (!target) {
      // All slots busy: replace the oldest.
      target = this.slots[0];
      for (const slot of this.slots) if (slot.born < target.born) target = slot;
    }
    target.value = value;
    target.time = life;
    target.born = ++this.counter;
    target.text.set(value);
    target.shown.set(true);
    target.anim.fire();
  }

  update(dt: number) {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.time <= 0) continue;
      slot.time -= dt;
      if (slot.time <= 0) slot.shown.set(false);
    }
  }
}

/** Full-screen fade to black and back. */
export class Fader {
  private node: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.node = el('div', 'nw-fade', parent);
  }

  fade(toBlack: boolean, seconds = 1): Promise<void> {
    // A new fade supersedes the old one; let whoever was waiting on it carry on.
    this.settle();
    const s = Math.max(0, seconds);
    this.node.style.transitionDuration = `${s}s`;
    this.node.style.opacity = toBlack ? '1' : '0';
    if (s === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.pending = resolve;
      this.timer = setTimeout(() => this.settle(), s * 1000);
    });
  }

  private settle() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const done = this.pending;
    this.pending = null;
    done?.();
  }

  dispose() {
    this.settle();
  }
}
