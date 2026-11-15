import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { cabin, interior, Shell, type Cabin, type CabinDef, type InteriorDef, type ShellDef } from './body';
import { AMBER, AMBER_LENS, BRIGHT, CHROME, CLEAR_LENS, DARK, dice, FLUTE, Glaze, HEAD, Kit, LENS, mountWheels, PAINT, RED_GLASS, RUBBER, SHADE_BAND, TAIL, tint, type Pt, type Stance, type Surface, type Tint, type V3, type Wear, type WheelStyle } from './kit';

/**
 * Fittings shared by the four-wheelers (bumpers, lamp units, grilles, mirrors, handles, wipers…) and the
 * assembly line that turns a plan into a `VehicleModel` with a detailed and a distant version.
 */

const HOUSING = tint(0x2b0b09, 'gloss');
const RECESS = tint(0x060607, 'matte');
/** The clear outer moulding of a lamp cluster. */
const CLEAR_COVER = new Glaze(0.2, 0.06, 0xffd8d0);

/**
 * An end panel of the shell to set lamps and grilles into: the plane z = `z`, facing `dir` (+1 front,
 * −1 rear). Lamp units and grilles cut their own openings in the panel, so they sit in real recesses; on
 * the distant version they are flat slabs on its surface.
 */
export class Face {
  readonly z: number;
  readonly dir: 1 | -1;

  constructor(
    readonly k: Kit,
    readonly shell: Shell,
    readonly end: 'front' | 'rear',
  ) {
    this.z = end === 'front' ? shell.d.zf : shell.d.zr;
    this.dir = end === 'front' ? 1 : -1;
  }

  /** Box `depth` deep whose outer face stands `proud` of the plane (negative: set back into an opening). */
  box(surface: Surface, w: number, h: number, x: number, y: number, depth = 0.02, proud = 0.004): void {
    this.k.box(surface, w, h, depth, x, y, this.z + this.dir * (proud - depth / 2));
  }

  /** The same on both sides. */
  both(surface: Surface, w: number, h: number, x: number, y: number, depth = 0.02, proud = 0.004): void {
    this.box(surface, w, h, x, y, depth, proud);
    this.box(surface, w, h, -x, y, depth, proud);
  }

