import type { MaterialLibrary, VehicleModel, VehicleModelBuilder, VehicleSpec } from '../../core/types';
import type { Cabin, Shell } from './body';
import { AMBER, BRIGHT, CHROME, CLEAR_LENS, curve, DARK, dice, HEAD, Kit, LENS, PAINT, RED_LENS, RUBBER, smooth, tint, type Pt, type Tint, type V3, type WheelStyle } from './kit';
import { aerial, assemble, bumper, CHERISHED, cornerLens, EVERYDAY, exhaust, Face, fuelFlap, handles, mirrors, scuttle, shadeBand, wipers, type CarPlan } from './parts';
import { fit, pick, repeater, type Fittings } from './japanese';

/**
 * The old classics and the one European (see ../specs-classics.ts for what each stands for): a square
 * two-door rally saloon, a pillarless hardtop coupe, a short-tailed fastback, a rounded 1940s saloon and a
 * crisp 80s sports saloon. Each is a plan handed to `assemble` (parts.ts), with every length taken from the
 * spec so the body fits its physics box.
 */

const SATIN_BLACK = tint(0x17181a, 'satin');
const GLOSS_BLACK = tint(0x121316, 'gloss');
const BARE_STEEL = tint(0x55585b, 'steel');

/** Section of a chromed steel blade bumper, `scale` tall, and of the rubber insert along its face. */
const blade = (scale: number): Pt[] => [[-0.03, -0.058 * scale], [0.05, -0.058 * scale], [0.074, -0.03 * scale], [0.074, 0.03 * scale], [0.05, 0.058 * scale], [-0.03, 0.058 * scale]];
const bladeInsert = (scale: number): Pt[] => [[0.0745, -0.02 * scale], [0.084, 0], [0.0745, 0.02 * scale]];

/** Blade bumpers at both ends, wrapped round to the arches. */
function bladeBumpers(k: Kit, shell: Shell, zStart: number, y: number, scale = 1, surface: Tint = CHROME): void {
  for (const end of ['front', 'rear'] as const) {
    const z = (end === 'front' ? 1 : -1) * zStart;
    bumper(k, shell, end, surface, blade(scale), { zStart: z, y });
    bumper(k, shell, end, RUBBER, bladeInsert(scale), { zStart: z, y });
  }
}

/** A pair of quarter bumpers at one end: each wraps its corner and stops short of the middle. */
function quarterBumpers(k: Kit, shell: Shell, end: 'front' | 'rear', zStart: number, y: number, surface: Tint): void {
  const section: Pt[] = [[-0.03, -0.045], [0.04, -0.045], [0.058, -0.022], [0.058, 0.022], [0.04, 0.045], [-0.03, 0.045]];
  k.sweep(surface, shell.wrap(end, zStart, y).slice(0, -1), section, { out: [0, y, shell.mid], mirror: true, caps: 'both' });
}

/**
 * Flat plate with a round hole in it on an end panel, on both sides of the car: the dark surround a round
 * lamp sits in. `hw` and `hh` are its half-width and half-height, `r` the radius of the hole.
 */
function lampPlate(F: Face, surface: Tint, x: number, y: number, hw: number, hh: number, r: number, proud = 0.004): void {
  if (F.k.lo) return;
  const z = F.z + F.dir * proud;
  const corner = Math.atan2(hh, hw);
  const angles = [...Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2), corner, Math.PI - corner, Math.PI + corner, 2 * Math.PI - corner].sort((a, b) => a - b);
  for (const s of [1, -1]) {
    const inner: V3[] = [];
    const outer: V3[] = [];
    for (const a of [...angles, angles[0]]) {
      const c = Math.cos(a);
      const n = Math.sin(a);
      // Out along the ray to the edge of the rectangle.
      const t = Math.min(hw / Math.max(1e-9, Math.abs(c)), hh / Math.max(1e-9, Math.abs(n)));
      inner.push([s * x + r * c, y + r * n, z]);
      outer.push([s * x + t * c, y + t * n, z]);
    }
    F.k.grid(surface, [inner, outer], { out: [s * x, y, z - F.dir], flat: true });
  }
}

/** Painted-on band along a deck (bonnet blackouts), on both sides of the centre line between x0 and x1. */
function deckBand(k: Kit, shell: Shell, surface: Tint, x0: number, x1: number, z0: number, z1: number): void {
  // The distant deck is faceted: stand further off it.
  const lift = k.lo ? 0.014 : 0.004;
  const n = Math.max(2, Math.ceil(Math.abs(z1 - z0) / (k.lo ? 0.8 : 0.16)));
  const cols = k.lo ? 1 : 3;
  for (const s of [1, -1]) {
    const rows: V3[][] = [];
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      const row: V3[] = [];
      for (let j = 0; j <= cols; j++) {
        const p = shell.top(z, x0 + ((x1 - x0) * j) / cols, lift);
        row.push([s * p[0], p[1], p[2]]);
      }
      rows.push(row);
    }
    k.grid(surface, rows, { out: [0, -2, shell.mid] });
  }
}

/** Bright strip up the side glass at belt position `z`, both sides: the division between two panes. */
function glassDivider(k: Kit, cab: Cabin, z: number, surface: Tint = CHROME): void {
  if (k.lo) return;
  const a = cab.flank(z, 0.02, 0.007);
  const b = cab.flank(z, 0.98, 0.007);
  for (const s of [1, -1]) k.beam(surface, [s * a[0], a[1], a[2]], [s * b[0], b[1], b[2]], 0.008, 0.016);
}

