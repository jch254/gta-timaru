import type { Blip, GameContext } from '../core/types';
import { el, hint, TextCache, touchOn } from './dom';
import { bilingual, cityName, cityTeReo, featureTeReo } from './format';
import { IconSheet, paintArrow, paintIcon, PEN, type IconKind } from './icons';
import { ROAD_ORDER, T_INDUSTRY, T_PARK, T_SUBURB, T_TOWN, T_WATER, type MapData } from './mapdata';
import { clampView, northUpAngle, scaleBar, zoomAbout, type MapView } from './mapmath';
import { ATLAS_PALETTE, buildNetworkPaths, MapRaster, type NetworkPaths } from './maprender';
import type { StaticMarker } from './minimap';
import type { Waypoint } from './waypoint';
import type { MenuNav } from './nav';
import { DISPLAY_FONT, REO_FONT, TEXT_FONT } from './type';

export type MapResult = 'stay' | 'back' | 'resume';

const DATA_FONT = TEXT_FONT;
const SERIF_FONT = DISPLAY_FONT;
const INK = '#1d232c';
const HALO = 'rgba(244, 238, 221, 0.92)';
/** The sheet's own paper (its margin and the page border), and the blank of the page around the map plate. */
const PAPER = '#efe7d3';
const PAGE = '#e3d9bf';
/** Width of the page border that carries the grid letters and numbers, in em. */
const BORDER_EM = 1.5;
const MAX_BOXES = 160;
/** Vertical offsets (in label heights) tried in turn when a town's name would collide with something. */
const CITY_SHIFTS = [0, -1.8, 2.4, -3.4, 4.2];
/** Canvas pixels are capped so panning a 1440p map stays cheap. */
const MAX_PIXELS = 4.2e6;

const LEGEND: [IconKind | 'you', string][] = [
  ['you', 'You'],
  ['mission', 'Job on offer'],
  ['objective', 'Where to go'],
  ['waypoint', 'Your mark'],
  ['safehouse', 'Safehouse'],
  ['hospital', 'Hospital'],
  ['police', 'Police station'],
  ['gunshop', 'Sports & guns'],
  ['spray', 'Panel & paint'],
];

/** A press that stays put this long (ms) is a mark, not a pan. */
const PRESS_MS = 480;
/** A press that wanders further than this (CSS px) is a pan. */
const PRESS_SLOP = 7;

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

