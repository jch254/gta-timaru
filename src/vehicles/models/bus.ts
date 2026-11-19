import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import type { PaneKind } from './body';
import { AMBER, BLACK, CHROME, curve, DARK, dice, GREY, PLASTIC, RUBBER, SMOKED, tint, WINDOW, type V3 } from './kit';
import { assemble, cornerLens, Face, wipers, type CarPlan } from './parts';

/** Invented routes for the destination blind. */
const BLINDS = ['5  CITY', '12  HOSPITAL', '23  RAILWAY STN', '31  PORT'];

type Pane = { to: [number, number] | 'front'; kind: PaneKind };

/** `count` window bays between z0 and z1, each followed by a pillar. */
function bays(z0: number, z1: number, count: number, pillar = 0.09, last: PaneKind = 'paint'): Pane[] {
  const out: Pane[] = [];
  const pitch = (z1 - z0) / count;
  for (let i = 0; i < count; i++) {
    const end = z0 + pitch * (i + 1);
    out.push({ to: [end - pillar, end - pillar], kind: 'glass' }, { to: [end, end], kind: i === count - 1 ? last : 'paint' });
  }
  return out;
}

/**
 * MAN SL202 class rear-engined city bus, 1986 to 1990: boxy slab sides, a long run of windows, a big flat
 * windscreen, two-leaf doors on the kerb (left) side, a lit destination blind and twin rear wheels. The
 * documented Christchurch livery: deep red with one broad white band below the windows.
 */
