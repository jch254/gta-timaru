import * as THREE from 'three';
import type { HumanoidLook, MaterialLibrary } from '../../core/types';
import type { BodyTemplate } from './assets';

/**
 * Turns a HumanoidLook into what one figure draws: which index ranges of the shared body (sleeve and
 * trouser length, hairstyle) and four materials (skin, top, legs, and a small painted atlas for hair,
 * shoes, socks and eyes). Everything is cached by value, so identical looks share GPU resources.
 */

export type Sleeves = 'none' | 'short' | 'long';
type TopStyle = NonNullable<HumanoidLook['topStyle']>;

const HI_VIS = 0xe6ee2c;
const SOCKS = 0xe6e2d8;
const EYES = [0x4a2c14, 0x4a2c14, 0x5c3a1c, 0x3a2410, 0x6a5a2c, 0x3e6a8a, 0x4a7a5a, 0x6a7a86];

// ───────────────────────────── shared textures ─────────────────────────────

function dataTexture(size: [number, number], fill: (x: number, y: number, out: Uint8Array, i: number) => void, color: boolean): THREE.DataTexture {
  const [w, h] = size;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fill(x, y, data, (y * w + x) * 4);
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise, a few octaves, 0..1. */
function tileNoise(size: number, seed: number): (x: number, y: number) => number {
  const rand = (ix: number, iy: number, period: number, octave: number) => {
    const a = (((ix % period) + period) % period) * 374761393 + (((iy % period) + period) % period) * 668265263 + octave * 1274126177 + seed * 2246822519;
    let h = (a ^ (a >>> 13)) * 1274126177;
    h ^= h >>> 16;
    return ((h >>> 0) % 10000) / 10000;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    let total = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      const period = 4 << o;
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const a = rand(ix, iy, period, o);
      const b = rand(ix + 1, iy, period, o);
      const c = rand(ix, iy + 1, period, o);
      const d = rand(ix + 1, iy + 1, period, o);
      total += (a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return total / norm;
  };
}

interface Fabrics {
  clothNormal: THREE.Texture;
  cloth: THREE.Texture;
  denim: THREE.Texture;
  plaid: THREE.Texture;
  hoops: THREE.Texture;
  hiVis: THREE.Texture;
}
let fabrics: Fabrics | null = null;

function getFabrics(uvMetres: number): Fabrics {
  if (fabrics) return fabrics;
  const tile = (tex: THREE.Texture, metresU: number, metresV = metresU) => {
    tex.repeat.set(uvMetres / metresU, uvMetres / metresV);
    return tex;
  };
  // Soft folds: a height field turned into a normal map.
  const N = 128;
  const height = tileNoise(N, 7);
  const clothNormal = dataTexture(
    [N, N],
    (x, y, out, i) => {
      const dx = (height(x + 1, y) - height(x - 1, y)) * 3;
      const dy = (height(x, y + 1) - height(x, y - 1)) * 3;
      const l = Math.hypot(dx, dy, 1);
      out[i] = 127.5 - (dx / l) * 127.5;
      out[i + 1] = 127.5 - (dy / l) * 127.5;
      out[i + 2] = 127.5 + (1 / l) * 127.5;
      out[i + 3] = 255;
    },
    false,
  );
  const shade = tileNoise(64, 3);
  const cloth = dataTexture(
    [64, 64],
    (x, y, out, i) => {
      const v = 226 + shade(x, y) * 29;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    },
    true,
  );
  const wear = tileNoise(64, 11);
  const denim = dataTexture(
    [64, 64],
    (x, y, out, i) => {
      // Twill lines over worn patches.
      const v = 196 + wear(x, y) * 50 + (((x + y) & 3) === 0 ? 9 : 0);
      out[i] = out[i + 1] = out[i + 2] = Math.min(255, v);
      out[i + 3] = 255;
    },
    true,
  );
  const plaid = dataTexture(
    [64, 64],
    (x, y, out, i) => {
      const a = x < 32;
      const b = y < 32;
      let v = a === b ? 58 : 168;
      if (a && b) v = 40;
      if (!a && !b) v = 78;
      if (x % 8 === 0 || y % 8 === 0) v += 16;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    },
    true,
  );
  const hoops = dataTexture(
    [4, 64],
    (_x, y, out, i) => {
      out[i] = out[i + 1] = out[i + 2] = y < 32 ? 255 : 84;
      out[i + 3] = 255;
    },
    true,
  );
  const hiVis = dataTexture(
    [4, 128],
    (_x, y, out, i) => {
      const band = y >= 56 && y < 72;
      const edge = band && (y < 58 || y >= 70);
      out[i] = band ? (edge ? 150 : 232) : 255;
      out[i + 1] = band ? (edge ? 150 : 232) : 255;
      out[i + 2] = band ? (edge ? 160 : 240) : 255;
      out[i + 3] = 255;
    },
    true,
  );
  // The reflective band sits at chest height once (period chosen so no second band lands on the shirt).
  hiVis.offset.y = 0.5 - ((1.25 / 0.54) % 1);
  fabrics = {
    clothNormal: tile(clothNormal, 0.36),
    cloth: tile(cloth, 0.18),
    denim: tile(denim, 0.18),
    plaid: tile(plaid, 0.09),
    hoops: tile(hoops, 0.54, 0.18),
    hiVis: tile(hiVis, 0.54, 0.54),
  };
  return fabrics;
}

// ───────────────────────────── per-look atlas (hair, shoes, socks, eyes) ─────────────────────────────

const ATLAS_W = 128;
const ATLAS_H = 64;
const eyeCache = new Map<number, Uint8Array>();

/** A painted eye, 64 × 64: iris in the middle of the texture where the eyeball's UVs put it. */
function eyePixels(iris: number): Uint8Array {
  let px = eyeCache.get(iris);
  if (px) return px;
  px = new Uint8Array(64 * 64 * 3);
  const [ir, ig, ib] = [(iris >> 16) & 255, (iris >> 8) & 255, iris & 255];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot(x - 31.5, y - 31.5);
      const edge = (r: number) => THREE.MathUtils.clamp(r - d + 0.5, 0, 1);
      // White of the eye, shaded towards the lids.
      const sclera = 232 - Math.min(60, Math.max(0, d - 9) * 3.2);
      let r = sclera;
      let g = sclera - 4;
      let b = sclera - 10;
      const inIris = edge(7.1);
      const ring = 1 - 0.45 * THREE.MathUtils.smoothstep(d, 4.6, 7.1);
      r += (ir * ring - r) * inIris;
      g += (ig * ring - g) * inIris;
      b += (ib * ring - b) * inIris;
      const pupil = edge(3.1);
      r += (12 - r) * pupil;
      g += (10 - g) * pupil;
      b += (10 - b) * pupil;
      const glint = THREE.MathUtils.clamp(1.5 - Math.hypot(x - 29.2, y - 29.2), 0, 1);
      r += (250 - r) * glint;
      g += (250 - g) * glint;
      b += (250 - b) * glint;
      px.set([r, g, b], (y * 64 + x) * 3);
    }
  }
  eyeCache.set(iris, px);
  return px;
}

