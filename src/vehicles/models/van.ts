import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import type { PaneKind } from './body';
import { AMBER, CHROME, curve, DARK, dice, PLASTIC, RUBBER, STEEL, tint, type Pt } from './kit';
import { aerial, assemble, bumper, cornerLens, exhaust, Face, fuelFlap, handles, mirrors, scuttle, wipers, type CarPlan } from './parts';

/** Invented firms for the signwriting. `rack` puts a roof rack and a couple of lengths of pipe on top. */
const FIRMS: { text: string; fg: string; style: 'paint' | 'block' | 'script'; rack?: boolean }[] = [
  { text: 'WEKA COURIERS', fg: '#b3261e', style: 'block' },
  { text: "NOR'WEST PLUMBING\n& Drainlaying", fg: '#1d4f91', style: 'paint', rack: true },
  { text: 'PLAINS BAKERY\nFresh Daily', fg: '#7a4a1e', style: 'paint' },
  { text: 'BAY HILL ELECTRICAL', fg: '#1f6a4a', style: 'block' },
  { text: 'Harper & Sons\nFAMILY BUTCHERS', fg: '#8a1c24', style: 'paint' },
];

/**
 * Forward-control one-box van: the driver sits over the front axle behind a short sloping nose. Comes as
 * a signwritten panel van, a plain panel van, or with side windows. The sliding door is on the kerb side.
 */
