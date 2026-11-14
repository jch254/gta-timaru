import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { cornerLens, scuttle } from './cars';
import { AMBER, CHROME, curve, DARK, dice, Kit, PAINT, PLASTIC, RUBBER, STEEL, tint, type Pt, type V3 } from './kit';
import { aerial, assemble, bumper, exhaust, Face, fuelFlap, handles, mirrors, mudflaps, wipers, type CarPlan } from './parts';

/**
 * One-tonne single-cab ute with a wellside tray and a tow bar. What rides in the tray varies: nothing, a
 * heading dog, a dog box, or a couple of bales (and the dog). Some wear a headboard hoop or a bull bar.
 */
export function buildUte(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const hoop = dice.chance(0.55);
  const bull = dice.chance(0.35);
  const roll = dice.next();
  const cargo = roll <= 0.28 ? 0 : roll <= 0.55 ? 1 : roll <= 0.8 ? 2 : 3;

  const W = spec.width / 2;
  const r = spec.wheelRadius;
  const ax = spec.wheelbase / 2;
  const ar = r + 0.07;
  const zf = spec.length / 2 - 0.08;
  const zr = -spec.length / 2 + 0.07;
  const top = spec.height;
  const cabRear = -0.48;
  const floor = 0.68;
  const seats = [
    { x: -0.36, y: 0.51, z: 0.0 },
    { x: 0.36, y: 0.51, z: 0.0 },
  ];
  const steel = tint(0xd6d6ce, 'satin');
  const liner = tint(0x4a4d50, 'matte');

  const plan: CarPlan = {
    shell: {
      zr,
      zf,
      plan: curve([[zr, W - 0.03], [-1, W - 0.014], [0.6, W - 0.012], [1.6, W - 0.03], [zf, W - 0.07]]),
      cornerR: [0.03, 0.012],
      cornerF: [0.14, 0.09],
      shoulder: curve([[zr, 0.995], [cabRear, 1.0], [0.95, 0.985], [1.7, 0.94], [zf - 0.1, 0.9], [zf, 0.875]]),
      lower: curve([[zr, 0.53], [-ax - 0.5, 0.48], [-ax + 0.5, 0.43], [cabRear, 0.36], [ax + 0.5, 0.36], [zf - 0.2, 0.4], [zf, 0.47]]),
      waistDrop: 0.15,
      lean: 0.07,
      tuck: 0.03,
      rS: 0.025,
      arches: [
        { z: -ax, y: r + 0.02, r: ar },
        { z: ax, y: r + 0.02, r: ar },
      ],
      flare: 0.026,
      crown: 0.028,
      rearDeck: null,
      frontDeck: [0.98, zf],
      deckBow: [0, 0.05],
      stations: [cabRear - 0.05, zr + 0.05],
    },
    cabin: {
      rear: { zb: cabRear + 0.02, zt: cabRear + 0.09, bow: 0 },
      front: { zb: 1.0, zt: 0.42, bow: 0.05 },
      roof: curve([[cabRear + 0.09, top - 0.05], [0, top - 0.03], [0.42, top - 0.045]]),
      crown: 0.025,
      lean: 0.12,
      railR: 0.045,
      headerR: 0.08,
      band: 0.035,
      panes: [
        { to: [-0.27, -0.23], kind: 'paint' },
        { to: [0.93, 0.375], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.42, z0: cabRear + 0.07, z1: 1.0, seats, dash: { z: 0.52, y: 0.95 }, cloth: tint(0x565a5e, 'cloth'), back: 0.52 },
    wheel: 'steel',
    rim: 0xe4e4dc,
    belly: 0.22,
    dress(k, shell, cab) {
      const F = new Face(k, zf, 1);
      const R = new Face(k, zr, -1);
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
      k.poly(PAINT, [[-shell.sx(z1), 0.5, cabRear - 0.012], [shell.sx(z1), 0.5, cabRear - 0.012], [shell.sx(z1), 1.001, cabRear - 0.012], [-shell.sx(z1), 1.001, cabRear - 0.012]], [0, 0.8, zr]);
      k.poly(liner, [[-xi(z0), floor, z0], [xi(z0), floor, z0], [xi(z1), floor, z1], [-xi(z1), floor, z1]], [0, -3, mid]);
      // Wheel boxes: wide enough to bury the arch liners, which stand higher than the tray floor.
      k.boxes(PAINT, 0.3, 0.84 - floor, 0.9, xi(-ax) - 0.15, (0.84 + floor) / 2, -ax);
      // Rope rails under the lip.
      for (const s of [1, -1]) {
        const p = (z: number): V3 => [s * (shell.F(z, 0.92) + 0.018), 0.925, z];
        k.tube(DARK, p(z0 + 0.08), p(z1 - 0.06), 0.008, 5);
        for (const z of [z0 + 0.1, mid, z1 - 0.08]) k.box(DARK, 0.03, 0.02, 0.02, s * (shell.F(z, 0.92) + 0.008), 0.925, z);
      }
      // Gap between cab and tray.
      shell.vline(k, DARK, cabRear - 0.006, 0.38, 1.0, 0.026);

      // Tailgate: shut lines, handle, upright lamps, then a steel step bumper with the tow bar.
      const xe = shell.P(zr) - 0.02;
      R.both(DARK, 0.008, 0.44, xe - 0.11, 0.77, 0.006, 0.003);
      R.box(DARK, 2 * xe - 0.22, 0.008, 0, 0.555, 0.006, 0.003);
      R.box(PLASTIC, 0.17, 0.04, 0, 0.92, 0.014, 0.01);
      R.taillamps(xe - 0.045, 0.78, 0.08, 0.3, { upright: true });
      k.pad(steel, 2 * W, 0.1, 0.13, 0, 0.47, zr - 0.035, 0.015);
      k.box(DARK, 0.5, 0.012, 0.1, 0, 0.522, zr - 0.04);
      k.box(DARK, 0.07, 0.05, 0.22, 0, 0.4, zr - 0.06);
      k.ball(CHROME, 0.026, 0, 0.455, zr - 0.145, 1, 1, 8);
      k.tube(CHROME, [0, 0.42, zr - 0.145], [0, 0.445, zr - 0.145], 0.012, 6);
      mudflaps(k, spec.track / 2, -ax - ar - 0.04, 0.5, 0.24, 0.2);

      // Nose: square lamps, slatted grille, chrome blade bumper.
      const blade: Pt[] = [[-0.03, -0.06], [0.05, -0.06], [0.074, -0.03], [0.074, 0.03], [0.05, 0.06], [-0.03, 0.06]];
      bumper(k, shell, 'front', CHROME, blade, { zStart: ax + ar + 0.04, y: 0.5 });
      F.headlamps(0.55, 0.745, 0.24, 0.16, { bezel: CHROME });
      F.box(DARK, 0.84, 0.16, 0, 0.745, 0.02, 0.003);
      for (const dy of [-0.045, 0, 0.045]) F.box(CHROME, 0.84, 0.014, 0, 0.745 + dy, 0.012, 0.012);
      F.box(CHROME, 0.1, 0.05, 0, 0.745, 0.01, 0.02);
      cornerLens(k, shell, AMBER, zf - 0.055, 0.745, 0.09, 0.14);

      // Bonnet, doors, mirrors, wipers and the rest.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 1.03, zf - 0.02);
      scuttle(k, cab);
      shell.vline(k, DARK, 0.95, 0.44, 0.975);
      shell.vline(k, DARK, cabRear + 0.13, 0.44, 0.99);
      shell.hline(k, DARK, 0.435, cabRear + 0.13, 0.95);
      handles(k, shell, [cabRear + 0.3], 0.88, PLASTIC);
      mirrors(k, shell, 0.8, 1.08, PLASTIC, 0.11, 0.13);
      wipers(k, cab);
      aerial(k, -(shell.sx(1.2) - 0.06), shell.deckY(1.2, shell.sx(1.2) - 0.06), 1.2, 0.55);
      exhaust(k, -0.5, 0.4, zr - 0.02, 0.024, 0.3, STEEL);
      fuelFlap(k, shell, cabRear - 0.3, 0.84, 1, 0.14, 0.13);

      // Options.
      if (hoop) {
        const z = cabRear - 0.035;
        const x = xi(z) - 0.01;
        k.pipe(DARK, [[-x, 1.0, z], [-x, top - 0.03, z], [x, top - 0.03, z], [x, 1.0, z]], 0.02, 6, true);
        k.tube(DARK, [-x, 1.3, z], [x, 1.3, z], 0.014, 5);
      }
      if (bull) {
        const z = zf + 0.13;
        const bar = tint(0x18191b, 'satin');
        for (const s of [1, -1]) {
          k.pipe(bar, [[s * 0.36, 0.42, z], [s * 0.36, 1.0, z]], 0.026, 6, true);
          k.tube(bar, [s * 0.36, 0.76, z], [s * (W - 0.03), 0.72, z - 0.12], 0.022, 6);
        }
        k.tube(bar, [-0.36, 1.0, z], [0.36, 1.0, z], 0.026, 6);
        k.tube(bar, [-0.36, 0.56, z], [0.36, 0.56, z], 0.022, 6);
      }
      if (cargo === 1) dog(k, 0.22, floor, zr + 0.85);
      else if (cargo === 2) {
        // Dog box against the headboard: galvanised, two mesh doors facing aft.
        const z = z1 - 0.34;
        k.box(STEEL, 2 * xi(z) - 0.28, 0.5, 0.62, 0, floor + 0.25, z, undefined, true);
        k.box(STEEL, 2 * xi(z) - 0.22, 0.03, 0.7, 0, floor + 0.515, z - 0.02);
        k.boxes(DARK, 0.46, 0.32, 0.012, 0.29, floor + 0.24, z - 0.312);
      } else if (cargo === 3) {
        const straw = tint(0xc7b25a, 'cloth');
        k.pad(straw, 0.46, 0.36, 0.92, -0.34, floor + 0.18, z1 - 0.52, 0.03, undefined, true);
        k.pad(straw, 0.46, 0.36, 0.92, 0.2, floor + 0.18, z1 - 0.52, 0.03, undefined, true);
        k.pad(straw, 0.92, 0.36, 0.46, -0.1, floor + 0.54, z1 - 0.36, 0.03, [0, 0.12, 0], true);
        dog(k, 0.3, floor, zr + 0.6);
      }
    },
  };
  return assemble(spec, color, m, `ute|${hoop}|${bull}|${cargo}`, plan, (k) => k.plates(zf + 0.09, 0.5, zr - 0.102, 0.47)).model;
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
