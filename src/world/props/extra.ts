import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import { canvasTexture } from '../../render/textures';
import { painted } from '../landmarks/paint';
import { mergeGeometries, registerProp, type PropDef } from './index';
import { VEGETATION } from './vegetation';

/**
 * Street furniture, fences and specimen trees. Geometry is authored with its base at y = 0, facing +z,
 * at scale 1. Every part of a kind is one draw call per chunk, so kinds are kept to one or two parts.
 *
 * The first twelve are the shared kinds named in the contract. The rest (fence panels, a rotary
 * clothesline, a static parked car, bunting, drums, pallets) are used by the building archetypes;
 * anyone may use them, but they are not part of the contract.
 *
 * `minor` props are thinned out or dropped at lower quality, so only loose set dressing is marked minor:
 * anything laid end to end in a run (fence panels, hedges, bunting) would be left with gaps.
 */

/** Box by centre. */
const bx = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** Upright cylinder / cone by centre. */
const cy = (rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, segments = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(x, y, z);
/** Cylinder lying along x. */
const cyX = (r: number, len: number, x = 0, y = 0, z = 0, segments = 10) => new THREE.CylinderGeometry(r, r, len, segments).rotateZ(Math.PI / 2).translate(x, y, z);

/** A convex side profile in the z–y plane, extruded across x to ±hw (car bodies, cappings). */
function extrudeX(profile: readonly (readonly [number, number])[], hw: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = profile.length;
  for (let i = 1; i + 1 < n; i++) {
    // The two flanks, wound so both face outwards.
    pos.push(hw, profile[0][1], profile[0][0], hw, profile[i][1], profile[i][0], hw, profile[i + 1][1], profile[i + 1][0]);
    pos.push(-hw, profile[0][1], profile[0][0], -hw, profile[i + 1][1], profile[i + 1][0], -hw, profile[i][1], profile[i][0]);
  }
  for (let i = 0; i < n; i++) {
    const [z0, y0] = profile[i];
    const [z1, y1] = profile[(i + 1) % n];
    pos.push(-hw, y0, z0, hw, y1, z1, hw, y0, z0, -hw, y0, z0, -hw, y1, z1, hw, y1, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── Contract kinds ─────────────────────────────

registerProp('phone-box', (m) => {
  // Red telephone box: corner posts, a kick panel all round, small-paned glazing, a stepped cap with the sign on it.
  const frame: THREE.BufferGeometry[] = [bx(1, 0.06, 1, 0, 0.03, 0), bx(1.04, 0.22, 1.04, 0, 2.27, 0), bx(0.8, 0.1, 0.8, 0, 2.43, 0), bx(0.3, 0.46, 0.14, 0, 1.3, -0.36), bx(0.5, 0.04, 0.28, 0, 0.98, -0.3)];
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) frame.push(bx(0.07, 2.2, 0.07, x, 1.1, z));
  // Three glazed sides (the back is solid below the shelf); each has a kick panel and a grid of glazing bars.
  const side = (rot: number, solid: boolean) => {
    const parts: THREE.BufferGeometry[] = [bx(0.84, solid ? 1.0 : 0.5, 0.03, 0, solid ? 0.5 : 0.28, 0.45)];
    for (const y of solid ? [1.42, 1.8] : [0.92, 1.3, 1.68]) parts.push(bx(0.84, 0.03, 0.035, 0, y, 0.45));
    for (const x of [-0.14, 0.14]) parts.push(bx(0.03, solid ? 1.14 : 1.62, 0.035, x, solid ? 1.59 : 1.35, 0.45));
    return parts.map((g) => g.rotateY(rot));
  };
  frame.push(...side(0, false), ...side(Math.PI / 2, false), ...side(-Math.PI / 2, false), ...side(Math.PI, true));
  const glass: THREE.BufferGeometry[] = [];
  for (const [rot, y, h] of [[0, 1.35, 1.64], [Math.PI / 2, 1.35, 1.64], [-Math.PI / 2, 1.35, 1.64], [Math.PI, 1.6, 1.14]] as const) glass.push(new THREE.PlaneGeometry(0.84, h).translate(0, y, 0.45).rotateY(rot));
  const sign: THREE.BufferGeometry[] = [];
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) sign.push(new THREE.PlaneGeometry(0.8, 0.16).translate(0, 2.27, 0.525).rotateY(rot));
  return {
    parts: [
      { geometry: mergeGeometries(frame), material: m.get('paintedMetal', { color: 0x9e2a22 }) },
      { geometry: mergeGeometries(glass), material: m.get('glass', { transparent: true, opacity: 0.3, doubleSided: true }) },
      { geometry: mergeGeometries(sign), material: m.sign('TELEPHONE', { bg: '#f2ead6', fg: '#1d2a44', style: 'block', aspect: 5 }) },
    ],
    collider: { radius: 0.5, height: 2.3 },
  };
});

registerProp('bus-shelter', (m) => {
  // Council shelter: steel posts, a shallow roof with a fascia, a panelled back, glazed ends above a dado, a slatted seat.
  const frame: THREE.BufferGeometry[] = [bx(3.8, 0.08, 1.8, 0, 2.36, 0.1), bx(3.8, 0.16, 0.05, 0, 2.28, 0.98), bx(3.3, 2.2, 0.04, 0, 1.15, -0.62)];
  for (const x of [-1.65, 1.65]) {
    for (const z of [-0.6, 0.6]) frame.push(bx(0.07, 2.32, 0.07, x, 1.16, z));
    frame.push(bx(0.04, 0.9, 1.2, x, 0.5, 0), bx(0.05, 0.05, 1.2, x, 1.5, 0));
  }
  for (const z of [-0.5, -0.38, -0.26]) frame.push(bx(2.9, 0.04, 0.09, 0, 0.47, z));
  for (const x of [-1.2, 0, 1.2]) frame.push(bx(0.06, 0.45, 0.34, x, 0.23, -0.38));
  const glass: THREE.BufferGeometry[] = [];
  for (const x of [-1.65, 1.65]) glass.push(bx(0.015, 1.3, 1.16, x, 1.6, 0));
  return {
    parts: [
      { geometry: mergeGeometries(frame), material: m.get('paintedMetal', { color: 0x4f6f5c }) },
      { geometry: mergeGeometries(glass), material: m.get('glass', { transparent: true, opacity: 0.3 }) },
      { geometry: new THREE.PlaneGeometry(0.9, 0.6).translate(0.9, 1.5, -0.595), material: m.sign('BUS\nSTOP', { bg: '#f0c33a', fg: '#1c1c1c', style: 'block', aspect: 1.5 }) },
    ],
    collider: { radius: 0.7, height: 2.3 },
  };
});

registerProp('bin', (m) => ({
  // Council litter bin: a drum on a short post with a hooded top.
  parts: [
    {
      geometry: mergeGeometries([cy(0.05, 0.05, 0.25, 0, 0.125, 0, 6), cy(0.27, 0.24, 0.72, 0, 0.6, 0, 10), cy(0.3, 0.3, 0.05, 0, 0.98, 0, 10), cy(0.2, 0.3, 0.16, 0, 1.08, 0, 10)]),
      material: m.get('paintedMetal', { color: 0x2f5d3a }),
    },
  ],
  minor: true,
}));

registerProp('bench', (m) => {
  const slat = (y: number, z: number) => bx(1.7, 0.035, 0.09, 0, y, z);
  const end = (x: number) => mergeGeometries([bx(0.06, 0.45, 0.06, x, 0.225, 0.16), bx(0.06, 0.9, 0.06, x, 0.45, -0.2), bx(0.06, 0.05, 0.46, x, 0.43, -0.02)]);
  return {
    // Park bench; you sit facing +z.
    parts: [
      {
        geometry: mergeGeometries([slat(0.47, 0.14), slat(0.47, 0.02), slat(0.47, -0.1), bx(1.7, 0.09, 0.035, 0, 0.68, -0.22), bx(1.7, 0.09, 0.035, 0, 0.84, -0.24), end(-0.75), end(0.75)]),
        material: m.get('timber', { color: 0x6f5a44 }),
      },
    ],
    minor: true,
  };
});

registerProp('postbox', (m) => ({
  // Red posting box on a pedestal.
  parts: [
    {
      geometry: mergeGeometries([bx(0.3, 0.62, 0.3, 0, 0.31, 0), bx(0.5, 0.66, 0.42, 0, 0.95, 0), new THREE.CylinderGeometry(0.25, 0.25, 0.42, 12).rotateX(Math.PI / 2).translate(0, 1.28, 0)]),
      material: m.get('paintedMetal', { color: 0xb5261e }),
    },
    {
      geometry: new THREE.PlaneGeometry(0.36, 0.12).translate(0, 0.95, 0.213),
      material: m.sign('POST', { bg: '#b5261e', fg: '#ffffff', style: 'block', aspect: 3, border: false }),
    },
  ],
  collider: { radius: 0.26, height: 1.4 },
}));

registerProp('power-pole', (m) => {
  const cups: THREE.BufferGeometry[] = [];
  for (const x of [-1.05, -0.45, 0.45, 1.05]) cups.push(cy(0.04, 0.05, 0.14, x, 9.47, 0, 6));
  for (const x of [-0.75, 0, 0.75]) cups.push(cy(0.04, 0.05, 0.14, x, 8.67, 0, 6));
  return {
    // Timber pole with two crossarms and insulators. No wires: they cannot span between instances.
    parts: [
      {
        geometry: mergeGeometries([cy(0.11, 0.16, 10, 0, 5, 0, 7), bx(2.4, 0.1, 0.1, 0, 9.35, 0.1), bx(1.8, 0.1, 0.1, 0, 8.55, 0.1), ...cups]),
        material: m.get('timber', { color: 0x5e4d3c }),
      },
    ],
    collider: { radius: 0.18, height: 9 },
  };
});

registerProp('road-sign', (m) => ({
  // Yellow diamond warning sign on a steel post, facing +z.
  parts: [
    { geometry: cy(0.03, 0.03, 2.5, 0, 1.25, -0.03, 6), material: m.get('metal') },
    { geometry: bx(0.62, 0.62, 0.02).rotateZ(Math.PI / 4).translate(0, 2.15, 0), material: m.get('paintedMetal', { color: 0xf0c020 }) },
  ],
}));

registerProp('rugby-posts', (m) => ({
  // Goal: uprights 5.6 m apart, crossbar at 3 m, padded bases. The plane of the posts faces +z.
  parts: [
    {
      geometry: mergeGeometries([cy(0.05, 0.06, 10, -2.8, 5, 0), cy(0.05, 0.06, 10, 2.8, 5, 0), cyX(0.05, 5.6, 0, 3, 0, 8), bx(0.34, 1.7, 0.34, -2.8, 0.85, 0), bx(0.34, 1.7, 0.34, 2.8, 0.85, 0)]),
      material: m.get('paintedMetal', { color: 0xf2f0e8 }),
    },
  ],
}));

registerProp('fence-post', (m) => ({
  parts: [{ geometry: cy(0.055, 0.065, 1.25, 0, 0.625, 0, 6), material: m.get('timber', { color: 0x8a7a66 }) }],
  minor: true,
}));

// The three plant kinds of the contract list (`hedge`, 2 m of clipped hedge along x; `tree-norfolk-pine`;
// `tree-phoenix-palm`) are built in ./vegetation.ts with the other trees.
for (const kind of ['hedge', 'tree-norfolk-pine', 'tree-phoenix-palm']) registerProp(kind, VEGETATION[kind]);

// ───────────────────────────── Used by the building archetypes ─────────────────────────────

registerProp('picket-fence', (m) => {
  // 2.4 m panel along x: one post, two rails, pickets. Tint it for cream or weathered paint.
  const parts: THREE.BufferGeometry[] = [bx(0.09, 1.05, 0.09, -1.2, 0.525, -0.03), bx(2.4, 0.07, 0.04, 0, 0.3, -0.03), bx(2.4, 0.07, 0.04, 0, 0.74, -0.03)];
  for (let i = 0; i < 12; i++) parts.push(bx(0.075, 0.9, 0.02, -1.1 + i * 0.2, 0.5, 0));
  return { parts: [{ geometry: mergeGeometries(parts), material: m.get('plain', { color: 0xf3eddc }) }], castShadow: false };
});

registerProp('farm-fence', (m) => {
  // 4 m of post-and-wire along x: posts at the start and middle, five wires.
  const parts: THREE.BufferGeometry[] = [cy(0.055, 0.065, 1.3, -2, 0.65, 0, 6), cy(0.04, 0.045, 1.2, 0, 0.6, 0, 5)];
  for (const y of [0.25, 0.45, 0.65, 0.85, 1.08]) parts.push(bx(4, 0.016, 0.016, 0, y, 0));
  return { parts: [{ geometry: mergeGeometries(parts), material: m.get('timber', { color: 0x8a8070 }) }], castShadow: false };
});

registerProp('chainlink-fence', (m) => {
  // 3 m of security fence along x: tube posts, top and bottom rails, three strands of barbed wire, and
  // diamond mesh that is cut out of its panel (alpha test) rather than blended over what is behind it.
  let mesh: THREE.Material = m.get('metal', { color: 0xb8bcc0, transparent: true, opacity: 0.28, doubleSided: true });
  if (typeof document !== 'undefined') {
    const tex = canvasTexture(64, 64, (g) => {
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = '#c4c8cc';
      g.lineWidth = 5;
      g.lineCap = 'square';
      g.beginPath();
      for (const o of [-64, 0, 64]) {
        g.moveTo(o, 0);
        g.lineTo(o + 64, 64);
        g.moveTo(o + 64, 0);
        g.lineTo(o, 64);
      }
      g.stroke();
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3 / 0.11, 1.82 / 0.11);
    tex.anisotropy = 8;
    mesh = m.register(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.5 }));
  }
  const steel: THREE.BufferGeometry[] = [cy(0.035, 0.035, 2.25, -1.5, 1.125, 0, 6), bx(3, 0.04, 0.04, 0, 1.9, 0), bx(3, 0.03, 0.03, 0, 0.06, 0), bx(0.03, 0.34, 0.03, -1.5, 2.2, 0.1).rotateX(0)];
  for (const [y, z] of [[2.06, 0.04], [2.16, 0.09], [2.26, 0.14]] as const) steel.push(bx(3, 0.012, 0.012, 0, y, z));
  return {
    parts: [
      { geometry: mergeGeometries(steel), material: m.get('metal') },
      { geometry: new THREE.PlaneGeometry(3, 1.82).translate(0, 0.98, 0), material: mesh },
    ],
    castShadow: false,
  };
});

registerProp('trampoline', (m) => {
  // The round back-yard trampoline: black mat slung in a galvanised ring on six splayed legs.
  const R = 1.25;
  const parts: [THREE.BufferGeometry, number][] = [];
  const ring = new THREE.TorusGeometry(R, 0.03, 5, 18).rotateX(Math.PI / 2).translate(0, 0.78, 0);
  parts.push([ring, 0x9aa0a4]);
  parts.push([new THREE.CircleGeometry(R - 0.09, 18).rotateX(-Math.PI / 2).translate(0, 0.74, 0), 0x1b1c1e]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = cy(0.022, 0.022, 0.82, 0, 0.39, 0).rotateZ(0.22).rotateY(a).translate(Math.sin(a) * (R - 0.12), 0, Math.cos(a) * (R - 0.12));
    parts.push([leg, 0x9aa0a4]);
  }
  return { parts: [{ geometry: painted(parts), material: m.get('paintedMetal', { color: 0xffffff, vertexColors: true }) }], castShadow: false, minor: true };
});

registerProp('kennel', (m) => {
  // A dog kennel: gabled box, dark doorway, facing +z.
  const parts: [THREE.BufferGeometry, number][] = [
    [bx(0.8, 0.62, 0.95, 0, 0.31, 0), 0x8a7a66],
    [bx(0.9, 0.05, 1.05, 0, 0.66, 0).rotateZ(0.5), 0x6f5236],
    [bx(0.9, 0.05, 1.05, 0, 0.66, 0).rotateZ(-0.5), 0x6f5236],
    [bx(0.34, 0.4, 0.03, 0, 0.24, 0.47), 0x171310],
  ];
  return { parts: [{ geometry: painted(parts), material: m.get('timber', { color: 0xffffff, vertexColors: true }) }], castShadow: false, minor: true };
});

registerProp('washing-line', (m) => {
  // Rotary clothesline: the back-yard landmark.
  const parts: THREE.BufferGeometry[] = [cy(0.03, 0.03, 2, 0, 1, 0, 6)];
  for (const a of [Math.PI / 4, -Math.PI / 4]) parts.push(bx(2.7, 0.03, 0.03).rotateY(a).translate(0, 1.96, 0));
  for (const half of [0.95, 0.55]) {
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      parts.push(bx(sx ? 0.012 : half * 2, 0.012, sz ? 0.012 : half * 2, sx * half, 1.96, sz * half));
    }
  }
  return { parts: [{ geometry: mergeGeometries(parts), material: m.get('metal') }], castShadow: false, minor: true };
});

