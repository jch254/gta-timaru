import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { cabin, interior, Shell, type Cabin, type CabinDef, type InteriorDef, type ShellDef } from './body';
import { AMBER, CHROME, CLEAR_LENS, DARK, HEAD, Kit, LENS, mountWheels, PAINT, RED_LENS, TAIL, TAIL_LENS, type Glaze, type Pt, type Surface, type Tint, type WheelStyle } from './kit';

/**
 * Fittings shared by the four-wheelers (bumpers, lamps, mirrors, handles, wipers…) and the assembly
 * line that turns a plan into a `VehicleModel`.
 */

/** An end of the vehicle to hang lamps and grilles on: the plane z = `z`, facing `dir` (+1 front, −1 rear). */
export class Face {
  constructor(
    readonly k: Kit,
    readonly z: number,
    readonly dir: 1 | -1,
  ) {}

  /** Box `depth` deep whose outer face stands `proud` of the plane. */
  box(surface: Surface, w: number, h: number, x: number, y: number, depth = 0.02, proud = 0.004): void {
    this.k.box(surface, w, h, depth, x, y, this.z + this.dir * (proud - depth / 2));
  }

  /** The same on both sides. */
  both(surface: Surface, w: number, h: number, x: number, y: number, depth = 0.02, proud = 0.004): void {
    this.box(surface, w, h, x, y, depth, proud);
    this.box(surface, w, h, -x, y, depth, proud);
  }

  /** Flat pane (a lamp lens) on both sides, `proud` of the plane. */
  lens(glaze: Glaze, w: number, h: number, x: number, y: number, proud: number): void {
    const z = this.z + this.dir * proud;
    for (const s of [1, -1]) {
      this.k.poly(glaze, [[s * x - w / 2, y - h / 2, z], [s * x + w / 2, y - h / 2, z], [s * x + w / 2, y + h / 2, z], [s * x - w / 2, y + h / 2, z]], [s * x, y, z - this.dir]);
    }
  }

  /**
   * Headlamp pair: dark bucket, bright reflector, the lit lamp(s) and a clear lens over the lot.
   * `twin` splits each into two square sealed beams.
   */
  headlamps(x: number, y: number, w: number, h: number, o: { twin?: boolean; bezel?: Tint | null } = {}): void {
    this.both(DARK, w, h, x, y, 0.03, 0.004);
    this.both(CHROME, w - 0.014, h - 0.014, x, y, 0.004, 0.007);
    if (o.twin) {
      this.both(HEAD, w * 0.37, h * 0.66, x - w * 0.235, y, 0.004, 0.0105);
      this.both(HEAD, w * 0.37, h * 0.66, x + w * 0.235, y, 0.004, 0.0105);
    } else this.both(HEAD, w * 0.66, h * 0.62, x, y, 0.004, 0.0105);
    this.lens(LENS, w - 0.008, h - 0.008, x, y, 0.018);
    if (o.bezel) this.both(o.bezel, w + 0.026, h + 0.026, x, y, 0.02, 0.002);
  }

  /**
   * Tail-lamp cluster pair: red lens with the lit tail / brake lamp outboard, then amber, then a white
   * reversing lamp inboard. `upright` stacks them instead (lit at the top).
   */
  taillamps(x: number, y: number, w: number, h: number, o: { upright?: boolean; bezel?: Tint | null; reverse?: boolean } = {}): void {
    this.both(RED_LENS, w, h, x, y, 0.03, 0.012);
    const p = 0.0145;
    if (o.upright) {
      this.both(TAIL, w * 0.74, h * 0.4, x, y + h * 0.24, 0.004, p);
      this.both(AMBER, w * 0.74, h * 0.2, x, y - h * 0.1, 0.004, p);
      if (o.reverse !== false) this.both(CLEAR_LENS, w * 0.74, h * 0.16, x, y - h * 0.33, 0.004, p);
    } else {
      this.both(TAIL, w * 0.44, h * 0.72, x + w * 0.23, y, 0.004, p);
      this.both(AMBER, w * 0.22, h * 0.72, x - w * 0.13, y, 0.004, p);
      if (o.reverse !== false) this.both(CLEAR_LENS, w * 0.17, h * 0.72, x - w * 0.36, y, 0.004, p);
    }
    // One lens over the lot, so the cluster reads as moulded plastic with lamps behind it, not as paint.
    this.lens(TAIL_LENS, w - 0.006, h - 0.006, x, y, 0.019);
    if (o.bezel) this.both(o.bezel, w + 0.026, h + 0.026, x, y, 0.02, 0.006);
  }
}

