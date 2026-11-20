import type { MaterialLibrary, VehicleModel, VehicleModelBuilder, VehicleSpec } from '../../core/types';
import type { Cabin, PaneKind, Shell } from './body';
import { AMBER, AMBER_LENS, BLACK, CLEAR_LENS, curve, DARK, dice, HEAD, Kit, LENS, PAINT, PLASTIC, RED_GLASS, RUBBER, SMOKED, TAIL, TAIL_LENS, tint, type Fn, type Glaze, type Pt, type Tint, type V3, type WheelStyle } from './kit';
import { aerial, assemble, bumper, CHERISHED, cornerLens, exhaust, Face, fuelFlap, handles, mirrors, scuttle, shadeBand, wipers, type Ageing, type CarPlan } from './parts';
import { fit, mouldBumpers, pick, repeater, type Fittings } from './japanese';

/**
 * The quick imports: the twin-turbo coupe, the rotary, the twin cam coupe, the Kammback two-seater and the
 * four-wheel-drive turbo sedan. `lowBody` lofts a low two-door or four-door from a handful of proportions
 * (with a boot, a stub of deck under a glass hatch, or a glasshouse that runs to a chopped tail) and each
 * builder dresses its own nose, tail and trim. All makes and models are invented; the real car each one
 * stands for is recorded on its spec in ../specs-sports.ts.
 */

/** Where a car's body sits on its wheels: tail, nose, half wheelbase, wheel radius, half width, arch radius. */
interface Dims {
  zr: number;
  zf: number;
  ax: number;
  r: number;
  W: number;
  ar: number;
}

/** The shell stops `inset` short of the overall length at each end (the bumpers make it up); `shift` slides it forward. */
function dims(spec: VehicleSpec, inset = 0.06, shift = 0): Dims {
  const h = spec.length / 2 - inset;
  return { zr: -h + shift, zf: h + shift, ax: spec.wheelbase / 2, r: spec.wheelRadius, W: spec.width / 2, ar: spec.wheelRadius + 0.045 };
}

interface LowStyle {
  /** Roof height and the shoulder (belt) line at mid-car. */
  top: number;
  belt: number;
  /** How far the belt falls to the nose and to the tail (negative: the tail stands higher than the doors). */
  noseDrop: number;
  tailDrop: number;
  /** The shoulder over the rear axle, above the belt (default: on the way to the tail's height). */
  haunch?: number;
  sill: number;
  /** Front seats: height (the floor matches it) and z. A `rearSeatZ` adds a bench behind them. */
  seat: [y: number, z: number];
  seatX?: number;
  rearSeatZ?: number;
  /** z of the bulkhead behind the last seats. */
  bulkhead: number;
  /** A load floor this high behind the bulkhead, under a glass hatch (default: a parcel shelf under the rear screen). */
  cargoY?: number;
  /** Half-width at the waist by z (default: `planEnds` in from the full width at tail and nose). */
  plan?: Fn;
  planEnds?: [number, number];
  cornerR?: Pt;
  cornerF?: Pt;
  rS?: number;
  waistDrop?: number;
  lean?: number;
  tuck?: number;
  crown?: number;
  barrel?: number;
  flare?: number;
  roll?: [number, number];
  /** A boot deck behind the rear screen (false: the glasshouse runs to the tail). */
  boot: boolean;
  /** Glasshouse: screen bases and tops, tumblehome, radii, how far the roof's edge sits under `top` at each header. */
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
    roofDrop?: [number, number];
    peak?: number;
    panes: { to: [number, number] | 'front'; kind: PaneKind }[];
  };
  frame: Tint | null;
  rearGlass?: Glaze;
  wheel: WheelStyle;
  rim?: number;
  cloth: number;
  back?: number;
  ageing?: Ageing;
  belly?: number;
  /** Nose, tail, trim and anything else that is this car's own. */
  dress(k: Kit, shell: Shell, cab: Cabin, F: Face, R: Face): void;
}