// ───────────────────────────── Static cars ─────────────────────────────
// Scenery that cannot be driven, nose to +z. One part each: the paintwork is white in the vertex colours, so the
// instance tint is the car's colour, and the glass, rubber and trim are dark enough that the tint barely shows.

const CAR_GLASS = 0x10161b;
const CAR_RUBBER = 0x0c0c0d;
const CAR_TRIM = 0x1b1c1f;

/** Six-sided solid between two rectangles `[x0, x1, z0, z1]`, one at height y0 and one at y1. */
function loft(b: readonly number[], y0: number, t: readonly number[], y1: number): THREE.BufferGeometry {
  const P = [
    [b[0], y0, b[2]], [b[1], y0, b[2]], [b[1], y0, b[3]], [b[0], y0, b[3]],
    [t[0], y1, t[2]], [t[1], y1, t[2]], [t[1], y1, t[3]], [t[0], y1, t[3]],
  ];
  const pos: number[] = [];
  for (const [a, c, d, e] of [[4, 7, 6, 5], [0, 1, 2, 3], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]]) {
    for (const i of [a, c, d, a, d, e]) pos.push(P[i][0], P[i][1], P[i][2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

interface StaticCar {
  /** Side profile of the body below the waist, [z, y]. */
  shell: readonly (readonly [number, number])[];
  hw: number;
  waist: number;
  roof: number;
  /** The glasshouse: back and front at the waist, back and front at the roof. */
  cabin: readonly [z0: number, z1: number, r0: number, r1: number];
  /** A panel van: the cabin is sheet metal behind this point. */
  panel?: number;
  wheels: readonly [rear: number, front: number];
  wheelR: number;
  /** Door shut lines. */
  seams: readonly number[];
}

function staticCar(c: StaticCar): THREE.BufferGeometry {
  const { hw, waist, roof } = c;
  const [z0, z1, r0, r1] = c.cabin;
  const back = c.shell[0][0];
  const nose = c.shell[c.shell.length - 1][0];
  const top = hw * 0.8;
  const base = hw * 0.95;
  const white = 0xffffff;
  const parts: [THREE.BufferGeometry, number][] = [[extrudeX(c.shell, hw), white]];
  // Glasshouse, with the roof and the pillars over it in body colour.
  const split = c.panel ?? z0;
  const at = (z: number) => r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
  if (c.panel !== undefined) parts.push([loft([-base, base, z0, split], waist, [-top, top, r0, at(split)], roof), white]);
  parts.push([loft([-base + 0.01, base - 0.01, split, z1], waist, [-top + 0.01, top - 0.01, at(split), r1], roof - 0.01), CAR_GLASS]);
  parts.push([bx(top * 2 + 0.05, 0.05, r1 - r0 + 0.08, 0, roof + 0.005, (r0 + r1) / 2), white]);
  const pillars = c.panel !== undefined ? [z1] : [z0, z1, ...c.seams.filter((z) => z > z0 + 0.3 && z < z1 - 0.5)];
  for (const z of pillars) {
    const zt = at(z);
    for (const side of [-1, 1]) {
      // A post 6 cm wide, standing a centimetre proud of the glass.
      const span = (x: number): [number, number] => (side > 0 ? [x - 0.05, x + 0.012] : [x - 0.012, x + 0.05]);
      parts.push([loft([...span(side * base), z - 0.05, z + 0.05], waist, [...span(side * top), zt - 0.05, zt + 0.05], roof), white]);
    }
  }
  // Bumpers, grille, tail lamps, rubbing strips, shut lines.
  parts.push([bx(hw * 2 + 0.06, 0.16, 0.14, 0, 0.42, nose - 0.01), CAR_TRIM], [bx(hw * 2 + 0.06, 0.16, 0.14, 0, 0.42, back + 0.01), CAR_TRIM]);
  parts.push([bx(hw * 1.45, 0.13, 0.04, 0, 0.66, nose + 0.02), CAR_TRIM], [bx(hw * 1.8, 0.11, 0.04, 0, 0.7, back - 0.015), 0x4a0d0a]);
  for (const side of [-1, 1]) {
    const flank = (w: number, h: number, y: number, z: number) => new THREE.PlaneGeometry(w, h).rotateY((side * Math.PI) / 2).translate(side * (hw + 0.004), y, z);
    parts.push([flank((nose - back) * 0.66, 0.04, 0.57, (nose + back) / 2), CAR_TRIM]);
    for (const z of c.seams) parts.push([flank(0.014, waist - 0.42, (waist + 0.42) / 2, z), CAR_TRIM]);
    for (const z of c.wheels) {
      parts.push([cyX(c.wheelR, 0.22, side * (hw - 0.05), c.wheelR, z, 8), CAR_RUBBER]);
      parts.push([bx(0.1, 0.24, c.wheelR * 2 + 0.14, side * (hw - 0.024), c.wheelR + 0.19, z), CAR_TRIM]);
    }
  }
  return painted(parts);
}

const SEDAN: StaticCar = { shell: [[-2.16, 0.3], [-2.2, 0.62], [-2.08, 0.86], [-1.3, 0.9], [0.98, 0.9], [2.02, 0.8], [2.2, 0.6], [2.16, 0.3]], hw: 0.84, waist: 0.9, roof: 1.37, cabin: [-1.4, 1.0, -0.88, 0.42], wheels: [-1.36, 1.36], wheelR: 0.31, seams: [-0.92, 0.02, 0.92] };
const WAGON: StaticCar = { shell: [[-2.2, 0.3], [-2.24, 0.6], [-2.2, 0.9], [1.0, 0.9], [2.04, 0.8], [2.22, 0.6], [2.18, 0.3]], hw: 0.84, waist: 0.9, roof: 1.41, cabin: [-2.17, 1.02, -1.98, 0.44], wheels: [-1.38, 1.38], wheelR: 0.31, seams: [-1.22, -0.1, 0.94] };
const VAN: StaticCar = { shell: [[-2.2, 0.34], [-2.22, 1.02], [1.5, 1.02], [2.12, 0.94], [2.24, 0.62], [2.2, 0.34]], hw: 0.86, waist: 1.02, roof: 1.92, cabin: [-2.2, 1.62, -2.18, 1.04], panel: 0.5, wheels: [-1.3, 1.42], wheelR: 0.33, seams: [-0.55, 0.5, 1.5] };

for (const [kind, car] of [['car-parked', SEDAN], ['car-parked-wagon', WAGON], ['van-parked', VAN]] as const) {
  registerProp(kind, (m) => ({ parts: [{ geometry: staticCar(car), material: m.get('carpaint', { color: 0xffffff, vertexColors: true }) }] }));
}

registerProp('bunting', (m) => {
  // 7 m of car-yard flags along x, sagging between pole tops at 4.4 m.
  const colors = [
    [0.78, 0.13, 0.1],
    [0.95, 0.78, 0.15],
    [0.12, 0.3, 0.62],
    [0.95, 0.94, 0.9],
    [0.15, 0.45, 0.25],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const tints: number[] = [];
  const flags = 16;
  const sag = (x: number) => 4.4 - 0.55 * (1 - (x / 3.5) ** 2);
  for (let i = 0; i < flags; i++) {
    const x0 = -3.5 + (7 * i) / flags;
    const x1 = x0 + 7 / flags;
    const xm = (x0 + x1) / 2;
    positions.push(x0, sag(x0), 0, x1, sag(x1), 0, xm, sag(xm) - 0.48, 0);
    const c = colors[i % colors.length];
    for (let k = 0; k < 3; k++) {
      normals.push(0, 0, 1);
      tints.push(c[0], c[1], c[2]);
    }
    uvs.push(0, 1, 1, 1, 0.5, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
  return { parts: [{ geometry: g, material: m.get('plain', { vertexColors: true, doubleSided: true }) }], castShadow: false };
});

registerProp('drum', (m) => ({
  // 44-gallon drum; tint it.
  parts: [
    {
      geometry: mergeGeometries([cy(0.29, 0.29, 0.88, 0, 0.44, 0, 10), cy(0.305, 0.305, 0.03, 0, 0.3, 0, 10), cy(0.305, 0.305, 0.03, 0, 0.6, 0, 10)]),
      material: m.get('paintedMetal', { color: 0xffffff }),
    },
  ],
  minor: true,
}));

registerProp('pallet', (m) => {
  // A few pallets stacked, with a carton left on top.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const y = i * 0.15;
    parts.push(bx(1.2, 0.025, 1, 0, y + 0.13, 0), bx(1.2, 0.025, 1, 0, y + 0.012, 0));
    for (const x of [-0.55, 0, 0.55]) parts.push(bx(0.09, 0.095, 1, x, y + 0.07, 0));
  }
  parts.push(bx(0.8, 0.5, 0.7, 0.1, 0.7, -0.05));
  return { parts: [{ geometry: mergeGeometries(parts), material: m.get('timber', { color: 0xb89868 }) }], minor: true };
});

// ───────────────────────────── Round 3: the shopping street ─────────────────────────────
// Small things that stand at the kerb or against a shop wall. One part each, in vertex colours on one shared
// material, and none casts a shadow: a kind costs one draw call per chunk and nothing in the shadow passes.

const STEEL = 0x8d9194;
const streetPaint = (m: Parameters<Parameters<typeof registerProp>[1]>[0]) => m.get('plain', { vertexColors: true, roughness: 0.55 });

registerProp('parking-meter', (m) => ({
  // Coin meter at the head of a marked bay; the dial faces +z (the footpath).
  parts: [
    {
      geometry: painted([
        [cy(0.03, 0.035, 1.05, 0, 0.525, 0, 5), STEEL],
        [bx(0.17, 0.24, 0.13, 0, 1.17, 0), 0x3f444a],
        [bx(0.13, 0.07, 0.13, 0, 1.325, 0), 0x3f444a],
        [bx(0.11, 0.06, 0.012, 0, 1.3, 0.064), 0xe8e4d4],
        [bx(0.035, 0.035, 0.014, 0.025, 1.3, 0.066), 0xb5261e],
        [bx(0.07, 0.1, 0.012, 0, 1.15, 0.064), 0xa4a9ad],
      ]),
      material: streetPaint(m),
    },
  ],
  castShadow: false,
  minor: true,
}));

registerProp('zebra-pole', (m) => {
  // Black and white banded pole with an orange globe, one each side of a pedestrian crossing.
  const parts: [THREE.BufferGeometry, number][] = [[new THREE.IcosahedronGeometry(0.17, 1).translate(0, 2.3, 0), 0xf29a1c], [cy(0.07, 0.07, 0.05, 0, 2.13, 0, 8), 0x1a1a1c]];
  for (let i = 0; i < 7; i++) parts.push([cy(0.045, 0.045, 0.3, 0, 0.15 + i * 0.3, 0, 8), i % 2 === 0 ? 0x1a1a1c : 0xf0eee6]);
  return { parts: [{ geometry: painted(parts), material: streetPaint(m) }], castShadow: false };
});

registerProp('stop-sign', (m) => {
  // Red octagon on a steel post, facing +z; the letters are set in from a 3 by 5 dot face.
  const FACE: Record<string, string> = { S: '111100111001111', T: '111010010010010', O: '111101101101111', P: '111101111100100' };
  const parts: [THREE.BufferGeometry, number][] = [
    [cy(0.03, 0.03, 2.5, 0, 1.25, -0.035, 6), STEEL],
    [new THREE.CircleGeometry(0.41, 8, Math.PI / 8).translate(0, 2.1, 0), 0xf2efe6],
    [new THREE.CircleGeometry(0.37, 8, Math.PI / 8).translate(0, 2.1, 0.006), 0xc4231c],
    [new THREE.CircleGeometry(0.41, 8, Math.PI / 8).rotateY(Math.PI).translate(0, 2.1, -0.008), STEEL],
  ];
  const px = 0.038;
  'STOP'.split('').forEach((ch, k) => {
    for (let i = 0; i < 15; i++) {
      if (FACE[ch][i] !== '1') continue;
      const x = (k * 4 + (i % 3) - 7) * px;
      const y = 2.1 + (2 - Math.floor(i / 3)) * px;
      parts.push([new THREE.PlaneGeometry(px * 1.04, px * 1.04).translate(x, y, 0.012), 0xf6f4ee]);
    }
  });
  return { parts: [{ geometry: painted(parts), material: streetPaint(m) }], castShadow: false };
});

registerProp('sandwich-board', (m) => {
  // A-frame board at the kerb, read from either way along the footpath (its faces look along ±z). The boards
  // are white here: tint the instance for cream, yellow, pale blue or a blackboard.
  const face = (flip: number): [THREE.BufferGeometry, number][] => {
    const leaf: [THREE.BufferGeometry, number][] = [
      [bx(0.56, 0.88, 0.022, 0, 0.44, 0), 0xffffff],
      [bx(0.5, 0.15, 0.006, 0, 0.74, 0.014), 0x8a1f1a],
      [bx(0.56, 0.03, 0.03, 0, 0.87, 0), 0x2a2622],
    ];
    for (let i = 0; i < 4; i++) leaf.push([bx(i === 3 ? 0.26 : 0.4 - (i % 2) * 0.08, 0.045, 0.006, i === 3 ? -0.07 : 0, 0.58 - i * 0.115, 0.014), 0x26282c]);
    return leaf.map(([g, c]): [THREE.BufferGeometry, number] => [g.rotateX(-0.21).translate(0, 0, 0.19).rotateY(flip), c]);
  };
  return { parts: [{ geometry: painted([...face(0), ...face(Math.PI)]), material: streetPaint(m) }], castShadow: false, minor: true };
});

type Painted = [THREE.BufferGeometry, number][];

/**
 * The day's newspaper poster in its wire frame, leaning back against a shop wall; faces +z. Coloured pieces, for
 * the prop below or to merge into a chunk's own geometry (it stands against a wall: nothing drives into it).
 */
export function newsBillboardParts(): Painted {
  const flat: Painted = [
    [bx(0.5, 0.74, 0.012, 0, 0.47, 0), 0xf0ede2],
    [bx(0.5, 0.11, 0.006, 0, 0.785, 0.008), 0x1f3f7a],
    [bx(0.4, 0.1, 0.006, 0, 0.62, 0.008), 0x141416],
    [bx(0.44, 0.1, 0.006, 0, 0.49, 0.008), 0x141416],
    [bx(0.3, 0.1, 0.006, -0.06, 0.36, 0.008), 0x141416],
    [bx(0.36, 0.03, 0.006, 0, 0.22, 0.008), 0x6a6c70],
    [bx(0.54, 0.03, 0.03, 0, 0.86, 0), 0x2a2c2e],
    [bx(0.03, 0.88, 0.03, -0.27, 0.44, 0), 0x2a2c2e],
    [bx(0.03, 0.88, 0.03, 0.27, 0.44, 0), 0x2a2c2e],
  ];
  return flat.map(([g, c]): [THREE.BufferGeometry, number] => [g.rotateX(-0.16).translate(0, 0, 0.14), c]);
}

/** A greengrocer's stand: a sloping board on trestles with three boxes of fruit; the customer stands at +z. */
export function shopCratesParts(): Painted {
  const top: Painted = [[bx(1.5, 0.03, 0.62, 0, 0, 0), 0xa98a62]];
  const fruit = [0xe08a1e, 0xb5261e, 0x86a83c];
  for (let i = 0; i < 3; i++) {
    const x = -0.5 + i * 0.5;
    top.push([bx(0.46, 0.13, 0.54, x, 0.08, 0), 0xc9a877], [bx(0.4, 0.06, 0.48, x, 0.15, 0), fruit[i]]);
    for (let k = 0; k < 4; k++) top.push([new THREE.IcosahedronGeometry(0.075, 0).translate(x - 0.11 + (k % 2) * 0.22, 0.2, -0.12 + Math.floor(k / 2) * 0.24), fruit[i]]);
  }
  const parts = top.map(([g, c]): [THREE.BufferGeometry, number] => [g.rotateX(0.24).translate(0, 0.62, 0), c]);
  for (const x of [-0.66, 0.66]) parts.push([bx(0.05, 0.7, 0.05, x, 0.35, -0.24), 0x6f5a44], [bx(0.05, 0.54, 0.05, x, 0.27, 0.24), 0x6f5a44]);
  parts.push([bx(0.5, 0.3, 0.36, -0.3, 0.15, -0.02), 0xb89868], [bx(0.5, 0.3, 0.36, 0.3, 0.15, 0.0), 0x9c8258]);
  return parts;
}

registerProp('news-billboard', (m) => ({ parts: [{ geometry: painted(newsBillboardParts()), material: streetPaint(m) }], castShadow: false, minor: true }));
registerProp('shop-crates', (m) => ({ parts: [{ geometry: painted(shopCratesParts()), material: streetPaint(m) }], castShadow: false, minor: true }));

// ───────────────────────────── Round 3: yards ─────────────────────────────

registerProp('skip-bin', (m) => {
  // Steel skip, 3.4 m along z, half full; tint it.
  const parts: [THREE.BufferGeometry, number][] = [[loft([-0.72, 0.72, -1.25, 1.25], 0, [-0.86, 0.86, -1.7, 1.7], 1.15), 0xffffff], [bx(1.6, 0.06, 3.2, 0, 1.12, 0), 0x3d362e], [bx(1.0, 0.3, 1.2, 0.15, 1.2, -0.5), 0x5a5046], [bx(0.5, 0.2, 1.6, -0.3, 1.2, 0.6), 0x8a7a66]];
  for (const z of [-0.8, 0.8]) for (const x of [-0.82, 0.82]) parts.push([bx(0.07, 1.1, 0.09, x, 0.6, z), 0xd8d8d8]);
  for (const z of [-1.72, 1.72]) parts.push([bx(1.76, 0.07, 0.07, 0, 1.14, z), 0xd8d8d8]);
  return { parts: [{ geometry: painted(parts), material: m.get('paintedMetal', { color: 0xffffff, vertexColors: true }) }] };
});

registerProp('timber-stack', (m) => {
  // Packs of sawn timber on bearers, 4.2 m along z, strapped.
  const parts: [THREE.BufferGeometry, number][] = [];
  const tones = [0xd2b48a, 0xc6a677, 0xdcc096];
  for (let k = 0; k < 3; k++) {
    const y = 0.1 + k * 0.62;
    const w = k === 2 ? 1.0 : 1.15;
    parts.push([bx(w, 0.5, 4.2 - k * 0.3, k === 2 ? -0.07 : 0, y + 0.25, k * 0.1), tones[k]]);
    for (const z of [-1.4, 0, 1.4]) parts.push([bx(1.2, 0.1, 0.1, 0, y - 0.05, z), 0x6f5a44], [bx(w + 0.012, 0.512, 0.03, k === 2 ? -0.07 : 0, y + 0.25, z + 0.5), 0x2a2c2e]);
  }
  return { parts: [{ geometry: painted(parts), material: m.get('timber', { color: 0xffffff, vertexColors: true }) }] };
});

registerProp('woodpile', (m) => {
  // A winter's firewood stacked along x, split ends showing to ±z.
  const parts: [THREE.BufferGeometry, number][] = [];
  const tones = [0x8a6a48, 0x9c7a55, 0x6f5236, 0xa98a62];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 8 - (row === 3 ? 3 : 0); i++) {
      const r = 0.1 + ((i * 7 + row * 3) % 4) * 0.012;
      parts.push([new THREE.CylinderGeometry(r, r, 0.42 + ((i + row) % 3) * 0.03, 6).rotateX(Math.PI / 2).translate(-0.82 + i * 0.235 + (row % 2) * 0.11, 0.11 + row * 0.2, 0), tones[(i + row * 2) % 4]]);
    }
  }
  return { parts: [{ geometry: painted(parts), material: m.get('timber', { color: 0xffffff, vertexColors: true }) }], castShadow: false, minor: true };
});

registerProp('water-tank', (m) => {
  // Corrugated rainwater tank on a timber stand, with a downpipe elbow.
  const parts: [THREE.BufferGeometry, number][] = [[cy(0.95, 0.95, 1.7, 0, 1.75, 0, 14), 0xa7adb0], [cy(0.2, 0.98, 0.26, 0, 2.73, 0, 14), 0x8f9598], [bx(1.9, 0.12, 1.9, 0, 0.84, 0), 0x6f5a44]];
  for (let i = 0; i < 5; i++) parts.push([cy(0.965, 0.965, 0.05, 0, 1.1 + i * 0.33, 0, 14), 0x8f9598]);
  for (const x of [-0.8, 0.8]) for (const z of [-0.8, 0.8]) parts.push([bx(0.14, 0.8, 0.14, x, 0.4, z), 0x5e4d3c]);
  parts.push([cy(0.04, 0.04, 0.5, 0.7, 0.55, 0.99, 6), 0x8f9598]);
  return { parts: [{ geometry: painted(parts), material: m.get('corrugated', { color: 0xffffff, vertexColors: true }) }] };
});

registerProp('trailer', (m) => {
  // Single-axle garden trailer, drawbar to +z; tint the tray.
  const parts: [THREE.BufferGeometry, number][] = [[bx(1.3, 0.05, 2.3, 0, 0.5, -0.2), 0xffffff], [bx(0.08, 0.08, 1.3, 0, 0.44, 1.5), 0x2a2c2e], [bx(0.1, 0.1, 0.1, 0, 0.46, 2.16), 0x8d9194], [cy(0.025, 0.025, 0.42, 0, 0.21, 1.9, 5), 0x2a2c2e], [bx(1.5, 0.06, 0.06, 0, 0.36, -0.2), 0x2a2c2e]];
  for (const x of [-0.63, 0.63]) parts.push([bx(0.04, 0.4, 2.3, x, 0.72, -0.2), 0xffffff], [cyX(0.28, 0.16, x * 1.2, 0.28, -0.2, 10), CAR_RUBBER], [bx(0.2, 0.03, 0.74, x * 1.2, 0.6, -0.2), 0xffffff]);
  for (const z of [-1.33, 0.93]) parts.push([bx(1.3, 0.4, 0.04, 0, 0.72, z), 0xffffff]);
  return { parts: [{ geometry: painted(parts), material: m.get('paintedMetal', { color: 0xffffff, vertexColors: true }) }] };
});

registerProp('boat-trailer', (m) => {
  // Aluminium dinghy on its trailer, bow and drawbar to +z, outboard tilted up at the stern.
  const hull = loft([-0.34, 0.34, -1.9, 1.5], 0.58, [-0.74, 0.74, -1.95, 1.55], 1.12);
  const bow = loft([-0.34, 0.34, 1.5, 1.9], 0.62, [-0.74, 0.74, 1.55, 2.5], 1.12);
  const p = bow.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 1.6) p.setX(i, p.getX(i) * 0.12);
  bow.computeVertexNormals();
  const parts: [THREE.BufferGeometry, number][] = [[hull, 0xb4b9bc], [bow, 0xb4b9bc], [bx(1.3, 0.04, 0.26, 0, 1.0, -0.6), 0x8a6a48], [bx(1.2, 0.04, 0.26, 0, 1.0, 0.5), 0x8a6a48], [bx(0.24, 0.42, 0.3, 0, 1.3, -2.02), 0x1d1e21], [bx(0.1, 0.6, 0.1, 0, 0.9, -2.12), 0x4a4f55]];
  parts.push([bx(0.08, 0.08, 4.6, 0, 0.42, 0.6), 0x8d9194], [bx(1.5, 0.06, 0.06, 0, 0.36, -0.5), 0x8d9194], [cy(0.025, 0.025, 0.4, 0, 0.2, 2.6, 5), 0x2a2c2e]);
  for (const x of [-0.78, 0.78]) parts.push([cyX(0.26, 0.15, x, 0.26, -0.5, 10), CAR_RUBBER], [bx(0.19, 0.03, 0.66, x, 0.56, -0.5), 0x8d9194]);
  return { parts: [{ geometry: painted(parts), material: m.get('paintedMetal', { color: 0xffffff, vertexColors: true }) }] };
});

/**
 * Three-aspect signal on a yellow post, facing +z (the driver waiting at the limit line), with its black
 * target board. The lamps are live where the library can drive them (one town-wide cycle; `axis` says which
 * phase this signal follows — the placement gives crossing roads opposite axes), dark rounds anywhere else.
 */
function trafficSignal(m: MaterialLibrary, axis: 'a' | 'b'): PropDef {
  const BLACK = 0x17181a;
  const parts: [THREE.BufferGeometry, number][] = [
    [cy(0.055, 0.07, 3.7, 0, 1.85, 0, 8), 0xc49a22],
    [cy(0.09, 0.1, 0.5, 0, 0.25, 0, 8), BLACK],
    [bx(0.56, 1.3, 0.03, 0, 3.05, 0.09), BLACK],
    [bx(0.3, 1.02, 0.2, 0, 3.05, 0.2), 0x202124],
    [bx(0.13, 0.2, 0.09, 0, 1.15, 0.09), 0xc49a22],
  ];
  for (const x of [-0.27, 0.27]) parts.push([bx(0.025, 1.3, 0.035, x, 3.05, 0.092), 0xe9e6dc]);
  for (const y of [2.41, 3.69]) parts.push([bx(0.56, 0.025, 0.035, 0, y, 0.092), 0xe9e6dc]);
  for (const y of [3.38, 3.05, 2.72]) parts.push([bx(0.26, 0.02, 0.15, 0, y + 0.125, 0.36), BLACK]);
  const out: PropDef['parts'] = [{ geometry: painted(parts), material: streetPaint(m) }];
  const aspects: ['red' | 'amber' | 'green', number][] = [['red', 3.38], ['amber', 3.05], ['green', 2.72]];
  const dark = [0x5c1714, 0x6a4a10, 0x15401f];
  for (let i = 0; i < aspects.length; i++) {
    const [aspect, y] = aspects[i];
    const lens = new THREE.CircleGeometry(0.1, 10).translate(0, y, 0.302);
    out.push({ geometry: lens, material: m.signalLamp?.(axis, aspect) ?? m.get('plain', { color: dark[i] }) });
  }
  return { parts: out, castShadow: false };
}

registerProp('traffic-signal', (m) => trafficSignal(m, 'a'));
registerProp('traffic-signal-cross', (m) => trafficSignal(m, 'b'));
