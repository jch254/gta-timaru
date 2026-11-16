import { SAVE_KEY as KEY } from './storage';
import type { SaveApi } from './types';

/** localStorage save file made of slices that modules register. */
export class Save implements SaveApi {
  private slices = new Map<string, { serialize: () => unknown; deserialize: (data: unknown) => void }>();
  /** Slices skipped by the last load() because they threw; the rest of the save was still applied. */
  readonly loadProblems: string[] = [];

  register(key: string, serialize: () => unknown, deserialize: (data: unknown) => void) {
    this.slices.set(key, { serialize, deserialize });
  }

  exists(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  }

  save() {
    const out: Record<string, unknown> = { savedAt: Date.now() };
    for (const [key, slice] of this.slices) {
      try {
        out[key] = slice.serialize();
      } catch (err) {
        console.warn(`save: slice "${key}" failed to serialize`, err);
      }
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch (err) {
      console.warn('save: could not write localStorage', err);
    }
  }

  load(): boolean {
    this.loadProblems.length = 0;
    let data: Record<string, unknown>;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const parsed: unknown = JSON.parse(raw);
      // Valid JSON that is not an object (a truncated or hand-edited file) is no save at all.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
      data = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
    for (const [key, slice] of this.slices) {
      if (!(key in data)) continue;
      try {
        slice.deserialize(data[key]);
      } catch (err) {
        console.warn(`save: slice "${key}" failed to load`, err);
        this.loadProblems.push(key);
      }
    }
    return true;
  }

  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  }
}
