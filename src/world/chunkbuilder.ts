import * as THREE from 'three';
import type { ChunkBuilder, Conveyor, MaterialLibrary, WorldApi } from '../core/types';
import { batchHint } from '../render/materials';

interface Batch {
  material: THREE.Material;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  /** Tint written to vertex colours, and UV remap into an atlas cell, for the material being added. */
  tint: THREE.Color | null;
  rect: readonly [number, number, number, number] | null;
}

const WHITE = new THREE.Color(1, 1, 1);

export interface ColliderBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  heading: number;
  /** Full orientation (bridge decks); overrides `heading` when set. */
  quat?: THREE.Quaternion;
  /** Stops vehicles only (wire fences): people, bullets and sight pass through. */
  vehiclesOnly?: boolean;
}

export interface PropInstance {
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
  tint?: number;
}

export interface ChunkLight {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  range: number;
}

/** A building floor in world space: an oriented rectangle with its top at `y`. */
export interface FloorRect {
  x: number;
  y: number;
  z: number;
  hw: number;
  hd: number;
  heading: number;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const cylCache = new Map<string, THREE.CylinderGeometry>();

/** Accumulates static world geometry for one chunk and merges it per material. */
export class ChunkBuilderImpl implements ChunkBuilder {
  private batches = new Map<THREE.Material, Batch>();
  colliders: ColliderBox[] = [];
  instances: PropInstance[] = [];
  lights: ChunkLight[] = [];
  conveyors: Conveyor[] = [];
  floors: FloorRect[] = [];

  constructor(
    readonly materials: MaterialLibrary,
    readonly world: WorldApi,
    readonly lod: 0 | 1,
  ) {}

  /**
   * Materials from the library that differ only by colour (or are cells of the sign atlas) are merged
   * into one shared batch: the colour goes into vertex colours and the UVs into the atlas cell.
   */
  private batch(material: THREE.Material): Batch {
    const hint = batchHint(material);
    const target = hint?.base ?? material;
    let b = this.batches.get(target);
    if (!b) this.batches.set(target, (b = { material: target, positions: [], normals: [], uvs: [], colors: [], indices: [], tint: null, rect: null }));
    b.tint = hint?.color ?? null;
    b.rect = hint?.uv ?? null;
    return b;
  }

  private pushUv(b: Batch, u: number, v: number) {
    if (b.rect) b.uvs.push(b.rect[0] + u * b.rect[2], b.rect[1] + v * b.rect[3]);
    else b.uvs.push(u, v);
    const c = b.tint ?? WHITE;
    b.colors.push(c.r, c.g, c.b);
  }

  frameAt(x: number, y: number, z: number, heading: number): THREE.Matrix4 {
    return new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z);
  }

  addGeometry(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4) {
    const b = this.batch(material);
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const base = b.positions.length / 3;
    if (matrix) _m3.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (matrix) _v.applyMatrix4(matrix);
      b.positions.push(_v.x, _v.y, _v.z);
      if (nor) {
        _n.fromBufferAttribute(nor, i);
        if (matrix) _n.applyMatrix3(_m3).normalize();
        b.normals.push(_n.x, _n.y, _n.z);
      } else b.normals.push(0, 1, 0);
      this.pushUv(b, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) b.indices.push(base + index.getX(i));
    else for (let i = 0; i < pos.count; i++) b.indices.push(base + i);
  }

  /** Push one quad (a,b,c,d counter-clockwise seen from outside) in local space with metre UVs. */
  private face(
    b: Batch,
    frame: THREE.Matrix4,
    pts: [number, number, number][],
    normal: [number, number, number],
    uvs: [number, number][],
  ) {
    const base = b.positions.length / 3;
    _m3.getNormalMatrix(frame);
    _n.set(normal[0], normal[1], normal[2]).applyMatrix3(_m3).normalize();
    for (let i = 0; i < pts.length; i++) {
      _v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(frame);
      b.positions.push(_v.x, _v.y, _v.z);
      b.normals.push(_n.x, _n.y, _n.z);
      this.pushUv(b, uvs[i][0], uvs[i][1]);
    }
    if (pts.length === 4) b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else b.indices.push(base, base + 1, base + 2);
  }