export function buildBus(spec: VehicleSpec, color: number, m: MaterialLibrary): VehicleModel {
  const route = dice.int(0, BLINDS.length - 1);
  // The band stays white on the red fleet; on a pale bus (resold, repainted) it goes oxblood instead.
  const light = (0.3 * ((color >> 16) & 255) + 0.59 * ((color >> 8) & 255) + 0.11 * (color & 255)) / 255 > 0.6;
  const W = spec.width / 2;
  const r = spec.wheelRadius;
  const a = spec.wheelbase / 2;
  const ar = r + 0.08;
  const h = spec.length / 2 - 0.07;
  const belt = 1.42;
  const floor = 0.9;
  const sy = 1.32;
  const seats = [{ x: -0.72, y: sy, z: h - 1.05 }];
  for (const z of [3.1, 1.9, -1.5, -3.3]) seats.push({ x: -0.72, y: sy, z }, { x: 0.72, y: sy, z });
  const doors: [number, number][] = [
    [3.9, 4.92],
    [-1.0, 0.3],
  ];
  const leaf = (d0: number, d1: number): Pane[] => [
    { to: [d0 + 0.06, d0 + 0.06], kind: 'black' },
    { to: [(d0 + d1) / 2 - 0.03, (d0 + d1) / 2 - 0.03], kind: 'glass' },
    { to: [(d0 + d1) / 2 + 0.03, (d0 + d1) / 2 + 0.03], kind: 'black' },
    { to: [d1 - 0.06, d1 - 0.06], kind: 'glass' },
    { to: [d1, d1], kind: 'black' },
  ];
  const zA = -h + 0.5;
  const plan: CarPlan = {
    shell: {
      zr: -h,
      zf: h,
      plan: curve([[-h, W - 0.015], [h, W - 0.015]]),
      cornerR: [0.14, 0.09],
      cornerF: [0.14, 0.09],
      shoulder: curve([[-h, belt], [h - 1.0, belt], [h - 0.55, 1.27], [h, 1.26]]),
      lower: curve([[-h, 0.52], [-h + 0.6, 0.4], [h - 0.6, 0.4], [h, 0.52]]),
      waistDrop: 0.25,
      lean: 0,
      tuck: 0.015,
      rS: 0.03,
      arches: [
        { z: -a, y: r + 0.02, r: ar },
        { z: a, y: r + 0.02, r: ar },
      ],
      flare: 0,
      crown: 0,
      rearDeck: null,
      frontDeck: null,
      spacing: 1.2,
    },
    cabin: {
      rear: { zb: -h + 0.03, zt: -h + 0.16, bow: 0.03 },
      front: { zb: h - 0.03, zt: h - 0.22, bow: 0.06 },
      roof: curve([[-h + 0.16, 2.86], [-h + 0.9, 2.9], [h - 1.0, 2.9], [h - 0.22, 2.85]]),
      crown: 0.08,
      lean: 0.05,
      railR: 0.22,
      headerR: 0.25,
      band: 0.28,
      bulge: 0,
      split: 1.6,
      // Driver's side: one long run of windows, then the cab window.
      panes: [{ to: [zA, zA], kind: 'paint' }, ...bays(zA, 3.6, 6), { to: [h - 0.3, h - 0.37], kind: 'glass' }, { to: 'front', kind: 'paint' }],
      // Kerb side: the runs between the doors, with glazed door heads.
      panesLeft: [
        { to: [zA, zA], kind: 'paint' },
        ...bays(zA, doors[1][0], 3, 0.09, 'black'),
        ...leaf(doors[1][0], doors[1][1]).slice(1),
        ...bays(doors[1][1], doors[0][0], 3, 0.09, 'black'),
        ...leaf(doors[0][0], doors[0][1]).slice(1, -1),
        { to: [h - 0.3, h - 0.37], kind: 'paint' },
        { to: 'front', kind: 'paint' },
      ],
      frame: RUBBER,
      glass: SMOKED,
    },
    interior: { floor, z0: -h + 0.75, z1: h - 0.2, seats, dash: { z: h - 0.5, y: 1.2 }, cloth: tint(0x7a3a2e, 'cloth'), back: 0.5, headrests: false, vinyl: tint(0x3a3c3f, 'satin') },
    wheel: 'truck',
    rearWheel: 'dual',
    twin: spec.wheelCount === 6,
    rearTrack: 2 * (W - spec.wheelWidth / 2 - 0.06),
    rim: 0xd4d4cc,
    belly: 0.26,
    ageing: { dirt: [0.25, 0.6], fade: 0.25 },
    dress(k, shell, cab) {
      const F = new Face(k, shell, 'front');
      const R = new Face(k, shell, 'rear');
      const band = light ? tint(0x8a2a22, 'gloss') : tint(0xeae3cf, 'gloss');
      // One broad white band below the windows, nose to tail: the whole livery.
      shell.band(k, band, 1.04, 1.38, -h + 0.16, h - 0.95, [1, -1], 0.004, 1);
      // Panel joints along the skirt, engine louvres at the back.
      for (const z of [-3.6, -1.2, 0.5, 1.8, 3.7]) shell.vline(k, DARK, z, 0.42, 1.12, 0.008, [-1]);
      for (const z of [-3.6, 1.8]) shell.vline(k, DARK, z, 0.42, 1.12, 0.008, [1]);
      for (const y of [0.7, 0.78, 0.86, 0.94]) shell.hline(k, DARK, y, -h + 0.3, -h + 1.2, 0.035, [1, -1], 0.004);

      // Doors on the kerb side: dark leaves with long panes, a grab rail, and a step.
      for (const [d0, d1] of doors) {
        const mid = (d0 + d1) / 2;
        shell.band(k, BLACK, 0.44, shell.yS(mid) + 0.004, d0, d1, [1], 0.006, 1);
        for (const [s, e] of [
          [d0 + 0.09, mid - 0.05],
          [mid + 0.05, d1 - 0.09],
        ]) {
          const p = (z: number, y: number): V3 => [shell.F(z, y) + 0.012, y, z];
          k.poly(WINDOW, [p(s, 0.62), p(e, 0.62), p(e, shell.yS(mid) - 0.04), p(s, shell.yS(mid) - 0.04)], [0, 1, mid]);
        }
        k.box(GREY, 0.012, 0.9, 0.02, shell.F(mid, 1) + 0.02, 1.0, mid);
      }

      // Front: lamps, indicators, bumper, the blind in its box, a divided screen, wipers, mirrors.
      F.headlamps(0.86, 0.9, 0.32, 0.16, { twin: true, bezel: PLASTIC });
      cornerLens(k, shell, 'front', AMBER, 0.9, 0.14, 0.13);
      F.grille(0, 0.9, 0.9, 0.12, { bars: 3, surface: GREY, depth: 0.05 });
      const bumper = tint(0x2a2c2f, 'satin');
      for (const dir of [1, -1]) k.pad(bumper, 2 * W - 0.02, 0.2, 0.16, 0, 0.56, dir * (h + 0.02), 0.03, undefined, true);
      const hood = cab.screen(0, 1.0, 0);
      k.box(DARK, 1.72, 0.34, 0.06, 0, hood[1] + 0.26, hood[2] - 0.035, [-0.12, 0, 0]);
      const blind = m.sign(BLINDS[route], { bg: '#101010', fg: '#f6eaa6', style: 'neon', aspect: 5.8, border: false });
      k.board(blind, 1.6, 0.275, 0, hood[1] + 0.26, hood[2], 0, -0.12);
      k.beam(DARK, cab.screen(0, 0, 0.012), cab.screen(0, 1, 0.012), 0.05, 0.02);
      wipers(k, cab, { opposed: true, span: 0.5 });
      for (const s of [1, -1]) {
        const x = s * (W + 0.12);
        k.pipe(DARK, [[s * (W - 0.03), 2.3, h - 0.3], [x, 2.26, h - 0.17], [x, 2.2, h - 0.17]], 0.014, 5);
        k.box(DARK, 0.04, 0.36, 0.2, x, 2.04, h - 0.16);
        k.box(CHROME, 0.005, 0.32, 0.17, x, 2.04, h - 0.182);
      }

      // Rear: engine cover with louvres, tall lamp clusters.
      R.grille(0, 1.04, 1.5, 0.5, { bars: 7, surface: GREY, depth: 0.06, barDepth: 0.04 });
      R.taillamps(W - 0.24, 1.08, 0.16, 0.5, { upright: true });

      // Roof hatches.
      for (const z of [2.3, -2.3]) k.pad(band, 0.7, 0.05, 0.9, 0, cab.roofY(z) + 0.012, z, 0.02);
      // Operator's name on the cove panels above the windows.
      const name = m.sign('PLAINS TRANSIT', light ? { bg: '#8a2a22', fg: '#f1ead2', style: 'paint', aspect: 12, border: false } : { bg: '#e9e2cc', fg: '#2a3350', style: 'paint', aspect: 12, border: false });
      const top = cab.flank(0.4, 1, 0.006);
      k.board(name, 3.0, 0.2, top[0] - 0.002, top[1] + 0.14, 0.4, Math.PI / 2, -0.034);
      k.board(name, 3.0, 0.2, -(top[0] - 0.002), top[1] + 0.14, 0.4, -Math.PI / 2, -0.034);

      // Inside: rows of seats, wheel boxes, grab rails, the driver's binnacle.
      const cloth = tint(0x7a3a2e, 'cloth');
      const taken = new Set(seats.map((s) => `${Math.sign(s.x)}|${s.z}`));
      for (const z of [3.1, 2.5, 1.9, 1.3, 0.7, -0.3, -0.9, -1.5, -2.1, -3.3, -3.9]) {
        for (const s of [1, -1]) {
          if (taken.has(`${s}|${z}`)) continue;
          // Leave the doorways clear.
          if (s === 1 && doors.some(([d0, d1]) => z > d0 - 0.5 && z < d1 + 0.2)) continue;
          k.box(cloth, 0.86, 0.12, 0.44, s * 0.72, sy - 0.005, z + 0.06);
          k.box(cloth, 0.86, 0.5, 0.1, s * 0.72, sy + 0.3, z - 0.27, [-0.15, 0, 0]);
        }
      }
      const vinyl = tint(0x3a3c3f, 'satin');
      k.boxes(vinyl, 0.34, 0.24, 1.25, W - 0.24, floor + 0.12, a);
      k.boxes(vinyl, 0.66, 0.24, 1.25, W - 0.4, floor + 0.12, -a);
      for (const s of [1, -1]) k.tube(CHROME, [s * 0.42, 2.5, -h + 1.0], [s * 0.42, 2.5, h - 1.6], 0.014, 5);
      k.pad(vinyl, 0.7, 0.3, 0.3, -0.72, 1.12, h - 0.4, 0.04);
    },
  };
  return assemble(spec, color, m, `bus2|${light}|${route}`, plan, (k) => k.plates(h + 0.105, 0.56, -h - 0.105, 0.56)).model;
}