/** A driving lamp standing proud of the nose, on both sides. */
function spotLamps(k: Kit, x: number, y: number, z: number, r: number): void {
  for (const s of [1, -1]) {
    k.drum(GLOSS_BLACK, r, 0.06, s * x, y, z, 'z', 12);
    k.drum(BRIGHT, r - 0.008, 0.004, s * x, y, z + 0.031, 'z', 12);
    k.drum(HEAD, r - 0.022, 0.004, s * x, y, z + 0.034, 'z', 10);
    k.drum(LENS, r - 0.006, 0.002, s * x, y, z + 0.038, 'z', 12);
    k.box(SATIN_BLACK, 0.02, r + 0.03, 0.02, s * x, y - r - 0.01, z - 0.01);
  }
}

// ───────────────────────────── Ford Escort Mk II 1600 Sport ─────────────────────────────

/** Small square-edged two-door three-box: round lamps in a black grille, quarter bumpers, a rally car's stance. */
export function buildEscort(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.05;
  const top = spec.height;
  const belt = 0.875;
  const sill = 0.25;
  const seatY = Math.min(0.3, top - 1.11);
  // Screens: base and top of the rear one, base and top of the front one.
  const rzb = -0.63 * h;
  const rzt = -0.43 * h;
  const fzb = 0.42 * h;
  const fzt = 0.155 * h;
  const bs = fzb - rzb;
  const rs = fzt - rzt;
  const at = (fb: number, fr: number): [number, number] => [rzb + bs * fb, rzt + rs * fr];
  const doorR = rzb + bs * 0.51;
  const seatX = Math.min(0.39, W - 0.4);
  const rearZ = -0.375 * h;
  const wheel = pick<WheelStyle>(['steel', 6], ['dish', 2], ['alloy', 2]);
  const stripe = dice.chance(0.6);
  const spots = dice.chance(0.45);
  const fittings: Fittings = {
    flaps: dice.chance(0.4) ? [spec.track / 2, -ax - r - 0.07, 0.33, 0.17] : undefined,
  };
  const seats = [
    { x: -seatX, y: seatY, z: 0 },
    { x: seatX, y: seatY, z: 0 },
    { x: -seatX + 0.02, y: seatY, z: rearZ },
    { x: seatX - 0.02, y: seatY, z: rearZ },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.035], [-0.55 * h, W - 0.014], [0, W - 0.008], [0.55 * h, W - 0.016], [h, W - 0.04]]),
      cornerR: [0.075, 0.045],
      cornerF: [0.09, 0.055],
      shoulder: curve([[-h, belt - 0.03], [-h + 0.07, belt - 0.02], [-0.62 * h, belt + 0.004], [0, belt], [0.45 * h, belt - 0.012], [0.75 * h, belt - 0.05], [h - 0.1, belt - 0.09], [h, belt - 0.1]]),
      lower: curve([[-h, sill + 0.09], [-h + 0.25, sill + 0.035], [-ax - 0.4, sill], [ax + 0.4, sill], [h - 0.2, sill + 0.02], [h, sill + 0.07]]),
      waistDrop: 0.2,
      lean: 0.08,
      tuck: 0.04,
      rS: 0.024,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.02,
      crown: 0.02,
      barrel: 0.008,
      rearDeck: [-h, rzb - 0.01],
      frontDeck: [fzb - 0.01, h],
      deckBow: [0.04, 0.06],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: 0.04 },
      front: { zb: fzb, zt: fzt, bow: 0.06 },
      roof: curve([[rzt, top - 0.058], [rzt + rs * 0.55, top - 0.036], [fzt, top - 0.05]]),
      crown: 0.028,
      lean: 0.13,
      railR: 0.04,
      headerR: 0.08,
      band: 0.035,
      // Two doors: a long door glass and a fixed rear side window.
      panes: [
        { to: at(0.2, 0.1), kind: 'paint' },
        { to: at(0.49, 0.5), kind: 'glass' },
        { to: at(0.53, 0.56), kind: 'paint' },
        { to: at(0.965, 0.95), kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: CHROME,
      gutter: CHROME,
    },
    interior: {
      floor: seatY - 0.02,
      z0: rearZ - 0.4,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3],
      dash: { z: 0.21 * h, y: belt - 0.045 },
      shelf: { y: belt - 0.03, z: rzb },
      cloth: tint(0x1d1e21, 'cloth'),
    },
    wheel,
    rim: 0xb4b7b9,
    belly: 0.15,
    ageing: EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Matt-black quarter bumpers at both ends, the Sport's signature.
      quarterBumpers(k, shell, 'front', ax + ar + 0.04, 0.43, SATIN_BLACK);
      quarterBumpers(k, shell, 'rear', -ax - ar - 0.04, 0.45, SATIN_BLACK);
      // Nose: a flat black grille the width of the car with a round lamp at each end.
      const ly = 0.61;
      F.roundLamps(0.5, ly, 0.082);
      lampPlate(F, SATIN_BLACK, 0.5, ly, 0.105, 0.09, 0.09);
      F.grille(0, ly, 0.79, 0.18, { bars: 6, surface: SATIN_BLACK, depth: 0.05, badge: [0.09, 0.04] });
      F.both(AMBER, 0.11, 0.04, 0.52, 0.35, 0.012, 0.006);
      // Tail: plain rectangular clusters at the corners, the plate on the panel between them.
      R.taillamps(0.52, 0.66, 0.3, 0.12, { bezel: CHROME, reverse: false });
      R.box(CLEAR_LENS, 0.08, 0.045, 0, 0.5, 0.012, 0.006);
      R.box(CHROME, 0.1, 0.022, 0, 0.75, 0.018, 0.01);
      // Shut lines: bonnet, boot, one long door a side.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.045, fzb + 0.05, h - 0.05);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.06, -h + 0.05, rzb - 0.1);
      shell.deckCross(k, DARK, rzb - 0.1, shell.sx(rzb - 0.1) - 0.06);
      scuttle(k, cab, 0.06);
      shell.vline(k, DARK, fzb - 0.03, shell.yL(fzb - 0.03) + 0.035, belt - 0.016);
      shell.vline(k, DARK, doorR, sill + 0.07, belt - 0.016);
      shell.hline(k, DARK, sill + 0.07, doorR, fzb - 0.03);
      handles(k, shell, [doorR + 0.15], belt - 0.09, CHROME);
      mirrors(k, shell, fzb - 0.12, belt + 0.06, SATIN_BLACK, 0.1, 0.075);
      wipers(k, cab, { span: 0.42 });
      aerial(k, -(shell.sx(0.68 * h) - 0.07), shell.deckY(0.68 * h, shell.sx(0.68 * h) - 0.07), 0.68 * h, 0.45);
      exhaust(k, 0.36, 0.25, -h - 0.04, 0.022, 0.2, BARE_STEEL);
      fuelFlap(k, shell, -0.8 * h, 0.7, -1, 0.12, 0.11);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k, shell) => {
    if (stripe) {
      // The Sport's side stripe: a broad black band low on the flank with a pin line over it.
      k.cached(`${spec.id}|stripe`, (c) => {
        const runs: [number, number][] = [
          [-h + 0.14, -ax - ar - 0.06],
          [-ax + ar + 0.06, ax - ar - 0.06],
          [ax + ar + 0.06, h - 0.16],
        ];
        for (const [z0, z1] of runs) {
          shell.band(c, SATIN_BLACK, 0.4, 0.455, z0, z1, [1, -1], 0.004, 1);
          shell.hline(c, SATIN_BLACK, 0.475, z0, z1, 0.012, [1, -1], 0.004);
        }
      });
    }
    if (spots) k.cached(`${spec.id}|spots`, (c) => spotLamps(c, 0.28, 0.535, h + 0.06, 0.072));
    fit(k, spec.id, fittings);
    k.plates(h + 0.012, 0.43, -h - 0.012, 0.63, 'old');
  }).model;
}