  /** Flat pane facing outwards, `proud` of the plane, whatever its size. */
  pane(surface: Surface, w: number, h: number, x: number, y: number, proud: number): void {
    const z = this.z + this.dir * proud;
    const pts: V3[] = [[x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z], [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z]];
    const pos = this.dir > 0 ? [...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]] : [...pts[0], ...pts[2], ...pts[1], ...pts[0], ...pts[3], ...pts[2]];
    this.k.tris(surface, pos, { flat: true });
  }

  /** Flat pane (a lamp lens) on both sides, `proud` of the plane. */
  lens(glaze: Glaze, w: number, h: number, x: number, y: number, proud: number): void {
    this.pane(glaze, w, h, x, y, proud);
    this.pane(glaze, w, h, -x, y, proud);
  }

  /** Surround of four bars round a w × h opening. */
  frame(surface: Surface, w: number, h: number, x: number, y: number, bar = 0.012, depth = 0.016, proud = 0.007): void {
    if (this.k.lo) return;
    this.box(surface, w + bar * 2, bar, x, y + h / 2 + bar / 2, depth, proud);
    this.box(surface, w + bar * 2, bar, x, y - h / 2 - bar / 2, depth, proud);
    this.box(surface, bar, h, x + w / 2 + bar / 2, y, depth, proud);
    this.box(surface, bar, h, x - w / 2 - bar / 2, y, depth, proud);
  }

  /** Lens over an opening with its moulded prisms: upright for a headlamp, level for a tail lamp. */
  private fluted(glaze: Glaze, w: number, h: number, x: number, y: number, upright: boolean): void {
    this.pane(glaze, w, h, x, y, 0.002);
    const span = upright ? w : h;
    const n = Math.max(2, Math.round(span / 0.026));
    for (let i = 1; i < n; i++) {
      const at = -span / 2 + (span * i) / n;
      if (upright) this.pane(FLUTE, 0.004, h - 0.012, x + at, y, 0.0035);
      else this.pane(FLUTE, w - 0.012, 0.004, x, y + at, 0.0035);
    }
  }

  /**
   * Headlamp pair. Each is a real unit: an opening in the panel whose walls are the bright reflector,
   * closing in on the lit lamp at the back, a bulb shield in front of that, and a fluted lens over the
   * mouth. `twin` makes each a pair of square sealed beams side by side.
   */
  headlamps(x: number, y: number, w: number, h: number, o: { twin?: boolean; bezel?: Tint | null; depth?: number } = {}): void {
    const depth = o.depth ?? 0.05;
    for (const s of [1, -1]) {
      if (this.k.lo) {
        this.pane(HEAD, w * 0.92, h * 0.88, s * x, y, 0.012);
        continue;
      }
      const gap = 0.018;
      const units: [number, number][] = o.twin
        ? [
            [x - (w + gap) / 4, (w - gap) / 2],
            [x + (w + gap) / 4, (w - gap) / 2],
          ]
        : [[x, w]];
      for (const [ux, uw] of units) {
        const tx = Math.min(uw * 0.17, 0.05);
        const ty = Math.min(h * 0.2, 0.035);
        this.shell.cut(this.end, { x: s * ux, y, w: uw, h, depth, wall: BRIGHT, taper: [tx, ty], chamfer: Math.min(0.012, h * 0.12) });
        this.box(HEAD, uw - 2 * tx, h - 2 * ty, s * ux, y, 0.004, -depth + 0.004);
        // The bulb's glass, standing out of the reflector.
        this.box(HEAD, Math.min(0.04, uw * 0.18), Math.min(0.03, h * 0.26), s * ux, y, 0.02, -depth + 0.022);
        this.fluted(LENS, uw - 0.004, h - 0.004, s * ux, y, true);
      }
      if (o.twin) this.box(o.bezel ?? DARK, gap + 0.004, h, s * x, y, 0.014, 0.005);
      if (o.bezel) this.frame(o.bezel, w, h, s * x, y);
    }
  }

  /** Round headlamp pair in bright rims: the same unit as `headlamps`, in an eight-sided opening. */
  roundLamps(x: number, y: number, r: number, depth = 0.06): void {
    for (const s of [1, -1]) {
      if (this.k.lo) {
        this.pane(HEAD, r * 1.7, r * 1.7, s * x, y, 0.012);
        continue;
      }
      this.shell.cut(this.end, { x: s * x, y, w: 2 * r, h: 2 * r, depth, wall: BRIGHT, taper: [r * 0.36, r * 0.36], chamfer: r * 0.586 });
      this.box(HEAD, r * 1.28, r * 1.28, s * x, y, 0.004, -depth + 0.004);
      this.box(HEAD, r * 0.3, r * 0.3, s * x, y, 0.02, -depth + 0.024);
      // Lens: a twelve-sided pane, and the rim round it.
      const z = this.z + this.dir * 0.003;
      const pane: V3[] = [];
      for (let i = 0; i < 12; i++) pane.push([s * x + r * 1.02 * Math.cos((i / 12) * Math.PI * 2), y + r * 1.02 * Math.sin((i / 12) * Math.PI * 2), z]);
      this.k.poly(LENS, pane, [s * x, y, z - this.dir]);
      for (const dx of [-0.34, 0, 0.34]) this.pane(FLUTE, 0.005, r * 1.7, s * x + dx * r, y, 0.004);
      this.k.tube(CHROME, [s * x, y, this.z - this.dir * 0.004], [s * x, y, this.z + this.dir * 0.016], r * 1.16, 14, false, r * 1.08, true);
    }
  }

  /**
   * Tail-lamp cluster pair, each a recessed housing: the lit tail / brake lamp outboard, then an amber
   * indicator, then a white reversing lamp inboard, with ribs between them and one fluted lens over the
   * lot. `upright` stacks them instead (lit at the top).
   */
  taillamps(x: number, y: number, w: number, h: number, o: { upright?: boolean; bezel?: Tint | null; reverse?: boolean; depth?: number } = {}): void {
    const depth = o.depth ?? 0.032;
    for (const s of [1, -1]) {
      if (this.k.lo) {
        this.pane(TAIL, w * 0.94, h * 0.94, s * x, y, 0.012);
        this.pane(RED_GLASS, w * 0.94, h * 0.94, s * x, y, 0.014);
        continue;
      }
      this.shell.cut(this.end, { x: s * x, y, w, h, depth, wall: HOUSING, taper: [0.006, 0.006], chamfer: 0.008 });
      this.box(HOUSING, w - 0.012, h - 0.012, s * x, y, 0.004, -depth + 0.002);
      // Lamps from the lit end to the other, as fractions of the housing's long side.
      const lamps: [Surface, number, Glaze][] = [[TAIL, o.reverse === false ? 0.6 : 0.48, RED_GLASS], [AMBER, o.reverse === false ? 0.4 : 0.28, AMBER_LENS]];
      if (o.reverse !== false) lamps.push([CLEAR_LENS, 0.24, LENS]);
      const long = (o.upright ? h : w) - 0.016;
      const short = (o.upright ? w : h) - 0.02;
      let at = long / 2;
      lamps.forEach(([surface, share, glaze], i) => {
        const size = long * share;
        const mid = at - size / 2;
        at -= size;
        const cx = o.upright ? s * x : s * (x + mid);
        const cy = o.upright ? y + mid : y;
        this.box(surface, (o.upright ? short : size) - 0.008, (o.upright ? size : short) - 0.008, cx, cy, 0.004, -depth + 0.007);
        // Each lamp's own coloured glass, behind the outer lens.
        this.pane(glaze, (o.upright ? short : size) + 0.004, (o.upright ? size : short) + 0.004, cx, cy, -0.004);
        // Rib between this lamp and the next.
        if (i < lamps.length - 1) {
          if (o.upright) this.box(HOUSING, short + 0.008, 0.006, s * x, y + at, depth - 0.008, -0.004);
          else this.box(HOUSING, 0.006, short + 0.008, s * (x + at), y, depth - 0.008, -0.004);
        }
      });
      this.fluted(CLEAR_COVER, w - 0.004, h - 0.004, s * x, y, false);
      if (o.bezel) this.frame(o.bezel, w, h, s * x, y);
    }
  }

  /**
   * Grille: an opening with a dark void behind and bars standing in it, set back from the panel.
   * `bars` across by default; `upright` adds that many uprights; `badge` a bright block in the middle.
   */
  grille(x: number, y: number, w: number, h: number, o: { bars?: number; upright?: number; surface?: Surface; depth?: number; badge?: [number, number] | null; frame?: Tint | null; barDepth?: number } = {}): void {
    if (this.k.lo) {
      this.pane(RECESS, w, h, x, y, 0.01);
      return;
    }
    const depth = o.depth ?? 0.06;
    const surface = o.surface ?? CHROME;
    this.shell.cut(this.end, { x, y, w, h, depth, wall: RECESS, taper: [0.004, 0.004] });
    this.box(RECESS, w - 0.008, h - 0.008, x, y, 0.004, -depth + 0.002);
    const bars = o.bars ?? 4;
    const bd = o.barDepth ?? 0.022;
    for (let i = 0; i < bars; i++) {
      const by = y - h / 2 + (h * (i + 0.5)) / bars;
      this.box(surface, w - 0.006, Math.min(0.012, (h / bars) * 0.42), x, by, bd, -0.006);
    }
    for (let i = 0; i < (o.upright ?? 0); i++) {
      const bx = x - w / 2 + (w * (i + 1)) / ((o.upright ?? 0) + 1);
      this.box(surface, 0.01, h - 0.006, bx, y, bd - 0.006, -0.009);
    }
    if (o.badge) this.box(CHROME, o.badge[0], o.badge[1], x, y, 0.016, 0.002);
    if (o.frame) this.frame(o.frame, w, h, x, y, 0.01, 0.014, 0.006);
  }
}