/** A low sporting body lofted from a handful of proportions. */
function lowBody(g: Dims, o: LowStyle): CarPlan {
  const { zr, zf, ax, r, W, ar } = g;
  const { top, belt, sill } = o;
  const [pr, pf] = o.planEnds ?? [0.05, 0.06];
  const { rzb, rzt, fzb, fzt } = o.cab;
  const [rd, fd] = o.cab.roofDrop ?? [0.062, 0.052];
  const [seatY, seatZ] = o.seat;
  const seatX = o.seatX ?? Math.min(0.38, W - 0.44);
  const seats = [
    { x: -seatX, y: seatY, z: seatZ },
    { x: seatX, y: seatY, z: seatZ },
  ];
  if (o.rearSeatZ !== undefined) seats.push({ x: -seatX + 0.02, y: seatY, z: o.rearSeatZ }, { x: seatX - 0.02, y: seatY, z: o.rearSeatZ });
  const shoulder = curve([
    [zr, belt - o.tailDrop],
    [-ax, belt + (o.haunch ?? Math.max(0.004, -o.tailDrop * 0.55))],
    [0, belt],
    [0.45 * zf, belt - 0.012 - o.noseDrop * 0.1],
    [0.75 * zf, belt - o.noseDrop * 0.5],
    [zf - 0.1, belt - o.noseDrop * 0.92],
    [zf, belt - o.noseDrop],
  ]);
  const dashZ = seatZ + 0.46;
  return {
    shell: {
      zr,
      zf,
      plan: o.plan ?? curve([[zr, W - pr], [0.55 * zr, W - 0.016], [0, W - 0.008], [0.55 * zf, W - 0.018], [zf, W - pf]]),
      cornerR: o.cornerR ?? [0.11, 0.07],
      cornerF: o.cornerF ?? [0.14, 0.09],
      shoulder,
      lower: curve([[zr, sill + 0.09], [zr + (-ax - ar - zr) * 0.4, sill + 0.035], [-ax - ar * 0.9, sill], [ax + ar * 0.9, sill], [zf - (zf - ax - ar) * 0.4, sill + 0.02], [zf, sill + 0.07]]),
      waistDrop: o.waistDrop ?? 0.19,
      lean: o.lean ?? 0.1,
      tuck: o.tuck ?? 0.04,
      rS: o.rS ?? 0.035,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: o.flare ?? 0.02,
      crown: o.crown ?? 0.028,
      barrel: o.barrel,
      roll: o.roll,
      rearDeck: o.boot ? [zr, rzb - 0.01] : null,
      frontDeck: [fzb - 0.01, zf],
      deckBow: [o.boot ? Math.min(0.05, (rzb - zr) * 0.08) : 0, 0.07],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: o.cab.rearBow ?? 0.05 },
      front: { zb: fzb, zt: fzt, bow: o.cab.frontBow ?? 0.07 },
      roof: curve([[rzt, top - rd], [rzt + (fzt - rzt) * (o.cab.peak ?? 0.55), top - 0.036], [fzt, top - fd]]),
      crown: 0.03,
      lean: o.cab.lean,
      railR: o.cab.railR ?? 0.05,
      headerR: o.cab.headerR ?? 0.11,
      band: 0.03,
      panes: o.cab.panes,
      frame: o.frame,
      rearGlass: o.rearGlass,
    },
    interior: {
      floor: seatY,
      z0: o.bulkhead,
      z1: fzb + 0.01,
      seats,
      bench: o.rearSeatZ !== undefined ? [2, 3] : undefined,
      dash: { z: dashZ, y: shoulder(dashZ) - 0.045 },
      shelf: o.cargoY === undefined ? { y: shoulder(rzb) - 0.06, z: rzb } : undefined,
      cargo: o.cargoY !== undefined ? { y: o.cargoY, z: rzb + 0.03 } : undefined,
      cloth: tint(o.cloth, 'cloth'),
      back: o.back ?? 0.56,
    },
    wheel: o.wheel,
    rim: o.rim,
    belly: o.belly ?? 0.11,
    ageing: o.ageing ?? CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Bonnet shut lines, and the boot's where there is a boot worth the name.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, fzb + 0.05, zf - 0.07);
      if (o.boot && rzb - zr > 0.5) {
        shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.07, zr + 0.05, rzb - 0.1);
        shell.deckCross(k, DARK, rzb - 0.1, shell.sx(rzb - 0.1) - 0.07);
      }
      scuttle(k, cab, 0.06);
      shadeBand(k, cab, 0.13);
      wipers(k, cab, { span: 0.48 });
      o.dress(k, shell, cab, F, R);
    },
  };
}

// ───────────────────────────── Shared fittings ─────────────────────────────

