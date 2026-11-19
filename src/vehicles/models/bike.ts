import * as THREE from 'three';
import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { ALLOY, CHROME, DARK, HEAD, Kit, LENS, PAINT, RED_LENS, RUBBER, SMOKED, STEEL, TAIL, tint, type Pt, type Surface, type V3 } from './kit';
import { CHERISHED, stanceOf, weather } from './parts';

/** Steering-head rake (radians from vertical). The fork runs from the front axle up this line. */
const RAKE = 0.45;

const TYRE = tint(0x121212, 'rubber');
const CASE = tint(0x8b8e92, 'alloy');

/** Ring of points about the x axis. */
export function ring(k: Kit, surface: Surface, profile: Pt[], segments: number, group: string): void {
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
export function bikeWheel(k: Kit, radius: number, width: number, discs: number): THREE.Mesh {
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
export function guard(k: Kit, surface: Surface, cy: number, cz: number, radius: number, a0: number, a1: number, halfWidth: number): void {
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

const WHITE = tint(0xf2f1ea, 'gloss');
const VINYL = tint(0x161617, 'satin');

/**
 * Race-replica 750: a full fairing over the four, twin lamps in the nose, a smoked screen, clip-ons low on
 * the fork, the tail cowled. The upper bodywork takes the paint; the belly runs white like the brochure.
 * The fork, guard, clip-ons and clocks hang off `steerPivot`, which turns about the raked steering axis
 * through the front axle. Returns `wheels` as [front, rear].
 */
export function buildBike(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const k = new Kit(m, color, undefined, false, weather(CHERISHED), stanceOf(spec));
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  // The rider's hips sit 0.4 m above the seat position, hands 0.5 m ahead of it and 0.72 m up.
  const seat = { x: -0.001, y: 0.44, z: -0.24 };
  const seatTop = seat.y + 0.32;

  const body = (c: Kit) => {
    const frame = tint(0x2a2c30, 'satin');
    // Frame spars under the tank, swingarm, footpegs, chain. Most of the rest hides behind the fairing.
    const head: V3 = [0, r + Math.cos(RAKE) * 0.64, a - Math.sin(RAKE) * 0.64];
    c.tube(frame, [0, head[1] + 0.06, head[2] - 0.03], [0, head[1] - 0.1, head[2] + 0.05], 0.034, 8);
    for (const s of [1, -1]) {
      c.beam(ALLOY, [s * 0.05, head[1] - 0.02, head[2]], [s * 0.13, 0.62, -0.18], 0.05, 0.035, true);
      c.beam(ALLOY, [s * 0.11, 0.37, -0.2], [s * 0.11, r, -a - 0.03], 0.035, 0.06, true);
      c.tube(frame, [s * 0.13, 0.42, -0.22], [s * 0.11, 0.7, -0.6], 0.015, 5);
      c.tube(frame, [s * 0.13, 0.3, -0.17], [s * 0.26, 0.3, -0.17], 0.014, 5);
      c.tube(frame, [s * 0.14, 0.45, -0.45], [s * 0.24, 0.42, -0.5], 0.012, 5);
      // Rear indicators on stalks.
      c.tube(DARK, [s * 0.08, 0.76, -0.9], [s * 0.17, 0.76, -0.91], 0.008, 4);
      c.pad(tint(0xe58a16, 'gloss'), 0.055, 0.045, 0.045, s * 0.19, 0.76, -0.91, 0.015);
    }
    // Chain run and sprocket on the left.
    c.box(DARK, 0.012, 0.03, a - 0.18, 0.13, 0.36, -(a + 0.2) / 2, [0.085, 0, 0]);
    c.box(DARK, 0.012, 0.025, a - 0.2, 0.13, 0.27, -(a + 0.2) / 2, [-0.045, 0, 0]);
    c.drum(STEEL, 0.1, 0.008, 0.13, r, -a, 'x', 12);
    // What shows of the engine under the fairing's hem, and the four-into-one swept up the right.
    c.pad(CASE, 0.38, 0.2, 0.44, 0, 0.33, 0.04, 0.04, undefined, true);
    for (const s of [1, -1]) c.drum(CASE, 0.08, 0.05, s * 0.2, 0.33, 0.08, 'x', 10);
    for (const x of [-0.14, -0.05, 0.05, 0.14]) c.pipe(DARK, [[x, 0.46, 0.44], [x * 0.8, 0.26, 0.34], [-0.07, 0.22, 0.05]], 0.018, 6);
    c.pipe(DARK, [[-0.07, 0.22, 0.05], [-0.2, 0.24, -0.28], [-0.23, 0.3, -0.5]], 0.032, 8);
    c.tube(tint(0x3b3d40, 'alloy'), [-0.23, 0.3, -0.5], [-0.26, 0.42, -0.98], 0.045, 10, true, 0.06);
    c.drum(DARK, 0.048, 0.004, -0.26, 0.421, -0.981, 'z', 10);

    // The fairing: one loft from the nose back to the seat, painted above, white below the waist.
    const sections: [number, number, number, number][] = [
      // z, half-width, top, bottom
      [0.74, 0.055, 0.87, 0.77],
      [0.62, 0.15, 0.97, 0.56],
      [0.44, 0.23, 1.02, 0.36],
      [0.18, 0.265, 0.92, 0.23],
      [-0.08, 0.255, 0.83, 0.23],
      [-0.3, 0.21, 0.75, 0.29],
    ];
    const N = 12;
    const rings = sections.map(([z, w, top, bottom]) => {
      const row: V3[] = [];
      const cy = (top + bottom) / 2;
      const ry = (top - bottom) / 2;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2;
        const sy = Math.sin(t);
        row.push([Math.cos(t) * w * (sy < 0 ? 0.86 : 1), cy + (sy < 0 ? sy * 0.92 : sy) * ry, z]);
      }
      return row;
    });
    // Rings start on the +x flank at mid height: the upper half takes the paint, the belly runs white.
    c.grid(PAINT, rings.map((row) => row.slice(0, N / 2 + 1)), { out: [0, 0.6, 0.1], group: 'fair' });
    c.grid(WHITE, rings.map((row) => row.slice(N / 2)), { out: [0, 0.6, 0.1], group: 'fair' });
    c.poly(PAINT, rings[0].slice(0, -1), [0, 0.82, 0]);
    c.poly(DARK, rings[rings.length - 1].slice(0, -1), [0, 0.52, 0]);
    // Twin lamps in the nose under one lens, and the smoked screen above it.
    const lamp = (cx: number, cy2: number, rad: number, surface: Surface, z: number) => {
      const pts: V3[] = [];
      for (let i = 0; i < 10; i++) pts.push([cx + rad * Math.cos((i / 10) * Math.PI * 2), cy2 + rad * Math.sin((i / 10) * Math.PI * 2), z]);
      c.poly(surface, pts, [cx, cy2, z - 1]);
    };
    if (c.lo) c.tris(HEAD, [-0.1, 0.78, 0.745, 0.1, 0.88, 0.745, 0.1, 0.78, 0.745, -0.1, 0.78, 0.745, -0.1, 0.88, 0.745, 0.1, 0.88, 0.745], { flat: true });
    else {
      for (const s of [1, -1]) lamp(s * 0.052, 0.826, 0.042, HEAD, 0.746);
      lamp(0, 0.826, 0.1, LENS, 0.752);
    }
    const screen: V3[][] = [];
    for (const [z0, y0, w0] of [
      [0.58, 0.975, 0.125],
      [0.46, 1.045, 0.15],
      [0.33, 1.09, 0.165],
    ]) {
      const row: V3[] = [];
      for (let i = -2; i <= 2; i++) {
        const u = i / 2;
        row.push([u * w0, y0 - Math.abs(u) * 0.025, z0 + u * u * 0.05]);
      }
      screen.push(row);
    }
    c.grid(SMOKED, screen, { out: [0, 0.7, -0.6] });
    // Mirrors on stalks off the fairing shoulders.
    for (const s of [1, -1]) {
      c.beam(DARK, [s * 0.13, 1.0, 0.47], [s * 0.25, 1.08, 0.43], 0.014, 0.01);
      c.pad(DARK, 0.1, 0.055, 0.025, s * 0.28, 1.09, 0.42, 0.01, [0, -s * 0.2, 0]);
    }

    // Tank: a teardrop lofted from cross-sections, flowing back from the fairing.
    const tankSections: [number, number, number, number][] = [
      // z, half-width, top, bottom
      [-0.14, 0.085, 0.84, 0.76],
      [-0.08, 0.13, 0.9, 0.745],
      [0.06, 0.175, 0.95, 0.735],
      [0.22, 0.185, 0.965, 0.74],
      [0.36, 0.16, 0.945, 0.76],
      [0.44, 0.1, 0.9, 0.8],
      [0.47, 0.04, 0.87, 0.83],
    ];
    const tank = tankSections.map(([z, w, top, bottom]) => {
      const row: V3[] = [];
      const cy = (top + bottom) / 2;
      const ry = (top - bottom) / 2;
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * Math.PI * 2;
        const sy = Math.sin(t);
        row.push([Math.cos(t) * w * (sy < 0 ? 0.82 : 1), cy + (sy < 0 ? sy * 0.75 : sy) * ry, z]);
      }
      return row;
    });
    c.grid(PAINT, tank, { out: [0, 0.86, 0.15] });
    c.poly(PAINT, tank[0].slice(0, -1), [0, 0.86, 0.15]);
    c.poly(PAINT, tank[tank.length - 1].slice(0, -1), [0, 0.86, 0.15]);
    c.drum(CHROME, 0.04, 0.02, 0, 0.972, 0.22, 'y', 10);
    c.boxes(WHITE, 0.004, 0.035, 0.26, 0.182, 0.89, 0.18);

    // Seat, cowled tail, lamp, rear guard, plate bracket.
    c.pad(VINYL, 0.27, 0.09, 0.46, 0, seatTop - 0.045, -0.3, 0.035, [0.03, 0, 0]);
    c.pad(PAINT, 0.26, 0.14, 0.42, 0, 0.72, -0.72, 0.045, [0.1, 0, 0], true);
    c.pad(VINYL, 0.22, 0.06, 0.28, 0, 0.785, -0.62, 0.025, [0.08, 0, 0]);
    c.pad(PAINT, 0.24, 0.12, 0.24, 0, 0.74, -0.92, 0.035, [0.25, 0, 0], true);
    c.pad(RED_LENS, 0.15, 0.06, 0.05, 0, 0.73, -1.02, 0.015);
    c.box(TAIL, 0.11, 0.04, 0.012, 0, 0.73, -1.042);
    guard(c, tint(0x141416, 'satin'), r, -a, r + 0.045, 0.75, 2.75, 0.08);
    c.box(DARK, 0.03, 0.14, 0.012, 0, 0.56, -a - r - 0.012, [0.25, 0, 0]);
    // (A bare pane on the distant version, where the little lamp itself is dropped.)
    if (c.lo) c.tris(TAIL, [-0.07, 0.7, -1.045, 0.07, 0.76, -1.045, 0.07, 0.7, -1.045, -0.07, 0.7, -1.045, -0.07, 0.76, -1.045, 0.07, 0.76, -1.045], { flat: true });
  };
  k.cached('bike2', body);
  k.plates(Number.NaN, 0, -a - r - 0.03, 0.54, 'new', 0.6, 0.25);

  // Steering assembly, built in the pivot's own frame: y runs up the fork from the axle.
  const f = new Kit(m, color, k.paint);
  /** Offset from the front axle in ordinary (level) axes → the pivot's raked frame. */
  const lv = (x: number, y: number, z: number): V3 => [x, y * Math.cos(RAKE) - z * Math.sin(RAKE), y * Math.sin(RAKE) + z * Math.cos(RAKE)];
  f.cached('bike2-fork', (c) => {
    for (const s of [1, -1]) {
      c.tube(ALLOY, [s * 0.1, -0.02, 0], [s * 0.1, 0.3, 0], 0.03, 8, true);
      c.tube(CHROME, [s * 0.1, 0.3, 0], [s * 0.1, 0.66, 0], 0.02, 6);
      c.box(STEEL, 0.03, 0.09, 0.06, s * 0.085, 0.13, -0.05);
      // Clip-ons: from the top clamp, out and down to the grips tucked behind the fairing edge.
      c.pipe(DARK, [lv(s * 0.07, 0.62, -0.26), lv(s * 0.2, 0.6, -0.34), lv(s * 0.345, 0.575, -0.42)], 0.012, 6);
      c.tube(RUBBER, lv(s * 0.23, 0.593, -0.365), lv(s * 0.36, 0.57, -0.43), 0.017, 8);
      c.beam(ALLOY, lv(s * 0.21, 0.6, -0.31), lv(s * 0.33, 0.59, -0.33), 0.012, 0.008);
    }
    c.box(DARK, 0.26, 0.035, 0.08, 0, 0.5, 0);
    c.box(DARK, 0.26, 0.035, 0.08, 0, 0.64, 0);
    // The clocks behind the screen.
    c.pad(DARK, 0.2, 0.08, 0.06, ...lv(0, 0.72, -0.2), 0.02, [RAKE, 0, 0]);
    // Painted sports guard hugging the tyre.
    const rows: V3[][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = -1.1 + (2.1 * i) / 8;
      const at = (rad: number, x: number): V3 => [x, Math.cos(t) * rad, Math.sin(t) * rad];
      rows.push([at(r + 0.012, -0.072), at(r + 0.04, -0.042), at(r + 0.04, 0.042), at(r + 0.012, 0.072)]);
    }
    c.grid(PAINT, rows, { out: [0, 0, 0], cast: true });
    c.grid(DARK, rows, { out: [0, 0, 0], inward: true });
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
  k.nearOnly.push(steerPivot);

  // From a distance: the fairing and tank less their small parts, a plain fork, and two discs for wheels.
  const far = new Kit(m, color, k.paint, true);
  far.cached('bike2', (c) => {
    body(c);
    const top: V3 = [0, r + Math.cos(RAKE) * 0.7, a - Math.sin(RAKE) * 0.7];
    c.tube(tint(0x9a9da1, 'alloy'), [0, r, a], top, 0.05, 5, true);
    for (const wz of [a, -a]) {
      c.drum(TYRE, r, spec.wheelWidth, 0, r, wz, 'x', 8, true);
      c.drum(ALLOY, r * 0.62, spec.wheelWidth + 0.01, 0, r, wz, 'x', 8);
    }
  });

  return {
    group: k.finish(far),
    wheels: [front, rear],
    // x is a hair negative so the door-side logic treats the rider like any driver (on and off from the right).
    seats: [seat, { x: -0.001, y: seat.y + 0.05, z: -0.62 }].slice(0, spec.seats),
    headlights: k.headlights,
    taillights: k.taillights,
    bodyMaterial: k.paint,
    steerPivot,
  };
}
