// @ts-check
/**
 * A small software rasteriser for composing leaf sprites into branch pictures (see ../fetch-foliage.mjs).
 * Canvases hold premultiplied RGBA floats; colours are sRGB-encoded 0..1 throughout.
 */

/** Deterministic random numbers (mulberry32). */
export function rng(/** @type {number} */ seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    range: (/** @type {number} */ lo, /** @type {number} */ hi) => lo + (hi - lo) * next(),
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: /** @type {<T>(list: T[]) => T} */ ((list) => list[Math.floor(next() * list.length) % list.length]),
  });
}

/**
 * @typedef {object} MipSprite
 * @property {{ w: number, h: number, px: Float32Array }[]} levels  Premultiplied RGBA, each half the size of the last.
 * @property {number} w
 * @property {number} h
 * @property {[number, number, number]} mean   Mean colour of the opaque pixels.
 * @property {number} px0   Pivot (stem) x in level-0 pixels.
 * @property {number} py0   Pivot (stem) y in level-0 pixels.
 */

/**
 * Prepares a cut-out sprite (straight alpha, stem at the bottom centre) for stamping at any size.
 * @param {{ w: number, h: number, px: Float32Array }} sprite
 * @param {{ pivot?: 'stem' | 'centre' }} [options]
 * @returns {MipSprite}
 */
export function prepare(sprite, options = {}) {
  const { w, h } = sprite;
  const pre = new Float32Array(w * h * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const a = sprite.px[i * 4 + 3];
    pre[i * 4] = sprite.px[i * 4] * a;
    pre[i * 4 + 1] = sprite.px[i * 4 + 1] * a;
    pre[i * 4 + 2] = sprite.px[i * 4 + 2] * a;
    pre[i * 4 + 3] = a;
    if (a > 0.5) {
      r += sprite.px[i * 4];
      g += sprite.px[i * 4 + 1];
      b += sprite.px[i * 4 + 2];
      n++;
    }
  }
  const levels = [{ w, h, px: pre }];
  while (levels[levels.length - 1].w > 6 && levels[levels.length - 1].h > 6) {
    const src = levels[levels.length - 1];
    const dw = Math.floor(src.w / 2);
    const dh = Math.floor(src.h / 2);
    const dst = new Float32Array(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        for (let c = 0; c < 4; c++) {
          dst[(y * dw + x) * 4 + c] =
            (src.px[(y * 2 * src.w + x * 2) * 4 + c] + src.px[(y * 2 * src.w + x * 2 + 1) * 4 + c] + src.px[((y * 2 + 1) * src.w + x * 2) * 4 + c] + src.px[((y * 2 + 1) * src.w + x * 2 + 1) * 4 + c]) / 4;
        }
      }
    }
    levels.push({ w: dw, h: dh, px: dst });
  }
  const centre = options.pivot === 'centre';
  return { levels, w, h, mean: [r / Math.max(1, n), g / Math.max(1, n), b / Math.max(1, n)], px0: w / 2, py0: centre ? h / 2 : h - 3 };
}

