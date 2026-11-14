/** Small DOM helpers. Everything the HUD writes goes through a cache so unchanged values never touch the DOM. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

/** Text content that is only written when it changes. */
export class TextCache {
  private last = '';
  constructor(readonly node: HTMLElement) {}
  set(value: string) {
    if (value === this.last) return;
    this.last = value;
    this.node.textContent = value;
  }
}

/** A class name that is only toggled when the flag changes. */
export class Flag {
  private state = false;
  constructor(
    private node: HTMLElement,
    private className: string,
    initial = false,
  ) {
    if (initial) this.set(true);
  }
  get on() {
    return this.state;
  }
  set(value: boolean) {
    if (value === this.state) return;
    this.state = value;
    this.node.classList.toggle(this.className, value);
  }
}

/**
 * Restarts a CSS animation without forcing a reflow: the element alternates between two class names that
 * run identical keyframes under different names.
 */
export class Retrigger {
  private flip = false;
  constructor(
    private node: HTMLElement,
    private a: string,
    private b: string,
  ) {}
  fire() {
    this.node.classList.remove(this.flip ? this.a : this.b);
    this.node.classList.add(this.flip ? this.b : this.a);
    this.flip = !this.flip;
  }
  clear() {
    this.node.classList.remove(this.a, this.b);
  }
}

/** Device pixel ratio capped so canvases stay cheap on very dense displays. */
export function pixelRatio(cap = 2): number {
  return Math.min(cap, Math.max(1, window.devicePixelRatio || 1));
}

/** A row of keycaps followed by a description, e.g. for footers: [["Esc"], "Back"]. */
export function hint(parent: HTMLElement, keys: string[], text: string): HTMLElement {
  const wrap = el('span', 'nw-hint', parent);
  for (const key of keys) el('kbd', 'nw-cap', wrap, key);
  el('span', 'nw-hint-text', wrap, text);
  return wrap;
}