function atlasTexture(hair: number, shoes: number, iris: number): THREE.DataTexture {
  const data = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const eye = eyePixels(iris);
  const cell = (hex: number, k = 1) => [((hex >> 16) & 255) * k, ((hex >> 8) & 255) * k, (hex & 255) * k];
  const cells = [cell(hair), cell(shoes), cell(SOCKS), cell(shoes, 0.42).map((v) => v + 14)];
  for (let y = 0; y < ATLAS_H; y++) {
    for (let x = 0; x < ATLAS_W; x++) {
      const i = (y * ATLAS_W + x) * 4;
      if (x < 64) {
        data[i] = eye[(y * 64 + x) * 3];
        data[i + 1] = eye[(y * 64 + x) * 3 + 1];
        data[i + 2] = eye[(y * 64 + x) * 3 + 2];
      } else {
        const c = cells[(x < 96 ? 0 : 1) + (y < 32 ? 0 : 2)];
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
      }
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, ATLAS_W, ATLAS_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ───────────────────────────── materials ─────────────────────────────

interface Cache {
  materials: Map<string, THREE.MeshStandardMaterial>;
}
const caches = new WeakMap<MaterialLibrary, Cache>();

function cached(library: MaterialLibrary, key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let cache = caches.get(library);
  if (!cache) caches.set(library, (cache = { materials: new Map() }));
  let material = cache.materials.get(key);
  if (!material) {
    material = library.register(make());
    material.name = key;
    cache.materials.set(key, material);
  }
  return material;
}

/** Sleeve length each top style comes with. */
export function sleevesOf(style: TopStyle): Sleeves {
  return style === 'singlet' ? 'none' : style === 'tee' ? 'short' : 'long';
}

function topMaterial(style: TopStyle, hex: number, library: MaterialLibrary, uvMetres: number): THREE.MeshStandardMaterial {
  const color = style === 'hiVis' ? HI_VIS : hex;
  const pattern = style === 'bushShirt' ? 'plaid' : style === 'jersey' ? 'hoops' : style === 'hiVis' ? 'hiVis' : style === 'jacket' ? 'jacket' : 'cloth';
  return cached(library, `chr-top|${pattern}|${color}`, () => {
    const f = getFabrics(uvMetres);
    const map = pattern === 'plaid' ? f.plaid : pattern === 'hoops' ? f.hoops : pattern === 'hiVis' ? f.hiVis : f.cloth;
    return new THREE.MeshStandardMaterial({
      color,
      map,
      normalMap: f.clothNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: pattern === 'jacket' ? 0.72 : 0.92,
      metalness: 0,
      vertexColors: true,
    });
  });
}

/** A stable choice from a look, so the same look always gets the same eyes. */
function pickEye(look: HumanoidLook): number {
  const c = new THREE.Color(look.skin);
  // Darker skin and black hair: brown eyes. Otherwise mostly brown with some blue, green and grey.
  if (c.r + c.g + c.b < 1.0) return EYES[0];
  const h = (((look.skin * 31 + look.hair) >>> 0) * 2654435761) >>> 0;
  return EYES[h % EYES.length];
}

export interface LookMaterials {
  /** Indexed by the group's materialIndex: 0 skin, 1 top, 2 legs, 3 hair / shoes / socks / eyes. */
  list: THREE.MeshStandardMaterial[];
  hat: THREE.MeshStandardMaterial;
  /** Hand the look back when its figure is disposed (frees the painted atlas once nobody uses it). */
  release(): void;
}

/** Skin, top and leg colours come from short palettes and are kept; the atlases are counted, since every hair × shoe pairing makes one. */
const atlasUsers = new Map<THREE.Material, number>();

export function lookMaterials(look: HumanoidLook, body: BodyTemplate, library: MaterialLibrary): LookMaterials {
  const sex = body.female ? 'f' : 'm';
  const skin = cached(library, `chr-skin|${sex}|${look.skin}`, () => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(look.skin).multiplyScalar(body.skinGain),
      map: body.skinMap,
      normalMap: body.skinNormal,
      roughness: 0.6,
      metalness: 0,
      vertexColors: true,
    });
  });
  const top = topMaterial(look.topStyle ?? 'tee', look.top, library, body.uvMetres);
  const legs = cached(library, `chr-legs|${look.legs}`, () => {
    const f = getFabrics(body.uvMetres);
    return new THREE.MeshStandardMaterial({ color: look.legs, map: f.denim, normalMap: f.clothNormal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.9, metalness: 0, vertexColors: true });
  });
  const iris = pickEye(look);
  const miscKey = `chr-misc|${look.hair}|${look.shoes}|${iris}`;
  const misc = cached(library, miscKey, () => {
    return new THREE.MeshStandardMaterial({ map: atlasTexture(look.hair, look.shoes, iris), roughness: 0.74, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  });
  atlasUsers.set(misc, (atlasUsers.get(misc) ?? 0) + 1);
  const hat = cached(library, 'chr-hat', () => new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, vertexColors: true }));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const users = (atlasUsers.get(misc) ?? 1) - 1;
    if (users > 0) {
      atlasUsers.set(misc, users);
      return;
    }
    atlasUsers.delete(misc);
    caches.get(library)?.materials.delete(miscKey);
    misc.map?.dispose();
    library.release(misc);
  };
  return { list: [skin, top, legs, misc], hat, release };
}

