import { el, Flag, hint, TextCache } from './dom';
import type { MenuNav } from './nav';

/**
 * The choice dialog (shops, taking a job): a docket with a title, a few lines and a list of options.
 * Keyboard, gamepad (through MenuNav) and mouse all work; Esc / B resolves -1.
 */
export class ChooseDialog {
  open = false;

  private root: HTMLDivElement;
  private shown: Flag;
  private title: TextCache;
  private body: TextCache;
  private hasBody: Flag;
  private list: HTMLDivElement;
  private rows: HTMLDivElement[] = [];
  private count = 0;
  private index = 0;
  private armed = false;
  private resolve: ((index: number) => void) | null = null;

  /** `onChange` fires when the dialog opens or closes; `sound` plays a UI blip. */
  constructor(
    parent: HTMLElement,
    private onChange: () => void,
    private sound: (id: 'uiMove' | 'uiSelect') => void,
  ) {
    this.root = el('div', 'nw-choose', parent);
    this.shown = new Flag(this.root, 'on');
    const card = el('div', 'nw-choose-card nw-ledger', this.root);
    this.title = new TextCache(el('div', 'nw-choose-title', card));
    const body = el('div', 'nw-choose-body', card);
    this.body = new TextCache(body);
    this.hasBody = new Flag(body, 'on');
    this.list = el('div', 'nw-choose-list', card);
    const foot = el('div', 'nw-choose-foot nw-if-keys', card);
    hint(foot, ['↑', '↓'], 'Choose');
    hint(foot, ['Enter'], 'Select');
    hint(foot, ['Esc'], 'Leave it');
    // The same, said for fingers (the stylesheet shows one foot or the other).
    const taps = el('div', 'nw-choose-foot nw-if-touch', card);
    hint(taps, ['Tap'], 'Choose');
    hint(taps, ['‹ Back'], 'Leave it');
  }

  show(title: string, body: string, options: string[]): Promise<number> {
    // Only one dialog at a time: a new one cancels whatever was up (without closing the menu state in between).
    const previous = this.resolve;
    this.resolve = null;
    previous?.(-1);
    this.title.set(title ?? '');
    this.body.set(body ?? '');
    this.hasBody.set(!!body);
    this.count = options.length;
    for (let i = 0; i < options.length; i++) {
      let row = this.rows[i];
      if (!row) {
        row = el('div', 'nw-option', this.list);
        const at = i;
        row.addEventListener('pointerenter', () => this.select(at, false));
        row.addEventListener('click', () => {
          if (this.open && at < this.count) this.finish(at, true);
        });
        this.rows[i] = row;
      }
      row.textContent = options[i];
      row.style.display = '';
    }
    for (let i = options.length; i < this.rows.length; i++) this.rows[i].style.display = 'none';
    this.index = -1;
    this.select(0, false);
    this.open = true;
    this.armed = false;
    this.shown.set(true);
    this.onChange();
    return new Promise<number>((resolve) => {
      this.resolve = resolve;
      if (options.length === 0) this.finish(-1, false);
    });
  }

  /** Cancels an open dialog (resolves -1). */
  cancel() {
    if (this.open) this.finish(-1, false);
  }

  private select(index: number, scroll: boolean) {
    if (index === this.index || index < 0 || index >= this.count) return;
    this.rows[this.index]?.classList.remove('sel');
    this.index = index;
    const row = this.rows[index];
    row.classList.add('sel');
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  private finish(index: number, blip: boolean) {
    const done = this.resolve;
    this.resolve = null;
    this.open = false;
    this.shown.set(false);
    if (blip) this.sound('uiSelect');
    this.onChange();
    done?.(index);
  }

  update(nav: MenuNav) {
    if (!this.open) return;
    // The press that opened the dialog (often the interact key) must not also pick the first option.
    if (!this.armed) {
      this.armed = true;
      return;
    }
    if (nav.back) {
      this.finish(-1, false);
      return;
    }
    if (nav.confirm) {
      this.finish(this.index, true);
      return;
    }
    if (this.count === 0) return;
    if (nav.up || nav.down) {
      const next = (this.index + (nav.down ? 1 : -1) + this.count) % this.count;
      this.select(next, true);
      this.sound('uiMove');
    }
  }
}
