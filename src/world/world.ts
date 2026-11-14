import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../core/math';
import { fbm, hash2 } from '../core/rng';
import { CollisionGroup, type District, type GameContext, type GfxApi, type GroundSurface, type LandmarkPlacement, type Lot, type PhysicsApi, type Place, type RailLine, type RoadGraph, type System, type WorldApi } from '../core/types';
import { Breakables, type Breakable } from './breakables';
import { buildLot } from './buildings';
import { ChunkBuilderImpl, type ChunkLight, type ColliderBox } from './chunkbuilder';
import { Ground, GroundAttributes } from './ground';
import { SEA_LEVEL, WORLD_BOUNDS, type TerrainModel } from './height';
import { LANDMARKS } from './landmarks';
import { CHUNK, chunkKey, chunkOf, generateLots } from './lots';
import { compileMap, type CompiledMap, type RailPath } from './map';
import { buildMap } from './mapdata';
import { getProp } from './props';
import './props/extra';
import { PROP_PHYSICS } from './props/physics';
import { foliageWind } from './props/vegetation';
import { buildChunkLines, buildChunkRoads, createRoadMaterials, type RoadMaterials } from './roadmesh';
import { SCATTERERS } from './scatter';

const N = 64; // cells per chunk side (4 m)
const CELL = CHUNK / N;
const FAR_CELL = 64;
const FAR = { minX: -5120, maxX: 3584, minZ: -8192, maxZ: 8192 };

interface Chunk {
  key: number;
  cx: number;
  cz: number;
  /** (N+1)² heights, row-major by z. */
  heights: Float32Array | null;
  group: THREE.Group;
  colliders: RAPIER.Collider[];
  lights: ChunkLight[];
  ready: boolean;
  disposables: { dispose(): void }[];
  /** Full-resolution and half-resolution ground (shared vertex buffers). */
  ground: [THREE.Mesh, THREE.Mesh] | null;
}

/** The streamed world: terrain, roads, buildings, water. Implements the WorldApi queries. */
export class World implements WorldApi, System {
  readonly name = 'world';
  bounds = WORLD_BOUNDS;
  seaLevel = SEA_LEVEL;
  graph: RoadGraph;
  places: Place[];
  landmarks: LandmarkPlacement[];
  railways: RailLine[];

  private map: CompiledMap;
  private terrain: TerrainModel;
  private lots: Map<number, Lot[]>;
  private edgesByChunk = new Map<number, number[]>();
  private railsByChunk = new Map<number, RailPath[]>();
  private landmarksByChunk = new Map<number, LandmarkPlacement[]>();
  private chunks = new Map<number, Chunk>();
  private queue: { chunk: Chunk; job: Generator<void> }[] = [];
  private foci: { x: number; z: number; radius: number }[] = [];
  private focus = { x: 0, z: 0 };
  private roadMats: RoadMaterials;
  /** Ground colouring, terrain materials and water (see ground.ts). */
  private ground: Ground;
  private root = new THREE.Group();
  private time = 0;
  private breakables: Breakables;
  private ctx: GameContext | null = null;

  constructor(
    scene: THREE.Scene,
    private gfx: GfxApi,
    private physics: PhysicsApi,
    /** Near chunk radius in chunks. */
    private radius: () => number,
  ) {
    this.map = compileMap(buildMap());
    this.terrain = this.map.terrain;
    this.graph = this.map.graph;
    this.places = this.map.places;
    this.landmarks = this.map.landmarks;
    this.lots = generateLots(this.map);
    this.railways = this.map.rails.map((r) => ({
      name: r.source.name,
      kind: r.source.kind,
      points: r.samples.map((p) => ({ x: p.x, y: this.terrain.height(p.x, p.z), z: p.z })),
      length: r.samples[r.samples.length - 1].s,
    }));

    for (const e of this.graph.edges) {
      const seen = new Set<number>();
      for (const s of e.samples) {
        const k = chunkKey(chunkOf(s.x), chunkOf(s.z));
        if (seen.has(k)) continue;
        seen.add(k);
        this.edgesByChunk.set(k, [...(this.edgesByChunk.get(k) ?? []), e.index]);
      }
    }
    for (const rail of this.map.rails) {
      const seen = new Set<number>();
      for (const s of rail.samples) {
        const k = chunkKey(chunkOf(s.x), chunkOf(s.z));
        if (seen.has(k)) continue;
        seen.add(k);
        this.railsByChunk.set(k, [...(this.railsByChunk.get(k) ?? []), rail]);
      }
    }
    for (const l of this.landmarks) {
      if (l.skyline) continue;
      const k = chunkKey(chunkOf(l.x), chunkOf(l.z));
      this.landmarksByChunk.set(k, [...(this.landmarksByChunk.get(k) ?? []), l]);
    }

    this.ground = new Ground(gfx, this.map);
    this.roadMats = createRoadMaterials(gfx, this.ground.shared);
    this.root.add(this.ground.sea);
    scene.add(this.root);
    this.breakables = new Breakables(this.root, physics, (b, chunk) => this.onPropBroken(b, chunk));
  }

