import * as THREE from 'three';
import { mergeGeometries, registerProp } from '../../props';
import { painted } from '../paint';

/**
 * Instanced prop kinds for the plains: livestock, hay, fence furniture and SH1's power poles. Used by the
 * rural scatterer and by the farm landmarks (woolshed yards, saleyards). Geometry stands on y = 0 facing +z.
 * Livestock and fence parts carry no colliders.
 */
export const PROP = {
  sheep: 'sheep',
  cow: 'cow',
  friesian: 'cow-friesian',
  bale: 'hay-bale',
  post: 'farm-post',
  gate: 'farm-gate',
  letterbox: 'rural-letterbox',
  pole: 'rural-power-pole',
  trough: 'water-trough',
} as const;

/** Where the three conductors sit on a power pole: sideways offsets and height above its base. */
export const POLE_WIRES = { offsets: [-1.0, 0, 1.0], height: 9.62 } as const;
/** Half the width of the farm gate, to the outside of its strainer posts. */
export const GATE_HALF = 2.3;

const leg = (x: number, z: number, h: number, r: number) => new THREE.CylinderGeometry(r, r * 0.8, h, 4, 1, true).translate(x, h / 2, z);

registerProp(PROP.sheep, (m) => ({
  parts: [
    // Fleece: a squashed low-poly blob. The instance tint varies it from fresh-shorn to dusty.
    { geometry: new THREE.IcosahedronGeometry(0.42, 0).scale(0.72, 0.66, 1.12).translate(0, 0.62, -0.03), material: m.get('plain', { color: 0xeee8d8, roughness: 1 }) },
    {
      geometry: mergeGeometries([
        new THREE.BoxGeometry(0.17, 0.2, 0.27).rotateX(0.35).translate(0, 0.74, 0.5),
        leg(-0.14, 0.26, 0.4, 0.04),
        leg(0.14, 0.26, 0.4, 0.04),
        leg(-0.14, -0.3, 0.4, 0.04),
        leg(0.14, -0.3, 0.4, 0.04),
      ]),
      material: m.get('plain', { color: 0xcfc5ae, roughness: 0.9 }),
    },
  ],
  minor: true,
}));

const cowBody = () => [
  new THREE.BoxGeometry(0.62, 0.7, 1.55).translate(0, 1.0, -0.05),
  new THREE.BoxGeometry(0.3, 0.34, 0.5).rotateX(0.5).translate(0, 1.12, 0.92),
  leg(-0.22, 0.52, 0.68, 0.06),
  leg(0.22, 0.52, 0.68, 0.06),
  leg(-0.22, -0.62, 0.68, 0.06),
  leg(0.22, -0.62, 0.68, 0.06),
];

// Beef and Jersey cattle: one hide colour, set by the instance tint.
registerProp(PROP.cow, (m) => ({
  parts: [{ geometry: mergeGeometries(cowBody()), material: m.get('plain', { color: 0xffffff, roughness: 0.85 }) }],
  minor: true,
}));

// Dairy Friesian: black with a white saddle and blaze. Place without a tint.
registerProp(PROP.friesian, (m) => ({
  parts: [
    { geometry: mergeGeometries(cowBody()), material: m.get('plain', { color: 0x1d1c1b, roughness: 0.85 }) },
    {
      geometry: mergeGeometries([
        new THREE.BoxGeometry(0.64, 0.5, 0.5).translate(0, 0.98, -0.2),
        new THREE.BoxGeometry(0.31, 0.2, 0.3).rotateX(0.5).translate(0, 1.2, 0.86),
        new THREE.BoxGeometry(0.64, 0.3, 0.3).translate(0, 0.8, 0.45),
      ]),
      material: m.get('plain', { color: 0xf1ede2, roughness: 0.85 }),
    },
  ],
  minor: true,
}));

// Round bale lying on its side, axis along x.
registerProp(PROP.bale, (m) => ({
  parts: [{ geometry: new THREE.CylinderGeometry(0.75, 0.75, 1.2, 10).rotateZ(Math.PI / 2).translate(0, 0.74, 0), material: m.get('plain', { color: 0xcdb66c, roughness: 1 }) }],
  minor: true,
}));

// Fence post, sunk a little so it never floats on uneven ground.
registerProp(PROP.post, (m) => ({
  parts: [{ geometry: new THREE.BoxGeometry(0.11, 1.55, 0.11).translate(0, 0.4, 0), material: m.get('timber', { color: 0x8e8676 }) }],
  castShadow: false,
}));

