import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import type { Cabin, Shell } from './body';
import { AMBER, BRIGHT, CHROME, CLEAR_LENS, curve, DARK, dice, Kit, LENS, PAINT, PLASTIC, RED_GLASS, RUBBER, STEEL, TAIL, TAIL_LENS, tint, type Pt, type Tint, type WheelStyle } from './kit';
import { aerial, assemble, bumper, CHERISHED, cornerLens, EVERYDAY, exhaust, Face, fuelFlap, handles, mirrors, mudflaps, scuttle, shadeBand, TIRED, towbar, wipers, type Ageing, type CarPlan } from './parts';

/**
 * The Japanese (and one Soviet) three-box cars of the roster, plus the import coupe. Each is a plan handed
 * to `assemble` (see parts.ts); `saloon` below lofts the shared four-door body and each builder dresses its
 * own nose, tail and brightwork. All makes and models are invented; the real car each one stands for is
 * recorded on its spec in ../specs-cars.ts.
 */

/** Pick one of several by weight (diced per vehicle). */
export function pick<T>(...options: [T, number][]): T {
  let roll = dice.next() * options.reduce((sum, o) => sum + o[1], 0);
  for (const [value, weight] of options) if ((roll -= weight) <= 0) return value;
  return options[0][0];
}

/** Small side repeater / marker lamp on both flanks. */
export function repeater(k: Kit, shell: Shell, z: number, y: number, surface: Tint = AMBER): void {
  for (const s of [1, -1]) k.box(surface, 0.012, 0.028, 0.065, s * (shell.F(z, y) + 0.004), y, z);
}

/** What one car has that the next of its kind may not. Each is a small cached piece of its own. */
export interface Fittings {
  /** Tow bar: z of the tail, height of the tongue. */
  tow?: [z: number, y: number];
  /** Mud flaps behind the rear wheels: half-track, z, top, width. */
  flaps?: [x: number, z: number, top: number, w: number];
}

export function fit(k: Kit, id: string, f: Fittings): void {
  const { tow, flaps } = f;
  if (tow) k.cached(`${id}|tow`, (c) => towbar(c, tow[0], tow[1]));
  if (flaps) k.cached(`${id}|flaps`, (c) => mudflaps(c, flaps[0], flaps[1], flaps[2], flaps[3], 0.14));
}

// Chromed steel blade bumper of the early 80s, and the slimmer plastic moulding of the late 80s.
const BLADE: Pt[] = [[-0.03, -0.05], [0.045, -0.05], [0.066, -0.026], [0.066, 0.026], [0.045, 0.05], [-0.03, 0.05]];
const BLADE_INSERT: Pt[] = [[0.0665, -0.016], [0.075, 0], [0.0665, 0.016]];
const MOULD: Pt[] = [[-0.03, -0.11], [0.02, -0.115], [0.038, -0.082], [0.042, -0.02], [0.042, 0.042], [0.028, 0.072], [-0.03, 0.076]];
const MOULD_INSERT: Pt[] = [[0.0425, -0.01], [0.05, 0.012], [0.0425, 0.034]];

/** Blade bumpers (chrome, steel or grey) with a rubber insert, wrapped to the arches at both ends. */
export function bladeBumpers(k: Kit, shell: Shell, zStart: number, y: number, surface: Tint = CHROME): void {
  for (const end of ['front', 'rear'] as const) {
    const z = (end === 'front' ? 1 : -1) * zStart;
    bumper(k, shell, end, surface, BLADE, { zStart: z, y });
    bumper(k, shell, end, RUBBER, BLADE_INSERT, { zStart: z, y });
  }
}

/** Body-colour (or grey plastic) moulded bumpers with a dark insert. */
export function mouldBumpers(k: Kit, shell: Shell, zStart: number, y: number, surface: 'paint' | Tint = PAINT): void {
  for (const end of ['front', 'rear'] as const) {
    const z = (end === 'front' ? 1 : -1) * zStart;
    bumper(k, shell, end, surface, MOULD, { zStart: z, y, bow: 0.015 });
    bumper(k, shell, end, DARK, MOULD_INSERT, { zStart: z, y, bow: 0.015 });
  }
}

