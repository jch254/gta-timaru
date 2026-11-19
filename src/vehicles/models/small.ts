import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import type { Cabin, PaneKind, Shell } from './body';
import { AMBER, AMBER_LENS, CHROME, curve, DARK, dice, HEAD, Kit, LENS, PAINT, PLASTIC, tint, type Pt, type Tint, type WheelStyle } from './kit';
import { aerial, assemble, CHERISHED, cornerLens, EVERYDAY, exhaust, Face, FARM, fuelFlap, handles, mirrors, mudflaps, roofRack, scuttle, shadeBand, wipers, type Ageing, type CarPlan } from './parts';
import { bladeBumpers, fit, mouldBumpers, pick, repeater, type Fittings } from './japanese';

/**
 * The small two-box cars: the hatchbacks and the light 4WD wagon. `twoBox` lofts the shared body (bonnet,
 * glasshouse running to an upright or raked tailgate, cargo floor behind the rear seat) and each builder
 * dresses its own nose, tail and trim. See ../specs-cars.ts for what each stands for.
 */

/** Black rubber window surrounds shared by the plainer hatches. */
const RUBBER_FRAME = tint(0x121212, 'rubber');

interface TwoBoxStyle {
  top: number;
  belt: number;
  noseDrop: number;
  tailDrop?: number;
  sill: number;
  seatY: number;
  frontSeatZ: number;
  rearSeatZ: number;
  planEnds?: [number, number];
  cornerR?: Pt;
  cornerF?: Pt;
  rS?: number;
  waistDrop?: number;
  lean?: number;
  crown?: number;
  flare?: number;
  /** Glasshouse: screen bases and tops, tumblehome, and the side glazing from the rear corner forwards. */
  cab: {
    rzb: number;
    rzt: number;
    fzb: number;
    fzt: number;
    lean: number;
    railR?: number;
    headerR?: number;
    rearBow?: number;
    frontBow?: number;
    panes: { to: [number, number] | 'front'; kind: PaneKind }[];
  };
  cargoY: number;
  frame: Tint | null;
  wheel: WheelStyle;
  rim?: number;
  cloth: number;
  ageing?: Ageing;
  belly?: number;
  dress(k: Kit, shell: Shell, cab: Cabin, F: Face, R: Face): void;
}

/** A two-box hatch or wagon lofted from a handful of proportions. */
function twoBox(spec: VehicleSpec, o: TwoBoxStyle): CarPlan {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.05;
  const { top, belt } = o;
  const [pr, pf] = o.planEnds ?? [0.05, 0.058];
  const { rzb, rzt, fzb, fzt } = o.cab;
  const seatX = Math.min(0.36, W - 0.4);
  const seats = [
    { x: -seatX, y: o.seatY, z: o.frontSeatZ },
    { x: seatX, y: o.seatY, z: o.frontSeatZ },
    { x: -seatX + 0.02, y: o.seatY, z: o.rearSeatZ },
    { x: seatX - 0.02, y: o.seatY, z: o.rearSeatZ },
  ];
  return {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - pr], [-0.5 * h, W - 0.015], [0, W - 0.009], [0.5 * h, W - 0.018], [h, W - pf]]),
      cornerR: o.cornerR ?? [0.1, 0.065],
      cornerF: o.cornerF ?? [0.14, 0.09],
      shoulder: curve([
        [-h, belt - (o.tailDrop ?? 0)],
        [-0.5 * h, belt + 0.005],
        [0, belt],
        [0.36 * h, belt - 0.014],
        [0.68 * h, belt - o.noseDrop * 0.5],
        [h - 0.09, belt - o.noseDrop * 0.9],
        [h, belt - o.noseDrop],
      ]),
      lower: curve([[-h, o.sill + 0.09], [-h + 0.2, o.sill + 0.04], [-ax - 0.38, o.sill], [ax + 0.38, o.sill], [h - 0.2, o.sill + 0.02], [h, o.sill + 0.06]]),
      waistDrop: o.waistDrop ?? 0.2,
      lean: o.lean ?? 0.1,
      tuck: 0.04,
      rS: o.rS ?? 0.035,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: o.flare ?? 0.016,
      crown: o.crown ?? 0.022,
      rearDeck: null,
      frontDeck: [fzb - 0.01, h],
      deckBow: [0, 0.06],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: o.cab.rearBow ?? 0.035 },
      front: { zb: fzb, zt: fzt, bow: o.cab.frontBow ?? 0.06 },
      roof: curve([[rzt, top - 0.064], [rzt + (fzt - rzt) * 0.6, top - 0.036], [fzt, top - 0.05]]),
      crown: 0.028,
      lean: o.cab.lean,
      railR: o.cab.railR ?? 0.045,
      headerR: o.cab.headerR ?? 0.09,
      band: 0.03,
      panes: o.cab.panes,
      frame: o.frame,
    },
    interior: {
      floor: o.seatY,
      z0: o.rearSeatZ - 0.38,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3],
      dash: { z: 0.19 * h, y: belt - 0.05 },
      cargo: { y: o.cargoY, z: rzb - 0.055 },
      cloth: tint(o.cloth, 'cloth'),
      back: 0.56,
    },
    wheel: o.wheel,
    rim: o.rim,
    belly: o.belly ?? 0.13,
    ageing: o.ageing ?? EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.045, fzb + 0.04, h - 0.035);
      scuttle(k, cab, 0.06);
      shadeBand(k, cab, 0.13);
      wipers(k, cab, { span: 0.46 });
      o.dress(k, shell, cab, F, R);
    },
  };
}

