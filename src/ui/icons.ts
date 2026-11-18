import type { BlipKind } from '../core/types';

/**
 * Map symbols, drawn in code. One set serves the minimap, the island map and its legend, so they are
 * painted once into a sprite strip per size and blitted from there.
 */
export type IconKind = BlipKind | 'gunshop' | 'spray' | 'north' | 'waypoint';

export const ICON_KINDS: readonly IconKind[] = ['mission', 'objective', 'safehouse', 'shop', 'gunshop', 'spray', 'police', 'hospital', 'vehicle', 'enemy', 'friend', 'pickup', 'north', 'waypoint'];

/** The waypoint pen: a ballpoint blue that reads on cream paper and over every road colour. */
export const PEN = '#2b50b8';

const INK = '#10141a';
const PAPER = '#f4eedd';
const POST = '#f4c417';
const RUST = '#c2462b';
const TEAL = '#2f9d96';
const GOLD = '#e8a92e';

type G = CanvasRenderingContext2D;

function poly(g: G, cx: number, cy: number, s: number, pts: number[]) {
  g.beginPath();
  g.moveTo(cx + pts[0] * s, cy + pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(cx + pts[i] * s, cy + pts[i + 1] * s);
  g.closePath();
}

function fillStroke(g: G, fill: string, s: number, stroke = INK) {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = Math.max(1, s * 0.085);
  g.strokeStyle = stroke;
  g.stroke();
}

function disc(g: G, cx: number, cy: number, r: number) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
}

function shop(g: G, cx: number, cy: number, s: number, awning: string) {
  poly(g, cx, cy, s, [-0.34, -0.08, 0.34, -0.08, 0.34, 0.38, -0.34, 0.38]);
  fillStroke(g, PAPER, s);
  poly(g, cx, cy, s, [-0.42, -0.06, -0.3, -0.38, 0.3, -0.38, 0.42, -0.06]);
  fillStroke(g, awning, s);
  g.fillStyle = INK;
  g.fillRect(cx - s * 0.08, cy + s * 0.12, s * 0.16, s * 0.26);
}

/** Paints one symbol centred on (cx, cy), `s` pixels across. */
export function paintIcon(g: G, kind: IconKind, cx: number, cy: number, s: number) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  switch (kind) {
    case 'mission':
      // AA-yellow diamond: somebody has a job going.
      poly(g, cx, cy, s, [0, -0.44, 0.44, 0, 0, 0.44, -0.44, 0]);
      fillStroke(g, POST, s);
      g.fillStyle = INK;
      g.fillRect(cx - s * 0.05, cy - s * 0.22, s * 0.1, s * 0.26);
      g.fillRect(cx - s * 0.05, cy + s * 0.1, s * 0.1, s * 0.1);
      break;
    case 'objective':
      disc(g, cx, cy, s * 0.4);
      fillStroke(g, POST, s);
      disc(g, cx, cy, s * 0.15);
      g.fillStyle = INK;
      g.fill();
      break;
    case 'safehouse':
      poly(g, cx, cy, s, [0, -0.44, 0.44, -0.04, 0.3, -0.04, 0.3, 0.38, -0.3, 0.38, -0.3, -0.04, -0.44, -0.04]);
      fillStroke(g, PAPER, s);
      g.fillStyle = TEAL;
      g.fillRect(cx - s * 0.09, cy + s * 0.08, s * 0.18, s * 0.3);
      break;
    case 'shop':
      shop(g, cx, cy, s, GOLD);
      break;
    case 'gunshop':
      shop(g, cx, cy, s, RUST);
      break;
    case 'spray':
      shop(g, cx, cy, s, TEAL);
      break;
    case 'police':
      // A blue beacon lamp on its base.
      g.beginPath();
      g.arc(cx, cy + s * 0.06, s * 0.3, Math.PI, 0);
      g.closePath();
      fillStroke(g, '#3f8cff', s);
      poly(g, cx, cy, s, [-0.4, 0.06, 0.4, 0.06, 0.4, 0.32, -0.4, 0.32]);
      fillStroke(g, INK, s, PAPER);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(cx - s * 0.16, cy - s * 0.12, s * 0.09, s * 0.12);
      break;
    case 'hospital':
      poly(g, cx, cy, s, [-0.38, -0.38, 0.38, -0.38, 0.38, 0.38, -0.38, 0.38]);
      fillStroke(g, '#ffffff', s);
      g.fillStyle = '#d8392b';
      g.fillRect(cx - s * 0.09, cy - s * 0.27, s * 0.18, s * 0.54);
      g.fillRect(cx - s * 0.27, cy - s * 0.09, s * 0.54, s * 0.18);
      break;
    case 'vehicle':
      poly(g, cx, cy, s, [-0.2, -0.42, 0.2, -0.42, 0.26, -0.2, 0.26, 0.38, -0.26, 0.38, -0.26, -0.2]);
      fillStroke(g, '#7cc4f0', s);
      g.fillStyle = INK;
      g.fillRect(cx - s * 0.16, cy - s * 0.16, s * 0.32, s * 0.12);
      break;
    case 'enemy':
      disc(g, cx, cy, s * 0.3);
      fillStroke(g, '#e23b2e', s);
      break;
    case 'friend':
      disc(g, cx, cy, s * 0.3);
      fillStroke(g, '#39b3ab', s);
      break;
    case 'pickup':
      poly(g, cx, cy, s, [0, -0.28, 0.28, 0, 0, 0.28, -0.28, 0]);
      fillStroke(g, PAPER, s);
      break;
    case 'waypoint': {
      // The player's own mark: two ballpoint strokes, the way anyone X-es a road map.
      const r = s * 0.3;
      g.beginPath();
      g.moveTo(cx - r, cy - r);
      g.lineTo(cx + r, cy + r);
      g.moveTo(cx + r, cy - r);
      g.lineTo(cx - r, cy + r);
      g.lineCap = 'round';
      g.lineWidth = Math.max(2, s * 0.16);
      g.strokeStyle = PAPER;
      g.stroke();
      g.lineWidth = Math.max(1.2, s * 0.1);
      g.strokeStyle = PEN;
      g.stroke();
      break;
    }
    case 'north':
      disc(g, cx, cy, s * 0.42);
      fillStroke(g, PAPER, s, INK);
      g.beginPath();
      g.moveTo(cx - s * 0.15, cy + s * 0.2);
      g.lineTo(cx - s * 0.15, cy - s * 0.2);
      g.lineTo(cx + s * 0.15, cy + s * 0.2);
      g.lineTo(cx + s * 0.15, cy - s * 0.2);
      g.lineWidth = Math.max(1.2, s * 0.11);
      g.strokeStyle = INK;
      g.stroke();
      break;
  }
}