/**
 * Lamp or reflector wrapped round the corner of the body on both sides: a coloured lens following the
 * skin from `length` back up to the end panel, under a film of glass.
 */
export function cornerLens(k: Kit, shell: Shell, end: 'front' | 'rear', surface: Tint, y: number, h: number, length: number): void {
  if (k.lo) return;
  const edge = end === 'front' ? shell.d.zf : shell.d.zr;
  const dir = end === 'front' ? 1 : -1;
  const z0 = edge - dir * length;
  const z1 = edge - dir * 0.006;
  shell.band(k, DARK, y - h / 2 - 0.006, y + h / 2 + 0.006, z0 - dir * 0.006, z1, [1, -1], 0.003, 1, 0.022);
  shell.band(k, surface, y - h / 2, y + h / 2, z0, z1, [1, -1], 0.006, 2, 0.022);
  // The lens's moulded ribs.
  for (const f of [-0.25, 0, 0.25]) shell.hline(k, tint(surface.hex, 'satin'), y + f * h, z0 + dir * 0.008, z1, 0.004, [1, -1], 0.0075);
}

/** Bumper (or any moulding) wrapped round an end of the shell. `section` is [outward, up] about height `y`. */
export function bumper(k: Kit, shell: Shell, end: 'front' | 'rear', surface: Surface, section: Pt[], o: { zStart: number; y: number; off?: number; bow?: number; closed?: boolean }): void {
  k.sweep(surface, shell.wrap(end, o.zStart, o.y, o.off ?? 0, o.bow ?? 0), section, { out: [0, o.y, shell.mid], mirror: true, caps: 'start', closed: o.closed, cast: surface === PAINT });
}

