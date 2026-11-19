import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { AMBER, CHROME, curve, DARK, dice, GREY, PAINT, PLASTIC, RED_GLASS, RED_LENS, RUBBER, STEEL, TAIL, tint, WINDOW, type V3 } from './kit';
import { assemble, cornerLens, Face, handles, mudflaps, shadeBand, TIRED, wipers, type CarPlan } from './parts';

/** Invented stock carriers for the newer truck's door signwriting. */
const CARRIERS = [
  { text: 'SOUTHDOWN HAULAGE\nWASHDYKE', fg: '#1d3f78' },
  { text: 'J. McANDREW & SONS\nLIVESTOCK CARTAGE', fg: '#8a1c20' },
  { text: 'OPIHI TRANSPORT\nPH 03 615 7244', fg: '#1f5e3a' },
];

const WOOL = tint(0xe3dbc6, 'cloth');
const SHEEP_FACE = tint(0xbfb39c, 'cloth');

/** A full sheep standing at (x, z) on a deck at `y`, scaled by `s` (1 = a 76 cm ewe). */
function sheep(k: import('./kit').Kit, x: number, y: number, z: number, s = 1): void {
  const fwd = dice.chance(0.5) ? 1 : -1;
  k.pad(WOOL, 0.46 * s, 0.44 * s, 0.84 * s, x, y + 0.52 * s, z, 0.14 * s, undefined, true);
  k.pad(SHEEP_FACE, 0.15 * s, 0.17 * s, 0.24 * s, x, y + 0.76 * s, z + fwd * 0.46 * s, 0.05 * s);
  for (const e of [1, -1]) k.box(SHEEP_FACE, 0.05 * s, 0.03 * s, 0.09 * s, x + e * 0.1 * s, y + 0.8 * s, z + fwd * 0.4 * s, [0, 0, e * 0.5]);
  for (const [lx, lz] of [
    [-0.13, -0.26],
    [0.13, -0.26],
    [-0.13, 0.26],
    [0.13, 0.26],
  ]) {
    k.box(SHEEP_FACE, 0.045 * s, 0.3 * s, 0.045 * s, x + lx * s, y + 0.15 * s, z + lz * s);
  }
}

/**
 * Bedford TK class farm truck, 1960s to 1970s: the set-back front axle puts the round-eyed flat face well
 * ahead of the wheels, a wide grinning grille low between the lamps, a short bonnet-less cab, then a bare
 * chassis, a timber deck and a slatted two-deck stock crate. About half of them are carrying sheep.
 */
