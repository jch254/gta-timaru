import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { AMBER, CHROME, curve, DARK, dice, Kit, PAINT, PLASTIC, RUBBER, STEEL, tint, type Pt, type V3, type WheelStyle } from './kit';
import { aerial, assemble, bumper, cornerLens, exhaust, Face, FARM, fuelFlap, handles, mirrors, mudflaps, scuttle, shadeBand, wipers, type CarPlan } from './parts';

/**
 * Toyota Hilux fourth-generation 2WD class one-tonne ute: a straight, simple single cab over a long
 * wellside tray, rectangular lamps in a flat face, low on small wheels. What rides in the tray varies:
 * nothing, a heading dog, a dog box, or a couple of bales (and the dog). Some wear a headboard hoop or a
 * bull bar, and there is always a tow bar.
 */
export function buildUte(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const hoop = dice.chance(0.55);
  const bull = dice.chance(0.35);
  const roll = dice.next();
  const cargo = roll <= 0.28 ? 0 : roll <= 0.55 ? 1 : roll <= 0.8 ? 2 : 3;
  // White steel wheels mostly; some in grey primer, a few with the dealer's chrome caps and trim rings.
  const wheels: [WheelStyle, number][] = [['steel', 0xe4e4dc], ['steel', 0xe4e4dc], ['steel', 0x6f7376], ['dish', 0xd8d8d0]];
  const wheel = wheels[dice.int(0, wheels.length - 1)];

  const W = spec.width / 2;
  const r = spec.wheelRadius;
  const ax = spec.wheelbase / 2;
  const ar = r + 0.07;
  const zf = spec.length / 2 - 0.08;
  const zr = -spec.length / 2 + 0.07;
  const top = spec.height;
  const cabRear = -0.42;
  const floor = 0.66;
  const seats = [
    { x: -0.36, y: 0.45, z: 0.05 },
    { x: 0.36, y: 0.45, z: 0.05 },
  ];
  const steel = tint(0xd6d6ce, 'satin');
  const liner = tint(0x4a4d50, 'matte');

  const plan: CarPlan = {
    shell: {
      zr,
      zf,
      // Straight, slab-sided: barely any plan shape until the nose pulls in.
      plan: curve([[zr, W - 0.022], [0, W - 0.012], [1.4, W - 0.018], [zf, W - 0.055]]),
      cornerR: [0.03, 0.012],
      cornerF: [0.13, 0.08],
      shoulder: curve([[zr, 0.955], [cabRear, 0.96], [0.95, 0.945], [1.6, 0.89], [zf, 0.835]]),
      lower: curve([[zr, 0.5], [-ax - 0.5, 0.46], [-ax + 0.5, 0.41], [cabRear, 0.35], [ax + 0.5, 0.35], [zf - 0.2, 0.39], [zf, 0.45]]),
      waistDrop: 0.16,
      lean: 0.06,
      tuck: 0.03,
      rS: 0.022,
      arches: [
        { z: -ax, y: r + 0.02, r: ar },
        { z: ax, y: r + 0.02, r: ar },
      ],
      flare: 0.02,
      crown: 0.022,
      rearDeck: null,
      frontDeck: [0.93, zf],
      deckBow: [0, 0.05],
      stations: [cabRear - 0.05, zr + 0.05],
    },
    cabin: {
      rear: { zb: cabRear + 0.02, zt: cabRear + 0.08, bow: 0 },
      front: { zb: 0.95, zt: 0.44, bow: 0.04 },
      roof: curve([[cabRear + 0.08, top - 0.045], [0.05, top - 0.028], [0.44, top - 0.042]]),
      crown: 0.022,
      lean: 0.11,
      railR: 0.045,
      headerR: 0.075,
      band: 0.035,
      panes: [
        { to: [-0.22, -0.185], kind: 'paint' },
        { to: [0.88, 0.395], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.4, z0: cabRear + 0.07, z1: 0.95, seats, dash: { z: 0.5, y: 0.9 }, cloth: tint(0x565a5e, 'cloth'), back: 0.5 },
    wheel: wheel[0],
    rim: wheel[1],
    belly: 0.2,
    ageing: FARM,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      const mid = (zr + cabRear) / 2;

      // Tray: capping, inner skins, floor, headboard, tailgate, wheel boxes.
      const z0 = zr + 0.05;
      const z1 = cabRear - 0.05;
      const xi = (z: number) => shell.sx(z) - 0.04;
      const walls: V3[][] = [];
      for (let i = 0; i <= 6; i++) {
        const z = z0 + ((z1 - z0) * i) / 6;
        walls.push([
          [shell.sx(z), shell.yS(z) + 0.001, z],
          [xi(z), shell.yS(z) + 0.001, z],
          [xi(z), floor, z],
        ]);
      }
      k.grid(PAINT, walls, { out: [4, -8, mid], mirror: true, flat: true });
      for (const [z, face, edge] of [
        [z1, 1, cabRear - 0.012],
        [z0, -1, zr],
      ]) {
        const x = xi(z);
        const y = shell.yS(z) + 0.001;
        k.poly(PAINT, [[-x, floor, z], [x, floor, z], [x, y, z], [-x, y, z]], [0, 0.8, z + face * 3]);
        k.poly(PAINT, [[-shell.sx(z), y, z], [shell.sx(z), y, z], [shell.sx(z), y, edge], [-shell.sx(z), y, edge]], [0, -3, z]);
      }
      // The back of the headboard, seen through the gap behind the cab.
      k.poly(PAINT, [[-shell.sx(z1), 0.5, cabRear - 0.012], [shell.sx(z1), 0.5, cabRear - 0.012], [shell.sx(z1), 0.961, cabRear - 0.012], [-shell.sx(z1), 0.961, cabRear - 0.012]], [0, 0.8, zr]);
      k.poly(liner, [[-xi(z0), floor, z0], [xi(z0), floor, z0], [xi(z1), floor, z1], [-xi(z1), floor, z1]], [0, -3, mid]);
      // Wheel boxes: wide enough to bury the arch liners, which stand higher than the tray floor.
      k.boxes(PAINT, 0.3, 0.8 - floor, 0.88, xi(-ax) - 0.15, (0.8 + floor) / 2, -ax);
      // Rope rails under the lip.
      for (const s of [1, -1]) {
        const p = (z: number): V3 => [s * (shell.F(z, 0.88) + 0.018), 0.885, z];
        k.tube(DARK, p(z0 + 0.08), p(z1 - 0.06), 0.008, 5);
        for (const z of [z0 + 0.1, mid, z1 - 0.08]) k.box(DARK, 0.03, 0.02, 0.02, s * (shell.F(z, 0.88) + 0.008), 0.885, z);
      }
      // Gap between cab and tray.
      shell.vline(k, DARK, cabRear - 0.006, 0.37, 0.96, 0.026);

      // Tailgate: shut lines, handle, upright lamps, then a steel step bumper with the tow bar.
      const xe = shell.P(zr) - 0.02;
      R.both(DARK, 0.008, 0.42, xe - 0.11, 0.74, 0.006, 0.003);
      R.box(DARK, 2 * xe - 0.22, 0.008, 0, 0.535, 0.006, 0.003);
      R.box(PLASTIC, 0.17, 0.04, 0, 0.885, 0.014, 0.01);
      R.taillamps(xe - 0.045, 0.74, 0.08, 0.28, { upright: true });
      k.pad(steel, 2 * W, 0.1, 0.13, 0, 0.45, zr - 0.035, 0.015);
      k.box(DARK, 0.5, 0.012, 0.1, 0, 0.502, zr - 0.04);
      k.box(DARK, 0.07, 0.05, 0.22, 0, 0.38, zr - 0.06);
      k.ball(CHROME, 0.026, 0, 0.435, zr - 0.145, 1, 1, 8);
      k.tube(CHROME, [0, 0.4, zr - 0.145], [0, 0.425, zr - 0.145], 0.012, 6);
      mudflaps(k, spec.track / 2, -ax - ar - 0.04, 0.48, 0.22, 0.2);

      // Nose: wide rectangular lamps, slatted grille with a chrome badge, chrome blade bumper.
      const blade: Pt[] = [[-0.03, -0.055], [0.05, -0.055], [0.072, -0.028], [0.072, 0.028], [0.05, 0.055], [-0.03, 0.055]];
      bumper(k, shell, 'front', CHROME, blade, { zStart: ax + ar + 0.04, y: 0.48 });
      F.headlamps(0.47, 0.705, 0.24, 0.13, { bezel: CHROME });
      F.grille(0, 0.705, 0.64, 0.13, { bars: 3, badge: [0.11, 0.05], frame: CHROME });
      cornerLens(k, shell, 'front', AMBER, 0.705, 0.12, 0.12);

      // Bonnet, doors, mirrors, wipers and the rest.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 0.98, zf - 0.02);
      scuttle(k, cab);
      shadeBand(k, cab, 0.13);
      shell.vline(k, DARK, 0.9, 0.42, 0.93);
      shell.vline(k, DARK, cabRear + 0.12, 0.42, 0.95);
      shell.hline(k, DARK, 0.415, cabRear + 0.12, 0.9);
      // The pressed swage line along the flanks and tray sides.
      shell.hline(k, tint(0x111214, 'satin'), 0.66, zr + 0.06, zf - 0.75, 0.012);
      handles(k, shell, [cabRear + 0.28], 0.84, PLASTIC);
      mirrors(k, shell, 0.76, 1.04, PLASTIC, 0.11, 0.13);
      wipers(k, cab);
      aerial(k, -(shell.sx(1.15) - 0.06), shell.deckY(1.15, shell.sx(1.15) - 0.06), 1.15, 0.55);
      exhaust(k, -0.48, 0.38, zr - 0.02, 0.024, 0.3, STEEL);
      fuelFlap(k, shell, cabRear - 0.3, 0.8, 1, 0.14, 0.13);

      // Options.
      if (hoop) {
        const z = cabRear - 0.035;
        const x = xi(z) - 0.01;
        k.pipe(DARK, [[-x, 0.96, z], [-x, top - 0.03, z], [x, top - 0.03, z], [x, 0.96, z]], 0.02, 6, true);
        k.tube(DARK, [-x, 1.26, z], [x, 1.26, z], 0.014, 5);
      }
      if (bull) {
        const z = zf + 0.13;
        const bar = tint(0x18191b, 'satin');
        for (const s of [1, -1]) {
          k.pipe(bar, [[s * 0.34, 0.4, z], [s * 0.34, 0.96, z]], 0.026, 6, true);
          k.tube(bar, [s * 0.34, 0.72, z], [s * (W - 0.03), 0.68, z - 0.12], 0.022, 6);
        }
        k.tube(bar, [-0.34, 0.96, z], [0.34, 0.96, z], 0.026, 6);
        k.tube(bar, [-0.34, 0.54, z], [0.34, 0.54, z], 0.022, 6);
      }
      if (cargo === 1) dog(k, 0.22, floor, zr + 0.85);
      else if (cargo === 2) {
        // Dog box against the headboard: galvanised, two mesh doors facing aft.
        const z = z1 - 0.34;
        k.box(STEEL, 2 * xi(z) - 0.28, 0.46, 0.62, 0, floor + 0.23, z, undefined, true);
        k.box(STEEL, 2 * xi(z) - 0.22, 0.03, 0.7, 0, floor + 0.475, z - 0.02);
        k.boxes(DARK, 0.44, 0.3, 0.012, 0.28, floor + 0.22, z - 0.312);
      } else if (cargo === 3) {
        const straw = tint(0xc7b25a, 'cloth');
        k.pad(straw, 0.44, 0.34, 0.9, -0.32, floor + 0.17, z1 - 0.52, 0.03, undefined, true);
        k.pad(straw, 0.44, 0.34, 0.9, 0.2, floor + 0.17, z1 - 0.52, 0.03, undefined, true);
        k.pad(straw, 0.88, 0.34, 0.44, -0.08, floor + 0.51, z1 - 0.36, 0.03, [0, 0.12, 0], true);
        dog(k, 0.28, floor, zr + 0.6);
      }
    },
  };
  return assemble(spec, color, m, `ute2|${hoop}|${bull}|${cargo}`, plan, (k) => k.plates(zf + 0.085, 0.48, zr - 0.102, 0.45)).model;
}

/** A black-and-white heading dog standing on the deck at (x, y, z), watching the road behind. */
export function dog(k: Kit, x: number, y: number, z: number): void {
  const black = tint(0x19191b, 'cloth');
  const white = tint(0xe9e4d8, 'cloth');
  k.pad(black, 0.2, 0.21, 0.52, x, y + 0.38, z, 0.07, undefined, true);
  k.pad(white, 0.19, 0.17, 0.14, x, y + 0.36, z - 0.22, 0.06);
  for (const s of [1, -1]) {
    k.box(white, 0.05, 0.3, 0.055, x + s * 0.065, y + 0.15, z - 0.2);
    k.box(black, 0.05, 0.3, 0.06, x + s * 0.065, y + 0.15, z + 0.19);
    k.box(black, 0.04, 0.07, 0.03, x + s * 0.055, y + 0.69, z - 0.28, [0.2, 0, s * 0.2]);
  }
  k.pad(black, 0.15, 0.15, 0.17, x, y + 0.58, z - 0.32, 0.05, undefined, true);
  k.pad(white, 0.075, 0.07, 0.12, x, y + 0.545, z - 0.44, 0.025);
  k.box(DARK, 0.03, 0.025, 0.02, x, y + 0.56, z - 0.505);
  k.beam(black, [x, y + 0.44, z + 0.25], [x, y + 0.3, z + 0.46], 0.04, 0.04);
}
