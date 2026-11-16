import './style.css';
import { SAVE_KEY, migrateStorage } from './core/storage';
import { deviceHints, isTouchFirst } from './touch/device';

// The title screen. Everything here runs before the engine is downloaded, so it stays small: the page's own
// markup and CSS paint first, the photograph fades in when it arrives, and the buttons work from the first frame.

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const title = document.getElementById('title')!;
const photo = document.getElementById('title-photo') as HTMLImageElement | null;
const buttons = document.getElementById('title-buttons')!;
const newBtn = document.getElementById('btn-new') as HTMLButtonElement;
const continueBtn = document.getElementById('btn-continue') as HTMLButtonElement;
const controlsBtn = document.getElementById('btn-controls') as HTMLButtonElement;
const controls = document.getElementById('controls-panel')!;
const loading = document.getElementById('loading')!;
const status = document.getElementById('load-status')!;
const percent = document.getElementById('load-pct')!;
const track = document.getElementById('load-track')!;
const bar = document.getElementById('load-bar')!;
const colour = document.getElementById('load-colour')!;

/** A line of 1995 under the progress bar; a new one every few seconds. */
const COLOUR = [
  'Keep left. The steering wheel is on the right.',
  'A nor’wester by lunchtime: warm, dry, and bad for tempers.',
  'Fish and chips come wrapped in newsprint. Vinegar is on the counter.',
  'Phone boxes take cards now. Keep some coins anyway.',
  'State Highway 1 is one lane each way. So is the Rakaia bridge, for over a mile.',
  'Nobody has a cellphone. If you are late, you are just late.',
  'Friday is late night in town.',
  'A southerly change means a jersey, even in February.',
  'The Alps are out. It will blow from the north-west before tea.',
  'Petrol is under a dollar a litre. Enjoy it.',
];
const COLOUR_SECONDS = 5;

// A phone or tablet (the touch controller's own test): the title shows the on-screen controls, drops the key
// hints, and asks for landscape, as the game does once it is running.
if (isTouchFirst(deviceHints())) document.documentElement.classList.add('touch-first');

migrateStorage();
let hasSave = false;
try {
  hasSave = localStorage.getItem(SAVE_KEY) !== null;
} catch {
  // Storage unavailable: new games only.
}
continueBtn.hidden = !hasSave;

// The photograph never holds anything up: the gradient behind it is the first paint, and it fades in over that.
if (photo) {
  const reveal = () => title.classList.add('has-photo');
  if (photo.complete && photo.naturalWidth > 0) reveal();
  else photo.addEventListener('load', reveal, { once: true });
}

let started = false;

async function start(load: boolean) {
  if (started) return;
  started = true;
  buttons.hidden = true;
  controls.hidden = true;
  if (load) {
    // A saved game opens wherever it was left, which is not known until the world is up.
    document.getElementById('load-kicker')!.textContent = 'Picking up';
    document.getElementById('load-place')!.textContent = 'Where you left off';
    document.getElementById('load-reo')!.textContent = '';
  }
  let line = Math.floor(Math.random() * COLOUR.length);
  colour.textContent = load ? COLOUR[line] : 'Half past nine on a Friday morning, and the whole weekend still to ruin.';
  const rotate = setInterval(() => {
    line = (line + 1) % COLOUR.length;
    colour.textContent = COLOUR[line];
  }, COLOUR_SECONDS * 1000);
  loading.hidden = false;
  status.textContent = 'Loading…';
  try {
    // The engine (three.js, physics, game code) is only downloaded once the player chooses to start.
    const { Game } = await import('./game/game');
    const game = await Game.start({
      canvas,
      load,
      onProgress(stage, fraction) {
        const whole = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
        status.textContent = stage;
        percent.textContent = `${whole}%`;
        bar.style.width = `${whole}%`;
        track.setAttribute('aria-valuenow', String(whole));
      },
    });
    title.classList.add('gone');
    // Remove it outright once faded, so it can never linger over the game.
    setTimeout(() => title.remove(), 1200);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('dev')) {
      try {
        const { installDevTools } = await import('./game/dev');
        installDevTools(game);
        (window as unknown as { game: unknown }).game = game;
      } catch (err) {
        // Dev tools are optional and the game is already running: never show "Could not start" over it.
        console.error('Dev tools failed to load', err);
      }
    }
    game.ctx.input.capture();
    try {
      game.ctx.audio.unlock();
    } catch (err) {
      // Sound is optional: never let an audio failure stop the game from starting.
      console.error('Audio failed to start', err);
    }
  } catch (err) {
    // Say so on the screen as well as in the console: there is nothing else left on it to press.
    status.textContent = 'Could not start';
    colour.textContent = 'Something went wrong while loading. Reload the page to try again.';
    throw err;
  } finally {
    clearInterval(rotate);
  }
}

// ───────────── Choosing: pointer, keyboard and gamepad all move one highlighted fingerpost ─────────────

const posts = [newBtn, continueBtn, controlsBtn];
const visiblePosts = () => posts.filter((b) => !b.hidden);

/** Highlights a post and gives it keyboard focus, so Enter and Space press it. */
function select(button: HTMLButtonElement) {
  for (const b of posts) b.classList.toggle('sel', b === button);
  if (document.activeElement !== button) button.focus({ preventScroll: true });
}

function step(delta: number) {
  const list = visiblePosts();
  const at = Math.max(0, list.findIndex((b) => b.classList.contains('sel')));
  select(list[(at + delta + list.length) % list.length]);
}

function toggleControls(show = controls.hidden) {
  controls.hidden = !show;
  controlsBtn.setAttribute('aria-expanded', String(show));
}

for (const b of posts) {
  b.addEventListener('pointerenter', () => select(b));
  b.addEventListener('focus', () => select(b));
}
newBtn.addEventListener('click', () => void start(false));
continueBtn.addEventListener('click', () => void start(true));
controlsBtn.addEventListener('click', () => toggleControls());

const onKey = (e: KeyboardEvent) => {
  if (started) return;
  if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS') step(1);
  else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW') step(-1);
  else if (e.code === 'Escape' && !controls.hidden) toggleControls(false);
  else return;
  e.preventDefault();
};
window.addEventListener('keydown', onKey);

// Gamepad: D-pad or left stick to choose, A to select, B to put the controls sheet away. Polled only while the
// title is up; the game's own input takes over once it starts.
let padHeld = true; // whatever is held as the page opens is ignored until released
function pollPad() {
  if (started) return;
  requestAnimationFrame(pollPad);
  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (!pad) return;
  const down = (i: number) => !!pad.buttons[i]?.pressed;
  const axis = pad.axes[1] ?? 0;
  const move = down(13) || axis > 0.6 ? 1 : down(12) || axis < -0.6 ? -1 : 0;
  const any = move !== 0 || down(0) || down(1);
  if (any && !padHeld) {
    if (move) step(move);
    else if (down(0)) (visiblePosts().find((b) => b.classList.contains('sel')) ?? newBtn).click();
    else toggleControls(false);
  }
  padHeld = any;
}
if (typeof navigator.getGamepads === 'function') requestAnimationFrame(pollPad);

// Open on Continue when there is a game to go back to.
select(hasSave ? continueBtn : newBtn);