/** Land-use tints, swatched straight from the palette so the key can never drift from the map. */
const LAND_LEGEND: [number, string][] = [
  [T_TOWN, 'Town centre'],
  [T_SUBURB, 'Suburb'],
  [T_INDUSTRY, 'Works and port'],
  [T_PARK, 'Park'],
  [T_WATER, 'Water'],
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
  /** Pointers down on the map (one drags, two pinch), and the last distance between the first two. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  /** A finger held still long enough marks the map (the mouse has right-click for the same thing). */
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressX = 0;
  private pressY = 0;
  /** The last time a mark landed, so a long-press and a synthesised contextmenu cannot both act. */
  private markedAt = -Infinity;
  private boxes = new Float32Array(MAX_BOXES * 4);
  private boxCount = 0;
  private jobs: StaticMarker[] = [];
  private landmarks: { x: number; z: number; name: string }[] = [];
  private whereText: TextCache;
  private markText!: TextCache;
  private surveyText: TextCache;
  private surveyShown = -1;
  /** Waypoint version last drawn: a re-plan while the map is up redraws the pen line. */
  private penShown = -1;
  private foot: HTMLDivElement;
  private footMode = '';
  /** The printed panels that sit over the map (title, key), and where they are in CSS pixels: lettering keeps clear of them. */
  private panels: HTMLElement[] = [];
  private panelBoxes = new Float32Array(8);

  constructor(
    parent: HTMLElement,
    private ctx: GameContext,
    private data: MapData,
    private blips: readonly Blip[],
    private markers: readonly StaticMarker[],
    private waypoint: Waypoint,
  ) {
    this.root = el('div', 'nw-map', parent);
    this.canvas = el('canvas', 'nw-map-canvas', this.root);
    this.g = this.canvas.getContext('2d', { alpha: false });

    // The title cartouche, as printed in the corner of the sheet.
    const head = el('div', 'nw-map-head nw-cartouche', this.root);
    el('div', 'nw-map-kicker', head, '03 Quest · Road map · 1995');
    el('div', 'nw-map-title', head, 'Canterbury');
    el('div', 'nw-map-reo', head, 'Waitaha');
    this.whereText = new TextCache(el('div', 'nw-map-where', head));
    this.markText = new TextCache(el('div', 'nw-map-where', head));

    const legend = el('div', 'nw-map-legend nw-cartouche', this.root);
    el('div', 'nw-legend-title', legend, 'Key');
    const columns = el('div', 'nw-legend-cols', legend);
    const places = el('div', 'nw-legend-col', columns);
    const lines = el('div', 'nw-legend-col', columns);
    for (const [kind, label] of LEGEND) {
      const row = el('div', 'nw-legend-row', places);
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
      const row = el('div', 'nw-legend-row', lines);
      el('i', `nw-legend-road ${cls}`, row);
      el('span', 'nw-legend-label', row, label);
    }
    for (const [kind, label] of LAND_LEGEND) {
      const row = el('div', 'nw-legend-row', lines);
      const [r, g, b] = ATLAS_PALETTE.terrain[kind];
      el('i', 'nw-legend-land', row).style.background = `rgb(${r}, ${g}, ${b})`;
      el('span', 'nw-legend-label', row, label);
    }
    el('div', 'nw-legend-note', legend, 'Grid squares are one kilometre');
    this.panels.push(head, legend);
    this.surveyText = new TextCache(el('div', 'nw-legend-note', legend));

    this.foot = el('div', 'nw-map-foot', this.root);

    // Plus and minus for fingers (pinching works too). The stylesheet shows them only while the touch controller is up.
    const zoomBox = el('div', 'nw-map-zoom nw-if-touch', this.root);
    const step = (label: string, factor: number) => {
      el('div', 'nw-map-zoom-btn', zoomBox, label).addEventListener('click', () => {
        this.anchor();
        this.zoom(factor, 0, 0);
      });
    };
    step('+', 1.6);
    step('−', 1 / 1.6);

    const canvas = this.canvas;
    // One pointer drags the map; two pinch it (and carry it with them). Mouse, pen and fingers alike.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      this.anchor();
      this.pointers.set(e.pointerId ?? 0, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.pinch = 0;
      canvas.setPointerCapture?.(e.pointerId);
      this.root.classList.add('dragging');
      // One finger held still: a mark. A second finger or a wander cancels it.
      clearTimeout(this.pressTimer);
      if (this.pointers.size === 1) {
        this.pressX = e.clientX;
        this.pressY = e.clientY;
        this.pressTimer = setTimeout(() => {
          this.mark(this.pressX, this.pressY);
          stop();
        }, PRESS_MS);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointers.size >= 2 || Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY) > PRESS_SLOP) clearTimeout(this.pressTimer);
      if (!this.dragging || this.view.scale <= 0) return;
      const held = this.pointers.get(e.pointerId ?? 0);
      if (held) {
        held.x = e.clientX;
        held.y = e.clientY;
      }
      let x = e.clientX;
      let y = e.clientY;
      if (this.pointers.size >= 2) {
        // The mid-point of the first two fingers pans; the distance between them zooms about that point.
        const [p, q] = [...this.pointers.values()];
        x = (p.x + q.x) / 2;
        y = (p.y + q.y) / 2;
        const spread = Math.hypot(p.x - q.x, p.y - q.y);
        if (this.pinch > 0 && spread > 0) this.zoom(spread / this.pinch, (x - this.cssW / 2) * this.ratio, (y - this.cssH / 2) * this.ratio);
        else {
          this.lastX = x;
          this.lastY = y;
        }
        this.pinch = spread;
      }
      this.view.x -= ((x - this.lastX) * this.ratio) / this.view.scale;
      this.view.z -= ((y - this.lastY) * this.ratio) / this.view.scale;
      this.lastX = x;
      this.lastY = y;
      this.dirty = true;
    });
    const stop = (e?: PointerEvent) => {
      clearTimeout(this.pressTimer);
      if (e) this.pointers.delete(e.pointerId ?? 0);
      else this.pointers.clear();
      this.pinch = 0;
      const rest = this.pointers.values().next().value;
      if (rest) {
        // A finger is still down: carry on dragging from where it is, without a jump.
        this.lastX = rest.x;
        this.lastY = rest.y;
        return;
      }
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
    // Right-click marks the map (Android fires this for a long-press too, hence the shared debounce).
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.mark(e.clientX, e.clientY);
    });
  }

  /** Put the X down at a screen point — or, on the X already there, rub it out. */
  private mark(cx: number, cy: number) {
    const at = performance.now();
    if (at - this.markedAt < 400) return;
    this.markedAt = at;
    const view = this.shown;
    if (view.scale <= 0) return;
    const d = this.data;
    const wx = view.x + ((cx - this.cssW / 2) * this.ratio) / view.scale;
    const wz = view.z + ((cy - this.cssH / 2) * this.ratio) / view.scale;
    // A thumb's width on screen rubs out; anywhere else (clamped to the sheet) marks afresh.
    this.waypoint.toggle(Math.min(d.maxX, Math.max(d.minX, wx)), Math.min(d.maxZ, Math.max(d.minZ, wz)), (28 * this.ratio) / view.scale);
    this.dirty = true;
  }

  private get minScale() {
    const d = this.data;
    // The whole plate, with its margin, inside the page border.
    const edge = this.fontPx * this.ratio * (BORDER_EM + 1.6) * 2;
    const w = Math.max(64, this.canvas.width - edge);
    const h = Math.max(64, this.canvas.height - edge);
    return Math.min(w / (d.maxX - d.minX), h / (d.maxZ - d.minZ));
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
    // Measured once per open or resize, never per frame.
    for (let i = 0; i < this.panels.length; i++) {
      const box = this.panels[i].getBoundingClientRect();
      this.panelBoxes[i * 4] = box.left;
      this.panelBoxes[i * 4 + 1] = box.top;
      this.panelBoxes[i * 4 + 2] = box.left + box.width;
      this.panelBoxes[i * 4 + 3] = box.top + box.height;
    }
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
    this.pointers.clear();
    this.pinch = 0;
    this.root.classList.remove('dragging');
  }

  private hints(pad: boolean) {
    const mode = touchOn() ? 'touch' : pad ? 'pad' : 'keys';
    if (mode === this.footMode) return;
    this.footMode = mode;
    this.foot.textContent = '';
    if (mode === 'touch') {
      hint(this.foot, ['Drag'], 'Pan');
      hint(this.foot, ['Pinch', '+', '−'], 'Zoom');
      hint(this.foot, ['Hold'], 'Mark the map');
      hint(this.foot, ['‹ Back'], 'Close');
    } else if (pad) {
      hint(this.foot, ['Left stick'], 'Pan');
      hint(this.foot, ['LB', 'RB'], 'Zoom');
      hint(this.foot, ['A'], 'Find me');
      hint(this.foot, ['B'], 'Back');
    } else {
      hint(this.foot, ['Drag', 'W A S D'], 'Pan');
      hint(this.foot, ['Wheel', 'Q', 'E'], 'Zoom');
      hint(this.foot, ['Right-click'], 'Mark the map');
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
    const wp = this.waypoint;
    if (wp.version !== this.penShown) {
      this.penShown = wp.version;
      this.markText.set(!wp.target ? '' : wp.distance > 0 ? `Your mark: ${wp.distance >= 950 ? `${(wp.distance / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(wp.distance / 10) * 10)} m`} by road` : 'Your mark: off every road');
      this.dirty = true;
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
    g.fillStyle = PAGE;
    g.fillRect(0, 0, W, H);

    g.setTransform(s, 0, 0, s, ox, oz);
    g.imageSmoothingEnabled = true;
    // The map plate on its page: a paper margin, then the land.
    const sheetW = data.maxX - data.minX;
    const sheetH = data.maxZ - data.minZ;
    const margin = 16 * pxM * ratio;
    g.fillStyle = PAPER;
    g.fillRect(data.minX - margin, data.minZ - margin, sheetW + margin * 2, sheetH + margin * 2);
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
    g.strokeStyle = 'rgba(52, 84, 120, 0.2)';
    g.stroke();
    // The sheet's neatline: a fine rule at the edge of the map, a heavy one at the edge of the paper margin.
    g.strokeStyle = INK;
    g.lineWidth = 1.2 * pxM * ratio;
    g.strokeRect(data.minX, data.minZ, sheetW, sheetH);
    g.lineWidth = 3 * pxM * ratio;
    g.strokeRect(data.minX - margin * 0.62, data.minZ - margin * 0.62, sheetW + margin * 1.24, sheetH + margin * 1.24);

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
    // Nothing is lettered under the title, the key, the compass or the scale.
    const pb = this.panelBoxes;
    for (let o = 0; o < pb.length; o += 4) if (pb[o + 2] > pb[o]) this.reserve(pb[o] * ratio, pb[o + 1] * ratio, pb[o + 2] * ratio, pb[o + 3] * ratio);
    const edge = f * BORDER_EM;
    // (The touch controller's "Back" pill has the top-right 120 × 60: the compass steps down and nothing is lettered there.)
    const back = this.cssH <= 480 || touchOn() ? 52 * ratio : 0;
    // The plus and minus buttons, half way down the left edge.
    if (touchOn()) this.reserve(edge, H / 2 - 56 * ratio, edge + f * 1.2 + 56 * ratio, H / 2 + 56 * ratio);
    this.reserve(W - Math.max(edge + f * 5.6, back > 0 ? 132 * ratio : 0), 0, W, edge + f * 6.4 + back);
    this.reserve(edge, H - edge - f * 4.4, edge + f * 14, H - edge);
    // …nor under the key hints that sit above the scale (not shown on a phone).
    if (this.cssH > 480) this.reserve(edge, H - edge - f * 9.4, edge + W * 0.34, H - edge - f * 4.4);

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

    // The player's own mark, and the pen line of the route out to it.
    const wp = this.waypoint;
    if (wp.target) {
      const route = wp.route;
      if (route.length >= 4) {
        g.beginPath();
        g.moveTo(route[0] * s + ox, route[1] * s + oz);
        for (let i = 2; i < route.length; i += 2) g.lineTo(route[i] * s + ox, route[i + 1] * s + oz);
        g.strokeStyle = PEN;
        g.globalAlpha = 0.7;
        g.lineWidth = Math.max(2, 2.6 * ratio);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.stroke();
        g.globalAlpha = 1;
      }
      this.symbol(g, 'waypoint', wp.target.x * s + ox, wp.target.z * s + oz, W, H, true);
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

    // The page itself: border and grid references, the compass, the scale.
    const border = this.pageBorder(g, W, H, s, ox, oz, f);
    // On a phone the top-right corner belongs to the touch controller's "Back" pill: the compass sits under it.
    const compassDrop = this.cssH <= 480 || touchOn() ? 52 * ratio : 0;
    paintCompass(g, W - border - f * 3.3, border + f * 4 + compassDrop, f * 1.9, f);
    paintScale(g, s, f, border + f * 1.4, H - border - f * 1.4);
  }

  /**
   * The atlas page's border, drawn round the screen: a paper strip with a neatline, ticked at every grid line
   * and lettered A, B, C… across and 1, 2, 3… down, so a place can be given as "C4". Returns its width in pixels.
   */
  private pageBorder(g: CanvasRenderingContext2D, W: number, H: number, s: number, ox: number, oz: number, f: number): number {
    const data = this.data;
    const m = Math.round(f * BORDER_EM);
    const inner = m * 0.2;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, m);
    g.fillRect(0, H - m, W, m);
    g.fillRect(0, m, m, H - m * 2);
    g.fillRect(W - m, m, m, H - m * 2);
    g.setLineDash([]);
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.5, f * 0.12);
    g.strokeRect(m, m, W - m * 2, H - m * 2);
    g.lineWidth = Math.max(1, f * 0.05);
    g.strokeRect(inner, inner, W - inner * 2, H - inner * 2);

    const letters = face('700', f * 0.84, DATA_FONT);
    g.font = letters.font;
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const km = 1000 * s;
    // A reference in every square while they are wide enough to hold one, then every second, every fifth.
    const every = km >= f * 1.7 ? 1 : km >= f * 0.85 ? 2 : 5;
    const col0 = Math.floor(data.minX / 1000);
    const row0 = Math.floor(data.minZ / 1000);
    const mid = m * 0.6;
    g.beginPath();
    for (let c = Math.max(col0, Math.floor((m - ox) / km)); c * 1000 <= data.maxX; c++) {
      const x = c * km + ox;
      if (x > W - m) break;
      if (x > m) {
        g.moveTo(x, inner);
        g.lineTo(x, m);
        g.moveTo(x, H - m);
        g.lineTo(x, H - inner);
      }
      const at = x + km / 2;
      if ((c - col0) % every !== 0 || at < m + f || at > W - m - f || (c + 0.5) * 1000 > data.maxX) continue;
      const name = columnName(c - col0);
      g.fillText(name, at, mid);
      g.fillText(name, at, H - mid);
    }
    for (let r = Math.max(row0, Math.floor((m - oz) / km)); r * 1000 <= data.maxZ; r++) {
      const y = r * km + oz;
      if (y > H - m) break;
      if (y > m) {
        g.moveTo(inner, y);
        g.lineTo(m, y);
        g.moveTo(W - m, y);
        g.lineTo(W - inner, y);
      }
      const at = y + km / 2;
      if ((r - row0) % every !== 0 || at < m + f || at > H - m - f || (r + 0.5) * 1000 > data.maxZ) continue;
      const name = String(r - row0 + 1);
      g.fillText(name, mid, at);
      g.fillText(name, W - mid, at);
    }
    g.lineWidth = Math.max(1, f * 0.06);
    g.stroke();
    return m;
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

/** Grid column names: A … Z, then AA, AB … */
function columnName(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : String.fromCharCode(64 + Math.floor(index / 26)) + letter;
}

/** A plain surveyor's compass: a ring, a four-point star with its north limb inked, and an N. */
function paintCompass(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, f: number) {
  g.setLineDash([]);
  g.lineJoin = 'miter';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(239, 231, 211, 0.9)';
  g.fill();
  g.lineWidth = Math.max(1, f * 0.07);
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  g.lineWidth = Math.max(0.75, f * 0.035);
  g.stroke();
  const limb = (dx: number, dy: number, length: number, inked: boolean) => {
    // One point of the star, split down its spine: one half inked, the other left as paper.
    const w = r * 0.17;
    const tx = cx + dx * length;
    const ty = cy + dy * length;
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx - dy * w * side + dx * w, cy + dx * w * side + dy * w);
      g.lineTo(tx, ty);
      g.closePath();
      g.fillStyle = (side < 0) === inked ? INK : PAPER;
      g.fill();
      g.stroke();
    }
  };
  g.lineWidth = Math.max(0.75, f * 0.045);
  limb(1, 0, r * 0.66, false);
  limb(-1, 0, r * 0.66, true);
  limb(0, 1, r * 0.74, false);
  limb(0, -1, r * 0.98, true);
  const n = face('700', f * 1.05, DISPLAY_FONT);
  g.font = n.font;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, f * 0.3);
  g.strokeStyle = HALO;
  g.strokeText('N', cx, cy - r - f * 0.35);
  g.fillStyle = INK;
  g.fillText('N', cx, cy - r - f * 0.35);
}