// ───────────────────────────── The shared three-box saloon ─────────────────────────────

interface SaloonStyle {
  /** Roof height and the shoulder (belt) line at mid-car. */
  top: number;
  belt: number;
  /** How far the belt falls to the nose and to the tail. */
  noseDrop: number;
  tailDrop: number;
  /** Sill height between the axles, and the seat height (the floor matches it). */
  sill: number;
  seatY: number;
  /** Plan inset at tail and nose, and the plan corners: tight on the boxy cars, round on the 70s one. */
  planEnds?: [number, number];
  cornerR?: Pt;
  cornerF?: Pt;
  rS?: number;
  waistDrop?: number;
  lean?: number;
  crown?: number;
  barrel?: number;
  flare?: number;
  /** Glasshouse: screen bases and tops, tumblehome, radii, and how thick the C-pillar is. */
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
    /** Where the C-pillar meets the belt and the roof, as a share of each span (bigger = thicker pillar). */
    c?: [number, number];
  };
  frame: Tint | null;
  wheel: WheelStyle;
  rim?: number;
  cloth: number;
  ageing?: Ageing;
  belly?: number;
  /** Nose, tail, trim and anything else that is this car's own. */
  dress(k: Kit, shell: Shell, cab: Cabin, F: Face, R: Face): void;
}

/** A four-door three-box saloon lofted from a handful of proportions. */
function saloon(spec: VehicleSpec, o: SaloonStyle): CarPlan {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.05;
  const { top, belt } = o;
  const [pr, pf] = o.planEnds ?? [0.045, 0.055];
  const { rzb, rzt, fzb, fzt } = o.cab;
  const bs = fzb - rzb;
  const rs = fzt - rzt;
  const c = o.cab.c ?? [0.19, 0.075];
  const at = (fb: number, fr: number): [number, number] => [rzb + bs * fb, rzt + rs * fr];
  const seatX = Math.min(0.4, W - 0.4);
  const rearZ = -0.37 * h;
  const seats = [
    { x: -seatX, y: o.seatY, z: 0.02 },
    { x: seatX, y: o.seatY, z: 0.02 },
    { x: -seatX + 0.02, y: o.seatY, z: rearZ },
    { x: seatX - 0.02, y: o.seatY, z: rearZ },
    { x: 0, y: o.seatY, z: rearZ },
  ];
  return {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - pr], [-0.55 * h, W - 0.016], [0, W - 0.008], [0.55 * h, W - 0.018], [h, W - pf]]),
      cornerR: o.cornerR ?? [0.11, 0.07],
      cornerF: o.cornerF ?? [0.13, 0.085],
      shoulder: curve([
        [-h, belt - o.tailDrop],
        [-h + 0.07, belt - o.tailDrop + 0.01],
        [-0.62 * h, belt + 0.004],
        [0, belt],
        [0.45 * h, belt - 0.012],
        [0.75 * h, belt - o.noseDrop * 0.5],
        [h - 0.1, belt - o.noseDrop * 0.9],
        [h, belt - o.noseDrop],
      ]),
      lower: curve([[-h, o.sill + 0.09], [-h + 0.27, o.sill + 0.035], [-ax - 0.42, o.sill], [ax + 0.42, o.sill], [h - 0.22, o.sill + 0.02], [h, o.sill + 0.07]]),
      waistDrop: o.waistDrop ?? 0.19,
      lean: o.lean ?? 0.1,
      tuck: 0.04,
      rS: o.rS ?? 0.03,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: o.flare ?? 0.018,
      crown: o.crown ?? 0.028,
      barrel: o.barrel,
      rearDeck: [-h, rzb - 0.01],
      frontDeck: [fzb - 0.01, h],
      deckBow: [0.05, 0.07],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: o.cab.rearBow ?? 0.05 },
      front: { zb: fzb, zt: fzt, bow: o.cab.frontBow ?? 0.07 },
      roof: curve([[rzt, top - 0.062], [rzt + rs * 0.55, top - 0.036], [fzt, top - 0.052]]),
      crown: 0.03,
      lean: o.cab.lean,
      railR: o.cab.railR ?? 0.05,
      headerR: o.cab.headerR ?? 0.1,
      band: 0.035,
      panes: [
        { to: at(c[0], c[1]), kind: 'paint' },
        { to: at(0.571, 0.69), kind: 'glass' },
        { to: at(0.605, 0.763), kind: 'paint' },
        { to: at(0.968, 0.954), kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: o.frame,
    },
    interior: {
      floor: o.seatY,
      z0: rzb + 0.14,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3, 4],
      dash: { z: 0.21 * h, y: belt - 0.045 },
      shelf: { y: belt - 0.02, z: rzb },
      cloth: tint(o.cloth, 'cloth'),
    },
    wheel: o.wheel,
    rim: o.rim,
    belly: o.belly ?? 0.15,
    ageing: o.ageing ?? EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Door shut lines (two doors a side) and the boot and bonnet lines.
      const doorF = fzb - 0.03;
      const doorM = -0.02 * h;
      const doorR = rzb + bs * (c[0] - 0.012);
      for (const z of [doorF, doorM, doorR]) shell.vline(k, DARK, z, shell.yL(z) + 0.035, belt - 0.016);
      shell.hline(k, DARK, o.sill + 0.075, doorR + 0.05, doorF - 0.02);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, fzb + 0.05, h - 0.05);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.07, -h + 0.05, rzb - 0.1);
      shell.deckCross(k, DARK, rzb - 0.1, shell.sx(rzb - 0.1) - 0.07);
      scuttle(k, cab);
      shadeBand(k, cab);
      wipers(k, cab);
      o.dress(k, shell, cab, F, R);
    },
  };
}