  box(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number, material: THREE.Material) {
    const b = this.batch(material);
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    // UVs in metres so tiling textures keep their real-world scale. v starts at the base of the box.
    this.face(b, frame, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[0, 0], [w, 0], [w, h], [0, h]]);
    this.face(b, frame, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[0, 0], [w, 0], [w, h], [0, h]]);
    this.face(b, frame, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[0, 0], [d, 0], [d, h], [0, h]]);
    this.face(b, frame, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[0, 0], [d, 0], [d, h], [0, h]]);
    this.face(b, frame, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[0, 0], [w, 0], [w, d], [0, d]]);
    this.face(b, frame, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[0, 0], [w, 0], [w, d], [0, d]]);
  }

  gable(frame: THREE.Matrix4, cx: number, y: number, cz: number, w: number, d: number, rise: number, material: THREE.Material, hip = 0) {
    const b = this.batch(material);
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const r0 = x0 + hip; // ridge ends (pulled in for a hip roof)
    const r1 = x1 - hip;
    const top = y + rise;
    const slope = Math.hypot(d / 2, rise);
    const ny = d / 2 / slope;
    const nz = rise / slope;
    // Front and back slopes. v runs up the slope so corrugations / tiles run the right way.
    this.face(b, frame, [[x0, y, z1], [x1, y, z1], [r1, top, cz], [r0, top, cz]], [0, ny, nz], [[0, 0], [w, 0], [w - hip, slope], [hip, slope]]);
    this.face(b, frame, [[x1, y, z0], [x0, y, z0], [r0, top, cz], [r1, top, cz]], [0, ny, -nz], [[0, 0], [w, 0], [w - hip, slope], [hip, slope]]);
    if (hip > 0) {
      const hs = Math.hypot(hip, rise);
      this.face(b, frame, [[x1, y, z1], [x1, y, z0], [r1, top, cz]], [rise / hs, hip / hs, 0], [[0, 0], [d, 0], [d / 2, hs]]);
      this.face(b, frame, [[x0, y, z0], [x0, y, z1], [r0, top, cz]], [-rise / hs, hip / hs, 0], [[0, 0], [d, 0], [d / 2, hs]]);
    } else {
      // Gable ends use the same material; callers usually overlay a wall-coloured triangle if they want one.
      this.face(b, frame, [[x1, y, z1], [x1, y, z0], [x1, top, cz]], [1, 0, 0], [[0, 0], [d, 0], [d / 2, rise]]);
      this.face(b, frame, [[x0, y, z0], [x0, y, z1], [x0, top, cz]], [-1, 0, 0], [[0, 0], [d, 0], [d / 2, rise]]);
    }
  }

  cylinder(frame: THREE.Matrix4, cx: number, cy: number, cz: number, radiusTop: number, radiusBottom: number, h: number, material: THREE.Material, segments = 12) {
    const key = `${radiusTop}|${radiusBottom}|${h}|${segments}`;
    let geo = cylCache.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments);
      // Metre UVs on the side wall.
      const uv = geo.getAttribute('uv');
      const circumference = Math.PI * 2 * Math.max(radiusTop, radiusBottom);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circumference, uv.getY(i) * h);
      if (cylCache.size < 400) cylCache.set(key, geo);
    }
    this.addGeometry(geo, material, new THREE.Matrix4().makeTranslation(cx, cy, cz).premultiply(frame));
  }

  quad(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, material: THREE.Material, yaw = 0, uvMetres = false) {
    const b = this.batch(material);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, cy, cz).premultiply(frame);
    const u = uvMetres ? w : 1;
    const v = uvMetres ? h : 1;
    this.face(b, m, [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], [0, 0, 1], [[0, 0], [u, 0], [u, v], [0, v]]);
  }

  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number) {
    frame.decompose(_pos, _quat, _scale);
    _euler.setFromQuaternion(_quat, 'YXZ');
    _v.set(cx, cy, cz).applyMatrix4(frame);
    const box: ColliderBox = { x: _v.x, y: _v.y, z: _v.z, hx: w / 2, hy: h / 2, hz: d / 2, heading: _euler.y };
    // A frame tilted as well as turned (ramps, escalators) keeps its whole orientation.
    if (Math.abs(_euler.x) > 1e-5 || Math.abs(_euler.z) > 1e-5) box.quat = _quat.clone();
    this.colliders.push(box);
  }

  conveyor(frame: THREE.Matrix4, from: readonly [number, number, number], to: readonly [number, number, number], width: number, speed: number) {
    const a = new THREE.Vector3(...from).applyMatrix4(frame);
    const b = new THREE.Vector3(...to).applyMatrix4(frame);
    this.conveyors.push({ from: { x: a.x, y: a.y, z: a.z }, to: { x: b.x, y: b.y, z: b.z }, width, speed });
  }

  floor(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, d: number) {
    frame.decompose(_pos, _quat, _scale);
    _euler.setFromQuaternion(_quat, 'YXZ');
    _v.set(cx, cy, cz).applyMatrix4(frame);
    this.floors.push({ x: _v.x, y: _v.y, z: _v.z, hw: w / 2, hd: d / 2, heading: _euler.y });
  }

  instance(kind: string, x: number, y: number, z: number, heading = 0, scale = 1, tint?: number) {
    this.instances.push({ kind, x, y, z, heading, scale, tint });
  }

  light(x: number, y: number, z: number, color: number, intensity: number, range: number) {
    this.lights.push({ x, y, z, color, intensity, range });
  }

  /** Merge everything into one mesh per material. */
  finish(castShadow = true): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const b of this.batches.values()) {
      if (!b.indices.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
      if ((b.material as THREE.MeshStandardMaterial).vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
      geo.setIndex(b.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.indices, 1) : new THREE.Uint16BufferAttribute(b.indices, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.material);
      mesh.castShadow = castShadow && !(b.material as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
    }
    this.batches.clear();
    return meshes;
  }
}
