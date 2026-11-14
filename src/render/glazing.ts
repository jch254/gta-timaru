import * as THREE from 'three';

/**
 * The facade-detail material behind `MaterialLibrary.windows()`.
 *
 * Every window, door, shopfront, roller door, light box and piece of fretwork on a building is a flat
 * quad of ONE shared material, so a whole chunk's openings are a single draw call. What a quad shows is
 * drawn by the fragment shader from three numbers carried in the vertex colour (style and flags, cell
 * size in metres, paint colour) and from its UVs (cell coordinates plus a per-quad random seed):
 *
 *  - frames, sashes, glazing bars and mullions with antialiased edges, crisp at any distance;
 *  - a reveal: the quad sits on the wall plane and the glass is drawn set back behind it with parallax;
 *  - glass with its own Fresnel reflectance, so it picks up the sky from the environment map, each pane
 *    tilted a hair so neighbouring panes catch different parts of it;
 *  - behind the glass: net curtains, drapes, venetians or blinds, then a furnished room (interior
 *    mapping), a shop display, or an open-plan office under a grid of ceiling lights;
 *  - at night a seeded share of the rooms light up: warm lamps, the odd television, bright shops.
 *
 * UV convention: `u = cellU + 64 * seedU`, `v = cellV + 64 * seedV`, where cellU/V run 0..n across n
 * cells (a single window is one cell) and the seeds are integers 0..15. Quads made the old way (UVs 0..1
 * and no size in the vertex colour) still work: their size is recovered from screen-space derivatives.
 */

export type GlazingStyle =
  | 'glass' // bare sheet of glass. variant 1 = obscure, 2 = tinted
  | 'sash' // double-hung sash. variant 1 = two-over-two
  | 'casement' // casements with fanlights. variant 1 = three lights, 2 / 3 = aluminium joinery
  | 'shop' // display window. variant 1 = aluminium, 2 / 3 = leadlight toplights above a transom
  | 'office' // precast panel with a punched window per cell. variant 1 = ribbon, 2 = narrow, 3 = deep spandrel
  | 'curtain' // curtain wall, vision glass over a spandrel. variant = tint (blue, bronze, green, smoke)
  | 'door' // panelled timber door. variant 1 = half glazed, 2 = fanlight over, 3 = double
  | 'shopdoor' // glazed shop door. variant 1 = in a tiled recess, 2 = aluminium pair, 3 = recessed pair
  | 'roller' // roller door. variant 1 = half up, 2 = open, 3 = sliding timber door
  | 'lamp' // light box / tube: glows `color` at night, brighter with `lit`
  | 'steel' // steel-framed factory glazing in small panes. variant 1 = larger panes
  | 'louvre' // plant-room louvres
  | 'fret' // cut-out timber fretwork. variant 0 = spindle frieze, 1 / 2 = bracket (post left / right), 3 = valance
  | 'picket' // cut-out railings. variant 0 = balusters, 1 = pickets, 2 = lattice, 3 = cross-braced iron
  | 'leaded'; // pointed-arch leadlight window in a `color` surround

export interface GlazingOptions {
  /** Size of one cell (one window, one door, one bay × storey) in metres. */
  w: number;
  h: number;
  /** Paint: frame, door leaf, roller slats, wall panel, lamp colour. */
  color?: number;
  /** 0 = never lit at night … 3 = nearly always. */
  lit?: number;
  /** Style-specific variant 0..3 (see `GlazingStyle`). */
  variant?: number;
  /**
   * Windows: the reveal the glass sits in. 0 = none (timber joinery proud of the wall), 1 = shallow
   * plaster, 2 = deep stone, 3 = concrete. Office / curtain: frame finish (silver, bronze, white, black).
   */
  wall?: number;
}

const STYLE_ID: Record<GlazingStyle, number> = {
  glass: 0,
  sash: 1,
  casement: 2,
  shop: 3,
  office: 4,
  curtain: 5,
  door: 6,
  shopdoor: 7,
  roller: 8,
  lamp: 9,
  steel: 10,
  louvre: 11,
  fret: 12,
  picket: 13,
  leaded: 14,
};

const bits = (v: number | undefined, max: number) => Math.max(0, Math.min(max, Math.round(v ?? 0)));

/** Stable cache key for a style + options (sizes snap to 2.5 cm, colours to 7 bits a channel). */
export function glazingKey(style: GlazingStyle, o: GlazingOptions): string {
  const d = glazingData(style, o);
  return `glz|${d.r}|${d.g}|${d.b}`;
}

/** The three numbers the shader reads from the vertex colour, as a (non-colour) THREE.Color. */
export function glazingData(style: GlazingStyle, o: GlazingOptions): THREE.Color {
  const flags = STYLE_ID[style] + 32 * bits(o.lit, 3) + 128 * bits(o.variant, 3) + 512 * bits(o.wall, 3);
  const size = bits(o.w * 40, 2047) + 2048 * bits(o.h * 40, 2047);
  const c = o.color ?? 0xf2efe6;
  const paint = (((c >> 16) & 255) >> 1) + ((((c >> 8) & 255) >> 1) << 7) + (((c & 255) >> 1) << 14);
  const data = new THREE.Color();
  data.r = flags;
  data.g = size;
  data.b = paint;
  return data;
}

const VERTEX_PARS = /* glsl */ `
varying vec2 vGlzUv;
varying vec3 vGlzPos;
varying vec3 vGlzNrm;
flat varying vec3 vGlzData;
`;

