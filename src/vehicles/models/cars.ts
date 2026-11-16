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

/** Upright mid-80s six: chrome blade bumpers, twin square lamps, formal roofline. Sedan or wagon. */
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

export function buildSedan(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.075;
  // Most still wear their fluted covers; some have the plainer ones, some have lost them altogether.
  const wheel = pick<WheelStyle>(['hubcap', 5], ['cap', 3], ['steel', 2]);
  const fittings: Fittings = {
    tow: dice.chance(0.35) ? [-h - 0.1, 0.36] : undefined,
    flaps: dice.chance(0.25) ? [spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.075, 0.36, 0.2] : undefined,
    rack: dice.chance(0.08) ? [0.5, spec.height - 0.012, -0.85, 0.15, 2] : undefined,
  };
  const plan = sedanPlan(spec, { top: spec.height, wheel, rim: 0x8f8a7c, cloth: pick([0x5a4a3c, 1], [0x4a4f57, 1], [0x6b2f2a, 1]) });
  return assemble(spec, color, m, spec.id, plan, (k) => {
    fit(k, spec.id, fittings);
    k.plates(h + 0.09, 0.47, -h - 0.012, 0.775, 'any');
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

/** White patrol car: the sedan on steel wheels with a light bar and an invented livery. */
export function buildPolice(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const h = spec.length / 2 - 0.075;
  const bar = 0.14;
  const roof = spec.height - bar;
  // The vehicle system flashes these two; they must be this car's own.
  const beacon = (c: number) => m.register(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.25 }));
  const beacons = [beacon(0xd0181c), beacon(0x1a46d6)];
  const word = m.sign('POLICE', { bg: '#1d5f8a', fg: '#ffffff', style: 'block', aspect: 4, border: false });
  const plan = sedanPlan(spec, {
    top: roof,
    // Black steel wheels with chrome dog-dish caps: fleet specification.
    wheel: 'dish',
    rim: 0x1c1d1f,
    cloth: 0x3c4046,
    ageing: CHERISHED,
    extras(k, shell) {
      // Roof bar: black base, red lens over the driver, blue over the passenger, clear centre.
      k.pad(PLASTIC, 1.16, 0.04, 0.3, 0, roof + 0.012, -0.3, 0.012);
      k.pad('beacon0', 0.44, 0.1, 0.25, -0.33, roof + 0.075, -0.3, 0.03);
      k.pad('beacon1', 0.44, 0.1, 0.25, 0.33, roof + 0.075, -0.3, 0.03);
      k.pad(CLEAR_LENS, 0.2, 0.085, 0.22, 0, roof + 0.07, -0.3, 0.02);
      // Livery (invented): a sea-blue waistband over a gold pinstripe, broken by a forward slash on the
      // rear guard, and block lettering.
      const blue = tint(0x1d5f8a, 'gloss');
      const gold = tint(0xe2b227, 'gloss');
      const z1 = h - 0.2;
      shell.band(k, blue, 0.79, 0.9, -1.62, z1, [1, -1], 0.004, 1);
      shell.band(k, gold, 0.755, 0.775, -1.62, z1, [1, -1], 0.004, 1);
      for (const s of [1, -1]) {
        for (const [za, zb, c] of [
          [-1.86, -1.69, blue],
          [-2.02, -1.9, gold],
        ] as [number, number, Tint][]) {
          const p = (z: number, y: number): V3 => [s * (shell.F(z, y) + 0.004), y, z];
          k.poly(c, [p(za, 0.755), p(za + 0.09, 0.9), p(zb + 0.09, 0.9), p(zb, 0.755)], [0, 0.8, za]);
        }
      }
      const x = shell.F(0.44, 0.848) + 0.008;
      k.board(word, 0.66, 0.165, x, 0.848, 0.44, Math.PI / 2);
      k.board(word, 0.66, 0.165, -x, 0.848, 0.44, -Math.PI / 2);
      k.board(word, 0.64, 0.16, 0, shell.deckY(-h + 0.46, 0) + 0.004, -h + 0.46, Math.PI, -Math.PI / 2);
      k.board(word, 0.64, 0.16, 0, shell.deckY(1.6, 0) + 0.006, 1.6, 0, -Math.PI / 2 + 0.06);
      mudflaps(k, spec.track / 2, -spec.wheelbase / 2 - spec.wheelRadius - 0.075, 0.36, 0.2, 0.17);
    },
  });
  const built = assemble(spec, color, m, spec.id, plan, (k) => {
    // The beacons are drawn at every distance: a flashing light bar is how a patrol car is seen coming.
    k.role('beacon0', beacons[0], true);
    k.role('beacon1', beacons[1], true);
    k.plates(h + 0.09, 0.47, -h - 0.012, 0.775, 'new');
  });
  return { ...built.model, beacons };
}

// ───────────────────────────── V8 sedan ─────────────────────────────

/** Lower, smoother and louder: body-colour bumpers, slim lamps, boot spoiler, bonnet bulge, alloys. */
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
    { x: -0.4, y: 0.27, z: 0.02 },
    { x: 0.4, y: 0.27, z: 0.02 },
    { x: -0.4, y: 0.25, z: -0.86 },
    { x: 0.4, y: 0.25, z: -0.86 },
  ];
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.07], [-1.3, W - 0.022], [0, W - 0.012], [1.3, W - 0.028], [h, W - 0.09]]),
      cornerR: [0.2, 0.12],
      cornerF: [0.26, 0.16],
      shoulder: curve([[-h, 0.955], [-h + 0.1, 0.99], [-1.45, 0.995], [0, 0.97], [1.04, 0.95], [1.8, 0.895], [h - 0.14, 0.825], [h, 0.79]]),
      lower: curve([[-h, 0.33], [-h + 0.3, 0.25], [-ax - 0.45, 0.2], [ax + 0.45, 0.2], [h - 0.3, 0.2], [h, 0.24]]),
      waistDrop: 0.2,
      lean: 0.13,
      tuck: 0.05,
      rS: 0.05,
      arches: [
        { z: -ax, y: r + 0.005, r: ar },
        { z: ax, y: r + 0.005, r: ar },
      ],
      flare: 0.032,
      crown: 0.038,
      // Power bulge down the middle of the bonnet.
      hump: (z, x) => 0.028 * smooth(0.36, 0.2, x) * smooth(1.12, 1.35, z) * smooth(h - 0.12, h - 0.45, z),
      rearDeck: [-h, -1.45],
      frontDeck: [1.03, h],
      deckBow: [0.07, 0.09],
    },
    cabin: {
      rear: { zb: -1.46, zt: -0.8, bow: 0.07 },
      front: { zb: 1.05, zt: 0.24, bow: 0.09 },
      roof: curve([[-0.8, top - 0.075], [-0.3, top - 0.04], [0.24, top - 0.058]]),
      crown: 0.034,
      lean: 0.19,
      railR: 0.06,
      headerR: 0.15,
      band: 0.03,
      panes: [
        { to: [-1.0, -0.71], kind: 'paint' },
        { to: [-0.075, -0.09], kind: 'glass' },
        { to: [0.005, -0.01], kind: 'black' },
        { to: [0.96, 0.185], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.25, z0: -1.33, z1: 1.06, seats, bench: [2, 3], dash: { z: 0.53, y: 0.9 }, shelf: { y: 0.965, z: -1.46 }, cloth: tint(0x2c2e33, 'cloth') },
    wheel,
    belly: 0.13,
    ageing: CHERISHED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      // Moulded body-colour bumpers with a black insert; a deep front air dam with driving lamps.
      const moulding: Pt[] = [[-0.03, -0.15], [0.02, -0.155], [0.04, -0.12], [0.046, -0.04], [0.046, 0.05], [0.032, 0.085], [-0.03, 0.09]];
      const insert: Pt[] = [[0.0465, -0.012], [0.054, 0.012], [0.0465, 0.036]];
      for (const end of ['front', 'rear'] as const) {
        const zStart = (end === 'front' ? 1 : -1) * (ax + ar + 0.03);
        bumper(k, shell, end, PAINT, moulding, { zStart, y: 0.42, bow: 0.02 });
        bumper(k, shell, end, DARK, insert, { zStart, y: 0.42, bow: 0.02 });
      }
      F.box(DARK, 0.86, 0.07, 0, 0.3, 0.02, 0.066);
      F.both(BRIGHT, 0.15, 0.06, 0.5, 0.3, 0.012, 0.068);
      F.both(HEAD, 0.12, 0.04, 0.5, 0.3, 0.006, 0.07);
      F.lens(LENS, 0.14, 0.052, 0.5, 0.3, 0.072);
      // Nose: slim flush lamps, a slot of a grille, amber round the corners.
      F.headlamps(0.44, 0.675, 0.38, 0.095);
      F.grille(0, 0.672, 0.44, 0.07, { bars: 2, surface: PAINT, depth: 0.05, badge: [0.06, 0.04] });
      cornerLens(k, shell, 'front', AMBER, 0.675, 0.09, 0.25);
      // Tail: lamp clusters joined by a reflector panel, plate down in the bumper.
      R.taillamps(0.47, 0.815, 0.46, 0.13);
      R.box(tint(0x5c100c, 'gloss'), 0.47, 0.11, 0, 0.815, 0.02, 0.006);
      R.pane(TAIL_LENS, 0.46, 0.1, 0, 0.815, 0.008);
      cornerLens(k, shell, 'rear', RED_LENS, 0.815, 0.12, 0.2);
      R.box(DARK, 1.36, 0.008, 0, 0.72, 0.006, 0.003);
      // Shut lines.
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.08, -h + 0.05, -1.58);
      shell.deckCross(k, DARK, -1.58, shell.sx(-1.58) - 0.08);
      shell.deckLine(k, DARK, (z) => shell.sx(z) - 0.05, 1.08, h - 0.06);
      scuttle(k, cab);
      shadeBand(k, cab);
      shell.vline(k, DARK, 0.98, 0.28, 0.93);
      shell.vline(k, DARK, -0.035, 0.28, 0.955);
      shell.vline(k, DARK, -1.04, 0.56, 0.975);
      shell.hline(k, DARK, 0.275, -1.0, 0.98);
      handles(k, shell, [0.1, -0.88], 0.85, PLASTIC, true);
      // Rubbing strip, side skirts, mirrors.
      shell.band(k, DARK, 0.5, 0.535, -ax + ar + 0.05, ax - ar - 0.05, [1, -1], 0.008, 1);
      for (const s of [1, -1]) k.pad(PAINT, 0.05, 0.1, spec.wheelbase - 2 * ar - 0.05, s * (shell.F(0, 0.24) + 0.005), 0.225, 0, 0.02);
      mirrors(k, shell, 0.86, 1.01, PAINT);
      wipers(k, cab);
      repeater(k, shell, ax + ar + 0.1, 0.62);
      aerial(k, shell.sx(-1.9) - 0.1, shell.deckY(-1.9, shell.sx(-1.9) - 0.1), -1.9, 0.42);
      exhaust(k, 0.5, 0.22, -h - 0.05, 0.03);
      exhaust(k, 0.42, 0.22, -h - 0.05, 0.03);
      fuelFlap(k, shell, -1.98, 0.8);
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