/** Door mirrors on both sides: a housing on a foot at the base of the A-pillar, with the glass facing aft. */
export function mirrors(k: Kit, shell: Shell, z: number, y: number, surface: Surface, w = 0.14, h = 0.1): void {
  for (const s of [1, -1]) {
    const x = shell.F(z, y - 0.05) + 0.004 + w / 2;
    k.pad(surface, w, h, 0.075, s * x, y, z, 0.026, [0, -s * 0.12, 0]);
    k.box(CHROME, w - 0.04, h - 0.032, 0.004, s * x, y, z - 0.0385, [0, -s * 0.12, 0]);
    k.box(surface === PAINT ? DARK : surface, 0.05, 0.03, 0.06, s * (x - w / 2 + 0.005), y - h / 2 + 0.01, z);
  }
}

/** Door handles at each z, on both flanks: a dark recess with the pull standing in it. */
export function handles(k: Kit, shell: Shell, zs: number[], y: number, surface: Surface, flush = false): void {
  for (const z of zs) {
    for (const s of [1, -1]) {
      const x = shell.F(z, y);
      if (flush) {
        k.box(DARK, 0.006, 0.05, 0.13, s * (x + 0.002), y, z);
        k.box(surface, 0.012, 0.022, 0.12, s * (x + 0.004), y + 0.012, z);
      } else {
        k.box(DARK, 0.006, 0.045, 0.15, s * (x + 0.002), y, z);
        k.pad(surface, 0.022, 0.024, 0.13, s * (x + 0.013), y + 0.004, z, 0.008);
        // Lock barrel under the pull.
        k.drum(CHROME, 0.009, 0.006, s * (x + 0.004), y - 0.045, z - 0.03, 'x', 6);
      }
    }
  }
}

