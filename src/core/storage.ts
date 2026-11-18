export const SAVE_KEY = 'the-03.save.v1';
export const SETTINGS_KEY = 'the-03.settings.v2';

/** Keys from when the game was called Timmaz Hard, and Nor'west Arch before that. Newest first: the loop copies the first key it finds into the new name and removes the rest. */
const RENAMED: [from: string, to: string][] = [
  ['timmaz-hard.save.v1', SAVE_KEY],
  ['timmaz-hard.settings.v2', SETTINGS_KEY],
  ['norwest-arch.save.v1', SAVE_KEY],
  ['norwest-arch.settings.v2', SETTINGS_KEY],
];

/** Moves an old save and settings to the current keys. Run before anything reads them. */
export function migrateStorage() {
  try {
    for (const [from, to] of RENAMED) {
      const old = localStorage.getItem(from);
      if (old === null) continue;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, old);
      localStorage.removeItem(from);
    }
  } catch {
    // Storage unavailable or full: the old data stays where it is.
  }
}
