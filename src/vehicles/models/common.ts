import * as THREE from 'three';
import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';

/**
 * Shared pieces for procedural vehicle models. Conventions: the model faces +z, origin on the ground
 * under the centre, right-hand drive (driver at local x < 0), wheels returned in order FL, FR, RL, RR
 * where "left" is local +x.
 */

/** Side-profile point: [z (forward +), y (up)]. */
export type Profile = [z: number, y: number][];

/** Extrude a side profile across the vehicle's width, with softened edges. Centred on x. */
export function extrudeProfile(profile: Profile, width: number, bevel = 0.06): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // Shape is drawn in (z, y); extrusion runs along the shape's own z. Rotate so that maps to vehicle x.
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export function makeWheel(radius: number, width: number, m: MaterialLibrary, hub: THREE.Material = m.get('metal', { color: 0xb8bcc0, roughness: 0.35 })): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18).rotateZ(Math.PI / 2), m.get('rubber'));
  tyre.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.02, 12).rotateZ(Math.PI / 2), hub);
  g.add(tyre, cap);
  return g;
}

export interface CarShape {
  /** Body side profile, clockwise from the rear bumper bottom. */
  body: Profile;
  /** Glasshouse profile (sits on the body), or null for open vehicles. */
  cabin: Profile | null;
  /** Cabin width relative to body width. */
  cabinInset?: number;
  /** Ride height of the body floor above ground. */
  clearance: number;
}

/** Standard four-wheel car: body shell + glasshouse + lights + bumpers + wheels. */
export function buildCar(spec: VehicleSpec, color: number, m: MaterialLibrary, shape: CarShape): VehicleModel {
  const group = new THREE.Group();
  const paint = m.register(new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.5, envMapIntensity: 1.1 }));
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const W = spec.width;
  const L = spec.length;
  add(extrudeProfile(shape.body, W, 0.07), paint);
  if (shape.cabin) {
    const inset = shape.cabinInset ?? 0.88;
    // Painted roof and pillars, with a slightly proud glass volume inside them.
    add(extrudeProfile(shape.cabin, W * inset, 0.05), m.get('glass', { color: 0x1a242c, roughness: 0.06, metalness: 0.6 }));
    const top = Math.max(...shape.cabin.map((p) => p[1]));
    const roofPts = shape.cabin.filter((p) => p[1] > top - 0.02);
    const z0 = Math.min(...roofPts.map((p) => p[0]));
    const z1 = Math.max(...roofPts.map((p) => p[0]));
    add(new THREE.BoxGeometry(W * inset + 0.02, 0.05, z1 - z0 + 0.1), paint, 0, top + 0.01, (z0 + z1) / 2);
  }
  // Bumpers, grille, lights, plates.
  const chrome = m.get('chrome');
  const dark = m.get('plain', { color: 0x15171a, roughness: 0.6 });
  const front = Math.max(...shape.body.map((p) => p[0]));
  const rear = Math.min(...shape.body.map((p) => p[0]));
  const beltY = shape.clearance + 0.32;
  add(new THREE.BoxGeometry(W + 0.04, 0.13, 0.14), chrome, 0, shape.clearance + 0.1, front + 0.02);
  add(new THREE.BoxGeometry(W + 0.04, 0.13, 0.14), chrome, 0, shape.clearance + 0.1, rear - 0.02);
  add(new THREE.BoxGeometry(W * 0.5, 0.16, 0.05), dark, 0, beltY, front + 0.045);
  const headlights = m.emitter(0xfff3cf, 'night');
  const taillights = m.emitter(0xff2a1a, 'night');
  const lens = m.get('glass', { color: 0xdfe6ea, roughness: 0.1, metalness: 0.1 });
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.17, 0.06), lens, side * (W / 2 - 0.3), beltY, front + 0.05);
    add(new THREE.BoxGeometry(0.26, 0.11, 0.07), headlights, side * (W / 2 - 0.3), beltY, front + 0.055);
    add(new THREE.BoxGeometry(0.42, 0.15, 0.06), m.get('plain', { color: 0x7a1410, roughness: 0.3 }), side * (W / 2 - 0.32), beltY + 0.03, rear - 0.045);
    add(new THREE.BoxGeometry(0.3, 0.09, 0.07), taillights, side * (W / 2 - 0.32), beltY + 0.03, rear - 0.05);
  }
  // NZ plates of the era: black with silver characters (blank here).
  add(new THREE.BoxGeometry(0.36, 0.11, 0.02), dark, 0, shape.clearance + 0.12, front + 0.1);
  add(new THREE.BoxGeometry(0.36, 0.11, 0.02), dark, 0, shape.clearance + 0.14, rear - 0.1);

  const wheels: THREE.Object3D[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const wheel = makeWheel(spec.wheelRadius, spec.wheelWidth, m);
    wheel.position.set((sx * spec.track) / 2, spec.wheelRadius, (sz * spec.wheelbase) / 2);
    group.add(wheel);
    wheels.push(wheel);
  }
  const seatY = shape.clearance + 0.28;
  return {
    group,
    wheels,
    seats: [
      { x: -W * 0.22, y: seatY, z: 0.1 },
      { x: W * 0.22, y: seatY, z: 0.1 },
      { x: -W * 0.22, y: seatY, z: -0.85 },
      { x: W * 0.22, y: seatY, z: -0.85 },
    ].slice(0, spec.seats),
    headlights,
    taillights,
    bodyMaterial: paint,
  };
  void L;
}