// ───────────────────────────── Import coupe (Skyline R32 GTS-t) ─────────────────────────────

/** Four round tail lamps in a dark garnish, the signature of the car. */
function roundTails(k: Kit, R: Face, xs: [number, number], y: number, r: number): void {
  const z = R.z;
  const span = (xs[0] + r) * 2;
  if (k.lo) {
    R.pane(TAIL, span, r * 1.9, 0, y, 0.012);
    R.pane(RED_GLASS, span, r * 1.9, 0, y, 0.014);
    return;
  }
  R.pane(tint(0x121316, 'gloss'), span + 0.16, r * 2 + 0.09, 0, y, 0.006);
  for (const s of [1, -1]) {
    for (const x of xs) {
      k.drum(tint(0x1a1b1e, 'gloss'), r + 0.016, 0.014, s * x, y, z - 0.008, 'z', 14);
      k.drum(TAIL, r, 0.01, s * x, y, z - 0.016, 'z', 12);
      k.drum(RED_GLASS, r + 0.004, 0.006, s * x, y, z - 0.023, 'z', 12);
    }
  }
  // Reversing lamps in the middle of the garnish, either side of the badge.
  R.both(CLEAR_LENS, 0.07, 0.045, 0.13, y, 0.008, 0.002);
}

/** Low wide late-80s turbo coupe: thin lamps, four round tails, subtle boot spoiler. */
export function buildCoupe(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.05;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const top = spec.height;
  const wheel = pick<WheelStyle>(['alloy', 5], ['mesh', 5]);
  const seats = [
    { x: -0.38, y: 0.16, z: -0.1 },
    { x: 0.38, y: 0.16, z: -0.1 },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.07], [-1.2, W - 0.018], [0, W - 0.01], [1.2, W - 0.026], [h, W - 0.095]]),
      cornerR: [0.2, 0.13],
      cornerF: [0.28, 0.17],
      shoulder: curve([[-h, 0.78], [-h + 0.1, 0.8], [-1.45, 0.81], [0, 0.79], [1.0, 0.76], [1.7, 0.71], [h - 0.14, 0.665], [h, 0.64]]),
      lower: curve([[-h, 0.3], [-h + 0.3, 0.23], [-ax - 0.4, 0.185], [ax + 0.4, 0.185], [h - 0.3, 0.19], [h, 0.23]]),
      waistDrop: 0.18,
      lean: 0.15,
      tuck: 0.05,
      rS: 0.045,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.03,
      crown: 0.034,
      rearDeck: [-h, -1.43],
      frontDeck: [0.96, h],
      deckBow: [0.06, 0.09],
    },
    cabin: {
      rear: { zb: -1.42, zt: -0.78, bow: 0.07 },
      front: { zb: 0.95, zt: 0.17, bow: 0.09 },
      roof: curve([[-0.78, top - 0.06], [-0.25, top - 0.035], [0.17, top - 0.05]]),
      crown: 0.03,
      lean: 0.19,
      railR: 0.055,
      headerR: 0.13,
      band: 0.03,
      panes: [
        { to: [-0.95, -0.68], kind: 'paint' },
        { to: [-0.52, -0.47], kind: 'glass' },
        { to: [-0.46, -0.42], kind: 'black' },
        { to: [0.88, 0.12], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.16, z0: -1.1, z1: 0.96, seats, dash: { z: 0.36, y: 0.72 }, shelf: { y: 0.73, z: -1.42 }, cloth: tint(0x25262a, 'cloth'), back: 0.56 },
    wheel,
    belly: 0.1,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      mouldBumpers(k, shell, ax + ar + 0.03, 0.33);
      // Nose: thin rectangular lamps under the bonnet edge, a slot grille, intake and ambers in the bumper.
      F.headlamps(0.42, 0.52, 0.3, 0.075, { depth: 0.04 });
      F.grille(0, 0.52, 0.42, 0.055, { bars: 1, surface: DARK, depth: 0.04, badge: [0.05, 0.04] });
      F.box(DARK, 0.64, 0.065, 0, 0.29, 0.02, 0.062);
      F.both(AMBER, 0.13, 0.042, 0.41, 0.29, 0.01, 0.064);
      F.lens(LENS, 0.13, 0.042, 0.41, 0.29, 0.066);
      // Tail: the four round lamps, and a subtle boot spoiler.
      roundTails(k, R, [0.46, 0.28], 0.6, 0.082);
      if (!k.lo) {
        const sy = shell.deckY(-h + 0.17, 0) + 0.045;
        k.pad(PAINT, 2 * W - 0.42, 0.026, 0.17, 0, sy, -h + 0.16, 0.011, [0.08, 0, 0], true);
        k.boxes(PAINT, 0.06, 0.05, 0.12, 0.52, sy - 0.03, -h + 0.17);
      }
      // Long doors, flush handles, skirts.
      shell.deckCross(k, DARK, -h + 0.06, shell.sx(-h + 0.3) - 0.1);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 1.0, h - 0.07);
      scuttle(k, cab, 0.06);
      shadeBand(k, cab, 0.13);
      shell.vline(k, DARK, 0.88, 0.235, 0.77);
      shell.vline(k, DARK, -0.48, 0.235, 0.8);
      shell.hline(k, DARK, 0.23, -0.48, 0.88);
      handles(k, shell, [-0.34], 0.72, PLASTIC, true);
      for (const s of [1, -1]) k.pad(PAINT, 0.045, 0.09, spec.wheelbase - 2 * ar - 0.05, s * (shell.F(0, 0.21) + 0.004), 0.2, 0, 0.018);
      mirrors(k, shell, 0.76, 0.86, PAINT, 0.13, 0.085);
      wipers(k, cab, { span: 0.48 });
      repeater(k, shell, ax + ar + 0.09, 0.52);
      exhaust(k, -0.5, 0.19, -h - 0.05, 0.038, 0.24);
      fuelFlap(k, shell, -1.78, 0.68, 1, 0.14, 0.12);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.072, 0.33, -h - 0.074, 0.35, 'new');
  }).model;
}