/** A pair of wipers parked across the bottom of the windscreen, and the scuttle they sit on. */
export function wipers(k: Kit, cab: Cabin, o: { opposed?: boolean; span?: number } = {}): void {
  const span = o.span ?? 0.52;
  for (const [u0, dir] of o.opposed
    ? [
        [-0.72, 1],
        [0.72, -1],
      ]
    : [
        [-0.55, 1],
        [0.2, 1],
      ]) {
    const a = cab.screen(u0, 0.02, 0.012);
    const b = cab.screen(u0 + dir * span, 0.1, 0.014);
    k.beam(DARK, a, b, 0.012, 0.01);
    k.beam(DARK, cab.screen(u0 + dir * span * 0.25, 0.045, 0.02), cab.screen(u0 + dir * span * 1.0, 0.115, 0.012), 0.02, 0.006);
    // Spindle boss on the scuttle.
    k.tube(DARK, cab.screen(u0, 0.0, 0.002), a, 0.011, 5);
  }
}

/** Dark strip along the base of the windscreen that the wipers park on. */
export function scuttle(k: Kit, cab: Cabin, width = 0.07): void {
  const pts: V3[] = [];
  for (let i = -8; i <= 8; i++) {
    const p = cab.screen(i / 8, 0, 0.004);
    pts.push([p[0], p[1] + 0.004, p[2] + width * 0.35]);
  }
  k.ribbon(DARK, pts, [0, 0, 1], width, [0, -3, 0]);
}

/** The tinted band across the top of the windscreen. */
export function shadeBand(k: Kit, cab: Cabin, depth = 0.16): void {
  if (k.lo) return;
  const rows: V3[][] = [];
  for (let i = -6; i <= 6; i++) rows.push([cab.screen(i / 6, 1 - depth, 0.003), cab.screen(i / 6, 0.995, 0.003)]);
  k.grid(SHADE_BAND, rows, { out: [0, 0.6, (cab.front.zb + cab.front.zt) / 2 - 0.6] });
}

/** Radio aerial. */
export function aerial(k: Kit, x: number, y: number, z: number, height = 0.75, rake = 0.18): void {
  k.tube(DARK, [x, y, z], [x, y + 0.03, z], 0.012, 6);
  k.tube(CHROME, [x, y + 0.02, z], [x, y + height, z - height * rake], 0.004, 4, false, 0.002);
}

/** Tail pipe poking out under the rear. */
export function exhaust(k: Kit, x: number, y: number, z: number, radius = 0.026, length = 0.22, surface: Surface = CHROME): void {
  k.tube(surface, [x, y + 0.01, z + length], [x, y, z], radius, 8, false, radius, true);
  k.drum(DARK, radius - 0.004, 0.002, x, y, z + 0.004, 'z', 8);
}

/** Fuel filler flap: a shut line round a small door on one flank. */
export function fuelFlap(k: Kit, shell: Shell, z: number, y: number, side = 1, w = 0.15, h = 0.13): void {
  shell.vline(k, DARK, z - w / 2, y - h / 2, y + h / 2, 0.007, [side]);
  shell.vline(k, DARK, z + w / 2, y - h / 2, y + h / 2, 0.007, [side]);
  shell.hline(k, DARK, y - h / 2, z - w / 2, z + w / 2, 0.007, [side]);
  shell.hline(k, DARK, y + h / 2, z - w / 2, z + w / 2, 0.007, [side]);
}

/** Mud flaps behind a pair of wheels. */
export function mudflaps(k: Kit, x: number, z: number, top: number, w = 0.22, bottom = 0.12): void {
  k.boxes(RUBBER, w, top - bottom, 0.012, x, (top + bottom) / 2, z);
}

