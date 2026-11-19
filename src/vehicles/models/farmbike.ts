import * as THREE from 'three';
import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { ALLOY, DARK, HEAD, Kit, PAINT, RED_LENS, RUBBER, STEEL, TAIL, tint, type Pt, type V3 } from './kit';
import { FARM, stanceOf, weather } from './parts';
import { guard, ring } from './bike';

/** Steering-head rake (radians from vertical): trail bikes run more rake than the road 750. */
const RAKE = 0.5;

const TYRE = tint(0x14140f, 'rubber');
const WHITE = tint(0xe8e5da, 'gloss');
const VINYL = tint(0x1a1a1b, 'satin');
const ENGINE = tint(0x8b8e92, 'alloy');

/** Narrow knobbly trail wheel: tall thin tyre with blocky knobs, wire spokes, a small drum hub. */
function trailWheel(k: Kit, radius: number, width: number): THREE.Mesh {
  return k.mesh(`trailwheel|${radius}|${width}`, (w) => {
    const rim = radius - 0.08;
    const profile: Pt[] = [[rim, -width * 0.8], [radius - 0.014, -width], [radius, 0], [radius - 0.014, width], [rim, width * 0.8]];
    ring(w, TYRE, profile, 16, 'tyre');
    ring(w, ALLOY, [[rim, width * 0.8], [rim - 0.016, 0], [rim, -width * 0.8]], 16, 'rim');
    // Knobs round the tread, staggered left and right.
    for (let i = 0; i < 14; i++) {
      const g = new THREE.BoxGeometry(0.05, 0.026, 0.045).translate(i % 2 ? 0.014 : -0.014, radius - 0.008, 0).rotateX((i * Math.PI * 2) / 14);
      w.geo(TYRE, g, { flat: true });
    }
    // Wire spokes to a small hub, a brake drum on the left.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const s = i % 2 ? 1 : -1;
      w.beam(STEEL, [s * 0.028, 0, 0], [0, (rim - 0.01) * Math.cos(a), (rim - 0.01) * Math.sin(a)], 0.005, 0.005);
    }
    w.drum(STEEL, 0.035, 0.09, 0, 0, 0, 'x', 8);
    w.drum(ALLOY, 0.075, 0.05, -0.01, 0, 0, 'x', 10);
  });
}

/**
 * Honda XR200 class farm bike: a high-fendered trail single with a long flat seat, high braced bars,
 * red tank and white side panels, a high pipe with a heat shield and a carrier rack on the back.
 * The fork, fender, lamp and bars hang off `steerPivot`. Returns `wheels` as [front, rear].
 */