// ───────────────────────────── The NZ-assembled three-boxes ─────────────────────────────

/** Square conservative mid-80s saloon: single wide lamps, eggcrate grille, chrome blades. */
export function buildCorona(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const wheel = pick<WheelStyle>(['hubcap', 5], ['cap', 3], ['steel', 2]);
  const fittings: Fittings = {
    tow: dice.chance(0.3) ? [-h - 0.1, 0.34] : undefined,
    flaps: dice.chance(0.2) ? [spec.track / 2, -ax - spec.wheelRadius - 0.075, 0.36, 0.18] : undefined,
  };
  const plan = saloon(spec, {
    top: spec.height,
    belt: 0.95,
    noseDrop: 0.105,
    tailDrop: 0.03,
    sill: 0.26,
    seatY: 0.3,
    cab: { rzb: -1.37, rzt: -0.86, fzb: 0.92, fzt: 0.26, lean: 0.16 },
    frame: CHROME,
    wheel,
    rim: 0x9a948a,
    cloth: pick([0x6a5a48, 1], [0x4a4f57, 1]),
    dress(k, shell, _cab, F, R) {
      bladeBumpers(k, shell, ax + ar + 0.04, 0.45);
      F.headlamps(0.44, 0.69, 0.3, 0.13, { bezel: CHROME });
      F.grille(0, 0.69, 0.5, 0.13, { bars: 3, upright: 4, badge: [0.065, 0.055], frame: CHROME });
      cornerLens(k, shell, 'front', AMBER, 0.69, 0.11, 0.13);
      R.taillamps(0.46, 0.715, 0.42, 0.14, { bezel: CHROME });
      R.box(CHROME, 1.3, 0.012, 0, 0.63, 0.01, 0.008);
      handles(k, shell, [0.06, -0.84], 0.86, CHROME);
      for (const [z0, z1] of [
        [-h + 0.14, -ax - ar - 0.05],
        [-ax + ar + 0.05, ax - ar - 0.05],
        [ax + ar + 0.05, h - 0.16],
      ]) {
        shell.band(k, RUBBER, 0.56, 0.59, z0, z1, [1, -1], 0.008, 1);
        shell.hline(k, CHROME, 0.597, z0, z1, 0.007, [1, -1], 0.01);
      }
      shell.hline(k, CHROME, 0.3, -ax + ar + 0.03, ax - ar - 0.03, 0.025, [1, -1], 0.004);
      mirrors(k, shell, 0.76, 1.01, CHROME);
      repeater(k, shell, ax + ar + 0.1, 0.6);
      aerial(k, -(shell.sx(1.45) - 0.08), shell.deckY(1.45, shell.sx(1.45) - 0.08), 1.45, 0.45);
      exhaust(k, 0.45, 0.28, -h - 0.04);
      fuelFlap(k, shell, -1.74, 0.76);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.085, 0.45, -h - 0.012, 0.715, 'any');
  }).model;
}

