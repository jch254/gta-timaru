import * as THREE from 'three';
import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { ALLOY, AMBER, CHROME, DARK, HEAD, Kit, LENS, PAINT, PLASTIC, RED_LENS, RUBBER, STEEL, TAIL, tint, type Pt, type Surface, type V3 } from './kit';

/** Steering-head rake (radians from vertical). The fork runs from the front axle up this line. */
const RAKE = 0.45;

const TYRE = tint(0x121212, 'rubber');
const ENGINE = tint(0x5c5f63, 'alloy');
const CASE = tint(0x9a9da1, 'alloy');
const VINYL = tint(0x161617, 'satin');

/** Ring of points about the x axis. */
function ring(k: Kit, surface: Surface, profile: Pt[], segments: number, group: string): void {
  const rows: V3[][] = [];
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    rows.push(profile.map(([rad, x]): V3 => [x, rad * Math.cos(a), rad * Math.sin(a)]));
  }
  k.grid(surface, rows, { out: [0, 0, 0], group });
}

/**
 * Cast motorcycle wheel, symmetrical so it can spin and steer about its centre: a round-shouldered tyre,
 * an alloy rim with five spokes, a hub and a brake disc each side.
 */
function bikeWheel(k: Kit, radius: number, width: number, discs: number): THREE.Mesh {
  return k.mesh(`bikewheel|${radius}|${width}|${discs}`, (w) => {
    const rt = width / 2;
    const rim = radius - rt * 1.45;
    const tyre: Pt[] = [[rim, -rt * 0.7]];
    for (let i = 0; i <= 8; i++) {
      const t = ((-110 + (220 * i) / 8) * Math.PI) / 180;
      tyre.push([radius - rt + Math.cos(t) * rt, Math.sin(t) * rt]);
    }
    tyre.push([rim, rt * 0.7]);
    ring(w, TYRE, tyre, 20, 'tyre');
    // Rim: a shallow channel between the beads.
    ring(w, ALLOY, [[rim, rt * 0.7], [rim - 0.02, rt * 0.55], [rim - 0.028, 0], [rim - 0.02, -rt * 0.55], [rim, -rt * 0.7]], 20, 'rim');
    for (let i = 0; i < 5; i++) {
      const g = new THREE.BoxGeometry(0.03, rim - 0.06, 0.05).translate(0, (rim + 0.02) / 2, 0).rotateX((i * Math.PI * 2) / 5);
      w.geo(ALLOY, g, { flat: true });
    }
    w.drum(ALLOY, 0.055, 0.12, 0, 0, 0, 'x', 10);
    for (const s of discs === 2 ? [1, -1] : [1]) {
      ring(w, STEEL, [[0.065, s * 0.055], [0.135, s * 0.055]], 14, 'disc' + s);
      ring(w, STEEL, [[0.135, s * 0.051], [0.065, s * 0.051]], 14, 'disc2' + s);
    }
  });
}

/** Arc of sheet metal over a wheel (a mudguard), in the frame it is drawn in. */
function guard(k: Kit, surface: Surface, cy: number, cz: number, radius: number, a0: number, a1: number, halfWidth: number): void {
  const rows: V3[][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = a0 + ((a1 - a0) * i) / 8;
    const y = cy + Math.sin(t) * radius;
    const z = cz + Math.cos(t) * radius;
    const yi = cy + Math.sin(t) * (radius - 0.03);
    const zi = cz + Math.cos(t) * (radius - 0.03);
    rows.push([
      [-halfWidth, yi, zi],
      [-halfWidth * 0.6, y, z],
      [halfWidth * 0.6, y, z],
      [halfWidth, yi, zi],
    ]);
  }
  k.grid(surface, rows, { out: [0, cy, cz], cast: true });
  k.grid(DARK, rows, { out: [0, cy, cz], inward: true });
}

/**
 * Naked 750: steel cradle frame, air-cooled four leaning forward in it, four-into-one pipe, twin shocks.
 * The fork, guard, lamp, clocks and bars hang off `steerPivot`, which turns about the raked steering
 * axis through the front axle. Returns `wheels` as [front, rear].
 */
