import { SAVE_KEY as KEY } from './storage';
import { decode, readSlot, type Snapshot } from './saveFormat';
import type { SaveApi } from './types';

/** localStorage save file made of slices that modules register. */
export class Save implements SaveApi {
  private slices = new Map<string, { serialize: () => unknown; deserialize: (data: unknown) => void }>();
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
    const out: Record<string, unknown> = { version: 2, savedAt: Date.now() };
    try {
      for (const [key, slice] of this.slices) out[key] = slice.serialize();
      const raw = JSON.stringify(out, (_key, value) => {
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol' ||
            (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Non-JSON save data');
        return value;
      });
      decode(raw); // Do not commit anything that Continue would reject.
      const slot = readSlot();
      if (slot.kind === 'invalid' || slot.kind === 'unavailable') throw new Error('Existing save is not readable');
      localStorage.setItem(KEY, raw);
      return { ok: true } as const;
    } catch (err) {
      console.warn('save: could not write complete game', err);
      return { ok: false, message: 'Game not saved. Your previous save has not changed.' } as const;
    }
  }

  load(): boolean {
    const slot = readSlot();
    if (slot.kind !== 'ready') return false;
    this.apply(slot.snapshot);
    return true;
  }

  apply(snapshot: Snapshot) {
    for (const key of this.slices.keys()) {
      if (!Object.hasOwn(snapshot, key)) throw new Error(`Missing save slice: ${key}`);
    }
    for (const [key, slice] of this.slices) slice.deserialize(snapshot[key]);
  }

  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  }
}