/** Tailgate furniture: shut lines round the gate, a handle and the rear wiper. */
function tailgate(k: Kit, cab: Cabin, R: Face, y0: number, y1: number, w: number, handle: Tint): void {
  R.box(DARK, w, 0.008, 0, y0, 0.006, 0.003);
  R.both(DARK, 0.008, y1 - y0, w / 2, (y0 + y1) / 2, 0.006, 0.003);
  R.box(handle, 0.16, 0.028, 0, y1 - 0.08, 0.02, 0.012);
  k.beam(DARK, cab.back(0.05, 0.03, 0.014), cab.back(0.5, 0.13, 0.014), 0.014, 0.01);
}

// ───────────────────────────── The 1.3 shopping hatch (Ford Laser KA/KB) ─────────────────────────────

/** Crisp early-80s FWD five-door: square lamps, simple grille, upright tailgate, grey bumpers. */
export function buildHatch(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const top = spec.height;
  const grey = tint(0x3f4246, 'matte');
  const wheel = pick<WheelStyle>(['steel', 5], ['cap', 4], ['hubcap', 3]);
  const fittings: Fittings = {
    tow: dice.chance(0.15) ? [-h - 0.09, 0.3] : undefined,
    flaps: dice.chance(0.3) ? [spec.track / 2, -ax - spec.wheelRadius - 0.07, 0.3, 0.16] : undefined,
  };
  const plan = twoBox(spec, {
    top,
    belt: 0.885,
    noseDrop: 0.13,
    sill: 0.21,
    seatY: 0.26,
    frontSeatZ: -0.08,
    rearSeatZ: -0.88,
    cornerR: [0.09, 0.056],
    cornerF: [0.13, 0.082],
    cab: {
      rzb: -h + 0.03,
      rzt: -h + 0.38,
      fzb: 0.74,
      fzt: 0,
      lean: 0.14,
      panes: [
        { to: [-1.62, -1.39], kind: 'paint' },
        { to: [-0.48, -0.46], kind: 'glass' },
        { to: [-0.4, -0.39], kind: 'paint' },
        { to: [0.68, -0.045], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    cargoY: 0.56,
    frame: RUBBER_FRAME,
    wheel,
    rim: 0xb9bcbe,
    cloth: pick([0x6b5a4a, 1], [0x55606a, 1]),
    dress(k, shell, cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.4, grey);
      F.headlamps(0.43, 0.63, 0.26, 0.125, { bezel: grey });
      F.grille(0, 0.63, 0.5, 0.1, { bars: 3, surface: grey, depth: 0.05, badge: [0.05, 0.04] });
      F.both(AMBER, 0.15, 0.045, 0.4, 0.42, 0.01, 0.062);
      F.lens(AMBER_LENS, 0.15, 0.045, 0.4, 0.42, 0.064);
      cornerLens(k, shell, 'front', AMBER, 0.63, 0.1, 0.12);
      R.taillamps(0.56, 0.68, 0.14, 0.26, { upright: true });
      tailgate(k, cab, R, 0.52, 0.885, 1.0, grey);
      shell.vline(k, DARK, 0.7, shell.yL(0.7) + 0.035, 0.87);
      shell.vline(k, DARK, -0.44, shell.yL(-0.44) + 0.035, 0.87);
      shell.vline(k, DARK, -1.28, shell.yL(-1.28) + 0.035, 0.87);
      shell.hline(k, DARK, 0.275, -1.26, 0.7);
      handles(k, shell, [0.4, -0.75], 0.79, grey);
      shell.band(k, grey, 0.5, 0.532, -ax + ar + 0.04, ax - ar - 0.04, [1, -1], 0.008, 1);
      mirrors(k, shell, 0.6, 0.945, grey, 0.11, 0.09);
      repeater(k, shell, ax + ar + 0.08, 0.55);
      aerial(k, -(shell.sx(0.3) - 0.14), cab.roofY(0.1) - 0.03, 0.02, 0.2, 0.5);
      exhaust(k, 0.38, 0.21, -h - 0.04, 0.02, 0.18, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.45, 0.68, 1, 0.13, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.075, 0.4, -h - 0.012, 0.62, 'any');
  }).model;
}

// ───────────────────────────── The commonest car on the street (Corolla AE80/AE82) ─────────────────────────────

/** Clean wedge FWD five-door: flush rectangular lamps, black plastic trim, raked tailgate. */
export function buildCorolla(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const top = spec.height;
  const wheel = pick<WheelStyle>(['hubcap', 5], ['cap', 4], ['steel', 3]);
  const fittings: Fittings = {
    tow: dice.chance(0.2) ? [-h - 0.09, 0.3] : undefined,
    flaps: dice.chance(0.25) ? [spec.track / 2, -ax - spec.wheelRadius - 0.07, 0.3, 0.16] : undefined,
  };
  const plan = twoBox(spec, {
    top,
    belt: 0.875,
    noseDrop: 0.125,
    tailDrop: 0.005,
    sill: 0.21,
    seatY: 0.27,
    frontSeatZ: -0.03,
    rearSeatZ: -0.86,
    cornerR: [0.1, 0.06],
    cornerF: [0.15, 0.095],
    cab: {
      rzb: -h + 0.035,
      rzt: -h + 0.52,
      fzb: 0.76,
      fzt: 0.02,
      lean: 0.15,
      rearBow: 0.04,
      panes: [
        { to: [-1.7, -1.33], kind: 'paint' },
        { to: [-0.46, -0.44], kind: 'glass' },
        { to: [-0.38, -0.37], kind: 'paint' },
        { to: [0.7, -0.03], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    cargoY: 0.58,
    frame: RUBBER_FRAME,
    wheel,
    rim: 0xb5b8ba,
    cloth: pick([0x55606a, 1], [0x5a4a3c, 1]),
    dress(k, shell, cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.4, PLASTIC);
      F.headlamps(0.445, 0.635, 0.3, 0.105, { depth: 0.03 });
      F.grille(0, 0.635, 0.46, 0.085, { bars: 2, surface: PLASTIC, depth: 0.045, badge: [0.05, 0.04] });
      cornerLens(k, shell, 'front', AMBER, 0.635, 0.09, 0.12);
      R.taillamps(0.425, 0.70, 0.35, 0.13, {});
      tailgate(k, cab, R, 0.56, 0.87, 0.96, PLASTIC);
      shell.vline(k, DARK, 0.72, shell.yL(0.72) + 0.035, 0.855);
      shell.vline(k, DARK, -0.42, shell.yL(-0.42) + 0.035, 0.86);
      shell.vline(k, DARK, -1.32, shell.yL(-1.32) + 0.035, 0.855);
      shell.hline(k, DARK, 0.275, -1.3, 0.72);
      handles(k, shell, [0.42, -0.72], 0.78, PLASTIC, true);
      shell.band(k, DARK, 0.5, 0.53, -ax + ar + 0.04, ax - ar - 0.04, [1, -1], 0.008, 1);
      mirrors(k, shell, 0.62, 0.935, PLASTIC, 0.11, 0.09);
      repeater(k, shell, ax + ar + 0.08, 0.55);
      aerial(k, -(shell.sx(1.3) - 0.09), shell.deckY(1.3, shell.sx(1.3) - 0.09), 1.3, 0.4);
      exhaust(k, 0.38, 0.21, -h - 0.04, 0.02, 0.18, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.5, 0.68, 1, 0.13, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.075, 0.4, -h - 0.012, 0.70, 'any');
  }).model;
}

// ───────────────────────────── The boy racer's rocket (Familia BF GT-X) ─────────────────────────────

/** Boxy 3-door turbo 4WD hot hatch: bonnet vent, foglamps, small mags, gate spoiler. */
export function buildHotHatch(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const top = spec.height;
  const dark = tint(0x1c1d20, 'matte');
  const plan = twoBox(spec, {
    top,
    belt: 0.885,
    noseDrop: 0.115,
    sill: 0.19,
    seatY: 0.26,
    frontSeatZ: -0.1,
    rearSeatZ: -0.88,
    cornerR: [0.09, 0.05],
    cornerF: [0.12, 0.08],
    flare: 0.024,
    cab: {
      rzb: -h + 0.03,
      rzt: -h + 0.37,
      fzb: 0.72,
      fzt: -0.02,
      lean: 0.15,
      panes: [
        { to: [-1.66, -1.44], kind: 'paint' },
        { to: [-0.66, -0.6], kind: 'glass' },
        { to: [-0.58, -0.53], kind: 'black' },
        { to: [0.66, -0.065], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    cargoY: 0.56,
    frame: RUBBER_FRAME,
    wheel: 'alloy',
    cloth: 0x33353a,
    ageing: CHERISHED,
    dress(k, shell, cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.38);
      F.headlamps(0.44, 0.64, 0.28, 0.115, { bezel: dark });
      F.grille(0, 0.64, 0.5, 0.07, { bars: 2, surface: DARK, depth: 0.045, badge: [0.05, 0.04] });
      cornerLens(k, shell, 'front', AMBER, 0.64, 0.1, 0.11);
      // Foglamps in the bumper, lit with the heads.
      F.box(DARK, 0.66, 0.065, 0, 0.32, 0.02, 0.064);
      F.both(HEAD, 0.1, 0.045, 0.31, 0.32, 0.008, 0.066);
      F.lens(LENS, 0.11, 0.05, 0.31, 0.32, 0.068);
      // Bonnet vent over the turbo, offset to the driver's side.
      k.box(DARK, 0.34, 0.016, 0.24, -0.18, shell.deckY(1.12, -0.18) + 0.004, 1.12);
      for (let i = 0; i < 3; i++) k.box(PLASTIC, 0.3, 0.01, 0.014, -0.18, shell.deckY(1.04 + i * 0.08, -0.18) + 0.016, 1.04 + i * 0.08);
      R.taillamps(0.46, 0.68, 0.3, 0.145, {});
      tailgate(k, cab, R, 0.52, 0.885, 1.04, dark);
      // Gate spoiler on the trailing edge of the roof.
      if (!k.lo) {
        k.pad(PAINT, 0.78, 0.028, 0.13, 0, top - 0.005, -h + 0.32, 0.01, [0.12, 0, 0], true);
      } else {
        k.box(PAINT, 0.78, 0.028, 0.13, 0, top - 0.005, -h + 0.32);
      }
      shell.vline(k, DARK, 0.66, shell.yL(0.66) + 0.035, 0.865);
      shell.vline(k, DARK, -0.56, shell.yL(-0.56) + 0.035, 0.87);
      shell.hline(k, DARK, 0.255, -0.56, 0.66);
      handles(k, shell, [-0.4], 0.78, PLASTIC, true);
      shell.band(k, DARK, 0.46, 0.52, -ax + ar + 0.04, ax - ar - 0.04, [1, -1], 0.009, 1);
      mirrors(k, shell, 0.58, 0.94, PAINT, 0.12, 0.09);
      repeater(k, shell, ax + ar + 0.08, 0.55);
      aerial(k, -(shell.sx(0.3) - 0.14), cab.roofY(0.05) - 0.03, 0, 0.2, 0.5);
      exhaust(k, 0.4, 0.2, -h - 0.05, 0.034, 0.22);
      fuelFlap(k, shell, -1.46, 0.68, 1, 0.13, 0.12);
    },
  });
  const fittings: Fittings = {
    flaps: dice.chance(0.4) ? [spec.track / 2, -ax - spec.wheelRadius - 0.07, 0.3, 0.17] : undefined,
  };
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.075, 0.38, -h - 0.012, 0.62, 'new');
  }).model;
}

// ───────────────────────────── The gravel-road wagon (Subaru Leone 4WD) ─────────────────────────────

/** Boxy raised light 4WD wagon: chrome blades, upright gate, mudflaps, usually a roof rack. */
export function buildLeone(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const top = spec.height;
  const rack = dice.chance(0.7);
  const twoTone = dice.chance(0.5);
  const fittings: Fittings = {
    tow: dice.chance(0.45) ? [-h - 0.09, 0.36] : undefined,
  };
  const plan = twoBox(spec, {
    top,
    belt: 0.975,
    noseDrop: 0.115,
    tailDrop: 0.005,
    sill: 0.33,
    seatY: 0.3,
    frontSeatZ: 0.08,
    rearSeatZ: -0.68,
    cornerR: [0.09, 0.055],
    cornerF: [0.12, 0.08],
    cab: {
      rzb: -h + 0.035,
      rzt: -h + 0.34,
      fzb: 0.8,
      fzt: 0.17,
      lean: 0.13,
      panes: [
        { to: [-1.78, -1.56], kind: 'paint' },
        { to: [-1.24, -1.21], kind: 'glass' },
        { to: [-1.16, -1.14], kind: 'paint' },
        { to: [-0.2, -0.22], kind: 'glass' },
        { to: [-0.13, -0.15], kind: 'paint' },
        { to: [0.74, 0.13], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    cargoY: 0.63,
    frame: CHROME,
    wheel: 'steel',
    rim: 0xd8d8d2,
    cloth: 0x6a5a48,
    ageing: FARM,
    belly: 0.2,
    dress(k, shell, cab, F, R) {
      bladeBumpers(k, shell, ax + ar + 0.04, 0.46);
      F.headlamps(0.43, 0.70, 0.27, 0.12, { bezel: CHROME });
      F.grille(0, 0.70, 0.5, 0.12, { bars: 3, surface: PLASTIC, badge: [0.06, 0.05], frame: CHROME });
      cornerLens(k, shell, 'front', AMBER, 0.70, 0.1, 0.12);
      R.taillamps(0.55, 0.72, 0.15, 0.3, { upright: true, bezel: CHROME });
      tailgate(k, cab, R, 0.56, 0.97, 0.98, CHROME);
      shell.vline(k, DARK, 0.76, shell.yL(0.76) + 0.035, 0.96);
      shell.vline(k, DARK, -0.17, shell.yL(-0.17) + 0.035, 0.96);
      shell.vline(k, DARK, -1.2, shell.yL(-1.2) + 0.035, 0.96);
      shell.hline(k, DARK, 0.395, -1.18, 0.76);
      handles(k, shell, [-0.02, -1.0], 0.9, CHROME);
      shell.band(k, DARK, 0.4, 0.44, -ax + ar + 0.05, ax - ar - 0.05, [1, -1], 0.008, 1);
      mirrors(k, shell, 0.66, 1.04, PLASTIC, 0.11, 0.09);
      repeater(k, shell, ax + ar + 0.09, 0.62);
      mudflaps(k, spec.track / 2, -ax - spec.wheelRadius - 0.08, 0.38, 0.19);
      mudflaps(k, spec.track / 2, ax - spec.wheelRadius - 0.26, 0.38, 0.17);
      aerial(k, -(shell.sx(1.35) - 0.09), shell.deckY(1.35, shell.sx(1.35) - 0.09), 1.35, 0.45);
      exhaust(k, 0.4, 0.26, -h - 0.04, 0.022, 0.18, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.55, 0.8, 1, 0.13, 0.12);
    },
  });
  return assemble(spec, color, m, `${spec.id}|${twoTone}`, plan, (k, shell) => {
    fit(k, spec.id, fittings);
    if (rack) k.cached(`${spec.id}|rack`, (c) => roofRack(c, 0.52, top - 0.012, -1.55, -0.05, 4));
    if (twoTone && k.color !== 0xc2c6c9) {
      k.cached(`${spec.id}|tt`, (c) => {
        const silver = tint(0xc2c6c9, 'satin');
        for (const [z0, z1] of [
          [-h + 0.12, -ax - ar - 0.06],
          [-ax + ar + 0.06, ax - ar - 0.06],
          [ax + ar + 0.06, h - 0.14],
        ]) {
          shell.band(c, silver, 0.46, 0.72, z0, z1, [1, -1], 0.0045, 2);
        }
      });
    }
    k.plates(h + 0.08, 0.46, -h - 0.012, 0.66, 'any');
  }).model;
}