// ───────────────────────────── geometry variants ─────────────────────────────

const variants = new Map<string, THREE.BufferGeometry>();

/**
 * The shared body geometry with draw groups for one combination of sleeves, legs, hair and hat.
 * Attributes and index are the template's own (never copied, never disposed).
 */
export function bodyVariant(body: BodyTemplate, sleeves: Sleeves, shorts: boolean, hair: string | null, hairUnderHat: boolean): THREE.BufferGeometry {
  const key = `${body.female ? 'f' : 'm'}|${sleeves}|${shorts ? 1 : 0}|${hair ?? '-'}|${hairUnderHat ? 1 : 0}`;
  const hit = variants.get(key);
  if (hit) return hit;
  const src = body.geometry;
  const g = new THREE.BufferGeometry();
  g.setIndex(src.index);
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.attributes[name]);
  const p = body.parts;
  const span = (from: string, to: string, material: number) => {
    const a = p[from];
    const b = p[to];
    if (!a || !b) return;
    const count = b[0] + b[1] - a[0];
    if (count > 0) g.addGroup(a[0], count, material);
  };
  span(shorts ? 'skinLowerLegs' : 'skinHead', sleeves === 'long' ? 'skinHead' : sleeves === 'short' ? 'skinForearms' : 'skinUpperArms', 0);
  if (sleeves === 'none') span('topArmholeLips', 'topTorso', 1);
  else span('topTorso', sleeves === 'short' ? 'topShortLips' : 'topLong', 1);
  span('legsUpper', shorts ? 'legsShortsLips' : 'legsLower', 2);
  span('misc', 'misc', 3);
  if (hair) span(`hair_${hair}_low`, hairUnderHat ? `hair_${hair}_low` : `hair_${hair}_high`, 3);
  // Poses reach well outside the T-pose; one generous sphere serves every pose (set on the mesh too).
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.3);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-2.3, -1.4, -2.3), new THREE.Vector3(2.3, 3.2, 2.3));
  variants.set(key, g);
  return g;
}

/** Which hairpiece a look gets, or null for none. */
export function hairOf(look: HumanoidLook, body: BodyTemplate): string | null {
  if (look.hat === 'helmet') return null;
  const style = look.hairStyle ?? (look.female ? 'long' : 'short');
  if (style === 'bald') return null;
  return body.hairStyles.has(style) ? style : body.hairStyles.has('short') ? 'short' : null;
}
