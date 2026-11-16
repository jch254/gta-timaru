import * as THREE from 'three';
import { add3, BRIGHT, clamp01, cross3, DARK, dot3, Kit, len3, mix, mix3, norm3, PAINT, smooth, sub3, tint, WINDOW, type Fn, type Glaze, type Pt, type Surface, type Tint, type V3 } from './kit';

/**
 * Body surfacing shared by every four-wheeled vehicle.
 *
 * `Shell` is the lower body: a skin lofted through cross-sections along the vehicle, with a plan shape
 * that tapers and rounds at the ends, a radiused shoulder, a barrelled flank that leans in above the waist
 * line, tucks under and rolls round the sill, wheel arches cut into it (with a rolled lip and a flare),
 * crowned bonnet / boot decks that roll over into the nose and tail, and end panels with real openings
 * cut in them for lamps and grilles. It also answers "where is the surface here?" so trim can be laid on
 * it. Built with `lo` it is the same shape through a quarter of the points, for the distant version.
 *
 * `cabin()` builds the glasshouse on top: pillars, roof and glazing as one lattice with tumblehome, a
 * crowned roof, radiused cant rails and bowed screens; window surrounds; and an inner lining so the far
 * side reads properly through the glass.
 *
 * `interior()` furnishes it: floor, door cards, dashboard, steering wheel on the right, seats.
 */

export interface Arch {
  z: number;
  y: number;
  r: number;
}

export interface ShellDef {
  /** Tail and nose of the shell (bumpers are extra). */
  zr: number;
  zf: number;
  /** Half-width at the waist line by z, before the plan corners. */
  plan: Fn;
  /** Plan corner at each end: [length along the car, depth across it]. */
  cornerR: Pt;
  cornerF: Pt;
  /** Height of the top of the flank (wing top / belt line) by z. */
  shoulder: Fn;
  /** Height of the lower edge (sills and valances) by z, ignoring the arches. */
  lower: Fn;
  /** The waist (swage) line runs this far below the shoulder. */
  waistDrop: number;
  /** Inward slope of the flank above the waist (metres per metre). */
  lean: number;
  /** How far the flank tucks under at the sill. */
  tuck: number;
  /** Shoulder radius. */
  rS: number;
  arches: Arch[];
  /** How far the guards swell around the arches. */
  flare?: number;
  /** Deck crown: how much higher the centre line is than the shoulder. */
  crown: number | Fn;
  /** Extra height on the decks (a bonnet bulge): must be zero at the shoulder. */
  hump?: (z: number, x: number) => number;
  /** z-ranges of the boot deck and the bonnet, or null where the cabin (or a tray) runs to the end. */
  rearDeck: [number, number] | null;
  frontDeck: [number, number] | null;
  /** How far the cabin end of each deck bows to follow the base of the screen: [boot, bonnet]. */
  deckBow?: [number, number];
  /** Leave an end open (no cap): 0 = rear, 1 = front. */
  open?: [boolean, boolean];
  /** Extra cross-sections wanted at these z. */
  stations?: number[];
  /** Largest gap between cross-sections. */
  spacing?: number;
  /** Convex belly of the flank between sill and shoulder, metres at mid-height (default 0.014). */
  barrel?: number;
  /** Radius of the roll under the sill (default 0.035). */
  sillR?: number;
  /** Radius with which a deck rolls over into the tail and the nose: [rear, front] (default 0.035). */
  roll?: [number, number];
}

/** An opening in an end panel (a lamp recess, a grille). */
export interface Cut {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** What the walls are made of (default: body paint). */
  wall?: Surface;
  /** How much smaller the back of the recess is than its mouth, each side: [across, up]. */
  taper?: [number, number];
  /** Cut the corners off by this much. */
  chamfer?: number;
}

const LIP = 0.035;
const DECK_U = [0, 0.24, 0.46, 0.66, 0.82, 0.93, 1];
const DECK_U_LO = [0, 0.62, 1];
const rad = (deg: number) => (deg * Math.PI) / 180;

export class Shell {
  readonly stations: number[];
  readonly mid: number;
  /** Radius of the roll-over at the tail and the nose (0 where the glasshouse runs to the end). */
  private roll: [number, number];
  private cuts: Cut[][] = [[], []];
  private deckU: number[];