/** Square clean three-box with twin square lamps and a fine slatted grille. */
export function buildSigma(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const wheel = pick<WheelStyle>(['hubcap', 4], ['cap', 4], ['steel', 2]);
  const fittings: Fittings = {
    tow: dice.chance(0.3) ? [-h - 0.1, 0.34] : undefined,
    flaps: dice.chance(0.2) ? [spec.track / 2, -ax - spec.wheelRadius - 0.075, 0.36, 0.18] : undefined,
  };
  const plan = saloon(spec, {
    top: spec.height,
    belt: 0.94,
    noseDrop: 0.105,
    tailDrop: 0.028,
    sill: 0.25,
    seatY: 0.29,
    cornerR: [0.1, 0.06],
    cornerF: [0.12, 0.08],
    cab: { rzb: -1.4, rzt: -0.87, fzb: 0.94, fzt: 0.26, lean: 0.165 },
    frame: CHROME,
    wheel,
    rim: 0x95938c,
    cloth: pick([0x3c4360, 1], [0x5a4a3c, 1]),
    dress(k, shell, _cab, F, R) {
      bladeBumpers(k, shell, ax + ar + 0.04, 0.44);
      F.headlamps(0.465, 0.68, 0.33, 0.13, { twin: true, bezel: CHROME });
      F.grille(0, 0.68, 0.52, 0.13, { bars: 6, badge: [0.06, 0.05], frame: CHROME });
      cornerLens(k, shell, 'front', AMBER, 0.68, 0.11, 0.13);
      R.taillamps(0.45, 0.70, 0.44, 0.135, { bezel: CHROME });
      R.box(CHROME, 1.28, 0.012, 0, 0.615, 0.01, 0.008);
      R.box(CHROME, 0.16, 0.016, -0.5, 0.86, 0.006, 0.006);
      handles(k, shell, [0.06, -0.86], 0.85, CHROME);
      for (const [z0, z1] of [
        [-h + 0.14, -ax - ar - 0.05],
        [-ax + ar + 0.05, ax - ar - 0.05],
        [ax + ar + 0.05, h - 0.16],
      ]) {
        shell.band(k, RUBBER, 0.55, 0.58, z0, z1, [1, -1], 0.008, 1);
      }
      shell.hline(k, CHROME, 0.29, -ax + ar + 0.03, ax - ar - 0.03, 0.025, [1, -1], 0.004);
      mirrors(k, shell, 0.78, 1.0, CHROME);
      repeater(k, shell, ax + ar + 0.1, 0.59);
      aerial(k, -(shell.sx(1.5) - 0.08), shell.deckY(1.5, shell.sx(1.5) - 0.08), 1.5, 0.45);
      exhaust(k, 0.44, 0.27, -h - 0.04);
      fuelFlap(k, shell, -1.76, 0.75);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.085, 0.44, -h - 0.012, 0.70, 'any');
  }).model;
}

