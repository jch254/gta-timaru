import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { BRIGHT, curve, DARK, dice, GREY, RUBBER, smooth, STEEL, tint } from './kit';
import { aerial, assemble, exhaust, Face, fuelFlap, handles, mirrors, TIRED, towbar, wipers, type CarPlan } from './parts';

const GALV = tint(0xa8aba2, 'steel');

/**
 * Land Rover Series III 88 in class farm hack: flat aluminium panels over a steel chassis, a near-vertical
 * windscreen, round headlamps in a flat face beside the raised bonnet with the spare wheel strapped on it,
 * exposed door hinges, galvanised cappings, a flat tail with a drop-down door. High, slow, faded.
 */
export function buildLandRover(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const tow = dice.chance(0.6);
  const W = spec.width / 2;
  const r = spec.wheelRadius;
  const ax = spec.wheelbase / 2;
  const ar = r + 0.1;
  const zf = spec.length / 2 - 0.04;
  const zr = -spec.length / 2 + 0.06;
  const belt = 1.0;
  const seats = [
    { x: -0.38, y: 0.85, z: 0.0 },
    { x: 0.38, y: 0.85, z: 0.0 },
  ];
  const plan: CarPlan = {
    shell: {
      zr,
      zf,
      // Dead flat panels: constant width, no barrel, upright sides.
      plan: curve([[zr, W - 0.025], [zf, W - 0.035]]),
      cornerR: [0.05, 0.03],
      cornerF: [0.09, 0.05],
      shoulder: curve([[zr, belt], [zf, belt - 0.015]]),
      lower: curve([[zr, 0.52], [0, 0.5], [zf, 0.52]]),
      waistDrop: 0.24,
      lean: 0.01,
      tuck: 0.004,
      rS: 0.025,
      barrel: 0.002,
      arches: [
        { z: -ax, y: r + 0.02, r: ar },
        { z: ax, y: r + 0.02, r: ar },
      ],
      flare: 0.008,
      crown: 0.015,
      // The bonnet rides as a raised centre panel between the flat wing tops, right out to the nose.
      hump: (z, x) => 0.07 * smooth(0.4, 0.3, x) * smooth(0.58, 0.72, z),
      rearDeck: null,
      frontDeck: [0.55, zf],
      deckBow: [0, 0.02],
      stations: [0.52, 0.56],
    },
    cabin: {
      rear: { zb: zr + 0.03, zt: zr + 0.08, bow: 0 },
      front: { zb: 0.55, zt: 0.44, bow: 0.01 },
      roof: curve([[zr + 0.08, 1.9], [0.44, 1.9]]),
      crown: 0.04,
      lean: 0.03,
      railR: 0.045,
      headerR: 0.05,
      band: 0.04,
      split: 0.8,
      panes: [
        { to: [-1.0, -1.0], kind: 'glass' },
        { to: [-0.52, -0.52], kind: 'paint' },
        { to: [0.52, 0.5], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
      gutter: GALV,
    },
    interior: { floor: 0.5, z0: -0.6, z1: 0.5, seats, dash: { z: 0.35, y: 0.98 }, cargo: { y: 0.62, z: -1.55 }, cloth: tint(0x4a4a42, 'cloth'), back: 0.5, headrests: false, console: false },
    wheel: 'steel',
    rim: 0xd8d6c8,
    belly: 0.24,
    ageing: TIRED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');

      // Flat face: round lamps in the wing fronts, a recessed mesh grille between under the bonnet lip.
      F.roundLamps(0.52, 0.78, 0.09, 0.05);
      F.grille(0, 0.78, 0.46, 0.3, { bars: 5, surface: GREY, depth: 0.05, badge: [0.09, 0.05] });
      k.boxes(tint(0xe3dcc6, 'gloss'), 0.1, 0.05, 0.02, 0.3, 0.6, zf + 0.004);
      // Channel-steel bumper the full width of the nose.
      k.box(GALV, spec.width - 0.02, 0.1, 0.1, 0, 0.5, zf + 0.08, undefined, true);
      k.boxes(DARK, 0.09, 0.06, 0.05, 0.42, 0.56, zf + 0.06);
      // The spare on the bonnet.
      const sy = shell.deckY(1.02, 0) + 0.004;
      k.drum(tint(0x161616, 'rubber'), 0.3, 0.17, 0, sy + 0.085, 1.02, 'y', 14, true);
      k.drum(GALV, 0.17, 0.18, 0, sy + 0.085, 1.02, 'y', 10);
      k.drum(DARK, 0.05, 0.2, 0, sy + 0.085, 1.02, 'y', 6);
      // Bonnet shut lines along the raised panel, and its latches.
      shell.deckLine(k, DARK, (z) => 0.345 * smooth(0.5, 0.62, z) + 0.4 * smooth(0.62, 0.5, z), 0.57, zf - 0.02);
      for (const s of [1, -1]) k.box(DARK, 0.03, 0.03, 0.08, s * 0.37, shell.deckY(0.8, 0.37) + 0.065, 0.8);

      // Doors: shut lines, exposed hinges, handles, galvanised cappings along the belt.
      scuttleVents(k, cab);
      shell.vline(k, DARK, 0.52, 0.55, belt);
      shell.vline(k, DARK, -0.5, 0.55, belt);
      shell.hline(k, DARK, 0.545, -0.5, 0.52);
      shell.hline(k, GALV, belt - 0.008, zr + 0.06, 0.54, 0.018);
      for (const [z, y] of [
        [0.47, 0.66],
        [0.47, 0.9],
        [-0.555, 0.66],
        [-0.555, 0.9],
      ]) {
        k.boxes(GALV, 0.022, 0.09, 0.03, shell.F(z, y) + 0.008, y, z);
      }
      handles(k, shell, [-0.38], 0.86, STEEL, true);
      mirrors(k, shell, 0.5, 1.1, STEEL, 0.12, 0.12);
      wipers(k, cab, { opposed: true, span: 0.3 });
      aerial(k, -(shell.sx(0.7) - 0.05), shell.deckY(0.7, shell.sx(0.7) - 0.05), 0.7, 0.5);
      fuelFlap(k, shell, -0.9, 0.72, 1, 0.12, 0.11);
      // Body seam where the tub meets the bulkhead, both flanks.
      shell.vline(k, DARK, -1.4, 0.56, belt - 0.03, 0.007);

      // Flat tail: drop-down door with its hinges and handle, small lamps, the tow bar most of them wear.
      R.both(DARK, 0.008, 0.42, 0.33, 0.74, 0.006, 0.003);
      R.box(DARK, 0.66, 0.008, 0, 0.955, 0.006, 0.003);
      R.box(STEEL, 0.14, 0.035, 0, 0.6, 0.014, 0.012);
      for (const s of [1, -1]) k.box(GALV, 0.022, 0.09, 0.03, s * 0.36, 0.56, zr - 0.012);
      R.taillamps(0.56, 0.74, 0.1, 0.24, { upright: true, reverse: false });
      k.box(GALV, spec.width - 0.06, 0.09, 0.08, 0, 0.48, zr - 0.03, undefined, true);
      if (tow) towbar(k, zr - 0.08, 0.42);
      exhaust(k, 0.42, 0.4, zr - 0.02, 0.022, 0.2, STEEL);

      // Leaf-sprung live axles and the chassis rails you can see under a Land Rover.
      k.boxes(DARK, 0.08, 0.14, spec.length - 1.0, 0.4, 0.42, 0, undefined, true);
      for (const z of [-ax, ax]) {
        k.box(DARK, 1.5, 0.16, 0.16, 0, r - 0.02, z);
        k.ball(DARK, 0.17, 0, r - 0.02, z, 1, 1, 8);
        for (const s of [1, -1]) k.box(DARK, 0.06, 0.05, 1.1, s * 0.52, r + 0.08, z);
      }
      k.tube(DARK, [0, r + 0.05, -ax + 0.2], [0, 0.4, 0.2], 0.04, 6);
    },
  };
  return assemble(spec, color, m, `landrover1|${tow}`, plan, (k) => k.plates(Number.NaN, 0, zr - 0.075, 0.78, 'old')).model;
}

/** The flat scuttle vents under the windscreen that give the Series away. */
function scuttleVents(k: import('./kit').Kit, cab: import('./body').Cabin): void {
  if (k.lo) return;
  for (const s of [1, -1]) {
    const p = cab.screen(s * 0.55, 0, 0.004);
    k.box(GREY, 0.26, 0.016, 0.1, p[0], p[1] - 0.045, p[2] + 0.1, [0.5, 0, 0]);
  }
  const q = cab.screen(0, 0, 0.004);
  k.box(BRIGHT, 0.04, 0.02, 0.02, 0, q[1] - 0.02, q[2] + 0.04);
}