// ───────────────────────────── Holden HQ Monaro GTS ─────────────────────────────

/** Long-bonnet pillarless hardtop: coke-bottle hips, sloping rear screen, quad lamps, chrome blades. */
export function buildMonaro(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const top = spec.height;
  const b = 0.86;
  const seatY = Math.min(0.28, top - 1.11);
  const rzb = -0.65 * h;
  const rzt = -0.3 * h;
  const fzb = 0.36 * h;
  const fzt = 0.085 * h;
  const rs = fzt - rzt;
  const doorR = -0.2 * h;
  const frontZ = -0.06 * h;
  const rearZ = -0.36 * h;
  const wheel = pick<WheelStyle>(['dish', 6], ['alloy', 3]);
  const blackouts = dice.chance(0.65);
  const seats = [
    { x: -0.38, y: seatY, z: frontZ },
    { x: 0.38, y: seatY, z: frontZ },
    { x: -0.36, y: seatY - 0.05, z: rearZ },
    { x: 0.36, y: seatY - 0.05, z: rearZ },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      // Pinched at the doors, full over the rear wheels: the coke bottle.
      plan: curve([[-h, W - 0.075], [-ax - 0.1, W - 0.006], [-0.12 * h, W - 0.036], [0.28 * h, W - 0.032], [ax, W - 0.012], [h, W - 0.07]]),
      cornerR: [0.13, 0.085],
      cornerF: [0.13, 0.085],
      // The belt kicks up over the rear wheel and falls away to the tail.
      shoulder: curve([[-h, b - 0.03], [-h + 0.12, b - 0.005], [-ax - 0.1, b + 0.045], [-ax + 0.45, b + 0.03], [-0.1 * h, b], [0.3 * h, b - 0.004], [0.62 * h, b - 0.014], [h - 0.12, b - 0.07], [h, b - 0.085]]),
      lower: curve([[-h, 0.335], [-h + 0.3, 0.275], [-ax - 0.42, 0.23], [ax + 0.42, 0.23], [h - 0.25, 0.25], [h, 0.31]]),
      waistDrop: 0.17,
      lean: 0.1,
      tuck: 0.055,
      rS: 0.04,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.022,
      crown: 0.035,
      barrel: 0.02,
      rearDeck: [-h, rzb - 0.01],
      frontDeck: [fzb - 0.01, h],
      deckBow: [0.06, 0.07],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: 0.07 },
      front: { zb: fzb, zt: fzt, bow: 0.07 },
      roof: curve([[rzt, top - 0.062], [rzt + rs * 0.5, top - 0.034], [fzt, top - 0.048]]),
      crown: 0.028,
      lean: 0.19,
      railR: 0.05,
      headerR: 0.11,
      band: 0.03,
      // No B-pillar: one opening from the screen pillar to the broad sail panel.
      panes: [
        { to: [rzb + 0.5, rzt + 0.16], kind: 'paint' },
        { to: [fzb - 0.09, fzt - 0.03], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: CHROME,
      gutter: CHROME,
    },
    interior: {
      floor: seatY - 0.03,
      z0: rearZ - 0.36,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3],
      dash: { z: frontZ + 0.4, y: b - 0.045 },
      shelf: { y: b - 0.02, z: rzb },
      cloth: tint(pick([0x1c1c1f, 2], [0x6b4a2f, 1], [0xcfc6b4, 1]), 'cloth'),
      back: 0.56,
    },
    wheel,
    rim: 0x9da1a4,
    belly: 0.15,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      bladeBumpers(k, shell, ax + ar + 0.04, 0.43);
      // Nose: four lamps in a blacked-out grille the width of the car, in a bright surround.
      const ly = 0.61;
      F.roundLamps(0.68, ly, 0.064);
      F.roundLamps(0.53, ly, 0.064);
      lampPlate(F, SATIN_BLACK, 0.682, ly, 0.076, 0.075, 0.07);
      lampPlate(F, SATIN_BLACK, 0.529, ly, 0.077, 0.075, 0.07);
      F.grille(0, ly, 0.9, 0.15, { bars: 5, surface: SATIN_BLACK, badge: [0.06, 0.04] });
      F.frame(CHROME, 1.516, 0.15, 0, ly);
      cornerLens(k, shell, 'front', AMBER, ly, 0.09, 0.12);
      // Tail: long clusters either side of a blacked-out panel.
      R.taillamps(0.55, 0.68, 0.44, 0.11, { bezel: CHROME, reverse: false });
      R.box(GLOSS_BLACK, 0.62, 0.115, 0, 0.68, 0.012, 0.004);
      cornerLens(k, shell, 'rear', RED_LENS, 0.68, 0.09, 0.1);
      // Shut lines: bonnet, boot, long doors.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, fzb + 0.05, h - 0.05);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.07, -h + 0.05, rzb - 0.1);
      shell.deckCross(k, DARK, rzb - 0.1, shell.sx(rzb - 0.1) - 0.07);
      scuttle(k, cab);
      shell.vline(k, DARK, fzb - 0.05, shell.yL(fzb - 0.05) + 0.035, b - 0.03);
      shell.vline(k, DARK, doorR, 0.31, b - 0.02);
      shell.hline(k, DARK, 0.305, doorR, fzb - 0.05);
      glassDivider(k, cab, doorR);
      handles(k, shell, [doorR + 0.16], b - 0.09, CHROME);
      // Bright sill moulding, and the louvres behind the front wheels.
      shell.hline(k, CHROME, 0.27, -ax + ar + 0.03, ax - ar - 0.03, 0.03, [1, -1], 0.004);
      for (const dz of [0.1, 0.14, 0.18]) shell.vline(k, DARK, ax - ar - dz, 0.5, 0.62, 0.016);
      mirrors(k, shell, fzb - 0.14, b + 0.055, CHROME, 0.11, 0.08);
      wipers(k, cab, { span: 0.46 });
      aerial(k, -(shell.sx(0.6 * h) - 0.07), shell.deckY(0.6 * h, shell.sx(0.6 * h) - 0.07), 0.6 * h, 0.42);
      exhaust(k, 0.5, 0.25, -h - 0.04, 0.03, 0.22);
      exhaust(k, -0.5, 0.25, -h - 0.04, 0.03, 0.22);
      fuelFlap(k, shell, -0.84 * h, 0.7);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k, shell) => {
    // The GTS's bonnet blackouts: two broad satin-black panels either side of a body-colour spine.
    if (blackouts) k.cached(`${spec.id}|blackouts`, (c) => deckBand(c, shell, SATIN_BLACK, 0.13, 0.47, fzb + 0.14, h - 0.09));
    k.plates(h + 0.1, 0.43, -h - 0.012, 0.555, 'old');
  }).model;
}

