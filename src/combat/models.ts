import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../core/types';

/**
 * Weapon and pickup models, built from boxes and cylinders and merged to one mesh per material.
 *
 * WEAPON SPACE (what every weapon is modelled in, and what `held()` returns):
 *   origin = where the palm wraps the grip / handle
 *   +z     = the way it points: muzzle, or the tip of the bat's blade
 *   +y     = the top of the weapon (sights, the slide); for the bat, the back of the blade
 *   +x     = the weapon's left side
 * That is the frame of the humanoid's hand attach point (`Humanoid.setHeld`): +z runs down the
 * forearm away from the elbow, +y is the side of the hand that faces up when the arm is raised to
 * aim. HAND_FIT below nudges each weapon inside that frame.
 */

export interface HandFit {
  /** Radians the weapon is tipped from the forearm line (+z) towards +y. */
  tilt: number;
  /** Radians of roll about its own long axis. */
  roll: number;
  /** Offset of the grip from the attach point, in hand space (metres). */
  x: number;
  y: number;
  z: number;
}

/** How each weapon sits in a hand. Guns lie along the forearm so they point where the arm points. */
export const HAND_FIT: Record<string, HandFit> = {
  bat: { tilt: 0.9, roll: 0, x: 0, y: 0, z: 0 },
  pistol: { tilt: 0, roll: 0, x: 0, y: 0, z: 0 },
  shotgun: { tilt: 0, roll: 0, x: 0, y: -0.02, z: 0.02 },
  rifle: { tilt: 0, roll: 0, x: 0, y: -0.02, z: 0.02 },
};

/** Uniform scale applied to each weapon so it reads from a chase camera. */
const SCALE: Record<string, number> = { bat: 1, pistol: 1.2, shotgun: 1, rifle: 0.94 };

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
type Piece = [material: THREE.Material, geometry: THREE.BufferGeometry];

/** Box centred at (x, y, z), optionally pitched about x first. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, pitch = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pitch) g.rotateX(pitch);
  return g.translate(x, y, z);
}

/** Cylinder along +z from z to z + length, radius r0 at the near end and r1 at the far end. */
function tube(r0: number, r1: number, length: number, x: number, y: number, z: number, segments = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, length, segments)
    .rotateX(Math.PI / 2)
    .translate(x, y, z + length / 2);
}

/** Upright cylinder centred at (x, y, z). */
function disc(rTop: number, rBottom: number, height: number, x: number, y: number, z: number, segments = 12): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, height, segments).translate(x, y, z);
}

/** Merge pieces into one geometry per material. */
function bundle(pieces: Piece[], scale = 1): Part[] {
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const [material, geometry] of pieces) {
    const list = groups.get(material);
    if (list) list.push(geometry);
    else groups.set(material, [geometry]);
  }
  const parts: Part[] = [];
  for (const [material, list] of groups) {
    const geometry = mergeGeometries(list, false);
    if (!geometry) throw new Error('combat/models: could not merge geometry');
    for (const g of list) g.dispose();
    if (scale !== 1) geometry.scale(scale, scale, scale);
    geometry.computeBoundingSphere();
    parts.push({ geometry, material });
  }
  return parts;
}

function assemble(parts: Part[], castShadow: boolean): THREE.Group {
  const group = new THREE.Group();
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = castShadow;
    group.add(mesh);
  }
  return group;
}

/** Builds and caches weapon / pickup geometry; hands out cheap instances that share it. */
export class WeaponModels {
  private weapons = new Map<string, Part[] | null>();
  private pickups = new Map<string, Part[]>();

  constructor(private materials: MaterialLibrary) {}

  /**
   * A weapon to put in a hand (`humanoid.setHeld`). Null for fists and unknown ids.
   * The returned group is in weapon space; its single child carries the HAND_FIT nudge and the meshes.
   */
  held(id: string): THREE.Group | null {
    const parts = this.weaponParts(id);
    if (!parts) return null;
    const root = new THREE.Group();
    root.name = `weapon:${id}`;
    const inner = assemble(parts, true);
    const fit = HAND_FIT[id];
    if (fit) {
      inner.position.set(fit.x, fit.y, fit.z);
      inner.rotation.set(-fit.tilt, 0, fit.roll);
    }
    root.add(inner);
    return root;
  }

  /** The same weapon with no hand fit: lying along +z, top up (for pickups). */
  display(id: string): THREE.Group | null {
    const parts = this.weaponParts(id);
    return parts ? assemble(parts, false) : null;
  }

