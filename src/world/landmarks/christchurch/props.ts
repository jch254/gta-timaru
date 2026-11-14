import * as THREE from 'three';
import { canopy, mergeGeometries, registerProp } from '../../props/index';
import { blob, bx, cy, cyX, painted } from '../paint';
import { plinth, prism } from './kit';

/**
 * Instanced props used by the Christchurch landmarks and the urban scatterer. All kinds are prefixed `chch-`
 * so they cannot collide with the shared street-furniture kinds. Base at y = 0, facing +z, scale 1.
 */

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Boat-shaped plan pointed at both ends: length along z, widest amidships. */
const boatPlan = (len: number, beam: number, blunt = 0.12): [number, number][] => {
  const l = len / 2;
  const b = beam / 2;
  return [
    [-b * blunt, -l],
    [b * blunt, -l],
    [b * 0.8, -l * 0.55],
    [b, 0],
    [b * 0.8, l * 0.55],
    [b * blunt, l],
    [-b * blunt, l],
    [-b * 0.8, l * 0.55],
    [-b, 0],
    [-b * 0.8, -l * 0.55],
  ];
};

// Park bench: painted timber slats on cast-iron ends.
registerProp('chch-bench', (m) => ({
  parts: [
    {
      geometry: mergeGeometries([box(1.8, 0.05, 0.42, 0, 0.45, 0.02), box(1.8, 0.13, 0.04, 0, 0.66, -0.2), box(1.8, 0.13, 0.04, 0, 0.84, -0.22)]),
      material: m.get('timber', { color: 0x3d6046 }),
    },
    {
      geometry: mergeGeometries([
        box(0.06, 0.45, 0.42, -0.78, 0.225, 0.02),
        box(0.06, 0.45, 0.42, 0.78, 0.225, 0.02),
        box(0.06, 0.5, 0.06, -0.78, 0.68, -0.21),
        box(0.06, 0.5, 0.06, 0.78, 0.68, -0.21),
        box(0.06, 0.05, 0.44, -0.78, 0.64, 0.02),
        box(0.06, 0.05, 0.44, 0.78, 0.64, 0.02),
      ]),
      material: m.get('paintedMetal', { color: 0x1f2422 }),
    },
  ],
  minor: true,
}));

// Cast-iron lamp standard with a lantern.
registerProp('chch-lamp-standard', (m) => ({
  parts: [
    {
      geometry: mergeGeometries([
        new THREE.CylinderGeometry(0.13, 0.2, 0.9, 8).translate(0, 0.45, 0),
        new THREE.CylinderGeometry(0.06, 0.09, 3.3, 8).translate(0, 2.55, 0),
        box(0.8, 0.05, 0.05, 0, 3.6, 0),
        new THREE.ConeGeometry(0.3, 0.24, 6).translate(0, 4.76, 0),
      ]),
      material: m.get('paintedMetal', { color: 0x1c3328 }),
    },
    { geometry: new THREE.CylinderGeometry(0.22, 0.14, 0.44, 6).translate(0, 4.42, 0), material: m.emitter(0xffe2a8, 'night') },
  ],
  collider: { radius: 0.14, height: 4 },
}));

// Concrete tub with shrubs and bedding plants.
registerProp('chch-planter', (m) => ({
  parts: [
    { geometry: new THREE.CylinderGeometry(0.95, 0.75, 0.7, 10).translate(0, 0.35, 0), material: m.get('concrete', { color: 0xaaa69c }) },
    {
      geometry: canopy(
        [
          [0, 1.0, 0, 0.62, 0.7],
          [0.4, 0.85, 0.25, 0.4, 0.7],
          [-0.38, 0.85, -0.2, 0.42, 0.7],
        ],
        0,
      ),
      material: m.get('foliage', { color: 0x4a7038 }),
    },
    {
      geometry: canopy(
        [
          [0.55, 0.74, -0.35, 0.2, 0.6],
          [-0.5, 0.74, 0.4, 0.2, 0.6],
          [0.1, 0.74, 0.62, 0.18, 0.6],
          [-0.62, 0.74, -0.3, 0.17, 0.6],
        ],
        0,
      ),
      material: m.get('plain', { color: 0xc93a44, roughness: 0.9 }),
    },
  ],
  collider: { radius: 0.8, height: 0.7 },
}));