export function buildFarmTruck(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const loaded = dice.chance(0.55);
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  const half = spec.width / 2; // deck and crate
  const cabW = half - 0.065;
  const zf = spec.length / 2 - 0.1; // cab face; the bumper stands proud
  const rear = -spec.length / 2 + 0.03; // back of the deck
  const cabRear = 1.48;
  const belt = 1.52;
  const ar = r + 0.1;
  const seats = [
    { x: -0.55, y: 1.14, z: 2.15 },
    { x: 0.55, y: 1.14, z: 2.15 },
  ];
  const white = tint(0xdcdcd4, 'satin');
  const plan: CarPlan = {
    shell: {
      zr: cabRear,
      zf,
      plan: curve([[cabRear, cabW], [zf, cabW - 0.025]]),
      cornerR: [0.03, 0.015],
      cornerF: [0.2, 0.12],
      shoulder: curve([[cabRear, belt], [zf - 0.15, belt], [zf, belt - 0.03]]),
      lower: curve([[cabRear, 0.8], [2.55, 0.7], [zf, 0.74]]),
      waistDrop: 0.42,
      lean: 0.02,
      tuck: 0.03,
      rS: 0.04,
      arches: [{ z: a, y: r + 0.04, r: ar }],
      flare: 0.012,
      crown: 0,
      rearDeck: null,
      frontDeck: null,
    },
    cabin: {
      rear: { zb: cabRear + 0.02, zt: cabRear + 0.08, bow: 0, kind: 'paint' },
      front: { zb: zf - 0.04, zt: zf - 0.31, bow: 0.05 },
      roof: curve([[cabRear + 0.08, 2.27], [2.2, 2.3], [zf - 0.31, 2.26]]),
      crown: 0.04,
      lean: 0.11,
      railR: 0.09,
      headerR: 0.12,
      band: 0.05,
      panes: [
        { to: [cabRear + 0.28, cabRear + 0.32], kind: 'paint' },
        { to: [zf - 0.13, zf - 0.37], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 0.95, z0: cabRear + 0.1, z1: zf - 0.05, seats, dash: { z: 2.67, y: belt - 0.05 }, cloth: tint(0x3d3a36, 'cloth'), back: 0.5 },
    wheel: 'truck',
    rearWheel: 'dual',
    twin: spec.wheelCount === 6,
    rearTrack: 2 * (half - spec.wheelWidth / 2 - 0.02),
    rim: 0xcfc8b0,
    ageing: TIRED,
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      // Engine cover between the seats, back window in the cab's rear wall.
      k.pad(tint(0x26282b, 'satin'), 0.5, 0.36, 0.9, 0, 1.12, 2.1, 0.05);
      const zb = cabRear + 0.014;
      k.poly(WINDOW, [[-0.5, 1.72, zb], [0.5, 1.72, zb], [0.5, 2.1, zb + 0.015], [-0.5, 2.1, zb + 0.015]], [0, 1.9, zb + 3]);
      k.box(RUBBER, 1.04, 0.02, 0.012, 0, 1.71, zb - 0.004);
      k.box(RUBBER, 1.04, 0.02, 0.012, 0, 2.11, zb + 0.012);
      k.boxes(RUBBER, 0.02, 0.4, 0.012, 0.51, 1.91, zb + 0.004);

      // The TK face: round eyes wide apart, the grin of a grille low between them, a badge bar above,
      // indicators on the corners, white steel bumper.
      F.roundLamps(0.72, 1.15, 0.105);
      F.grille(0, 0.92, 1.6, 0.26, { bars: 4, depth: 0.06 });
      F.box(CHROME, 0.5, 0.045, 0, 1.33, 0.012, 0.008);
      F.box(CHROME, 0.1, 0.07, 0, 1.2, 0.01, 0.01);
      cornerLens(k, shell, 'front', AMBER, 0.95, 0.11, 0.2);
      k.pad(white, spec.width - 0.02, 0.2, 0.14, 0, 0.7, zf + 0.03, 0.02, undefined, true);
      // Split flat screen, sun visor, wipers, mirrors on arms, cab-roof marker lamps.
      k.beam(PAINT, cab.screen(0, 0.0, 0.01), cab.screen(0, 1.0, 0.01), 0.04, 0.016);
      const v0 = cab.screen(0, 1.0, 0.02);
      k.pad(PAINT, 2 * cabW - 0.25, 0.022, 0.26, 0, v0[1] + 0.03, v0[2] + 0.1, 0.01, [0.35, 0, 0]);
      wipers(k, cab, { opposed: true, span: 0.42 });
      shadeBand(k, cab, 0.12);
      for (const s of [1, -1]) {
        const x = s * (shell.F(zf - 0.42, belt) + 0.17);
        k.pipe(DARK, [[s * (cabW - 0.05), 2.1, zf - 0.42], [x, 2.08, zf - 0.33], [x, 1.62, zf - 0.33], [s * (cabW - 0.02), 1.56, zf - 0.42]], 0.011, 5);
        k.box(DARK, 0.03, 0.36, 0.17, x, 1.86, zf - 0.325);
        k.box(CHROME, 0.004, 0.33, 0.14, x, 1.86, zf - 0.342);
      }
      for (const x of [-0.3, 0, 0.3]) k.box(AMBER, 0.07, 0.03, 0.04, x, cab.roofY(zf - 0.5) - 0.012, zf - 0.47);
      // Doors: shut lines, handle, a step under each.
      shell.vline(k, DARK, cabRear + 0.2, 1.0, belt);
      shell.vline(k, DARK, zf - 0.26, 0.76, belt);
      shell.hline(k, DARK, 0.76, zf - 0.6, zf - 0.26);
      handles(k, shell, [cabRear + 0.36], 1.38, PLASTIC);
      k.boxes(DARK, 0.14, 0.035, 0.4, cabW - 0.02, 0.6, zf - 0.45);
      k.boxes(DARK, 0.02, 0.14, 0.03, cabW - 0.03, 0.67, zf - 0.6);

      // Chassis: rails, cross members, engine, fuel tank, battery box, axles, propshaft, exhaust.
      const chassisLen = cabRear + 0.9 - rear - 0.06;
      k.boxes(DARK, 0.09, 0.22, chassisLen, 0.43, 0.9, (cabRear + 0.9 + rear + 0.06) / 2, undefined, true);
      for (const z of [rear + 0.2, -a - 0.9, -a + 0.9, 0.3]) k.box(DARK, 0.8, 0.12, 0.09, 0, 0.9, z);
      k.box(DARK, 0.7, 0.55, 1.0, 0, 0.72, a + 0.35);
      k.drum(STEEL, 0.23, 0.9, half - 0.36, 0.72, 0.55, 'z', 12, true);
      for (const z of [0.3, 0.8]) k.box(DARK, 0.5, 0.03, 0.05, half - 0.36, 0.72 + 0.235, z);
      k.box(DARK, 0.36, 0.3, 0.6, -(half - 0.34), 0.74, 0.55);
      k.box(DARK, 1.55, 0.18, 0.18, 0, r, -a);
      k.ball(DARK, 0.22, 0, r, -a, 1, 1, 8);
      k.box(DARK, 1.6, 0.1, 0.1, 0, r, a);
      k.tube(STEEL, [0, r + 0.05, -a + 0.2], [0, 0.62, a - 0.5], 0.045, 6);
      k.pipe(STEEL, [[-0.3, 0.6, a - 0.3], [-0.62, 0.52, 0.6], [-0.62, 0.52, -0.9]], 0.04, 6);
      // Guards over the twin rears, flaps, tail-lamp bar.
      for (const s of [1, -1]) {
        const rows: V3[][] = [];
        for (let i = 0; i <= 6; i++) {
          const t = Math.PI * (0.12 + (0.76 * i) / 6);
          const y = r + 0.02 + (r + 0.09) * Math.sin(t);
          const z = -a + (r + 0.09) * Math.cos(t);
          rows.push([
            [s * (half - 0.005), y, z],
            [s * (half - 0.63), y, z],
          ]);
        }
        k.grid(DARK, rows, { out: [s * (half - 0.3), r, -a] });
        k.grid(DARK, rows, { out: [s * (half - 0.3), r, -a], inward: true });
      }
      k.boxes(DARK, 0.6, 0.42, 0.02, half - 0.31, 0.5, -a - r - 0.1);
      k.box(DARK, spec.width - 0.1, 0.11, 0.06, 0, 0.84, rear + 0.05);
      const tx = half - 0.26;
      k.boxes(RED_LENS, 0.28, 0.085, 0.03, tx, 0.84, rear + 0.015);
      // (Queued as a bare pane on the distant version, where a box this small would be dropped.)
      if (k.lo) for (const s of [1, -1]) k.tris(TAIL, [s * tx - 0.13, 0.8, rear - 0.004, s * tx + 0.13, 0.88, rear - 0.004, s * tx + 0.13, 0.8, rear - 0.004, s * tx - 0.13, 0.8, rear - 0.004, s * tx - 0.13, 0.88, rear - 0.004, s * tx + 0.13, 0.88, rear - 0.004], { flat: true });
      k.boxes(TAIL, 0.13, 0.062, 0.03, tx + 0.06, 0.84, rear + 0.008);
      k.boxes(AMBER, 0.08, 0.062, 0.03, tx - 0.07, 0.84, rear + 0.008);
      for (const s of [1, -1]) k.poly(RED_GLASS, [[s * tx - 0.13, 0.805, rear - 0.008], [s * tx + 0.13, 0.805, rear - 0.008], [s * tx + 0.13, 0.875, rear - 0.008], [s * tx - 0.13, 0.875, rear - 0.008]], [s * tx, 0.84, rear + 1]);

      // Timber deck and the slatted two-deck stock crate.
      const timber = m.get('timber', { color: 0xb3a68e });
      const deckTop = 1.14;
      const deckFront = cabRear - 0.1;
      k.slab(timber, spec.width, 0.09, deckFront - rear, 0, deckTop - 0.045, (deckFront + rear) / 2);
      k.boxes(STEEL, 0.03, 0.1, deckFront - rear, half - 0.01, deckTop - 0.05, (deckFront + rear) / 2);
      const crateH = spec.height - deckTop - 0.035;
      const z0 = deckFront - 0.06;
      const z1 = rear + 0.05;
      const posts = 5;
      const px = half - 0.04;
      for (let i = 0; i < posts; i++) {
        const z = z0 + ((z1 - z0) * i) / (posts - 1);
        for (const s of [1, -1]) k.plank(timber, 0.07, crateH, 0.09, s * px, deckTop + crateH / 2, z);
      }
      // Side slats on both levels, with the second deck's floor between them.
      const deck2 = 0.85;
      for (const y of [0.1, 0.3, 0.5, 0.7, deck2 + 0.12, deck2 + 0.32, deck2 + 0.52, crateH - 0.07]) {
        for (const s of [1, -1]) k.plank(timber, 0.028, 0.13, z0 - z1 + 0.06, s * (px - 0.05), deckTop + y, (z0 + z1) / 2);
        k.plank(timber, 2 * px - 0.1, 0.13, 0.028, 0, deckTop + y, z1 + 0.05);
      }
      k.slab(timber, 2 * px - 0.12, 0.05, z0 - z1 - 0.05, 0, deckTop + deck2, (z0 + z1) / 2);
      // Headboard is close-boarded; the tailgate is two leaves with a brace each.
      for (let i = 0; i < 4; i++) k.plank(timber, 2 * px - 0.1, crateH / 4 - 0.03, 0.03, 0, deckTop + (crateH * (i + 0.5)) / 4, z0 - 0.05);
      k.plank(timber, 0.07, crateH, 0.05, 0, deckTop + crateH / 2, z1 + 0.02);
      for (const s of [1, -1]) k.brace(timber, [s * (px - 0.1), deckTop + 0.12, z1 + 0.02], [s * 0.08, deckTop + crateH - 0.12, z1 + 0.02], 0.1, 0.028);
      for (let i = 1; i < posts - 1; i++) k.plank(timber, 2 * px, 0.06, 0.07, 0, deckTop + crateH + 0.005, z0 + ((z1 - z0) * i) / (posts - 1));

      if (loaded) {
        // A mob of sheep on both decks, seen as wool between the slats.
        for (let row = 0; row < 3; row++) {
          for (const s of [1, -1]) {
            const z = z0 - 0.9 - row * 1.3 + dice.range(-0.12, 0.12);
            sheep(k, s * (0.46 + dice.range(-0.08, 0.08)), deckTop, z, 0.82);
          }
        }
        // Up top only the wool shows above the slats.
        for (let row = 0; row < 3; row++) {
          for (const s of [1, -1]) {
            const z = z0 - 0.7 - row * 1.5 + dice.range(-0.15, 0.15);
            k.pad(WOOL, 0.4, 0.34, 0.8, s * (0.45 + dice.range(-0.06, 0.06)), deckTop + deck2 + 0.22, z, 0.12, undefined, true);
          }
        }
      }
    },
  };
  return assemble(spec, color, m, `truck2|${loaded}`, plan, (k) => k.plates(zf + 0.105, 0.7, rear + 0.018, 0.84)).model;
}

/**
 * Hino / Isuzu class cab-over stock truck, late 1980s: a tall square tilt-cab with rectangular lamps low in
 * the face, a signwritten door, and an aluminium three-deck stock crate with horizontal rails. Bigger and
 * newer than the Bedford, and the crate is metal, not timber.
 */
export function buildStockTruck(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const loaded = dice.chance(0.55);
  const firm = dice.int(0, CARRIERS.length - 1);
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  const half = spec.width / 2; // crate
  const cabW = half - 0.07;
  const zf = spec.length / 2 - 0.1; // cab face; the bumper stands proud
  const rear = -spec.length / 2 + 0.03; // back of the deck
  const cabRear = 2.05;
  const belt = 1.74;
  const ar = r + 0.1;
  const seats = [
    { x: -0.6, y: 1.32, z: 3.05 },
    { x: 0.6, y: 1.32, z: 3.05 },
  ];
  const alu = tint(0xc3c8cc, 'steel');
  const aluDark = tint(0x8f969b, 'steel');
  const plan: CarPlan = {
    shell: {
      zr: cabRear,
      zf,
      plan: curve([[cabRear, cabW], [zf, cabW - 0.02]]),
      cornerR: [0.03, 0.015],
      cornerF: [0.16, 0.1],
      shoulder: curve([[cabRear, belt], [zf - 0.2, belt], [zf, belt - 0.02]]),
      lower: curve([[cabRear, 0.85], [2.9, 0.72], [zf, 0.76]]),
      waistDrop: 0.5,
      lean: 0.015,
      tuck: 0.02,
      rS: 0.035,
      arches: [{ z: a, y: r + 0.04, r: ar }],
      flare: 0.012,
      crown: 0,
      rearDeck: null,
      frontDeck: null,
    },
    cabin: {
      rear: { zb: cabRear + 0.02, zt: cabRear + 0.07, bow: 0, kind: 'paint' },
      front: { zb: zf - 0.03, zt: zf - 0.26, bow: 0.04 },
      roof: curve([[cabRear + 0.07, 2.72], [2.9, 2.76], [zf - 0.26, 2.72]]),
      crown: 0.035,
      lean: 0.09,
      railR: 0.08,
      headerR: 0.1,
      band: 0.05,
      panes: [
        { to: [cabRear + 0.24, cabRear + 0.28], kind: 'paint' },
        { to: [zf - 0.1, zf - 0.3], kind: 'glass' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
    },
    interior: { floor: 1.12, z0: cabRear + 0.1, z1: zf - 0.05, seats, dash: { z: 3.52, y: belt - 0.06 }, cloth: tint(0x45413c, 'cloth'), back: 0.5 },
    wheel: 'truck',
    rearWheel: 'dual',
    twin: spec.wheelCount === 6,
    rearTrack: 2 * (half - spec.wheelWidth / 2 - 0.02),
    rim: 0xd8d8d2,
    ageing: { dirt: [0.2, 0.7], dust: [0.2, 0.7], fade: 0.2, rust: 0.1 },
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      // Engine hump between the seats, back window high in the cab's rear wall.
      k.pad(tint(0x26282b, 'satin'), 0.56, 0.4, 0.95, 0, 1.3, 3.0, 0.05);
      const zb = cabRear + 0.014;
      k.poly(WINDOW, [[-0.55, 1.95, zb], [0.55, 1.95, zb], [0.55, 2.3, zb + 0.012], [-0.55, 2.3, zb + 0.012]], [0, 2.1, zb + 3]);
      k.box(RUBBER, 1.14, 0.02, 0.012, 0, 1.94, zb - 0.004);
      k.box(RUBBER, 1.14, 0.02, 0.012, 0, 2.31, zb + 0.01);

      // Face: a tall flat panel. Slatted grille high, badge, rectangular lamps low over a deep bumper.
      F.grille(0, 1.42, 1.66, 0.26, { bars: 3, surface: GREY, depth: 0.06 });
      F.box(CHROME, 0.42, 0.05, 0, 1.62, 0.012, 0.008);
      F.headlamps(0.72, 1.0, 0.32, 0.17, { bezel: PLASTIC });
      F.grille(0, 1.0, 0.66, 0.15, { bars: 2, surface: GREY, depth: 0.04 });
      cornerLens(k, shell, 'front', AMBER, 1.0, 0.12, 0.18);
      k.pad(tint(0x3a3d40, 'satin'), spec.width - 0.06, 0.24, 0.16, 0, 0.68, zf + 0.04, 0.02, undefined, true);
      // One big flat screen, wipers, long mirror arms, roof marker lamps.
      wipers(k, cab, { opposed: true, span: 0.46 });
      shadeBand(k, cab, 0.12);
      for (const s of [1, -1]) {
        const x = s * (shell.F(zf - 0.4, belt) + 0.18);
        k.pipe(DARK, [[s * (cabW - 0.05), 2.5, zf - 0.4], [x, 2.48, zf - 0.3], [x, 1.9, zf - 0.3], [s * (cabW - 0.02), 1.84, zf - 0.4]], 0.012, 5);
        k.box(DARK, 0.03, 0.42, 0.19, x, 2.18, zf - 0.295);
        k.box(CHROME, 0.004, 0.38, 0.16, x, 2.18, zf - 0.312);
      }
      for (const x of [-0.4, 0, 0.4]) k.box(AMBER, 0.08, 0.035, 0.04, x, cab.roofY(zf - 0.45) - 0.01, zf - 0.42);
      // Doors: shut lines, handles, a two-step well under each, and the carrier's name on the door.
      shell.vline(k, DARK, cabRear + 0.18, 1.02, belt);
      shell.vline(k, DARK, zf - 0.24, 0.8, belt);
      shell.hline(k, DARK, 0.8, zf - 0.62, zf - 0.24);
      handles(k, shell, [cabRear + 0.34], 1.56, PLASTIC);
      k.boxes(DARK, 0.16, 0.04, 0.44, cabW - 0.02, 0.62, zf - 0.44);
      k.boxes(DARK, 0.16, 0.04, 0.44, cabW - 0.06, 0.94, zf - 0.44);
      const sign = m.sign(CARRIERS[firm].text, { bg: '#f0ede2', fg: CARRIERS[firm].fg, style: 'paint', aspect: 3.2, border: false });
      for (const s of [1, -1]) k.board(sign, 0.92, 0.3, s * (shell.F(2.85, 1.28) + 0.006), 1.28, 2.85, (s * Math.PI) / 2, 0);

      // Chassis: rails, cross members, fuel tank, battery box, axles, propshaft, exhaust.
      const chassisLen = cabRear + 1.1 - rear - 0.06;
      k.boxes(DARK, 0.1, 0.24, chassisLen, 0.46, 0.92, (cabRear + 1.1 + rear + 0.06) / 2, undefined, true);
      for (const z of [rear + 0.2, -a - 1.0, -a + 1.0, 0.4, 1.6]) k.box(DARK, 0.86, 0.12, 0.09, 0, 0.92, z);
      k.box(DARK, 0.76, 0.6, 1.1, 0, 0.75, a + 0.4);
      k.drum(alu, 0.26, 1.1, half - 0.4, 0.74, 0.8, 'z', 12, true);
      for (const z of [0.5, 1.1]) k.box(DARK, 0.56, 0.03, 0.05, half - 0.4, 0.74 + 0.265, z);
      k.box(DARK, 0.4, 0.32, 0.7, -(half - 0.38), 0.76, 0.8, undefined, true);
      k.box(DARK, 1.7, 0.2, 0.2, 0, r, -a);
      k.ball(DARK, 0.24, 0, r, -a, 1, 1, 8);
      k.box(DARK, 1.7, 0.1, 0.1, 0, r, a);
      k.tube(STEEL, [0, r + 0.05, -a + 0.2], [0, 0.64, a - 0.6], 0.05, 6);
      k.pipe(STEEL, [[-0.3, 0.62, a - 0.4], [-0.66, 0.54, 0.4], [-0.66, 0.54, -1.2]], 0.045, 6);
      mudflaps(k, half - 0.34, -a - r - 0.12, 0.56, 0.6, 0.14);
      k.box(DARK, spec.width - 0.1, 0.12, 0.06, 0, 0.86, rear + 0.05);
      const tx = half - 0.28;
      k.boxes(RED_LENS, 0.3, 0.09, 0.03, tx, 0.86, rear + 0.015);
      if (k.lo) for (const s of [1, -1]) k.tris(TAIL, [s * tx - 0.14, 0.82, rear - 0.004, s * tx + 0.14, 0.9, rear - 0.004, s * tx + 0.14, 0.82, rear - 0.004, s * tx - 0.14, 0.82, rear - 0.004, s * tx - 0.14, 0.9, rear - 0.004, s * tx + 0.14, 0.9, rear - 0.004], { flat: true });
      k.boxes(TAIL, 0.14, 0.066, 0.03, tx + 0.065, 0.86, rear + 0.008);
      k.boxes(AMBER, 0.08, 0.066, 0.03, tx - 0.08, 0.86, rear + 0.008);
      for (const s of [1, -1]) k.poly(RED_GLASS, [[s * tx - 0.14, 0.822, rear - 0.008], [s * tx + 0.14, 0.822, rear - 0.008], [s * tx + 0.14, 0.898, rear - 0.008], [s * tx - 0.14, 0.898, rear - 0.008]], [s * tx, 0.86, rear + 1]);

      // Aluminium three-deck crate: solid sheet skirts, horizontal rails, sheet headboard and tailgate.
      const deckTop = 1.32;
      const deckFront = cabRear - 0.12;
      const z0 = deckFront - 0.04;
      const z1 = rear + 0.05;
      const zm = (z0 + z1) / 2;
      const len = z0 - z1;
      const crateTop = spec.height - 0.04;
      const px = half - 0.03;
      // Deck floors (the bottom one is the deck itself).
      const levels = [deckTop, 2.0, 2.68];
      for (const y of levels) k.box(aluDark, 2 * px - 0.06, 0.05, len, 0, y - 0.025, zm, undefined, y === deckTop);
      if (k.lo) {
        // From a distance the rails read as a part-open wall: one sheet per deck does it.
        for (const s of [1, -1]) {
          for (const y of levels) {
            const top = y === 2.68 ? crateTop : levels[levels.indexOf(y) + 1];
            k.box(alu, 0.02, (top - y) * 0.75, len, s * px, y + (top - y) * 0.45, zm, undefined, true);
          }
        }
        k.box(alu, 2 * px - 0.05, crateTop - deckTop, 0.04, 0, (crateTop + deckTop) / 2, z0 - 0.04, undefined, true);
        k.box(alu, 2 * px - 0.05, crateTop - deckTop, 0.04, 0, (crateTop + deckTop) / 2, z1 + 0.04, undefined, true);
      } else {
        // Posts, skirt sheets and rails per deck.
        const posts = 6;
        for (let i = 0; i < posts; i++) {
          const z = z0 + ((z1 - z0) * i) / (posts - 1);
          for (const s of [1, -1]) k.box(alu, 0.05, crateTop - deckTop + 0.04, 0.07, s * px, (crateTop + deckTop) / 2, z, undefined, true);
        }
        for (const s of [1, -1]) {
          for (const y of levels) {
            // Solid sheet at the deck floor, then four rails up to the next floor.
            k.box(alu, 0.025, 0.2, len, s * (px - 0.012), y + 0.1, zm, undefined, true);
            const span = (y === 2.68 ? crateTop : levels[levels.indexOf(y) + 1]) - y;
            for (let j = 1; j <= 4; j++) k.box(alu, 0.02, 0.045, len, s * (px - 0.015), y + 0.2 + ((span - 0.26) * j) / 4, zm);
          }
          // Top capping rail.
          k.box(alu, 0.05, 0.06, len, s * px, crateTop - 0.03, zm);
        }
        // Headboard and tailgate: ribbed sheet.
        for (const [z, e] of [
          [z0 - 0.04, 1],
          [z1 + 0.04, -1],
        ]) {
          k.box(alu, 2 * px - 0.05, crateTop - deckTop, 0.04, 0, (crateTop + deckTop) / 2, z, undefined, true);
          for (const x of [-0.7, -0.35, 0, 0.35, 0.7]) k.box(aluDark, 0.05, crateTop - deckTop - 0.1, 0.012, x, (crateTop + deckTop) / 2, z + e * 0.025);
        }
        // Catwalk ladder on the back corner.
        for (const y of [1.6, 1.95, 2.3, 2.65, 3.0]) k.box(aluDark, 0.26, 0.025, 0.025, px - 0.3, y, z1 + 0.07);
      }

      if (loaded && !k.lo) {
        // Wool pressed against the rails on the lower two decks, and a few heads.
        for (const s of [1, -1]) {
          for (const y of [deckTop, 2.0]) {
            k.pad(WOOL, 0.18, 0.42, len - 1.2, s * (px - 0.14), y + 0.3, zm + dice.range(-0.2, 0.2), 0.06, undefined, true);
          }
        }
        for (let i = 0; i < 3; i++) sheep(k, (i - 1) * 0.6 + dice.range(-0.1, 0.1), 2.68, z1 + 0.7 + i * 0.9, 0.8);
      }
    },
  };
  return assemble(spec, color, m, `stock1|${loaded}|${firm}`, plan, (k) => k.plates(zf + 0.115, 0.56, rear + 0.018, 0.74)).model;
}
