import type { Humanoid, HumanoidLook, MaterialLibrary } from '../../core/types';
import { bodyTemplate, charactersReady, loadCharacters } from './assets';
import { GltfHumanoid } from './rig';

/**
 * Rigged, animated people: Quaternius's CC0 "Universal Base Characters" bodies, dressed at build time
 * (scripts/assets/characters/build.mjs), moving with clips from the CC0 "Universal Animation Library".
 * See ASSETS.md. Until `preloadCharacters` has resolved true, `createGltfHumanoid` returns null and the
 * code-built figure in ../humanoid.ts is used instead.
 */

/** Load the models. Resolves false (never throws) if anything is missing, leaving the fallback in place. */
export async function preloadCharacters(_baseUrl: string, onProgress?: (fraction: number) => void): Promise<boolean> {
  try {
    return await loadCharacters(onProgress);
  } catch {
    return false;
  }
}

export function createGltfHumanoid(look: HumanoidLook, materials: MaterialLibrary): Humanoid | null {
  if (!charactersReady()) return null;
  const body = bodyTemplate(!!look.female);
  if (!body) return null;
  try {
    return new GltfHumanoid(look, materials, body);
  } catch (error) {
    console.warn('Could not build a rigged figure; using the code-built one.', error);
    return null;
  }
}