const VERTEX_MAIN = /* glsl */ `
vGlzUv = uv;
#ifdef USE_COLOR
  vGlzData = color;
#else
  vGlzData = vec3(0.0);
#endif
#ifdef USE_INSTANCING
  vGlzPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vGlzNrm = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#else
  vGlzPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGlzNrm = mat3(modelMatrix) * objectNormal;
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vGlzUv;
varying vec3 vGlzPos;
varying vec3 vGlzNrm;
flat varying vec3 vGlzData;
uniform float uGlzTime;

float gH1(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 gH3(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
// Coverage of a bar of half-width hw at distance d from its centre line, box-filtered over a pixel of px metres.
float gBar(float d, float hw, float px) {
  return clamp((hw - abs(d)) / px + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / px + 0.3);
}
// 1 inside the rectangle 0..size.
float gRect(vec2 q, vec2 size, float px) {
  vec2 d = min(q, size - q);
  return clamp(min(d.x, d.y) / px + 0.5, 0.0, 1.0);
}
// 1 on a frame of thickness t just inside the rectangle 0..size (and outside it).
float gRing(vec2 q, vec2 size, float t, float px) {
  vec2 d = min(q, size - q);
  return 1.0 - clamp((min(d.x, d.y) - t) / px + 0.5, 0.0, 1.0);
}
// Curtain fabrics of the period.
vec3 gFabric(float r) {
  return r < 0.17 ? vec3(0.72, 0.66, 0.52) : (r < 0.34 ? vec3(0.55, 0.33, 0.3) : (r < 0.5 ? vec3(0.42, 0.46, 0.33) : (r < 0.67 ? vec3(0.62, 0.5, 0.36) : (r < 0.84 ? vec3(0.4, 0.47, 0.56) : vec3(0.5, 0.24, 0.22)))));
}
float gFresnel(float f0, float c) {
  float m = 1.0 - c;
  float m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

// A box room behind an opening (interior mapping). q: where the ray crosses the glass, in metres from the
// opening's lower-left corner; sl: sideways travel per metre of depth; ext: how far the room runs beyond
// the opening (sides, below the sill, above the head). kind: 0 living room, 1 shop, 2 office, 3 workshop.
vec3 gRoom(vec2 q, vec2 sl, vec2 size, vec3 ext, float depth, float seed, float kind, out float glow) {
  float x0 = -ext.x;
  float x1 = size.x + ext.x;
  float y0 = -ext.y;
  float y1 = size.y + ext.z;
  float tx = sl.x > 0.0 ? (x1 - q.x) / max(sl.x, 1e-3) : (x0 - q.x) / min(sl.x, -1e-3);
  float ty = sl.y > 0.0 ? (y1 - q.y) / max(sl.y, 1e-3) : (y0 - q.y) / min(sl.y, -1e-3);
  float t = min(depth, min(tx, ty));
  vec3 hp = vec3(q + sl * t, t);
  vec3 tint = gH3(vec2(seed, 7.31));
  vec3 wallc = mix(vec3(0.74, 0.7, 0.6), vec3(0.6, 0.68, 0.66), tint.x) * (0.8 + 0.3 * tint.y);
  vec3 col;
  glow = 0.0;
  if (t >= depth) {
    col = wallc;
    if (kind < 0.5) {
      // A doorway through to the hall and a picture on the wall.
      float span = x1 - x0;
      float door = step(abs(hp.x - x0 - span * (0.25 + 0.5 * tint.z)), 0.42) * step(hp.y, y0 + 2.0);
      col = mix(col, wallc * 0.3, door);
      vec2 pd = abs(hp.xy - vec2(x0 + span * (0.75 - 0.5 * tint.z), y0 + 1.55));
      col = mix(col, vec3(0.45, 0.38, 0.28) + 0.3 * tint, step(pd.x, 0.36) * step(pd.y, 0.26));
    } else if (kind < 1.5) {
      // Shelves of stock.
      float sy = (hp.y - y0) / 0.42;
      float row = floor(sy);
      float item = floor((hp.x - x0) / 0.24 + row * 0.37);
      vec3 stock = 0.2 + 0.6 * gH3(vec2(item, row + seed * 13.0));
      stock = mix(stock, vec3(dot(stock, vec3(0.3333))), 0.55);
      col = mix(stock, vec3(0.3, 0.26, 0.2), step(fract(sy), 0.12));
      col = mix(col, wallc, step(y0 + 2.15, hp.y));
    } else if (kind < 2.5) {
      // Partition with doors.
      float dx = fract((hp.x - x0) / 3.1);
      col = mix(wallc * vec3(0.95, 0.97, 1.0), vec3(0.4, 0.32, 0.24), step(abs(dx - 0.5), 0.14) * step(hp.y, y0 + 2.05));
    } else {
      // Workshop: racking against a grimy wall.
      float sy = (hp.y - y0) / 0.9;
      col = mix(vec3(0.3, 0.3, 0.29), 0.16 + 0.3 * gH3(vec2(floor((hp.x - x0) / 0.8), floor(sy) + seed)), step(hp.y, y0 + 2.7) * step(0.15, fract(sy)));
    }
  } else if (t >= ty) {
    if (sl.y > 0.0) {
      col = vec3(0.82, 0.81, 0.78);
      if (kind > 1.5) {
        // Rows of fluorescent troffers.
        vec2 g = fract(vec2(hp.x / 2.4, hp.z / 1.8));
        glow = step(abs(g.x - 0.5), 0.125) * step(abs(g.y - 0.5), 0.33);
      } else if (kind > 0.5) {
        vec2 g = fract(vec2(hp.x / 1.8, hp.z / 1.6));
        glow = step(abs(g.x - 0.5), 0.05) * step(abs(g.y - 0.5), 0.4);
      } else {
        glow = 1.0 - smoothstep(0.1, 0.24, length(vec2(hp.x - (x0 + x1) * 0.5, hp.z - depth * 0.5)));
      }
    } else {
      col = kind > 1.5 ? vec3(0.3, 0.31, 0.33) : mix(vec3(0.36, 0.25, 0.18), vec3(0.3, 0.34, 0.28), tint.y);
    }
  } else {
    col = wallc * 0.82;
  }
  // Daylight falls away from the window.
  return col * mix(1.0, 0.35, clamp(t / depth, 0.0, 1.0));
}
`;