/** Tow bar: a tongue out from under the tail with the ball on it, and the socket for the trailer's lights. */
export function towbar(k: Kit, z: number, y: number): void {
  k.box(DARK, 0.06, 0.045, 0.3, 0, y, z + 0.09);
  k.tube(BRIGHT, [0, y + 0.02, z - 0.03], [0, y + 0.05, z - 0.03], 0.011, 6);
  k.ball(BRIGHT, 0.025, 0, y + 0.068, z - 0.03, 1, 1, 8);
  k.box(DARK, 0.04, 0.04, 0.03, 0.09, y + 0.01, z + 0.02);
}

/** Roof rack: two rails on feet with `bars` cross-bars, between z0 and z1 at half-width `x` on a roof `y` high. */
export function roofRack(k: Kit, x: number, y: number, z0: number, z1: number, bars = 4, surface: Tint = CHROME): void {
  for (const s of [1, -1]) {
    k.tube(surface, [s * x, y + 0.035, z0], [s * x, y + 0.035, z1], 0.013, 6);
    for (const t of [0.04, 0.5, 0.96]) k.box(DARK, 0.04, 0.05, 0.07, s * x, y + 0.008, z0 + (z1 - z0) * t);
  }
  for (let i = 0; i < bars; i++) k.box(surface, 2 * x, 0.012, 0.035, 0, y + 0.04, z0 + ((z1 - z0) * (i + 0.5)) / bars);
}

// ───────────────────────────── Weathering ─────────────────────────────

/** How weathered a kind of vehicle tends to be: ranges for film and dust, chances of faded lacquer and of rust. */
export interface Ageing {
  dirt: [number, number];
  dust?: [number, number];
  fade?: number;
  rust?: number;
}

/** A car somebody washes on a Sunday. */
export const CHERISHED: Ageing = { dirt: [0, 0.3] };
/** Ordinary transport: some film, the odd tired one. */
export const EVERYDAY: Ageing = { dirt: [0.12, 0.6], fade: 0.2, rust: 0.15 };
/** Fifteen years old and it shows. */
export const TIRED: Ageing = { dirt: [0.2, 0.75], fade: 0.45, rust: 0.4 };
/** Lives on gravel roads. */
export const FARM: Ageing = { dirt: [0.3, 0.8], dust: [0.3, 1], fade: 0.35, rust: 0.45 };

/** Roll one vehicle's weathering. */
export function weather(a: Ageing): Wear {
  return {
    dirt: dice.range(a.dirt[0], a.dirt[1]),
    dust: a.dust ? dice.range(a.dust[0], a.dust[1]) : 0,
    fade: dice.chance(a.fade ?? 0) ? dice.range(0.45, 1) : 0,
    rust: dice.chance(a.rust ?? 0) ? dice.range(0.4, 1) : 0,
  };
}

export const stanceOf = (spec: VehicleSpec): Stance => ({ axle: spec.wheelbase / 2, radius: spec.wheelRadius, half: spec.width / 2, tail: spec.length / 2 });

// ───────────────────────────── Assembly ─────────────────────────────

export interface CarPlan {
  shell: ShellDef;
  cabin: CabinDef;
  interior: InteriorDef;
  wheel: WheelStyle;
  rearWheel?: WheelStyle;
  rim?: number;
  /** Twin rear wheels, and the track of the outer pair. */
  twin?: boolean;
  rearTrack?: number;
  /** Pan under the floor (off where a chassis shows instead) and how low the belly between the axles hangs. */
  pan?: boolean;
  belly?: number;
  /** How this kind of vehicle ages (default: everyday). */
  ageing?: Ageing;
  /** Everything else that is the same on every vehicle of this kind. */
  dress(k: Kit, shell: Shell, cab: Cabin): void;
}

export interface Built {
  k: Kit;
  shell: Shell;
  model: VehicleModel;
}

/**
 * How far below a seat position the seated figure reaches: the driving pose sits as on a chair, shins
 * upright, with its soles this far under the seat position. A car's floor is nothing like that deep (in
 * the low ones the soles are under the road), and the seats cannot rise without putting heads through
 * the roof, so the floor gets a footwell: a dark pan dropped under the front seats' leg room, deep enough
 * to hold the shins. From outside it reads as the floor pan and cross-member between the sills. If the
 * pose ever stretches its legs out, shrink this and the footwells go.
 */