  constructor(
    readonly d: ShellDef,
    readonly lo = false,
  ) {
    this.mid = (d.zr + d.zf) / 2;
    this.deckU = lo ? DECK_U_LO : DECK_U;
    // (The distant version has too few cross-sections to turn the corner: its decks end square.)
    this.roll = lo ? [0, 0] : [d.rearDeck && Math.abs(d.rearDeck[0] - d.zr) < 1e-6 ? (d.roll?.[0] ?? 0.035) : 0, d.frontDeck && Math.abs(d.frontDeck[1] - d.zf) < 1e-6 ? (d.roll?.[1] ?? 0.035) : 0];
    const zs: number[] = [...(d.stations ?? [])];
    for (const deg of lo ? [0, 45, 90] : [0, 22.5, 45, 67.5, 90]) {
      const s = Math.sin(rad(deg));
      zs.push(d.zf - d.cornerF[0] * (1 - s), d.zr + d.cornerR[0] * (1 - s));
    }
    if (!lo) {
      for (const deg of [0, 35, 65]) {
        const s = Math.sin(rad(deg));
        if (this.roll[1]) zs.push(d.zf - this.roll[1] * (1 - s));
        if (this.roll[0]) zs.push(d.zr + this.roll[0] * (1 - s));
      }
    }
    for (const a of d.arches) {
      const n = lo ? 4 : 10;
      for (let i = 0; i <= n; i++) {
        const z = a.z + a.r * Math.cos((Math.PI * i) / n);
        if (i === 0 || i === n) {
          // Either side of the arch's edge, so the cut is square where it meets the sill.
          const s = i === 0 ? 1 : -1;
          zs.push(z - s * 0.003, z + s * 0.003);
        } else zs.push(z);
      }
    }
    for (const zone of [d.rearDeck, d.frontDeck]) if (zone) zs.push(zone[0], zone[1]);
    const sorted = [...new Set(zs.filter((z) => z >= d.zr - 1e-6 && z <= d.zf + 1e-6).map((z) => Math.round(z * 10000) / 10000))].sort((p, q) => p - q);
    const out: number[] = [];
    const gap = lo ? Math.max(0.95, d.spacing ?? 0) : (d.spacing ?? 0.32);
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const span = sorted[i] - sorted[i - 1];
        const extra = Math.ceil(span / gap) - 1;
        for (let k = 1; k <= extra; k++) out.push(sorted[i - 1] + (span * k) / (extra + 1));
      }
      out.push(sorted[i]);
    }
    this.stations = out;
  }

  /** Half-width at the waist, plan corners included. */
  P(z: number): number {
    const d = this.d;
    let x = d.plan(z);
    const qr = clamp01((d.zr + d.cornerR[0] - z) / (d.cornerR[0] || 1));
    if (qr > 0) x -= d.cornerR[1] * (1 - Math.sqrt(1 - qr * qr));
    const qf = clamp01((z - (d.zf - d.cornerF[0])) / (d.cornerF[0] || 1));
    if (qf > 0) x -= d.cornerF[1] * (1 - Math.sqrt(1 - qf * qf));
    return x;
  }

  /** Height of the top of the flank at z: the shoulder line, rolling over at the ends of the decks. */
  yS(z: number): number {
    const d = this.d;
    let y = d.shoulder(z);
    const [rr, rf] = this.roll;
    if (rf > 0) {
      const q = clamp01((z - (d.zf - rf)) / rf);
      if (q > 0) y -= rf * (1 - Math.sqrt(1 - q * q));
    }
    if (rr > 0) {
      const q = clamp01((d.zr + rr - z) / rr);
      if (q > 0) y -= rr * (1 - Math.sqrt(1 - q * q));
    }
    return y;
  }

  /** Top of the arch cut at z (−∞ outside any arch). */
  private archTop(z: number): number {
    let top = -Infinity;
    for (const a of this.d.arches) {
      const dz = Math.abs(z - a.z);
      if (dz < a.r) top = Math.max(top, a.y + Math.sqrt(a.r * a.r - dz * dz));
    }
    return top;
  }

  inArch(z: number): boolean {
    return this.d.arches.some((a) => Math.abs(z - a.z) < a.r - 0.001);
  }

  /** Lower edge of the flank at z, arches included. */
  yL(z: number): number {
    return Math.max(this.d.lower(z), this.archTop(z));
  }

  /** Waist line: below the shoulder, but always clear of the arch tops. */
  yW(z: number): number {
    const ys = this.yS(z);
    return Math.min(ys - this.d.rS - 0.012, Math.max(ys - this.d.waistDrop, this.archTop(z) + 0.035));
  }

  /** Half-width of the outer skin at height y. */
  F(z: number, y: number): number {
    const d = this.d;
    const yw = this.yW(z);
    let x = this.P(z);
    if (y > yw) x -= d.lean * (y - yw);
    else {
      const t = clamp01((yw - y) / Math.max(0.08, yw - d.lower(z)));
      x -= d.tuck * t * t;
    }
    // A slight barrel from sill to shoulder, so reflections bend along the flank instead of lying flat.
    const lowest = d.lower(z);
    const tb = clamp01((y - lowest) / Math.max(0.2, this.yS(z) - lowest));
    x += (d.barrel ?? 0.014) * 4 * tb * (1 - tb);
    const flare = d.flare ?? 0.014;
    for (const a of d.arches) {
      const dz = z - a.z;
      const dy = y - a.y;
      const dist = (dy > 0 ? Math.hypot(dz, dy) : Math.abs(dz)) - a.r;
      if (dist < 0.09) {
        const f = 1 - Math.max(0, dist) / 0.09;
        x += flare * f * f;
      }
    }
    return x;
  }

  /** Inboard end of the shoulder radius: where decks and glass begin. */
  sx(z: number): number {
    return this.F(z, this.yS(z) - this.d.rS) - this.d.rS;
  }

  crown(z: number): number {
    return typeof this.d.crown === 'number' ? this.d.crown : this.d.crown(z);
  }

  /** Height of the deck surface (bonnet, boot) at z, x. */
  deckY(z: number, x: number): number {
    const u = clamp01(Math.abs(x) / this.sx(z));
    return this.yS(z) + this.crown(z) * (1 - u * u) + (this.d.hump ? this.d.hump(z, Math.abs(x)) : 0);
  }

  /** Top surface under a glasshouse base: the deck where there is one, the belt line elsewhere. */
  topY(z: number, x: number): number {
    const d = this.d;
    const inDeck = (zone: [number, number] | null) => zone !== null && z >= zone[0] - 0.02 && z <= zone[1] + 0.02;
    return inDeck(d.rearDeck) || inDeck(d.frontDeck) ? this.deckY(z, x) : this.yS(z);
  }

  /**
   * Flank cross-section at z on the +x side, shoulder first: the shoulder radius, the flank, the roll
   * under the sill (or the tight roll of an arch lip), and last the return flange.
   */
  section(z: number): V3[] {
    const d = this.d;
    const lo = this.lo;
    const ys = this.yS(z);
    const r = d.rS;
    const cx = this.F(z, ys - r);
    const out: V3[] = [];
    for (const deg of lo ? [90, 0] : [90, 60, 30, 0]) {
      const t = rad(deg);
      out.push([cx - r + r * Math.cos(t), ys - r + r * Math.sin(t), z]);
    }
    const yw = this.yW(z);
    const yl = this.yL(z);
    const arch = yl > d.lower(z) + 1e-6;
    const rs = lo ? 0 : arch ? 0.014 : Math.min(d.sillR ?? 0.035, (yw - yl) * 0.45);
    const yb = yl + rs;
    for (const f of lo ? [1] : [0.5, 1]) {
      const y = mix(ys - r, yw, f);
      out.push([this.F(z, y), y, z]);
    }
    for (const f of lo ? [0.5, 1] : [0.22, 0.44, 0.66, 0.85, 1]) {
      const y = mix(yw, yb, f);
      out.push([this.F(z, y), y, z]);
    }
    if (!lo) {
      const xb = this.F(z, yb);
      for (const deg of [35, 70, 90]) out.push([xb - rs + rs * Math.cos(rad(deg)), yb - rs * Math.sin(rad(deg)), z]);
    }
    const last = out[out.length - 1];
    out.push([last[0] - LIP, last[1], z]);
    return out;
  }

  /** Inner edge of the return flange at z: where liners and the floor pan meet the skin. */
  private lipX(z: number): number {
    const s = this.section(z);
    return s[s.length - 1][0];
  }

  /** Point on the +x flank, `lift` proud of the skin. */
  side(z: number, y: number, lift = 0.003): V3 {
    return [this.F(z, y) + lift, y, z];
  }

  /** Point on a deck, `lift` above it. */
  top(z: number, x: number, lift = 0.003): V3 {
    return [x, this.deckY(z, x) + lift, z];
  }

  /**
   * Cut an opening in the tail (`rear`) or nose (`front`) panel: the panel is built round it and its walls
   * run `depth` back into the body. Whoever cuts it fills it (see `Face` in parts.ts). Call before `build`;
   * the distant version ignores cuts.
   */
  cut(end: 'front' | 'rear', c: Cut): void {
    if (!this.lo) this.cuts[end === 'front' ? 1 : 0].push(c);
  }

  /** The painted skin: flanks, decks and end panels. Call after everything that cuts openings. */
  build(k: Kit): void {
    const d = this.d;
    const ref: V3 = [0, 0.45, this.mid];
    const U = this.deckU;
    k.grid(
      PAINT,
      this.stations.map((z) => this.section(z)),
      { out: ref, mirror: true, group: 'body' },
    );
    [d.rearDeck, d.frontDeck].forEach((zone, end) => {
      if (!zone) return;
      // The cabin end of a deck bows with the base of the screen it runs under.
      const bow = d.deckBow?.[end] ?? 0;
      const shift = (z: number, u: number) => (end === 0 ? -bow * smooth(zone[1] - 0.45, zone[1], z) : bow * smooth(zone[0] + 0.45, zone[0], z)) * (1 - u * u);
      const rows = this.stations
        .filter((z) => z >= zone[0] - 1e-6 && z <= zone[1] + 1e-6)
        .map((z) =>
          U.map((u): V3 => {
            const zz = z + shift(z, u);
            return [u * this.sx(z), this.deckY(zz, u * this.sx(zz)), zz];
          }),
        );
      k.grid(PAINT, rows, { out: [0, -2, this.mid], mirror: true, group: 'body' });
    });
    [d.zr, d.zf].forEach((z, end) => {
      if (!d.open?.[end]) this.panel(k, z, end);
    });
  }

  /** An end panel: the outline of the last cross-section filled in, less the openings cut in it. */
  private panel(k: Kit, z: number, end: number): void {
    const d = this.d;
    const dir = end === 0 ? -1 : 1;
    const zone = end === 0 ? d.rearDeck : d.frontDeck;
    const decked = zone !== null && Math.abs((end === 0 ? zone[0] : zone[1]) - z) < 1e-6;
    // Right half of the outline, from the top (the centre line if there is a deck) round to the sill.
    const right: V3[] = [];
    if (decked) for (const u of this.deckU.slice(0, -1)) right.push([u * this.sx(z), this.deckY(z, u * this.sx(z)), z]);
    right.push(...this.section(z).slice(0, -1));
    const outline: V3[] = [...right];
    for (let i = right.length - 1; i >= (decked ? 1 : 0); i--) outline.push([-right[i][0], right[i][1], z]);
    const holes: V3[][] = [];
    for (const c of this.cuts[end]) {
      const hw = c.w / 2;
      const hh = c.h / 2;
      const ch = Math.min(c.chamfer ?? 0, hw * 0.45, hh * 0.45);
      const ring = (sx: number, sy: number, zz: number): V3[] => {
        const w = hw - sx;
        const h = hh - sy;
        const corners: [number, number][] = ch > 0 ? [[w - ch, -h], [w, -h + ch], [w, h - ch], [w - ch, h], [-w + ch, h], [-w, h - ch], [-w, -h + ch], [-w + ch, -h]] : [[w, -h], [w, h], [-w, h], [-w, -h]];
        return corners.map(([a, b]): V3 => [c.x + a, c.y + b, zz]);
      };
      const mouth = ring(0, 0, z);
      for (const p of mouth) {
        if (inside2(p, outline)) continue;
        const ys = outline.map((q) => q[1]);
        const room = `the panel is ±${this.F(z, p[1]).toFixed(3)} wide there and runs from y ${Math.min(...ys).toFixed(3)} to ${Math.max(...ys).toFixed(3)}`;
        throw new Error(`Opening at x ${c.x}, y ${c.y} (${c.w} by ${c.h}) does not fit the ${end ? 'nose' : 'tail'} panel: corner ${p[0].toFixed(3)}, ${p[1].toFixed(3)}; ${room}`);
      }
      holes.push(mouth);
      const back = ring(c.taper?.[0] ?? 0, c.taper?.[1] ?? 0, z - dir * c.depth);
      const centre: V3 = [c.x, c.y, z - dir * c.depth * 0.5];
      for (let i = 0; i < mouth.length; i++) {
        const j = (i + 1) % mouth.length;
        const midpoint = mix3(mix3(mouth[i], mouth[j], 0.5), mix3(back[i], back[j], 0.5), 0.5);
        k.poly(c.wall ?? PAINT, [mouth[i], mouth[j], back[j], back[i]], add3(midpoint, sub3(midpoint, centre), 4));
      }
    }
    const flat = (pts: V3[]) => pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const all = [...outline, ...holes.flat()];
    const pos: number[] = [];
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flat(outline), holes.map(flat))) {
      const A = all[a];
      const B = all[b];
      const C = all[c];
      // Wind each triangle to face out of the car.
      const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (nz * dir >= 0) pos.push(...A, ...B, ...C);
      else pos.push(...A, ...C, ...B);
    }
    k.tris(PAINT, pos, { group: 'body' });
  }

  /**
   * What you see through the arches and under the sills: a liner in each arch (one-sided, so it never
   * shows inside the cabin), a block between each pair of wheels, a floor pan and, between the axles, a
   * `belly` hanging lower (exhaust, tank, tunnel). All matt black.
   */
  underbody(k: Kit, track: number, wheelWidth: number, o: { pan?: boolean; belly?: number } = {}): void {
    const d = this.d;
    for (const a of d.arches) {
      const xo = this.lipX(a.z) + 0.006;
      const xi = Math.max(0.05, track / 2 - wheelWidth / 2 - 0.07);
      const r = a.r + 0.006;
      if (k.lo) {
        // From a distance: one dark block filling the pair of arches behind the wheels.
        const low = Math.max(0.12, d.lower(a.z) - 0.08);
        k.box(DARK, xi * 2, a.y + r - low, Math.min(2 * r, 2 * Math.min(d.zf - a.z, a.z - d.zr)), 0, (a.y + r + low) / 2, a.z);
        continue;
      }
      for (const s of [1, -1]) {
        const rows: V3[][] = [];
        const ring: V3[] = [];
        const foot = (e: number) => {
          const z = Math.min(d.zf, Math.max(d.zr, a.z + e * r));
          const y = Math.min(a.y, d.lower(z));
          rows.push([
            [s * xo, y, z],
            [s * xi, y, z],
          ]);
          ring.push([s * xi, y, z]);
        };
        foot(1);
        for (let i = 0; i <= 8; i++) {
          const t = (Math.PI * i) / 8;
          const y = a.y + r * Math.sin(t);
          const z = a.z + r * Math.cos(t);
          if (z < d.zr || z > d.zf) continue;
          rows.push([
            [s * xo, y, z],
            [s * xi, y, z],
          ]);
          ring.push([s * xi, y, z]);
        }
        foot(-1);
        k.grid(DARK, rows, { out: [s * (xo + xi) * 0.5, a.y - 0.1, a.z], inward: true });
        k.poly(DARK, ring, [s * (xi - 1), a.y, a.z]);
      }
      const low = Math.max(0.12, d.lower(a.z) - 0.08);
      if (a.y + 0.07 > low + 0.04) k.box(DARK, xi * 2, a.y + 0.07 - low, a.r * 1.3, 0, (a.y + 0.07 + low) / 2, a.z);
    }
    if (o.belly !== undefined) {
      const zs = d.arches.map((a) => a.z).sort((p, q) => p - q);
      for (let i = 0; i < zs.length - 1; i++) {
        const z0 = zs[i] + d.arches[0].r + 0.08;
        const z1 = zs[i + 1] - d.arches[0].r - 0.08;
        const zm = (z0 + z1) / 2;
        const top = d.lower(zm) + 0.03;
        k.box(DARK, (this.F(zm, top) - 0.2) * 2, top - o.belly, z1 - z0, 0, (top + o.belly) / 2, zm);
      }
    }
    if (o.pan === false) return;
    let run: V3[][] = [];
    const flush = () => {
      if (run.length > 1) k.grid(DARK, run, { out: [0, 3, this.mid], flat: true });
      run = [];
    };
    for (const z of this.stations) {
      if (this.inArch(z)) {
        flush();
        continue;
      }
      const y = this.yL(z) + 0.004;
      const x = this.lipX(z) + 0.004;
      run.push([
        [x, y, z],
        [-x, y, z],
      ]);
    }
    flush();
  }

  // ── Trim laid on the skin ──

  /** Vertical line (a door shut line) on both flanks, or one: `sides` of +1 / −1. */
  vline(k: Kit, surface: Surface, z: number, y0: number, y1: number, w = 0.009, sides: number[] = [1, -1], lift = 0.0025): void {
    if (k.lo) return;
    const pts: V3[] = [];
    for (let i = 0; i <= 5; i++) pts.push(this.side(z, mix(y0, y1, i / 5), lift));
    for (const s of sides) k.ribbon(surface, s > 0 ? pts : pts.map((p): V3 => [-p[0], p[1], p[2]]), [0, 0, 1], w, [0, 0.5, z]);
  }

  /** Line along the flanks at height `y` (a number, or a function of z). */
  hline(k: Kit, surface: Surface, y: number | Fn, z0: number, z1: number, h = 0.01, sides: number[] = [1, -1], lift = 0.0025): void {
    if (k.lo) return;
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / 0.3));
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const z = mix(z0, z1, i / n);
      pts.push(this.side(z, typeof y === 'number' ? y : y(z), lift));
    }
    for (const s of sides) k.ribbon(surface, s > 0 ? pts : pts.map((p): V3 => [-p[0], p[1], p[2]]), [0, 1, 0], h, [0, 0.5, this.mid]);
  }

  /** Filled band on the flanks between two heights (stripes, cladding, a rubbing strip with some depth). */
  band(k: Kit, surface: Surface, yLo: number | Fn, yHi: number | Fn, z0: number, z1: number, sides: number[] = [1, -1], lift = 0.003, rows = 2, step = 0.3): void {
    const lo = (z: number) => (typeof yLo === 'number' ? yLo : yLo(z));
    const hi = (z: number) => (typeof yHi === 'number' ? yHi : yHi(z));
    // From a distance only the broad bands (a livery, woodgrain) are worth their triangles.
    if (k.lo && (hi((z0 + z1) / 2) - lo((z0 + z1) / 2) < 0.1 || Math.abs(z1 - z0) < 0.6)) return;
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / (k.lo ? 0.9 : step)));
    for (const s of sides) {
      const lattice: V3[][] = [];
      for (let i = 0; i <= n; i++) {
        const z = mix(z0, z1, i / n);
        const row: V3[] = [];
        for (let j = 0; j <= rows; j++) {
          const p = this.side(z, mix(lo(z), hi(z), j / rows), lift);
          row.push([s * p[0], p[1], p[2]]);
        }
        lattice.push(row);
      }
      k.grid(surface, lattice, { out: [0, 0.5, this.mid] });
    }
  }

  /** Line on a deck running fore and aft at `x` (both sides) … */
  deckLine(k: Kit, surface: Surface, x: number | Fn, z0: number, z1: number, w = 0.009, lift = 0.0025): void {
    if (k.lo) return;
    const n = Math.max(2, Math.ceil(Math.abs(z1 - z0) / 0.3));
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const z = mix(z0, z1, i / n);
      pts.push(this.top(z, typeof x === 'number' ? x : x(z), lift));
    }
    k.ribbon(surface, pts, [1, 0, 0], w, [0, -2, this.mid], true);
  }

  /** … and one running across it at `z`, out to ±x. */
  deckCross(k: Kit, surface: Surface, z: number, x: number, w = 0.009, lift = 0.0025): void {
    if (k.lo) return;
    const pts: V3[] = [];
    for (let i = -6; i <= 6; i++) pts.push(this.top(z, (x * i) / 6, lift));
    k.ribbon(surface, pts, [0, 0, 1], w, [0, -2, z]);
  }

  /**
   * Plan path for something that wraps an end of the car (a bumper): from the flank at `zStart`, round
   * the corner and across to the centre line. Returns [origin, outward, up] frames at height `y`,
   * standing `off` clear of the skin; `bow` pushes the middle further out.
   */
  wrap(end: 'front' | 'rear', zStart: number, y: number, off = 0, bow = 0): [V3, V3, V3][] {
    const d = this.d;
    const dir = end === 'front' ? 1 : -1;
    const zEnd = end === 'front' ? d.zf : d.zr;
    const corner = end === 'front' ? d.cornerF[0] : d.cornerR[0];
    const zc = zEnd - dir * corner;
    const plan: [number, number][] = [];
    const n = Math.max(1, Math.ceil(Math.abs(zc - zStart) / 0.25));
    for (let i = 0; i < n; i++) {
      const z = mix(zStart, zc, i / n);
      plan.push([this.F(z, y), z]);
    }
    for (const deg of [0, 22.5, 45, 67.5, 90]) {
      const z = zc + dir * corner * Math.sin(rad(deg));
      plan.push([this.F(z, y), z]);
    }
    const xe = plan[plan.length - 1][0];
    for (const f of [0.55, 0]) plan.push([xe * f, zEnd + dir * bow * (1 - f * f)]);
    const frames: [V3, V3, V3][] = [];
    for (let i = 0; i < plan.length; i++) {
      const a = plan[Math.max(0, i - 1)];
      const b = plan[Math.min(plan.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      // Outward is the tangent turned a quarter turn away from the car.
      let nx = dir * tz;
      let nz = -dir * tx;
      if (i === plan.length - 1) {
        nx = 0;
        nz = dir;
      }
      frames.push([[plan[i][0] + nx * off, y, plan[i][1] + nz * off], [nx, 0, nz], [0, 1, 0]]);
    }
    return frames;
  }
}

/** Is the point inside the outline (both in the x-y plane)? */
function inside2(p: V3, outline: V3[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ───────────────────────────── Glasshouse ─────────────────────────────

export type PaneKind = 'glass' | 'paint' | 'black';

export interface CabinDef {
  /** Rear and front screens: z at the base and at the roof, how far the middle bows out, what it is. */
  rear: { zb: number; zt: number; bow?: number; kind?: PaneKind };
  front: { zb: number; zt: number; bow?: number; kind?: PaneKind };
  /** Height of the roof's edge by z. */
  roof: Fn;
  /** How much higher the roof's centre line is. */
  crown: number;
  /** How far the roof's edge sits inboard of the belt line, by z (tumblehome plus roof taper). */
  lean: number | Fn;
  /** Radius of the cant rail (side to roof) and of the headers (screens to roof). */
  railR: number;
  headerR: number;
  /** Painted band between the top of the glass and the radius. */
  band: number;
  /** Outward belly of the glass. */
  bulge?: number;
  /** Longest side bay before it is split for curvature (default 0.55 m). */
  split?: number;
  /**
   * Side glazing from the rear corner forwards: each entry runs to the knot `to` ([z at the belt, z at
   * the roof], or 'front' for the front corner) and is `kind`.
   */
  panes: { to: [number, number] | 'front'; kind: PaneKind }[];
  /** Different glazing on the left (+x) flank; defaults to `panes`. */
  panesLeft?: { to: [number, number] | 'front'; kind: PaneKind }[];
  /** Window surround and its width; null for none. */
  frame: Tint | null;
  glass?: Glaze;
  rearGlass?: Glaze;
  /** Black pillar finish. */
  black?: Tint;
  /** Headlining. */
  lining?: Tint;
  /** A rain gutter along the cant rail, in this finish. */
  gutter?: Tint;
}

export interface Cabin {
  /** Point on the windscreen: u −1…1 across, t 0…1 from the base to the top of the glass, `lift` proud. */
  screen(u: number, t: number, lift?: number): V3;
  /** Point on the rear screen. */
  back(u: number, t: number, lift?: number): V3;
  /** Point on the +x side of the glasshouse above belt position z: t 0…1 from the belt to the top of the glass. */
  flank(z: number, t: number, lift?: number): V3;
  /** Height of the roof on the centre line at z. */
  roofY(z: number): number;
  /** Half-width of the roof panel at z. */
  roofX(z: number): number;
  /** z of the windscreen's base and top on the centre line. */
  readonly front: { zb: number; zt: number };
}

const SCREEN_U_HI = [0, 0.34, 0.63, 0.85, 1];
const GLASS_T_HI = [0, 0.3, 0.65, 1];
const BLACK_PILLAR = tint(0x0b0b0c, 'gloss');
const LINING = tint(0x8d8a82, 'cloth');

/** Build the glasshouse on a shell. */
export function cabin(k: Kit, shell: Shell, c: CabinDef): Cabin {
  // The distant version keeps the outline and drops the curvature, the surrounds and the lining.
  const SCREEN_U = k.lo ? [0, 0.62, 1] : SCREEN_U_HI;
  const GLASS_T = k.lo ? [0, 1] : GLASS_T_HI;
  const N = SCREEN_U.length;
  const lean = (z: number) => (typeof c.lean === 'number' ? c.lean : c.lean(z));
  const bowR = c.rear.bow ?? 0;
  const bowF = c.front.bow ?? 0;
  const glass = c.glass ?? WINDOW;
  const core: V3 = [0, shell.yS((c.rear.zb + c.front.zb) / 2) + 0.1, (c.rear.zb + c.front.zb) / 2];
  const coreAt = (p: V3): V3 => [0, core[1], Math.min(c.front.zt - 0.3, Math.max(c.rear.zt + 0.3, p[2]))];
  const screens: Record<string, (u: number, t: number, lift: number) => V3> = {};

  for (const side of [1, -1]) {
    // Side knots from the rear corner to the front corner.
    const list = side === 1 && c.panesLeft ? c.panesLeft : c.panes;
    const knots: { zb: number; zt: number; kind: PaneKind }[] = [];
    let from: [number, number] = [c.rear.zb, c.rear.zt];
    for (const pane of list) {
      const to = pane.to === 'front' ? ([c.front.zb, c.front.zt] as [number, number]) : pane.to;
      const pieces = pane.kind === 'black' ? 1 : Math.max(1, Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / (k.lo ? Math.max(1.5, c.split ?? 0) : (c.split ?? 0.55))));
      for (let i = 0; i < pieces; i++) knots.push({ zb: mix(from[0], to[0], i / pieces), zt: mix(from[1], to[1], i / pieces), kind: pane.kind });
      from = to;
    }
    knots.push({ zb: c.front.zb, zt: c.front.zt, kind: 'paint' });
    const S = knots.length;

    // Roof surface (virtual: before the radii are taken off its edge).
    const beltX = (zb: number) => shell.sx(zb) - 0.002;
    const z0 = knots[0].zt;
    const z1 = knots[S - 1].zt;
    const roofPt = (i: number, j: number): V3 => {
      const kn = knots[i];
      const u = SCREEN_U[j];
      const a = clamp01((kn.zt - z0) / (z1 - z0));
      const bow = -bowR * 0.8 * (1 - a) ** 3 + bowF * 0.8 * a ** 3;
      return [side * u * (beltX(kn.zb) - lean(kn.zt)), c.roof(kn.zt) + c.crown * (1 - u * u), kn.zt + bow * (1 - u * u)];
    };
    const basePt = (end: 'rear' | 'front', j: number): V3 => {
      const u = SCREEN_U[j];
      const zb = end === 'rear' ? c.rear.zb : c.front.zb;
      const x = u * beltX(zb);
      const z = zb + (end === 'rear' ? -bowR : bowF) * (1 - u * u);
      return [side * x, shell.topY(z, x) + 0.001, z];
    };

    // Perimeter columns: rear screen (centre → corner), side (rear → front), windscreen (corner → centre).
    interface Column {
      pts: V3[];
      /** Kind of the bay between this column and the next. */
      kind: PaneKind;
      part: 'rear' | 'side' | 'front';
    }
    const column = (B: V3, C: V3, inner: V3, r: number, out: V3, belly: number): V3[] => {
      const a = norm3(sub3(B, C));
      const b = norm3(sub3(inner, C));
      const alpha = Math.acos(Math.max(-1, Math.min(1, dot3(a, b))));
      const L = Math.min(r / Math.tan(alpha / 2), 0.4 * len3(sub3(B, C)), 0.6 * len3(sub3(inner, C)));
      const T1 = add3(C, a, L);
      const T2 = add3(C, b, L);
      const O = add3(C, norm3(add3(a, b)), L / Math.cos(alpha / 2));
      const top = add3(T1, a, Math.min(c.band, 0.3 * len3(sub3(B, C))));
      const pts: V3[] = GLASS_T.map((t) => add3(mix3(B, top, t), out, belly * 4 * t * (1 - t)));
      pts.push(T1);
      const v1 = sub3(T1, O);
      const v2 = sub3(T2, O);
      const psi = Math.PI - alpha;
      for (const t of k.lo ? [1] : [0.34, 0.67, 1]) {
        if (psi < 1e-3) pts.push(mix3(T1, T2, t));
        else pts.push(add3(add3(O, v1, Math.sin((1 - t) * psi) / Math.sin(psi)), v2, Math.sin(t * psi) / Math.sin(psi)));
      }
      return pts;
    };
    const belly = c.bulge ?? 0.012;
    const cols: Column[] = [];
    for (let j = 0; j < N - 1; j++) {
      const u = SCREEN_U[j];
      cols.push({ pts: column(basePt('rear', j), roofPt(0, j), roofPt(1, j), c.headerR, [0, 0, -1], belly * (1 - u * u)), kind: c.rear.kind ?? 'glass', part: 'rear' });
    }
    for (let i = 0; i < S; i++) {
      const kn = knots[i];
      const B: V3 = i === 0 ? basePt('rear', N - 1) : i === S - 1 ? basePt('front', N - 1) : [side * beltX(kn.zb), shell.yS(kn.zb) + 0.001, kn.zb];
      const inner = roofPt(Math.min(S - 2, Math.max(1, i)), N - 2);
      const a = i / (S - 1);
      cols.push({ pts: column(B, roofPt(i, N - 1), inner, c.railR, [side, 0, 0], belly * Math.min(1, 6 * a * (1 - a))), kind: i === S - 1 ? (c.front.kind ?? 'glass') : kn.kind, part: i === S - 1 ? 'front' : 'side' });
    }
    for (let j = N - 2; j >= 0; j--) {
      const u = SCREEN_U[j];
      cols.push({ pts: column(basePt('front', j), roofPt(S - 1, j), roofPt(S - 2, j), c.headerR, [0, 0, 1], belly * (1 - u * u)), kind: c.front.kind ?? 'glass', part: 'front' });
    }
    const G = GLASS_T.length - 1; // index of the top of the glass in a column
    const E = cols[0].pts.length - 1; // index of the roof edge

    // Glazed / painted bays, in runs of one kind.
    const liningRows: V3[][][] = [];
    for (let s = 0; s < cols.length - 1; ) {
      let e = s;
      while (e + 1 < cols.length - 1 && cols[e + 1].kind === cols[s].kind && cols[e + 1].part === cols[s].part) e++;
      const rows = cols.slice(s, e + 2).map((col) => col.pts.slice(0, G + 1));
      const kind = cols[s].kind;
      if (kind === 'glass') {
        k.grid(cols[s].part === 'rear' ? (c.rearGlass ?? glass) : glass, rows, { out: core });
        if (c.frame && !k.lo) frames(k, c.frame, cols, s, e + 1, G, core, s === 0 || e + 1 === cols.length - 1);
      } else {
        k.grid(kind === 'paint' ? PAINT : (c.black ?? BLACK_PILLAR), rows, { out: core, group: 'cabin' });
        liningRows.push(rows);
      }
      s = e + 1;
    }
    // Rail band and radius all the way round, then the roof panel.
    const rail = cols.map((col) => col.pts.slice(G));
    k.grid(PAINT, rail, { out: core, group: 'cabin' });
    liningRows.push(rail);
    const roof: V3[][] = [];
    for (let i = 0; i < S; i++) {
      const row: V3[] = [];
      for (let j = 0; j < N - 1; j++) {
        if (i === 0) row.push(cols[j].pts[E]);
        else if (i === S - 1) row.push(cols[cols.length - 1 - j].pts[E]);
        else row.push(roofPt(i, j));
      }
      row.push(cols[N - 1 + i].pts[E]);
      roof.push(row);
    }
    k.grid(PAINT, roof, { out: core, group: 'cabin' });
    liningRows.push(roof);
    // Lining: the same panels seen from inside, a little inboard.
    const lining = c.lining ?? LINING;
    k.inside = true;
    if (!k.lo) {
      for (const rows of liningRows) {
        k.grid(
          lining,
          rows.map((row) => row.map((p) => add3(p, norm3(sub3(coreAt(p), p)), 0.022))),
          { out: core, inward: true },
        );
      }
    }
    k.inside = false;
    // Rain gutter: a bead standing off the cant rail from the rear quarter to the screen pillar.
    if (c.gutter && !k.lo) {
      const run = cols.slice(N - 1, N - 1 + S).map((col) => col.pts[G + 1]);
      k.ribbon(
        c.gutter,
        run.map((p): V3 => [p[0] + side * 0.007, p[1] + 0.002, p[2]]),
        [0, 1, 0],
        0.016,
        core,
      );
    }

    if (side === 1) {
      const pick = (first: number, dir: number) => (u: number, t: number, lift: number): V3 => {
        const au = Math.abs(u);
        let j = 0;
        while (j < N - 2 && SCREEN_U[j + 1] < au) j++;
        const f = clamp01((au - SCREEN_U[j]) / (SCREEN_U[j + 1] - SCREEN_U[j]));
        const ca = cols[first + dir * j].pts;
        const cb = cols[first + dir * (j + 1)].pts;
        const at = (pts: V3[]) => {
          const g = clamp01(t) * G;
          const i = Math.min(G - 1, Math.floor(g));
          return mix3(pts[i], pts[i + 1], g - i);
        };
        const p = mix3(at(ca), at(cb), f);
        const n = norm3(cross3(sub3(mix3(ca[G], cb[G], f), mix3(ca[0], cb[0], f)), sub3(at(cb), at(ca))));
        const q = add3(p, n, dot3(n, sub3(p, core)) < 0 ? -lift : lift);
        return [Math.sign(u || 1) * q[0], q[1], q[2]];
      };
      screens.back = pick(0, 1);
      screens.front = pick(cols.length - 1, -1);
      screens.flank = (z: number, t: number, lift: number): V3 => {
        let i = 0;
        while (i < S - 2 && knots[i + 1].zb < z) i++;
        const f = clamp01((z - knots[i].zb) / (knots[i + 1].zb - knots[i].zb || 1));
        const at = (pts: V3[]) => {
          const g = clamp01(t) * G;
          const j = Math.min(G - 1, Math.floor(g));
          return mix3(pts[j], pts[j + 1], g - j);
        };
        const p = mix3(at(cols[N - 1 + i].pts), at(cols[N + i].pts), f);
        return [p[0] + lift, p[1], p[2]];
      };
    }
  }
  return {
    screen: (u, t, lift = 0.006) => screens.front(u, t, lift),
    back: (u, t, lift = 0.006) => screens.back(u, t, lift),
    flank: (z, t, lift = 0.004) => screens.flank(z, t, lift),
    roofY: (z) => c.roof(z) + c.crown,
    roofX: (z) => shell.sx(Math.min(c.front.zb, Math.max(c.rear.zb, z))) - lean(z),
    front: { zb: c.front.zb, zt: c.front.zt },
  };
}

/** Surround of a glazed run of bays `s`…`e` (column indices), `G` rows high. */
function frames(k: Kit, surface: Tint, cols: { pts: V3[] }[], s: number, e: number, G: number, core: V3, screen: boolean): void {
  const w = 0.02;
  const lift = 0.004;
  const strip = (pts: V3[], inward: V3[]) => {
    const rows = pts.map((p, i) => {
      const tan = sub3(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]);
      let n = norm3(cross3(tan, inward[i]));
      if (dot3(n, sub3(p, core)) < 0) n = [-n[0], -n[1], -n[2]];
      const base = add3(p, n, lift);
      return [add3(base, inward[i], -0.004), add3(base, inward[i], w)];
    });
    k.grid(surface, rows, { out: core, flat: true });
  };
  const run = cols.slice(s, e + 1);
  strip(
    run.map((col) => col.pts[0]),
    run.map((col) => norm3(sub3(col.pts[1], col.pts[0]))),
  );
  strip(
    run.map((col) => col.pts[G]),
    run.map((col) => norm3(sub3(col.pts[G - 1], col.pts[G]))),
  );
  // Upright edges, except on the centre line of a screen.
  const upright = (col: number, towards: number) => {
    const a = cols[col].pts.slice(0, G + 1);
    const b = cols[towards].pts.slice(0, G + 1);
    strip(
      a,
      a.map((p, i) => norm3(sub3(b[i], p))),
    );
  };
  if (!(screen && s === 0)) upright(s, s + 1);
  if (!(screen && e === cols.length - 1)) upright(e, e - 1);
}

// ───────────────────────────── Interior ─────────────────────────────

export interface Seat {
  x: number;
  y: number;
  z: number;
}

export interface InteriorDef {
  /** Cabin floor height, and the z of the rear bulkhead and of the firewall. */
  floor: number;
  z0: number;
  z1: number;
  /** Seats (the model's `seats`); the driver first. Those listed in `bench` share one bench. */
  seats: Seat[];
  bench?: number[];
  /** Dashboard: z of its face and height of its top. */
  dash: { z: number; y: number };
  /** Parcel shelf behind the rear seat: height, and how far back it runs. */
  shelf?: { y: number; z: number };
  /** Load space behind the rear bulkhead (wagons, hatches, vans): floor height and how far back it runs. */
  cargo?: { y: number; z: number };
  /** No dashboard roll / binnacle (the builder supplies its own). */
  plainDash?: boolean;
  cloth?: Tint;
  vinyl?: Tint;
  /** Seat-back height above the cushion. */
  back?: number;
  headrests?: boolean;
  /** No centre console (a bench front, or an engine cover the builder supplies). */
  console?: boolean;
}

const VINYL = tint(0x26282b, 'satin');
const CARPET = tint(0x1b1c1e, 'cloth');
const DIAL = tint(0xd4d6d2, 'satin');

/**
 * Furnish a cabin: door cards with armrests, carpet, a dashboard with its binnacle, dials, vents and radio,
 * the wheel on the right, a console with the gear lever and handbrake, seats with headrests on posts, the
 * rear-view mirror and a parcel shelf with a pair of speakers. Nothing here casts a shadow or takes road
 * film. The distant version is a dark tub and the two front seat backs.
 */
export function interior(k: Kit, shell: Shell, d: InteriorDef, cab?: Cabin): void {
  const vinyl = d.vinyl ?? VINYL;
  const cloth = d.cloth ?? tint(0x4a4f57, 'cloth');
  const inner = (z: number) => shell.sx(z) - 0.05;
  const back = d.back ?? 0.6;
  const wz0 = d.cargo ? d.cargo.z : d.z0;
  k.inside = true;
  if (k.lo) {
    const top = shell.yS((wz0 + d.z1) / 2) - 0.1;
    const w = Math.min(inner(wz0 + 0.1), inner(d.z1 - 0.1)) * 2;
    k.box(vinyl, w, top - d.floor, d.z1 - wz0, 0, (top + d.floor) / 2, (wz0 + d.z1) / 2);
    for (const s of d.seats.slice(0, 2)) k.box(cloth, 0.46, back + 0.24, 0.14, s.x, s.y + 0.06 + (back + 0.24) / 2, s.z - 0.3);
    k.inside = false;
    return;
  }
  // Door cards with a capping at the belt line, both sides.
  const n = Math.max(2, Math.ceil((d.z1 - wz0) / 0.4));
  const wall: V3[][] = [];
  for (let i = 0; i <= n; i++) {
    const z = mix(wz0, d.z1, i / n);
    const y = shell.yS(z) - 0.012;
    wall.push([
      [shell.sx(z) - 0.004, y, z],
      [inner(z), y, z],
      [inner(z), d.floor, z],
    ]);
  }
  k.grid(vinyl, wall, { out: [4, -8, (d.z0 + d.z1) / 2], mirror: true, flat: true });
  // Floor, rear bulkhead, footwell.
  const x0 = inner(d.z0);
  const x1 = inner(d.z1);
  k.poly(CARPET, [[-x0, d.floor, d.z0], [x0, d.floor, d.z0], [x1, d.floor, d.z1], [-x1, d.floor, d.z1]], [0, -3, 0]);
  const yr = d.shelf?.y ?? shell.yS(d.z0) - 0.02;
  if (!d.cargo) k.poly(vinyl, [[-x0, d.floor, d.z0], [x0, d.floor, d.z0], [x0, yr, d.z0], [-x0, yr, d.z0]], [0, 0.6, d.z0 - 3]);
  if (d.shelf) {
    const xs = shell.sx(d.shelf.z) - 0.03;
    k.poly(vinyl, [[-x0, yr, d.z0], [x0, yr, d.z0], [xs, yr, d.shelf.z], [-xs, yr, d.shelf.z]], [0, -3, 0]);
    // A pair of speakers let into the shelf.
    for (const sx of [1, -1]) k.drum(DARK, 0.075, 0.006, sx * xs * 0.62, yr + 0.004, (d.z0 + d.shelf.z) / 2, 'y', 10);
  }
  if (d.cargo) {
    const xc = inner(d.cargo.z);
    const yb = shell.yS(d.cargo.z) - 0.012;
    k.poly(CARPET, [[-x0, d.cargo.y, d.z0], [x0, d.cargo.y, d.z0], [xc, d.cargo.y, d.cargo.z], [-xc, d.cargo.y, d.cargo.z]], [0, -3, 0]);
    k.poly(vinyl, [[-x0, d.floor, d.z0], [x0, d.floor, d.z0], [x0, d.cargo.y, d.z0], [-x0, d.cargo.y, d.z0]], [0, 0.6, d.z0 + 3]);
    k.poly(vinyl, [[-xc, d.cargo.y, d.cargo.z], [xc, d.cargo.y, d.cargo.z], [xc, yb, d.cargo.z], [-xc, yb, d.cargo.z]], [0, 0.6, d.cargo.z - 3]);
  }
  // Dashboard: a padded top roll over a lower fascia, with a binnacle and the wheel on the right.
  const dw = inner(d.dash.z) * 2 - 0.01;
  const driver = d.seats[0];
  k.pad(vinyl, dw, 0.16, d.z1 - d.dash.z + 0.1, 0, d.dash.y - 0.08, (d.z1 + d.dash.z) / 2 + 0.05, 0.04);
  k.box(vinyl, dw, d.dash.y - 0.14 - d.floor, 0.05, 0, (d.dash.y - 0.14 + d.floor) / 2, d.dash.z + 0.2);
  if (!d.plainDash) {
    const fz = d.dash.z - 0.003;
    const fy = d.dash.y - 0.085;
    k.pad(vinyl, 0.38, 0.1, 0.17, driver.x, d.dash.y + 0.012, d.dash.z + 0.1, 0.03);
    // Instruments under the hood: a dark panel and two pale dials; then vents, radio and glovebox.
    k.box(BLACK_PANEL, 0.3, 0.085, 0.006, driver.x, fy, fz);
    for (const sx of [1, -1]) k.drum(DIAL, 0.033, 0.004, driver.x + sx * 0.07, fy, fz - 0.004, 'z', 10);
    k.box(BLACK_PANEL, 0.22, 0.06, 0.006, 0, fy - 0.07, fz);
    k.box(BRIGHT, 0.2, 0.008, 0.008, 0, fy - 0.043, fz - 0.001);
    for (const x of [-driver.x, 0]) k.box(DARK, 0.15, 0.035, 0.006, x, fy + 0.005, fz);
    k.box(DARK, 0.3, 0.005, 0.006, -driver.x, fy - 0.045, fz);
    k.box(BRIGHT, 0.03, 0.012, 0.012, -driver.x, fy - 0.058, fz - 0.003);
    // Indicator stalk.
    k.beam(DARK, [driver.x - 0.03, driver.y + 0.5, driver.z + 0.43], [driver.x - 0.2, driver.y + 0.52, driver.z + 0.39], 0.012, 0.012);
  }
  steeringWheel(k, driver.x, driver.y + 0.53, driver.z + 0.345, vinyl);
  // Rear-view mirror hanging from the screen's header.
  if (cab) {
    const p = cab.screen(0, 0.9, -0.03);
    k.box(DARK, 0.21, 0.055, 0.02, 0, p[1] - 0.015, p[2] - 0.035, [-0.25, 0, 0]);
    k.box(BRIGHT, 0.19, 0.04, 0.004, 0, p[1] - 0.015, p[2] - 0.048, [-0.25, 0, 0]);
    k.beam(DARK, [0, p[1] + 0.03, p[2] + 0.005], [0, p[1] - 0.005, p[2] - 0.03], 0.016, 0.016);
  }
  // Seats.
  const bench = new Set(d.bench ?? []);
  const single = (s: Seat, w: number) => {
    k.pad(cloth, w, 0.15, 0.52, s.x, s.y - 0.012, s.z + 0.06, 0.05);
    k.pad(cloth, w - 0.02, back, 0.12, s.x, s.y + 0.04 + back / 2, s.z - 0.27, 0.045, [-0.2, 0, 0]);
    // Side bolsters give the back its shape.
    for (const sx of [1, -1]) k.pad(cloth, 0.07, back * 0.72, 0.1, s.x + sx * (w / 2 - 0.045), s.y + 0.03 + back * 0.42, s.z - 0.235, 0.03, [-0.2, 0, 0]);
    if (d.headrests !== false) {
      k.pad(cloth, 0.25, 0.16, 0.09, s.x, s.y + 0.14 + back, s.z - 0.39, 0.035, [-0.15, 0, 0]);
      for (const sx of [1, -1]) k.tube(BRIGHT, [s.x + sx * 0.06, s.y + back - 0.02, s.z - 0.365], [s.x + sx * 0.06, s.y + back + 0.1, s.z - 0.385], 0.006, 4);
    }
  };
  d.seats.forEach((s, i) => {
    if (!bench.has(i)) single(s, 0.5);
  });
  if (bench.size) {
    const s = d.seats[[...bench][0]];
    const w = Math.min(inner(s.z), inner(s.z - 0.3)) * 2 - 0.04;
    k.pad(cloth, w, 0.15, 0.52, 0, s.y - 0.012, s.z + 0.06, 0.05);
    k.pad(cloth, w, back - 0.04, 0.13, 0, s.y + 0.04 + (back - 0.04) / 2, s.z - 0.28, 0.045, [-0.27, 0, 0]);
    // A fold-down armrest's outline in the middle of the back.
    k.box(vinyl, 0.008, back * 0.5, 0.004, 0, s.y + 0.06 + back * 0.4, s.z - 0.21, [-0.27, 0, 0]);
  }
  // Console between two separate front seats: gear lever in its gaiter, handbrake.
  const [a, b] = d.seats;
  if (d.console !== false && b && !bench.has(0) && !bench.has(1) && Math.abs(a.z - b.z) < 0.05) {
    k.pad(vinyl, 0.19, 0.17, 0.82, 0, d.floor + 0.085, a.z + 0.16, 0.035);
    k.pad(CARPET, 0.1, 0.05, 0.12, 0, d.floor + 0.185, a.z + 0.36, 0.02);
    k.tube(BRIGHT, [0, d.floor + 0.19, a.z + 0.36], [0.01, d.floor + 0.36, a.z + 0.33], 0.008, 5);
    k.ball(DARK, 0.026, 0.01, d.floor + 0.375, a.z + 0.33, 1, 1, 6);
    k.beam(DARK, [0.05, d.floor + 0.18, a.z - 0.08], [0.05, d.floor + 0.25, a.z + 0.14], 0.03, 0.03);
  }
  // Armrests on the front doors.
  for (const sx of [1, -1]) k.pad(vinyl, 0.07, 0.05, 0.44, sx * (inner(a.z + 0.1) - 0.03), a.y + 0.27, a.z + 0.1, 0.02);
  k.inside = false;
}

const BLACK_PANEL = tint(0x0c0c0d, 'gloss');

/** Steering wheel facing the driver, with its column. */
export function steeringWheel(k: Kit, x: number, y: number, z: number, surface: Surface, radius = 0.185): void {
  const tilt = 0.45;
  const rows: V3[][] = [];
  const seg = 10;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const row: V3[] = [];
    for (let j = 0; j <= 3; j++) {
      const b = (j / 3) * Math.PI * 2;
      const r = radius + Math.cos(b) * 0.017;
      const lx = Math.cos(a) * r;
      const ly = Math.sin(a) * r;
      const lz = Math.sin(b) * 0.017;
      row.push([x + lx, y + ly * Math.cos(tilt) - lz * Math.sin(tilt), z + ly * Math.sin(tilt) + lz * Math.cos(tilt)]);
    }
    rows.push(row);
  }
  k.grid(surface, rows, { out: [x, y, z] });
  const fwd: V3 = [0, -Math.sin(tilt), Math.cos(tilt)];
  const hub = add3([x, y, z], fwd, 0.05);
  k.beam(surface, [x - radius, y, z], hub, 0.03, 0.012);
  k.beam(surface, [x + radius, y, z], hub, 0.03, 0.012);
  k.beam(surface, add3([x, y, z], [0, -Math.cos(tilt), -Math.sin(tilt)], radius), hub, 0.03, 0.012);
  k.tube(surface, hub, add3(hub, fwd, 0.3), 0.03, 6);
}