// Oval bedding display: dug soil, a green edging and two colours of annuals.
registerProp('chch-flowerbed', (m) => {
  const blobs = (count: number, phase: number, radius: number): [number, number, number, number, number][] => {
    const out: [number, number, number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      out.push([Math.cos(a) * 2.3 * radius, 0.24, Math.sin(a) * 1.1 * radius, 0.3, 0.6]);
    }
    return out;
  };
  return {
    parts: [
      { geometry: new THREE.CylinderGeometry(1, 1, 0.16, 16).scale(2.7, 1, 1.4).translate(0, 0.08, 0), material: m.get('plain', { color: 0x4a3a2c, roughness: 1 }) },
      { geometry: canopy(blobs(12, 0, 0.92), 0), material: m.get('plain', { color: 0xd2384a, roughness: 0.9 }) },
      { geometry: canopy([...blobs(8, 0.3, 0.55), [0, 0.28, 0, 0.36, 0.6]], 0), material: m.get('plain', { color: 0xf0c53a, roughness: 0.9 }) },
      { geometry: canopy(blobs(6, 0.9, 0.28), 0), material: m.get('foliage', { color: 0x4f7a3a }) },
    ],
    minor: true,
  };
});

// Flat-bottomed punt: varnished hull with raked ends, cushioned thwarts and the pole laid along it.
registerProp('chch-punt', (m) => {
  const hull = mergeGeometries([
    // Solid bottom raked up at both ends (side profile extruded across the beam), side planks and end decks.
    prism([[-3.0, 0], [3.0, 0], [3.7, 0.32], [-3.7, 0.32]], 1.24).rotateY(-Math.PI / 2).translate(0, -0.12, 0),
    box(0.06, 0.24, 7.2, -0.62, 0.32, 0),
    box(0.06, 0.24, 7.2, 0.62, 0.32, 0),
    box(1.3, 0.08, 0.9, 0, 0.4, -3.2),
    box(1.3, 0.08, 0.9, 0, 0.4, 3.2),
    new THREE.CylinderGeometry(0.03, 0.03, 4.4, 5).rotateX(Math.PI / 2).translate(0.5, 0.48, -0.6),
  ]);
  return {
    parts: [
      { geometry: hull, material: m.get('timber', { color: 0x8a6238, roughness: 0.55 }) },
      { geometry: mergeGeometries([box(1.1, 0.1, 0.55, 0, 0.26, -1.0), box(1.1, 0.1, 0.55, 0, 0.26, 0.6), box(1.1, 0.4, 0.08, 0, 0.42, 0.92)]), material: m.get('cloth', { color: 0x8a2228 }) },
    ],
  };
});

// Rowing skiff with its oars shipped outboard.
registerProp('chch-skiff', (m) => ({
  parts: [
    { geometry: plinth(boatPlan(8.2, 0.6, 0.05), 0.26).translate(0, -0.08, 0), material: m.get('timber', { color: 0xc49a5c, roughness: 0.5 }) },
    {
      geometry: mergeGeometries([box(3.8, 0.03, 0.09, 0, 0.24, -0.9), box(3.8, 0.03, 0.09, 0, 0.24, 0.9), box(0.42, 0.04, 0.3, 0, 0.2, -1.3), box(0.42, 0.04, 0.3, 0, 0.2, 0.5)]),
      material: m.get('plain', { color: 0xf2efe6, roughness: 0.6 }),
    },
  ],
}));

// Canoe; tint per instance for the hire-fleet colours.
registerProp('chch-canoe', (m) => ({
  parts: [
    { geometry: plinth(boatPlan(4.6, 0.82), 0.34).translate(0, -0.08, 0), material: m.get('plain', { color: 0xffffff, roughness: 0.45 }) },
    { geometry: plinth(boatPlan(3.9, 0.6), 0.02).translate(0, 0.262, 0), material: m.get('plain', { color: 0x2a2622, roughness: 0.9 }) },
  ],
}));

// Rugby goal posts with padded bases.
registerProp('chch-rugby-posts', (m) => ({
  parts: [
    {
      geometry: mergeGeometries([
        new THREE.CylinderGeometry(0.05, 0.08, 10, 6).translate(-2.8, 5, 0),
        new THREE.CylinderGeometry(0.05, 0.08, 10, 6).translate(2.8, 5, 0),
        new THREE.CylinderGeometry(0.05, 0.05, 5.6, 6).rotateZ(Math.PI / 2).translate(0, 3, 0),
      ]),
      material: m.get('paintedMetal', { color: 0xf4f4ee }),
    },
    { geometry: mergeGeometries([box(0.36, 1.7, 0.36, -2.8, 0.85, 0), box(0.36, 1.7, 0.36, 2.8, 0.85, 0)]), material: m.get('cloth', { color: 0xb0161e }) },
  ],
}));

