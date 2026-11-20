import * as THREE from 'three';
import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import type { Cabin, Shell } from './body';
import { AMBER, AMBER_LENS, BRIGHT, CHROME, CLEAR_LENS, curve, DARK, dice, HEAD, Kit, LENS, PAINT, PLASTIC, RED_LENS, RUBBER, SMOKED, smooth, TAIL_LENS, tint, type Pt, type Tint, type V3, type WheelStyle } from './kit';
import { aerial, assemble, bumper, CHERISHED, cornerLens, EVERYDAY, type Ageing, exhaust, Face, fuelFlap, handles, mirrors, mudflaps, roofRack, scuttle, shadeBand, TIRED, towbar, wipers, type CarPlan } from './parts';

/**
 * The passenger cars. Each is a plan (shell, glasshouse, interior, fittings) handed to `assemble`.
 * Makes and models are invented; the shapes are the general run of early-90s New Zealand traffic.
 */

/** Small side repeater / marker lamp on both flanks. */
function repeater(k: Kit, shell: Shell, z: number, y: number, surface: Tint = AMBER): void {
  for (const s of [1, -1]) k.box(surface, 0.012, 0.03, 0.07, s * (shell.F(z, y) + 0.004), y, z);
}

// ───────────────────────────── Big six sedan, its wagon and the patrol car ─────────────────────────────

interface SedanOptions {
  /** Height of the roof panel (a light bar or a rack stands on top of it). */
  top: number;
  wheel: WheelStyle;
  rim?: number;
  cloth: number;
  wagon?: boolean;
  /** Imitation woodgrain along the flanks (wagon). */
  wood?: boolean;
  ageing?: Ageing;
  extras?: (k: Kit, shell: Shell, cab: Cabin) => void;
}

/**
 * Upright mid-80s Falcon XF: chrome blade bumpers, twin square lamps, formal roofline. Used by the
 * wagon and, with a roof sign, the cab.
 */
function sedanPlan(spec: VehicleSpec, o: SedanOptions): CarPlan {
  const h = spec.length / 2 - 0.075;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.055;
  const top = o.top;
  // Seat heights leave the seated figure (1.05 m from the seat position to the top of the head) clear of the headlining.
  const seats = [
    { x: -0.4, y: 0.3, z: 0.0 },
    { x: 0.4, y: 0.3, z: 0.0 },
    { x: -0.4, y: 0.3, z: -0.88 },
    { x: 0.4, y: 0.3, z: -0.88 },
    { x: 0, y: 0.3, z: -0.88 },
  ];
  return {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.05], [-1.3, W - 0.017], [0, W - 0.008], [1.3, W - 0.02], [h, W - 0.06]]),
      cornerR: o.wagon ? [0.1, 0.06] : [0.13, 0.085],
      cornerF: [0.15, 0.095],
      shoulder: curve([[-h, o.wagon ? 0.955 : 0.94], [-h + 0.07, 0.966], [-1.5, 0.978], [0, 0.972], [0.98, 0.962], [1.75, 0.915], [h - 0.1, 0.87], [h, 0.845]]),
      lower: curve([[-h, 0.37], [-h + 0.3, 0.3], [-ax - 0.45, 0.25], [ax + 0.45, 0.25], [h - 0.25, 0.28], [h, 0.34]]),
      waistDrop: 0.19,
      lean: 0.1,
      tuck: 0.045,
      rS: 0.028,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.02,
      crown: 0.03,
      rearDeck: o.wagon ? null : [-h, -1.49],
      frontDeck: [0.97, h],
      deckBow: [0.05, 0.07],
    },
    cabin: {
      rear: o.wagon ? { zb: -h + 0.035, zt: -h + 0.34, bow: 0.03 } : { zb: -1.5, zt: -0.93, bow: 0.05 },
      front: { zb: 0.98, zt: 0.27, bow: 0.07 },
      roof: o.wagon ? curve([[-h + 0.34, top - 0.06], [-1.2, top - 0.036], [-0.2, top - 0.036], [0.27, top - 0.05]]) : curve([[-0.93, top - 0.062], [-0.35, top - 0.036], [0.27, top - 0.05]]),
      crown: 0.03,
      lean: o.wagon ? 0.14 : 0.165,
      railR: 0.05,
      headerR: 0.1,
      band: 0.035,
      panes: o.wagon
        ? [
            { to: [-h + 0.3, -h + 0.47], kind: 'paint' },
            { to: [-1.15, -1.13], kind: 'glass' },
            { to: [-1.06, -1.04], kind: 'paint' },
            { to: [-0.085, -0.1], kind: 'glass' },
            { to: [0.0, -0.015], kind: 'paint' },
            { to: [0.9, 0.215], kind: 'glass' },
            { to: 'front', kind: 'paint' },
          ]
        : [
            { to: [-1.03, -0.84], kind: 'paint' },
            { to: [-0.085, -0.1], kind: 'glass' },
            { to: [0.0, -0.015], kind: 'paint' },
            { to: [0.9, 0.215], kind: 'glass' },
            { to: 'front', kind: 'paint' },
          ],
      frame: CHROME,
    },
    interior: o.wagon
      ? { floor: 0.3, z0: -1.3, z1: 0.99, seats, bench: [2, 3, 4], dash: { z: 0.5, y: 0.925 }, cargo: { y: 0.62, z: -h + 0.09 }, cloth: tint(o.cloth, 'cloth') }
      : { floor: 0.3, z0: -1.36, z1: 0.99, seats, bench: [2, 3, 4], dash: { z: 0.5, y: 0.925 }, shelf: { y: 0.95, z: -1.5 }, cloth: tint(o.cloth, 'cloth') },
    wheel: o.wheel,
    rim: o.rim,
    belly: 0.16,
    ageing: o.ageing ?? TIRED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Chrome blade bumpers with a rubber insert, wrapped round to the arches.
      const blade: Pt[] = [[-0.03, -0.058], [0.05, -0.058], [0.074, -0.03], [0.074, 0.03], [0.05, 0.058], [-0.03, 0.058]];
      const insert: Pt[] = [[0.0745, -0.02], [0.084, 0], [0.0745, 0.02]];
      for (const end of ['front', 'rear'] as const) {
        const zStart = (end === 'front' ? 1 : -1) * (ax + ar + 0.04);
        bumper(k, shell, end, CHROME, blade, { zStart, y: 0.47 });
        bumper(k, shell, end, RUBBER, insert, { zStart, y: 0.47 });
      }
      // Nose: twin square sealed beams each side of a slatted grille, amber indicators round the corners.
      F.headlamps(0.545, 0.705, 0.34, 0.15, { twin: true, bezel: CHROME });
      F.grille(0, 0.705, 0.7, 0.15, { bars: 6, upright: 1, badge: [0.075, 0.075], frame: CHROME });
      cornerLens(k, shell, 'front', AMBER, 0.705, 0.13, 0.15);
      // Over-riders on the bumper, either side of the plate.
      for (const s of [1, -1]) k.pad(RUBBER, 0.05, 0.15, 0.05, s * 0.34, 0.475, h + 0.085, 0.015);
      // Shut lines on the bonnet, scuttle, doors.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 1.02, h - 0.05);
      scuttle(k, cab);
      shadeBand(k, cab);
      shell.vline(k, DARK, 0.95, 0.33, 0.955);
      shell.vline(k, DARK, -0.04, 0.33, 0.955);
      shell.vline(k, DARK, -1.055, 0.56, 0.955);
      shell.hline(k, DARK, 0.328, -1.0, 0.95);
      handles(k, shell, [0.11, -0.9], 0.868, CHROME);
      // Rubbing strip along the doors and wings, bright strip along the sills.
      for (const [z0, z1] of [
        [-h + 0.14, -ax - ar - 0.05],
        [-ax + ar + 0.05, ax - ar - 0.05],
        [ax + ar + 0.05, h - 0.16],
      ]) {
        shell.band(k, RUBBER, 0.56, 0.6, z0, z1, [1, -1], 0.009, 1);
        shell.hline(k, CHROME, 0.607, z0, z1, 0.008, [1, -1], 0.01);
      }
      shell.hline(k, CHROME, 0.292, -ax + ar + 0.03, ax - ar - 0.03, 0.03, [1, -1], 0.004);
      mirrors(k, shell, 0.8, 1.035, CHROME);
      wipers(k, cab);
      aerial(k, -(shell.sx(1.45) - 0.08), shell.deckY(1.45, shell.sx(1.45) - 0.08), 1.45, 0.5);
      exhaust(k, 0.52, 0.275, -h - 0.04);
      fuelFlap(k, shell, o.wagon ? -2.02 : -1.98, 0.8);
      if (o.wagon) {
        // Tailgate: upright lamps on the corners, plate recess, handle, wiper, and its shut lines.
        R.taillamps(0.7, 0.74, 0.15, 0.3, { upright: true, bezel: CHROME });
        R.box(DARK, 1.2, 0.008, 0, 0.56, 0.006, 0.003);
        R.both(DARK, 0.008, 0.36, 0.6, 0.74, 0.006, 0.003);
        R.box(CHROME, 0.2, 0.03, 0, 0.86, 0.02, 0.014);
        R.box(CHROME, 1.16, 0.012, 0, 0.6, 0.012, 0.01);
        k.beam(DARK, cab.back(0.05, 0.03, 0.014), cab.back(0.55, 0.12, 0.014), 0.014, 0.01);
        // Imitation woodgrain along the flanks, framed in a paler moulding.
        const wood = tint(0x5d3f25, 'satin');
        const edge = tint(0xb89a6c, 'satin');
        for (const [z0, z1] of !o.wood ? [] : [
          [-h + 0.14, -ax - ar - 0.07],
          [-ax + ar + 0.07, ax - ar - 0.07],
          [ax + ar + 0.07, h - 0.18],
        ]) {
          shell.band(k, wood, 0.625, 0.775, z0, z1, [1, -1], 0.004, 1);
          shell.hline(k, edge, 0.78, z0, z1, 0.012, [1, -1], 0.006);
          shell.hline(k, edge, 0.62, z0, z1, 0.012, [1, -1], 0.006);
        }
      } else {
        // Tail: wide lamp clusters either side of the plate, a bright strip under them, boot shut lines.
        R.taillamps(0.5, 0.775, 0.48, 0.16, { bezel: CHROME });
        cornerLens(k, shell, 'rear', RED_LENS, 0.775, 0.15, 0.12);
        R.box(CHROME, 1.5, 0.014, 0, 0.672, 0.012, 0.01);
        R.box(DARK, 1.46, 0.008, 0, 0.652, 0.006, 0.003);
        R.box(CHROME, 0.035, 0.035, 0, 0.9, 0.012, 0.008);
        R.box(CHROME, 0.17, 0.018, -0.55, 0.9, 0.006, 0.006);
        // Rubber-faced over-riders.
        for (const s of [1, -1]) k.pad(RUBBER, 0.05, 0.15, 0.05, s * 0.34, 0.475, -h - 0.085, 0.015);
        shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.075, -h + 0.05, -1.62);
        shell.deckCross(k, DARK, -1.62, shell.sx(-1.62) - 0.075);
      }
      o.extras?.(k, shell, cab);
    },
  };
}

