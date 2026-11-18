import { damp } from '../core/math';
import type { Blip, GameContext } from '../core/types';
import { el } from './dom';
import { IconSheet, paintArrow, PEN, type IconKind } from './icons';
import type { Waypoint } from './waypoint';
import { TILE_M, type MapData } from './mapdata';
import { arrowAngle, clampToSquare, minimapMatrix, minimapReach, worldToMinimap, type Point } from './mapmath';
import { landColor, RoadTiles, STREET_PALETTE, TILE_PAD, type MapRaster } from './maprender';

/** A fixed symbol on the map (hospital, police station, safehouse, shop). */
export interface StaticMarker {
  x: number;
  z: number;
  icon: IconKind;
  label: string;
}

/** Minimap edge length in em (see .nw-mini in ui.css). */
export const MINIMAP_EM = 15;

/**
 * The minimap: a corner of the road atlas, bottom-left, rotating with the camera. Each frame it blits a rotated
 * window of the land-use raster and of the pre-rendered road tiles, shades the paper after dark, then draws
 * blips, the north tab and the player arrow. One canvas redraw, no allocation.
 */
export class Minimap {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private px = 0;
  private reach = 150;
  private frame = 0;
  private tiles: RoadTiles;
  private icons = new IconSheet();
  private land = landColor(STREET_PALETTE);
  /** Night shade over the paper, in tenths, and the fill style that goes with it. */
  private dusk = 0;
  private duskStyle = '';
  private m: number[] = [1, 0, 0, 1, 0, 0];
  private p: Point = { x: 0, y: 0 };
  /** The waypoint pen line, cached as a path against the waypoint's version. */
  private penPath: Path2D | null = null;
  private penVersion = -1;

  constructor(
    parent: HTMLElement,
    private data: MapData,
    private raster: MapRaster,
  ) {
    this.root = el('div', 'nw-mini', parent);
    this.canvas = el('canvas', 'nw-mini-canvas', this.root);
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.tiles = new RoadTiles(data, STREET_PALETTE);
  }

  /** Sizes the canvas for the current viewport. `cssSize` is the plate's inner edge in CSS pixels. */
  layout(cssSize: number, dpr: number) {
    const px = Math.max(64, Math.round(cssSize * dpr));
    if (px === this.px) return;
    this.px = px;
    this.canvas.width = this.canvas.height = px;
    // Tiles are rendered at about the on-foot zoom so they are never blown up much.
    const want = Math.min(1.5, Math.max(0.75, px / 2 / 150));
    if (want / this.tiles.scale > 1.25 || this.tiles.scale / want > 1.25) this.tiles.setScale(want);
    this.icons.resize(Math.max(12, px * 0.105));
  }

  draw(ctx: GameContext, blips: readonly Blip[], markers: readonly StaticMarker[], waypoint: Waypoint | null, dt: number) {
    const g = this.g;
    const player = ctx.player;
    if (!g || this.px === 0 || !player) return;
    const px = player.position.x;
    const pz = player.position.z;
    const heading = player.cameraHeading;
    this.reach = damp(this.reach, minimapReach(player.vehicle ? player.vehicle.speed : 0), 1.8, dt);
    const size = this.px;
    const half = size / 2;
    const scale = half / this.reach;
    const frame = ++this.frame;
    const d = this.data;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.land;
    g.fillRect(0, 0, size, size);

    // World layer: land use, then roads, drawn through one rotate-and-scale transform.
    const m = minimapMatrix(px, pz, heading, scale, half, half, this.m);
    g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    // The rotated window fits inside a square of ±√2 × reach around the player.
    const ext = this.reach * 1.45;
    g.imageSmoothingEnabled = true;
    this.raster.draw(g, px - ext, pz - ext, px + ext, pz + ext);

    const tx0 = Math.max(0, Math.floor((px - ext - d.minX) / TILE_M));
    const tx1 = Math.min(d.tilesX - 1, Math.floor((px + ext - d.minX) / TILE_M));
    const tz0 = Math.max(0, Math.floor((pz - ext - d.minZ) / TILE_M));
    const tz1 = Math.min(d.tilesZ - 1, Math.floor((pz + ext - d.minZ) / TILE_M));
    const span = TILE_M + TILE_PAD * 2;
    let built = false;
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        let tile = this.tiles.get(tx, tz, frame);
        if (tile === undefined) {
          // At most one new tile per frame; the rest arrive over the next few frames.
          if (built) continue;
          built = true;
          tile = this.tiles.build(tx, tz, frame);
        }
        if (tile) g.drawImage(tile, d.minX + tx * TILE_M - TILE_PAD, d.minZ + tz * TILE_M - TILE_PAD, span, span);
      }
    }

    // The waypoint's pen line, inked over the roads (still in the world transform).
    if (waypoint?.target) {
      if (waypoint.version !== this.penVersion) {
        this.penVersion = waypoint.version;
        const r = waypoint.route;
        if (r.length >= 4) {
          const path = (this.penPath = new Path2D());
          path.moveTo(r[0], r[1]);
          for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
        } else this.penPath = null;
      }
      if (this.penPath) {
        g.strokeStyle = PEN;
        g.globalAlpha = 0.72;
        g.lineWidth = 3.2 / scale;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.stroke(this.penPath);
        g.globalAlpha = 1;
      }
    }

    // Symbols, in screen space.
    g.setTransform(1, 0, 0, 1, 0, 0);
    // After dark the paper is read by the dashboard light: shaded, so a cream square does not glare out of a
    // night scene, while the symbols on top stay bright.
    const dusk = Math.round(Math.min(1, Math.max(0, ctx.env?.night ?? 0)) * 10);
    if (dusk !== this.dusk) {
      this.dusk = dusk;
      this.duskStyle = `rgba(22, 24, 38, ${(dusk * 0.023).toFixed(3)})`;
    }
    if (dusk > 0) {
      g.fillStyle = this.duskStyle;
      g.fillRect(0, 0, size, size);
    }
    const p = this.p;
    const icon = this.icons.size;
    const reachPx = half + icon;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      worldToMinimap(marker.x, marker.z, px, pz, heading, scale, p);
      if (Math.abs(p.x) < reachPx && Math.abs(p.y) < reachPx) this.icons.draw(g, marker.icon, half + p.x, half + p.y);
    }
    const rim = half - icon * 0.6;
    for (let i = 0; i < blips.length; i++) {
      const blip = blips[i];
      const at = blip.follow ? blip.follow.position : blip;
      worldToMinimap(at.x, at.z, px, pz, heading, scale, p);
      const off = clampToSquare(p, rim);
      if (off && !blip.pinned) continue;
      this.icons.draw(g, blip.kind, half + p.x, half + p.y, off ? 0.82 : 1);
    }

    // The X itself, pinned to the rim when it is off the plate.
    if (waypoint?.target) {
      worldToMinimap(waypoint.target.x, waypoint.target.z, px, pz, heading, scale, p);
      const off = clampToSquare(p, rim);
      this.icons.draw(g, 'waypoint', half + p.x, half + p.y, off ? 0.82 : 1);
    }

    // North tab on the rim.
    worldToMinimap(px, pz - 1e6, px, pz, heading, 1, p);
    clampToSquare(p, half - icon * 0.52);
    this.icons.draw(g, 'north', half + p.x, half + p.y, 0.9);

    paintArrow(g, half, half, size * 0.105, arrowAngle(heading, player.heading), '#c2462b', '#fffaf0');
  }
}