// ───────────────────────────── Chrysler Valiant Charger VH 770 ─────────────────────────────

/** Short-tailed fastback on a long wide bonnet: quad lamps in a full-width grille, broad sail panels, kicked-up tail. */
export function buildCharger(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const top = spec.height;
  const b = 0.865;
  const seatY = Math.min(0.28, top - 1.11);
  const rzb = -h + 0.48;
  const rzt = -0.32 * h;
  const fzb = 0.3 * h;
  const fzt = 0.03 * h;
  const rs = fzt - rzt;
  const doorR = -0.25 * h;
  const frontZ = -0.1 * h;
  const rearZ = -0.4 * h;
  const wheel = pick<WheelStyle>(['dish', 5], ['steel', 3], ['alloy', 3]);
  const stripe = dice.chance(0.4);
  const seats = [
    { x: -0.39, y: seatY, z: frontZ },
    { x: 0.39, y: seatY, z: frontZ },
    { x: -0.36, y: seatY - 0.09, z: rearZ },
    { x: 0.36, y: seatY - 0.09, z: rearZ },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.085], [-ax, W - 0.012], [0, W - 0.01], [ax, W - 0.016], [h, W - 0.075]]),
      cornerR: [0.14, 0.09],
      cornerF: [0.14, 0.09],
      // The belt climbs from the doors to a tail that is higher than the bonnet.
      shoulder: curve([[-h, b + 0.055], [-h + 0.3, b + 0.06], [-ax, b + 0.04], [-0.25 * h, b + 0.005], [0.2 * h, b], [0.6 * h, b - 0.012], [h - 0.12, b - 0.06], [h, b - 0.075]]),
      lower: curve([[-h, 0.34], [-h + 0.3, 0.28], [-ax - 0.42, 0.235], [ax + 0.42, 0.235], [h - 0.25, 0.255], [h, 0.315]]),
      waistDrop: 0.18,
      lean: 0.12,
      tuck: 0.07,
      rS: 0.05,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.02,
      crown: 0.035,
      // Fuselage sides.
      barrel: 0.024,
      rearDeck: [-h, rzb - 0.01],
      frontDeck: [fzb - 0.01, h],
      deckBow: [0.07, 0.08],
      roll: [0.02, 0.04],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: 0.08 },
      front: { zb: fzb, zt: fzt, bow: 0.08 },
      roof: curve([[rzt, top - 0.07], [rzt + rs * 0.55, top - 0.036], [fzt, top - 0.05]]),
      crown: 0.03,
      lean: 0.2,
      railR: 0.055,
      headerR: 0.13,
      band: 0.03,
      // Broad sail panel, a small quarter window, then the door glass.
      panes: [
        { to: [rzb + 0.74, rzt + 0.2], kind: 'paint' },
        { to: [doorR - 0.045, -0.19 * h], kind: 'glass' },
        { to: [doorR + 0.015, -0.165 * h], kind: 'black' },
        { to: [fzb - 0.09, fzt - 0.03], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: CHROME,
      gutter: CHROME,
    },
    interior: {
      floor: seatY - 0.03,
      z0: rearZ - 0.36,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3],
      dash: { z: frontZ + 0.4, y: b - 0.045 },
      shelf: { y: b - 0.02, z: rzb },
      cloth: tint(pick([0x1c1c1f, 2], [0x5a4a3c, 1], [0xd8d2c2, 1]), 'cloth'),
      back: 0.56,
    },
    wheel,
    rim: 0xa3a6a8,
    belly: 0.15,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Plain chrome blades: the New Zealand cars had no overriders.
      bladeBumpers(k, shell, ax + ar + 0.04, 0.44);
      // Nose: one recess the width of the car, a pair of lamps at each end, a bright bar down the middle.
      const ly = 0.615;
      F.roundLamps(0.685, ly, 0.06);
      F.roundLamps(0.54, ly, 0.06);
      lampPlate(F, SATIN_BLACK, 0.686, ly, 0.073, 0.072, 0.066);
      lampPlate(F, SATIN_BLACK, 0.54, ly, 0.073, 0.072, 0.066);
      F.grille(0.235, ly, 0.45, 0.144, { bars: 6, surface: BARE_STEEL });
      F.grille(-0.235, ly, 0.45, 0.144, { bars: 6, surface: BARE_STEEL });
      F.box(CHROME, 0.024, 0.15, 0, ly, 0.022, 0.01);
      F.frame(CHROME, 1.518, 0.144, 0, ly);
      F.both(AMBER, 0.12, 0.04, 0.6, 0.345, 0.012, 0.006);
      // Tail: a full-width strip of lamps under the kicked-up lip.
      R.taillamps(0.5, 0.74, 0.5, 0.09, { bezel: CHROME, reverse: false });
      R.box(GLOSS_BLACK, 0.46, 0.095, 0, 0.74, 0.012, 0.004);
      R.box(CHROME, 0.16, 0.02, 0, 0.74, 0.016, 0.008);
      cornerLens(k, shell, 'rear', RED_LENS, 0.74, 0.08, 0.1);
      // Shut lines: the long bonnet, the short boot lid under the glass, long doors.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, fzb + 0.05, h - 0.05);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.08, -h + 0.04, rzb - 0.1);
      shell.deckCross(k, DARK, rzb - 0.1, shell.sx(rzb - 0.1) - 0.08);
      scuttle(k, cab);
      shell.vline(k, DARK, fzb - 0.05, shell.yL(fzb - 0.05) + 0.035, b - 0.03);
      shell.vline(k, DARK, doorR, 0.315, b - 0.02);
      shell.hline(k, DARK, 0.31, doorR, fzb - 0.05);
      handles(k, shell, [doorR + 0.16], b - 0.09, CHROME);
      shell.hline(k, CHROME, 0.275, -ax + ar + 0.03, ax - ar - 0.03, 0.03, [1, -1], 0.004);
      mirrors(k, shell, fzb - 0.14, b + 0.055, CHROME, 0.11, 0.08);
      wipers(k, cab, { span: 0.46 });
      aerial(k, -(shell.sx(0.55 * h) - 0.07), shell.deckY(0.55 * h, shell.sx(0.55 * h) - 0.07), 0.55 * h, 0.42);
      exhaust(k, 0.5, 0.25, -h - 0.04, 0.028, 0.22, BARE_STEEL);
      fuelFlap(k, shell, -0.8 * h, 0.74);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k, shell) => {
    if (stripe) {
      // Black side stripe under the shoulder, nose to tail.
      k.cached(`${spec.id}|stripe`, (c) => shell.band(c, SATIN_BLACK, (z) => shell.yS(z) - 0.115, (z) => shell.yS(z) - 0.065, -h + 0.2, h - 0.25, [1, -1], 0.004, 1, 0.25));
    }
    k.plates(h + 0.1, 0.44, -h - 0.012, 0.58, 'old');
  }).model;
}