/** What one car has that the next of its kind may not. Each is a small cached piece of its own. */
interface Fittings {
  /** Tow bar: z of the tail, height of the tongue. */
  tow?: [z: number, y: number];
  /** Mud flaps behind the rear wheels: half-track, z, top, width. */
  flaps?: [x: number, z: number, top: number, w: number];
  /** Roof rack: half-width, roof height, z of its ends, bars. */
  rack?: [x: number, y: number, z0: number, z1: number, bars: number];
}

function fit(k: Kit, id: string, f: Fittings): void {
  const { tow, flaps, rack } = f;
  if (tow) k.cached(`${id}|tow`, (c) => towbar(c, tow[0], tow[1]));
  if (flaps) k.cached(`${id}|flaps`, (c) => mudflaps(c, flaps[0], flaps[1], flaps[2], flaps[3], 0.14));
  if (rack) k.cached(`${id}|rack${rack[4]}`, (c) => roofRack(c, rack[0], rack[1], rack[2], rack[3], rack[4]));
}

/** Pick one of several by weight. */
function pick<T>(...options: [T, number][]): T {
  let roll = dice.next() * options.reduce((sum, o) => sum + o[1], 0);
  for (const [value, weight] of options) if ((roll -= weight) <= 0) return value;
  return options[0][0];
}

interface CommodoreOptions {
  /** Roof height (the patrol car's light bar stands on top of it). */
  top: number;
  /** Rounded-off 1993 facelift (the patrol car): softer corners, raised tail lamps. */
  round?: boolean;
  /**
   * The V8 sports model: boot spoiler, chin spoiler, sill skirts, driving lamps, twin pipes. 'ss' keeps the
   * Commodore's nose; 'xr' is the Falcon's, four round lamps in a grille-less panel and red bumper strips.
   */
  sport?: 'ss' | 'xr';
  wheel: WheelStyle;
  rim?: number;
  cloth: number;
  ageing?: Ageing;
  extras?: (k: Kit, shell: Shell, cab: Cabin) => void;
}

/**
 * The widened late-80s Commodore body (VN) and its rounded 1993 facelift (VR): long flat bonnet,
 * near-flush rectangular lamps the width of the nose, plastic bumpers, six-light glasshouse.
 */
function commodorePlan(spec: VehicleSpec, o: CommodoreOptions): CarPlan {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.05;
  const top = o.top;
  const round = o.round ?? false;
  const sport = o.sport;
  const seats = [
    { x: -0.38, y: 0.3, z: 0.05 },
    { x: 0.38, y: 0.3, z: 0.05 },
    { x: -0.38, y: 0.3, z: -0.84 },
    { x: 0.38, y: 0.3, z: -0.84 },
    { x: 0, y: 0.3, z: -0.84 },
  ];
  return {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.06], [-1.3, W - 0.018], [0, W - 0.008], [1.3, W - 0.022], [h, W - 0.07]]),
      cornerR: round ? [0.18, 0.12] : [0.13, 0.08],
      cornerF: round ? [0.24, 0.16] : [0.16, 0.1],
      shoulder: curve([[-h, round ? 0.885 : 0.87], [-h + 0.1, round ? 0.915 : 0.9], [-1.5, 0.925], [0, 0.915], [1.0, 0.9], [1.8, 0.855], [h - 0.12, 0.8], [h, round ? 0.76 : 0.775]]),
      lower: curve([[-h, 0.35], [-h + 0.3, 0.28], [-ax - 0.45, 0.23], [ax + 0.45, 0.23], [h - 0.25, 0.25], [h, 0.31]]),
      waistDrop: 0.17,
      lean: round ? 0.15 : 0.12,
      tuck: 0.045,
      rS: round ? 0.045 : 0.028,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.022,
      crown: 0.032,
      rearDeck: [-h, -1.42],
      frontDeck: [1.02, h],
      deckBow: [0.06, 0.08],
    },
    cabin: {
      rear: { zb: -1.43, zt: -0.76, bow: 0.06 },
      front: { zb: 1.04, zt: 0.26, bow: 0.08 },
      roof: curve([[-0.76, top - 0.07], [-0.28, top - 0.038], [0.26, top - 0.055]]),
      crown: 0.032,
      lean: round ? 0.18 : 0.16,
      railR: round ? 0.06 : 0.05,
      headerR: round ? 0.14 : 0.11,
      band: 0.03,
      // Six-light glasshouse: a quarter pane behind each rear door.
      panes: [
        { to: [-1.3, -0.72], kind: 'paint' },
        { to: [-1.05, -0.66], kind: 'glass' },
        { to: [-1.0, -0.63], kind: 'black' },
        { to: [-0.08, -0.12], kind: 'glass' },
        { to: [0.0, -0.05], kind: 'black' },
        { to: [0.95, 0.235], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: PLASTIC,
    },
    interior: { floor: 0.3, z0: -1.32, z1: 1.05, seats, bench: [2, 3, 4], dash: { z: 0.55, y: 0.89 }, shelf: { y: 0.91, z: -1.43 }, cloth: tint(o.cloth, 'cloth') },
    wheel: o.wheel,
    rim: o.rim,
    belly: 0.15,
    ageing: o.ageing ?? EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Moulded plastic bumpers, body colour with a full-width dark rub strip.
      const moulding: Pt[] = [[-0.03, -0.14], [0.025, -0.145], [0.05, -0.11], [0.056, -0.03], [0.056, 0.05], [0.04, 0.085], [-0.03, 0.09]];
      const insert: Pt[] = [[0.0565, -0.012], [0.064, 0.012], [0.0565, 0.036]];
      const strip = sport === 'xr' ? tint(0xb5141c, 'gloss') : DARK;
      for (const end of ['front', 'rear'] as const) {
        const zStart = (end === 'front' ? 1 : -1) * (ax + ar + 0.03);
        bumper(k, shell, end, PAINT, moulding, { zStart, y: 0.43, bow: 0.02 });
        bumper(k, shell, end, strip, insert, { zStart, y: 0.43, bow: 0.02 });
      }
      // Nose: near-flush rectangular lamps the full width, a slot of a grille between them.
      if (sport === 'xr') {
        // The sports Falcon: four round lamps in a body-colour panel, no grille, a slot under the bonnet lip.
        F.roundLamps(0.53, 0.645, 0.062);
        F.roundLamps(0.375, 0.645, 0.062);
        F.grille(0, 0.625, 0.4, 0.03, { bars: 1, surface: DARK, depth: 0.03, badge: [0.075, 0.035] });
      } else {
        if (round) F.headlamps(0.43, 0.64, 0.37, 0.11, { depth: 0.035 });
        else F.headlamps(0.45, 0.64, 0.44, 0.115, { depth: 0.035 });
        F.grille(0, 0.64, round ? 0.36 : 0.34, round ? 0.075 : 0.09, { bars: round ? 1 : 2, surface: round ? PAINT : PLASTIC, depth: 0.05, badge: [0.06, 0.045] });
      }
      cornerLens(k, shell, 'front', AMBER, 0.64, 0.09, 0.22);
      // Tail: wide clusters joined by an applique panel; the facelift carries them high on the boot.
      const ty = round ? 0.77 : 0.71;
      R.taillamps(0.44, ty, 0.42, 0.12);
      R.box(tint(0x1a0d0c, 'gloss'), 0.46, 0.11, 0, ty, 0.012, 0.004);
      R.pane(TAIL_LENS, 0.45, 0.1, 0, ty, 0.007);
      cornerLens(k, shell, 'rear', RED_LENS, ty, 0.1, 0.18);
      // Shut lines, handles, rub strip.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.055, 1.08, h - 0.06);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.08, -h + 0.05, -1.54);
      shell.deckCross(k, DARK, -1.54, shell.sx(-1.54) - 0.08);
      scuttle(k, cab);
      shadeBand(k, cab);
      shell.vline(k, DARK, 0.98, 0.3, 0.9);
      shell.vline(k, DARK, -0.03, 0.3, 0.92);
      shell.vline(k, DARK, -1.0, 0.56, 0.93);
      shell.hline(k, DARK, 0.295, -0.96, 0.96);
      handles(k, shell, [0.1, -0.88], 0.84, PLASTIC, true);
      shell.band(k, DARK, 0.55, 0.585, -h + 0.2, h - 0.25, [1, -1], 0.008, 1);
      mirrors(k, shell, 0.82, 1.0, PAINT, 0.13, 0.09);
      wipers(k, cab);
      repeater(k, shell, ax + ar + 0.1, 0.6);
      aerial(k, -(shell.sx(1.5) - 0.09), shell.deckY(1.5, shell.sx(1.5) - 0.09), 1.5, 0.45);
      exhaust(k, 0.5, 0.26, -h - 0.04);
      fuelFlap(k, shell, -1.96, 0.76);
      if (sport) {
        // Driving lamps and an intake in the bumper, a chin spoiler under it, skirts along the sills.
        F.box(DARK, 0.5, 0.06, 0, 0.36, 0.02, 0.058);
        F.both(CLEAR_LENS, 0.14, 0.055, 0.45, 0.36, 0.012, 0.06);
        k.pad(PAINT, 2 * W - 0.34, 0.05, 0.12, 0, 0.285, h - 0.03, 0.02);
        for (const s of [1, -1]) k.pad(PAINT, 0.05, 0.1, spec.wheelbase - 2 * ar - 0.05, s * (shell.F(0, 0.26) + 0.004), 0.25, 0, 0.02);
        // A wing standing on the boot lid, and the second pipe.
        if (!k.lo) {
          const sy = shell.deckY(-h + 0.19, 0) + 0.075;
          k.pad(PAINT, 2 * W - 0.46, 0.03, 0.2, 0, sy, -h + 0.18, 0.012, [0.09, 0, 0], true);
          k.boxes(PAINT, 0.07, 0.07, 0.13, W - 0.4, sy - 0.04, -h + 0.19);
        }
        exhaust(k, 0.37, 0.26, -h - 0.04);
      }
      o.extras?.(k, shell, cab);
    },
  };
}