export function buildVan(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const roll = dice.next();
  const windows = roll > 0.75;
  const firmIndex = roll < 0.6 ? dice.int(0, FIRMS.length - 1) : -1;
  const firm = firmIndex >= 0 ? FIRMS[firmIndex] : null;

  const W = spec.width / 2;
  const r = spec.wheelRadius;
  const ax = spec.wheelbase / 2;
  const ar = r + 0.05;
  const h = spec.length / 2 - 0.075;
  const top = spec.height;
  const belt = 1.08;
  const seats = [
    // Low enough that the driver's face is below the top of the windscreen, not behind the header.
    { x: -0.4, y: 0.76, z: 1.0 },
    { x: 0.4, y: 0.76, z: 1.0 },
  ];
  const steel = tint(0xd9d9d2, 'satin');
  const door: { to: [number, number] | 'front'; kind: PaneKind }[] = [
    { to: [1.86, 1.33], kind: 'glass' },
    { to: 'front', kind: 'paint' },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.03], [0, W - 0.014], [1.4, W - 0.02], [h, W - 0.05]]),
      cornerR: [0.07, 0.04],
      cornerF: [0.16, 0.1],
      shoulder: curve([[-h, 1.075], [0, belt], [1.9, belt], [h - 0.07, 1.035], [h, 1.0]]),
      lower: curve([[-h, 0.42], [-h + 0.2, 0.36], [-ax - 0.42, 0.3], [ax + 0.42, 0.3], [h - 0.15, 0.34], [h, 0.4]]),
      waistDrop: 0.22,
      lean: 0.03,
      tuck: 0.025,
      rS: 0.03,
      arches: [
        { z: -ax, y: r + 0.01, r: ar },
        { z: ax, y: r + 0.01, r: ar },
      ],
      crown: 0.012,
      rearDeck: null,
      frontDeck: [1.93, h],
      deckBow: [0, 0.05],
    },
    cabin: {
      rear: { zb: -h + 0.025, zt: -h + 0.11, bow: 0.015 },
      front: { zb: 1.95, zt: 1.38, bow: 0.06 },
      roof: curve([[-h + 0.11, top - 0.065], [-1.2, top - 0.036], [0.9, top - 0.036], [1.38, top - 0.07]]),
      crown: 0.03,
      lean: 0.075,
      railR: 0.06,
      headerR: 0.1,
      band: 0.05,
      panes: windows
        ? [{ to: [-h + 0.2, -h + 0.24], kind: 'paint' }, { to: [-0.66, -0.66], kind: 'glass' }, { to: [-0.56, -0.56], kind: 'paint' }, { to: [0.6, 0.6], kind: 'glass' }, { to: [0.7, 0.7], kind: 'paint' }, ...door]
        : [{ to: [0.7, 0.7], kind: 'paint' }, ...door],
      frame: RUBBER,
    },
    interior: { floor: 0.6, z0: 0.56, z1: 1.96, seats, dash: { z: 1.52, y: 1.03 }, cargo: { y: 0.6, z: -h + 0.08 }, cloth: tint(0x4d5258, 'cloth'), back: 0.56 },
    wheel: dice.chance(0.3) ? 'cap' : 'steel',
    rim: 0xdcdcd6,
    belly: 0.2,
    ageing: { dirt: [0.2, 0.7], fade: 0.3, rust: 0.25 },
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Seat box over the front wheels and engine.
      k.box(tint(0x26282b, 'satin'), 2 * (shell.sx(1) - 0.06), 0.22, 0.62, 0, 0.65, 1.0);

      // Painted steel bumpers.
      const blade: Pt[] = [[-0.03, -0.065], [0.05, -0.065], [0.07, -0.04], [0.07, 0.04], [0.05, 0.065], [-0.03, 0.065]];
      for (const end of ['front', 'rear'] as const) bumper(k, shell, end, steel, blade, { zStart: (end === 'front' ? 1 : -1) * (ax + ar + 0.04), y: 0.47 });
      // Face: rectangular lamps, a slot between them, indicators on the corners.
      F.headlamps(0.52, 0.76, 0.28, 0.15, { bezel: PLASTIC });
      F.grille(0, 0.76, 0.7, 0.09, { bars: 2, surface: PLASTIC, depth: 0.05 });
      F.box(CHROME, 0.09, 0.045, 0, 0.9, 0.01, 0.008);
      cornerLens(k, shell, 'front', AMBER, 0.76, 0.13, 0.14);
      // Tail: upright lamps, tailgate shut lines, handle, wiper.
      const xe = shell.P(-h) - 0.02;
      R.taillamps(xe - 0.07, 0.82, 0.11, 0.4, { upright: true });
      R.box(DARK, 2 * xe - 0.3, 0.008, 0, 0.52, 0.006, 0.003);
      R.both(DARK, 0.008, 0.52, xe - 0.15, 0.78, 0.006, 0.003);
      R.box(PLASTIC, 0.18, 0.035, 0, 0.94, 0.014, 0.01);
      k.beam(DARK, cab.back(0.05, 0.04, 0.014), cab.back(0.5, 0.2, 0.014), 0.014, 0.01);

      // Doors: cab doors both sides; the slider (with its track) on the left only.
      scuttle(k, cab, 0.05);
      shell.vline(k, DARK, 0.7, 0.33, belt);
      shell.vline(k, DARK, 1.72, 0.74, belt);
      shell.hline(k, DARK, 0.325, -0.56, 0.7, 0.009, [1]);
      shell.vline(k, DARK, -0.56, 0.33, belt, 0.009, [1]);
      shell.hline(k, DARK, 1.0, -1.75, -0.56, 0.03, [1]);
      handles(k, shell, [0.84], 0.99, PLASTIC);
      for (const z of [0.52]) k.box(PLASTIC, 0.02, 0.024, 0.13, shell.F(z, 0.99) + 0.012, 0.99, z);
      shell.band(k, PLASTIC, 0.6, 0.64, -ax + ar + 0.05, ax - ar - 0.05, [1, -1], 0.008, 1);
      mirrors(k, shell, 1.6, 1.3, PLASTIC, 0.11, 0.18);
      wipers(k, cab, { opposed: true, span: 0.5 });
      aerial(k, -(shell.sx(1.9) - 0.04), 1.07, 1.92, 0.5);
      exhaust(k, 0.5, 0.33, -h - 0.02, 0.022, 0.25, STEEL);
      fuelFlap(k, shell, -1.75, 0.8, -1);

      if (firm) {
        // A signwritten panel on each flank, laid back with the body side.
        const sign = m.sign(firm.text, { bg: '#f2efe4', fg: firm.fg, style: firm.style, aspect: 3.7 });
        const lo = cab.flank(-0.75, 0.2, 0.006);
        const hi = cab.flank(-0.75, 0.75, 0.006);
        const tilt = Math.atan2(lo[0] - hi[0], hi[1] - lo[1]);
        const x = (lo[0] + hi[0]) / 2 + 0.006;
        const y = (lo[1] + hi[1]) / 2;
        k.board(sign, 1.7, 0.46, x, y, -0.75, Math.PI / 2, -tilt);
        k.board(sign, 1.7, 0.46, -x, y, -0.75, -Math.PI / 2, -tilt);
        if (firm.rack) {
          const ry = cab.roofY(0);
          for (const z of [0.7, -1.3]) {
            k.box(DARK, 2 * W - 0.2, 0.03, 0.04, 0, ry + 0.05, z);
            k.boxes(DARK, 0.04, 0.07, 0.05, W - 0.16, ry + 0.01, z);
          }
          k.tube(tint(0xdedad0, 'satin'), [0.22, ry + 0.11, -1.75], [0.22, ry + 0.11, 1.05], 0.045, 8, true);
          k.tube(tint(0xb5673a, 'steel'), [-0.2, ry + 0.09, -1.6], [-0.2, ry + 0.09, 0.95], 0.025, 6);
        }
      }
    },
  };
  return assemble(spec, color, m, `van|${windows}|${firmIndex}`, plan, (k) => k.plates(h + 0.085, 0.47, -h - 0.012, 0.66)).model;
}