// Steel farm gate across local x between two strainer posts.
registerProp(PROP.gate, (m) => {
  const bars: THREE.BufferGeometry[] = [];
  const w = 4.2;
  for (const y of [0.3, 0.52, 0.74, 0.96, 1.18]) bars.push(new THREE.BoxGeometry(w, 0.04, 0.03).translate(0, y, 0));
  for (const x of [-w / 2, 0, w / 2]) bars.push(new THREE.BoxGeometry(0.04, 0.92, 0.03).translate(x, 0.74, 0));
  const diagonal = Math.hypot(w / 2, 0.88);
  bars.push(new THREE.BoxGeometry(diagonal, 0.035, 0.025).rotateZ(Math.atan2(0.88, w / 2)).translate(-w / 4, 0.74, 0));
  bars.push(new THREE.BoxGeometry(diagonal, 0.035, 0.025).rotateZ(-Math.atan2(0.88, w / 2)).translate(w / 4, 0.74, 0));
  return {
    parts: [
      { geometry: mergeGeometries(bars), material: m.get('metal', { color: 0xa4a8a6, roughness: 0.55 }) },
      {
        geometry: mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(0.18, 1.85, 0.18).translate(s * (GATE_HALF - 0.09), 0.5, 0))),
        material: m.get('timber', { color: 0x8e8676 }),
      },
    ],
  };
});

// Rural delivery letterbox on a post; the instance tint is the paint colour.
registerProp(PROP.letterbox, (m) => ({
  parts: [
    {
      geometry: mergeGeometries([
        new THREE.BoxGeometry(0.09, 1.25, 0.09).translate(0, 0.42, 0),
        new THREE.BoxGeometry(0.26, 0.22, 0.44).translate(0, 1.16, 0.02),
        new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6).rotateX(Math.PI / 2).translate(0, 0.96, 0.02),
      ]),
      material: m.get('plain', { color: 0xffffff, roughness: 0.6 }),
    },
  ],
  minor: true,
}));

// Timber power pole with a crossarm (across local x) and three insulators.
registerProp(PROP.pole, (m) => ({
  parts: [
    {
      geometry: mergeGeometries([
        new THREE.CylinderGeometry(0.12, 0.17, 10.2, 6).translate(0, 4.7, 0),
        new THREE.BoxGeometry(2.4, 0.12, 0.12).translate(0, 9.4, 0),
        new THREE.BoxGeometry(0.06, 0.06, 0.9).rotateX(0.75).rotateY(Math.PI / 2).translate(0.42, 9.05, 0),
        new THREE.BoxGeometry(0.06, 0.06, 0.9).rotateX(0.75).rotateY(-Math.PI / 2).translate(-0.42, 9.05, 0),
      ]),
      material: m.get('timber', { color: 0x5e4d3c }),
    },
    {
      geometry: mergeGeometries(POLE_WIRES.offsets.map((x) => new THREE.CylinderGeometry(0.05, 0.06, 0.16, 5).translate(x, 9.54, 0))),
      material: m.get('plain', { color: 0xdad6c8, roughness: 0.4 }),
    },
  ],
  collider: { radius: 0.17, height: 9 },
}));

// Concrete stock trough.
registerProp(PROP.trough, (m) => ({
  parts: [
    { geometry: new THREE.BoxGeometry(2.0, 0.5, 0.7).translate(0, 0.25, 0), material: m.get('concrete') },
    { geometry: new THREE.BoxGeometry(1.84, 0.04, 0.54).translate(0, 0.49, 0), material: m.get('glass', { color: 0x3a7f86 }) },
  ],
  minor: true,
}));

// ───────────────────────────── Round 2: roadside, hill country and riverbed ─────────────────────────────

// (Tussock and lupins are plants: `src/world/props/vegetation.ts` defines them, with photographic leaves.)

// Volcanic outcrop for the Port Hills and the downs: a lumpy boulder sunk into the turf. Scale it 0.6–2.5.
registerProp('rock', (m) => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // Deterministic lumps: the same direction always gets the same push, so shared vertices stay welded.
    const k = 0.8 + 0.34 * Math.sin(x * 5.1 + y * 3.3) * Math.cos(z * 4.7 - y * 2.1) + 0.12 * Math.sin(z * 9.2 + x * 7.7);
    p.setXYZ(i, x * k * 1.15, y * k * 0.62 + 0.18, z * k);
  }
  g.computeVertexNormals();
  return { parts: [{ geometry: g, material: m.get('concrete', { color: 0x6f6a60, roughness: 1 }) }], collider: { radius: 0.7, height: 0.7 } };
});

// Highway edge marker post: white, with a red reflector facing +z.
registerProp('marker-post', (m) => ({
  parts: [
    {
      geometry: painted([
        [new THREE.BoxGeometry(0.1, 1.15, 0.035).translate(0, 0.45, 0), 0xf2f1ea],
        [new THREE.BoxGeometry(0.075, 0.13, 0.045).translate(0, 0.86, 0), 0xc4231c],
      ]),
      material: m.get('plain', { vertexColors: true, roughness: 0.5 }),
    },
  ],
  castShadow: false,
}));