/** Holden Commodore VN stand-in: the big six, everywhere in 1995. */
export function buildSedan(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  // Most still wear their fluted covers; some have the plainer ones, some have lost them altogether.
  const wheel = pick<WheelStyle>(['hubcap', 5], ['cap', 3], ['steel', 2]);
  const fittings: Fittings = {
    tow: dice.chance(0.35) ? [-h - 0.12, 0.36] : undefined,
    flaps: dice.chance(0.25) ? [spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.075, 0.36, 0.2] : undefined,
  };
  const plan = commodorePlan(spec, { top: spec.height, wheel, rim: 0x8f8a7c, cloth: pick([0x5a4a3c, 1], [0x4a4f57, 1], [0x6b2f2a, 1]) });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.095, 0.43, -h - 0.012, 0.6, 'any');
  }).model;
}

/**
 * Holden Commodore VR SS stand-in: the rounded 1993 body with the V8, the body kit and alloys. The quick
 * Holden of 1995, nearly new.
 */
export function buildCommodoreSS(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const plan = commodorePlan(spec, { top: spec.height, round: true, sport: 'ss', wheel: 'alloy', cloth: 0x2c2e33, ageing: CHERISHED });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.095, 0.43, -h - 0.012, 0.6, 'new');
  }).model;
}

/**
 * Ford Falcon EF XR8 stand-in: the same size and shape of car from the other camp (a rounded six-light
 * four-door), told apart by its four round lamps, the missing grille and the red strips in its bumpers.
 */
export function buildFalconXR(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const plan = commodorePlan(spec, { top: spec.height, round: true, sport: 'xr', wheel: 'alloy', cloth: 0x2a2c30, ageing: CHERISHED });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.095, 0.43, -h - 0.012, 0.6, 'new');
  }).model;
}

/** The sedan's long-roofed cousin: most carry a roof rack and a strip of imitation woodgrain. */
export function buildWagon(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.075;
  const top = spec.height - 0.055;
  const wheel = pick<WheelStyle>(['hubcap', 4], ['cap', 3], ['steel', 3]);
  const wood = dice.chance(0.6);
  const fittings: Fittings = {
    tow: dice.chance(0.55) ? [-h - 0.1, 0.36] : undefined,
    flaps: dice.chance(0.3) ? [spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.075, 0.36, 0.2] : undefined,
    rack: dice.chance(0.65) ? [0.54, top - 0.012, -h + 0.5, -0.1, 4] : undefined,
  };
  const plan = sedanPlan(spec, { top, wheel, rim: 0x8f8a7c, cloth: 0x6a5a48, wagon: true, wood });
  return assemble(spec, color, m, `${spec.id}|${wood}`, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.09, 0.47, -h - 0.012, 0.72, 'any');
  }).model;
}

/** The royal blue and signal red of the 1995 livery. */
const NZP_BLUE = tint(0x163a9e, 'gloss');
const NZP_RED = tint(0xc2231c, 'gloss');

/**
 * A nose-to-tail band of small slanted blue dashes at upper-door height: the mark of the 1995 patrol
 * car. Each dash is a parallelogram lying on the flank; the distant version drops them (too small).
 */
function dashBand(k: Kit, shell: Shell, z0: number, z1: number, yLo: number, yHi: number): void {
  if (k.lo) return;
  for (const s of [1, -1]) {
    for (let z = z0; z < z1; z += 0.165) {
      const p = (dz: number, y: number): V3 => [s * (shell.F(z + dz, y) + 0.0045), y, z + dz];
      k.poly(NZP_BLUE, [p(0, yLo), p(0.08, yLo), p(0.125, yHi), p(0.045, yHi)], [0, (yLo + yHi) / 2, z]);
    }
  }
}

/** Red one half, blue the other, black siren speaker between: the roof bar of the day. */
function rooflights(k: Kit, roof: number, z: number): void {
  k.pad(PLASTIC, 1.12, 0.045, 0.3, 0, roof + 0.014, z, 0.012);
  k.pad('beacon0', 0.42, 0.1, 0.24, -0.31, roof + 0.078, z, 0.03);
  k.pad('beacon1', 0.42, 0.1, 0.24, 0.31, roof + 0.078, z, 0.03);
  k.box(PLASTIC, 0.18, 0.09, 0.2, 0, roof + 0.07, z);
}

/** The flashing pair the vehicle system drives; they must be this car's own. */
function makeBeacons(m: MaterialLibrary): THREE.MeshStandardMaterial[] {
  const beacon = (c: number) => m.register(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.25 }));
  return [beacon(0xd0181c), beacon(0x1a46d6)];
}

/**
 * Holden Commodore VR patrol car in the documented 1995 livery: all-white, blue dash band nose to
 * tail, royal-blue front-door panel with a red leading edge and white POLICE, blue POLICE with a red
 * slash on the bonnet, red and blue roof bar, steel wheels.
 */
export function buildPolice(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const bar = 0.14;
  const roof = spec.height - bar;
  const beacons = makeBeacons(m);
  const door = m.sign('POLICE', { bg: '#163a9e', fg: '#ffffff', style: 'block', aspect: 4, border: false });
  const deck = m.sign('POLICE', { bg: '#f3f3ee', fg: '#163a9e', style: 'block', aspect: 4, border: false });
  const plan = commodorePlan(spec, {
    top: roof,
    round: true,
    wheel: 'steel',
    rim: 0xd8d5cc,
    cloth: 0x3c4046,
    ageing: CHERISHED,
    extras(k, shell) {
      rooflights(k, roof, -0.26);
      dashBand(k, shell, -h + 0.28, h - 0.42, 0.775, 0.845);
      // Front door: solid royal-blue panel, thin red leading edge, white POLICE.
      shell.band(k, NZP_BLUE, 0.45, 0.74, 0.03, 0.9, [1, -1], 0.004, 2);
      shell.band(k, NZP_RED, 0.45, 0.74, 0.9, 0.935, [1, -1], 0.004, 2);
      if (!k.lo) {
        const x = shell.F(0.47, 0.6) + 0.011;
        k.board(door, 0.56, 0.14, x, 0.6, 0.47, Math.PI / 2);
        k.board(door, 0.56, 0.14, -x, 0.6, 0.47, -Math.PI / 2);
        // Bonnet and boot: blue POLICE and the red slash under it.
        k.board(deck, 0.6, 0.15, 0, shell.deckY(1.68, 0) + 0.006, 1.68, 0, -Math.PI / 2 + 0.06);
        k.board(deck, 0.6, 0.15, 0, shell.deckY(-h + 0.5, 0) + 0.005, -h + 0.5, Math.PI, -Math.PI / 2);
        k.poly(NZP_RED, [shell.top(1.38, -0.42, 0.006), shell.top(1.44, -0.42, 0.006), shell.top(1.56, 0.42, 0.006), shell.top(1.5, 0.42, 0.006)], [0, -2, 1.47]);
        k.poly(NZP_RED, [shell.top(-h + 0.26, 0.42, 0.005), shell.top(-h + 0.32, 0.42, 0.005), shell.top(-h + 0.42, -0.42, 0.005), shell.top(-h + 0.36, -0.42, 0.005)], [0, -2, -h + 0.34]);
      }
      mudflaps(k, spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.075, 0.36, 0.2, 0.17);
    },
  });
  const built = assemble(spec, color, m, spec.id, plan, (k) => {
    // The beacons are drawn at every distance: a flashing light bar is how a patrol car is seen coming.
    k.role('beacon0', beacons[0], true);
    k.role('beacon1', beacons[1], true);
    // Scale just under one keeps the diced bumper sticker off a fleet car (and inside the mesh budget).
    k.plates(h + 0.095, 0.43, -h - 0.012, 0.6, 'new', 0.995);
  });
  return { ...built.model, beacons };
}