/** Bumper (or any moulding) wrapped round an end of the shell. `section` is [outward, up] about height `y`. */
export function bumper(k: Kit, shell: Shell, end: 'front' | 'rear', surface: Surface, section: Pt[], o: { zStart: number; y: number; off?: number; bow?: number; closed?: boolean }): void {
  k.sweep(surface, shell.wrap(end, o.zStart, o.y, o.off ?? 0, o.bow ?? 0), section, { out: [0, o.y, shell.mid], mirror: true, caps: 'start', closed: o.closed, cast: surface === PAINT });
}

/** Door mirrors on both sides: a housing on a foot at the base of the A-pillar, with the glass facing aft. */
export function mirrors(k: Kit, shell: Shell, z: number, y: number, surface: Surface, w = 0.14, h = 0.1): void {
  for (const s of [1, -1]) {
    const x = shell.F(z, y - 0.05) + 0.004 + w / 2;
    k.pad(surface, w, h, 0.075, s * x, y, z, 0.026, [0, -s * 0.12, 0]);
    k.box(CHROME, w - 0.04, h - 0.032, 0.004, s * x, y, z - 0.0385, [0, -s * 0.12, 0]);
    k.box(surface === PAINT ? DARK : surface, 0.05, 0.03, 0.06, s * (x - w / 2 + 0.005), y - h / 2 + 0.01, z);
  }
}

/** Door handles at each z, on both flanks. */
export function handles(k: Kit, shell: Shell, zs: number[], y: number, surface: Surface, flush = false): void {
  for (const z of zs) {
    for (const s of [1, -1]) {
      const x = shell.F(z, y);
      if (flush) {
        k.box(DARK, 0.006, 0.05, 0.13, s * (x + 0.002), y, z);
        k.box(surface, 0.012, 0.022, 0.12, s * (x + 0.004), y + 0.012, z);
      } else {
        k.box(DARK, 0.006, 0.04, 0.05, s * (x + 0.002), y, z - 0.05);
        k.box(surface, 0.02, 0.024, 0.13, s * (x + 0.012), y, z);
      }
    }
  }
}

/** A pair of wipers parked across the bottom of the windscreen, and the scuttle they sit on. */
export function wipers(k: Kit, cab: Cabin, o: { opposed?: boolean; span?: number } = {}): void {
  const span = o.span ?? 0.52;
  for (const [u0, dir] of o.opposed
    ? [
        [-0.72, 1],
        [0.72, -1],
      ]
    : [
        [-0.55, 1],
        [0.2, 1],
      ]) {
    const a = cab.screen(u0, 0.02, 0.012);
    const b = cab.screen(u0 + dir * span, 0.1, 0.014);
    k.beam(DARK, a, b, 0.012, 0.01);
    k.beam(DARK, cab.screen(u0 + dir * span * 0.25, 0.045, 0.02), cab.screen(u0 + dir * span * 1.0, 0.115, 0.012), 0.02, 0.006);
  }
}

/** Radio aerial. */
export function aerial(k: Kit, x: number, y: number, z: number, height = 0.75, rake = 0.18): void {
  k.tube(DARK, [x, y, z], [x, y + 0.03, z], 0.012, 6);
  k.tube(CHROME, [x, y + 0.02, z], [x, y + height, z - height * rake], 0.004, 4, false, 0.002);
}

