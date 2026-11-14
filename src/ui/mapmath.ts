/**
 * Pure geometry for the minimap and the island map. No DOM here, so it is unit-testable.
 *
 * World: +x east, -z north. Heading h: forward = (sin h, cos h); h = PI faces north.
 * Screen: +x right, +y down.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * World position → minimap offset from the centre, in pixels, with the camera heading pointing up.
 * `scale` is pixels per metre.
 */
export function worldToMinimap(wx: number, wz: number, px: number, pz: number, heading: number, scale: number, out: Point): Point {
  const dx = wx - px;
  const dz = wz - pz;
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  // right = (-cos h, sin h), forward = (sin h, cos h); forward is up the screen.
  out.x = (-dx * c + dz * s) * scale;
  out.y = -(dx * s + dz * c) * scale;
  return out;
}

/**
 * The same transform as a 2D canvas matrix [a, b, c, d, e, f] (for `setTransform`), mapping world (x, z)
 * straight to canvas pixels with the player at (cx, cy).
 */
export function minimapMatrix(px: number, pz: number, heading: number, scale: number, cx: number, cy: number, out: number[]): number[] {
  const s = Math.sin(heading) * scale;
  const c = Math.cos(heading) * scale;
  out[0] = -c;
  out[1] = -s;
  out[2] = s;
  out[3] = -c;
  out[4] = cx - (out[0] * px + out[2] * pz);
  out[5] = cy - (out[1] * px + out[3] * pz);
  return out;
}

/** Applies a canvas matrix to a point (for tests and hit-testing). */
export function applyMatrix(m: ArrayLike<number>, x: number, y: number, out: Point): Point {
  out.x = m[0] * x + m[2] * y + m[4];
  out.y = m[1] * x + m[3] * y + m[5];
  return out;
}

/**
 * Keeps an offset inside a square of half-size `half`, pulling it back along the line to the centre.
 * Returns true if the point had to be moved (the blip is off the map).
 */
export function clampToSquare(p: Point, half: number): boolean {
  const m = Math.max(Math.abs(p.x), Math.abs(p.y));
  if (m <= half || m === 0) return false;
  const k = half / m;
  p.x *= k;
  p.y *= k;
  return true;
}

/** As `clampToSquare`, for a circular rim. */
export function clampToCircle(p: Point, radius: number): boolean {
  const d = Math.hypot(p.x, p.y);
  if (d <= radius || d === 0) return false;
  const k = radius / d;
  p.x *= k;
  p.y *= k;
  return true;
}

/** Screen rotation (radians, clockwise from up) of the player arrow on a camera-up minimap. */
export function arrowAngle(cameraHeading: number, playerHeading: number): number {
  return cameraHeading - playerHeading;
}

/** Screen rotation (radians, clockwise from up) for a heading on a north-up map. */
export function northUpAngle(heading: number): number {
  // forward = (sin h, cos h) in (x, z); z points down the screen, so north (h = PI) is 0 and east (h = PI/2) is +90°.
  return Math.PI - heading;
}

/** Metres from the centre to the edge of the minimap: pulls out as the vehicle speeds up. */
export function minimapReach(speed: number, onFoot = 150, flatOut = 330): number {
  const t = Math.min(1, Math.max(0, (Math.abs(speed) - 4) / 34));
  return onFoot + (flatOut - onFoot) * t * t * (3 - 2 * t);
}

function distanceToSegmentSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len = dx * dx + dz * dz;
  const t = len > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len)) : 0;
  const ex = px - ax - dx * t;
  const ez = pz - az - dz * t;
  return ex * ex + ez * ez;
}

/**
 * Douglas–Peucker on a flat [x0, z0, x1, z1, …] polyline: drops points that are within `tolerance` metres
 * of the simplified line. Always keeps both ends.
 */
export function simplifyPolyline(points: ArrayLike<number>, tolerance: number): Float32Array {
  const n = points.length >> 1;
  if (n <= 2) return Float32Array.from(points as ArrayLike<number>);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const tolSq = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    let worst = -1;
    let worstD = tolSq;
    const ax = points[first * 2];
    const az = points[first * 2 + 1];
    const bx = points[last * 2];
    const bz = points[last * 2 + 1];
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegmentSq(points[i * 2], points[i * 2 + 1], ax, az, bx, bz);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push(first, worst, worst, last);
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += keep[i];
  const out = new Float32Array(count * 2);
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out[o++] = points[i * 2];
    out[o++] = points[i * 2 + 1];
  }
  return out;
}

export interface MapView {
  /** World point at the centre of the view. */
  x: number;
  z: number;
  /** Pixels per metre. */
  scale: number;
}

/** Zooms a north-up view by `factor`, keeping the world point under the cursor (sx, sy from the view centre) fixed. */
export function zoomAbout(view: MapView, factor: number, sx: number, sy: number, minScale: number, maxScale: number): void {
  const next = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  if (next === view.scale) return;
  const wx = view.x + sx / view.scale;
  const wz = view.z + sy / view.scale;
  view.scale = next;
  view.x = wx - sx / next;
  view.z = wz - sy / next;
}

function clampAxis(value: number, half: number, lo: number, hi: number, slack: number): number {
  const give = half * slack;
  const a = lo + half - give;
  const b = hi - half + give;
  // The view is wider than the world on this axis: sit on the middle.
  return a > b ? (lo + hi) / 2 : Math.min(b, Math.max(a, value));
}

/**
 * Keeps a north-up view over the world rectangle. `halfW` / `halfH` are half the viewport in pixels. The view
 * may overhang the edge by `slack` of its own half-size; once the whole world fits, it is centred.
 */
export function clampView(view: MapView, halfW: number, halfH: number, minX: number, maxX: number, minZ: number, maxZ: number, slack = 0.08): void {
  view.x = clampAxis(view.x, halfW / view.scale, minX, maxX, slack);
  view.z = clampAxis(view.z, halfH / view.scale, minZ, maxZ, slack);
}

const NICE = [50, 100, 200, 500, 1000, 2000, 5000];

/** A round distance for the map's scale bar that fits in `maxPx` pixels. */
export function scaleBar(pxPerMetre: number, maxPx: number): { metres: number; label: string } {
  let metres = NICE[0];
  for (const candidate of NICE) if (candidate * pxPerMetre <= maxPx) metres = candidate;
  return { metres, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}