// ───────────────────────────── V8 sedan ─────────────────────────────

/**
 * Ford Falcon XD/XE 5.0 stand-in: square-edged European look, quad rectangular lamps, eggcrate
 * grille, chromeless dark bumpers; the boy racer's one is lowered on mags with a boot spoiler.
 */
export function buildV8Sedan(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.05;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.05;
  const top = spec.height;
  const wheel = pick<WheelStyle>(['alloy', 6], ['mesh', 4]);
  const spoiler = dice.chance(0.7);
  const fittings: Fittings = { tow: dice.chance(0.15) ? [-h - 0.1, 0.3] : undefined };
  const seats = [
    { x: -0.4, y: 0.25, z: 0.02 },
    { x: 0.4, y: 0.25, z: 0.02 },
    { x: -0.4, y: 0.24, z: -0.86 },
    { x: 0.4, y: 0.24, z: -0.86 },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.065], [-1.3, W - 0.02], [0, W - 0.01], [1.3, W - 0.024], [h, W - 0.075]]),
      cornerR: [0.12, 0.075],
      cornerF: [0.15, 0.1],
      shoulder: curve([[-h, 0.9], [-h + 0.1, 0.925], [-1.45, 0.935], [0, 0.925], [1.1, 0.915], [1.85, 0.89], [h - 0.1, 0.855], [h, 0.845]]),
      lower: curve([[-h, 0.33], [-h + 0.3, 0.25], [-ax - 0.45, 0.2], [ax + 0.45, 0.2], [h - 0.3, 0.2], [h, 0.24]]),
      waistDrop: 0.19,
      lean: 0.1,
      tuck: 0.05,
      rS: 0.03,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.03,
      crown: 0.032,
      // Power bulge down the middle of the bonnet.
      hump: (z, x) => 0.028 * smooth(0.36, 0.2, x) * smooth(1.12, 1.35, z) * smooth(h - 0.12, h - 0.45, z),
      rearDeck: [-h, -1.42],
      frontDeck: [1.03, h],
      deckBow: [0.05, 0.07],
    },
    cabin: {
      rear: { zb: -1.43, zt: -0.78, bow: 0.05 },
      front: { zb: 1.05, zt: 0.24, bow: 0.07 },
      roof: curve([[-0.78, top - 0.065], [-0.3, top - 0.036], [0.24, top - 0.052]]),
      crown: 0.03,
      lean: 0.16,
      railR: 0.05,
      headerR: 0.1,
      band: 0.03,
      // Six-light: the thin quarter pane behind the rear door.
      panes: [
        { to: [-1.32, -0.74], kind: 'paint' },
        { to: [-1.05, -0.69], kind: 'glass' },
        { to: [-1.0, -0.66], kind: 'black' },
        { to: [-0.075, -0.09], kind: 'glass' },
        { to: [0.005, -0.02], kind: 'black' },
        { to: [0.96, 0.21], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.23, z0: -1.33, z1: 1.06, seats, bench: [2, 3], dash: { z: 0.53, y: 0.87 }, shelf: { y: 0.885, z: -1.43 }, cloth: tint(0x2c2e33, 'cloth') },
    wheel,
    belly: 0.13,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Chromeless moulded bumpers in dark grey plastic, and a deep front air dam with driving lamps.
      const grey = tint(0x2e3134, 'satin');
      const moulding: Pt[] = [[-0.03, -0.15], [0.02, -0.155], [0.04, -0.12], [0.046, -0.04], [0.046, 0.05], [0.032, 0.085], [-0.03, 0.09]];
      for (const end of ['front', 'rear'] as const) {
        const zStart = (end === 'front' ? 1 : -1) * (ax + ar + 0.03);
        bumper(k, shell, end, grey, moulding, { zStart, y: 0.42, bow: 0.015 });
      }
      F.box(DARK, 0.86, 0.07, 0, 0.3, 0.02, 0.066);
      F.both(BRIGHT, 0.15, 0.06, 0.5, 0.3, 0.012, 0.068);
      F.both(HEAD, 0.12, 0.04, 0.5, 0.3, 0.006, 0.07);
      F.lens(LENS, 0.14, 0.052, 0.5, 0.3, 0.072);
      // Nose: quad rectangular sealed beams flanking the eggcrate grille.
      F.headlamps(0.52, 0.68, 0.37, 0.135, { twin: true, bezel: null });
      F.grille(0, 0.68, 0.56, 0.13, { bars: 4, upright: 9, surface: tint(0x4b4e52, 'satin'), depth: 0.055, badge: [0.05, 0.04] });
      cornerLens(k, shell, 'front', AMBER, 0.68, 0.1, 0.2);
      // Tail: square clusters either side of a dark applique panel.
      R.taillamps(0.47, 0.73, 0.42, 0.14);
      R.box(tint(0x1c1d1f, 'gloss'), 0.5, 0.13, 0, 0.73, 0.014, 0.004);
      R.pane(TAIL_LENS, 0.49, 0.12, 0, 0.73, 0.007);
      cornerLens(k, shell, 'rear', RED_LENS, 0.73, 0.12, 0.18);
      // Shut lines.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.08, -h + 0.05, -1.55);
      shell.deckCross(k, DARK, -1.55, shell.sx(-1.55) - 0.08);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 1.08, h - 0.06);
      scuttle(k, cab);
      shadeBand(k, cab);
      shell.vline(k, DARK, 0.98, 0.28, 0.9);
      shell.vline(k, DARK, -0.035, 0.28, 0.92);
      shell.vline(k, DARK, -1.04, 0.56, 0.93);
      shell.hline(k, DARK, 0.275, -1.0, 0.98);
      handles(k, shell, [0.1, -0.88], 0.84, PLASTIC, true);
      // Rubbing strip, side skirts, mirrors.
      shell.band(k, DARK, 0.5, 0.535, -ax + ar + 0.05, ax - ar - 0.05, [1, -1], 0.008, 1);
      for (const s of [1, -1]) k.pad(PAINT, 0.05, 0.1, spec.wheelbase - 2 * ar - 0.05, s * (shell.F(0, 0.24) + 0.005), 0.225, 0, 0.02);
      mirrors(k, shell, 0.86, 0.97, PAINT);
      wipers(k, cab);
      repeater(k, shell, ax + ar + 0.1, 0.6);
      aerial(k, shell.sx(-1.85) - 0.1, shell.deckY(-1.85, shell.sx(-1.85) - 0.1), -1.85, 0.42);
      exhaust(k, 0.5, 0.22, -h - 0.05, 0.03);
      exhaust(k, 0.42, 0.22, -h - 0.05, 0.03);
      fuelFlap(k, shell, -1.95, 0.78);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k, shell) => {
    if (spoiler) {
      // Boot spoiler on two pedestals.
      k.cached(`${spec.id}|spoiler`, (c) => {
        const sy = shell.deckY(-h + 0.16, 0) + 0.07;
        c.pad(PAINT, 2 * W - 0.3, 0.035, 0.21, 0, sy, -h + 0.15, 0.014, [0.07, 0, 0], true);
        c.boxes(PAINT, 0.07, 0.07, 0.14, 0.6, sy - 0.04, -h + 0.16);
      });
    }
    fit(k, spec.id, fittings);
    k.plates(h + 0.078, 0.42, -h - 0.078, 0.43, 'new');
  }).model;
}

// ───────────────────────────── Import coupe ─────────────────────────────

