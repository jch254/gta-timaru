import * as THREE from 'three';
import { canvasTexture } from '../../render/textures';
import { mergeGeometries, registerProp } from './index';
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

registerProp('car-parked', (m) => {
  // Static early-90s sedan, nose to +z; the instance tint is the paint. Scenery only: it cannot be driven.
  // Body: a shaped shell up to the waistline, a roof on pillars. Dark part: the glasshouse, tyres, bumpers, grille.
  const shell = extrudeX(
    [
      [-2.16, 0.3],
      [-2.2, 0.62],
      [-2.08, 0.86],
      [-1.3, 0.9],
      [0.98, 0.9],
      [2.02, 0.8],
      [2.2, 0.6],
      [2.16, 0.3],
    ],
    0.84,
  );
  const paint: THREE.BufferGeometry[] = [shell, bx(1.34, 0.05, 1.28, 0, 1.385, -0.26)];
  // Pillars from the waist to the roof.
  for (const x of [-0.69, 0.69]) {
    paint.push(bx(0.07, 0.5, 0.09, x, 1.13, 0.42), bx(0.07, 0.5, 0.13, x, 1.13, -0.92), bx(0.06, 0.5, 0.07, x, 1.13, -0.22));
  }
  const glasshouse = new THREE.BoxGeometry(1.52, 0.5, 2.26);
  const pos = glasshouse.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setXYZ(i, pos.getX(i) * 0.88, pos.getY(i), pos.getZ(i) * 0.58 - 0.1);
  }
  glasshouse.computeVertexNormals();
  glasshouse.translate(0, 1.13, -0.17);
  const dark: THREE.BufferGeometry[] = [glasshouse, bx(1.74, 0.16, 0.14, 0, 0.42, 2.19), bx(1.74, 0.16, 0.14, 0, 0.42, -2.19), bx(1.2, 0.14, 0.04, 0, 0.66, 2.2), bx(1.5, 0.12, 0.04, 0, 0.7, -2.2)];
  for (const x of [-0.8, 0.8]) for (const z of [-1.36, 1.36]) dark.push(cyX(0.31, 0.22, x, 0.31, z, 8), bx(0.1, 0.24, 0.76, x * 1.02, 0.5, z));
  return {
    parts: [
      { geometry: mergeGeometries(paint), material: m.get('carpaint', { color: 0xffffff }) },
      { geometry: mergeGeometries(dark), material: m.get('glass') },
    ],
  };
});

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
