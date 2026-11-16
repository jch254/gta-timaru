import * as THREE from 'three';
import type { MaterialLibrary, MaterialOptions, SignOptions, SurfaceKind } from '../core/types';
import { AIR } from './air';
import { createGlazingMaterial, glazingData, glazingKey, type GlazingOptions, type GlazingStyle, patchGlazing } from './glazing';
import { SURFACES, surfaceMaps } from './textures';

type Setup = (material: THREE.Material) => void;

/** How a material folds into a shared batch when merged into chunk geometry. */
export interface BatchHint {
  base: THREE.Material;
  /** Written to vertex colours. */
  color?: THREE.Color;
  /** UV remap into an atlas cell: [u0, v0, width, height]. */
  uv?: readonly [number, number, number, number];
}

const hints = new WeakMap<THREE.Material, BatchHint>();
export const batchHint = (material: THREE.Material): BatchHint | undefined => hints.get(material);
export const setBatchHint = (material: THREE.Material, hint: BatchHint) => hints.set(material, hint);

const ATLAS = 2048;

interface AtlasPage {
  neon: boolean;
  full: boolean;
  x: number;
  y: number;
  rowH: number;
  g: CanvasRenderingContext2D;
  map: THREE.CanvasTexture;
  eg: CanvasRenderingContext2D | null;
  emissiveMap: THREE.CanvasTexture | null;
  material: THREE.MeshStandardMaterial;
}

/**
 * The one place materials are made. Caches by arguments so merged geometry batches,
 * and hands every material to the shadow system.
 */
export class Materials implements MaterialLibrary {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private all = new Set<THREE.Material>();
  private nightEmitters: { material: THREE.MeshStandardMaterial; base: number }[] = [];
  private wetSurfaces: { material: THREE.MeshStandardMaterial; roughness: number; color: THREE.Color; env: number }[] = [];
  private setup: Setup = () => undefined;
  private teardown: Setup = () => undefined;
  private night = 0;
  private wetness = -1;
  private wetCount = 0;
  private patches = new Map<THREE.Material, { key: string; patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void }>();
  /** Which parts of the air (see air.ts) this quality level pays for. */
  private air = { sun: true, clouds: true };

  constructor(private anisotropy: number) {}

  /**
   * Choose how much of the air effect materials compile in: `sun` lights the haze up towards the sun,
   * `clouds` lets cloud shadows cross the ground. Takes effect at the next `setShadowSetup`.
   */
  setAir(sun: boolean, clouds: boolean) {
    this.air = { sun, clouds };
  }

  /** Called by the renderer whenever the shadow system is (re)built. */
  setShadowSetup(setup: Setup) {
    this.setup = setup;
    for (const m of this.all) {
      this.apply(m);
      m.needsUpdate = true;
    }
  }

