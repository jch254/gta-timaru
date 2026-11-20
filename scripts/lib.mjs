// What every puppeteer script here shares: one Chrome path, dev-server address, phone UA,
// settings key and --flag parser. Launch flags beyond GPU_ARGS vary per script on purpose.

export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Where `pnpm dev` serves (vite.config.ts pins the port). */
export const DEV_URL = 'http://localhost:5195/';

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

/** Must match SETTINGS_KEY in src/core/storage.ts (plain node cannot import the TS). */
export const SETTINGS_KEY = '03-quest.settings.v2';

/** Hardware rendering in headless Chrome; each script appends its own flags after these. */
export const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

/** The title screen's start-in posts, shown after New game (src/main.ts). */
export const TOWN_BUTTONS = { timaru: '#btn-start-timaru', christchurch: '#btn-start-chch' };

/**
 * Presses New game on the title screen, then the town to start in ('timaru' unless told otherwise; 'chch'
 * also means Christchurch). `tap` uses a touch tap instead of a click.
 */
export async function newGame(page, { town = 'timaru', tap = false } = {}) {
  const press = (selector) => (tap ? page.tap(selector) : page.click(selector));
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  await press('#btn-new');
  const button = TOWN_BUTTONS[town === 'chch' ? 'christchurch' : town] ?? TOWN_BUTTONS.timaru;
  await page.waitForSelector(button + ':not([hidden])', { timeout: 5000 });
  await press(button);
}

/** `--flag value` and bare `--flag` pairs from argv. */
export function parseArgs(argv = process.argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i];
  }
  return args;
}
