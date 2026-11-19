import './touch.css';
import { BUTTON_IDS, type ButtonId } from './controls';
import type { RouterView } from './router';
import type { StickState } from './stick';

/** What each button says. One short word; the pause button draws its two bars in CSS. */
const WORDS: Record<ButtonId, string> = {
  interact: 'USE',
  jump: 'JUMP',
  fire: 'PUNCH',
  aim: 'AIM',
  reload: 'RELOAD',
  nextWeapon: 'WEAPON',
  gas: 'GO',
  brake: 'BRAKE',
  handbrake: 'HAND\nBRAKE',
  horn: 'HORN',
  radio: 'RADIO',
  lookBack: 'BEHIND',
  pause: '',
  map: 'MAP',
  camera: 'VIEW',
  skip: 'SKIP ››',
  back: '‹ BACK',
};

const NAMES: Partial<Record<ButtonId, string>> = { pause: 'Pause', camera: 'Camera distance', lookBack: 'Look behind', nextWeapon: 'Next weapon', gas: 'Accelerate', brake: 'Brake and reverse' };

function el(cls: string, parent: HTMLElement, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = cls;
  if (text) node.textContent = text;
  parent.appendChild(node);
  return node;
}

/** The controller's DOM: buttons, the floating stick and the "turn your phone" card. It only draws. */
export class Overlay implements RouterView {
  readonly root: HTMLDivElement;

  private nodes = {} as Record<ButtonId, HTMLDivElement>;
  private words = { ...WORDS };
  private shown = new Set<ButtonId>();
  private hotOn = new Set<ButtonId>();
  private stickNode: HTMLDivElement;
  private knob: HTMLDivElement;
  private ghost: HTMLDivElement;
  private stickOn = false;
  private sprint = false;
  private ghostOn = true;
  private mode = '';

  constructor(parent: HTMLElement = document.body) {
    const root = (this.root = el('q03-touch', parent));
    el('q03-pad', root);
    this.ghost = el('q03-ghost q03-show', root);
    this.stickNode = el('q03-stick', root);
    this.knob = el('q03-knob', this.stickNode);
    for (const id of BUTTON_IDS) {
      const node = el(`q03-btn q03-b-${id}`, root, WORDS[id]);
      node.dataset.th = id;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', NAMES[id] ?? WORDS[id].replace(/[^A-Za-z ]+/g, ' ').trim());
      this.nodes[id] = node;
    }
    const turn = el('q03-turn', root);
    el('q03-turn-phone', turn);
    el('q03-turn-title', turn, 'Turn your phone sideways');
    el('q03-turn-text', turn, '03 Quest is played in landscape. The game is on hold until you do.');
  }

  // ───────────── RouterView ─────────────

  width(): number {
    return window.innerWidth;
  }

  height(): number {
    return window.innerHeight;
  }

  pedalAt(x: number, y: number): 'gas' | 'brake' | null {
    for (const id of ['gas', 'brake'] as const) {
      if (!this.shown.has(id)) continue;
      const r = this.nodes[id].getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return id;
    }
    return null;
  }

  stick(on: boolean, baseX: number, baseY: number, state: StickState) {
    if (on !== this.stickOn) {
      this.stickOn = on;
      this.stickNode.classList.toggle('q03-show', on);
      // The hint has done its job once the stick has been found.
      if (on && this.ghostOn) {
        this.ghostOn = false;
        this.ghost.classList.remove('q03-show');
      }
    }
    if (!on) return;
    this.stickNode.style.transform = `translate(${baseX.toFixed(1)}px, ${baseY.toFixed(1)}px)`;
    this.knob.style.transform = `translate(${state.knobX.toFixed(1)}px, ${state.knobY.toFixed(1)}px)`;
    if (state.sprint !== this.sprint) {
      this.sprint = state.sprint;
      this.stickNode.classList.toggle('q03-sprint', state.sprint);
    }
  }

  button(id: ButtonId, down: boolean) {
    this.nodes[id].classList.toggle('q03-down', down);
  }

  // ───────────── For the system ─────────────

  /** The button a touch landed on, if it is one that is showing. */
  buttonOf(target: EventTarget | null): ButtonId | null {
    const node = target instanceof Element ? target.closest<HTMLElement>('[data-th]') : null;
    const id = node?.dataset.th as ButtonId | undefined;
    return id && this.shown.has(id) ? id : null;
  }

  /**
   * `on`: the controller is in use. `play`: free space takes touches (stick and look). `portrait`: show the
   * card instead. `car`: the driving layout.
   */
  setMode(on: boolean, play: boolean, portrait: boolean, car: boolean) {
    const mode = `${on ? ' q03-on' : ''}${play ? ' q03-play' : ''}${portrait ? ' q03-portrait' : ''}${car ? ' q03-car' : ''}`;
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.className = `q03-touch${mode}`;
    // For the HUD's stylesheet: it can move its own pieces out from under the controller.
    document.documentElement.classList.toggle('q03-touch-on', on && !portrait);
  }

  /** Show exactly these buttons. Returns the set now showing. */
  show(ids: readonly ButtonId[]): ReadonlySet<ButtonId> {
    for (const id of this.shown) {
      if (ids.includes(id)) continue;
      this.shown.delete(id);
      this.nodes[id].classList.remove('q03-show', 'q03-down');
    }
    for (const id of ids) {
      if (this.shown.has(id)) continue;
      this.shown.add(id);
      this.nodes[id].classList.add('q03-show');
    }
    return this.shown;
  }

  /** Change the word on a button. */
  word(id: ButtonId, text: string) {
    if (this.words[id] === text) return;
    this.words[id] = text;
    this.nodes[id].textContent = text;
  }

  /** Ring a button to say it will do something right now. */
  hot(id: ButtonId, on: boolean) {
    if (this.hotOn.has(id) === on) return;
    if (on) this.hotOn.add(id);
    else this.hotOn.delete(id);
    this.nodes[id].classList.toggle('q03-hot', on);
  }
}