  private apply(material: THREE.Material) {
    this.setup(material);
    // Every library material takes part in the haze and the cloud shadows (air.ts), and can read the
    // shared atmosphere uniforms.
    const defines = (material.defines ??= {});
    defines.USE_AIR = '';
    if (this.air.sun) defines.AIR_SUN = '';
    else delete defines.AIR_SUN;
    if (this.air.clouds) defines.AIR_CLOUDS = '';
    else delete defines.AIR_CLOUDS;
    const extra = this.patches.get(material);
    // Chain the shared uniforms, then any extra shader patch, after the shadow system's own.
    const base = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      base.call(material, shader, renderer);
      Object.assign(shader.uniforms, AIR);
      extra?.patch(shader);
    };
    if (extra) material.customProgramCacheKey = () => extra.key;
  }

  register<T extends THREE.Material>(material: T): T {
    this.all.add(material);
    this.apply(material);
    return material;
  }

  release(material: THREE.Material) {
    this.all.delete(material);
    this.patches.delete(material);
    this.teardown(material);
    material.dispose();
  }

  /** Called by the renderer so released materials also leave the shadow system's bookkeeping. */
  setShadowTeardown(teardown: Setup) {
    this.teardown = teardown;
  }

  /** Register a material with an additional shader patch (render/ internal). */
  registerPatched<T extends THREE.Material>(material: T, key: string, patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void): T {
    this.patches.set(material, { key, patch });
    return this.register(material);
  }

  get(surface: SurfaceKind, options: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const key = `${surface}|${JSON.stringify(options)}`;
    let m = this.cache.get(key);
    if (m) return m;
    const def = SURFACES[surface];
    const maps = surfaceMaps(surface, this.anisotropy);
    // With a photographic map in place, colours and roughness asked for by callers were chosen against
    // the procedural surface: apply them relative to what that surface was designed around.
    let color: THREE.ColorRepresentation = options.color ?? def.color;
    if (options.color !== undefined && def.designColor !== undefined) {
      const want = new THREE.Color(options.color);
      const base = new THREE.Color(def.designColor);
      color = new THREE.Color(Math.min(1.5, want.r / Math.max(0.05, base.r)), Math.min(1.5, want.g / Math.max(0.05, base.g)), Math.min(1.5, want.b / Math.max(0.05, base.b)));
    }
    let roughness = options.roughness ?? def.roughness;
    if (options.roughness !== undefined && def.designRoughness !== undefined) roughness = Math.min(1.3, Math.max(0.35, options.roughness / def.designRoughness));
    m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: options.metalness ?? def.metalness,
      map: maps?.map ?? null,
      normalMap: maps?.normalMap ?? null,
      roughnessMap: maps?.roughnessMap ?? null,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 1,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      vertexColors: options.vertexColors ?? false,
    });
    if (surface === 'glass') m.envMapIntensity = 1.4;
    // Variants that differ only by colour (per roughness / metalness) share one vertex-coloured batch
    // when merged into chunk geometry.
    const special = Object.keys(options).some((k) => k !== 'color' && k !== 'roughness' && k !== 'metalness');
    if (!special) hints.set(m, { base: this.batchBase(surface, m.roughness, m.metalness), color: m.color.clone() });
    if (surface === 'asphalt' || surface === 'footpath' || surface === 'concrete') {
      this.wetSurfaces.push({ material: m, roughness: m.roughness, color: m.color.clone(), env: m.envMapIntensity });
    }
    this.cache.set(key, m);
    return this.register(m);
  }

  /** White, vertex-coloured version of a surface that all its colour variants merge into. */
  private batchBase(surface: SurfaceKind, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const key = `batch|${surface}|${roughness}|${metalness}`;
    let m = this.cache.get(key);
    if (m) return m;
    const maps = surfaceMaps(surface, this.anisotropy);
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, map: maps?.map ?? null, normalMap: maps?.normalMap ?? null, roughnessMap: maps?.roughnessMap ?? null, vertexColors: true });
    if (surface === 'glass') m.envMapIntensity = 1.4;
    if (surface === 'asphalt' || surface === 'footpath' || surface === 'concrete') this.wetSurfaces.push({ material: m, roughness: m.roughness, color: m.color.clone(), env: m.envMapIntensity });
    this.cache.set(key, m);
    return this.register(m);
  }

  /**
   * A pane of the shared facade-detail material (see glazing.ts): every window, door, shopfront and roller
   * door in a chunk folds into one draw call. `windows('house' | 'shop' | 'office')` with no options is the
   * original interface and still works on any quad; with options the pane is described exactly.
   */
  windows(kind: 'house' | 'shop' | 'office' | GlazingStyle = 'house', options?: GlazingOptions): THREE.MeshStandardMaterial {
    const legacy = options === undefined;
    const style: GlazingStyle = kind === 'house' ? 'casement' : kind;
    // Old-style quads carry no size (the shader measures them), except office grids, whose UVs are in metres.
    const spec: GlazingOptions = options ?? (kind === 'office' ? { w: 2.5, h: 3.2, lit: 2, color: 0xb7b3a8 } : kind === 'shop' ? { w: 0, h: 0, lit: 3, variant: 1, color: 0x8a8d90 } : { w: 0, h: 0, lit: 2 });
    const key = legacy ? `windows|${kind}` : glazingKey(style, spec);
    let m = this.cache.get(key);
    if (m) return m;
    let base = this.cache.get('glazing');
    if (!base) {
      base = this.registerPatched(createGlazingMaterial(), 'glazing-2', patchGlazing);
      this.nightEmitters.push({ material: base, base: 1 });
      this.cache.set('glazing', base);
    }
    if (legacy) {
      // A real material, in case a caller puts it on a mesh of its own rather than through a ChunkBuilder.
      m = this.register(new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.08, metalness: 0.4 }));
      hints.set(m, { base, color: glazingData(style, spec), uv: kind === 'office' ? [0, 0, 1 / 2.5, 1 / 3.2] : undefined });
    } else {
      // Only ever used as a key for merging into the base: a bare handle, not a material of its own.
      m = { isMaterial: true, type: 'GlazingPane' } as unknown as THREE.MeshStandardMaterial;
      hints.set(m, { base, color: glazingData(style, spec) });
    }
    this.cache.set(key, m);
    return m;
  }

  emitter(color: number, mode: 'always' | 'night'): THREE.MeshStandardMaterial {
    const key = `emitter|${color}|${mode}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: mode === 'always' ? 3 : 0, roughness: 0.4 });
    if (mode === 'night') this.nightEmitters.push({ material: m, base: 5 });
    this.cache.set(key, m);
    return this.register(m);
  }

  sign(text: string, options: SignOptions = {}): THREE.MeshStandardMaterial {
    const key = `sign|${text}|${JSON.stringify(options)}`;
    let m = this.cache.get(key);
    if (m) return m;
    const aspect = options.aspect ?? 4;
    const style = options.style ?? 'paint';
    const neon = style === 'neon';
    const bg = options.bg ?? '#f2ead6';
    const fg = options.fg ?? '#1d2a44';
    const fonts = {
      paint: 'bold {s}px Georgia, "Times New Roman", serif',
      block: '900 {s}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
      script: 'italic bold {s}px "Brush Script MT", "Snell Roundhand", cursive',
      neon: 'bold {s}px "Trebuchet MS", Verdana, sans-serif',
    };
    // All signs share atlas pages so a whole street of shop signs is one draw call.
    const h = 64;
    const w = Math.min(ATLAS - 4, Math.round(h * aspect));
    const cell = this.allocate(neon, w, h);
    const draw = (g: CanvasRenderingContext2D, emissive: boolean) => {
      g.save();
      g.translate(cell.x, cell.y);
      g.fillStyle = emissive ? '#000' : bg;
      g.fillRect(0, 0, w, h);
      if (options.border !== false && !emissive) {
        g.strokeStyle = fg;
        g.lineWidth = 3;
        g.strokeRect(3.5, 3.5, w - 7, h - 7);
      }
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lines = text.split('\n');
      let size = (h * 0.62) / lines.length;
      const font = (px: number) => fonts[style].replace('{s}', String(px));
      g.font = font(size);
      const widest = () => Math.max(...lines.map((l) => g.measureText(l).width));
      while (widest() > w - 18 && size > 7) {
        size -= 1;
        g.font = font(size);
      }
      lines.forEach((line, i) => g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05 + 1));
      g.restore();
    };
    draw(cell.page.g, false);
    cell.page.map.needsUpdate = true;
    if (cell.page.eg && cell.page.emissiveMap) {
      draw(cell.page.eg, true);
      cell.page.emissiveMap.needsUpdate = true;
    }
    // Standalone material: a view onto the atlas cell (shares the GPU texture).
    const rect = [cell.x / ATLAS, 1 - (cell.y + h) / ATLAS, w / ATLAS, h / ATLAS] as const;
    const view = (tex: THREE.Texture) => {
      const t = tex.clone();
      t.offset.set(rect[0], rect[1]);
      t.repeat.set(rect[2], rect[3]);
      t.needsUpdate = true;
      return t;
    };
    m = new THREE.MeshStandardMaterial({ map: view(cell.page.map), roughness: 0.75, metalness: 0 });
    if (neon && cell.page.emissiveMap) {
      m.emissiveMap = view(cell.page.emissiveMap);
      m.emissive.set(0xffffff);
      m.emissiveIntensity = 0;
      this.nightEmitters.push({ material: m, base: 3.5 });
    }
    hints.set(m, { base: cell.page.material, uv: rect });
    this.cache.set(key, m);
    return this.register(m);
  }

  private pages: AtlasPage[] = [];

  private allocate(neon: boolean, w: number, h: number): { page: AtlasPage; x: number; y: number } {
    let page = this.pages.find((p) => p.neon === neon && !p.full);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!page) {
        const make = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = ATLAS;
          const g = canvas.getContext('2d')!;
          const tex = new THREE.CanvasTexture(canvas);
          tex.anisotropy = this.anisotropy;
          return { g, tex };
        };
        const colour = make();
        colour.tex.colorSpace = THREE.SRGBColorSpace;
        colour.g.fillStyle = '#888';
        colour.g.fillRect(0, 0, ATLAS, ATLAS);
        const glow = neon ? make() : null;
        const material = new THREE.MeshStandardMaterial({ map: colour.tex, roughness: 0.75, metalness: 0 });
        if (glow) {
          glow.g.fillStyle = '#000';
          glow.g.fillRect(0, 0, ATLAS, ATLAS);
          material.emissiveMap = glow.tex;
          material.emissive.set(0xffffff);
          material.emissiveIntensity = 0;
          this.nightEmitters.push({ material, base: 3.5 });
        }
        page = { neon, full: false, x: 2, y: 2, rowH: 0, g: colour.g, map: colour.tex, eg: glow?.g ?? null, emissiveMap: glow?.tex ?? null, material: this.register(material) };
        this.pages.push(page);
      }
      if (page.x + w + 2 > ATLAS) {
        page.x = 2;
        page.y += page.rowH + 2;
        page.rowH = 0;
      }
      if (page.y + h + 2 <= ATLAS) break;
      page.full = true;
      page = undefined;
    }
    const cell = { page: page!, x: page!.x, y: page!.y };
    page!.x += w + 2;
    page!.rowH = Math.max(page!.rowH, h);
    return cell;
  }

  /**
   * Make a material built elsewhere (a clone of a library surface, say) darken and shine in the rain the
   * way the library's own asphalt, footpath and concrete do. Call once, after its colour and roughness are set.
   */
  wettable<T extends THREE.MeshStandardMaterial>(material: T): T {
    if (!this.wetSurfaces.some((w) => w.material === material)) {
      this.wetSurfaces.push({ material, roughness: material.roughness, color: material.color.clone(), env: material.envMapIntensity });
    }
    return material;
  }

  private signalLamps = new Map<string, THREE.MeshStandardMaterial>();

  /** Lamp of a traffic signal (see the contract). The lamps come to life once `update` runs each frame. */
  signalLamp(axis: 'a' | 'b', aspect: 'red' | 'amber' | 'green'): THREE.MeshStandardMaterial {
    const key = axis + aspect;
    let m = this.signalLamps.get(key);
    if (!m) {
      const color = aspect === 'red' ? 0xe23424 : aspect === 'amber' ? 0xe8991c : 0x37c35c;
      m = new THREE.MeshStandardMaterial({ color: 0x15161a, emissive: color, emissiveIntensity: 0, roughness: 0.35 });
      this.signalLamps.set(key, m);
      this.register(m);
    }
    return m;
  }

  /** Per-frame: night glow and wet-road sheen. */
  update(night: number, wetness: number) {
    // Traffic signals run one town-wide cycle: axis a green while axis b holds red, amber between, and a
    // moment of all-red at each change, the way the real controllers are set.
    if (this.signalLamps.size) {
      const t = (performance.now() / 1000) % 26;
      const aGreen = t < 9;
      const aAmber = t >= 9 && t < 12;
      const bGreen = t >= 13 && t < 22;
      const bAmber = t >= 22 && t < 25;
      const set = (key: string, on: boolean) => {
        const lamp = this.signalLamps.get(key);
        if (lamp) lamp.emissiveIntensity = on ? 2.6 : 0;
      };
      set('agreen', aGreen);
      set('aamber', aAmber);
      set('ared', !aGreen && !aAmber);
      set('bgreen', bGreen);
      set('bamber', bAmber);
      set('bred', !bGreen && !bAmber);
    }
    if (Math.abs(night - this.night) > 0.01 || night === 0 || night === 1) {
      this.night = night;
      for (const e of this.nightEmitters) e.material.emissiveIntensity = e.base * night;
    }
    // Only when the weather has moved, or a new surface has joined since.
    if (Math.abs(wetness - this.wetness) > 0.004 || ((wetness === 0 || wetness === 1) && wetness !== this.wetness) || this.wetSurfaces.length !== this.wetCount) {
      this.wetness = wetness;
      this.wetCount = this.wetSurfaces.length;
      for (const w of this.wetSurfaces) {
        // Wet stone is darker, smoother, and mirrors more of the sky.
        w.material.roughness = w.roughness * (1 - wetness * 0.72);
        w.material.color.copy(w.color).multiplyScalar(1 - wetness * 0.38);
        w.material.envMapIntensity = w.env * (1 + wetness * 0.5);
      }
    }
  }
}
