import * as THREE from 'three';
import type { Conveyor, MaterialLibrary } from '../core/types';
import { mergeGeometries } from './props/index';

/** Flat run at each end of an escalator before the steps start to climb (metres, horizontal). */
export const ESCALATOR_FLAT = 1.1;
/** Depth of one step (horizontal). */
const STEP = 0.4;
/** Moving steps are only animated (and drawn) this close to the camera. */
const DRAW_RANGE = 90;

/** One conveyor as the world keeps it: the end points plus the numbers the queries need. */
interface Run {
  c: Conveyor;
  chunk: number;
  /** Unit horizontal direction of travel. */
  dx: number;
  dz: number;
  /** Horizontal length and rise from `from` to `to`. */
  length: number;
  rise: number;
  mesh: THREE.InstancedMesh | null;
  offset: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Height of the walking surface `x` metres (horizontally) along a run: flat, climbing, flat. */
export function treadHeight(length: number, rise: number, x: number): number {
  const climb = Math.max(0.01, length - ESCALATOR_FLAT * 2);
  return rise * Math.min(1, Math.max(0, (x - ESCALATOR_FLAT) / climb));
}

/** Where along a run (horizontal metres from `from`) a point lies, and how far off its centre line, or null if off it. */
export function onRun(c: Conveyor, x: number, y: number, z: number): { along: number; across: number; height: number } | null {
  const hx = c.to.x - c.from.x;
  const hz = c.to.z - c.from.z;
  const length = Math.hypot(hx, hz);
  if (length < 0.1) return null;
  const dx = hx / length;
  const dz = hz / length;
  const rx = x - c.from.x;
  const rz = z - c.from.z;
  const along = rx * dx + rz * dz;
  const across = rx * dz - rz * dx;
  if (along < 0 || along > length || Math.abs(across) > c.width / 2) return null;
  const height = c.from.y + treadHeight(length, c.to.y - c.from.y, along);
  if (Math.abs(y - height) > 0.55) return null;
  return { along, across, height };
}

/**
 * The world's escalators: the carrying (`at`, which the player asks every physics step) and the moving
 * steps, one instanced mesh per run, built when its chunk loads and animated only near the camera. The
 * balustrades, landing plates and the ramp people actually stand on belong to the landmark that asked for it.
 */
export class Escalators {
  private runs: Run[] = [];
  private geometry: THREE.BufferGeometry | null = null;
  private materials: THREE.Material[] | null = null;

  constructor(
    private root: THREE.Object3D,
    private library: MaterialLibrary,
  ) {}

  add(chunk: number, list: readonly Conveyor[]) {
    for (const c of list) {
      const hx = c.to.x - c.from.x;
      const hz = c.to.z - c.from.z;
      const length = Math.hypot(hx, hz);
      if (length < 2) continue;
      const run: Run = { c, chunk, dx: hx / length, dz: hz / length, length, rise: c.to.y - c.from.y, mesh: null, offset: 0 };
      const count = Math.ceil(length / STEP);
      const mesh = new THREE.InstancedMesh(this.stepGeometry(c.width), this.stepMaterials(), count);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Each run has its own width, so its own geometry; the template is cloned and scaled across.
      run.mesh = mesh;
      this.place(run);
      this.root.add(mesh);
      this.runs.push(run);
    }
  }

  drop(chunk: number) {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const run = this.runs[i];
      if (run.chunk !== chunk) continue;
      if (run.mesh) {
        this.root.remove(run.mesh);
        run.mesh.geometry.dispose();
        run.mesh.dispose();
      }
      this.runs.splice(i, 1);
    }
  }

  /** Velocity of whatever is under feet at (x, y, z) into `out`; false when not on an escalator. */
  at(x: number, y: number, z: number, out: THREE.Vector3): boolean {
    for (const run of this.runs) {
      const hit = onRun(run.c, x, y, z);
      if (!hit) continue;
      const climbing = hit.along > ESCALATOR_FLAT && hit.along < run.length - ESCALATOR_FLAT;
      const slope = climbing ? run.rise / Math.max(0.01, run.length - ESCALATOR_FLAT * 2) : 0;
      const horizontal = run.c.speed / Math.sqrt(1 + slope * slope);
      out.set(run.dx * horizontal, horizontal * slope, run.dz * horizontal);
      return true;
    }
    return false;
  }

  update(dt: number, eye: THREE.Vector3) {
    for (const run of this.runs) {
      const mesh = run.mesh;
      if (!mesh) continue;
      const mx = (run.c.from.x + run.c.to.x) / 2;
      const mz = (run.c.from.z + run.c.to.z) / 2;
      const near = Math.hypot(mx - eye.x, mz - eye.z) < DRAW_RANGE;
      mesh.visible = near;
      if (!near) continue;
      const climb = run.length - ESCALATOR_FLAT * 2;
      const horizontal = run.c.speed / Math.sqrt(1 + (run.rise / Math.max(0.01, climb)) ** 2);
      run.offset = (run.offset + horizontal * dt) % STEP;
      this.place(run);
    }
  }

  private place(run: Run) {
    const mesh = run.mesh;
    if (!mesh) return;
    const heading = Math.atan2(run.dx, run.dz);
    _q.setFromAxisAngle(UP, heading);
    for (let k = 0; k < mesh.count; k++) {
      const x = k * STEP + run.offset;
      // A step's tread is level; on the climb each one stands a riser above (or below) the one behind it,
      // its middle on the ramp line people stand on.
      const centre = Math.min(run.length - STEP / 2, x + STEP / 2);
      const y = run.c.from.y + treadHeight(run.length, run.rise, centre);
      _p.set(run.c.from.x + run.dx * centre, y, run.c.from.z + run.dz * centre);
      // Steps that have slid past the far comb plate are tucked away until they come round again.
      _s.set(1, x > run.length - 0.05 ? 0.001 : 1, 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** A step: grooved aluminium tread and riser, with the yellow edge at the back and sides of the tread. */
  private stepGeometry(width: number): THREE.BufferGeometry {
    if (!this.geometry) {
      const tread = new THREE.BoxGeometry(1, 0.34, STEP * 0.97).translate(0, -0.17, 0);
      const edge = new THREE.BoxGeometry(1.002, 0.012, 0.05).translate(0, 0.004, -STEP * 0.46);
      const sideA = new THREE.BoxGeometry(0.04, 0.012, STEP * 0.95).translate(-0.48, 0.004, 0);
      const sideB = new THREE.BoxGeometry(0.04, 0.012, STEP * 0.95).translate(0.48, 0.004, 0);
      const yellow = mergeGeometries([edge, sideA, sideB]);
      const merged = mergeGeometries([tread, yellow]);
      // Two groups: tread first, then the yellow paint.
      const split = tread.getIndex()!.count;
      merged.clearGroups();
      merged.addGroup(0, split, 0);
      merged.addGroup(split, merged.getIndex()!.count - split, 1);
      for (const g of [tread, edge, sideA, sideB, yellow]) g.dispose();
      this.geometry = merged;
    }
    return this.geometry.clone().scale(width, 1, 1);
  }

  private stepMaterials(): THREE.Material[] {
    this.materials ??= [this.library.get('metal', { color: 0x9ea3a6, roughness: 0.45 }), this.library.get('plain', { color: 0xe8b81e })];
    return this.materials;
  }
}