/** The scale: four blocks, ink and paper by turns, figured at nought, half way and the end. (x, y) is its bottom-left. */
function paintScale(g: CanvasRenderingContext2D, pxPerMetre: number, f: number, x: number, y: number) {
  const bar = scaleBar(pxPerMetre, f * 10);
  const width = bar.metres * pxPerMetre;
  const height = f * 0.42;
  const pad = f * 1.25;
  const top = y - (f * 1.55 + height + f * 0.6);
  g.setLineDash([]);
  g.fillStyle = 'rgba(239, 231, 211, 0.94)';
  g.fillRect(x, top, width + pad * 2, y - top);
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, f * 0.06);
  g.strokeRect(x, top, width + pad * 2, y - top);
  const bx = x + pad;
  const by = y - f * 0.6 - height;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 === 0 ? INK : '#fffaf0';
    g.fillRect(bx + (width * i) / 4, by, width / 4, height);
  }
  g.strokeRect(bx, by, width, height);
  const figures = face('700', f * 0.84, TEXT_FONT);
  g.font = figures.font;
  g.fillStyle = INK;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
  const km = bar.metres >= 1000;
  const half = km ? bar.metres / 2000 : bar.metres / 2;
  g.fillText('0', bx, by - f * 0.32);
  g.fillText(String(half), bx + width / 2, by - f * 0.32);
  g.fillText(bar.label, bx + width, by - f * 0.32);
}