/** The arrow in local space, pointing up: tip, right barb, notch, left barb. */
const ARROW = [0, -0.52, 0.36, 0.42, 0, 0.2, -0.36, 0.42];

/** The "you are here" arrow, rotated `angle` radians clockwise from straight up. */
export function paintArrow(g: G, cx: number, cy: number, s: number, angle: number, fill: string, stroke: string) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const pts = ARROW;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const x = cx + (pts[i] * cos - pts[i + 1] * sin) * s;
    const y = cy + (pts[i] * sin + pts[i + 1] * cos) * s;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1.5, s * 0.16);
  g.strokeStyle = stroke;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}

/** A strip of pre-painted symbols at one pixel size. */
export class IconSheet {
  readonly canvas = document.createElement('canvas');
  size = 0;

  /** (Re)paints the strip if the size changed. */
  resize(size: number) {
    const s = Math.max(8, Math.round(size));
    if (s === this.size) return;
    this.size = s;
    this.canvas.width = s * ICON_KINDS.length;
    this.canvas.height = s;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, this.canvas.width, s);
    // Leave a pixel of breathing room so outlines are not clipped by the cell.
    for (let i = 0; i < ICON_KINDS.length; i++) paintIcon(g, ICON_KINDS[i], i * s + s / 2, s / 2, s - 2);
  }

  draw(g: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, scale = 1) {
    const i = ICON_KINDS.indexOf(kind);
    if (i < 0 || this.size === 0) return;
    const s = this.size;
    const d = s * scale;
    g.drawImage(this.canvas, i * s, 0, s, s, Math.round(x - d / 2), Math.round(y - d / 2), d, d);
  }
}

/** Which symbol a map place gets from its tags (null = not shown). */
export function iconForTags(tags: readonly string[]): IconKind | null {
  if (tags.includes('safehouse')) return 'safehouse';
  if (tags.includes('hospital')) return 'hospital';
  if (tags.includes('police')) return 'police';
  if (tags.includes('gunshop')) return 'gunshop';
  if (tags.includes('spray')) return 'spray';
  if (tags.includes('shop')) return 'shop';
  return null;
}