// Pigeon, for the Square.
registerProp('chch-pigeon', (m) => ({
  parts: [
    {
      geometry: mergeGeometries([new THREE.IcosahedronGeometry(0.1, 0).scale(1, 0.85, 1.6).translate(0, 0.12, 0), new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.22, 0.13)]),
      material: m.get('plain', { color: 0x70777f, roughness: 0.9 }),
    },
  ],
  minor: true,
  castShadow: false,
}));

// ───────────────────────────── Round 2: street life ─────────────────────────────
// Shared by every town (the street scatterer, the Square, Caroline Bay), so these carry no `chch-` prefix.
// Small ones are a single part and cast no shadow: each part of a kind is a draw call per chunk and per cascade.

const GREY = 0x9a9ea0;

// Give-way sign with the street-name blades above it, on a steel post. The triangle faces +z (towards the
// driver coming up to the junction).
registerProp('junction-sign', (m) => {
  const tri = (r: number, z: number) => new THREE.CircleGeometry(r, 3, -Math.PI / 2).translate(0, 1.95, z);
  return {
    parts: [
      {
        geometry: painted([
          [cy(0.035, 0.035, 2.95, 0, 1.475, -0.04, 6), GREY],
          [tri(0.47, 0), 0xc4231c],
          [tri(0.3, 0.008), 0xf4f2ea],
          [tri(0.47, 0).rotateY(Math.PI).translate(0, 0, -0.012), GREY],
          // Street-name blades: one along each street, white with a dark line of lettering.
          [bx(0.8, 0.16, 0.02, 0.1, 2.84, -0.04), 0xf4f2ea],
          [bx(0.56, 0.06, 0.026, 0.1, 2.84, -0.04), 0x1c2a3a],
          [bx(0.02, 0.16, 0.8, 0, 2.66, 0.06), 0xf4f2ea],
          [bx(0.026, 0.06, 0.56, 0, 2.66, 0.06), 0x1c2a3a],
        ]),
        material: m.get('plain', { vertexColors: true, roughness: 0.6 }),
      },
    ],
    castShadow: false,
  };
});

// Council rubbish bags put out at the kerb on collection day.
registerProp('rubbish-bag', (m) => ({
  parts: [
    {
      geometry: mergeGeometries([blob(0.3, 0, 0.26, 0, 1, 0.95, 0.9), blob(0.27, 0.42, 0.22, 0.12, 0.95, 0.9, 1), blob(0.06, 0, 0.56, 0), blob(0.06, 0.42, 0.48, 0.12)]),
      material: m.get('plain', { color: 0x1d1e21, roughness: 0.45 }),
    },
  ],
  castShadow: false,
  minor: true,
}));

// Picnic table with fixed bench seats; the table runs along x.
registerProp('picnic-table', (m) => {
  const parts: THREE.BufferGeometry[] = [bx(1.9, 0.05, 0.78, 0, 0.75, 0), bx(1.9, 0.05, 0.28, 0, 0.44, 0.68), bx(1.9, 0.05, 0.28, 0, 0.44, -0.68)];
  for (const x of [-0.7, 0.7]) {
    parts.push(bx(0.08, 0.06, 1.64, x, 0.39, 0));
    for (const side of [-1, 1]) parts.push(bx(0.08, 0.86, 0.08, x, 0.37, 0).rotateX(side * 0.42).translate(0, 0.02, side * 0.36));
  }
  return { parts: [{ geometry: mergeGeometries(parts), material: m.get('timber', { color: 0x7a5d42 }) }], minor: true };
});