  /** 'health' (a meat pie), 'armour' (a bush shirt) or 'cash' (a bundle of notes). */
  pickup(kind: 'health' | 'armour' | 'cash'): THREE.Group {
    let parts = this.pickups.get(kind);
    if (!parts) {
      parts = kind === 'health' ? this.pie() : kind === 'armour' ? this.bushShirt() : this.cash();
      this.pickups.set(kind, parts);
    }
    return assemble(parts, false);
  }

  private weaponParts(id: string): Part[] | null {
    let parts = this.weapons.get(id);
    if (parts === undefined) {
      const pieces = id === 'bat' ? this.bat() : id === 'pistol' ? this.pistol() : id === 'shotgun' ? this.shotgun() : id === 'rifle' ? this.rifle() : null;
      parts = pieces ? bundle(pieces, SCALE[id] ?? 1) : null;
      this.weapons.set(id, parts);
    }
    return parts;
  }

  // ───────────── Weapons (weapon space, metres) ─────────────

  /** Willow cricket bat with a red-taped handle. 0.93 m long; held half-way down the handle. */
  private bat(): Piece[] {
    const m = this.materials;
    const willow = m.get('timber', { color: 0xe8d6a8, roughness: 0.62 });
    const tape = m.get('rubber', { color: 0xb3261e, roughness: 0.8 });
    const cap = m.get('rubber', { color: 0x141414 });
    return [
      [tape, tube(0.0165, 0.0165, 0.3, 0, 0, -0.12, 10)],
      [cap, tube(0.019, 0.019, 0.014, 0, 0, -0.134, 10)],
      [cap, tube(0.0175, 0.0175, 0.012, 0, 0, 0.165, 10)],
      // Shoulders splice the handle into the blade.
      [willow, box(0.07, 0.03, 0.06, 0, 0, 0.205)],
      [willow, box(0.108, 0.036, 0.55, 0, 0, 0.5)],
      // The spine down the back of the blade.
      [willow, box(0.052, 0.022, 0.42, 0, 0.027, 0.53)],
      [willow, box(0.1, 0.03, 0.02, 0, 0, 0.785)],
    ];
  }

  private pistol(): Piece[] {
    const m = this.materials;
    const steel = m.get('metal', { color: 0x2b2d32, roughness: 0.38 });
    const bright = m.get('metal', { color: 0x8c9096, roughness: 0.3 });
    const grip = m.get('rubber', { color: 0x2a211c, roughness: 0.85 });
    return [
      [grip, box(0.03, 0.095, 0.042, 0, -0.018, -0.012, 0.22)],
      [steel, box(0.03, 0.028, 0.15, 0, 0.04, 0.035)],
      [steel, box(0.032, 0.034, 0.19, 0, 0.07, 0.03)],
      [bright, tube(0.008, 0.008, 0.018, 0, 0.068, 0.122, 8)],
      // Trigger guard and trigger.
      [steel, box(0.012, 0.007, 0.05, 0, 0.012, 0.045)],
      [steel, box(0.012, 0.022, 0.007, 0, 0.022, 0.07)],
      [bright, box(0.007, 0.02, 0.007, 0, 0.02, 0.036)],
      // Sights and hammer.
      [steel, box(0.02, 0.008, 0.01, 0, 0.091, -0.055)],
      [steel, box(0.006, 0.008, 0.01, 0, 0.091, 0.115)],
      [steel, box(0.01, 0.018, 0.012, 0, 0.078, -0.07)],
    ];
  }

  /** Pump-action shotgun: timber stock and fore-end, tube magazine under the barrel. */
  private shotgun(): Piece[] {
    const m = this.materials;
    const steel = m.get('metal', { color: 0x26282c, roughness: 0.4 });
    const timber = m.get('timber', { color: 0x6b4226, roughness: 0.6 });
    const pad = m.get('rubber', { color: 0x1a1a1a });
    return [
      // Butt: drops away behind the grip.
      [timber, box(0.042, 0.1, 0.3, 0, -0.02, -0.23, -0.12)],
      [pad, box(0.044, 0.104, 0.014, 0, -0.038, -0.385, -0.12)],
      [timber, box(0.036, 0.055, 0.1, 0, 0, -0.035, 0.25)],
      [steel, box(0.046, 0.07, 0.24, 0, 0.04, 0.1)],
      [steel, tube(0.0125, 0.0125, 0.56, 0, 0.062, 0.2, 10)],
      [steel, tube(0.011, 0.011, 0.44, 0, 0.034, 0.2, 10)],
      // The pump.
      [timber, tube(0.025, 0.025, 0.17, 0, 0.036, 0.34, 10)],
      [steel, box(0.02, 0.05, 0.012, 0, 0.048, 0.63)],
      [steel, box(0.01, 0.007, 0.07, 0, -0.002, 0.045)],
      [steel, box(0.006, 0.008, 0.008, 0, 0.078, 0.75)],
    ];
  }