const FOOT_DROP = 0.4;

function footwell(k: Kit, plan: CarPlan, shell: Shell): void {
  if (k.lo) return;
  const front = plan.interior.seats.filter((s) => Math.abs(s.z - plan.interior.seats[0].z) < 0.1);
  const top = plan.interior.floor + 0.004;
  // Down to the soles, or to the road where the soles are under it.
  const bottom = Math.max(-0.015, Math.min(...front.map((s) => s.y)) - FOOT_DROP - 0.03);
  if (bottom > top - 0.04) return;
  const z0 = front[0].z + 0.04;
  // The driving pose stretches its feet a good metre ahead of the seat: stop short of the front arch.
  const arch = plan.shell.arches.find((a) => a.z > front[0].z);
  const z1 = Math.min(front[0].z + 1.06, arch ? arch.z - arch.r - 0.05 : Infinity);
  const drop = Math.min(0.12, (top - bottom) * 0.8);
  // As wide as the floor between the sills: the pose lets its knees fall outwards.
  const x = Math.min(shell.F(z0, plan.shell.lower(z0)), shell.F(z1, plan.shell.lower(z1))) - 0.075;
  // A shallow trough: sloping toe-board ahead, sloping heel-board behind.
  const profile: [number, number][] = [[z0, top], [z0 + drop * 0.25, bottom], [z1 - drop, bottom], [z1, top]];
  k.grid(
    DARK,
    profile.map(([z, y]): V3[] => [
      [-x, y, z],
      [x, y, z],
    ]),
    { out: [0, top + 1, (z0 + z1) / 2], flat: true },
  );
  for (const s of [1, -1]) {
    k.poly(
      DARK,
      profile.map(([z, y]): V3 => [s * x, y, z]),
      [0, top, (z0 + z1) / 2],
    );
  }
}

/**
 * Build a four-wheeler from a plan: the detailed version and, from the same plan, the distant one. The
 * geometry is cached under `key` (make it distinct for every variant that differs in shape); `extras`
 * then adds what is this vehicle's own (plates, options) to each version.
 */
export function assemble(spec: VehicleSpec, color: number, m: MaterialLibrary, key: string, plan: CarPlan, extras?: (k: Kit, shell: Shell) => void): Built {
  const k = new Kit(m, color, undefined, false, weather(plan.ageing ?? EVERYDAY), stanceOf(spec));
  const far = new Kit(m, color, k.paint, true);
  const construct = (c: Kit, shell: Shell) => {
    const cab = cabin(c, shell, plan.cabin);
    interior(c, shell, plan.interior, cab);
    footwell(c, plan, shell);
    plan.dress(c, shell, cab);
    // Last, because lamps and grilles cut their openings in the end panels.
    shell.build(c);
    shell.underbody(c, spec.track, spec.wheelWidth, { pan: plan.pan, belly: plan.belly });
  };
  const shell = new Shell(plan.shell);
  k.cached(key, (c) => construct(c, shell));
  extras?.(k, shell);
  const distant = new Shell(plan.shell, true);
  far.cached(key, (c) => construct(c, distant));
  extras?.(far, distant);
  const wheels = mountWheels(k, { radius: spec.wheelRadius, width: spec.wheelWidth, wheelbase: spec.wheelbase, track: spec.track, rearTrack: plan.rearTrack, front: plan.wheel, rear: plan.rearWheel, rim: plan.rim, twin: plan.twin }, far);
  const model: VehicleModel = {
    group: k.finish(far),
    wheels,
    seats: plan.interior.seats.slice(0, spec.seats).map((s) => ({ x: s.x, y: s.y, z: s.z })),
    headlights: k.headlights,
    taillights: k.taillights,
    bodyMaterial: k.paint,
  };
  return { k, shell, model };
}
