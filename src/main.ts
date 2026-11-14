import './style.css';
import { SAVE_KEY, migrateStorage } from './core/storage';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const title = document.getElementById('title')!;
const status = document.getElementById('load-status')!;
const bar = document.getElementById('load-bar')!;
const buttons = document.getElementById('title-buttons')!;
const continueBtn = document.getElementById('btn-continue') as HTMLButtonElement;

migrateStorage();
let hasSave = false;
try {
  hasSave = localStorage.getItem(SAVE_KEY) !== null;
} catch {
  // Storage unavailable: new games only.
}
continueBtn.hidden = !hasSave;

async function start(load: boolean) {
  buttons.hidden = true;
  controls.hidden = true;
  status.hidden = false;
  status.textContent = 'Loading…';
  // The engine (three.js, physics, game code) is only downloaded once the player chooses to start.
  const { Game } = await import('./game/game');
  const game = await Game.start({
    canvas,
    load,
    onProgress(stage, fraction) {
      status.textContent = stage;
      bar.style.width = `${Math.round(fraction * 100)}%`;
    },
  });
  title.classList.add('gone');
  // Remove it outright once faded, so it can never linger over the game.
  setTimeout(() => title.remove(), 1200);
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('dev')) {
    const { installDevTools } = await import('./game/dev');
    installDevTools(game);
    (window as unknown as { game: unknown }).game = game;
  }
  game.ctx.input.capture();
  try {
    game.ctx.audio.unlock();
  } catch (err) {
    // Sound is optional: never let an audio failure stop the game from starting.
    console.error('Audio failed to start', err);
  }
}

const controls = document.getElementById('controls-panel')!;
document.getElementById('btn-controls')!.addEventListener('click', () => {
  controls.hidden = !controls.hidden;
});
document.getElementById('btn-new')!.addEventListener('click', () => void start(false));
continueBtn.addEventListener('click', () => void start(true));