  /** Bolt-action .22: one-piece wooden stock, slim blued barrel, bolt handle on the right. */
  private rifle(): Piece[] {
    const m = this.materials;
    const blued = m.get('metal', { color: 0x22262c, roughness: 0.36 });
    const bright = m.get('metal', { color: 0x9a9da2, roughness: 0.28 });
    const timber = m.get('timber', { color: 0x7a4b28, roughness: 0.55 });
    const pad = m.get('rubber', { color: 0x1a1a1a });
    return [
      [timber, box(0.038, 0.105, 0.3, 0, -0.032, -0.26, -0.14)],
      [pad, box(0.04, 0.108, 0.014, 0, -0.054, -0.415, -0.14)],
      [timber, box(0.034, 0.05, 0.13, 0, 0, -0.055, 0.2)],
      // Fore-stock under the barrel, tapering at the tip.
      [timber, box(0.038, 0.042, 0.46, 0, 0.02, 0.22)],
      [timber, box(0.032, 0.034, 0.05, 0, 0.022, 0.47)],
      [blued, tube(0.015, 0.015, 0.2, 0, 0.054, -0.02, 10)],
      [blued, tube(0.011, 0.0085, 0.56, 0, 0.054, 0.18, 10)],
      // Bolt: body out the back of the receiver, handle and knob on the right (−x).
      [bright, tube(0.008, 0.008, 0.06, 0, 0.054, -0.075, 8)],
      [bright, box(0.045, 0.01, 0.01, -0.03, 0.05, -0.012)],
      [bright, box(0.017, 0.017, 0.017, -0.056, 0.042, -0.012)],
      [blued, box(0.022, 0.04, 0.05, 0, -0.012, 0.09)],
      [blued, box(0.01, 0.007, 0.07, 0, -0.012, 0.03)],
      // Iron sights.
      [blued, box(0.014, 0.01, 0.012, 0, 0.072, 0.24)],
      [blued, box(0.005, 0.014, 0.008, 0, 0.07, 0.72)],
    ];
  }

  // ───────────── Pickups (origin at the centre, y up) ─────────────

  /** A meat pie. */
  private pie(): Part[] {
    const m = this.materials;
    const glow = (color: number) => m.get('plain', { color, roughness: 0.75, emissive: color, emissiveIntensity: 0.3 });
    const pastry = glow(0xc8944a);
    const rim = glow(0xdcae62);
    const lid = glow(0xb9772f);
    const vent = m.get('plain', { color: 0x4a2a12 });
    return bundle(
      [
        [pastry, disc(0.105, 0.085, 0.05, 0, 0, 0)],
        [rim, disc(0.113, 0.113, 0.012, 0, 0.028, 0)],
        [lid, disc(0.082, 0.104, 0.016, 0, 0.04, 0)],
        [vent, box(0.034, 0.004, 0.008, 0, 0.049, 0)],
        [vent, box(0.008, 0.004, 0.034, 0, 0.049, 0)],
      ],
      1.7,
    );
  }

  /** A bush shirt: red and black check, sleeves cut short. */
  private bushShirt(): Part[] {
    const m = this.materials;
    const red = m.get('cloth', { color: 0xa32a22, emissive: 0xa32a22, emissiveIntensity: 0.25 });
    const black = m.get('cloth', { color: 0x1c1a1a });
    return bundle(
      [
        [red, box(0.34, 0.42, 0.14, 0, 0, 0)],
        [red, box(0.1, 0.07, 0.15, 0.2, 0.165, 0)],
        [red, box(0.1, 0.07, 0.15, -0.2, 0.165, 0)],
        [black, box(0.15, 0.04, 0.15, 0, 0.225, 0)],
        // The check: bands standing a hair proud of the cloth.
        [black, box(0.344, 0.036, 0.144, 0, -0.09, 0)],
        [black, box(0.344, 0.036, 0.144, 0, 0.07, 0)],
        [black, box(0.036, 0.424, 0.144, 0.09, 0, 0)],
        [black, box(0.036, 0.424, 0.144, -0.09, 0, 0)],
      ],
      1.15,
    );
  }

  /** A banded bundle of notes. */
  private cash(): Part[] {
    const m = this.materials;
    const notes = m.get('plain', { color: 0x5d9a78, roughness: 0.7, emissive: 0x5d9a78, emissiveIntensity: 0.3 });
    const band = m.get('plain', { color: 0xefe6cf, roughness: 0.8 });
    return bundle(
      [
        [notes, box(0.21, 0.06, 0.1, 0, 0, 0)],
        [band, box(0.045, 0.064, 0.104, 0, 0, 0)],
      ],
      1.4,
    );
  }
}
