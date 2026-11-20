import { WEAPONS, feelOf } from '../combat/weapons';
import { TUNING } from '../player/tuning';
import { WORLD_BOUNDS } from '../world/bounds';
import { SAVE_KEY } from './storage';

type Fields = Record<string, unknown>;
export type Snapshot = Fields & { version: 2; player: Fields & { x: number; z: number } };
export type SaveSlot = { kind: 'missing' | 'unavailable' } | { kind: 'ready'; snapshot: Snapshot }
  | { kind: 'invalid'; raw: string; reason: string };

const object = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const range = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && v >= lo && v <= hi;
const whole = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => range(v, min, max) && Number.isSafeInteger(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(id => typeof id === 'string');

function validInventory(v: unknown) {
  if (!object(v) || v.v !== 1 || !Array.isArray(v.weapons)) return false;
  const ids = new Set(['fists']);
  for (const w of v.weapons) {
    if (!object(w) || typeof w.id !== 'string' || ids.has(w.id)) return false;
    const spec = WEAPONS.find(s => s.id === w.id);
    if (!spec || !whole(w.clip, 0, spec.magazine) || !whole(w.reserve, 0, feelOf(w.id).maxReserve)) return false;
    ids.add(w.id);
  }
  return typeof v.current === 'string' && ids.has(v.current);
}

/** The original v1 slot was a flat, unversioned object. Upgrade in memory only until the next successful save. */
export function decode(raw: string): Snapshot {
  const d: unknown = JSON.parse(raw);
  if (!object(d)) throw new Error('Not a save file.');
  if ('version' in d && d.version !== 1 && d.version !== 2) throw new Error('Unsupported save version.');
  const { clock, player, missions, combat, audio, police } = d;
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  if (!whole(d.savedAt) || !object(clock) || !range(clock.hour, 0, 24) || clock.hour === 24 || !whole(clock.day, 1)) throw new Error('Invalid save time.');
  if (!object(player) || !range(player.x, minX, maxX) || !range(player.z, minZ, maxZ) || !Number.isFinite(player.heading) ||
      !whole(player.money) || !range(player.health, 0, TUNING.maxHealth) || !range(player.armour, 0, 100)) throw new Error('Invalid player data.');
  if (!object(missions) || missions.v !== 1 || !strings(missions.done) || !strings(missions.pickups) ||
      typeof missions.completed !== 'boolean' || typeof missions.intro !== 'boolean') throw new Error('Invalid mission data.');
  if (!validInventory(combat)) throw new Error('Invalid inventory.');
  if (!object(audio) || !(audio.station === null || typeof audio.station === 'string')) throw new Error('Invalid radio data.');
  if (!object(police) || police.level !== 0) throw new Error('Invalid police data.');
  return { ...d, version: 2, player: { ...player, x: player.x, z: player.z } };
}

export function readSlot(): SaveSlot {
  let raw: string | null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return { kind: 'unavailable' }; }
  if (raw === null) return { kind: 'missing' };
  try { return { kind: 'ready', snapshot: decode(raw) }; } catch (err) {
    return { kind: 'invalid', raw, reason: err instanceof SyntaxError ? 'Unreadable save file.' : String(err instanceof Error ? err.message : err) };
  }
}

/** Only called after explicit consent. Never replace an earlier recovery copy or clear on quota failure. */
export function archiveInvalid(slot: Extract<SaveSlot, { kind: 'invalid' }>): boolean {
  try {
    if (localStorage.getItem(SAVE_KEY) !== slot.raw) return false;
    let i = 1;
    while (localStorage.getItem(`${SAVE_KEY}.recovery.${i}`) !== null) i++;
    localStorage.setItem(`${SAVE_KEY}.recovery.${i}`, slot.raw);
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch { return false; }
}
