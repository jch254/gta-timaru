import type { Blip, GameContext } from '../core/types';
import { el, hint, TextCache } from './dom';
import { bilingual, cityName, cityTeReo, featureTeReo } from './format';
import { IconSheet, paintArrow, paintIcon, type IconKind } from './icons';
import { ROAD_ORDER, type MapData } from './mapdata';
import { clampView, northUpAngle, scaleBar, zoomAbout, type MapView } from './mapmath';
import { ATLAS_PALETTE, buildNetworkPaths, MapRaster, type NetworkPaths } from './maprender';
import type { StaticMarker } from './minimap';
import type { MenuNav } from './nav';

export type MapResult = 'stay' | 'back' | 'resume';

const DATA_FONT = `'Avenir Next Condensed', 'Roboto Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
const SERIF_FONT = `Superclarendon, Rockwell, 'Bookman Old Style', Georgia, 'Times New Roman', serif`;
/** Faces chosen for full macron coverage, so te reo Māori names never fall back letter by letter. */
const REO_FONT = `'Iowan Old Style', Palatino, 'Palatino Linotype', Georgia, 'Times New Roman', serif`;
const INK = '#1d232c';
const HALO = 'rgba(244, 238, 221, 0.92)';
const MAX_BOXES = 160;
/** Vertical offsets (in label heights) tried in turn when a town's name would collide with something. */
const CITY_SHIFTS = [0, -1.8, 2.4, -3.4, 4.2];
/** Canvas pixels are capped so panning a 1440p map stays cheap. */
const MAX_PIXELS = 4.2e6;

const LEGEND: [IconKind | 'you', string][] = [
  ['you', 'You'],
  ['mission', 'Job on offer'],
  ['objective', 'Where to go'],
  ['safehouse', 'Safehouse'],
  ['hospital', 'Hospital'],
  ['police', 'Police station'],
  ['gunshop', 'Sports & guns'],
  ['spray', 'Panel & paint'],
];

/** A canvas font with its pixel size alongside, so labels can be measured without parsing the string. */
interface Face {
  font: string;
  size: number;
}

function face(style: string, size: number, family: string): Face {
  const px = Math.max(6, Math.round(size));
  return { font: `${style} ${px}px ${family}`, size: px };
}

const ROAD_LEGEND: [string, string][] = [
  ['highway', 'State highway'],
  ['arterial', 'Main road'],
  ['street', 'Street'],
  ['gravel', 'Gravel road'],
  ['rail', 'Railway'],
];

/**
 * The island map on the pause screen: a north-up road-atlas page. Land use comes from the surveyed raster,
 * roads are stroked as vectors (one Path2D per road class, built once) so they stay crisp at any zoom, and
 * the canvas is only redrawn when the view or the data changes.
 */
export class FullMap {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private raster: MapRaster | null = null;
  private paths: NetworkPaths | null = null;
  private icons = new IconSheet();
  /** Where the player has asked to look. */
  private view: MapView = { x: 0, z: 0, scale: 0 };
  /**
   * What is actually drawn: `view` kept over the island. Zooming right out centres the island without
   * forgetting `view`, so zooming back in returns to the same spot.
   */
  private shown: MapView = { x: 0, z: 0, scale: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private ratio = 1;
  private fontPx = 16;
  private dirty = true;
  private isOpen = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private boxes = new Float32Array(MAX_BOXES * 4);
  private boxCount = 0;
  private jobs: StaticMarker[] = [];
  private landmarks: { x: number; z: number; name: string }[] = [];
  private whereText: TextCache;
  private surveyText: TextCache;
  private surveyShown = -1;
  private foot: HTMLDivElement;
  private footPad: boolean | null = null;

  constructor(
    parent: HTMLElement,
    private ctx: GameContext,
    private data: MapData,
    private blips: readonly Blip[],
    private markers: readonly StaticMarker[],
  ) {
    this.root = el('div', 'nw-map', parent);
    this.canvas = el('canvas', 'nw-map-canvas', this.root);
    this.g = this.canvas.getContext('2d', { alpha: false });

    const head = el('div', 'nw-map-head nw-signplate', this.root);
    el('div', 'nw-map-title', head, 'Canterbury');
    el('div', 'nw-map-reo', head, 'Waitaha');
    this.whereText = new TextCache(el('div', 'nw-map-where', head));

    const legend = el('div', 'nw-map-legend nw-ledger', this.root);
    el('div', 'nw-legend-title', legend, 'Key');
    for (const [kind, label] of LEGEND) {
      const row = el('div', 'nw-legend-row', legend);
      const swatch = el('canvas', 'nw-legend-icon', row);
      swatch.width = swatch.height = 44;
      const g = swatch.getContext('2d');
      if (g) {
        if (kind === 'you') paintArrow(g, 22, 23, 30, 0, '#c2462b', '#fffaf0');
        else paintIcon(g, kind, 22, 22, 38);
      }
      el('span', 'nw-legend-label', row, label);
    }
    for (const [cls, label] of ROAD_LEGEND) {
      const row = el('div', 'nw-legend-row', legend);
      el('i', `nw-legend-road ${cls}`, row);
      el('span', 'nw-legend-label', row, label);
    }
    this.surveyText = new TextCache(el('div', 'nw-legend-note', legend));

    this.foot = el('div', 'nw-map-foot', this.root);

    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.anchor();
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      this.root.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.view.scale <= 0) return;
      this.view.x -= ((e.clientX - this.lastX) * this.ratio) / this.view.scale;
      this.view.z -= ((e.clientY - this.lastY) * this.ratio) / this.view.scale;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dirty = true;
    });
    const stop = () => {
      this.dragging = false;
      this.root.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 32 : 1;
        this.anchor();
        this.zoom(Math.exp(-e.deltaY * unit * 0.0016), (e.clientX - this.cssW / 2) * this.ratio, (e.clientY - this.cssH / 2) * this.ratio);
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', (e) => {
      this.anchor();
      this.zoom(2, (e.clientX - this.cssW / 2) * this.ratio, (e.clientY - this.cssH / 2) * this.ratio);
    });
  }

  private get minScale() {
    const d = this.data;
    return Math.min(this.canvas.width / (d.maxX - d.minX), this.canvas.height / (d.maxZ - d.minZ)) * 0.9;
  }

  private get maxScale() {
    return 4 * this.ratio;
  }

  /** Before moving the view by hand, start from what is on screen rather than from the remembered spot. */
  private anchor() {
    if (this.shown.scale <= 0) return;
    this.view.x = this.shown.x;
    this.view.z = this.shown.z;
  }

  private zoom(factor: number, sx: number, sy: number) {
    zoomAbout(this.view, factor, sx, sy, this.minScale, this.maxScale);
    this.dirty = true;
  }

  /** Something on the map changed (a blip was added or removed): redraw next frame if the map is up. */
  invalidate() {
    this.dirty = true;
  }

  /** New survey data for a cell rectangle: keep the atlas raster in step. */
  cellsChanged(c0: number, r0: number, c1: number, r1: number) {
    if (!this.raster) return;
    this.raster.paint(c0, r0, c1, r1);
    this.dirty = true;
  }

  /** Records the viewport; the (large) canvas is only sized while the map is actually open. */
  layout(cssW: number, cssH: number, dpr: number, fontPx: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.fontPx = fontPx;
    if (this.isOpen) this.applyLayout();
  }

  private applyLayout() {
    const { cssW, cssH, fontPx } = this;
    const ratio = Math.max(0.6, Math.min(this.dpr, Math.sqrt(MAX_PIXELS / Math.max(1, cssW * cssH))));
    const w = Math.max(2, Math.round(cssW * ratio));
    const h = Math.max(2, Math.round(cssH * ratio));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      // Keep the same amount of world on screen when the pixel ratio changes.
      if (this.view.scale > 0 && this.ratio > 0) this.view.scale *= ratio / this.ratio;
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ratio = ratio;
    this.icons.resize(Math.round(fontPx * ratio * 1.55));
    this.dirty = true;
  }

  /** Opens centred on the player, or on `focus` (e.g. where a job starts). */
  open(focus?: { x: number; z: number }) {
    const { ctx, data } = this;
    this.isOpen = true;
    this.applyLayout();
    if (!this.raster) this.raster = new MapRaster(data, ATLAS_PALETTE);
    if (!this.paths) this.paths = buildNetworkPaths(data);
    if (this.view.scale <= 0) this.view.scale = 0.34 * this.ratio;
    this.view.scale = Math.min(this.maxScale, Math.max(this.minScale, this.view.scale));
    const p = ctx.player?.position;
    this.view.x = focus ? focus.x : (p?.x ?? 0);
    this.view.z = focus ? focus.z : (p?.z ?? 0);
    if (focus && this.view.scale < 0.5 * this.ratio) this.view.scale = Math.min(this.maxScale, 0.5 * this.ratio);

    // Jobs on offer, from the missions module (tolerates an empty list or unknown places).
    this.jobs.length = 0;
    const missions = ctx.missions?.list() ?? [];
    for (const mission of missions) {
      if (mission.state !== 'available' && mission.state !== 'active') continue;
      const place = ctx.world.places.find((q) => q.id === mission.placeId);
      if (place) this.jobs.push({ x: place.x, z: place.z, icon: 'mission', label: mission.title });
    }
    if (this.landmarks.length === 0) {
      for (const l of ctx.world.landmarks) if (l.name) this.landmarks.push({ x: l.x, z: l.z, name: bilingual(l.name, featureTeReo(l.name)) });
    }
    if (p) {
      const district = ctx.world.districtAt(p.x, p.z);
      const street = ctx.world.locationName(p.x, p.z);
      const town = bilingual(cityName(district.city), cityTeReo(district.city));
      this.whereText.set(street === district.name ? `${street}, ${town}` : `${street} · ${district.name}, ${town}`);
    }
    this.dirty = true;
  }

  close() {
    this.isOpen = false;
    this.dragging = false;
    this.root.classList.remove('dragging');
  }

  private hints(pad: boolean) {
    if (pad === this.footPad) return;
    this.footPad = pad;
    this.foot.textContent = '';
    if (pad) {
      hint(this.foot, ['Left stick'], 'Pan');
      hint(this.foot, ['LB', 'RB'], 'Zoom');
      hint(this.foot, ['A'], 'Find me');
      hint(this.foot, ['B'], 'Back');
    } else {
      hint(this.foot, ['Drag', 'W A S D'], 'Pan');
      hint(this.foot, ['Wheel', 'Q', 'E'], 'Zoom');
      hint(this.foot, ['Enter'], 'Find me');
      hint(this.foot, ['Esc'], 'Back');
    }
  }

  update(nav: MenuNav, dt: number): MapResult {
    if (!this.isOpen) return 'stay';
    const input = this.ctx.input;
    if (nav.back) return 'back';
    if (input.pressed('map')) return 'resume';
    const pad = input.gamepadActive;
    this.hints(pad);
    const view = this.view;
    if (nav.confirm) {
      const p = this.ctx.player.position;
      view.x = p.x;
      view.z = p.z;
      this.dirty = true;
    }
    if (input.moveX !== 0 || input.moveZ !== 0) {
      this.anchor();
      const pan = (640 * this.ratio * dt) / view.scale;
      view.x -= input.moveX * pan;
      view.z -= input.moveZ * pan;
      this.dirty = true;
    }
    let zoom = 0;
    if (pad) zoom = (input.held('fire') ? 1 : 0) - (input.held('aim') ? 1 : 0) + input.throttle - input.brake;
    else zoom = (input.held('nextWeapon') ? 1 : 0) - (input.held('melee') ? 1 : 0);
    if (zoom !== 0) this.zoom(Math.exp(zoom * 1.9 * dt), 0, 0);

    const percent = this.data.done ? 100 : Math.floor(this.data.progress * 100);
    if (percent !== this.surveyShown) {
      this.surveyShown = percent;
      this.surveyText.set(percent >= 100 ? '' : `Surveying the land… ${percent}%`);
    }
    if (this.dirty) this.draw();
    return 'stay';
  }

  // ───────────── Drawing ─────────────

  private draw() {
    const g = this.g;
    const { data, raster, paths } = this;
    if (!g || !raster || !paths) return;
    this.dirty = false;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const view = this.shown;
    view.x = this.view.x;
    view.z = this.view.z;
    view.scale = this.view.scale;
    clampView(view, W / 2, H / 2, data.minX, data.maxX, data.minZ, data.maxZ);
    // While dragging, do not let the remembered spot run on past the edge the view has stopped at.
    if (this.dragging) {
      this.view.x = view.x;
      this.view.z = view.z;
    }
    const s = view.scale;
    const ratio = this.ratio;
    const ox = W / 2 - view.x * s;
    const oz = H / 2 - view.z * s;
    const x0 = view.x - W / 2 / s;
    const x1 = view.x + W / 2 / s;
    const z0 = view.z - H / 2 / s;
    const z1 = view.z + H / 2 / s;
    const pxM = 1 / s;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.setLineDash([]);
    g.fillStyle = '#cfc4a6';
    g.fillRect(0, 0, W, H);

    g.setTransform(s, 0, 0, s, ox, oz);
    g.imageSmoothingEnabled = true;
    raster.draw(g, x0, z0, x1, z1);

    // Kilometre grid, like the squares of a road atlas.
    const gx0 = Math.max(x0, data.minX);
    const gx1 = Math.min(x1, data.maxX);
    const gz0 = Math.max(z0, data.minZ);
    const gz1 = Math.min(z1, data.maxZ);
    g.beginPath();
    for (let x = Math.ceil(gx0 / 1000) * 1000; x <= gx1; x += 1000) {
      g.moveTo(x, gz0);
      g.lineTo(x, gz1);
    }
    for (let z = Math.ceil(gz0 / 1000) * 1000; z <= gz1; z += 1000) {
      g.moveTo(gx0, z);
      g.lineTo(gx1, z);
    }
    g.lineWidth = pxM * ratio;
    g.strokeStyle = 'rgba(52, 84, 120, 0.16)';
    g.stroke();
    g.lineWidth = 2 * pxM * ratio;
    g.strokeStyle = 'rgba(29, 35, 44, 0.55)';
    g.strokeRect(data.minX, data.minZ, data.maxX - data.minX, data.maxZ - data.minZ);

    // Railways under the roads.
    const palette = ATLAS_PALETTE;
    g.lineJoin = 'round';
    g.lineCap = 'butt';
    const railW = Math.max(5, 2.2 * pxM * ratio);
    g.strokeStyle = palette.railBed;
    g.lineWidth = railW;
    g.stroke(paths.rails);
    if (railW * s >= 2.5) {
      g.strokeStyle = palette.railTie;
      g.lineWidth = railW * 0.5;
      g.setLineDash([9, 9]);
      g.stroke(paths.rails);
      g.setLineDash([]);
    }
    g.strokeStyle = palette.tram;
    g.lineWidth = Math.max(2, 1 * pxM * ratio);
    g.stroke(paths.trams);

    // Tunnels: faint and dashed.
    g.globalAlpha = 0.5;
    g.strokeStyle = palette.casing;
    g.lineWidth = Math.max(7, 2 * pxM * ratio);
    g.setLineDash([14, 12]);
    g.stroke(paths.tunnels);
    g.setLineDash([]);
    g.globalAlpha = 1;

    // Roads: casings first so junctions merge, then fills, minor classes first.
    g.lineCap = 'round';
    const classes = ROAD_ORDER.length;
    for (let pass = 0; pass < 2; pass++) {
      for (let cls = 0; cls < classes; cls++) {
        const style = palette.roads[cls];
        const natural = style.width * s;
        // Back streets drop out when they would be thinner than a hairline.
        if (cls < 3 && natural < 0.45 * ratio) continue;
        const width = Math.max(style.width, style.minPx * pxM * ratio);
        if (pass === 0) {
          if (width * s < 2.6 * ratio) continue;
          g.strokeStyle = palette.casing;
          g.lineWidth = width + 2 * pxM * ratio;
          g.stroke(paths.roads[cls]);
        } else {
          g.strokeStyle = style.color;
          g.lineWidth = width;
          if (style.dash && natural > 1.5 * ratio) {
            g.setLineDash(style.dash);
            g.lineCap = 'butt';
          }
          // White streets without a casing need some ink of their own to show on cream paper.
          if ((cls === 2 || cls === 3) && width * s < 2.6 * ratio) {
            g.strokeStyle = '#9d947d';
            if (natural < ratio) g.globalAlpha = 0.6;
          }
          g.stroke(paths.roads[cls]);
          g.globalAlpha = 1;
          g.setLineDash([]);
          g.lineCap = 'round';
        }
      }
    }

    // Symbols and lettering in screen space.
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.boxCount = 0;
    const css = s / ratio; // CSS pixels per metre
    const icon = this.icons.size;
    const f = this.fontPx * ratio;

    const player = this.ctx.player;
    const px = player.position.x * s + ox;
    const py = player.position.z * s + oz;
    this.reserve(px - icon * 0.6, py - icon * 0.6, px + icon * 0.6, py + icon * 0.6);

    // Fixed places, jobs on offer and live blips.
    const markers = this.markers;
    for (let i = 0; i < markers.length; i++) this.symbol(g, markers[i].icon, markers[i].x * s + ox, markers[i].z * s + oz, W, H, false);
    for (let i = 0; i < this.jobs.length; i++) {
      const job = this.jobs[i];
      if (this.nearBlip(job.x, job.z)) continue;
      this.symbol(g, 'mission', job.x * s + ox, job.z * s + oz, W, H, true);
    }
    const blips = this.blips;
    for (let i = 0; i < blips.length; i++) {
      const at = blips[i].follow ? blips[i].follow!.position : blips[i];
      this.symbol(g, blips[i].kind, at.x * s + ox, at.z * s + oz, W, H, true);
    }

    // Lettering, most important first (earlier labels win where they would overlap).
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const small = face('600', f * 0.92, DATA_FONT);
    const reoSmall = face('italic 500', f * 0.86, REO_FONT);
    for (let i = 0; i < blips.length; i++) {
      const blip = blips[i];
      if (!blip.label) continue;
      const at = blip.follow ? blip.follow.position : blip;
      this.text(g, blip.label, '', at.x * s + ox + icon * 0.62, at.z * s + oz, small, reoSmall, 'left', 1, W, H);
    }
    for (let i = 0; i < this.jobs.length; i++) {
      const job = this.jobs[i];
      this.text(g, job.label, '', job.x * s + ox + icon * 0.62, job.z * s + oz, small, reoSmall, 'left', 1, W, H);
    }

    const labels = data.labels;
    const cityFont = face('700', f * (css < 0.25 ? 1.35 : 1.7), SERIF_FONT);
    const cityReo = face('italic 500', f * (css < 0.25 ? 1.0 : 1.2), REO_FONT);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (label.kind !== 'city') continue;
      // Once you are close enough to read the suburbs, the town name steps back. If its spot is taken
      // (symbols crowd a town centre), it shifts up or down a line or two rather than vanishing.
      const lx = label.x * s + ox;
      const ly = label.z * s + oz;
      for (let k = 0; k < CITY_SHIFTS.length; k++) {
        if (this.text(g, label.name, label.teReo, lx, ly + CITY_SHIFTS[k] * cityFont.size, cityFont, cityReo, 'center', css > 0.9 ? 0.45 : 0.9, W, H)) break;
      }
    }

    if (css >= 0.2) {
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        this.text(g, marker.label, '', marker.x * s + ox + icon * 0.62, marker.z * s + oz, small, reoSmall, 'left', 0.95, W, H);
      }
    }

    const districtFont = face('600', f * 0.98, DATA_FONT);
    const districtReo = face('italic 500', f * 0.84, REO_FONT);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (label.kind !== 'district') continue;
      // Worth lettering once the suburb is a few words wide on screen (countryside names need more room).
      if (label.size * s < f * (label.rural ? 16 : 6.5)) continue;
      this.text(g, label.name.toUpperCase(), label.teReo, label.x * s + ox, label.z * s + oz, districtFont, districtReo, 'center', label.rural ? 0.5 : 0.68, W, H);
    }

    if (css >= 0.55) {
      const landmarkFont = face('italic 500', f * 0.86, REO_FONT);
      for (let i = 0; i < this.landmarks.length; i++) {
        const l = this.landmarks[i];
        const lx = l.x * s + ox;
        const ly = l.z * s + oz;
        if (lx < -40 || ly < -40 || lx > W + 40 || ly > H + 40) continue;
        if (this.text(g, l.name, '', lx + f * 0.5, ly, landmarkFont, reoSmall, 'left', 0.8, W, H)) {
          g.beginPath();
          g.arc(lx, ly, Math.max(1.5, f * 0.16), 0, Math.PI * 2);
          g.fillStyle = INK;
          g.fill();
        }
      }
    }

    paintArrow(g, px, py, icon * 1.05, northUpAngle(player.heading), '#c2462b', '#fffaf0');

    // Scale bar, bottom-left.
    const bar = scaleBar(s, f * 9);
    const bw = bar.metres * s;
    const bx = f * 1.4;
    const by = H - f * 1.6;
    g.fillStyle = HALO;
    g.fillRect(bx - f * 0.4, by - f * 1.35, bw + f * 0.8, f * 1.9);
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.5, f * 0.1);
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(bx, by - f * 0.3);
    g.lineTo(bx, by);
    g.lineTo(bx + bw, by);
    g.lineTo(bx + bw, by - f * 0.3);
    g.stroke();
    g.font = small.font;
    g.textAlign = 'center';
    g.fillStyle = INK;
    g.fillText(bar.label, bx + bw / 2, by - f * 0.7);
  }

  /** True if a live blip already marks this spot (so a job is not drawn twice). */
  private nearBlip(x: number, z: number): boolean {
    const blips = this.blips;
    for (let i = 0; i < blips.length; i++) {
      const at = blips[i].follow ? blips[i].follow!.position : blips[i];
      if (Math.abs(at.x - x) < 8 && Math.abs(at.z - z) < 8) return true;
    }
    return false;
  }

  private symbol(g: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, W: number, H: number, important: boolean) {
    const r = this.icons.size * 0.5;
    if (x < -r || y < -r || x > W + r || y > H + r) return;
    this.icons.draw(g, kind, x, y);
    if (important) this.reserve(x - r, y - r, x + r, y + r);
  }

  private reserve(x0: number, y0: number, x1: number, y1: number) {
    if (this.boxCount >= MAX_BOXES) return;
    const o = this.boxCount++ * 4;
    this.boxes[o] = x0;
    this.boxes[o + 1] = y0;
    this.boxes[o + 2] = x1;
    this.boxes[o + 3] = y1;
  }

  private free(x0: number, y0: number, x1: number, y1: number): boolean {
    const b = this.boxes;
    for (let i = 0, o = 0; i < this.boxCount; i++, o += 4) {
      if (x0 < b[o + 2] && x1 > b[o] && y0 < b[o + 3] && y1 > b[o + 1]) return false;
    }
    return true;
  }

  /**
   * Draws a label (with an optional te reo Māori line underneath) if it is on screen and does not collide
   * with anything already placed. Returns whether it was drawn.
   */
  private text(g: CanvasRenderingContext2D, name: string, teReo: string, x: number, y: number, main: Face, reo: Face, align: 'left' | 'center', alpha: number, W: number, H: number): boolean {
    if (!name || x < -200 || y < -60 || x > W + 200 || y > H + 60) return false;
    const size = main.size;
    const reoSize = reo.size;
    g.font = main.font;
    let width = g.measureText(name).width;
    if (teReo) {
      g.font = reo.font;
      width = Math.max(width, g.measureText(teReo).width);
    }
    const height = size * 1.15 + (teReo ? reoSize * 1.2 : 0);
    const left = align === 'center' ? x - width / 2 : x;
    const top = y - size * 0.6;
    if (left + width < 0 || left > W || top + height < 0 || top > H) return false;
    const pad = size * 0.25;
    if (!this.free(left - pad, top - pad, left + width + pad, top + height + pad)) return false;
    this.reserve(left - pad, top - pad, left + width + pad, top + height + pad);

    g.textAlign = align;
    g.lineWidth = Math.max(2, size * 0.28);
    g.strokeStyle = HALO;
    g.fillStyle = INK;
    g.font = main.font;
    g.globalAlpha = alpha;
    g.strokeText(name, x, y);
    g.fillText(name, x, y);
    if (teReo) {
      g.font = reo.font;
      const ry = y + size * 0.55 + reoSize * 0.6;
      g.strokeText(teReo, x, ry);
      g.fillText(teReo, x, ry);
    }
    g.globalAlpha = 1;
    return true;
  }
}