/** Low sleek aero saloon: slim flush lamp strips, body-colour bumpers, black trim. */
export function buildAccord(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const wheel = pick<WheelStyle>(['cap', 6], ['steel', 2], ['alloy', 2]);
  const fittings: Fittings = { tow: dice.chance(0.12) ? [-h - 0.1, 0.32] : undefined };
  const plan = saloon(spec, {
    top: spec.height,
    belt: 0.88,
    noseDrop: 0.145,
    tailDrop: 0.018,
    sill: 0.22,
    seatY: 0.25,
    planEnds: [0.05, 0.06],
    cornerR: [0.13, 0.08],
    cornerF: [0.17, 0.105],
    rS: 0.04,
    cab: { rzb: -1.4, rzt: -0.73, fzb: 0.88, fzt: 0.08, lean: 0.185, headerR: 0.13, rearBow: 0.06, frontBow: 0.09 },
    frame: RUBBER,
    wheel,
    rim: 0x9fa2a4,
    cloth: 0x4b4e55,
    ageing: CHERISHED,
    crown: 0.026,
    dress(k, shell, _cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.38);
      F.headlamps(0.415, 0.63, 0.36, 0.068, { depth: 0.035 });
      F.grille(0, 0.63, 0.4, 0.052, { bars: 1, surface: DARK, depth: 0.04, badge: [0.05, 0.04] });
      cornerLens(k, shell, 'front', AMBER, 0.63, 0.06, 0.2);
      F.box(DARK, 0.7, 0.06, 0, 0.345, 0.02, 0.058);
      R.taillamps(0.44, 0.73, 0.42, 0.115, {});
      R.box(tint(0x4a1013, 'gloss'), 0.46, 0.1, 0, 0.73, 0.02, 0.004);
      R.pane(TAIL_LENS, 0.45, 0.09, 0, 0.73, 0.008);
      handles(k, shell, [0.05, -0.85], 0.79, PLASTIC, true);
      shell.band(k, DARK, 0.5, 0.53, -ax + ar + 0.05, ax - ar - 0.05, [1, -1], 0.008, 1);
      mirrors(k, shell, 0.74, 0.94, PAINT, 0.13, 0.085);
      repeater(k, shell, ax + ar + 0.09, 0.56);
      aerial(k, 0.55, shell.deckY(1.55, 0.55), 1.55, 0.42);
      exhaust(k, 0.42, 0.24, -h - 0.04, 0.024, 0.2, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.78, 0.7, 1, 0.14, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.078, 0.4, -h - 0.078, 0.4, 'any');
  }).model;
}