// ───────────────────────────── Morris Minor 1000 ─────────────────────────────

/** Tall narrow rounded saloon: lamps up on bulging wings, a raised bonnet over a slatted grille, dome hubcaps. */
export function buildMorrie(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.07;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const top = spec.height;
  const b = 0.985;
  const sill = 0.3;
  const seatY = Math.min(0.4, top - 1.11);
  const rzb = -0.6 * h;
  const rzt = -0.42 * h;
  const fzb = 0.33 * h;
  const fzt = 0.2 * h;
  const bs = fzb - rzb;
  const rs = fzt - rzt;
  const at = (fb: number, fr: number): [number, number] => [rzb + bs * fb, rzt + rs * fr];
  const doorF = fzb - 0.02;
  const doorM = rzb + bs * 0.52;
  const doorR = rzb + bs * 0.19;
  const rearZ = -0.375 * h;
  const fittings: Fittings = { tow: dice.chance(0.15) ? [-h - 0.1, 0.36] : undefined };
  const seats = [
    { x: -0.31, y: seatY, z: 0 },
    { x: 0.31, y: seatY, z: 0 },
    { x: -0.3, y: seatY, z: rearZ },
    { x: 0.3, y: seatY, z: rearZ },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      // Wings fuller than the body between them.
      plan: curve([[-h, W - 0.075], [-ax, W - 0.012], [-0.2 * h, W - 0.032], [0.3 * h, W - 0.032], [ax, W - 0.014], [h, W - 0.06]]),
      cornerR: [0.2, 0.1],
      cornerF: [0.2, 0.07],
      // The wing line: high at the doors, falling to a low nose and a lower, rounded tail.
      shoulder: curve([[-h, 0.76], [-h + 0.3, 0.86], [-ax, 0.95], [-0.42 * h, b], [0.25 * h, b], [fzb + 0.05, 0.965], [ax, 0.87], [h - 0.15, 0.81], [h, 0.79]]),
      lower: curve([[-h, sill + 0.07], [-h + 0.25, sill + 0.03], [-ax - 0.4, sill], [ax + 0.4, sill], [h - 0.2, sill + 0.02], [h, sill + 0.06]]),
      // (No deeper than the tail panel is tall: the waist must stay above the lower edge.)
      waistDrop: 0.2,
      lean: 0.2,
      tuck: 0.06,
      rS: 0.07,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.04,
      crown: (z) => (z < 0 ? 0.075 : 0.05),
      // The bonnet stands above the wings: nothing at the scuttle, full height from the axle to the nose,
      // and narrowing there so it is gone before the shoulder.
      hump: (z, x) => {
        const half = 0.5 - 0.1 * smooth(h - 0.3, h, z);
        return 0.085 * smooth(half, half - 0.2, x) * smooth(fzb + 0.02, fzb + 0.45, z);
      },
      barrel: 0.028,
      rearDeck: [-h, rzb - 0.01],
      frontDeck: [fzb - 0.01, h],
      deckBow: [0.04, 0.05],
      roll: [0.09, 0.06],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: 0.06 },
      front: { zb: fzb, zt: fzt, bow: 0.05 },
      roof: curve([[rzt, top - 0.085], [rzt + rs * 0.5, top - 0.04], [fzt, top - 0.07]]),
      crown: 0.035,
      lean: 0.16,
      railR: 0.09,
      headerR: 0.14,
      band: 0.03,
      panes: [
        { to: at(0.2, 0.14), kind: 'paint' },
        { to: at(0.5, 0.52), kind: 'glass' },
        { to: at(0.545, 0.58), kind: 'paint' },
        { to: at(0.955, 0.94), kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: CHROME,
      gutter: CHROME,
    },
    interior: {
      floor: seatY - 0.02,
      z0: rearZ - 0.36,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3],
      dash: { z: 0.38, y: b - 0.05 },
      shelf: { y: b - 0.05, z: rzb },
      cloth: tint(pick([0x7a2f2a, 1], [0x3f5a48, 1], [0x6b5a42, 1]), 'cloth'),
      back: 0.5,
      headrests: false,
      console: false,
    },
    wheel: 'dish',
    rim: 0xded8c4,
    belly: 0.17,
    ageing: EVERYDAY,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      bladeBumpers(k, shell, ax + ar + 0.03, 0.42, 0.8);
      // Overriders at both ends.
      for (const z of [h + 0.085, -h - 0.085]) for (const s of [1, -1]) k.pad(CHROME, 0.045, 0.13, 0.05, s * 0.3, 0.43, z, 0.015);
      // Nose: lamps high on the wings, the wide slatted grille under the bonnet's edge, side lamps below.
      F.roundLamps(0.47, 0.635, 0.078);
      F.grille(0, 0.585, 0.56, 0.14, { bars: 7, surface: tint(0xe6e0cc, 'gloss'), frame: CHROME, badge: null });
      F.both(AMBER, 0.06, 0.04, 0.47, 0.51, 0.012, 0.006);
      // Bright strip down the middle of the bonnet, with the badge at its head.
      shell.deckLine(k, CHROME, 0, fzb + 0.12, h - 0.07, 0.014, 0.004);
      // Tail: small upright lamps on the wings, the plate and its handle on the boot lid.
      R.taillamps(0.47, 0.54, 0.075, 0.13, { upright: true, bezel: CHROME, reverse: false });
      R.box(CHROME, 0.13, 0.022, 0, 0.675, 0.02, 0.012);
      // Shut lines: bonnet, boot lid, four doors.
      shell.deckLine(k, DARK, (z) => Math.min(0.52, shell.sx(z) - 0.03), fzb + 0.06, h - 0.1);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.09, -h + 0.12, rzb - 0.1);
      shell.deckCross(k, DARK, rzb - 0.1, shell.sx(rzb - 0.1) - 0.09);
      scuttle(k, cab, 0.05);
      for (const z of [doorF, doorM, doorR]) shell.vline(k, DARK, z, shell.yL(z) + 0.035, shell.yS(z) - 0.03);
      shell.hline(k, DARK, sill + 0.075, doorR + 0.03, doorF);
      handles(k, shell, [doorM + 0.12, doorM - 0.12], b - 0.11, CHROME);
      // Round mirrors out on the front wings.
      for (const s of [1, -1]) {
        const z = ax + 0.12;
        const y0 = shell.yS(z);
        const x0 = shell.F(z, y0 - 0.07) - 0.07;
        k.tube(CHROME, [s * x0, y0 - 0.02, z], [s * (x0 + 0.02), y0 + 0.11, z + 0.03], 0.009, 5, false, 0.007);
        k.drum(CHROME, 0.048, 0.024, s * (x0 + 0.022), y0 + 0.14, z + 0.035, 'z', 10);
        k.drum(BRIGHT, 0.04, 0.004, s * (x0 + 0.022), y0 + 0.14, z + 0.022, 'z', 10);
      }
      wipers(k, cab, { span: 0.34 });
      exhaust(k, 0.3, 0.27, -h - 0.04, 0.018, 0.18, BARE_STEEL);
      // Filler cap on the right rear wing.
      k.drum(CHROME, 0.032, 0.03, -(shell.F(-ax - 0.2, 0.78) + 0.006), 0.78, -ax - 0.2, 'x', 10);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.09, 0.42, -h - 0.012, 0.575, 'old', 0.9);
  }).model;
}

