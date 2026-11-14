/**
 * In-world markers: a translucent glowing ring with a thin beam above it. Pooled, two shared geometries,
 * one pair of unlit materials per style, nothing allocated per frame.
 */
import * as THREE from 'three';

export type MarkerStyle = 'mission' | 'checkpoint' | 'goal';

/** Colours are above 1 so the HDR pipeline's bloom gives them a glow. */
const STYLE: Record<MarkerStyle, { r: number; g: number; b: number; ring: number; beam: number }> = {
  mission: { r: 2.1, g: 1.5, b: 0.3, ring: 0.6, beam: 0.3 },
  checkpoint: { r: 0.4, g: 1.7, b: 1.9, ring: 0.5, beam: 0.24 },
  goal: { r: 2.0, g: 1.7, b: 0.9, ring: 0.5, beam: 0.22 },
};

/** Open cylinder of unit radius and height standing on y = 0, opaque at the foot and fading out upward. */
function fadingCylinder(segments: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(1, 1, 1, segments, 1, true);
  geo.translate(0, 0.5, 0);
  const pos = geo.getAttribute('position');
  const rgba = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const fade = 1 - pos.getY(i);
    rgba[i * 4] = 1;
    rgba[i * 4 + 1] = 1;
    rgba[i * 4 + 2] = 1;
    rgba[i * 4 + 3] = fade * fade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  return geo;
}

interface MaterialPair {
  style: MarkerStyle;
  ring: THREE.MeshBasicMaterial;
  beam: THREE.MeshBasicMaterial;
}

export class Marker {
  readonly group = new THREE.Group();
  style: MarkerStyle = 'checkpoint';
  inUse = false;
  x = 0;
  z = 0;

  constructor(
    readonly ring: THREE.Mesh,
    readonly beam: THREE.Mesh,
  ) {
    this.group.add(ring, beam);
    this.group.visible = false;
  }

  /** Stand the marker on the ground at (x, y, z) with the ring at `radius`. */
  place(x: number, y: number, z: number, radius: number) {
    this.x = x;
    this.z = z;
    this.group.position.set(x, y + 0.05, z);
    this.ring.scale.set(radius, Math.min(2.6, 0.7 + radius * 0.12), radius);
    const w = Math.min(0.9, 0.22 + radius * 0.04);
    this.beam.scale.set(w, Math.min(46, 16 + radius * 1.5), w);
    this.group.visible = true;
  }
}

export class MarkerPool {
  private free: Marker[] = [];
  private live: Marker[] = [];
  private ringGeo = fadingCylinder(32);
  private beamGeo = fadingCylinder(8);
  private materials = new Map<MarkerStyle, MaterialPair>();
  /** Same pairs as the map, for allocation-free iteration every frame. */
  private pairs: MaterialPair[] = [];
  private time = 0;

  constructor(private scene: THREE.Object3D) {}

  private materialsFor(style: MarkerStyle) {
    let pair = this.materials.get(style);
    if (!pair) {
      const s = STYLE[style];
      const make = (opacity: number) => {
        const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
        m.color.setRGB(s.r, s.g, s.b);
        return m;
      };
      pair = { style, ring: make(s.ring), beam: make(s.beam) };
      this.materials.set(style, pair);
      this.pairs.push(pair);
    }
    return pair;
  }

  acquire(style: MarkerStyle): Marker {
    let marker = this.free.pop();
    if (!marker) {
      marker = new Marker(new THREE.Mesh(this.ringGeo), new THREE.Mesh(this.beamGeo));
      marker.ring.renderOrder = 5;
      marker.beam.renderOrder = 5;
      this.scene.add(marker.group);
    }
    const pair = this.materialsFor(style);
    marker.ring.material = pair.ring;
    marker.beam.material = pair.beam;
    marker.style = style;
    marker.inUse = true;
    marker.group.visible = false;
    this.live.push(marker);
    return marker;
  }

  release(marker: Marker | null) {
    if (!marker || !marker.inUse) return;
    marker.inUse = false;
    marker.group.visible = false;
    const i = this.live.indexOf(marker);
    if (i >= 0) this.live.splice(i, 1);
    this.free.push(marker);
  }

  /** Markers currently handed out. */
  get activeCount(): number {
    return this.live.length;
  }

  /** Gentle pulse; all markers of a style breathe together. */
  update(dt: number) {
    this.time += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.2);
    for (let i = 0; i < this.pairs.length; i++) {
      const pair = this.pairs[i];
      const s = STYLE[pair.style];
      pair.ring.opacity = s.ring * (0.7 + 0.3 * pulse);
      pair.beam.opacity = s.beam * (0.8 + 0.2 * pulse);
    }
  }

  dispose() {
    for (const m of [...this.live, ...this.free]) m.group.removeFromParent();
    this.live.length = 0;
    this.free.length = 0;
    this.ringGeo.dispose();
    this.beamGeo.dispose();
    for (const pair of this.pairs) {
      pair.ring.dispose();
      pair.beam.dispose();
    }
    this.pairs.length = 0;
    this.materials.clear();
  }
}