/** Low wedge with a fastback hatch, long doors, a full-width tail-lamp bar and a rear wing. */
export function buildCoupe(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.05;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const top = spec.height;
  const wheel = pick<WheelStyle>(['mesh', 5], ['alloy', 5]);
  const wing = dice.chance(0.75);
  const sunroof = dice.chance(0.6);
  const seats = [
    { x: -0.36, y: 0.16, z: -0.2 },
    { x: 0.36, y: 0.16, z: -0.2 },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.075], [-1.1, W - 0.02], [-0.2, W - 0.012], [1.0, W - 0.035], [h, W - 0.11]]),
      cornerR: [0.22, 0.13],
      cornerF: [0.3, 0.19],
      shoulder: curve([[-h, 0.865], [-h + 0.12, 0.905], [-1.6, 0.91], [-0.2, 0.865], [0.9, 0.82], [1.5, 0.75], [h - 0.16, 0.625], [h, 0.585]]),
      lower: curve([[-h, 0.3], [-h + 0.3, 0.22], [-ax - 0.4, 0.17], [ax + 0.4, 0.17], [h - 0.3, 0.18], [h, 0.22]]),
      waistDrop: 0.17,
      lean: 0.16,
      tuck: 0.055,
      rS: 0.045,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.034,
      crown: 0.036,
      rearDeck: [-h, -1.63],
      frontDeck: [0.87, h],
      deckBow: [0.07, 0.1],
    },
    cabin: {
      rear: { zb: -1.65, zt: -0.6, bow: 0.08 },
      front: { zb: 0.9, zt: 0.1, bow: 0.1 },
      roof: curve([[-0.6, top - 0.07], [-0.25, top - 0.036], [0.1, top - 0.052]]),
      crown: 0.03,
      lean: 0.21,
      railR: 0.055,
      headerR: 0.16,
      band: 0.028,
      panes: [
        { to: [-1.22, -0.55], kind: 'paint' },
        { to: [-0.62, -0.5], kind: 'glass' },
        { to: [-0.54, -0.43], kind: 'black' },
        { to: [0.82, 0.055], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
      rearGlass: SMOKED,
    },
    interior: { floor: 0.2, z0: -0.72, z1: 0.9, seats, dash: { z: 0.32, y: 0.79 }, cargo: { y: 0.5, z: -1.6 }, cloth: tint(0x25262a, 'cloth'), back: 0.56 },
    wheel,
    belly: 0.1,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      const moulding: Pt[] = [[-0.03, -0.13], [0.018, -0.135], [0.036, -0.1], [0.042, -0.03], [0.042, 0.045], [0.03, 0.08], [-0.03, 0.085]];
      for (const end of ['front', 'rear'] as const) bumper(k, shell, end, PAINT, moulding, { zStart: (end === 'front' ? 1 : -1) * (ax + ar + 0.03), y: 0.35, bow: 0.025 });
      // Nose: slim lamps under the bonnet's leading edge, indicators and an intake in the bumper.
      F.headlamps(0.34, 0.49, 0.3, 0.06, { depth: 0.04 });
      F.grille(0, 0.49, 0.3, 0.04, { bars: 1, surface: DARK, depth: 0.04 });
      cornerLens(k, shell, 'front', AMBER, 0.49, 0.055, 0.3);
      F.box(DARK, 0.6, 0.06, 0, 0.27, 0.02, 0.066);
      F.both(CLEAR_LENS, 0.16, 0.035, 0.4, 0.36, 0.01, 0.066);
      F.lens(LENS, 0.16, 0.035, 0.4, 0.36, 0.068);
      // Tail: a lamp bar the width of the car (clusters joined by a reflector), plate in the bumper.
      R.taillamps(0.36, 0.74, 0.46, 0.09);
      R.box(RED_LENS, 0.26, 0.085, 0, 0.74, 0.02, 0.006);
      R.pane(TAIL_LENS, 0.25, 0.075, 0, 0.74, 0.008);
      cornerLens(k, shell, 'rear', RED_LENS, 0.74, 0.085, 0.24);
      // Hatch and bonnet shut lines, long doors.
      shell.deckCross(k, DARK, -h + 0.05, shell.sx(-h + 0.3) - 0.1);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 0.92, h - 0.07);
      scuttle(k, cab, 0.06);
      shadeBand(k, cab, 0.13);
      shell.vline(k, DARK, 0.82, 0.24, 0.81);
      shell.vline(k, DARK, -0.56, 0.24, 0.86);
      shell.hline(k, DARK, 0.235, -0.56, 0.82);
      handles(k, shell, [-0.42], 0.76, PLASTIC, true);
      for (const s of [1, -1]) k.pad(PAINT, 0.045, 0.09, spec.wheelbase - 2 * ar - 0.05, s * (shell.F(0, 0.2) + 0.004), 0.19, 0, 0.018);
      mirrors(k, shell, 0.7, 0.905, PAINT, 0.13, 0.085);
      wipers(k, cab, { span: 0.48 });
      repeater(k, shell, ax + ar + 0.08, 0.5);
      exhaust(k, -0.48, 0.19, -h - 0.05, 0.04, 0.25);
      fuelFlap(k, shell, -1.85, 0.72, 1, 0.14, 0.12);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k, shell) => {
    if (wing) {
      // Pedestal wing.
      k.cached(`${spec.id}|wing`, (c) => {
        const sy = shell.deckY(-h + 0.14, 0) + 0.1;
        c.pad(PAINT, 2 * W - 0.26, 0.03, 0.2, 0, sy, -h + 0.14, 0.012, [0.09, 0, 0], true);
        c.boxes(PAINT, 0.05, 0.1, 0.11, 0.5, sy - 0.055, -h + 0.15);
      });
    }
    if (sunroof) {
      // Glass sunroof in a rubber seal.
      k.cached(`${spec.id}|sunroof`, (c) => {
        const ry = top - 0.01;
        c.poly(SMOKED, [[-0.36, ry, -0.46], [0.36, ry, -0.46], [0.36, ry - 0.006, -0.06], [-0.36, ry - 0.006, -0.06]], [0, 0, -0.25]);
        for (const z of [-0.46, -0.06]) c.box(RUBBER, 0.74, 0.006, 0.014, 0, ry + 0.002 - (z > -0.2 ? 0.006 : 0), z);
        c.boxes(RUBBER, 0.014, 0.006, 0.4, 0.36, ry, -0.26);
      });
    }
    k.plates(h + 0.076, 0.35, -h - 0.076, 0.36, 'new');
  }).model;
}

// ───────────────────────────── Small hatchback ─────────────────────────────

/** Two-box shopping car: short bonnet, upright tailgate, grey bumpers, steel wheels. */
export function buildHatch(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.05;
  const top = spec.height;
  const wheel = pick<WheelStyle>(['steel', 9], ['cap', 7], ['hubcap', 4]);
  const fittings: Fittings = {
    tow: dice.chance(0.15) ? [-h - 0.09, 0.3] : undefined,
    flaps: dice.chance(0.3) ? [spec.track / 2, -ax - r - 0.07, 0.3, 0.17] : undefined,
    rack: dice.chance(0.12) ? [0.5, top - 0.014, -0.95, -0.15, 2] : undefined,
  };
  const seats = [
    { x: -0.34, y: 0.26, z: -0.12 },
    { x: 0.34, y: 0.26, z: -0.12 },
    { x: -0.33, y: 0.26, z: -0.9 },
    { x: 0.33, y: 0.26, z: -0.9 },
  ];
  const grey = tint(0x3f4246, 'matte');
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.05], [-0.9, W - 0.016], [0, W - 0.01], [0.9, W - 0.022], [h, W - 0.065]]),
      cornerR: [0.11, 0.07],
      cornerF: [0.16, 0.1],
      shoulder: curve([[-h, 0.9], [-1.0, 0.908], [0.0, 0.9], [0.7, 0.885], [1.3, 0.835], [h - 0.09, 0.78], [h, 0.755]]),
      lower: curve([[-h, 0.31], [-h + 0.2, 0.25], [-ax - 0.38, 0.2], [ax + 0.38, 0.2], [h - 0.2, 0.22], [h, 0.27]]),
      waistDrop: 0.2,
      lean: 0.1,
      tuck: 0.04,
      rS: 0.035,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      crown: 0.022,
      rearDeck: null,
      frontDeck: [0.69, h],
      deckBow: [0, 0.06],
    },
    cabin: {
      rear: { zb: -h + 0.03, zt: -h + 0.4, bow: 0.035 },
      front: { zb: 0.72, zt: -0.02, bow: 0.06 },
      roof: curve([[-h + 0.4, top - 0.065], [-0.7, top - 0.036], [-0.02, top - 0.05]]),
      crown: 0.028,
      lean: 0.14,
      railR: 0.045,
      headerR: 0.09,
      band: 0.03,
      panes: [
        { to: [-h + 0.27, -h + 0.52], kind: 'paint' },
        { to: [-0.44, -0.45], kind: 'glass' },
        { to: [-0.36, -0.37], kind: 'black' },
        { to: [0.64, -0.065], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.25, z0: -1.28, z1: 0.73, seats, bench: [2, 3], dash: { z: 0.36, y: 0.85 }, cargo: { y: 0.56, z: -h + 0.08 }, cloth: tint(0x55606a, 'cloth'), back: 0.56 },
    wheel,
    rim: 0xb9bcbe,
    belly: 0.13,
    ageing: EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Unpainted grey bumpers.
      const moulding: Pt[] = [[-0.03, -0.085], [0.04, -0.085], [0.064, -0.055], [0.064, 0.05], [0.045, 0.08], [-0.03, 0.08]];
      for (const end of ['front', 'rear'] as const) bumper(k, shell, end, grey, moulding, { zStart: (end === 'front' ? 1 : -1) * (ax + ar + 0.03), y: 0.4 });
      // Nose: plain rectangular lamps, a narrow grille, indicators in the bumper.
      F.headlamps(0.455, 0.625, 0.28, 0.12);
      F.grille(0, 0.625, 0.58, 0.09, { bars: 3, surface: grey, depth: 0.05 });
      F.both(AMBER, 0.17, 0.045, 0.42, 0.42, 0.01, 0.068);
      F.lens(AMBER_LENS, 0.17, 0.045, 0.42, 0.42, 0.07);
      cornerLens(k, shell, 'front', AMBER, 0.625, 0.1, 0.13);
      // Tailgate: upright lamps on the corners, plate between, handle, wiper.
      R.taillamps(0.585, 0.7, 0.14, 0.25, { upright: true });
      R.box(DARK, 1.0, 0.008, 0, 0.52, 0.006, 0.003);
      R.both(DARK, 0.008, 0.36, 0.52, 0.7, 0.006, 0.003);
      R.box(grey, 0.16, 0.03, 0, 0.82, 0.02, 0.012);
      k.beam(DARK, cab.back(0.05, 0.03, 0.014), cab.back(0.5, 0.13, 0.014), 0.014, 0.01);
      // Bonnet and door shut lines (two long doors), rubbing strip.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.045, 0.74, h - 0.03);
      scuttle(k, cab, 0.06);
      shadeBand(k, cab, 0.13);
      shell.vline(k, DARK, 0.7, 0.27, 0.885);
      shell.vline(k, DARK, -0.4, 0.27, 0.9);
      shell.hline(k, DARK, 0.265, -0.4, 0.7);
      handles(k, shell, [-0.25], 0.79, grey);
      shell.band(k, grey, 0.5, 0.535, -ax + ar + 0.04, ax - ar - 0.04, [1, -1], 0.008, 1);
      mirrors(k, shell, 0.58, 0.95, grey, 0.11, 0.09);
      wipers(k, cab, { span: 0.46 });
      aerial(k, -(shell.sx(0.2) - 0.14), cab.roofY(0) - 0.03, -0.08, 0.2, 0.5);
      exhaust(k, 0.4, 0.21, -h - 0.04, 0.02, 0.2, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.5, 0.72, 1, 0.13, 0.12);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.072, 0.4, -h - 0.012, 0.66, 'any');
  }).model;
}