  // ───────────── Loading ─────────────

  /** Builds the always-present distant scenery. Call once before the first frame; yields to keep the page alive. */
  async buildFar(onProgress: (fraction: number) => void) {
    const nx = (FAR.maxX - FAR.minX) / FAR_CELL + 1;
    const nz = (FAR.maxZ - FAR.minZ) / FAR_CELL + 1;
    const pos = new Float32Array(nx * nz * 3);
    const shade = new GroundAttributes(nx * nz);
    const heights = new Float32Array(nx * nz);
    let slice = performance.now();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = FAR.minX + i * FAR_CELL;
        const z = FAR.minZ + j * FAR_CELL;
        const h = this.terrain.height(x, z);
        const k = j * nx + i;
        heights[k] = h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h - 1.2;
        pos[k * 3 + 2] = z;
      }
      if (performance.now() - slice > 24) {
        onProgress(j / nz);
        await new Promise((r) => setTimeout(r));
        slice = performance.now();
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const dx = heights[j * nx + Math.min(nx - 1, i + 1)] - heights[j * nx + Math.max(0, i - 1)];
        const dz = heights[Math.min(nz - 1, j + 1) * nx + i] - heights[Math.max(0, j - 1) * nx + i];
        this.ground.shade(pos[k * 3], pos[k * 3 + 2], heights[k], dx / (2 * FAR_CELL), dz / (2 * FAR_CELL), false, shade, k);
      }
      if (performance.now() - slice > 24) {
        await new Promise((r) => setTimeout(r));
        slice = performance.now();
      }
    }
    const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        index.set([a, a + nx, a + 1, a + nx, a + nx + 1, a + 1], p);
        p += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    for (const [name, attr] of Object.entries(shade.attributes())) geo.setAttribute(name, attr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    const far = new THREE.Mesh(geo, this.ground.far);
    far.receiveShadow = false;
    far.matrixAutoUpdate = false;
    this.root.add(far);

    this.buildFarRoads();
    this.buildSkyline();
    this.buildAlps();

    // Skyline landmarks stay loaded at any distance.
    const out = new ChunkBuilderImpl(this.gfx.materials, this, 0);
    for (const l of this.landmarks) if (l.skyline) LANDMARKS[l.kind]?.(l, out);
    for (const mesh of out.finish()) this.root.add(mesh);
    this.addColliders(out.colliders);
    this.addInstances(out, this.root, []);
    this.skylineLights = out.lights;
    // The terrain's photographic layers must be in place before the first frame.
    await this.ground.ready;
    onProgress(1);
  }

  /** Coarse ribbons for main roads so SH1 and the avenues read from a distance. */
  private buildFarRoads() {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const e of this.graph.edges) {
      if (e.cls !== 'highway' && e.cls !== 'arterial' && e.cls !== 'street') continue;
      if (e.cls === 'street' && e.length < 60) continue;
      const half = e.width / 2 + 0.5;
      let prev = -1;
      for (let i = 0; i < e.samples.length; i += 4) {
        const k = Math.min(i, e.samples.length - 1);
        const s = e.samples[k];
        const base = pos.length / 3;
        pos.push(s.x + s.tz * half, s.y + 0.5, s.z - s.tx * half, s.x - s.tz * half, s.y + 0.5, s.z + s.tx * half);
        if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
        prev = base;
      }
      const last = e.samples[e.samples.length - 1];
      const base = pos.length / 3;
      pos.push(last.x + last.tz * half, last.y + 0.5, last.z - last.tx * half, last.x - last.tz * half, last.y + 0.5, last.z + last.tx * half);
      if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.setIndex(idx);
    const mat = this.gfx.farVariant(this.gfx.materials.get('plain', { color: 0x4c4d50, roughness: 0.95 }));
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
  }

  /** Simple boxes standing in for every building beyond the full-detail radius, so towns read from afar. */
  private buildSkyline() {
    const HEIGHT: Partial<Record<District['type'], [number, number]>> = { cbd: [11, 34], shops: [6, 9], township: [5, 8], villa: [4.5, 6], statehouse: [4.5, 5.5], industrial: [6, 10], port: [7, 12], rural: [4.5, 6] };
    const TINT: Partial<Record<District['type'], number>> = { cbd: 0xb9b4a8, shops: 0xb8a898, township: 0xb8ac98, villa: 0xa8a090, statehouse: 0xa89c8c, industrial: 0x9a9c9c, port: 0x8f9498, rural: 0xa8a090 };
    const REGION = 1024;
    const regions = new Map<number, Lot[]>();
    for (const lots of this.lots.values()) {
      for (const lot of lots) {
        const key = (Math.floor(lot.x / REGION) + 64) * 128 + (Math.floor(lot.z / REGION) + 64);
        regions.set(key, [...(regions.get(key) ?? []), lot]);
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = this.gfx.farVariant(this.gfx.materials.get('plain', { roughness: 0.9, color: 0xffffff, metalness: 0.02 }));
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (const lots of regions.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, lots.length);
      lots.forEach((lot, i) => {
        const range = HEIGHT[lot.district.type] ?? [4.5, 6];
        const r = ((lot.seed >>> 4) % 1000) / 1000;
        const dense = lot.district.type === 'cbd' || lot.district.type === 'shops';
        dummy.position.set(lot.x, lot.y - 0.5, lot.z);
        dummy.rotation.set(0, lot.heading, 0);
        dummy.scale.set(lot.width * (dense ? 0.96 : 0.6), range[0] + (range[1] - range[0]) * r * r, lot.depth * (dense ? 0.85 : 0.4));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, tint.set(TINT[lot.district.type] ?? 0xa8a090).multiplyScalar(0.85 + r * 0.3));
      });
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
  }

  /** Kā Tiritiri o te Moana: the Southern Alps as a hazy backdrop beyond the playable area. */
  private buildAlps() {
    const nx = 40;
    const nz = 140;
    const x0 = -15000;
    const x1 = FAR.minX + 200;
    const z0 = -16000;
    const z1 = 16000;
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = lerp(x0, x1, i / nx);
        const z = lerp(z0, z1, j / nz);
        const k = j * (nx + 1) + i;
        const inland = smooth(x1, x1 - 5500, x);
        const ridge = fbm(x * 0.00035 + 4, z * 0.00035, 5);
        const peaks = Math.pow(Math.abs(fbm(x * 0.0011, z * 0.0011 + 9, 4) * 2 - 1), 0.8);
        const h = 150 + inland * (500 + ridge * 1500 + (1 - peaks) * 900) * smooth(x0, x0 + 2500, x) ** 0.3;
        pos.set([x, h, z], k * 3);
        // Summer: snow only on the tops; bush and tussock on the lower slopes, scree above.
        const snow = smooth(1750, 2150, h + ridge * 260);
        const scree = smooth(700, 1500, h);
        col.set([lerp(lerp(0.2, 0.36, scree), 1.0, snow), lerp(lerp(0.25, 0.34, scree), 1.0, snow), lerp(lerp(0.19, 0.33, scree), 1.04, snow)], k * 3);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + nx + 1, a + nx + 2, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Lit normally but only lightly fogged, so the range stays visible on the horizon the whole way down SH1.
    const mat = this.gfx.backdropVariant(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), 0.62);
    this.alps = new THREE.Mesh(geo, mat);
    this.alps.matrixAutoUpdate = false;
    this.root.add(this.alps);
  }
  private alps: THREE.Mesh | null = null;
  private skylineLights: ChunkLight[] = [];

  /** Load everything around a point right now (start of game, respawn). */
  async loadAround(x: number, z: number, onProgress?: (fraction: number) => void) {
    this.focus = { x, z };
    this.schedule();
    const total = this.queue.length || 1;
    let slice = performance.now();
    while (this.queue.length) {
      this.runJobs(40);
      if (performance.now() - slice > 30) {
        onProgress?.(1 - this.queue.length / total);
        await new Promise((r) => setTimeout(r));
        slice = performance.now();
      }
    }
    onProgress?.(1);
  }

  setFocus(x: number, z: number) {
    this.focus.x = x;
    this.focus.z = z;
  }

  addFocus(x: number, z: number, radius: number): () => void {
    const f = { x, z, radius };
    this.foci.push(f);
    return () => {
      this.foci = this.foci.filter((o) => o !== f);
    };
  }

  async whenLoaded(x: number, z: number): Promise<void> {
    const release = this.addFocus(x, z, CHUNK * 1.5);
    while (!this.isLoaded(x, z)) await new Promise((r) => setTimeout(r, 50));
    release();
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.get(chunkKey(chunkOf(x), chunkOf(z)))?.ready ?? false;
  }

  // ───────────── Streaming ─────────────

  private wanted(): Map<number, number> {
    const want = new Map<number, number>();
    const add = (fx: number, fz: number, radius: number) => {
      const r = Math.ceil(radius / CHUNK);
      const cx = chunkOf(fx);
      const cz = chunkOf(fz);
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          const x = cx + a;
          const z = cz + b;
          if (x * CHUNK < WORLD_BOUNDS.minX || (x + 1) * CHUNK > WORLD_BOUNDS.maxX || z * CHUNK < WORLD_BOUNDS.minZ || (z + 1) * CHUNK > WORLD_BOUNDS.maxZ) continue;
          const d = Math.hypot((x + 0.5) * CHUNK - fx, (z + 0.5) * CHUNK - fz);
          if (d > radius + CHUNK * 0.71) continue;
          const k = chunkKey(x, z);
          want.set(k, Math.min(want.get(k) ?? Infinity, d));
        }
      }
    };
    add(this.focus.x, this.focus.z, this.radius() * CHUNK);
    for (const f of this.foci) add(f.x, f.z, f.radius);
    return want;
  }

  private schedule() {
    const want = this.wanted();
    for (const [key, chunk] of this.chunks) {
      if (!want.has(key)) this.unload(chunk);
    }
    for (const [key] of want) {
      if (this.chunks.has(key)) continue;
      const cz = (key % 1024) - 512;
      const cx = Math.floor(key / 1024) - 512;
      const chunk: Chunk = { key, cx, cz, heights: null, group: new THREE.Group(), colliders: [], lights: [], ready: false, disposables: [], ground: null };
      chunk.group.matrixAutoUpdate = false;
      this.chunks.set(key, chunk);
      this.queue.push({ chunk, job: this.build(chunk) });
    }
    this.queue.sort((a, b) => (want.get(a.chunk.key) ?? 1e9) - (want.get(b.chunk.key) ?? 1e9));
  }

  private unload(chunk: Chunk) {
    this.chunks.delete(chunk.key);
    this.queue = this.queue.filter((q) => q.chunk !== chunk);
    this.root.remove(chunk.group);
    for (const d of chunk.disposables) d.dispose();
    for (const c of chunk.colliders) this.physics.world.removeCollider(c, false);
    this.breakables.dropChunk(chunk.key);
  }

  private runJobs(budgetMs: number) {
    const start = performance.now();
    while (this.queue.length && performance.now() - start < budgetMs) {
      const item = this.queue[0];
      if (item.job.next().done) this.queue.shift();
    }
  }

  private scheduleTimer = 0;
  private lamps: THREE.PointLight[] = [];
  private lampTimer = 0;

  /** A fixed pool of point lights hops between the nearest authored light positions after dark. */
  private updateLamps(dt: number, night: number, count: number) {
    while (this.lamps.length < count) {
      const lamp = new THREE.PointLight(0xffd9a0, 0, 20, 1.6);
      lamp.castShadow = false;
      this.lamps.push(lamp);
      this.root.add(lamp);
    }
    this.lampTimer -= dt;
    if (this.lampTimer > 0) return;
    this.lampTimer = 0.4;
    const fx = this.focus.x;
    const fz = this.focus.z;
    const near = night > 0.25 ? this.lightsNear(fx, fz, 70).sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz)) : [];
    this.lamps.forEach((lamp, i) => {
      const source = i < count ? near[i] : undefined;
      if (!source) {
        lamp.intensity = 0;
        return;
      }
      lamp.position.set(source.x, source.y, source.z);
      lamp.color.set(source.color);
      lamp.distance = source.range;
      lamp.intensity = source.intensity * night;
    });
  }

  /** Hand over the game context once every system exists (the world itself is built before them). */
  attach(ctx: GameContext) {
    this.ctx = ctx;
    this.breakables.attach(ctx);
  }

  fixedUpdate(dt: number) {
    this.breakables.fixedUpdate(dt);
  }

  update(dt: number) {
    this.time += dt;
    this.scheduleTimer -= dt;
    if (this.scheduleTimer <= 0) {
      this.scheduleTimer = 0.25;
      this.schedule();
    }
    this.runJobs(4);

    // Far stand-ins are clipped out only where full-detail chunks are actually ready.
    let near = this.radius() * CHUNK;
    for (const q of this.queue) {
      const c = q.chunk;
      const dx = Math.max(c.cx * CHUNK - this.focus.x, 0, this.focus.x - (c.cx + 1) * CHUNK);
      const dz = Math.max(c.cz * CHUNK - this.focus.z, 0, this.focus.z - (c.cz + 1) * CHUNK);
      near = Math.min(near, Math.hypot(dx, dz));
    }
    this.gfx.setNearFade(this.focus.x, this.focus.z, Math.max(0, near - 6));

    // Ground level of detail by distance.
    for (const chunk of this.chunks.values()) {
      if (!chunk.ground) continue;
      const d = Math.hypot((chunk.cx + 0.5) * CHUNK - this.focus.x, (chunk.cz + 0.5) * CHUNK - this.focus.z);
      const near = d < CHUNK * 1.6;
      chunk.ground[0].visible = near;
      chunk.ground[1].visible = !near;
    }

    this.updateLamps(dt, this.gfx.night, this.gfx.lampCount);
    this.breakables.update(dt);
    // Leaves move with the weather: barely in fog, hard in a nor'wester.
    if (this.ctx) {
      const wind = this.ctx.env.wind;
      const speed = Math.hypot(wind.x, wind.z);
      foliageWind.strength = clamp(0.03 + speed * 0.013, 0.03, 0.26);
      if (speed > 0.1) foliageWind.direction.set(wind.x, wind.z);
    }

    this.ground.update(dt, this.focus.x, this.focus.z, Math.max(0, near - 6));
  }

  // ───────────── Chunk generation ─────────────

  private *build(chunk: Chunk): Generator<void> {
    const { cx, cz } = chunk;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const M = N + 3; // one-cell border for seamless normals
    const grid = new Float32Array(M * M);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) grid[j * M + i] = this.terrain.height(x0 + (i - 1) * CELL, z0 + (j - 1) * CELL);
      if (j % 6 === 5) yield;
    }
    const heights = new Float32Array((N + 1) * (N + 1));
    const V = (N + 1) * (N + 1);
    const pos = new Float32Array((V + (N + 1) * 4) * 3);
    const nor = new Float32Array(pos.length);
    const shade = new GroundAttributes(pos.length / 3);
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const g = (j + 1) * M + (i + 1);
        const h = grid[g];
        heights[k] = h;
        const x = x0 + i * CELL;
        const z = z0 + j * CELL;
        pos.set([x, h, z], k * 3);
        const dx = grid[g + 1] - grid[g - 1];
        const dz = grid[g + M] - grid[g - M];
        const inv = 1 / Math.hypot(dx, 2 * CELL, dz);
        nor.set([-dx * inv, 2 * CELL * inv, -dz * inv], k * 3);
        this.ground.shade(x, z, h, dx / (2 * CELL), dz / (2 * CELL), true, shade, k);
        uv.set([x, z], k * 2);
      }
      if (j % 4 === 3) yield;
    }
    chunk.heights = heights;
    yield;

    const index: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        // Same split as heightAt(): triangles (a, b, d) and (b, c, d).
        index.push(a, a + N + 1, a + 1, a + N + 1, a + N + 2, a + 1);
      }
    }
    // Skirts hide the seam against the lower-resolution far terrain.
    let v = V;
    const coarseSkirt: number[] = [];
    // `outward` is true when the triangle (top, skirt, next top) already faces out of the chunk. A skirt
    // is only ever seen from outside, so one winding does; the half-resolution ground gets a
    // half-resolution skirt.
    const edge = (cells: [number, number][], outward: boolean) => {
      const first = v;
      for (const [i, j] of cells) {
        const k = j * (N + 1) + i;
        pos.set([pos[k * 3], pos[k * 3 + 1] - 8, pos[k * 3 + 2]], v * 3);
        nor.set([nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]], v * 3);
        shade.copy(k, v);
        uv.set([uv[k * 2], uv[k * 2 + 1]], v * 2);
        v++;
      }
      for (let n = 0; n < cells.length - 1; n++) {
        const a = cells[n][1] * (N + 1) + cells[n][0];
        const b = cells[n + 1][1] * (N + 1) + cells[n + 1][0];
        const sa = first + n;
        const sb = first + n + 1;
        if (outward) index.push(a, sa, b, b, sa, sb);
        else index.push(a, b, sa, b, sb, sa);
        if (n % 2 === 0 && n + 2 < cells.length) {
          const c = cells[n + 2][1] * (N + 1) + cells[n + 2][0];
          const sc = first + n + 2;
          if (outward) coarseSkirt.push(a, sa, c, c, sa, sc);
          else coarseSkirt.push(a, c, sa, c, sc, sa);
        }
      }
    };
    const range = Array.from({ length: N + 1 }, (_, i) => i);
    edge(range.map((i) => [i, 0]), false);
    edge(range.map((i) => [i, N]), true);
    edge(range.map((j) => [0, j]), true);
    edge(range.map((j) => [N, j]), false);

    // Half-resolution index over the same vertices for distant chunks (skirts hide the cracks).
    const coarse: number[] = [];
    for (let j = 0; j < N; j += 2) {
      for (let i = 0; i < N; i += 2) {
        const a = j * (N + 1) + i;
        coarse.push(a, a + 2 * (N + 1), a + 2, a + 2 * (N + 1), a + 2 * (N + 1) + 2, a + 2);
      }
    }
    for (const k of coarseSkirt) coarse.push(k);
    const attrs = {
      position: new THREE.BufferAttribute(pos, 3),
      normal: new THREE.BufferAttribute(nor, 3),
      ...shade.attributes(),
      uv: new THREE.BufferAttribute(uv, 2),
    };
    const grounds = [index, coarse].map((idx, level) => {
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(attrs)) geo.setAttribute(name, attr);
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const ground = new THREE.Mesh(geo, this.ground.terrain);
      ground.receiveShadow = true;
      ground.matrixAutoUpdate = false;
      ground.visible = level === 0;
      chunk.group.add(ground);
      chunk.disposables.push(geo);
      return ground;
    });
    chunk.ground = [grounds[0], grounds[1]];
    yield;

    // Sea and river surface over this chunk: each level of detail rides with the matching ground mesh.
    const water = this.ground.buildWater(x0, z0, heights, N, CELL);
    water?.forEach((mesh, level) => {
      grounds[level].add(mesh);
      chunk.disposables.push(mesh.geometry);
    });

    // Roads, rails, rivers.
    const lod: 0 | 1 = 0;
    const out = new ChunkBuilderImpl(this.gfx.materials, this, lod);
    buildChunkRoads(cx, cz, this.map, this.edgesByChunk.get(chunk.key) ?? [], out, this.roadMats);
    buildChunkLines(cx, cz, this.map, this.railsByChunk.get(chunk.key) ?? [], (x, z) => this.terrain.height(x, z), out, this.roadMats);
    for (const mesh of out.finish(false)) {
      chunk.group.add(mesh);
      chunk.disposables.push(mesh.geometry);
    }
    const flat = out.colliders;
    yield;

    // Buildings, landmarks, props.
    const built = new ChunkBuilderImpl(this.gfx.materials, this, lod);
    const lots = this.lots.get(chunk.key) ?? [];
    for (let i = 0; i < lots.length; i++) {
      buildLot(lots[i], built);
      if (i % 6 === 5) yield;
    }
    for (const l of this.landmarksByChunk.get(chunk.key) ?? []) {
      LANDMARKS[l.kind]?.(l, built);
      yield;
    }
    this.scatter(chunk, built);
    yield;
    const area = { minX: x0, minZ: z0, size: CHUNK, seed: chunk.key };
    for (const scatterer of SCATTERERS) {
      scatterer(area, built);
      yield;
    }
    for (const mesh of built.finish()) {
      chunk.group.add(mesh);
      chunk.disposables.push(mesh.geometry);
    }
    this.addInstances(built, chunk.group, chunk.disposables, chunk);
    chunk.lights = built.lights;
    yield;

    // Physics.
    const R = this.physics.rapier;
    const hf = new Float32Array((N + 1) * (N + 1));
    // Rapier heightfields are column-major: index = row(z) + col(x) * (rows + 1).
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hf[i * (N + 1) + j] = heights[j * (N + 1) + i];
    const group = this.physics.groups(CollisionGroup.World, CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris);
    chunk.colliders.push(
      this.physics.world.createCollider(
        R.ColliderDesc.heightfield(N, N, hf, { x: CHUNK, y: 1, z: CHUNK })
          .setTranslation(x0 + CHUNK / 2, 0, z0 + CHUNK / 2)
          .setFriction(0.9)
          .setCollisionGroups(group),
      ),
    );
    chunk.colliders.push(...this.addColliders([...flat, ...built.colliders]));
    this.root.add(chunk.group);
    chunk.ready = true;
  }

  private addColliders(boxes: ColliderBox[]): RAPIER.Collider[] {
    const R = this.physics.rapier;
    const group = this.physics.groups(CollisionGroup.World, CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    // Wire fences and the like stop cars only: people, bullets and line of sight pass through.
    const vehiclesOnly = this.physics.groups(CollisionGroup.Debris, CollisionGroup.Vehicle);
    return boxes.map((b) => {
      if (b.quat) q.copy(b.quat);
      else q.setFromAxisAngle(up, b.heading);
      return this.physics.world.createCollider(
        R.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
          .setTranslation(b.x, b.y, b.z)
          .setRotation(q)
          .setFriction(0.6)
          .setCollisionGroups(b.vehiclesOnly ? vehiclesOnly : group),
      );
    });
  }

  private addInstances(out: ChunkBuilderImpl, parent: THREE.Object3D, disposables: { dispose(): void }[], chunk?: Chunk) {
    const byKind = new Map<string, typeof out.instances>();
    for (const inst of out.instances) byKind.set(inst.kind, [...(byKind.get(inst.kind) ?? []), inst]);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const boxes: ColliderBox[] = [];
    const owners: (Breakable | null)[] = [];
    for (const [kind, list] of byKind) {
      const def = getProp(kind, this.gfx.materials);
      if (!def) continue;
      if (def.minor && this.gfx.quality !== 'high' && this.gfx.quality !== 'ultra') {
        // Small set dressing is thinned out (medium) or dropped (low).
        if (this.gfx.quality === 'low') continue;
        list.splice(0, list.length, ...list.filter((_, i) => i % 2 === 0));
        if (!list.length) continue;
      }
      const meshes: THREE.InstancedMesh[] = [];
      for (const part of def.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((inst, i) => {
          dummy.position.set(inst.x, inst.y, inst.z);
          dummy.rotation.set(0, inst.heading, 0);
          dummy.scale.setScalar(inst.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          if (inst.tint !== undefined) mesh.setColorAt(i, tint.set(inst.tint));
        });
        mesh.castShadow = def.castShadow !== false;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        parent.add(mesh);
        disposables.push(mesh);
        meshes.push(mesh);
      }
      // Collision: the def's own post / trunk, or the physics overlay for this kind (fences, furniture).
      const rule = PROP_PHYSICS[kind];
      const box = rule?.box ?? (def.collider ? { hx: def.collider.radius, hz: def.collider.radius, height: def.collider.height } : null);
      if (box) {
        list.forEach((inst, index) => {
          const hx = box.hx * inst.scale;
          const hz = box.hz * inst.scale;
          const height = box.height * inst.scale;
          boxes.push({ x: inst.x, y: inst.y + height / 2, z: inst.z, hx, hy: height / 2, hz, heading: inst.heading, vehiclesOnly: rule?.solidTo === 'vehicles' });
          owners.push(
            rule?.breakSpeed !== undefined && chunk
              ? { kind, x: inst.x, y: inst.y, z: inst.z, heading: inst.heading, scale: inst.scale, tint: inst.tint, hx, hz, height, rule, def, meshes, index, collider: null, broken: false }
              : null,
          );
        });
      }
    }
    const colliders = this.addColliders(boxes);
    if (!chunk) return;
    chunk.colliders.push(...colliders);
    owners.forEach((b, i) => {
      if (!b) return;
      b.collider = colliders[i];
      this.breakables.add(chunk.key, b);
    });
  }

  /** A vehicle has knocked a prop over: its collider is already gone, and so is the light it carried. */
  private onPropBroken(b: Breakable, key: number) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    if (b.collider) {
      const i = chunk.colliders.indexOf(b.collider);
      if (i >= 0) chunk.colliders.splice(i, 1);
    }
    if (b.height > 4) chunk.lights = chunk.lights.filter((l) => Math.hypot(l.x - b.x, l.z - b.z) > 4);
  }

  /** Vegetation and roadside furniture that is not tied to a building lot. */
  private scatter(chunk: Chunk, out: ChunkBuilderImpl) {
    const x0 = chunk.cx * CHUNK;
    const z0 = chunk.cz * CHUNK;
    const density = this.gfx.quality === 'low' ? 0.4 : this.gfx.quality === 'medium' ? 0.7 : 1;
    // Park trees and river willows on a jittered grid.
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        const r = hash2(chunk.cx * 16 + i, chunk.cz * 16 + j);
        const x = x0 + (i + hash2(i + chunk.cx * 31, j + 7)) * 16;
        const z = z0 + (j + hash2(i + 3, j + chunk.cz * 17)) * 16;
        const d = this.map.districtAt(x, z);
        const want = d.type === 'park' ? 0.34 : d.type === 'rural' ? 0.012 : 0;
        if (r > want * density) continue;
        if (this.graph.nearest(x, z, 14) || this.terrain.natural(x, z) < 2.5 || this.terrain.waterDepth(x, z) > 0) continue;
        if (this.landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < l.clearRadius)) continue;
        const kind = d.type === 'park' ? (r * 31 % 1 < 0.75 ? 'tree-oak' : 'tree-willow') : r * 97 % 1 < 0.5 ? 'tree-cabbage' : 'tree-pine';
        out.instance(kind, x, this.terrain.height(x, z), z, r * 40, 0.85 + (r * 53 % 1) * 0.5);
      }
    }
    // Street lamps along urban roads.
    for (const ei of this.edgesByChunk.get(chunk.key) ?? []) {
      const e = this.graph.edges[ei];
      if (!e.footpaths || e.bridge) continue;
      for (let s = 18; s < e.length - 10; s += 44) {
        const p = this.graph.pointAt(e, s);
        if (chunkOf(p.x) !== chunk.cx || chunkOf(p.z) !== chunk.cz) continue;
        const side = Math.floor(s / 44) % 2 === 0 ? 1 : -1;
        const off = (e.width / 2 + 0.7) * side;
        // Arm reaches back over the carriageway.
        out.instance('lamp', p.x + p.tz * off, p.y, p.z - p.tx * off, Math.atan2(-p.tz * side, p.tx * side));
        out.light(p.x + p.tz * (off - 2.2 * side), p.y + 6.6, p.z - p.tx * (off - 2.2 * side), 0xffd9a0, 170, 24);
      }
    }
  }

  // ───────────── Queries ─────────────

  heightAt(x: number, z: number): number {
    const cx = chunkOf(x);
    const cz = chunkOf(z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk?.heights) return this.terrain.height(x, z);
    const gx = clamp((x - cx * CHUNK) / CELL, 0, N - 1e-4);
    const gz = clamp((z - cz * CHUNK) / CELL, 0, N - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const hts = chunk.heights;
    const a = hts[j * (N + 1) + i];
    const b = hts[(j + 1) * (N + 1) + i];
    const c = hts[(j + 1) * (N + 1) + i + 1];
    const d = hts[j * (N + 1) + i + 1];
    return fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  }

  groundAt(x: number, z: number): number {
    const hit = this.graph.nearest(x, z, 12, (e) => e.bridge);
    if (hit && hit.distance < hit.edge.width / 2 + 0.7) return hit.y;
    return this.heightAt(x, z);
  }

  normalAt(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
    const dx = this.heightAt(x + 1, z) - this.heightAt(x - 1, z);
    const dz = this.heightAt(x, z + 1) - this.heightAt(x, z - 1);
    return target.set(-dx, 2, -dz).normalize();
  }

  waterDepthAt(x: number, z: number): number {
    return this.terrain.waterDepth(x, z);
  }

  surfaceAt(x: number, z: number): GroundSurface {
    return this.terrain.surface(x, z);
  }

  lotsNear(x: number, z: number, radius: number): Lot[] {
    // Plots are filed under the chunk of their centre, so look a plot's reach beyond the circle.
    const reach = radius + 48;
    const out: Lot[] = [];
    for (let cx = chunkOf(x - reach); cx <= chunkOf(x + reach); cx++) {
      for (let cz = chunkOf(z - reach); cz <= chunkOf(z + reach); cz++) {
        for (const lot of this.lots.get(chunkKey(cx, cz)) ?? []) {
          if (Math.hypot(lot.x - x, lot.z - z) <= radius + Math.hypot(lot.width, lot.depth) / 2) out.push(lot);
        }
      }
    }
    return out;
  }

  districtAt(x: number, z: number): District {
    return this.map.districtAt(x, z);
  }

  locationName(x: number, z: number): string {
    const hit = this.graph.nearest(x, z, 14);
    if (hit && hit.distance < hit.edge.width / 2 + 4) return hit.edge.name;
    return this.map.districtAt(x, z).name;
  }

  place(id: string): Place {
    const p = this.places.find((q) => q.id === id);
    if (!p) throw new Error(`Unknown place "${id}"`);
    return p;
  }

  placesTagged(tag: string): Place[] {
    return this.places.filter((p) => p.tags.includes(tag));
  }

  nearestPlace(x: number, z: number, tag: string): Place | null {
    let best: Place | null = null;
    let bestD = Infinity;
    for (const p of this.places) {
      if (!p.tags.includes(tag)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Night-time point lights near the focus (for a light pool). */
  lightsNear(x: number, z: number, radius: number): ChunkLight[] {
    const out: ChunkLight[] = [];
    for (const l of this.skylineLights) if (Math.hypot(l.x - x, l.z - z) < radius) out.push(l);
    for (const chunk of this.chunks.values()) {
      if (!chunk.ready) continue;
      for (const l of chunk.lights) if (Math.hypot(l.x - x, l.z - z) < radius) out.push(l);
    }
    return out;
  }
}