export function buildFarmBike(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const k = new Kit(m, color, undefined, false, weather(FARM), stanceOf(spec));
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  const seat = { x: -0.001, y: 0.5, z: -0.18 };

  const body = (c: Kit) => {
    const frame = tint(0x201f1e, 'satin');
    const head: V3 = [0, r + Math.cos(RAKE) * 0.58, a - Math.sin(RAKE) * 0.58];
    // Frame: backbone to the seat, single downtube to the cradle, subframe and stays.
    c.tube(frame, head, [0, 0.76, -0.2], 0.026, 6, true);
    c.tube(frame, [0, head[1] - 0.02, head[2] + 0.02], [0, 0.32, 0.3], 0.024, 6, true);
    c.tube(frame, [0, 0.32, 0.3], [0, 0.3, -0.12], 0.02, 5);
    for (const s of [1, -1]) {
      c.tube(frame, [s * 0.1, 0.76, -0.25], [s * 0.12, 0.3, -0.14], 0.013, 5);
      c.tube(frame, [s * 0.1, 0.74, -0.68], [s * 0.1, 0.78, -0.3], 0.013, 5);
      c.tube(frame, [s * 0.12, 0.38, -0.2], [s * 0.1, 0.73, -0.62], 0.012, 5);
      // Swingarm and the long rear shocks.
      c.beam(frame, [s * 0.09, 0.36, -0.16], [s * 0.08, r, -a - 0.02], 0.028, 0.05, true);
      c.tube(tint(0xb8352a, 'satin'), [s * 0.1, r + 0.1, -a + 0.08], [s * 0.1, 0.72, -0.5], 0.022, 6);
      // Footpegs.
      c.tube(frame, [s * 0.1, 0.3, -0.1], [s * 0.24, 0.3, -0.1], 0.012, 5);
    }
    // Chain on the left, kick lever and rear brake on the right.
    c.box(DARK, 0.012, 0.028, a - 0.14, 0.1, 0.33, -(a + 0.1) / 2, [0.06, 0, 0]);
    c.drum(STEEL, 0.085, 0.008, 0.1, r, -a, 'x', 10);
    c.pipe(DARK, [[-0.13, 0.42, 0.02], [-0.2, 0.44, -0.04], [-0.2, 0.34, -0.12]], 0.01, 5);

    // Engine: a small air-cooled single leaning forward in the cradle.
    c.pad(ENGINE, 0.26, 0.22, 0.3, 0, 0.42, 0.06, 0.03, undefined, true);
    for (const s of [1, -1]) c.drum(tint(0xa4a7ab, 'alloy'), 0.07, 0.04, s * 0.14, 0.42, 0.02, 'x', 10);
    for (let i = 0; i < 4; i++) c.box(i % 2 ? ENGINE : DARK, 0.17, 0.035, 0.16, 0, 0.54 + i * 0.038, 0.12 + i * 0.012, [0.2, 0, 0]);
    // High pipe: header round the right side up to a shielded muffler.
    c.pipe(STEEL, [[0, 0.6, 0.22], [-0.1, 0.4, 0.3], [-0.15, 0.42, 0.1], [-0.16, 0.58, -0.3]], 0.018, 6);
    c.tube(DARK, [-0.16, 0.58, -0.3], [-0.15, 0.66, -0.72], 0.034, 7, true, 0.04);
    for (const dz of [-0.4, -0.52]) c.box(tint(0x3f4144, 'matte'), 0.015, 0.05, 0.1, -0.19, 0.61, dz, [0, 0, -0.15]);

    // Tank: small and round-shouldered, in the body colour.
    const sections: [number, number, number, number][] = [
      [0.02, 0.09, 0.84, 0.74],
      [0.12, 0.14, 0.9, 0.72],
      [0.26, 0.15, 0.92, 0.7],
      [0.38, 0.11, 0.88, 0.72],
      [0.45, 0.05, 0.84, 0.76],
    ];
    const tank = sections.map(([z, w, top, bottom]) => {
      const row: V3[] = [];
      const cy = (top + bottom) / 2;
      const ry = (top - bottom) / 2;
      for (let i = 0; i <= 10; i++) {
        const t = (i / 10) * Math.PI * 2;
        const sy = Math.sin(t);
        row.push([Math.cos(t) * w * (sy < 0 ? 0.8 : 1), cy + (sy < 0 ? sy * 0.7 : sy) * ry, z]);
      }
      return row;
    });
    c.grid(PAINT, tank, { out: [0, 0.8, 0.2] });
    c.poly(PAINT, tank[0].slice(0, -1), [0, 0.8, 0.2]);
    c.poly(PAINT, tank[tank.length - 1].slice(0, -1), [0, 0.8, 0.2]);

    // Long flat seat, white side panels, rear guard with a plastic tail, lamp, carrier rack.
    c.pad(VINYL, 0.24, 0.09, 0.88, 0, 0.785, -0.22, 0.035, [0.02, 0, 0], true);
    for (const s of [1, -1]) c.pad(WHITE, 0.028, 0.15, 0.24, s * 0.125, 0.61, -0.4, 0.012, [0, 0, s * 0.2]);
    guard(c, PAINT, r, -a, r + 0.06, 0.85, 2.6, 0.07);
    c.pad(PAINT, 0.14, 0.04, 0.3, 0, 0.72, -0.88, 0.018, [0.35, 0, 0], true);
    c.pad(RED_LENS, 0.1, 0.05, 0.04, 0, 0.68, -0.99, 0.012);
    c.box(TAIL, 0.08, 0.035, 0.01, 0, 0.68, -1.008);
    if (c.lo) {
      c.tris(TAIL, [-0.05, 0.66, -1.01, 0.05, 0.71, -1.01, 0.05, 0.66, -1.01, -0.05, 0.66, -1.01, -0.05, 0.71, -1.01, 0.05, 0.71, -1.01], { flat: true });
      c.tris(HEAD, [-0.06, 0.74, 0.76, 0.06, 0.86, 0.76, 0.06, 0.74, 0.76, -0.06, 0.74, 0.76, -0.06, 0.86, 0.76, 0.06, 0.86, 0.76], { flat: true });
    }
    // Carrier rack over the guard: a small flat tray on short legs, tight to the seat's tail.
    c.box(DARK, 0.24, 0.012, 0.26, 0, 0.775, -0.79);
    for (const s of [1, -1]) {
      c.box(DARK, 0.016, 0.012, 0.3, s * 0.13, 0.775, -0.79);
      c.tube(DARK, [s * 0.12, 0.775, -0.68], [s * 0.09, 0.72, -0.64], 0.007, 4);
      c.tube(DARK, [s * 0.12, 0.775, -0.9], [s * 0.08, 0.7, -0.88], 0.007, 4);
    }
    c.box(DARK, 0.27, 0.014, 0.018, 0, 0.775, -0.92);
  };
  k.cached('farmbike2', body);
  k.plates(Number.NaN, 0, -a - r + 0.06, 0.56, 'new', 0.5, 0.35);

  // Steering assembly: long fork, high braced bars, the high fender and the little lamp.
  const f = new Kit(m, color, k.paint);
  const lv = (x: number, y: number, z: number): V3 => [x, y * Math.cos(RAKE) - z * Math.sin(RAKE), y * Math.sin(RAKE) + z * Math.cos(RAKE)];
  f.cached('farmbike1-fork', (c) => {
    for (const s of [1, -1]) {
      c.tube(ALLOY, [s * 0.075, -0.02, 0], [s * 0.075, 0.34, 0], 0.024, 7, true);
      c.tube(tint(0xd8d8d2, 'steel'), [s * 0.075, 0.34, 0], [s * 0.075, 0.64, 0], 0.016, 6);
      // Rubber gaiters on the stanchions.
      for (let i = 0; i < 4; i++) c.drum(RUBBER, 0.027, 0.02, s * 0.075, 0.36 + i * 0.045, 0, 'y', 7);
      // Bars: up and back from the clamp to high grips, with levers.
      c.pipe(tint(0x9a9da1, 'steel'), [lv(s * 0.05, 0.6, -0.04), lv(s * 0.2, 0.74, -0.12), lv(s * 0.37, 0.75, -0.22)], 0.011, 5);
      c.tube(RUBBER, lv(s * 0.26, 0.748, -0.165), lv(s * 0.38, 0.75, -0.225), 0.016, 7);
      c.beam(ALLOY, lv(s * 0.24, 0.76, -0.12), lv(s * 0.36, 0.77, -0.16), 0.01, 0.007);
    }
    c.box(DARK, 0.21, 0.03, 0.07, 0, 0.6, 0);
    c.box(DARK, 0.21, 0.03, 0.07, 0, 0.44, 0);
    // Crossbar with its pad.
    const cb0 = lv(-0.15, 0.73, -0.1);
    const cb1 = lv(0.15, 0.73, -0.1);
    c.tube(tint(0x9a9da1, 'steel'), cb0, cb1, 0.009, 5);
    c.pad(VINYL, 0.16, 0.045, 0.045, ...lv(0, 0.73, -0.1), 0.015);
    // High fender well clear of the knobbly.
    const rows: V3[][] = [];
    for (let i = 0; i <= 7; i++) {
      const t = -0.6 + (1.9 * i) / 7;
      const at = (rad: number, x: number): V3 => [x, Math.cos(t) * rad, Math.sin(t) * rad];
      rows.push([at(r + 0.1, -0.065), at(r + 0.13, -0.035), at(r + 0.13, 0.035), at(r + 0.1, 0.065)]);
    }
    c.grid(PAINT, rows, { out: [0, 0, 0], cast: true });
    c.grid(DARK, rows, { out: [0, 0, 0], inward: true });
    // Small round lamp on a number board above the fender.
    c.pad(PAINT, 0.17, 0.2, 0.045, ...lv(0, 0.5, -0.09), 0.015, [RAKE, 0, 0]);
    const lens: V3[] = [];
    for (let i = 0; i < 10; i++) lens.push(lv(0.055 * Math.cos((i / 10) * Math.PI * 2), 0.5 + 0.055 * Math.sin((i / 10) * Math.PI * 2), -0.06));
    c.poly(HEAD, lens, lv(0, 0.5, -1));
  });
  const steerPivot = f.finish();
  steerPivot.position.set(0, r, a);
  steerPivot.rotation.x = -RAKE;
  k.group.add(steerPivot);

  const front = new THREE.Group();
  front.add(trailWheel(k, r, spec.wheelWidth));
  const rear = new THREE.Group();
  rear.add(trailWheel(k, r, spec.wheelWidth * 1.4));
  front.position.set(0, r, a);
  rear.position.set(0, r, -a);
  k.group.add(front, rear);
  k.nearOnly.push(steerPivot);

  // From a distance: the same frame less its small parts, a plain fork, and two discs for wheels.
  const far = new Kit(m, color, k.paint, true);
  far.cached('farmbike2', (c) => {
    body(c);
    const top: V3 = [0, r + Math.cos(RAKE) * 0.7, a - Math.sin(RAKE) * 0.7];
    c.tube(tint(0x9a9da1, 'alloy'), [0, r, a], top, 0.045, 5, true);
    c.box(DARK, 0.6, 0.04, 0.04, 0, top[1] + 0.04, top[2] - 0.1);
    for (const wz of [a, -a]) {
      c.drum(TYRE, r, spec.wheelWidth + 0.02, 0, r, wz, 'x', 8, true);
      c.drum(STEEL, r * 0.6, spec.wheelWidth + 0.03, 0, r, wz, 'x', 8);
    }
  });

  return {
    group: k.finish(far),
    wheels: [front, rear],
    // x is a hair negative so the door-side logic treats the rider like any driver (on and off from the right).
    seats: [seat].slice(0, spec.seats),
    headlights: k.headlights,
    taillights: k.taillights,
    bodyMaterial: k.paint,
    steerPivot,
  };
}