// ───────────────────────────── Taxi ─────────────────────────────

/**
 * Ford Falcon XF stand-in as a cab: white, a two-band door decal (dark TAXI band over a red band with
 * the 03 number), and a lit roof sign. Never a tow bar; the roof sign glows at night but is no beacon.
 */
export function buildTaxi(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.075;
  const top = spec.height - 0.08;
  const wheel = pick<WheelStyle>(['hubcap', 5], ['steel', 5]);
  const brand = m.sign('★ TAXI', { bg: '#15161a', fg: '#f2efe4', style: 'block', aspect: 4, border: false });
  const phone = m.sign('03 688 2803', { bg: '#a11c1c', fg: '#ffffff', style: 'block', aspect: 4.6, border: false });
  const plan = sedanPlan(spec, {
    top,
    wheel,
    rim: 0xd8d5cc,
    cloth: 0x4a4f57,
    ageing: EVERYDAY,
    extras(k, shell, cab) {
      if (k.lo) return;
      // Roof sign box over the front seats (the sign material is neon-less but pale: it reads lit).
      const ry = cab.roofY(0.05) + 0.004;
      k.pad(PLASTIC, 0.4, 0.035, 0.15, 0, ry + 0.014, 0.05, 0.01);
      k.box(tint(0xeeeae0, 'gloss'), 0.42, 0.115, 0.13, 0, ry + 0.095, 0.05);
      k.board(brand, 0.4, 0.1, 0, ry + 0.095, 0.118, 0);
      k.board(brand, 0.4, 0.1, 0, ry + 0.095, -0.018, Math.PI);
      // Door decal on both front doors.
      for (const s of [1, -1]) {
        const x = shell.F(0.45, 0.68) + 0.012;
        k.board(brand, 0.52, 0.13, s * x, 0.75, 0.45, (s * Math.PI) / 2);
        k.board(phone, 0.52, 0.113, s * x, 0.625, 0.45, (s * Math.PI) / 2);
      }
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.09, 0.47, -h - 0.012, 0.775, 'any');
  }).model;
}

// ───────────────────────────── The 70s three-box ─────────────────────────────

interface SeventiesOptions {
  top: number;
  /** Belt (shoulder) height amidships. */
  belt: number;
  /** Nose: one round pair, two round pairs, or rectangular units, centred (outer pair) at lampX. */
  lamps: 'single' | 'quad' | 'rect';
  lampX: number;
  lampY: number;
  /** Radius of a round lamp, or the width and height of a rectangular one. */
  lampR?: number;
  lampW?: number;
  lampH?: number;
  grilleH: number;
  grilleBars: number;
  /** Rear lamp clusters: centre, size, stacked upright or not. */
  tail: { x: number; y: number; w: number; h: number; upright?: boolean };
  /** Coke-bottle pinch at the doors (the HQ hip). */
  hip?: number;
  bumperY: number;
  wheel: WheelStyle;
  rim?: number;
  cloth: number;
  ageing?: Ageing;
  extras?: (k: Kit, shell: Shell, cab: Cabin) => void;
}

/** Chrome blade bumper with a rubber insert, the fitting of the whole chrome era. */
function bladeBumpers(k: Kit, shell: Shell, zStart: number, y: number, scale = 1): void {
  const blade: Pt[] = [[-0.03, -0.058 * scale], [0.05, -0.058 * scale], [0.074, -0.03 * scale], [0.074, 0.03 * scale], [0.05, 0.058 * scale], [-0.03, 0.058 * scale]];
  const insert: Pt[] = [[0.0745, -0.02 * scale], [0.084, 0], [0.0745, 0.02 * scale]];
  for (const end of ['front', 'rear'] as const) {
    const z = (end === 'front' ? 1 : -1) * zStart;
    bumper(k, shell, end, CHROME, blade, { zStart: z, y });
    bumper(k, shell, end, RUBBER, insert, { zStart: z, y });
  }
}

/**
 * The chrome-era Australian and British three-box: low belt, thin pillars, rain gutters, blade
 * bumpers, lamps set in a full-width bright grille. Shapes scale with the spec, so one plan serves
 * the big Holden, the Valiant, the Cortina and the Triumph with different noses.
 */
function seventiesPlan(spec: VehicleSpec, o: SeventiesOptions): CarPlan {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.055;
  const f = spec.length / 4.85;
  const top = o.top;
  const b = o.belt;
  const hip = o.hip ?? 0;
  const seatY = Math.min(0.28, spec.height - 1.11);
  const sx = Math.min(0.37, W - 0.42);
  const seats = [
    { x: -sx, y: seatY, z: 0.12 * f },
    { x: sx, y: seatY, z: 0.12 * f },
    { x: -sx, y: seatY, z: 0.12 * f - 0.84 * f },
    { x: sx, y: seatY, z: 0.12 * f - 0.84 * f },
    { x: 0, y: seatY, z: 0.12 * f - 0.84 * f },
  ];
  return {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.06], [-1.3 * f, W - 0.01], [0, W - 0.014 - hip], [1.2 * f, W - 0.02], [h, W - 0.065]]),
      cornerR: [0.1, 0.07],
      cornerF: [0.12, 0.08],
      shoulder: curve([[-h, b - 0.045], [-h + 0.12 * f, b - 0.02], [-1.3 * f, b], [0, b], [1.0 * f, b - 0.01], [1.75 * f, b - 0.05], [h - 0.1, b - 0.1], [h, b - 0.105]]),
      lower: curve([[-h, 0.345], [-h + 0.3, 0.285], [-ax - 0.4, 0.24], [ax + 0.4, 0.24], [h - 0.25, 0.26], [h, 0.32]]),
      waistDrop: 0.17,
      lean: 0.08,
      tuck: 0.05,
      rS: 0.035,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.018,
      crown: 0.035,
      rearDeck: [-h, -1.38 * f],
      frontDeck: [0.95 * f, h],
      deckBow: [0.05, 0.06],
    },
    cabin: {
      rear: { zb: -1.39 * f, zt: -0.84 * f, bow: 0.05 },
      front: { zb: 0.97 * f, zt: 0.3 * f, bow: 0.06 },
      roof: curve([[-0.84 * f, top - 0.055], [-0.3 * f, top - 0.032], [0.3 * f, top - 0.046]]),
      crown: 0.028,
      lean: 0.17,
      railR: 0.045,
      headerR: 0.09,
      band: 0.035,
      panes: [
        { to: [-0.98 * f, -0.76 * f], kind: 'paint' },
        { to: [-0.07 * f, -0.1 * f], kind: 'glass' },
        { to: [0.0, -0.02 * f], kind: 'paint' },
        { to: [0.88 * f, 0.27 * f], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: CHROME,
      gutter: CHROME,
    },
    interior: {
      floor: seatY - 0.02,
      z0: -1.28 * f,
      z1: 0.98 * f,
      seats,
      bench: [2, 3, 4],
      dash: { z: 0.52 * f, y: b - 0.045 },
      shelf: { y: b - 0.06, z: -1.39 * f },
      cloth: tint(o.cloth, 'cloth'),
      headrests: false,
    },
    wheel: o.wheel,
    rim: o.rim,
    belly: 0.16,
    ageing: o.ageing ?? TIRED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      bladeBumpers(k, shell, ax + ar + 0.04, o.bumperY);
      // Nose: the lamps sit inside a full-width bright grille band.
      let grilleEdge: number;
      if (o.lamps === 'rect') {
        const lw = o.lampW ?? 0.33;
        F.headlamps(o.lampX, o.lampY, lw, o.lampH ?? 0.145, { bezel: CHROME });
        grilleEdge = o.lampX - lw / 2 - 0.04;
      } else {
        const lr = o.lampR ?? 0.085;
        F.roundLamps(o.lampX, o.lampY, lr);
        let inner = o.lampX;
        if (o.lamps === 'quad') {
          inner = o.lampX - (2 * lr + 0.028);
          F.roundLamps(inner, o.lampY, lr);
        }
        grilleEdge = inner - lr - 0.04;
        F.frame(CHROME, 2 * (o.lampX + lr + 0.025), o.grilleH + 0.03, 0, o.lampY);
      }
      F.grille(0, o.lampY, grilleEdge * 2, o.grilleH, { bars: o.grilleBars, frame: CHROME, badge: [0.05, 0.045] });
      cornerLens(k, shell, 'front', AMBER, o.lampY, 0.09, 0.12);
      // Tail: chrome-bezelled clusters, a bright strip between, the plate on the panel.
      R.taillamps(o.tail.x, o.tail.y, o.tail.w, o.tail.h, { upright: o.tail.upright, bezel: CHROME, reverse: false });
      R.box(CHROME, o.tail.x * 2 - o.tail.w - 0.04, 0.016, 0, o.tail.y, 0.012, 0.008);
      cornerLens(k, shell, 'rear', RED_LENS, o.tail.y, Math.min(0.1, o.tail.h - 0.01), 0.1);
      // Shut lines, chrome spear, handles, gutters.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 1.0 * f, h - 0.05);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.07, -h + 0.05, -1.46 * f);
      shell.deckCross(k, DARK, -1.46 * f, shell.sx(-1.46 * f) - 0.07);
      scuttle(k, cab);
      shell.vline(k, DARK, 0.92 * f, 0.33, b - 0.03);
      shell.vline(k, DARK, -0.04 * f, 0.33, b - 0.02);
      shell.vline(k, DARK, -1.0 * f, 0.56, b - 0.02);
      shell.hline(k, DARK, 0.325, -0.96 * f, 0.9 * f);
      handles(k, shell, [0.1 * f, -0.86 * f], b - 0.1, CHROME);
      // Chrome spear in three runs so it never crosses an open wheel arch.
      for (const [z0, z1] of [
        [-h + 0.16, -ax - ar - 0.05],
        [-ax + ar + 0.05, ax - ar - 0.05],
        [ax + ar + 0.05, h - 0.2],
      ]) shell.hline(k, CHROME, b - 0.26, z0, z1, 0.014, [1, -1], 0.008);
      mirrors(k, shell, 0.74 * f, b + 0.06, CHROME, 0.11, 0.08);
      wipers(k, cab, { span: 0.46 });
      aerial(k, -(shell.sx(1.3 * f) - 0.07), shell.deckY(1.3 * f, shell.sx(1.3 * f) - 0.07), 1.3 * f, 0.55);
      exhaust(k, 0.42, 0.26, -h - 0.04, 0.024, 0.2, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.85 * f, 0.72);
      o.extras?.(k, shell, cab);
    },
  };
}