export function buildBike(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const k = new Kit(m, color);
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  // The rider's hips sit 0.4 m above the seat position, hands 0.5 m ahead of it and 0.72 m up.
  const seat = { x: -0.001, y: 0.44, z: -0.26 };
  const seatTop = seat.y + 0.33;

  k.cached('bike', (c) => {
    const frame = tint(0x141416, 'satin');
    // Frame: backbone, twin downtubes into a cradle, seat rails and stays.
    const head: V3 = [0, r + Math.cos(RAKE) * 0.66, a - Math.sin(RAKE) * 0.66];
    c.tube(frame, head, [0, 0.76, -0.12], 0.028, 6, true);
    c.tube(frame, [0, head[1] + 0.07, head[2] - 0.035], [0, head[1] - 0.1, head[2] + 0.05], 0.034, 8);
    for (const s of [1, -1]) {
      c.pipe(frame, [[s * 0.05, head[1] - 0.07, head[2] + 0.03], [s * 0.14, 0.27, 0.3], [s * 0.14, 0.3, -0.2], [s * 0.12, 0.74, -0.14], [s * 0.11, 0.8, -0.84]], 0.019, 6, true);
      c.tube(frame, [s * 0.13, 0.42, -0.22], [s * 0.11, 0.78, -0.62], 0.015, 5);
      // Swingarm, shock with its spring, footpegs.
      c.beam(ALLOY, [s * 0.11, 0.37, -0.2], [s * 0.11, r, -a - 0.03], 0.035, 0.06, true);
      c.tube(CHROME, [s * 0.15, r + 0.07, -a + 0.1], [s * 0.15, 0.76, -0.46], 0.014, 6);
      c.tube(tint(0xa02020, 'satin'), [s * 0.15, r + 0.16, -a + 0.135], [s * 0.15, 0.7, -0.44], 0.027, 8);
      c.tube(frame, [s * 0.13, 0.28, 0.0], [s * 0.25, 0.28, 0.0], 0.014, 5);
      c.tube(frame, [s * 0.14, 0.45, -0.45], [s * 0.24, 0.42, -0.5], 0.012, 5);
      // Rear indicators on stalks.
      c.tube(DARK, [s * 0.08, 0.8, -0.93], [s * 0.17, 0.8, -0.94], 0.008, 4);
      c.pad(AMBER, 0.055, 0.045, 0.045, s * 0.19, 0.8, -0.94, 0.015);
      // Side panels under the seat.
      c.pad(PAINT, 0.03, 0.15, 0.27, s * 0.15, 0.63, -0.21, 0.012);
    }
    // Chain run and sprocket on the left.
    c.box(DARK, 0.012, 0.03, a - 0.18, 0.13, 0.36, -(a + 0.2) / 2, [0.085, 0, 0]);
    c.box(DARK, 0.012, 0.025, a - 0.2, 0.13, 0.27, -(a + 0.2) / 2, [-0.045, 0, 0]);
    c.drum(STEEL, 0.1, 0.008, 0.13, r, -a, 'x', 12);

    // Engine: crankcase with round side covers, a finned block leaning forward, the head, carbs and airbox.
    c.pad(ENGINE, 0.4, 0.24, 0.44, 0, 0.41, 0.04, 0.04, undefined, true);
    for (const s of [1, -1]) {
      c.drum(CASE, 0.095, 0.06, s * 0.215, 0.41, 0.1, 'x', 12);
      c.drum(CASE, 0.07, 0.05, s * 0.2, 0.42, -0.12, 'x', 10);
    }
    for (let i = 0; i < 5; i++) c.box(i % 2 ? ENGINE : CASE, 0.46 - (i % 2) * 0.03, 0.05, 0.27, 0, 0.535 + i * 0.047, 0.115 + i * 0.016, [0.3, 0, 0], i === 2);
    c.pad(CASE, 0.47, 0.07, 0.3, 0, 0.775, 0.2, 0.02, [0.3, 0, 0]);
    for (const x of [-0.165, -0.055, 0.055, 0.165]) c.tube(STEEL, [x, 0.68, -0.02], [x, 0.66, -0.14], 0.03, 6);
    c.pad(PLASTIC, 0.3, 0.17, 0.2, 0, 0.63, -0.22, 0.03);

    // Four-into-one: headers down the front, collector under the cases, megaphone up the right.
    for (const x of [-0.165, -0.055, 0.055, 0.165]) c.pipe(CHROME, [[x, 0.7, 0.3], [x * 0.95, 0.42, 0.37], [x * 0.7, 0.24, 0.26], [-0.08, 0.21, 0.02]], 0.019, 6);
    c.pipe(CHROME, [[-0.08, 0.21, 0.02], [-0.2, 0.24, -0.28], [-0.23, 0.3, -0.5]], 0.034, 8);
    c.tube(CHROME, [-0.23, 0.3, -0.5], [-0.26, 0.43, -1.0], 0.04, 10, true, 0.062);
    c.drum(DARK, 0.05, 0.004, -0.26, 0.431, -1.001, 'z', 10);

    // Tank: a teardrop lofted from cross-sections.
    const sections: [number, number, number, number][] = [
      // z, half-width, top, bottom
      [-0.14, 0.085, 0.84, 0.76],
      [-0.08, 0.13, 0.9, 0.745],
      [0.06, 0.175, 0.955, 0.735],
      [0.22, 0.19, 0.975, 0.74],
      [0.36, 0.165, 0.955, 0.76],
      [0.45, 0.11, 0.905, 0.8],
      [0.485, 0.04, 0.865, 0.83],
    ];
    const tank = sections.map(([z, w, top, bottom]) => {
      const row: V3[] = [];
      const cy = (top + bottom) / 2;
      const ry = (top - bottom) / 2;
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * Math.PI * 2;
        // Flatter underneath than on top.
        const sy = Math.sin(t);
        row.push([Math.cos(t) * w * (sy < 0 ? 0.82 : 1), cy + (sy < 0 ? sy * 0.75 : sy) * ry, z]);
      }
      return row;
    });
    c.grid(PAINT, tank, { out: [0, 0.86, 0.15] });
    c.poly(PAINT, tank[0].slice(0, -1), [0, 0.86, 0.15]);
    c.poly(PAINT, tank[tank.length - 1].slice(0, -1), [0, 0.86, 0.15]);
    c.drum(CHROME, 0.04, 0.02, 0, 0.982, 0.24, 'y', 10);
    c.boxes(tint(0xf2f2ee, 'gloss'), 0.004, 0.035, 0.26, 0.186, 0.9, 0.2);

    // Seat, tail piece, lamp, rear guard, plate bracket.
    c.pad(VINYL, 0.28, 0.1, 0.5, 0, seatTop - 0.05, -0.33, 0.035, [0.03, 0, 0]);
    c.pad(VINYL, 0.27, 0.1, 0.36, 0, seatTop - 0.015, -0.7, 0.035, [0.06, 0, 0]);
    c.pad(PAINT, 0.25, 0.11, 0.26, 0, 0.78, -0.9, 0.035, [0.2, 0, 0], true);
    c.pad(RED_LENS, 0.15, 0.065, 0.05, 0, 0.775, -1.022, 0.015);
    c.box(TAIL, 0.11, 0.04, 0.012, 0, 0.775, -1.045);
    guard(c, tint(0x141416, 'satin'), r, -a, r + 0.045, 0.75, 2.75, 0.085);
    c.box(DARK, 0.03, 0.14, 0.012, 0, 0.6, -a - r - 0.012, [0.25, 0, 0]);
  });
  k.plates(Number.NaN, 0, -a - r - 0.03, 0.58, 'new', 0.6, 0.25);

  // Steering assembly, built in the pivot's own frame: y runs up the fork from the axle.
  const f = new Kit(m, color, k.paint);
  /** Offset from the front axle in ordinary (level) axes → the pivot's raked frame. */
  const lv = (x: number, y: number, z: number): V3 => [x, y * Math.cos(RAKE) - z * Math.sin(RAKE), y * Math.sin(RAKE) + z * Math.cos(RAKE)];
  f.cached('bike-fork', (c) => {
    for (const s of [1, -1]) {
      c.tube(ALLOY, [s * 0.1, -0.02, 0], [s * 0.1, 0.3, 0], 0.03, 8, true);
      c.tube(CHROME, [s * 0.1, 0.3, 0], [s * 0.1, 0.74, 0], 0.02, 6);
      c.box(STEEL, 0.03, 0.09, 0.06, s * 0.085, 0.13, -0.05);
      // Bars: up from the clamp, out and back to the grips; lever, mirror, indicator.
      c.pipe(CHROME, [lv(s * 0.06, 0.65, -0.33), lv(s * 0.13, 0.82, -0.4), lv(s * 0.25, 0.855, -0.47), lv(s * 0.36, 0.85, -0.5)], 0.012, 6);
      c.tube(RUBBER, lv(s * 0.25, 0.855, -0.47), lv(s * 0.365, 0.85, -0.5), 0.018, 8);
      c.beam(ALLOY, lv(s * 0.22, 0.85, -0.44), lv(s * 0.36, 0.845, -0.44), 0.012, 0.008);
      c.tube(DARK, lv(s * 0.2, 0.85, -0.46), lv(s * 0.3, 0.925, -0.44), 0.006, 4);
      c.pad(DARK, 0.11, 0.06, 0.025, ...lv(s * 0.315, 0.935, -0.44), 0.01, [RAKE, 0, 0]);
      c.tube(DARK, lv(s * 0.1, 0.6, -0.1), lv(s * 0.2, 0.6, -0.1), 0.008, 4);
      c.pad(AMBER, 0.055, 0.045, 0.045, ...lv(s * 0.22, 0.6, -0.1), 0.015);
    }
    c.box(DARK, 0.27, 0.035, 0.08, 0, 0.56, 0);
    c.box(DARK, 0.27, 0.035, 0.08, 0, 0.72, 0);
    // Chromed guard over the tyre.
    const rows: V3[][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = -1.0 + (2.0 * i) / 8;
      const at = (rad: number, x: number): V3 => [x, Math.cos(t) * rad, Math.sin(t) * rad];
      rows.push([at(r + 0.012, -0.075), at(r + 0.035, -0.045), at(r + 0.035, 0.045), at(r + 0.012, 0.075)]);
    }
    c.grid(CHROME, rows, { out: [0, 0, 0], cast: true });
    c.grid(DARK, rows, { out: [0, 0, 0], inward: true });
    // Round headlamp in a chrome shell, twin clocks.
    // The shell is squashed so it stays behind the lens, and polished rather than mirror chrome: a mirror
    // here throws a sun glint that blooms as if the lamp were on.
    const shell = tint(0xf0f0f0, 'polished');
    c.ball(shell, 0.096, ...lv(0, 0.585, -0.13), 1, 0.6, 10);
    c.tube(shell, lv(0, 0.585, -0.1), lv(0, 0.585, -0.062), 0.099, 14);
    c.tube(HEAD, lv(0, 0.585, -0.064), lv(0, 0.585, -0.056), 0.083, 14);
    const lens: V3[] = [];
    for (let i = 0; i < 12; i++) lens.push(lv(0.086 * Math.cos((i / 12) * Math.PI * 2), 0.585 + 0.086 * Math.sin((i / 12) * Math.PI * 2), -0.05));
    c.poly(LENS, lens, lv(0, 0.585, -1));
    for (const s of [1, -1]) {
      c.tube(DARK, lv(s * 0.06, 0.71, -0.2), lv(s * 0.06, 0.755, -0.235), 0.05, 10);
      c.tube(CHROME, lv(s * 0.06, 0.753, -0.233), lv(s * 0.06, 0.76, -0.238), 0.052, 10);
    }
  });
  const steerPivot = f.finish();
  steerPivot.position.set(0, r, a);
  steerPivot.rotation.x = -RAKE;
  k.group.add(steerPivot);

  const front = new THREE.Group();
  front.add(bikeWheel(k, r, spec.wheelWidth * 0.9, 2));
  const rear = new THREE.Group();
  rear.add(bikeWheel(k, r, spec.wheelWidth * 1.15, 1));
  front.position.set(0, r, a);
  rear.position.set(0, r, -a);
  k.group.add(front, rear);

  return {
    group: k.finish(),
    wheels: [front, rear],
    // x is a hair negative so the door-side logic treats the rider like any driver (on and off from the right).
    seats: [seat, { x: -0.001, y: seat.y + 0.05, z: -0.68 }].slice(0, spec.seats),
    headlights: k.headlights,
    taillights: k.taillights,
    bodyMaterial: k.paint,
    steerPivot,
  };
}
