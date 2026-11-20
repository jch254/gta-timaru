import * as THREE from 'three';
import type { SurfaceKind } from '../core/types';
import { decodeTexture, surfaceUrl } from './textureAssets';
import { installSurfaceMaps } from './textures';

/**
 * Optional photographic PBR textures (CC0, see ASSETS.md). They live in src/assets/textures with a
 * manifest.json; if that folder is empty the procedural textures are used instead.
 *
 * manifest.json: { "surfaces": { "<SurfaceKind>": { "map": "file.jpg", "normalMap": "file.jpg",
 *   "roughnessMap": "file.jpg", "tile": [metresU, metresV], "tint": "neutral" | "natural" } } }
 *  - "neutral": a pale, desaturated albedo meant to be tinted by material / vertex colour (paint, grass).
 *  - "natural": true-colour albedo; the surface's default colour becomes white.
 */
interface ManifestEntry {
  map: string;
  normalMap?: string;
  roughnessMap?: string;
  tile: [number, number];
  tint: 'neutral' | 'natural';
}

const manifests = import.meta.glob('../assets/textures/manifest.json', { import: 'default' });

/**
 * Other texture sets that must be ready before the world is built (the foliage atlas, which is not a
 * tiling surface and has its own loader in src/world/props/foliage.ts). Register at module load.
 */
const preloads: ((anisotropy: number) => Promise<unknown>)[] = [];
export function registerTexturePreload(load: (anisotropy: number) => Promise<unknown>) {
  preloads.push(load);
}

/** Loads whatever photo surfaces exist. Must finish before any surface material is created. */
export async function loadPhotoSurfaces(anisotropy: number, onProgress?: (fraction: number) => void): Promise<number> {
  const extras = preloads.map((load) => load(anisotropy).catch((err) => console.warn('A texture preload failed.', err)));
  const installed = await loadSurfaces(anisotropy, onProgress);
  await Promise.all(extras);
  return installed;
}

async function loadSurfaces(anisotropy: number, onProgress?: (fraction: number) => void): Promise<number> {
  const loadManifest = Object.values(manifests)[0];
  if (!loadManifest) return 0;
  let manifest: { surfaces?: Record<string, ManifestEntry> };
  try {
    manifest = (await loadManifest()) as typeof manifest;
  } catch {
    return 0;
  }
  const entries = Object.entries(manifest.surfaces ?? {});

  let done = 0;
  let installed = 0;
  const load = async (file: string | undefined, srgb: boolean, tile: [number, number]): Promise<THREE.Texture | null> => {
    if (!file) return null;
    const url = surfaceUrl(file);
    if (!url) return null;
    const bitmap = await decodeTexture(async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      // ImageBitmap ignores UNPACK_FLIP_Y_WEBGL: match TextureLoader's orientation at decode time.
      return createImageBitmap(await response.blob(), { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
    });
    const tex = new THREE.Texture(bitmap);
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / tile[0], 1 / tile[1]);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = anisotropy;
    return tex;
  };
  await Promise.all(
    entries.map(async ([kind, entry]) => {
      try {
        const [map, normalMap, roughnessMap] = await Promise.all([load(entry.map, true, entry.tile), load(entry.normalMap, false, entry.tile), load(entry.roughnessMap, false, entry.tile)]);
        if (map) {
          installSurfaceMaps(kind as SurfaceKind, { map, normalMap, roughnessMap }, entry.tile, entry.tint === 'natural');
          installed++;
        }
      } catch (err) {
        console.warn(`Photo texture for "${kind}" failed to load; using the procedural one.`, err);
      }
      onProgress?.(++done / entries.length);
    }),
  );
  return installed;
}