const FRAGMENT_MAIN = /* glsl */ `
vec3 gN = normalize(vGlzNrm);
vec3 gT = normalize(cross(vec3(0.0, 1.0, 0.0), gN) + vec3(1e-5, 0.0, 0.0));
vec3 gB = cross(gN, gT);
vec3 gV = normalize(vGlzPos - cameraPosition);
float gCos = clamp(-dot(gV, gN), 0.0, 1.0);
vec2 gSl = clamp(vec2(dot(gV, gT), dot(gV, gB)) / max(gCos, 0.08), -5.0, 5.0);

float gFlags = floor(vGlzData.x + 0.5);
float gStyle = mod(gFlags, 32.0);
float gLit = mod(floor(gFlags / 32.0), 4.0);
float gVar = mod(floor(gFlags / 128.0), 4.0);
float gWall = mod(floor(gFlags / 512.0), 4.0);
float gSz = floor(vGlzData.y + 0.5);
float gw = mod(gSz, 2048.0) / 40.0;
float gh = floor(gSz / 2048.0) / 40.0;
float gCol = floor(vGlzData.z + 0.5);
vec3 gPaint = pow(vec3(floor(mod(gCol, 128.0)), mod(floor(gCol / 128.0), 128.0), floor(gCol / 16384.0)) / 127.0, vec3(2.2));

vec2 gSeedV = floor(vGlzUv / 64.0);
vec2 gC = vGlzUv - gSeedV * 64.0;
vec3 gDp1 = dFdx(vViewPosition);
vec3 gDp2 = dFdy(vViewPosition);
vec2 gDu1 = dFdx(vGlzUv);
vec2 gDu2 = dFdy(vGlzUv);
if (gw < 0.01) {
  // Old-style quad: recover its size in metres from how position and UV change across the screen.
  float det = gDu1.x * gDu2.y - gDu1.y * gDu2.x;
  det = abs(det) < 1e-12 ? 1e-12 : det;
  gw = clamp(length((gDp1 * gDu2.y - gDp2 * gDu1.y) / det), 0.3, 30.0);
  gh = clamp(length((gDp2 * gDu1.x - gDp1 * gDu2.x) / det), 0.3, 30.0);
  vec3 org = vGlzPos - gT * (gC.x * gw) - gB * (gC.y * gh);
  gSeedV = floor(org.xz + 0.5) + floor(org.y + 0.5) * 3.0;
}
vec2 gCell = floor(gC);
vec2 gF = gC - gCell;
vec2 gPm = (abs(gDu1) + abs(gDu2)) * vec2(gw, gh);
float gPx = max(gPm.x, gPm.y) + 1e-4;
vec2 gP = gF * vec2(gw, gh);
vec3 gR = gH3(gCell * 1.37 + gSeedV * 5.11 + 0.5);
vec3 gR2 = gH3(gCell * 2.91 + gSeedV * 3.07 + 9.5);
float gNight = emissive.r;

vec3 gAlb = gPaint;
float gRough = 0.6;
vec3 gF0 = vec3(0.04);
vec3 gEm = vec3(0.0);
vec2 gTilt = vec2(0.0);

if (gStyle > 0.5 && gStyle < 5.5) {
  // ───── Windows: sash, casement, shop, office panel, curtain wall ─────
  vec2 o0 = vec2(0.0);
  vec2 osz = vec2(gw, gh);
  float rev = 0.0;
  vec3 revCol = vec3(0.8, 0.77, 0.69);
  float ft = 0.05;
  float kind = 0.0;
  float f0 = 0.075;
  vec3 gtint = vec3(1.0);
  float depth = 3.6;
  vec3 ext = vec3(0.9, 0.9, 0.35);
  float pLit = gLit * 0.22;
  vec3 frameCol = gPaint;
  float litSeed = gR.y;
  if (gStyle < 2.5) {
    rev = gWall < 0.5 ? 0.0 : (gWall < 1.5 ? 0.09 : (gWall < 2.5 ? 0.2 : 0.14));
    if (gWall > 2.5) revCol = vec3(0.62, 0.61, 0.58);
    if (gStyle > 1.5 && gVar > 1.5) ft = 0.03;
  } else if (gStyle < 3.5) {
    ft = gVar > 0.5 && gVar < 1.5 ? 0.03 : 0.045;
    kind = 1.0;
    f0 = 0.055;
    depth = 5.0;
    ext = vec3(1.5, 0.55, 0.6);
    pLit = gLit * 0.31;
    litSeed = gH1(gSeedV + 2.5);
  } else {
    kind = 2.0;
    depth = 7.0;
    ft = 0.035;
    pLit = gLit * 0.14;
    // Lights go on a zone at a time: three bays of a floor together.
    litSeed = mix(gH1(vec2(floor(gCell.x / 3.0), gCell.y) + gSeedV * 3.0), gR.y, 0.35);
    frameCol = gWall < 0.5 ? vec3(0.5, 0.52, 0.53) : (gWall < 1.5 ? vec3(0.16, 0.12, 0.09) : (gWall < 2.5 ? vec3(0.82, 0.82, 0.8) : vec3(0.04)));
    if (gStyle < 4.5) {
      f0 = 0.1;
      ext = vec3(4.0, 0.95, 0.5);
      vec2 mx = gVar < 0.5 ? vec2(0.32) : (gVar < 1.5 ? vec2(0.0) : (gVar < 2.5 ? vec2(0.55) : vec2(0.4)));
      float my0 = gVar < 1.5 ? 0.95 : (gVar < 2.5 ? 0.75 : 1.15);
      float my1 = gVar < 2.5 ? 0.42 : 0.55;
      o0 = vec2(mx.x, my0);
      osz = vec2(gw - mx.x - mx.y, gh - my0 - my1);
      rev = gVar > 0.5 && gVar < 1.5 ? 0.07 : 0.17;
      revCol = gPaint * 0.92;
    } else {
      f0 = 0.2;
      ext = vec3(4.0, 0.0, 0.5);
      ft = 0.028;
      gtint = gVar < 0.5 ? vec3(0.55, 0.7, 0.8) : (gVar < 1.5 ? vec3(0.82, 0.6, 0.4) : (gVar < 2.5 ? vec3(0.52, 0.74, 0.64) : vec3(0.42, 0.44, 0.47)));
    }
  }

  vec2 q0 = gP - o0;
  float inOpen = gRect(q0, osz, gPx);

  // Precast panel around the opening: joints, weather streaks below the sill, a little mottling.
  vec3 wallAlb = gPaint;
  if (gStyle > 3.5 && gStyle < 4.5) {
    float jd = min(min(gP.x, gw - gP.x), gP.y);
    float joint = clamp((0.012 - jd) / gPx + 0.5, 0.0, 1.0) * min(1.0, 0.024 / gPx + 0.3);
    float streak = gH1(vec2(floor(gP.x * 14.0), gCell.x + gSeedV.x * 7.0)) * clamp(gP.y / max(o0.y, 0.01), 0.0, 1.0) * step(gP.y, o0.y);
    wallAlb = gPaint * (0.93 + 0.12 * gH1(gCell + gSeedV * 3.3)) * (1.0 - 0.2 * streak) * (1.0 - 0.5 * joint);
  }

  // Reveal: the glass is set back, so the ray may strike the side of the opening first.
  vec2 q = q0 + gSl * rev;
  vec2 over = max(-q, q - osz);
  float isRev = rev > 0.0 ? clamp(max(over.x, over.y) / gPx + 0.5, 0.0, 1.0) : 0.0;
  float rtx = gSl.x > 0.0 ? (osz.x - q0.x) / max(gSl.x, 1e-3) : -q0.x / min(gSl.x, -1e-3);
  float rty = gSl.y > 0.0 ? (osz.y - q0.y) / max(gSl.y, 1e-3) : -q0.y / min(gSl.y, -1e-3);
  float rShade = rtx < rty ? 0.76 : (gSl.y > 0.0 ? 0.5 : 1.06);
  vec3 revAlb = revCol * rShade * (1.0 - 0.25 * clamp(min(rtx, rty) / max(rev, 0.01), 0.0, 1.0));

  // Joinery.
  float fr = gRing(q, osz, ft, gPx);
  vec2 pane = vec2(0.0);
  float spandrel = 0.0;
  if (gStyle < 1.5) {
    float mid = osz.y * 0.5;
    fr = max(fr, gBar(q.y - mid, 0.028, gPx));
    float two = step(0.5, mod(gVar, 2.0));
    fr = max(fr, two * gBar(q.x - osz.x * 0.5, 0.012, gPx));
    pane = vec2(step(osz.x * 0.5, q.x) * two, step(mid, q.y));
  } else if (gStyle < 2.5) {
    float alu = step(1.5, gVar);
    // A tall narrow opening made the old way is a sash; otherwise lights about 0.6 m wide.
    float n = gVar < 0.5 ? clamp(floor(osz.x / 0.62 + 0.5), 1.0, 4.0) : (mod(gVar, 2.0) > 0.5 ? 3.0 : 2.0);
    float lw = osz.x / n;
    fr = max(fr, gBar(q.x - lw * floor(q.x / lw + 0.5), mix(0.024, 0.016, alu), gPx));
    float tr = osz.y * (osz.y > osz.x * 1.25 ? 0.5 : 0.74);
    fr = max(fr, (1.0 - alu) * gBar(q.y - tr, 0.022, gPx));
    pane = vec2(floor(q.x / lw), step(tr, q.y) * (1.0 - alu));
  } else if (gStyle < 3.5) {
    float n = max(1.0, floor(osz.x / 1.7 + 0.5));
    float lw = osz.x / n;
    fr = max(fr, gBar(q.x - lw * floor(q.x / lw + 0.5), 0.02, gPx));
    pane.x = floor(q.x / lw);
    if (gVar > 1.5 && osz.y > 2.0) {
      float tr = osz.y - 0.5;
      fr = max(fr, gBar(q.y - tr, 0.025, gPx));
      fr = max(fr, step(tr, q.y) * gBar(q.x - 0.28 * floor(q.x / 0.28 + 0.5), 0.008, gPx));
      pane.y = step(tr, q.y);
    }
  } else if (gStyle < 4.5) {
    float n = max(1.0, floor(osz.x / 1.25 + 0.5));
    float lw = osz.x / n;
    fr = max(fr, gBar(q.x - lw * floor(q.x / lw + 0.5), 0.018, gPx));
    pane.x = floor(q.x / lw);
  } else {
    float sp = 0.34 * osz.y;
    fr = max(fr, gBar(q.y - sp, 0.02, gPx));
    fr = max(fr, gBar(q.x - osz.x * 0.5, 0.018, gPx));
    spandrel = step(q.y, sp);
    pane = vec2(step(osz.x * 0.5, q.x), 1.0 - spandrel);
  }

  // What is behind the glass.
  float seed = gR.x * 97.0 + gCell.x * 3.0 + gCell.y * 11.0;
  float lit = step(litSeed, pLit) * smoothstep(0.12 + 0.5 * gR.z, 0.3 + 0.5 * gR.z, gNight);
  float glow;
  vec3 room = gRoom(q, gSl, osz, ext, depth, seed, kind, glow);
  vec2 qc = q + gSl * 0.07;
  float cov = 0.0;
  vec3 cAlb = vec3(0.8);
  float cTrans = 0.6;
  if (kind < 0.5) {
    vec3 fabric = gFabric(gH1(vec2(seed, 2.2)));
    float folds = 0.76 + 0.24 * sin(qc.x * 55.0 + sin(qc.y * 3.0) * 1.5);
    // Most people pull the curtains when the lights go on.
    float shut = lit * step(0.3, gR2.z);
    float c = gR2.x;
    if (c < 0.36) {
      float sw = osz.x * 0.16;
      float side = max(step(qc.x, sw) + step(osz.x - sw, qc.x), shut);
      cov = mix(0.78, 1.0, side);
      cAlb = mix(vec3(0.86, 0.85, 0.8) * (0.86 + 0.14 * sin(qc.x * 90.0)), fabric * folds, side);
      cTrans = mix(0.85, 0.42, side);
    } else if (c < 0.62) {
      float sw = osz.x * (0.18 + 0.1 * gR2.y);
      cov = max(step(qc.x, sw) + step(osz.x - sw, qc.x), shut);
      cAlb = fabric * folds;
      cTrans = 0.42;
    } else if (c < 0.8) {
      float drop = gR2.y < 0.6 ? 1.0 : 0.55;
      float prof = mix(0.8, 0.55 + 0.45 * smoothstep(0.0, 0.7, fract(qc.y / 0.05)), clamp(0.02 / gPx, 0.0, 1.0));
      cov = step(osz.y * (1.0 - drop), qc.y) * 0.93;
      cAlb = vec3(0.85, 0.83, 0.76) * prof;
      cTrans = 0.5;
    } else if (c < 0.9) {
      cov = max(step(osz.y * (0.35 + 0.4 * gR2.y), qc.y), shut);
      cAlb = vec3(0.8, 0.74, 0.6);
      cTrans = 0.55;
    }
  } else if (kind > 1.5) {
    if (gR2.x < 0.6) {
      float drop = floor(gR2.y * 4.0) / 3.0;
      float prof = mix(0.8, 0.6 + 0.4 * smoothstep(0.0, 0.7, fract(qc.y / 0.05)), clamp(0.02 / gPx, 0.0, 1.0));
      cov = step(osz.y * (1.0 - drop), qc.y) * step(0.01, drop) * 0.9;
      cAlb = vec3(0.8, 0.79, 0.74) * prof;
      cTrans = 0.5;
    }
  } else {
    // A display stand just inside the glass with goods and price tickets on it, and a poster stuck to the glass.
    vec2 qd = q + gSl * 0.45;
    float ci = floor(qd.x / 0.62);
    vec3 ir = gH3(vec2(ci, seed));
    float stage = 0.12 + 0.3 * step(0.5, gH1(vec2(seed, 5.5)));
    float ih = stage + (0.16 + 0.6 * ir.x * ir.x) * step(0.3, ir.y);
    float item = step(abs(fract(qd.x / 0.62) - 0.5), 0.2 + 0.22 * ir.z) * step(qd.y, ih) * step(0.0, qd.y);
    float plinth = step(qd.y, stage);
    vec3 goods = mix(0.25 + 0.6 * gH3(vec2(ci, seed + 4.0)), vec3(0.45), 0.45);
    float ticket = step(abs(fract(qd.x / 0.62) - 0.5), 0.07) * step(abs(qd.y - stage - 0.06), 0.045) * step(0.3, ir.y);
    cov = max(item, plinth);
    cAlb = mix(mix(goods, vec3(0.9, 0.88, 0.8), ticket), vec3(0.3, 0.26, 0.22), plinth * (1.0 - ticket));
    cTrans = 1.0;
    vec2 pc = vec2(0.3 + gR2.x * max(osz.x - 0.6, 0.0), 0.95 + gR2.y * max(osz.y - 1.5, 0.0));
    vec2 pd = abs(q - pc);
    float poster = step(pd.x, 0.21) * step(pd.y, 0.3) * step(gR2.z, 0.55);
    vec3 pcol = gR2.z < 0.2 ? vec3(0.9, 0.8, 0.15) : (gR2.z < 0.4 ? vec3(0.85, 0.2, 0.15) : vec3(0.9));
    pcol *= 1.0 - 0.6 * step(fract((q.y - pc.y) / 0.12), 0.35) * step(pd.x, 0.15);
    cov = max(cov, poster);
    cAlb = mix(cAlb, pcol, poster);
  }

  // By day a room is a small fraction of the brightness of the wall around it; only what hangs in the window catches the light.
  float dayIn = kind < 0.5 ? 0.13 : (kind < 1.5 ? 0.26 : 0.17);
  vec3 inside = mix(room * dayIn, cAlb * (kind > 0.5 && kind < 1.5 ? 0.42 : 0.6), cov);
  vec3 lightCol;
  if (kind < 0.5) {
    lightCol = gR.z > 0.84
      ? vec3(0.35, 0.5, 1.0) * (0.8 + 0.3 * sin(uGlzTime * 9.0 + seed) * sin(uGlzTime * 5.3 + seed * 2.0))
      : vec3(1.0, 0.74, 0.44) * 1.5;
  } else if (kind < 1.5) {
    lightCol = mix(vec3(1.0, 0.9, 0.72), vec3(0.85, 0.95, 1.0), step(0.5, gR2.z)) * 1.25;
  } else {
    lightCol = vec3(0.92, 0.97, 1.0) * 1.5;
  }
  vec3 em = lit * lightCol * mix(room * (0.7 + 3.0 * glow), cAlb * cTrans, cov);
  // Shops and offices have their lights on in the daytime too: the fittings show against the dim ceiling.
  if (kind > 0.5) em += (1.0 - cov) * glow * (1.0 - gNight) * step(gR.y, 0.75) * vec3(0.16, 0.17, 0.16);
  if (spandrel > 0.5) {
    inside = gtint * 0.16;
    em = vec3(0.0);
  }
  // The head and jambs shade the top and edges of the glass.
  inside *= 1.0 - 0.4 * smoothstep(0.14, 0.0, osz.y - q.y) - 0.15 * smoothstep(0.07, 0.0, min(q.x, osz.x - q.x));

  float through = 1.0 - gFresnel(f0, gCos);
  gAlb = mix(inside * gtint * through, frameCol * (0.94 + 0.06 * gR.x), fr);
  gEm = em * gtint * through * (1.0 - fr);
  gRough = mix(0.06, 0.5, fr);
  gF0 = mix(vec3(f0) * mix(vec3(1.0), gtint, 0.6), vec3(0.04), fr);
  gTilt = (gH3(pane * 3.0 + gCell * 7.0 + gSeedV).xy - 0.5) * 0.022 * (1.0 - fr);

  gAlb = mix(gAlb, revAlb, isRev);
  gEm *= 1.0 - isRev;
  gRough = mix(gRough, 0.85, isRev);
  gF0 = mix(gF0, vec3(0.04), isRev);
  gTilt *= 1.0 - isRev;

  gAlb = mix(wallAlb, gAlb, inOpen);
  gEm *= inOpen;
  gRough = mix(0.86, gRough, inOpen);
  gF0 = mix(vec3(0.04), gF0, inOpen);
  gTilt *= inOpen;
} else if (gStyle < 0.5) {
  // ───── Bare glass ─────
  float frosted = step(0.5, gVar) * step(gVar, 1.5);
  float f0 = gVar > 1.5 ? 0.16 : 0.07;
  float through = 1.0 - gFresnel(f0, gCos);
  gAlb = mix(vec3(0.03, 0.045, 0.05), vec3(0.5, 0.52, 0.5), frosted) * through;
  gRough = mix(0.06, 0.45, frosted);
  gF0 = vec3(f0);
  float lit = step(gR.y, gLit * 0.3) * smoothstep(0.2, 0.5, gNight);
  gEm = lit * vec3(1.0, 0.8, 0.55) * 0.9 * through;
  gTilt = (gR.xz - 0.5) * 0.015;
} else if (gStyle < 6.5) {
  // ───── Panelled timber door in its architrave ─────
  float arch = 0.07;
  vec2 q = gP - vec2(arch, 0.0);
  vec2 sz = vec2(gw - 2.0 * arch, gh - arch);
  float inLeaf = gRect(q + vec2(0.0, 1.0), sz + vec2(0.0, 1.0), gPx);
  float fan = gVar > 1.5 && gVar < 2.5 ? 0.42 : 0.0;
  float leafH = sz.y - fan;
  float two = step(2.5, gVar);
  float lw = sz.x / (1.0 + two);
  vec2 lq = vec2(mod(clamp(q.x, 0.0, sz.x - 1e-3), lw), q.y);
  float xa = abs(lq.x - lw * 0.5);
  float dx = min(xa - mix(0.045, -1.0, two), (lw * 0.5 - 0.11) - xa);
  float dyL = min(lq.y - 0.2, 0.87 - lq.y);
  float dyU = min(lq.y - 1.03, (leafH - 0.11) - lq.y);
  float dP = min(dx, max(dyL, dyU));
  float inP = clamp(dP / gPx + 0.5, 0.0, 1.0);
  float mould = inP * (1.0 - clamp((dP - 0.028) / gPx + 0.5, 0.0, 1.0));
  vec3 leaf = gPaint * mix(1.0, 0.92, inP) * mix(1.0, 0.68, mould);
  float glz = gVar > 0.5 && gVar < 1.5 ? clamp((min(dx, dyU) - 0.028) / gPx + 0.5, 0.0, 1.0) : 0.0;
  float knob = 1.0 - smoothstep(0.03, 0.03 + gPx, length(lq - vec2(mix(lw - 0.065, 0.065, two * step(lw, q.x)), 1.0)));
  float slot = step(abs(lq.x - lw * 0.5), 0.11) * step(abs(lq.y - 0.95), 0.018) * (1.0 - two);
  leaf = mix(leaf, vec3(0.55, 0.43, 0.18), knob);
  leaf = mix(leaf, vec3(0.04), slot);
  leaf *= 1.0 - 0.6 * gBar(min(lq.x, lw - lq.x), 0.006, gPx);
  vec3 trimc = vec3(0.84, 0.82, 0.76);
  // Fanlight over a transom.
  vec2 fq = vec2(q.x, q.y - leafH - 0.05);
  float inFan = step(0.01, fan) * step(0.0, fq.y);
  float fanGlass = inFan * (1.0 - gRing(fq, vec2(sz.x, fan - 0.05), 0.03, gPx));
  float bar = step(0.01, fan) * step(leafH, q.y);
  vec3 col = mix(leaf, trimc, bar);
  float glassy = max(glz, fanGlass);
  float through = 1.0 - gFresnel(0.06, gCos);
  col = mix(col, vec3(0.16, 0.18, 0.17) * through, glassy);
  gAlb = mix(trimc * (0.92 + 0.08 * step(gP.y, gh - arch)), col, inLeaf);
  gRough = mix(0.5, mix(0.38, 0.2, glassy), inLeaf);
  gF0 = vec3(mix(0.04, 0.06, glassy * inLeaf));
  float lit = step(gR.y, 0.2 + gLit * 0.2) * smoothstep(0.2, 0.5, gNight);
  gEm = glassy * inLeaf * lit * vec3(1.0, 0.76, 0.45) * 0.9 * through;
} else if (gStyle < 7.5) {
  // ───── Glazed shop door, flush or at the back of a tiled recess ─────
  float deep = (gVar > 0.5 && gVar < 1.5) || gVar > 2.5 ? 0.85 : 0.04;
  float two = step(1.5, gVar);
  vec2 full = vec2(gw, gh);
  vec2 q = gP + gSl * deep;
  vec2 over = max(-q, q - full);
  float isRev = clamp(max(over.x, over.y) / gPx + 0.5, 0.0, 1.0);
  float tx = gSl.x > 0.0 ? (gw - gP.x) / max(gSl.x, 1e-3) : -gP.x / min(gSl.x, -1e-3);
  float ty = gSl.y > 0.0 ? (gh - gP.y) / max(gSl.y, 1e-3) : -gP.y / min(gSl.y, -1e-3);
  float tr = min(tx, ty);
  vec3 hp = vec3(gP + gSl * tr, tr);
  vec3 revA;
  float revGlass = 0.0;
  if (tx < ty) {
    // Display-window return above a stall riser.
    float riser = step(hp.y, 0.5);
    revA = mix(vec3(0.03, 0.04, 0.045), gPaint * 0.8, riser);
    revGlass = 1.0 - riser;
  } else if (gSl.y > 0.0) {
    revA = vec3(0.4, 0.38, 0.33);
  } else {
    vec2 tl = floor(vec2(hp.x, hp.z) / 0.15);
    revA = mix(vec3(0.62, 0.58, 0.5), mix(vec3(0.45, 0.2, 0.14), vec3(0.1), step(0.5, gR.x)), mod(tl.x + tl.y, 2.0)) * 0.8;
  }
  revA *= 1.0 - 0.35 * clamp(tr / max(deep, 0.05), 0.0, 1.0);
  float fan = gh > 2.45 ? gh - 2.1 : 0.0;
  float dh = gh - fan;
  float lw = gw / (1.0 + two);
  vec2 lq = vec2(mod(clamp(q.x, 0.0, gw - 1e-3), lw), q.y);
  float alu = step(1.5, gVar) * step(gVar, 2.5);
  float st = mix(0.085, 0.045, alu);
  float kick = mix(0.32, 0.12, alu);
  float dIn = min(min(lq.x - st, lw - st - lq.x), min(lq.y - kick, dh - st - lq.y));
  float dF = min(min(q.x - 0.04, gw - 0.04 - q.x), min(q.y - dh - 0.04, gh - 0.04 - q.y));
  float g = max(clamp(dIn / gPx + 0.5, 0.0, 1.0), fan > 0.0 ? clamp(dF / gPx + 0.5, 0.0, 1.0) : 0.0);
  float handle = step(abs(lq.x - (lw - st * 0.5)), 0.018) * step(abs(lq.y - 1.05), 0.15);
  vec3 frameC = gPaint * (1.0 - 0.5 * gBar(min(lq.x, lw - lq.x), 0.006, gPx));
  frameC = mix(frameC, vec3(0.6, 0.55, 0.4), handle);
  float glow;
  vec3 room = gRoom(q, gSl, full, vec3(1.5, 0.0, 0.4), 5.0, gR.x * 31.0, 1.0, glow);
  float lit = step(gH1(gSeedV + 2.5), gLit * 0.31) * smoothstep(0.2, 0.5, gNight);
  float through = 1.0 - gFresnel(0.055, gCos);
  gAlb = mix(frameC, room * 0.5 * through, g);
  gEm = g * lit * mix(vec3(1.0, 0.9, 0.72), vec3(0.85, 0.95, 1.0), step(0.5, gR2.z)) * 2.0 * room * (0.75 + 2.5 * glow) * through;
  gRough = mix(0.45, 0.06, g);
  gF0 = vec3(mix(0.04, 0.055, g));
  gTilt = (gR.xz - 0.5) * 0.02 * g;
  gAlb = mix(gAlb, revA, isRev);
  gEm *= 1.0 - isRev;
  gRough = mix(gRough, mix(0.8, 0.07, revGlass), isRev);
  gF0 = mix(gF0, vec3(mix(0.04, 0.06, revGlass)), isRev);
  gTilt *= 1.0 - isRev;
} else if (gStyle < 8.5) {
  // ───── Roller door / sliding timber door ─────
  vec3 c = gPaint;
  if (gVar > 2.5) {
    float bd = abs(fract(gP.x / 0.14) - 0.5);
    c *= (0.9 + 0.2 * gH1(vec2(floor(gP.x / 0.14), gSeedV.x))) * (1.0 - 0.5 * gBar((0.5 - bd) * 0.14, 0.004, gPx));
    c *= 1.0 - 0.14 * max(gBar(gP.y - 0.35, 0.07, gPx), gBar(gP.y - (gh - 0.45), 0.07, gPx));
    c *= 0.72 + 0.28 * smoothstep(0.0, 0.9, gP.y);
    gAlb = mix(c, vec3(0.1, 0.1, 0.11), step(gh - 0.12, gP.y));
    gRough = 0.8;
  } else {
    float openY = gh * (gVar < 0.5 ? 0.0 : (gVar < 1.5 ? 0.45 : 0.88));
    float slat = fract(gP.y / 0.075);
    float prof = clamp(0.0125 / gPx, 0.0, 1.0);
    c *= mix(0.9, 0.72 + 0.4 * sin(slat * 3.14159), prof);
    // Dirt runs down from the lintel, rust blooms in patches, and the bottom edge is grubby.
    c *= 1.0 - 0.14 * gH1(vec2(floor(gP.x * 9.0), gSeedV.y + gCell.x)) * smoothstep(gh, gh * 0.3, gP.y);
    c = mix(c, vec3(0.2, 0.1, 0.05), 0.5 * smoothstep(0.86, 1.0, gH1(vec2(floor(gP.x * 6.0), floor(gP.y * 2.0) + gSeedV.x))));
    c *= 0.72 + 0.28 * clamp((gP.y - openY) / 0.5, 0.0, 1.0);
    c = mix(vec3(0.09), c, step(openY + 0.07, gP.y));
    float guide = step(gP.x, 0.07) + step(gw - 0.07, gP.x);
    c = mix(c, vec3(0.2, 0.21, 0.22), guide);
    gAlb = c;
    gRough = 0.5;
    gF0 = vec3(0.06);
    gTilt = vec2(0.0, (slat - 0.5) * 0.5 * prof * (1.0 - guide));
    if (gP.y < openY && guide < 0.5) {
      float glow;
      vec3 room = gRoom(gP, gSl, vec2(gw, openY), vec3(4.0, 0.0, 2.5), 9.0, gR.x * 17.0, 3.0, glow);
      gAlb = room * 0.2;
      gRough = 0.9;
      gTilt = vec2(0.0);
      float lit = step(gR.y, gLit * 0.3) * smoothstep(0.2, 0.5, gNight);
      gEm = lit * room * (0.75 + 2.5 * glow) * vec3(1.0, 0.88, 0.62) * 0.9;
    }
  }
} else if (gStyle < 9.5) {
  // ───── Light box ─────
  gAlb = mix(vec3(0.9), gPaint, 0.35) * 0.85;
  gRough = 0.4;
  gEm = gPaint * (0.8 + 1.7 * gLit) * gNight * step(0.06, gR.x);
} else if (gStyle < 10.5) {
  // ───── Steel-framed factory glazing ─────
  vec2 full = vec2(gw, gh);
  float fr = gRing(gP, full, 0.04, gPx);
  vec2 pn = max(vec2(1.0), floor(full / (gVar > 0.5 ? vec2(0.62, 0.9) : vec2(0.46, 0.6)) + 0.5));
  vec2 ps = full / pn;
  vec2 pd = gP - ps * floor(gP / ps + 0.5);
  fr = max(fr, max(gBar(pd.x, 0.011, gPx), gBar(pd.y, 0.011, gPx)));
  vec3 pr = gH3(floor(gP / ps) + gCell * 13.0 + gSeedV * 3.0);
  float through = 1.0 - gFresnel(0.06, gCos);
  vec3 gl = vec3(0.05, 0.065, 0.06) + 0.1 * pr.x;
  gl = mix(gl, vec3(0.5, 0.52, 0.5), step(0.95, pr.y));
  gl = mix(gl, vec3(0.01), step(pr.y, 0.04));
  float lit = step(gR.y, gLit * 0.3) * smoothstep(0.2, 0.5, gNight);
  gAlb = mix(gl * through, gPaint, fr);
  gRough = mix(0.16 + 0.14 * pr.x, 0.6, fr);
  gF0 = vec3(mix(0.06, 0.04, fr));
  gEm = (1.0 - fr) * lit * vec3(1.0, 0.85, 0.55) * (0.5 + 0.5 * pr.z) * step(0.04, pr.y) * through;
  gTilt = (pr.xz - 0.5) * 0.012 * (1.0 - fr);
} else if (gStyle < 11.5) {
  // ───── Louvres ─────
  float fr = gRing(gP, vec2(gw, gh), 0.05, gPx);
  float shade = mix(0.55, 0.22 + 0.8 * fract(gP.y / 0.11), clamp(0.03 / gPx, 0.0, 1.0));
  gAlb = mix(gPaint * shade, gPaint, fr);
} else if (gStyle < 12.5) {
  // ───── Fretwork (cut out) ─────
  float a;
  if (gVar < 0.5) {
    a = max(max(step(gh - 0.035, gP.y), step(gP.y, 0.03)), step(abs(fract(gP.x / 0.09) - 0.5), 0.14));
  } else if (gVar < 2.5) {
    vec2 n = (gVar < 1.5 ? vec2(gw - gP.x, gP.y) : gP) / vec2(gw, gh);
    a = step(1.0, length(n)) * (1.0 - step(length(n - vec2(0.84)), 0.085));
  } else {
    float sc = abs(fract(gP.x / 0.16) - 0.5) * 2.0;
    a = step(0.07 * sc * sc, gP.y) * (1.0 - step(length(vec2((fract(gP.x / 0.16) - 0.5) * 0.16, gP.y - 0.1)), 0.022));
  }
  if (a < 0.5) discard;
  gRough = 0.5;
} else if (gStyle < 13.5) {
  // ───── Railings (cut out) ─────
  float a;
  if (gVar < 0.5) {
    a = max(max(step(gh - 0.06, gP.y), step(abs(gP.y - 0.1), 0.03)), step(abs(fract(gP.x / 0.11) - 0.5), 0.14) * step(0.1, gP.y));
  } else if (gVar < 1.5) {
    float fx = abs(fract(gP.x / 0.14) - 0.5) * 0.14;
    a = step(fx, 0.04) * step(gP.y, gh - fx * 1.2);
    a = max(a, step(abs(gP.y - 0.25), 0.035) + step(abs(gP.y - (gh - 0.3)), 0.035));
  } else if (gVar < 2.5) {
    a = max(step(abs(fract((gP.x + gP.y) / 0.17) - 0.5), 0.1), step(abs(fract((gP.x - gP.y) / 0.17) - 0.5), 0.1));
    a = max(a, step(gh - 0.05, gP.y) + step(gP.y, 0.05));
  } else {
    vec2 c = vec2(fract(gP.x / gh), gP.y / gh);
    a = step(min(abs(c.x - c.y), abs(c.x + c.y - 1.0)) * gh, 0.028);
    a = max(a, step(gh - 0.05, gP.y) + step(gP.y, 0.05) + step(min(c.x, 1.0 - c.x) * gh, 0.025));
  }
  if (a < 0.5) discard;
  gRough = 0.5;
} else {
  // ───── Pointed-arch leadlight ─────
  float sy = max(0.0, gh - gw * 0.87);
  float d1 = length(gP - vec2(0.0, sy));
  float d2 = length(gP - vec2(gw, sy));
  float dEdge = gP.y > sy ? gw - max(d1, d2) : min(min(gP.x, gw - gP.x), gP.y);
  float inside = clamp(dEdge / gPx + 0.5, 0.0, 1.0);
  float fr = 1.0 - clamp((dEdge - 0.05) / gPx + 0.5, 0.0, 1.0);
  vec2 dq = vec2(gP.x / 0.11 + gP.y / 0.16, gP.x / 0.11 - gP.y / 0.16);
  vec2 dd = abs(fract(dq) - 0.5);
  float lead = max(gBar((0.5 - dd.x) * 0.1, 0.006, gPx), gBar((0.5 - dd.y) * 0.1, 0.006, gPx));
  vec3 pr = gH3(floor(dq) + gSeedV * 7.0 + gCell);
  vec3 gl = mix(vec3(0.05, 0.07, 0.07), mix(vec3(0.35, 0.1, 0.08), vec3(0.08, 0.14, 0.4), pr.y), step(0.8, pr.x));
  gl = mix(gl, vec3(0.45, 0.35, 0.1), step(0.93, pr.x));
  float through = 1.0 - gFresnel(0.06, gCos);
  float lit = step(gR.y, gLit * 0.3) * smoothstep(0.2, 0.5, gNight);
  vec3 a = mix(gl * through, vec3(0.07), lead);
  a = mix(a, gPaint * 0.8, fr);
  gAlb = mix(gPaint, a, inside);
  gEm = inside * (1.0 - fr) * (1.0 - lead) * lit * (0.25 + gl * 4.0) * vec3(1.0, 0.8, 0.5) * 0.8;
  gRough = mix(0.85, mix(0.15, 0.7, max(fr, lead)), inside);
  gF0 = vec3(mix(0.04, 0.06, inside * (1.0 - fr)));
}
diffuseColor.rgb = gAlb;
`;

const time = { value: 0 };

/** Patches a MeshStandardMaterial's shader into the facade-detail shader. */
export function patchGlazing(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uGlzTime = time;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <color_fragment>', FRAGMENT_MAIN)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * (gT * gTilt.x + gB * gTilt.y));')
    .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = gEm;')
    .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor = gF0;\nmaterial.specularColorBlended = gF0;');
}

/**
 * The one real material. Its `emissive` is white and its `emissiveIntensity` is driven 0..1 by the night
 * factor (the shader reads it as "how dark is it"), so register it as a night emitter with base 1.
 */
export function createGlazingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0 });
  m.envMapIntensity = 1.25;
  m.onBeforeRender = () => {
    time.value = (performance.now() / 1000) % 3600;
  };
  return m;
}