// Smooth moulded bumper, and the deeper one with an air dam under it.
const MOULD: Pt[] = [[-0.03, -0.11], [0.02, -0.115], [0.038, -0.082], [0.042, -0.02], [0.042, 0.042], [0.028, 0.072], [-0.03, 0.076]];
const AIRDAM: Pt[] = [[-0.03, -0.2], [0.024, -0.2], [0.04, -0.17], [0.046, -0.06], [0.046, 0.04], [0.032, 0.072], [-0.03, 0.076]];
/** The black lower half of a two-tone car. */
const TWO_TONE = tint(0x111214, 'gloss');
const GARNISH = tint(0x4a1013, 'gloss');

/** Door shut lines of a two-door: front and rear edges, and the sill line between them. */
function doorLines(k: Kit, shell: Shell, zFront: number, zRear: number, sill: number): void {
  for (const z of [zFront, zRear]) shell.vline(k, DARK, z, shell.yL(z) + 0.035, shell.yS(z) - 0.02);
  shell.hline(k, DARK, sill + 0.05, zRear, zFront);
}

/** Skirts along the sills between the arches. */
function skirts(k: Kit, shell: Shell, g: Dims, y: number): void {
  for (const s of [1, -1]) k.pad(PAINT, 0.045, 0.09, 2 * (g.ax - g.ar) - 0.05, s * (shell.F(0, y + 0.01) + 0.004), y, 0, 0.018);
}

/** Boot wing: a blade across the tail standing `rise` off the deck on a foot at each end. */
function wing(k: Kit, shell: Shell, z: number, rise: number, chord: number, inboard = 0.06): void {
  const x = shell.sx(z) - inboard;
  const y = shell.deckY(z, x) + rise;
  k.pad(PAINT, 2 * x + 0.04, 0.028, chord, 0, y, z, 0.011, [0.1, 0, 0], true);
  k.boxes(PAINT, 0.035, rise + 0.02, chord * 0.7, x, y - rise / 2 - 0.012, z + 0.015);
}

/** Shut lines of a pair of pop-up headlamp lids let into the bonnet (the lamps are down). */
function lids(k: Kit, shell: Shell, x0: number, x1: number, z0: number, z1: number): void {
  if (k.lo) return;
  for (const x of [x0, x1]) shell.deckLine(k, DARK, x, z0, z1, 0.008);
  for (const z of [z0, z1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 4; i++) pts.push(shell.top(z, x0 + ((x1 - x0) * i) / 4, 0.0025));
    k.ribbon(DARK, pts, [0, 0, 1], 0.008, [0, -2, z], true);
  }
}

/** Four round tail lamps in a dark garnish (as on the Altair coupe in japanese.ts). */
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
  R.both(CLEAR_LENS, 0.07, 0.045, 0.13, y, 0.008, 0.002);
}

/** Full-width garnish between the tail lamp clusters: a dark red reflector under a lens. */
function tailGarnish(R: Face, w: number, h: number, y: number): void {
  R.box(GARNISH, w, h, 0, y, 0.02, 0.004);
  R.pane(TAIL_LENS, w - 0.01, h - 0.01, 0, y, 0.008);
}

// ───────────────────────────── Twin-turbo coupe (Skyline R32 GT-R) ─────────────────────────────

