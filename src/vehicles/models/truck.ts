import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { cornerLens } from './cars';
import { AMBER, CHROME, curve, DARK, dice, HEAD, LENS, PAINT, PLASTIC, RED_LENS, RUBBER, STEEL, TAIL, tint, WINDOW, type V3 } from './kit';
import { assemble, Face, handles, wipers, type CarPlan } from './parts';

/**
 * Cab-over farm truck: a rounded forward-control cab over the front axle, a bare chassis, a timber deck
 * and a slatted stock crate. About half of them are carrying a mob of sheep.
 */
export function buildFarmTruck(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const sheep = dice.chance(0.55);
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  const half = spec.width / 2; // deck and crate
  const cabW = half - 0.065;
  const zf = spec.length / 2 - 0.1; // cab face; the bumper stands proud
  const rear = -spec.length / 2 + 0.03; // back of the deck
  const cabRear = 1.48;
  const belt = 1.52;
  const ar = r + 0.1;
  const seats = [
    { x: -0.55, y: 1.14, z: 2.15 },
    { x: 0.55, y: 1.14, z: 2.15 },
  ];
  const white = tint(0xdcdcd4, 'satin');
  const plan: CarPlan = {
    shell: {
      zr: cabRear,
      zf,
      plan: curve([[cabRear, cabW], [zf, cabW - 0.025]]),
      cornerR: [0.03, 0.015],
      cornerF: [0.22, 0.14],
      shoulder: curve([[cabRear, belt], [zf - 0.15, belt], [zf, belt - 0.03]]),
      lower: curve([[cabRear, 0.8], [2.55, 0.7], [zf, 0.74]]),
      waistDrop: 0.42,
      lean: 0.02,
      tuck: 0.03,
      rS: 0.04,
      arches: [{ z: a, y: r + 0.04, r: ar }],
      flare: 0.012,
      crown: 0,
      rearDeck: null,
      frontDeck: null,
    },
    cabin: {
      rear: { zb: cabRear + 0.02, zt: cabRear + 0.08, bow: 0, kind: 'paint' },
      front: { zb: zf - 0.04, zt: zf - 0.31, bow: 0.05 },
      roof: curve([[cabRear + 0.08, 2.27], [2.2, 2.3], [zf - 0.31, 2.26]]),
      crown: 0.04,
      lean: 0.11,
      railR: 0.09,
      headerR: 0.12,
      band: 0.05,
      panes: [
        { to: [cabRear + 0.28, cabRear + 0.32], kind: 'paint' },
        { to: [zf - 0.13, zf - 0.37], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.95, z0: cabRear + 0.1, z1: zf - 0.05, seats, dash: { z: 2.67, y: belt - 0.05 }, cloth: tint(0x3d3a36, 'cloth'), back: 0.5 },
    wheel: 'truck',
    rearWheel: 'dual',
    twin: spec.wheelCount === 6,
    rearTrack: 2 * (half - spec.wheelWidth / 2 - 0.02),
    rim: 0xcfc8b0,
    dress(k, shell, cab) {
      const F = new Face(k, zf, 1);
      // Engine cover between the seats, back window in the cab's rear wall.
      k.pad(tint(0x26282b, 'satin'), 0.5, 0.36, 0.9, 0, 1.12, 2.1, 0.05);
      const zb = cabRear + 0.014;
      k.poly(WINDOW, [[-0.5, 1.72, zb], [0.5, 1.72, zb], [0.5, 2.1, zb + 0.015], [-0.5, 2.1, zb + 0.015]], [0, 1.9, zb + 3]);
      k.box(RUBBER, 1.04, 0.02, 0.012, 0, 1.71, zb - 0.004);
      k.box(RUBBER, 1.04, 0.02, 0.012, 0, 2.11, zb + 0.012);
      k.boxes(RUBBER, 0.02, 0.4, 0.012, 0.51, 1.91, zb + 0.004);

      // Face: slotted grille, round lamps in bright bezels, indicators on the corners, white bumper.
      F.box(DARK, 1.25, 0.22, 0, 1.22, 0.02, 0.004);
      for (const dy of [-0.055, 0, 0.055]) F.box(CHROME, 1.25, 0.016, 0, 1.22 + dy, 0.012, 0.014);
      F.box(CHROME, 0.14, 0.07, 0, 1.4, 0.01, 0.01);
      for (const s of [1, -1]) {
        k.drum(CHROME, 0.125, 0.03, s * 0.7, 0.98, zf - 0.006, 'z', 14);
        k.drum(HEAD, 0.1, 0.008, s * 0.7, 0.98, zf + 0.012, 'z', 14);
        const lens: V3[] = [];
        for (let i = 0; i < 12; i++) lens.push([s * 0.7 + 0.104 * Math.cos((i / 12) * Math.PI * 2), 0.98 + 0.104 * Math.sin((i / 12) * Math.PI * 2), zf + 0.02]);
        k.poly(LENS, lens, [0, 1, 0]);
      }
      cornerLens(k, shell, AMBER, zf - 0.09, 1.0, 0.1, 0.11);
      k.pad(white, spec.width - 0.02, 0.2, 0.14, 0, 0.7, zf + 0.03, 0.02, undefined, true);
      // Split screen, sun visor, wipers, mirrors on arms, cab-roof marker lamps.
      k.beam(PAINT, cab.screen(0, 0.0, 0.01), cab.screen(0, 1.0, 0.01), 0.04, 0.016);
      const v0 = cab.screen(0, 1.0, 0.02);
      k.pad(PAINT, 2 * cabW - 0.25, 0.022, 0.26, 0, v0[1] + 0.03, v0[2] + 0.1, 0.01, [0.35, 0, 0]);
      wipers(k, cab, { opposed: true, span: 0.42 });
      for (const s of [1, -1]) {
        const x = s * (shell.F(zf - 0.42, belt) + 0.17);
        k.pipe(DARK, [[s * (cabW - 0.05), 2.1, zf - 0.42], [x, 2.08, zf - 0.33], [x, 1.62, zf - 0.33], [s * (cabW - 0.02), 1.56, zf - 0.42]], 0.011, 5);
        k.box(DARK, 0.03, 0.36, 0.17, x, 1.86, zf - 0.325);
        k.box(CHROME, 0.004, 0.33, 0.14, x, 1.86, zf - 0.342);
      }
      for (const x of [-0.3, 0, 0.3]) k.box(AMBER, 0.07, 0.03, 0.04, x, cab.roofY(zf - 0.5) - 0.012, zf - 0.47);
      // Doors: shut lines, handle, a step under each.
      shell.vline(k, DARK, cabRear + 0.2, 1.0, belt);
      shell.vline(k, DARK, zf - 0.26, 0.76, belt);
      shell.hline(k, DARK, 0.76, zf - 0.6, zf - 0.26);
      handles(k, shell, [cabRear + 0.36], 1.38, PLASTIC);
      k.boxes(DARK, 0.14, 0.035, 0.4, cabW - 0.02, 0.6, zf - 0.45);
      k.boxes(DARK, 0.02, 0.14, 0.03, cabW - 0.03, 0.67, zf - 0.6);

      // Chassis: rails, cross members, engine, fuel tank, battery box, axles, propshaft, exhaust.
      const chassisLen = cabRear + 0.9 - rear - 0.06;
      k.boxes(DARK, 0.09, 0.22, chassisLen, 0.43, 0.9, (cabRear + 0.9 + rear + 0.06) / 2, undefined, true);
      for (const z of [rear + 0.2, -a - 0.9, -a + 0.9, 0.3]) k.box(DARK, 0.8, 0.12, 0.09, 0, 0.9, z);
      k.box(DARK, 0.7, 0.55, 1.0, 0, 0.72, a + 0.35);
      k.drum(STEEL, 0.23, 0.9, half - 0.36, 0.72, 0.55, 'z', 12, true);
      for (const z of [0.3, 0.8]) k.box(DARK, 0.5, 0.03, 0.05, half - 0.36, 0.72 + 0.235, z);
      k.box(DARK, 0.36, 0.3, 0.6, -(half - 0.34), 0.74, 0.55);
      k.box(DARK, 1.55, 0.18, 0.18, 0, r, -a);
      k.ball(DARK, 0.22, 0, r, -a, 1, 1, 8);
      k.box(DARK, 1.6, 0.1, 0.1, 0, r, a);
      k.tube(STEEL, [0, r + 0.05, -a + 0.2], [0, 0.62, a - 0.5], 0.045, 6);
      k.pipe(STEEL, [[-0.3, 0.6, a - 0.3], [-0.62, 0.52, 0.6], [-0.62, 0.52, -0.9]], 0.04, 6);
      // Guards over the twin rears, flaps, tail-lamp bar.
      for (const s of [1, -1]) {
        const rows: V3[][] = [];
        for (let i = 0; i <= 6; i++) {
          const t = Math.PI * (0.12 + (0.76 * i) / 6);
          const y = r + 0.02 + (r + 0.09) * Math.sin(t);
          const z = -a + (r + 0.09) * Math.cos(t);
          rows.push([
            [s * (half - 0.005), y, z],
            [s * (half - 0.63), y, z],
          ]);
        }
        k.grid(DARK, rows, { out: [s * (half - 0.3), r, -a] });
        k.grid(DARK, rows, { out: [s * (half - 0.3), r, -a], inward: true });
      }
      k.boxes(DARK, 0.6, 0.42, 0.02, half - 0.31, 0.5, -a - r - 0.1);
      k.box(DARK, spec.width - 0.1, 0.11, 0.06, 0, 0.84, rear + 0.05);
      const tx = half - 0.26;
      k.boxes(RED_LENS, 0.28, 0.085, 0.03, tx, 0.84, rear + 0.015);
      k.boxes(TAIL, 0.13, 0.062, 0.03, tx + 0.06, 0.84, rear + 0.008);
      k.boxes(AMBER, 0.08, 0.062, 0.03, tx - 0.07, 0.84, rear + 0.008);

      // Timber deck and stock crate.
      const timber = m.get('timber', { color: 0xb3a68e });
      const deckTop = 1.14;
      const deckFront = cabRear - 0.1;
      k.slab(timber, spec.width, 0.09, deckFront - rear, 0, deckTop - 0.045, (deckFront + rear) / 2);
      k.boxes(STEEL, 0.03, 0.1, deckFront - rear, half - 0.01, deckTop - 0.05, (deckFront + rear) / 2);
      const crateH = spec.height - deckTop - 0.035;
      const z0 = deckFront - 0.06;
      const z1 = rear + 0.05;
      const posts = 5;
      const px = half - 0.04;
      for (let i = 0; i < posts; i++) {
        const z = z0 + ((z1 - z0) * i) / (posts - 1);
        for (const s of [1, -1]) k.plank(timber, 0.07, crateH, 0.09, s * px, deckTop + crateH / 2, z);
      }
      for (const y of [0.09, 0.3, 0.52, 0.76, 1.02, 1.3, crateH - 0.07]) {
        for (const s of [1, -1]) k.plank(timber, 0.028, 0.13, z0 - z1 + 0.06, s * (px - 0.05), deckTop + y, (z0 + z1) / 2);
        k.plank(timber, 2 * px - 0.1, 0.13, 0.028, 0, deckTop + y, z1 + 0.05);
      }
      // Headboard is close-boarded; the tailgate is two leaves with a brace each.
      for (let i = 0; i < 4; i++) k.plank(timber, 2 * px - 0.1, crateH / 4 - 0.03, 0.03, 0, deckTop + (crateH * (i + 0.5)) / 4, z0 - 0.05);
      k.plank(timber, 0.07, crateH, 0.05, 0, deckTop + crateH / 2, z1 + 0.02);
      for (const s of [1, -1]) k.brace(timber, [s * (px - 0.1), deckTop + 0.12, z1 + 0.02], [s * 0.08, deckTop + crateH - 0.12, z1 + 0.02], 0.1, 0.028);
      for (let i = 1; i < posts - 1; i++) k.plank(timber, 2 * px, 0.06, 0.07, 0, deckTop + crateH + 0.005, z0 + ((z1 - z0) * i) / (posts - 1));

      if (sheep) {
        // A mob of sheep, seen as wool between the rails.
        const wool = tint(0xe3dbc6, 'cloth');
        const face = tint(0xbfb39c, 'cloth');
        for (let row = 0; row < 4; row++) {
          for (const s of [1, -1]) {
            const z = z0 - 0.75 - row * 1.06 + dice.range(-0.12, 0.12);
            const x = s * (0.46 + dice.range(-0.08, 0.08));
            const fwd = dice.chance(0.5) ? 1 : -1;
            k.pad(wool, 0.46, 0.44, 0.84, x, deckTop + 0.52, z, 0.14, undefined, true);
            k.pad(face, 0.15, 0.17, 0.24, x, deckTop + 0.76, z + fwd * 0.46, 0.05);
            for (const e of [1, -1]) k.box(face, 0.05, 0.03, 0.09, x + e * 0.1, deckTop + 0.8, z + fwd * 0.4, [0, 0, e * 0.5]);
            for (const [lx, lz] of [
              [-0.13, -0.26],
              [0.13, -0.26],
              [-0.13, 0.26],
              [0.13, 0.26],
            ]) {
              k.box(face, 0.045, 0.3, 0.045, x + lx, deckTop + 0.15, z + lz);
            }
          }
        }
      }
    },
  };
  return assemble(spec, color, m, `truck|${sheep}`, plan, (k) => k.plates(zf + 0.105, 0.7, rear + 0.018, 0.84)).model;
}