/** Small round-shouldered 70s saloon: round lamps, chrome bumpers, usually faded. */
export function buildDatsun(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const wheel = pick<WheelStyle>(['steel', 4], ['dish', 4], ['hubcap', 2]);
  const fittings: Fittings = {
    tow: dice.chance(0.2) ? [-h - 0.09, 0.32] : undefined,
    flaps: dice.chance(0.25) ? [spec.track / 2, -ax - spec.wheelRadius - 0.07, 0.33, 0.16] : undefined,
  };
  const plan = saloon(spec, {
    top: spec.height,
    belt: 0.895,
    noseDrop: 0.13,
    tailDrop: 0.075,
    sill: 0.25,
    seatY: 0.27,
    planEnds: [0.055, 0.06],
    cornerR: [0.15, 0.095],
    cornerF: [0.17, 0.105],
    rS: 0.05,
    waistDrop: 0.17,
    barrel: 0.022,
    crown: 0.032,
    cab: { rzb: -1.21, rzt: -0.74, fzb: 0.81, fzt: 0.22, lean: 0.15, headerR: 0.12, c: [0.21, 0.09] },
    frame: CHROME,
    wheel,
    rim: 0xcfccc2,
    cloth: 0x4a3c32,
    ageing: TIRED,
    dress(k, shell, _cab, F, R) {
      bladeBumpers(k, shell, ax + ar + 0.04, 0.42);
      F.roundLamps(0.41, 0.615, 0.09);
      F.grille(0, 0.615, 0.42, 0.1, { bars: 4, badge: [0.05, 0.04], frame: CHROME });
      F.both(AMBER, 0.11, 0.05, 0.43, 0.49, 0.012, 0.006);
      R.taillamps(0.38, 0.65, 0.26, 0.115, { bezel: CHROME, reverse: false });
      R.box(CLEAR_LENS, 0.09, 0.05, 0, 0.56, 0.012, 0.006);
      handles(k, shell, [0.05, -0.75], 0.8, CHROME);
      shell.hline(k, CHROME, 0.6, -h + 0.25, h - 0.3, 0.012, [1, -1], 0.008);
      mirrors(k, shell, 0.68, 0.95, CHROME, 0.11, 0.08);
      aerial(k, -(shell.sx(1.3) - 0.08), shell.deckY(1.3, shell.sx(1.3) - 0.08), 1.3, 0.45);
      exhaust(k, 0.38, 0.24, -h - 0.04, 0.02, 0.18, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.52, 0.7, 1, 0.13, 0.11);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.08, 0.42, -h - 0.012, 0.65, 'old');
  }).model;
}

/** Brougham-style Japanese luxury import: formal roofline, full-width tail garnish, guard mirrors. */
export function buildImport(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const wheel = pick<WheelStyle>(['hubcap', 7], ['cap', 3]);
  const plan = saloon(spec, {
    top: spec.height,
    belt: 0.945,
    noseDrop: 0.085,
    tailDrop: 0.018,
    sill: 0.26,
    seatY: 0.3,
    planEnds: [0.042, 0.05],
    cornerR: [0.1, 0.06],
    cornerF: [0.12, 0.075],
    crown: 0.026,
    cab: { rzb: -1.36, rzt: -1.0, fzb: 0.98, fzt: 0.31, lean: 0.155, c: [0.235, 0.05] },
    frame: CHROME,
    wheel,
    rim: 0xb9b6ac,
    cloth: 0x5a3038,
    ageing: CHERISHED,
    dress(k, shell, _cab, F, R) {
      bladeBumpers(k, shell, ax + ar + 0.04, 0.45);
      // Formal upright chrome grille between slim wide lamps.
      F.headlamps(0.46, 0.70, 0.34, 0.1, { bezel: CHROME });
      F.grille(0, 0.70, 0.52, 0.115, { bars: 4, upright: 6, badge: [0.05, 0.06], frame: CHROME });
      cornerLens(k, shell, 'front', AMBER, 0.70, 0.09, 0.14);
      // Full-width tail garnish between the clusters.
      R.taillamps(0.47, 0.72, 0.4, 0.13, { bezel: CHROME });
      R.box(tint(0x45100e, 'gloss'), 0.56, 0.125, 0, 0.72, 0.02, 0.005);
      R.pane(TAIL_LENS, 0.55, 0.115, 0, 0.72, 0.009);
      R.box(CHROME, 1.34, 0.012, 0, 0.635, 0.01, 0.008);
      // The tell of the trade: wing mirrors out on the front guards, and no door mirrors.
      for (const s of [1, -1]) {
        const z = ax + 0.62;
        const y0 = shell.yS(z) + 0.002;
        const x0 = shell.F(z, y0 - 0.06) - 0.055;
        k.tube(CHROME, [s * x0, y0 - 0.01, z], [s * (x0 + 0.015), y0 + 0.12, z + 0.04], 0.011, 5, false, 0.008);
        k.pad(CHROME, 0.085, 0.065, 0.03, s * (x0 + 0.02), y0 + 0.145, z + 0.05, 0.012);
        k.box(BRIGHT, 0.068, 0.05, 0.004, s * (x0 + 0.02), y0 + 0.145, z + 0.032);
      }
      handles(k, shell, [0.08, -0.82], 0.865, CHROME);
      for (const [z0, z1] of [
        [-h + 0.14, -ax - ar - 0.05],
        [-ax + ar + 0.05, ax - ar - 0.05],
        [ax + ar + 0.05, h - 0.16],
      ]) {
        shell.band(k, RUBBER, 0.57, 0.605, z0, z1, [1, -1], 0.008, 1);
        shell.hline(k, CHROME, 0.612, z0, z1, 0.007, [1, -1], 0.01);
      }
      shell.hline(k, CHROME, 0.3, -ax + ar + 0.03, ax - ar - 0.03, 0.028, [1, -1], 0.004);
      shell.hline(k, CHROME, (z) => shell.yS(z) + 0.001, -1.3, 0.9, 0.008, [1, -1], 0.006);
      repeater(k, shell, ax + ar + 0.1, 0.6);
      aerial(k, shell.sx(-1.85) - 0.1, shell.deckY(-1.85, shell.sx(-1.85) - 0.1), -1.85, 0.42);
      exhaust(k, 0.46, 0.28, -h - 0.04);
      fuelFlap(k, shell, -1.8, 0.78);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.085, 0.45, -h - 0.082, 0.44, 'new');
  }).model;
}