/** The Altair coupe with its hips out: flared guards, boot wing, intercooler mouth, four round tails. */
function buildGtr(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const g = dims(spec);
  const { zr, zf, ax, ar, W } = g;
  const rzb = -ax - 0.11;
  const rzt = -ax + 0.53;
  const fzb = ax - 0.36;
  const fzt = ax - 1.14;
  const plan = lowBody(g, {
    top: spec.height,
    belt: 0.795,
    noseDrop: 0.155,
    tailDrop: 0.015,
    haunch: 0.018,
    sill: 0.185,
    seat: [0.17, -0.1],
    bulkhead: -1.1,
    // The doors stay a narrow car's; the guards step out round all four wheels.
    plan: curve([[zr, W - 0.085], [-ax - 0.4, W - 0.04], [-ax, W - 0.028], [-ax + 0.62, W - 0.058], [0, W - 0.06], [ax - 0.62, W - 0.06], [ax, W - 0.032], [ax + 0.4, W - 0.05], [zf, W - 0.105]]),
    cornerR: [0.2, 0.13],
    cornerF: [0.28, 0.17],
    rS: 0.045,
    waistDrop: 0.18,
    lean: 0.15,
    tuck: 0.05,
    crown: 0.034,
    flare: 0.042,
    boot: true,
    cab: {
      rzb,
      rzt,
      fzb,
      fzt,
      lean: 0.19,
      railR: 0.055,
      headerR: 0.13,
      rearBow: 0.07,
      frontBow: 0.09,
      roofDrop: [0.06, 0.05],
      panes: [
        { to: [rzb + 0.47, rzt + 0.1], kind: 'paint' },
        { to: [rzb + 0.9, rzt + 0.31], kind: 'glass' },
        { to: [rzb + 0.96, rzt + 0.36], kind: 'black' },
        { to: [fzb - 0.07, fzt - 0.05], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    frame: RUBBER,
    wheel: 'alloy',
    cloth: 0x25262a,
    belly: 0.1,
    dress(k, shell, _cab, F, R) {
      bumper(k, shell, 'front', PAINT, AIRDAM, { zStart: ax + ar + 0.03, y: 0.33, bow: 0.015 });
      bumper(k, shell, 'rear', PAINT, MOULD, { zStart: -ax - ar - 0.03, y: 0.34, bow: 0.015 });
      // Nose: thin lamps, a two-slot grille between them, and the intercooler showing in the bumper's mouth
      // between a pair of brake ducts.
      F.headlamps(0.43, 0.525, 0.29, 0.075, { depth: 0.04 });
      for (const s of [1, -1]) F.grille(s * 0.118, 0.525, 0.2, 0.05, { bars: 2, surface: DARK, depth: 0.04, badge: null });
      F.box(DARK, 0.7, 0.115, 0, 0.225, 0.02, 0.067);
      F.box(tint(0x8f9498, 'mesh'), 0.6, 0.085, 0, 0.225, 0.006, 0.07);
      F.both(DARK, 0.12, 0.075, 0.5, 0.235, 0.02, 0.058);
      F.both(AMBER, 0.12, 0.034, 0.47, 0.36, 0.01, 0.062);
      F.lens(AMBER_LENS, 0.12, 0.034, 0.47, 0.36, 0.064);
      // Tail: the four round lamps under a wing.
      roundTails(k, R, [0.46, 0.275], 0.6, 0.085);
      wing(k, shell, zr + 0.15, 0.13, 0.19);
      R.box(DARK, 0.5, 0.05, 0, 0.25, 0.02, 0.058);
      // Long doors, flush handles, skirts.
      shell.deckCross(k, DARK, zr + 0.06, shell.sx(zr + 0.3) - 0.1);
      doorLines(k, shell, fzb - 0.07, rzb + 0.94, 0.185);
      handles(k, shell, [rzb + 1.08], 0.715, PLASTIC, true);
      skirts(k, shell, g, 0.2);
      mirrors(k, shell, fzb - 0.19, 0.86, PAINT, 0.13, 0.085);
      repeater(k, shell, ax + ar + 0.09, 0.52);
      exhaust(k, 0.5, 0.19, zr - 0.05, 0.046, 0.26);
      fuelFlap(k, shell, -ax - 0.47, 0.68, -1, 0.14, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(zf + 0.078, 0.36, zr - 0.074, 0.36, 'new');
  }).model;
}

// ───────────────────────────── Rotary (RX-7 FC3S) ─────────────────────────────

/** Low rounded wedge: pop-up lamps down, a body-colour hoop behind the doors, wraparound glass hatch. */
function buildRx7(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const g = dims(spec);
  const { zr, zf, ax, ar } = g;
  const rzb = zr + 0.36;
  const rzt = -0.55;
  const fzb = ax - 0.38;
  const fzt = fzb - 0.76;
  const wheel = pick<WheelStyle>(['alloy', 6], ['mesh', 3]);
  const plan = lowBody(g, {
    top: spec.height,
    belt: 0.79,
    noseDrop: 0.2,
    tailDrop: -0.03,
    sill: 0.19,
    seat: [0.16, -0.22],
    bulkhead: -0.76,
    cargoY: 0.52,
    planEnds: [0.07, 0.09],
    cornerR: [0.22, 0.13],
    cornerF: [0.3, 0.16],
    rS: 0.05,
    lean: 0.14,
    tuck: 0.05,
    crown: 0.034,
    barrel: 0.02,
    flare: 0.028,
    roll: [0.045, 0.06],
    boot: true,
    cab: {
      rzb,
      rzt,
      fzb,
      fzt,
      lean: 0.2,
      railR: 0.06,
      headerR: 0.14,
      rearBow: 0.05,
      frontBow: 0.09,
      roofDrop: [0.075, 0.055],
      peak: 0.5,
      // From the tail: the hatch glass wrapping round onto the flank, the hoop, the door glass.
      panes: [
        { to: [-0.74, rzt + 0.035], kind: 'glass' },
        { to: [-0.61, rzt + 0.14], kind: 'paint' },
        { to: [fzb - 0.07, fzt - 0.05], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    frame: RUBBER,
    rearGlass: SMOKED,
    wheel,
    cloth: 0x2a2b30,
    belly: 0.1,
    dress(k, shell, _cab, F, R) {
      bumper(k, shell, 'front', PAINT, AIRDAM, { zStart: ax + ar + 0.03, y: 0.35, bow: 0.02 });
      bumper(k, shell, 'rear', PAINT, MOULD, { zStart: -ax - ar - 0.03, y: 0.38, bow: 0.015 });
      // Nose: the lids in the bonnet, slim lamps under its edge, markers round the corners, one wide slot.
      lids(k, shell, 0.3, 0.57, zf - 0.33, zf - 0.08);
      F.headlamps(0.43, 0.482, 0.27, 0.044, { depth: 0.03 });
      cornerLens(k, shell, 'front', AMBER, 0.482, 0.04, 0.16);
      F.box(DARK, 0.62, 0.07, 0, 0.245, 0.02, 0.07);
      F.both(DARK, 0.1, 0.05, 0.47, 0.255, 0.02, 0.06);
      // The turbo's intake, offset on the bonnet.
      if (!k.lo) {
        k.pad(PAINT, 0.25, 0.04, 0.3, 0.2, shell.deckY(ax - 0.2, 0.2) + 0.008, ax - 0.2, 0.014, [0.05, 0, 0]);
        k.box(DARK, 0.19, 0.016, 0.01, 0.2, shell.deckY(ax - 0.05, 0.2) + 0.014, ax - 0.05);
      }
      // Tail: wide clusters with a garnish between, a lip on the stub of deck, twin pipes.
      R.taillamps(0.435, 0.665, 0.37, 0.105, {});
      tailGarnish(R, 0.48, 0.095, 0.665);
      wing(k, shell, zr + 0.11, 0.045, 0.15, 0.03);
      for (const s of [1, -1]) exhaust(k, s * 0.44, 0.2, zr - 0.05, 0.03, 0.22);
      doorLines(k, shell, fzb - 0.05, -0.7, 0.19);
      handles(k, shell, [-0.55], 0.7, PLASTIC, true);
      shell.band(k, DARK, 0.455, 0.485, -ax + ar + 0.04, ax - ar - 0.04, [1, -1], 0.007, 1);
      skirts(k, shell, g, 0.2);
      mirrors(k, shell, fzb - 0.2, 0.845, PAINT, 0.125, 0.08);
      repeater(k, shell, ax + ar + 0.09, 0.5);
      fuelFlap(k, shell, -ax - 0.42, 0.66, 1, 0.14, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(zf + 0.082, 0.37, zr - 0.074, 0.39, 'new');
  }).model;
}

// ───────────────────────────── Twin cam coupe (Sprinter Trueno / Corolla Levin AE86) ─────────────────────────────

/** Crisp boxy two-door notchback: pop-up or fixed lamps, black bumpers and lower flanks on the two-tone ones. */
function buildAe86(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const g = dims(spec);
  const { zr, zf, ax, ar } = g;
  const rzb = -ax - 0.02;
  const rzt = -ax + 0.56;
  const fzb = ax - 0.4;
  const fzt = fzb - 0.64;
  const popUp = dice.chance(0.6);
  const twoTone = color !== 0x101114 && dice.chance(0.7);
  const wheel = pick<WheelStyle>(['alloy', 5], ['mesh', 3], ['steel', 2]);
  const lower: 'paint' | Tint = twoTone ? TWO_TONE : PAINT;
  const plan = lowBody(g, {
    top: spec.height,
    belt: 0.84,
    noseDrop: 0.135,
    tailDrop: 0.005,
    sill: 0.2,
    seat: [0.2, -0.14],
    bulkhead: -0.95,
    planEnds: [0.045, 0.058],
    cornerR: [0.09, 0.055],
    cornerF: [0.12, 0.08],
    rS: 0.03,
    crown: 0.022,
    flare: 0.018,
    boot: true,
    cab: {
      rzb,
      rzt,
      fzb,
      fzt,
      lean: 0.16,
      railR: 0.045,
      headerR: 0.09,
      rearBow: 0.05,
      frontBow: 0.06,
      roofDrop: [0.055, 0.05],
      panes: [
        { to: [rzb + 0.3, rzt + 0.1], kind: 'paint' },
        { to: [rzb + 0.72, rzt + 0.36], kind: 'glass' },
        { to: [rzb + 0.78, rzt + 0.4], kind: 'black' },
        { to: [fzb - 0.06, fzt - 0.04], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    frame: RUBBER,
    wheel,
    rim: 0x9fa2a4,
    cloth: 0x34363b,
    ageing: { dirt: [0.05, 0.45], fade: 0.15, rust: 0.1 },
    dress(k, shell, _cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.4, lower);
      if (popUp) {
        // Lamps down: lids in the bonnet, slim lamps and a slit of grille under its edge.
        lids(k, shell, 0.29, 0.57, zf - 0.3, zf - 0.07);
        F.headlamps(0.415, 0.61, 0.28, 0.045, { depth: 0.03 });
        F.grille(0, 0.61, 0.42, 0.04, { bars: 1, surface: DARK, depth: 0.04, badge: [0.05, 0.03] });
        cornerLens(k, shell, 'front', AMBER, 0.61, 0.05, 0.12);
      } else {
        F.headlamps(0.425, 0.6, 0.29, 0.092, { bezel: tint(0x1c1d20, 'matte') });
        F.grille(0, 0.6, 0.47, 0.08, { bars: 3, surface: DARK, depth: 0.045, badge: [0.05, 0.04] });
        cornerLens(k, shell, 'front', AMBER, 0.6, 0.085, 0.11);
      }
      F.box(DARK, 0.6, 0.05, 0, 0.345, 0.02, 0.062);
      F.both(AMBER, 0.13, 0.04, 0.42, 0.42, 0.01, 0.062);
      F.lens(AMBER_LENS, 0.13, 0.04, 0.42, 0.42, 0.064);
      // Tail: wide clusters either side of a black panel that carries the plate, and a lip on the boot.
      R.taillamps(0.455, 0.7, 0.33, 0.125, {});
      R.box(BLACK, 0.56, 0.135, 0, 0.7, 0.012, 0.004);
      if (!k.lo) k.pad(PAINT, 2 * shell.sx(zr + 0.08) - 0.06, 0.03, 0.11, 0, shell.deckY(zr + 0.08, 0) + 0.004, zr + 0.065, 0.012, [0.16, 0, 0], true);
      // The black lower half, in three lengths between the arches, under a rubbing strip.
      const line = 0.47;
      const runs: [number, number][] = [
        [zr + 0.02, -ax - ar - 0.012],
        [-ax + ar + 0.012, ax - ar - 0.012],
        [ax + ar + 0.012, zf - 0.02],
      ];
      for (const [z0, z1] of runs) {
        if (twoTone) shell.band(k, TWO_TONE, (z) => shell.yL(z) + 0.012, line, z0, z1, [1, -1], 0.004, 2, 0.12);
        shell.band(k, DARK, line - 0.008, line + 0.022, z0, z1, [1, -1], 0.008, 1, 0.15);
      }
      doorLines(k, shell, fzb - 0.05, rzb + 0.75, 0.2);
      handles(k, shell, [rzb + 0.9], 0.75, PLASTIC, true);
      mirrors(k, shell, fzb - 0.16, 0.9, PLASTIC, 0.115, 0.085);
      repeater(k, shell, ax + ar + 0.08, 0.56);
      aerial(k, -(shell.sx(ax + 0.1) - 0.08), shell.deckY(ax + 0.1, shell.sx(ax + 0.1) - 0.08), ax + 0.1, 0.4);
      exhaust(k, 0.4, 0.21, zr - 0.05, 0.028, 0.22);
      fuelFlap(k, shell, -ax - 0.44, 0.7, 1, 0.13, 0.12);
    },
  });
  return assemble(spec, color, m, `${spec.id}|${popUp ? 'pop' : 'fixed'}|${twoTone ? 'two' : 'one'}`, plan, (k) => {
    k.plates(zf + 0.075, 0.4, zr - 0.012, 0.7, 'any');
  }).model;
}

// ───────────────────────────── Kammback two-seater (CR-X second generation) ─────────────────────────────

/** Very short, low wedge: flush lamps, glass hatch down to a chopped tail with a second pane of glass in it. */
function buildCrx(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const g = dims(spec, 0.06, 0.05);
  const { zr, zf, ax, ar } = g;
  const rzb = zr + 0.04;
  const rzt = -0.6;
  const fzb = ax - 0.24;
  const fzt = fzb - 0.72;
  const wheel = pick<WheelStyle>(['alloy', 6], ['steel', 2], ['cap', 2]);
  const plan = lowBody(g, {
    top: spec.height,
    belt: 0.8,
    noseDrop: 0.18,
    tailDrop: -0.06,
    sill: 0.2,
    seat: [0.16, -0.14],
    seatX: 0.36,
    bulkhead: -0.62,
    cargoY: 0.5,
    planEnds: [0.05, 0.065],
    cornerR: [0.1, 0.06],
    cornerF: [0.2, 0.11],
    waistDrop: 0.2,
    lean: 0.11,
    crown: 0.024,
    flare: 0.018,
    roll: [0, 0.05],
    boot: false,
    cab: {
      rzb,
      rzt,
      fzb,
      fzt,
      lean: 0.17,
      railR: 0.05,
      headerR: 0.11,
      rearBow: 0.03,
      frontBow: 0.07,
      roofDrop: [0.1, 0.05],
      peak: 0.62,
      // From the tail: the sail panel under the hatch glass, the quarter light, the pillar, the door glass.
      panes: [
        { to: [-1.2, rzt + 0.03], kind: 'paint' },
        { to: [-0.53, rzt + 0.2], kind: 'glass' },
        { to: [-0.47, rzt + 0.245], kind: 'black' },
        { to: [fzb - 0.06, fzt - 0.045], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    frame: RUBBER,
    rearGlass: SMOKED,
    wheel,
    rim: 0x9fa2a4,
    cloth: 0x2f3136,
    dress(k, shell, cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.36);
      // Nose: wide flush lamps, a slit between them, an intake in the bumper.
      F.headlamps(0.45, 0.525, 0.33, 0.075, { depth: 0.035 });
      F.grille(0, 0.525, 0.3, 0.03, { bars: 1, surface: DARK, depth: 0.03, badge: [0.045, 0.03] });
      cornerLens(k, shell, 'front', AMBER, 0.525, 0.06, 0.14);
      F.box(DARK, 0.56, 0.055, 0, 0.3, 0.02, 0.062);
      // The chopped tail: a pane of dark glass across the top of it, a full-width band of lamps under that.
      R.box(BLACK, 1.06, 0.12, 0, 0.775, 0.008, 0.004);
      R.frame(RUBBER, 1.06, 0.12, 0, 0.775, 0.012, 0.012, 0.006);
      R.taillamps(0.47, 0.615, 0.34, 0.09, {});
      tailGarnish(R, 0.58, 0.08, 0.615);
      R.box(PLASTIC, 0.16, 0.022, 0, 0.695, 0.016, 0.01);
      k.beam(DARK, cab.back(0.05, 0.04, 0.014), cab.back(0.48, 0.2, 0.014), 0.014, 0.01);
      doorLines(k, shell, fzb - 0.04, -0.5, 0.2);
      handles(k, shell, [-0.36], 0.705, PLASTIC, true);
      shell.band(k, DARK, 0.46, 0.49, -ax + ar + 0.04, ax - ar - 0.04, [1, -1], 0.007, 1);
      mirrors(k, shell, fzb - 0.17, 0.85, PAINT, 0.115, 0.08);
      repeater(k, shell, ax + ar + 0.08, 0.5);
      exhaust(k, -0.4, 0.2, zr - 0.05, 0.03, 0.2);
      fuelFlap(k, shell, -ax - 0.03, 0.72, 1, 0.13, 0.11);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(zf + 0.075, 0.36, zr - 0.012, 0.485, 'new');
  }).model;
}

// ───────────────────────────── Four-wheel-drive turbo sedan (Legacy RS, BC) ─────────────────────────────

/** Low wedge four-door: six-window glasshouse with black pillars, foglamps, tail garnish, boot spoiler. */
function buildLegacy(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const g = dims(spec);
  const { zr, zf, ax, r, ar } = g;
  const rzb = -1.42;
  const rzt = -0.8;
  const fzb = 0.93;
  const fzt = 0.12;
  const at = (fb: number, fr: number): [number, number] => [rzb + (fzb - rzb) * fb, rzt + (fzt - rzt) * fr];
  const fittings: Fittings = { flaps: dice.chance(0.4) ? [spec.track / 2, -ax - r - 0.07, 0.31, 0.19] : undefined };
  const plan = lowBody(g, {
    top: spec.height,
    belt: 0.865,
    noseDrop: 0.165,
    tailDrop: -0.02,
    sill: 0.21,
    seat: [0.25, 0.02],
    seatX: 0.4,
    rearSeatZ: -0.74,
    bulkhead: rzb + 0.14,
    planEnds: [0.05, 0.065],
    cornerR: [0.13, 0.08],
    cornerF: [0.2, 0.12],
    rS: 0.04,
    crown: 0.026,
    flare: 0.022,
    boot: true,
    cab: {
      rzb,
      rzt,
      fzb,
      fzt,
      lean: 0.185,
      headerR: 0.13,
      rearBow: 0.06,
      frontBow: 0.09,
      // Six windows: a small light in the rear pillar, and black pillars between frameless door glass.
      panes: [
        { to: at(0.075, 0.04), kind: 'paint' },
        { to: at(0.2, 0.13), kind: 'glass' },
        { to: at(0.225, 0.165), kind: 'black' },
        { to: at(0.571, 0.69), kind: 'glass' },
        { to: at(0.605, 0.763), kind: 'black' },
        { to: at(0.968, 0.954), kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
    },
    frame: RUBBER,
    wheel: 'alloy',
    cloth: 0x3a3d44,
    back: 0.6,
    belly: 0.13,
    dress(k, shell, _cab, F, R) {
      mouldBumpers(k, shell, ax + ar + 0.03, 0.39);
      // Nose: slim wide lamps, a low grille, and the big foglamps in the bumper (lit with the heads).
      F.headlamps(0.44, 0.6, 0.33, 0.082, { depth: 0.035 });
      F.grille(0, 0.6, 0.4, 0.055, { bars: 2, surface: DARK, depth: 0.04, badge: [0.06, 0.035] });
      cornerLens(k, shell, 'front', AMBER, 0.6, 0.075, 0.17);
      F.box(DARK, 0.74, 0.07, 0, 0.325, 0.02, 0.064);
      F.both(HEAD, 0.15, 0.05, 0.4, 0.325, 0.008, 0.066);
      F.lens(LENS, 0.16, 0.055, 0.4, 0.325, 0.068);
      // Tail: clusters joined by a garnish, and a spoiler on the boot.
      R.taillamps(0.455, 0.72, 0.37, 0.115, {});
      tailGarnish(R, 0.5, 0.105, 0.72);
      wing(k, shell, zr + 0.13, 0.075, 0.17, 0.04);
      // Four doors.
      const doorR = at(0.213, 0)[0];
      for (const z of [fzb - 0.03, at(0.588, 0)[0], doorR]) shell.vline(k, DARK, z, shell.yL(z) + 0.035, shell.yS(z) - 0.02);
      shell.hline(k, DARK, 0.26, doorR + 0.05, fzb - 0.05);
      handles(k, shell, [0.1, -0.78], 0.775, PLASTIC, true);
      shell.band(k, DARK, 0.49, 0.52, -ax + ar + 0.05, ax - ar - 0.05, [1, -1], 0.008, 1);
      mirrors(k, shell, fzb - 0.16, 0.925, PAINT, 0.13, 0.085);
      repeater(k, shell, ax + ar + 0.09, 0.55);
      aerial(k, shell.sx(-1.85) - 0.1, shell.deckY(-1.85, shell.sx(-1.85) - 0.1), -1.85, 0.42);
      exhaust(k, -0.45, 0.22, zr - 0.05, 0.034, 0.22);
      fuelFlap(k, shell, -ax - 0.48, 0.74, -1, 0.14, 0.12);
    },
  });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(zf + 0.078, 0.4, zr - 0.078, 0.4, 'new');
  }).model;
}

/** Builders for the cars in ../specs-sports.ts, keyed by `VehicleSpec.model`. */
export const SPORTS_MODELS: Record<string, VehicleModelBuilder> = {
  gtr: buildGtr,
  rx7: buildRx7,
  ae86: buildAe86,
  crx: buildCrx,
  legacy: buildLegacy,
};