/** Holden HQ to HZ Kingswood stand-in: coke-bottle hip, single round lamps, full-width chrome grille. */
export function buildKingswood(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const wheel = pick<WheelStyle>(['hubcap', 4], ['steel', 4], ['cap', 2]);
  const fittings: Fittings = {
    tow: dice.chance(0.4) ? [-h - 0.11, 0.38] : undefined,
    flaps: dice.chance(0.3) ? [spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.08, 0.37, 0.21] : undefined,
  };
  const plan = seventiesPlan(spec, {
    top: spec.height,
    belt: 0.875,
    lamps: 'single',
    lampX: 0.66,
    lampY: 0.6,
    lampR: 0.092,
    grilleH: 0.16,
    grilleBars: 5,
    tail: { x: 0.52, y: 0.7, w: 0.34, h: 0.13 },
    hip: 0.016,
    bumperY: 0.42,
    wheel,
    rim: 0x9a948a,
    cloth: pick([0x6b4a2f, 1], [0x4a4f57, 1], [0x6e3b2a, 1]),
    ageing: TIRED,
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.1, 0.42, -h - 0.012, 0.57, 'old');
  }).model;
}

/** Chrysler Valiant stand-in: big blunt slab sides, four round lamps on the NZ Regal nose. */
export function buildValiant(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const wheel = pick<WheelStyle>(['hubcap', 4], ['steel', 5], ['cap', 1]);
  const fittings: Fittings = {
    tow: dice.chance(0.3) ? [-h - 0.11, 0.38] : undefined,
  };
  const plan = seventiesPlan(spec, {
    top: spec.height,
    belt: 0.885,
    lamps: 'quad',
    lampX: 0.69,
    lampY: 0.6,
    lampR: 0.056,
    grilleH: 0.13,
    grilleBars: 3,
    tail: { x: 0.5, y: 0.69, w: 0.42, h: 0.12 },
    bumperY: 0.43,
    wheel,
    rim: 0x8f8a7c,
    cloth: pick([0x5a4a3c, 1], [0x3f4a56, 1]),
    ageing: TIRED,
    extras(k) {
      // Chrome over-riders either side of the front plate.
      for (const s of [1, -1]) k.pad(CHROME, 0.05, 0.14, 0.05, s * 0.36, 0.44, h + 0.095, 0.015);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.1, 0.43, -h - 0.012, 0.56, 'old');
  }).model;
}

/** Ford Cortina Mk IV/V stand-in: NZ's best seller 1977 to 1983, clean folded-paper three-box. */
export function buildCortina(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const wheel = pick<WheelStyle>(['hubcap', 4], ['steel', 4], ['cap', 3]);
  const fittings: Fittings = {
    tow: dice.chance(0.3) ? [-h - 0.1, 0.34] : undefined,
    flaps: dice.chance(0.25) ? [spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.07, 0.33, 0.18] : undefined,
    rack: dice.chance(0.1) ? [0.46, spec.height - 0.012, -0.75, 0.12, 2] : undefined,
  };
  const plan = seventiesPlan(spec, {
    top: spec.height,
    belt: 0.85,
    lamps: 'rect',
    lampX: 0.47,
    lampY: 0.585,
    lampW: 0.33,
    lampH: 0.145,
    grilleH: 0.115,
    grilleBars: 4,
    tail: { x: 0.44, y: 0.64, w: 0.32, h: 0.14 },
    bumperY: 0.4,
    wheel,
    rim: 0x9c9890,
    cloth: pick([0x5a4a3c, 1], [0x4a4f57, 1], [0x6b2f2a, 1]),
    ageing: EVERYDAY,
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.1, 0.4, -h - 0.012, 0.52, 'any');
  }).model;
}

/** Triumph 2500 stand-in: Nelson-assembled long-bonnet saloon, four round lamps, chrome everywhere. */
export function buildTriumph(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const wheel = pick<WheelStyle>(['hubcap', 5], ['cap', 3], ['steel', 2]);
  const plan = seventiesPlan(spec, {
    top: spec.height,
    belt: 0.86,
    lamps: 'quad',
    lampX: 0.59,
    lampY: 0.59,
    lampR: 0.052,
    grilleH: 0.11,
    grilleBars: 2,
    tail: { x: 0.45, y: 0.65, w: 0.3, h: 0.1 },
    bumperY: 0.4,
    wheel,
    rim: 0xb9b4a6,
    cloth: pick([0x5a3b2e, 1], [0x3a4440, 1]),
    ageing: EVERYDAY,
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.1, 0.4, -h - 0.012, 0.54, 'old');
  }).model;
}

// ───────────────────────────── Mini ─────────────────────────────

/** Mini stand-in: wheels at the corners, round lamps, chrome grille, ten-inch wheels. */
export function buildMini(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.05;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.04;
  const seats = [
    { x: -0.3, y: 0.18, z: 0.08 },
    { x: 0.3, y: 0.18, z: 0.08 },
    { x: -0.28, y: 0.2, z: -0.52 },
    { x: 0.28, y: 0.2, z: -0.52 },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.05], [-0.8, W - 0.012], [0, W - 0.008], [0.8, W - 0.016], [h, W - 0.055]]),
      cornerR: [0.09, 0.06],
      cornerF: [0.11, 0.08],
      shoulder: curve([[-h, 0.66], [-1.1, 0.73], [-0.5, 0.755], [0.2, 0.755], [0.8, 0.74], [1.15, 0.7], [h, 0.66]]),
      lower: curve([[-h, 0.3], [-h + 0.2, 0.26], [-ax - 0.33, 0.22], [ax + 0.33, 0.22], [h - 0.2, 0.24], [h, 0.28]]),
      waistDrop: 0.14,
      lean: 0.06,
      tuck: 0.04,
      rS: 0.03,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.02,
      crown: 0.028,
      rearDeck: [-h, -1.0],
      frontDeck: [0.52, h],
      deckBow: [0.04, 0.05],
    },
    cabin: {
      rear: { zb: -1.02, zt: -0.6, bow: 0.04 },
      front: { zb: 0.55, zt: 0.26, bow: 0.05 },
      roof: curve([[-0.6, 1.305], [-0.15, 1.325], [0.26, 1.31]]),
      crown: 0.022,
      lean: 0.13,
      railR: 0.04,
      headerR: 0.08,
      band: 0.03,
      panes: [
        { to: [-0.98, -0.57], kind: 'paint' },
        { to: [-0.45, -0.42], kind: 'glass' },
        { to: [-0.38, -0.36], kind: 'black' },
        { to: [0.48, 0.22], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: CHROME,
      gutter: CHROME,
    },
    interior: { floor: 0.12, z0: -0.9, z1: 0.58, seats, bench: [2, 3], dash: { z: 0.34, y: 0.72 }, shelf: { y: 0.66, z: -1.0 }, cloth: tint(pick([0x7a3b32, 1], [0x3f4a56, 1], [0x6b5a42, 1]), 'cloth'), back: 0.5, headrests: false },
    wheel: 'steel',
    rim: 0xd9d6ce,
    belly: 0.14,
    ageing: EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      bladeBumpers(k, shell, ax + ar + 0.03, 0.32, 0.72);
      // Round lamps high in the wings, the little chrome grille between.
      F.roundLamps(0.42, 0.5, 0.08);
      F.grille(0, 0.47, 0.5, 0.16, { bars: 7, frame: CHROME, badge: [0.045, 0.045] });
      F.both(AMBER, 0.08, 0.05, 0.33, 0.37, 0.01, 0.055);
      F.lens(AMBER_LENS, 0.08, 0.05, 0.33, 0.37, 0.057);
      // Upright little tail lamps, chrome boot handle, the plate between.
      R.taillamps(0.46, 0.48, 0.12, 0.2, { upright: true, bezel: CHROME, reverse: false });
      R.box(CHROME, 0.14, 0.025, 0, 0.62, 0.02, 0.012);
      // One long door each side, and the external seams the body is famous for.
      scuttle(k, cab, 0.05);
      shell.vline(k, DARK, 0.5, 0.3, 0.72);
      shell.vline(k, DARK, -0.38, 0.3, 0.73);
      shell.hline(k, DARK, 0.295, -0.38, 0.5);
      shell.vline(k, DARK, -1.04, 0.42, 0.7, 0.006);
      handles(k, shell, [-0.24], 0.65, CHROME);
      shell.hline(k, CHROME, 0.56, -h + 0.14, h - 0.16, 0.012, [1, -1], 0.007);
      mirrors(k, shell, 0.4, 0.78, CHROME, 0.09, 0.07);
      wipers(k, cab, { span: 0.32 });
      aerial(k, -(shell.sx(0.85) - 0.05), shell.deckY(0.85, shell.sx(0.85) - 0.05), 0.85, 0.45);
      exhaust(k, 0.26, 0.21, -h - 0.04, 0.018, 0.16, tint(0x55585b, 'steel'));
      fuelFlap(k, shell, -1.2, 0.55, 1, 0.11, 0.1);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.055, 0.32, -h - 0.045, 0.42, 'any', 0.9);
  }).model;
}