// ───────────────────────────── BMW E30 M325i ─────────────────────────────

/** Crisp upright two-door notchback in its body kit: four lamps and the twin kidneys, air dam, skirts, boot spoiler. */
export function buildM325(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.065;
  const ax = spec.wheelbase / 2;
  const r = spec.wheelRadius;
  const W = spec.width / 2;
  const ar = r + 0.045;
  const top = spec.height;
  const belt = 0.9;
  const sill = 0.24;
  const seatY = Math.min(0.28, top - 1.11);
  const rzb = -0.62 * h;
  const rzt = -0.42 * h;
  const fzb = 0.36 * h;
  const fzt = 0.115 * h;
  const bs = fzb - rzb;
  const rs = fzt - rzt;
  const at = (fb: number, fr: number): [number, number] => [rzb + bs * fb, rzt + rs * fr];
  const doorF = fzb - 0.03;
  const doorR = rzb + bs * 0.52;
  const frontZ = -0.04 * h;
  const rearZ = -0.37 * h;
  const seats = [
    { x: -0.38, y: seatY, z: frontZ },
    { x: 0.38, y: seatY, z: frontZ },
    { x: -0.36, y: seatY, z: rearZ },
    { x: 0.36, y: seatY, z: rearZ },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.05], [-0.55 * h, W - 0.016], [0, W - 0.008], [0.55 * h, W - 0.018], [h, W - 0.055]]),
      cornerR: [0.09, 0.055],
      cornerF: [0.11, 0.07],
      // A wedge: low nose, high square boot.
      shoulder: curve([[-h, belt + 0.012], [-h + 0.08, belt + 0.02], [-0.62 * h, belt + 0.012], [0, belt], [0.45 * h, belt - 0.014], [0.75 * h, belt - 0.06], [h - 0.1, belt - 0.1], [h, belt - 0.11]]),
      lower: curve([[-h, sill + 0.09], [-h + 0.27, sill + 0.035], [-ax - 0.4, sill], [ax + 0.4, sill], [h - 0.22, sill + 0.02], [h, sill + 0.07]]),
      waistDrop: 0.19,
      lean: 0.09,
      tuck: 0.04,
      rS: 0.026,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.022,
      crown: 0.024,
      barrel: 0.012,
      rearDeck: [-h, rzb - 0.01],
      frontDeck: [fzb - 0.01, h],
      deckBow: [0.05, 0.07],
    },
    cabin: {
      rear: { zb: rzb, zt: rzt, bow: 0.05 },
      front: { zb: fzb, zt: fzt, bow: 0.07 },
      roof: curve([[rzt, top - 0.06], [rzt + rs * 0.55, top - 0.036], [fzt, top - 0.05]]),
      crown: 0.028,
      lean: 0.15,
      railR: 0.045,
      headerR: 0.09,
      band: 0.032,
      // Two doors; the rear pillar is broad at the belt and kinks forward into it.
      panes: [
        { to: at(0.19, 0.06), kind: 'paint' },
        { to: at(0.5, 0.5), kind: 'glass' },
        { to: at(0.535, 0.56), kind: 'black' },
        { to: at(0.965, 0.95), kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: {
      floor: seatY - 0.02,
      z0: rearZ - 0.38,
      z1: fzb + 0.01,
      seats,
      bench: [2, 3],
      dash: { z: frontZ + 0.4, y: belt - 0.045 },
      shelf: { y: belt - 0.02, z: rzb },
      cloth: tint(pick([0x25262a, 2], [0x3a3d42, 1]), 'cloth'),
    },
    wheel: 'mesh',
    belly: 0.13,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // The body kit: painted bumpers with a black rubbing strip, the front one running down into a deep
      // air dam, the rear into a valance.
      const dam: Pt[] = [[-0.03, -0.25], [0.03, -0.255], [0.05, -0.23], [0.043, -0.12], [0.05, -0.06], [0.056, -0.02], [0.056, 0.045], [0.04, 0.075], [-0.03, 0.08]];
      const valance: Pt[] = [[-0.03, -0.17], [0.025, -0.175], [0.042, -0.14], [0.05, -0.04], [0.056, -0.02], [0.056, 0.045], [0.04, 0.075], [-0.03, 0.08]];
      const strip: Pt[] = [[0.0565, -0.008], [0.064, 0.012], [0.0565, 0.032]];
      const by = 0.45;
      bumper(k, shell, 'front', PAINT, dam, { zStart: ax + ar + 0.03, y: by, bow: 0.015 });
      bumper(k, shell, 'rear', PAINT, valance, { zStart: -ax - ar - 0.03, y: by, bow: 0.015 });
      for (const end of ['front', 'rear'] as const) bumper(k, shell, end, DARK, strip, { zStart: (end === 'front' ? 1 : -1) * (ax + ar + 0.03), y: by, bow: 0.015 });
      // Intake and fog lamps in the dam, indicators in the bumper.
      F.box(DARK, 0.56, 0.06, 0, 0.29, 0.02, 0.07);
      F.both(BRIGHT, 0.14, 0.06, 0.47, 0.29, 0.012, 0.068);
      F.both(HEAD, 0.11, 0.04, 0.47, 0.29, 0.006, 0.07);
      F.lens(LENS, 0.13, 0.052, 0.47, 0.29, 0.072);
      F.both(AMBER, 0.13, 0.035, 0.5, by + 0.05, 0.01, 0.072);
      // Nose: four round lamps in black surrounds, slats inboard of them, the twin kidneys in the middle.
      const ly = 0.67;
      F.roundLamps(0.49, ly, 0.064);
      F.roundLamps(0.336, ly, 0.058);
      lampPlate(F, SATIN_BLACK, 0.49, ly, 0.08, 0.078, 0.07);
      lampPlate(F, SATIN_BLACK, 0.335, ly, 0.075, 0.078, 0.064);
      for (const s of [1, -1]) {
        F.grille(s * 0.2, ly, 0.11, 0.15, { bars: 4, surface: SATIN_BLACK, depth: 0.04 });
        F.grille(s * 0.072, ly, 0.11, 0.115, { bars: 0, upright: 6, surface: SATIN_BLACK, depth: 0.04, frame: CHROME });
      }
      // Tail: wide clusters at the corners, the plate on the lid between them.
      R.taillamps(0.5, 0.775, 0.36, 0.13);
      // Boot-lid spoiler, side skirts, rubbing strips.
      if (!k.lo) {
        const sz = -h + 0.085;
        k.pad(PAINT, 2 * shell.sx(sz) - 0.02, 0.05, 0.15, 0, shell.deckY(sz, 0) + 0.012, sz, 0.02, [0.12, 0, 0], true);
      }
      for (const s of [1, -1]) k.pad(PAINT, 0.05, 0.1, spec.wheelbase - 2 * ar - 0.04, s * (shell.F(0, sill + 0.02) + 0.006), sill + 0.01, 0, 0.02);
      for (const [z0, z1] of [
        [-h + 0.14, -ax - ar - 0.05],
        [-ax + ar + 0.05, ax - ar - 0.05],
        [ax + ar + 0.05, h - 0.16],
      ]) shell.band(k, DARK, 0.535, 0.565, z0, z1, [1, -1], 0.007, 1);
      // Shut lines.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.045, fzb + 0.05, h - 0.05);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.06, -h + 0.05, rzb - 0.09);
      shell.deckCross(k, DARK, rzb - 0.09, shell.sx(rzb - 0.09) - 0.06);
      scuttle(k, cab);
      shadeBand(k, cab);
      shell.vline(k, DARK, doorF, shell.yL(doorF) + 0.035, belt - 0.016);
      shell.vline(k, DARK, doorR, sill + 0.075, belt - 0.012);
      shell.hline(k, DARK, sill + 0.075, doorR, doorF);
      handles(k, shell, [doorR + 0.15], belt - 0.085, SATIN_BLACK, true);
      mirrors(k, shell, fzb - 0.1, belt + 0.055, PAINT, 0.13, 0.085);
      wipers(k, cab, { span: 0.46 });
      repeater(k, shell, ax + ar + 0.09, 0.62);
      exhaust(k, 0.44, 0.24, -h - 0.05, 0.022, 0.2);
      exhaust(k, 0.385, 0.24, -h - 0.05, 0.022, 0.2);
      fuelFlap(k, shell, -0.72 * h, 0.74, -1, 0.14, 0.13);
    },
  };
  return assemble(spec, color, m, spec.id, plan, (k) => {
    k.plates(h + 0.084, 0.455, -h - 0.012, 0.775, 'any');
  }).model;
}

/** Builders for the cars in ../specs-classics.ts, keyed by `VehicleSpec.model`. */
export const CLASSIC_MODELS: Record<string, VehicleModelBuilder> = {
  escort: buildEscort,
  monaro: buildMonaro,
  charger: buildCharger,
  morrie: buildMorrie,
  m325: buildM325,
};
