import './style.css';
import { archiveInvalid, readSlot } from './core/saveFormat';
import { migrateStorage } from './core/storage';
import { deviceHints, isTouchFirst } from './core/device';
import { updates } from './core/update';

// The title screen. Everything here runs before the engine is downloaded, so it stays small: the page's own
// markup and CSS paint first, the photograph fades in when it arrives, and the buttons work from the first frame.

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const title = document.getElementById('title')!;
const photo = document.getElementById('title-photo') as HTMLImageElement | null;
const buttons = document.getElementById('title-buttons')!;
const newBtn = document.getElementById('btn-new') as HTMLButtonElement;
const continueBtn = document.getElementById('btn-continue') as HTMLButtonElement;
const controlsBtn = document.getElementById('btn-controls') as HTMLButtonElement;
const ask = document.getElementById('title-ask')!;
const timaruBtn = document.getElementById('btn-start-timaru') as HTMLButtonElement;
const chchBtn = document.getElementById('btn-start-chch') as HTMLButtonElement;
const backBtn = document.getElementById('btn-back') as HTMLButtonElement;
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

/** Where a new game can begin: the place it starts at and the sign on the loading card. */
const TOWNS = {
  timaru: { place: 'timaru-spawn', sign: 'The Bay Hill, Timaru', reo: 'Te Tihi-o-Maru' },
  christchurch: { place: 'cathedral-square', sign: 'Cathedral Square, Christchurch', reo: 'Ōtautahi' },
} as const;
type Town = keyof typeof TOWNS;

// A phone or tablet (the touch controller's own test): the title shows the on-screen controls, drops the key
// hints, and asks for landscape, as the game does once it is running.
if (isTouchFirst(deviceHints())) document.documentElement.classList.add('touch-first');

migrateStorage();
const notice = document.getElementById('save-notice')!;
let slot = readSlot();
const hasFile = () => slot.kind === 'ready' || slot.kind === 'invalid';
function showSlot() {
  continueBtn.hidden = !hasFile();
  continueBtn.textContent = slot.kind === 'invalid' ? 'Download save for recovery' : 'Continue';
  notice.textContent = slot.kind === 'invalid' ? `${slot.reason} Download the original or choose New game to start fresh.`
    : slot.kind === 'unavailable' ? 'Browser storage is unavailable. Progress cannot be saved.' : '';
}
showSlot();

// The photograph never holds anything up: the gradient behind it is the first paint, and it fades in over that.
if (photo) {
  const reveal = () => title.classList.add('has-photo');
  if (photo.complete && photo.naturalWidth > 0) reveal();
  else photo.addEventListener('load', reveal, { once: true });
}

let started = false;

// A newer build deployed while this tab is open. On the title there is nothing to lose, so go and get it; once a
// game is under way the pause screen offers it instead (src/ui).
if (!import.meta.env.DEV) {
  updates.onAvailable(() => {
    if (!started) updates.reloadOnce();
  });
  updates.start();
}

async function start(load: boolean, town: Town = 'timaru') {
  if (started) return;
  slot = readSlot();
  if (load && slot.kind !== 'ready') {
    showSlot();
    if (slot.kind === 'invalid') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([slot.raw], { type: 'application/json' }));
      a.download = '03-quest-recovery.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    return;
  }
  if (!load && slot.kind === 'invalid') {
    if (!window.confirm('Keep a recovery copy in this browser and start a fresh game?')) return;
    if (!archiveInvalid(slot)) {
      notice.textContent = 'Could not keep a recovery copy. Your original save has not been replaced.';
      return;
    }
  }
  const snapshot = load && slot.kind === 'ready' ? slot.snapshot : undefined;
  started = true;
  buttons.hidden = true;
  controls.hidden = true;
  if (load) {
    document.getElementById('load-kicker')!.textContent = 'Picking up';
    document.getElementById('load-place')!.textContent = 'Where you left off';
    document.getElementById('load-reo')!.textContent = '';
  } else {
    document.getElementById('load-place')!.textContent = TOWNS[town].sign;
    document.getElementById('load-reo')!.textContent = TOWNS[town].reo;
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
      snapshot,
      spawnAt: load ? undefined : TOWNS[town].place,
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
    // A deploy since this page opened can take the old build's files away from under it. When a newer build is
    // out, that is the likely reason: load it instead of giving up.
    if ((await updates.check(true)) && updates.reloadOnce()) {
      status.textContent = 'Updating…';
      colour.textContent = 'A new version of 03 Quest is out. Fetching it now.';
      return;
    }
    // Say so on the screen as well as in the console: there is nothing else left on it to press.
    status.textContent = 'Could not start';
    colour.textContent = 'Something went wrong while loading. Reload the page to try again.';
    throw err;
  } finally {
    clearInterval(rotate);
  }
}

// ───────────── Choosing: pointer, keyboard and gamepad all move one highlighted fingerpost ─────────────

const menu = [newBtn, continueBtn, controlsBtn];
const towns = [timaruBtn, chchBtn, backBtn];
const posts = [...menu, ...towns];
const visiblePosts = () => posts.filter((b) => !b.hidden);
let choosingTown = false;

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

/** New game swaps the posts for the two towns to start in (and Back); Back swaps them home again. */
function chooseTown(show: boolean) {
  choosingTown = show;
  toggleControls(false);
  for (const b of menu) b.hidden = show || (b === continueBtn && !hasFile());
  for (const b of towns) b.hidden = !show;
  ask.hidden = !show;
  newBtn.setAttribute('aria-expanded', String(show));
  select(show ? timaruBtn : newBtn);
}

for (const b of posts) {
  b.addEventListener('pointerenter', () => select(b));
  b.addEventListener('focus', () => select(b));
}
newBtn.addEventListener('click', () => chooseTown(true));
continueBtn.addEventListener('click', () => void start(true));
controlsBtn.addEventListener('click', () => toggleControls());
timaruBtn.addEventListener('click', () => void start(false, 'timaru'));
chchBtn.addEventListener('click', () => void start(false, 'christchurch'));
backBtn.addEventListener('click', () => chooseTown(false));

const onKey = (e: KeyboardEvent) => {
  if (started) return;
  if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS') step(1);
  else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW') step(-1);
  else if (e.code === 'Escape' && !controls.hidden) toggleControls(false);
  else if ((e.code === 'Escape' || e.code === 'Backspace') && choosingTown) chooseTown(false);
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
    else if (down(0)) (visiblePosts().find((b) => b.classList.contains('sel')) ?? visiblePosts()[0]).click();
    else if (choosingTown) chooseTown(false);
    else toggleControls(false);
  }
  padHeld = any;
}
if (typeof navigator.getGamepads === 'function') requestAnimationFrame(pollPad);

// Open on Continue when there is a game to go back to.
select(hasFile() ? continueBtn : newBtn);