/** Tail pipe poking out under the rear. */
export function exhaust(k: Kit, x: number, y: number, z: number, radius = 0.026, length = 0.22, surface: Surface = CHROME): void {
  k.tube(surface, [x, y + 0.01, z + length], [x, y, z], radius, 8, false, radius, true);
  k.drum(DARK, radius - 0.004, 0.002, x, y, z + 0.004, 'z', 8);
}

/** Fuel filler flap: a shut line round a small door on one flank. */
export function fuelFlap(k: Kit, shell: Shell, z: number, y: number, side = 1, w = 0.15, h = 0.13): void {
  shell.vline(k, DARK, z - w / 2, y - h / 2, y + h / 2, 0.007, [side]);
  shell.vline(k, DARK, z + w / 2, y - h / 2, y + h / 2, 0.007, [side]);
  shell.hline(k, DARK, y - h / 2, z - w / 2, z + w / 2, 0.007, [side]);
  shell.hline(k, DARK, y + h / 2, z - w / 2, z + w / 2, 0.007, [side]);
}

/** Mud flaps behind a pair of wheels. */
export function mudflaps(k: Kit, x: number, z: number, top: number, w = 0.22, bottom = 0.12): void {
  k.boxes(DARK, w, top - bottom, 0.012, x, (top + bottom) / 2, z);
}

// ───────────────────────────── Assembly ─────────────────────────────

export interface CarPlan {
  shell: ShellDef;
  cabin: CabinDef;
  interior: InteriorDef;
  wheel: WheelStyle;
  rearWheel?: WheelStyle;
  rim?: number;
  /** Twin rear wheels, and the track of the outer pair. */
  twin?: boolean;
  rearTrack?: number;
  /** Pan under the floor (off where a chassis shows instead) and how low the belly between the axles hangs. */
  pan?: boolean;
  belly?: number;
  /** Everything else that is the same on every vehicle of this kind. */
  dress(k: Kit, shell: Shell, cab: Cabin): void;
}

export interface Built {
  k: Kit;
  shell: Shell;
  model: VehicleModel;
}

/**
 * How far below a seat position the seated figure reaches: the driving pose sits as on a chair, shins
 * upright, with its soles this far under the seat position. A car's floor is nothing like that deep, so
 * the belly under the cabin is hung low enough to swallow the shins rather than leave feet dangling in
 * the gap under the sills. If the pose ever stretches its legs out, shrink this and the bellies rise.
 */
const FOOT_DROP = 0.4;

/**
 * Build a four-wheeler from a plan. The geometry is cached under `key` (make it distinct for every
 * variant that differs in shape); `extras` then adds what is this vehicle's own (plates).
 */
export function assemble(spec: VehicleSpec, color: number, m: MaterialLibrary, key: string, plan: CarPlan, extras?: (k: Kit, shell: Shell) => void): Built {
  const k = new Kit(m, color);
  const shell = new Shell(plan.shell);
  const feet = Math.min(...plan.interior.seats.map((s) => s.y)) - FOOT_DROP;
  const belly = plan.belly === undefined ? undefined : feet < plan.shell.lower(plan.interior.seats[0].z) ? Math.min(plan.belly, Math.max(0.045, feet - 0.01)) : plan.belly;
  k.cached(key, (c) => {
    shell.build(c);
    shell.underbody(c, spec.track, spec.wheelWidth, { pan: plan.pan, belly });
    const cab = cabin(c, shell, plan.cabin);
    interior(c, shell, plan.interior);
    plan.dress(c, shell, cab);
  });
  extras?.(k, shell);
  const wheels = mountWheels(k, { radius: spec.wheelRadius, width: spec.wheelWidth, wheelbase: spec.wheelbase, track: spec.track, rearTrack: plan.rearTrack, front: plan.wheel, rear: plan.rearWheel, rim: plan.rim, twin: plan.twin });
  const model: VehicleModel = {
    group: k.finish(),
    wheels,
    seats: plan.interior.seats.slice(0, spec.seats).map((s) => ({ x: s.x, y: s.y, z: s.z })),
    headlights: k.headlights,
    taillights: k.taillights,
    bodyMaterial: k.paint,
  };
  return { k, shell, model };
}