/** Upright boxy Eastern-bloc saloon: flat panels, plain lamps, chrome-less grille. */
export function buildLada(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const ar = spec.wheelRadius + 0.05;
  const fittings: Fittings = {
    tow: dice.chance(0.35) ? [-h - 0.09, 0.33] : undefined,
    flaps: dice.chance(0.5) ? [spec.track / 2, -ax - spec.wheelRadius - 0.07, 0.35, 0.17] : undefined,
  };
  const plan = saloon(spec, {
    top: spec.height,
    belt: 0.96,
    noseDrop: 0.05,
    tailDrop: 0.015,
    sill: 0.27,
    seatY: 0.3,
    planEnds: [0.03, 0.035],
    cornerR: [0.07, 0.04],
    cornerF: [0.085, 0.05],
    rS: 0.02,
    waistDrop: 0.2,
    lean: 0.08,
    crown: 0.018,
    barrel: 0.008,
    cab: { rzb: -1.28, rzt: -0.885, fzb: 0.86, fzt: 0.33, lean: 0.12, railR: 0.04, headerR: 0.08 },
    frame: STEEL,
    wheel: 'steel',
    rim: 0xd8d5c9,
    cloth: 0x5c3a30,
    ageing: TIRED,
    dress(k, shell, _cab, F, R) {
      bladeBumpers(k, shell, ax + ar + 0.04, 0.45, STEEL);
      F.headlamps(0.42, 0.70, 0.27, 0.14, { bezel: STEEL });
      F.grille(0, 0.70, 0.52, 0.14, { bars: 4, upright: 2, surface: PLASTIC, depth: 0.05 });
      F.both(AMBER, 0.12, 0.05, 0.42, 0.51, 0.012, 0.006);
      R.taillamps(0.42, 0.72, 0.3, 0.15, {});
      handles(k, shell, [0.05, -0.8], 0.87, STEEL);
      shell.hline(k, STEEL, 0.62, -h + 0.22, h - 0.26, 0.01, [1, -1], 0.008);
      mirrors(k, shell, 0.7, 1.02, tint(0x26282b, 'matte'), 0.11, 0.08);
      aerial(k, -(shell.sx(1.35) - 0.08), shell.deckY(1.35, shell.sx(1.35) - 0.08), 1.35, 0.45);
      exhaust(k, 0.4, 0.25, -h - 0.04, 0.02, 0.18, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.62, 0.76, 1, 0.13, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.085, 0.45, -h - 0.012, 0.72, 'any');
  }).model;
}