// Bike stand: a hoop rail with two bikes leaning in it. Runs along x.
registerProp('bike-stand', (m) => {
  const wheel = (x: number, z: number) => new THREE.TorusGeometry(0.33, 0.018, 4, 12).rotateY(Math.PI / 2).translate(x, 0.35, z);
  const bike = (x: number, lean: number, paint: number): [THREE.BufferGeometry, number][] => {
    const tube = (a: [number, number], b: [number, number]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return bx(0.03, 0.03, len)
        .rotateX(-Math.atan2(b[1] - a[1], b[0] - a[0]))
        .translate(0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
    };
    const frame = [tube([-0.52, 0.35], [-0.1, 0.9]), tube([-0.1, 0.9], [0.4, 0.92]), tube([0.4, 0.92], [0.52, 0.35]), tube([-0.1, 0.9], [0.05, 0.36]), tube([0.05, 0.36], [0.4, 0.92]), tube([-0.52, 0.35], [0.05, 0.36])];
    const all: [THREE.BufferGeometry, number][] = [
      [wheel(0, -0.52), 0x1a1a1c],
      [wheel(0, 0.52), 0x1a1a1c],
      ...frame.map((g): [THREE.BufferGeometry, number] => [g, paint]),
      [bx(0.42, 0.03, 0.03, 0, 1.0, 0.42), 0x2a2a2c],
      [bx(0.12, 0.05, 0.24, 0, 0.95, -0.14), 0x2a2a2c],
    ];
    return all.map(([g, c]): [THREE.BufferGeometry, number] => [g.rotateZ(lean).translate(x, 0, 0), c]);
  };
  const rail: [THREE.BufferGeometry, number][] = [
    [bx(2.6, 0.05, 0.05, 0, 0.8, 0.5), GREY],
    [cy(0.03, 0.03, 0.8, -1.28, 0.4, 0.5, 6), GREY],
    [cy(0.03, 0.03, 0.8, 1.28, 0.4, 0.5, 6), GREY],
    [cy(0.03, 0.03, 0.8, 0, 0.4, 0.5, 6), GREY],
  ];
  return {
    parts: [{ geometry: painted([...rail, ...bike(-0.7, 0.1, 0xb5261e), ...bike(0.45, -0.08, 0x2b4a6b)]), material: m.get('plain', { vertexColors: true, roughness: 0.5 }) }],
    castShadow: false,
    minor: true,
  };
});

// Piece for the giant chess set in the Square; the instance tint is its side, the scale its rank.
registerProp('chess-piece', (m) => ({
  parts: [
    {
      geometry: mergeGeometries([cy(0.2, 0.24, 0.1, 0, 0.05, 0, 10), cy(0.08, 0.17, 0.42, 0, 0.31, 0, 8), cy(0.13, 0.13, 0.04, 0, 0.53, 0, 8), blob(0.12, 0, 0.66, 0, 1, 1, 1, 1)]),
      material: m.get('plain', { color: 0xffffff, roughness: 0.4 }),
    },
  ],
  castShadow: false,
  minor: true,
}));

// City bus laid up at a stop, in the red and cream of the Christchurch fleet: nose to +z, 10.6 m. Two parts
// (paintwork in vertex colours, glass and rubber), so the livery is fixed here rather than set by an instance tint.
registerProp('bus-parked', (m) => {
  const RED = 0xb5261e;
  const CREAM = 0xefe6cc;
  const body: [THREE.BufferGeometry, number][] = [
    [bx(2.5, 1.14, 10.6, 0, 0.99, 0), RED],
    [bx(2.5, 0.36, 10.6, 0, 2.84, 0), CREAM],
    [bx(2.52, 0.14, 10.62, 0, 1.56, 0), CREAM],
    [bx(1.6, 0.34, 0.08, 0, 2.52, 5.3), CREAM],
  ];
  for (const z of [-5.25, -3.6, -1.9, -0.2, 1.5, 3.2, 4.3, 5.25]) for (const x of [-1.23, 1.23]) body.push([bx(0.06, 1.1, 0.14, x, 2.15, z), CREAM]);
  for (const x of [-0.95, 0.95]) body.push([bx(0.24, 0.16, 0.06, x, 0.95, 5.31), CREAM]);
  const dark: THREE.BufferGeometry[] = [bx(2.42, 1.06, 10.5, 0, 2.14, 0), bx(2.3, 1.0, 0.1, 0, 2.0, 5.27), bx(2.54, 0.2, 0.14, 0, 0.5, 5.3), bx(2.54, 0.2, 0.14, 0, 0.5, -5.3), bx(0.08, 1.9, 0.9, 1.25, 1.5, 3.9)];
  for (const x of [-1.08, 1.08]) for (const z of [-3.1, 3.4]) dark.push(cyX(0.48, 0.3, x, 0.48, z, 12));
  return {
    parts: [
      { geometry: painted(body), material: m.get('plain', { vertexColors: true, roughness: 0.35 }) },
      { geometry: mergeGeometries(dark), material: m.get('glass') },
    ],
  };
});