export class Canvas {
  /**
   * @param {number} w
   * @param {number} h
   */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float32Array(w * h * 4);
    /** Keep-out margin: stamps that would touch it are refused, so nothing is cut off by the cell edge. */
    this.margin = 3;
  }

  /**
   * Draws `sprite` with its pivot at (x, y), its stem-to-tip axis turned `angle` radians clockwise from
   * straight up, scaled so one sprite pixel covers `scale` canvas pixels. Returns false (and draws nothing)
   * if it would cross the canvas edge.
   * @param {MipSprite} sprite
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   * @param {number} scale
   * @param {{ mul?: [number, number, number], flip?: boolean, alpha?: number, squash?: number, clip?: boolean }} [o]
   */
  stamp(sprite, x, y, angle, scale, o = {}) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const squash = o.squash ?? 1; // narrows the sprite across its axis (a leaf seen at a slant)
    // Sprite space: u to the right of the pivot, t up from the pivot, in level-0 pixels.
    const toCanvas = (/** @type {number} */ u, /** @type {number} */ t) => [x + scale * (u * squash * c + t * s), y + scale * (u * squash * s - t * c)];
    const corners = [toCanvas(-sprite.px0, sprite.py0), toCanvas(sprite.w - sprite.px0, sprite.py0), toCanvas(-sprite.px0, sprite.py0 - sprite.h), toCanvas(sprite.w - sprite.px0, sprite.py0 - sprite.h)];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of corners) {
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
    }
    const m = this.margin;
    if (!o.clip && (minX < m || minY < m || maxX > this.w - 1 - m || maxY > this.h - 1 - m)) return false;
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(this.w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    // Pick the mip whose texels are about one canvas pixel.
    const li = Math.min(sprite.levels.length - 1, Math.max(0, Math.round(Math.log2(1 / Math.min(scale, scale * squash)) - 0.35)));
    const level = sprite.levels[li];
    const k = 1 / (1 << li);
    const mul = o.mul ?? [1, 1, 1];
    const alpha = o.alpha ?? 1;
    const flip = o.flip ? -1 : 1;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - x;
        const dy = py - y;
        const u = ((dx * c + dy * s) / (scale * squash)) * flip;
        const t = (dx * s - dy * c) / scale;
        // Level-0 pixel position, then into the chosen level (texel centres at +0.5).
        const sx = (u + sprite.px0) * k - 0.5;
        const sy = (sprite.py0 - t) * k - 0.5;
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        if (ix < -1 || iy < -1 || ix >= level.w || iy >= level.h) continue;
        const fx = sx - ix;
        const fy = sy - iy;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let q = 0; q < 4; q++) {
          const tx = ix + (q & 1);
          const ty = iy + (q >> 1);
          if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) continue;
          const wgt = (q & 1 ? fx : 1 - fx) * (q >> 1 ? fy : 1 - fy);
          const i = (ty * level.w + tx) * 4;
          r += wgt * level.px[i];
          g += wgt * level.px[i + 1];
          b += wgt * level.px[i + 2];
          a += wgt * level.px[i + 3];
        }
        if (a <= 0.002) continue;
        a *= alpha;
        const o4 = (py * this.w + px) * 4;
        const inv = 1 - a;
        this.px[o4] = r * alpha * mul[0] + this.px[o4] * inv;
        this.px[o4 + 1] = g * alpha * mul[1] + this.px[o4 + 1] * inv;
        this.px[o4 + 2] = b * alpha * mul[2] + this.px[o4 + 2] * inv;
        this.px[o4 + 3] = a + this.px[o4 + 3] * inv;
      }
    }
    return true;
  }

  /**
   * A tapered, anti-aliased stroke (twig, stalk, leaf rib).
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} w0  Full width at the start, in pixels.
   * @param {number} w1
   * @param {[number, number, number]} color
   * @param {number} [alpha]
   */
  stroke(x0, y0, x1, y1, w0, w1, color, alpha = 1) {
    const pad = Math.max(w0, w1) / 2 + 1.5;
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
    const bx1 = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + pad));
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
    const by1 = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + pad));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1e-6;
    for (let py = by0; py <= by1; py++) {
      for (let px = bx0; px <= bx1; px++) {
        const t = Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / len2));
        const d = Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
        const half = (w0 + (w1 - w0) * t) / 2;
        const a = Math.min(1, Math.max(0, half - d + 0.5)) * alpha;
        if (a <= 0) continue;
        const o4 = (py * this.w + px) * 4;
        const inv = 1 - a;
        this.px[o4] = color[0] * a + this.px[o4] * inv;
        this.px[o4 + 1] = color[1] * a + this.px[o4 + 1] * inv;
        this.px[o4 + 2] = color[2] * a + this.px[o4 + 2] * inv;
        this.px[o4 + 3] = a + this.px[o4 + 3] * inv;
      }
    }
  }

  /**
   * A soft-edged ellipse (petal, pod, berry), long axis turned `angle` clockwise from up.
   * @param {number} x
   * @param {number} y
   * @param {number} rx  Half-width across the axis.
   * @param {number} ry  Half-length along the axis.
   * @param {number} angle
   * @param {[number, number, number]} color
   * @param {number} [alpha]
   */
  blob(x, y, rx, ry, angle, color, alpha = 1) {
    const r = Math.max(rx, ry) + 1.5;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let py = Math.max(0, Math.floor(y - r)); py <= Math.min(this.h - 1, Math.ceil(y + r)); py++) {
      for (let px = Math.max(0, Math.floor(x - r)); px <= Math.min(this.w - 1, Math.ceil(x + r)); px++) {
        const dx = px - x;
        const dy = py - y;
        const u = (dx * c + dy * s) / rx;
        const t = (dx * s - dy * c) / ry;
        const d = Math.sqrt(u * u + t * t);
        const a = Math.min(1, Math.max(0, (1 - d) * Math.min(rx, ry) + 0.5)) * alpha;
        if (a <= 0) continue;
        const o4 = (py * this.w + px) * 4;
        const inv = 1 - a;
        this.px[o4] = color[0] * a + this.px[o4] * inv;
        this.px[o4 + 1] = color[1] * a + this.px[o4 + 1] * inv;
        this.px[o4 + 2] = color[2] * a + this.px[o4 + 2] * inv;
        this.px[o4 + 3] = a + this.px[o4 + 3] * inv;
      }
    }
  }

  /** Fraction of pixels more than half opaque. */
  coverage() {
    let n = 0;
    for (let i = 3; i < this.px.length; i += 4) if (this.px[i] > 0.5) n++;
    return n / (this.w * this.h);
  }
}