// ───────────────────────────── Ex-traffic patrol car ─────────────────────────────

/**
 * Mitsubishi V3000 stand-in, ex-Ministry of Transport: black body with WHITE roof and WHITE doors,
 * the blue dash band and Police door graphics worn since the 1992 merger, red and blue roof bar,
 * whip aerial. Angular late-80s front-drive three-box.
 */
export function buildTrafficcar(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const bar = 0.14;
  const top = spec.height - bar;
  const beacons = makeBeacons(m);
  const door = m.sign('POLICE', { bg: '#163a9e', fg: '#ffffff', style: 'block', aspect: 4, border: false });
  const white = tint(0xf0efe8, 'gloss');
  const roofCurve = curve([[-0.7, top - 0.065], [-0.25, top - 0.035], [0.2, top - 0.05]]);
  const seats = [
    { x: -0.37, y: 0.28, z: 0.04 },
    { x: 0.37, y: 0.28, z: 0.04 },
    { x: -0.37, y: 0.28, z: -0.82 },
    { x: 0.37, y: 0.28, z: -0.82 },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.055], [-1.25, W - 0.016], [0, W - 0.008], [1.25, W - 0.02], [h, W - 0.065]]),
      cornerR: [0.1, 0.07],
      cornerF: [0.13, 0.09],
      shoulder: curve([[-h, 0.86], [-h + 0.1, 0.885], [-1.4, 0.9], [0, 0.89], [1.0, 0.87], [1.7, 0.83], [h - 0.1, 0.77], [h, 0.75]]),
      lower: curve([[-h, 0.34], [-h + 0.28, 0.27], [-ax - 0.4, 0.23], [ax + 0.4, 0.23], [h - 0.25, 0.25], [h, 0.3]]),
      waistDrop: 0.16,
      lean: 0.13,
      tuck: 0.045,
      rS: 0.02,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.018,
      crown: 0.028,
      rearDeck: [-h, -1.35],
      frontDeck: [0.95, h],
      deckBow: [0.05, 0.07],
    },
    cabin: {
      rear: { zb: -1.36, zt: -0.7, bow: 0.05 },
      front: { zb: 0.97, zt: 0.2, bow: 0.07 },
      roof: roofCurve,
      crown: 0.03,
      lean: 0.15,
      railR: 0.045,
      headerR: 0.1,
      band: 0.03,
      panes: [
        { to: [-1.24, -0.66], kind: 'paint' },
        { to: [-1.0, -0.6], kind: 'glass' },
        { to: [-0.95, -0.57], kind: 'black' },
        { to: [-0.07, -0.1], kind: 'glass' },
        { to: [0.0, -0.04], kind: 'black' },
        { to: [0.88, 0.18], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: PLASTIC,
    },
    interior: { floor: 0.28, z0: -1.26, z1: 0.98, seats, bench: [2, 3], dash: { z: 0.5, y: 0.85 }, shelf: { y: 0.86, z: -1.36 }, cloth: tint(0x3c4046, 'cloth') },
    wheel: 'steel',
    rim: 0x26282a,
    belly: 0.14,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Dark grey plastic bumpers.
      const grey = tint(0x303336, 'satin');
      const moulding: Pt[] = [[-0.03, -0.13], [0.02, -0.135], [0.04, -0.1], [0.046, -0.03], [0.046, 0.045], [0.03, 0.08], [-0.03, 0.085]];
      for (const end of ['front', 'rear'] as const) bumper(k, shell, end, grey, moulding, { zStart: (end === 'front' ? 1 : -1) * (ax + ar + 0.03), y: 0.41, bow: 0.015 });
      // Flush slim lamps and a slot grille; a full-width lamp band at the tail.
      F.headlamps(0.42, 0.62, 0.36, 0.1, { depth: 0.035 });
      F.grille(0, 0.62, 0.34, 0.07, { bars: 2, surface: PLASTIC, depth: 0.045, badge: [0.05, 0.04] });
      cornerLens(k, shell, 'front', AMBER, 0.62, 0.085, 0.2);
      R.taillamps(0.42, 0.68, 0.4, 0.12);
      R.box(tint(0x1a0d0c, 'gloss'), 0.44, 0.11, 0, 0.68, 0.012, 0.004);
      R.pane(TAIL_LENS, 0.43, 0.1, 0, 0.68, 0.007);
      cornerLens(k, shell, 'rear', RED_LENS, 0.68, 0.1, 0.16);
      // White roof panel laid over the paint.
      const rows: V3[][] = [];
      for (let i = 0; i <= 5; i++) {
        const z = -0.66 + (i / 5) * 0.8;
        const row: V3[] = [];
        for (let j = -4; j <= 4; j++) {
          const u = j / 4;
          row.push([u * (cab.roofX(z) - 0.012), cab.roofY(z) - 0.03 * u * u + 0.0045, z]);
        }
        rows.push(row);
      }
      k.grid(white, rows, { out: [0, 0.8, -0.26], group: 'whiteroof' });
      // White doors under the belt, nose-to-tail dash band, blue door panel with POLICE.
      shell.band(k, white, 0.34, (z) => shell.yS(z) - 0.012, -0.9, 0.88, [1, -1], 0.0042, 3);
      dashBand(k, shell, -h + 0.26, h - 0.38, 0.74, 0.81);
      shell.band(k, NZP_BLUE, 0.42, 0.7, 0.03, 0.84, [1, -1], 0.0055, 2);
      shell.band(k, NZP_RED, 0.42, 0.7, 0.84, 0.875, [1, -1], 0.0055, 2);
      if (!k.lo) {
        const x = shell.F(0.44, 0.56) + 0.012;
        k.board(door, 0.52, 0.13, x, 0.56, 0.44, Math.PI / 2);
        k.board(door, 0.52, 0.13, -x, 0.56, 0.44, -Math.PI / 2);
      }
      // Door shuts drawn over the white, roof bar, whip aerial on the boot.
      scuttle(k, cab, 0.06);
      shadeBand(k, cab, 0.13);
      shell.vline(k, DARK, 0.9, 0.3, 0.86);
      shell.vline(k, DARK, -0.035, 0.3, 0.88);
      shell.vline(k, DARK, -0.92, 0.52, 0.88);
      shell.hline(k, DARK, 0.345, -0.88, 0.88);
      handles(k, shell, [0.08, -0.8], 0.79, PLASTIC, true);
      mirrors(k, shell, 0.76, 0.95, PLASTIC, 0.12, 0.085);
      wipers(k, cab);
      rooflights(k, top, -0.24);
      aerial(k, -(shell.sx(-1.6) - 0.09), shell.deckY(-1.6, shell.sx(-1.6) - 0.09), -1.6, 0.68, 0.24);
      exhaust(k, 0.44, 0.25, -h - 0.04, 0.024);
      fuelFlap(k, shell, -1.8, 0.7);
      mudflaps(k, spec.track / 2, -ax - r - 0.075, 0.35, 0.19, 0.16);
    },
  };
  const built = assemble(spec, color, m, spec.id, plan, (k) => {
    k.role('beacon0', beacons[0], true);
    k.role('beacon1', beacons[1], true);
    k.plates(h + 0.085, 0.41, -h - 0.012, 0.56, 'new', 0.995);
  });
  return { ...built.model, beacons };
}

/** The builders this file owns, keyed by `VehicleSpec.model`. */
export const SEDAN_MODELS: Record<string, (spec: VehicleSpec, color: number, m: MaterialLibrary) => VehicleModel> = {
  sedan: buildSedan,
  commodore: buildCommodoreSS,
  falcon: buildFalconXR,
  v8sedan: buildV8Sedan,
  wagon: buildWagon,
  police: buildPolice,
  trafficcar: buildTrafficcar,
  taxi: buildTaxi,
  kingswood: buildKingswood,
  valiant: buildValiant,
  cortina: buildCortina,
  mini: buildMini,
  triumph: buildTriumph,
};
