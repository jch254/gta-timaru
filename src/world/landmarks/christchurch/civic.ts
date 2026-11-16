import { LAMP_WARM } from '../../scatter/util';
import * as THREE from 'three';
import type { LandmarkBuilder } from '../../../core/types';
import { bronze, flagpole, lawn, statue } from './common';
import { Kit, type Pt2, arcade, cone, disc, ellipseDrum, ring, sphere, tartan, wedge } from './kit';

/**
 * Bridge of Remembrance: the stone memorial arch at the river end of Cashel Mall. The mall runs along local z and
 * passes through the tall central arch (7.4 m clear); the footpaths pass through the two small side arches.
 * 24.6 m wide, 16 m high.
 */
export const bridgeOfRemembrance: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const stone = m.get('limestone', { color: 0xdedacc });
  const trim = m.get('limestone', { color: 0xc6c1b0 });

  k.geo(arcade(12.4, 13.4, 3.6, [{ cx: 0, w: 7.4, h: 10 }]), stone);
  k.box(0, 13.4, 0, 13.0, 0.5, 4.2, trim);
  k.box(0, 13.9, 0, 9.6, 1.7, 3.2, stone);
  k.box(0, 15.6, 0, 6.4, 0.6, 2.6, trim);
  for (const face of [k.sub(0, 0, 1.6, 0), k.sub(0, 0, -1.6, Math.PI)]) {
    // Cross and wreath on the attic, motto on the frieze.
    face.dbox(0, 14.1, 0.03, 0.26, 1.3, 0.08, trim).dbox(0, 14.85, 0.03, 0.9, 0.24, 0.08, trim);
    face.geo(ring(0.5, 0.07, 12), bronze(m), -3.2, 14.75, 0.06).geo(ring(0.5, 0.07, 12), bronze(m), 3.2, 14.75, 0.06);
    face.sign('QUID NON PRO PATRIA', 0, 12.5, 0.22, 7, 0.7, 0, { bg: '#d9d5c6', fg: '#5c574b', style: 'paint', border: false });
  }
  for (const side of [-1, 1]) {
    k.box(side * 4.95, 0, 0, 2.9, 1.3, 4.1, trim);
    k.collide(side * 5.45, 0, 0, 3.5, 13.4, 3.6);
    // Side arch over the footpath, then the terminal pier with its lamp.
    k.geo(arcade(4.6, 7.6, 2.6, [{ cx: 0, w: 2.6, h: 5.2 }]), stone, side * 8.5);
    k.box(side * 8.5, 7.6, 0, 5.0, 0.4, 3.0, trim);
    k.collide(side * 10.3, 0, 0, 1.0, 7.6, 2.6);
    k.solid(side * 11.5, 0, 0, 1.6, 4.6, 2.8, stone);
    k.box(side * 11.5, 4.6, 0, 1.9, 0.35, 3.1, trim);
    k.cyl(side * 11.5, 4.95, 0, 0.12, 0.2, 0.7, trim, 8);
    k.geo(sphere(0.3, 8), m.emitter(0xffe2a8, 'night'), side * 11.5, 5.9, 0);
  }
  k.light(0, 6.5, 0, LAMP_WARM, 1.3, 20);
  k.flush();
};

/**
 * Christchurch Town Hall (1972): the elliptical auditorium drum ringed with concrete fins above a glazed
 * promenade, the theatre block beside it, a restaurant wing and a paved forecourt with the dandelion fountain.
 * Local +z is the forecourt.
 */
export const townHall: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const conc = m.get('concrete');
  const dark = m.get('concrete', { color: 0x8f8b82 });
  const glass = m.get('glass', { color: 0x2c3a40 });
  const win = m.windows('office');
  const az = -12;

  // Auditorium.
  k.geo(ellipseDrum(24.5, 20.5, 5.2, 32), glass, 0, 0, az);
  k.geo(ellipseDrum(25.6, 21.6, 0.6, 32), conc, 0, 5.2, az);
  k.geo(ellipseDrum(20, 16, 12.4, 32), conc, 0, 5.8, az);
  k.geo(ellipseDrum(21.4, 17.4, 0.9, 32), dark, 0, 18.2, az);
  k.geo(ellipseDrum(14, 10.5, 2.4, 24), dark, 0, 19.1, az);
  k.collide(0, 0, az, 36, 18, 28).collide(0, 0, az, 26, 18, 38);
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) / 24) * Math.PI * 2;
    k.sub(Math.cos(a) * 20.4, 0, az + Math.sin(a) * 16.4, Math.PI / 2 - a).dbox(0, 5.8, 0, 0.5, 12.4, 1.5, conc);
    if (i % 2 === 0) k.sub(Math.cos(a) * 24.7, 0, az + Math.sin(a) * 20.7, Math.PI / 2 - a).dbox(0, 0, 0, 0.45, 5.2, 0.45, dark);
  }

  // Entrance foyer facing the forecourt, under a deep canopy.
  k.solid(0, 0, 13, 32, 7.6, 9, conc);
  k.quad(0, 3.9, 17.54, 30, 6.4, win, 0, true);
  k.box(0, 7.6, 14.5, 34, 0.6, 13, dark);
  for (const x of [-14, -7, 0, 7, 14]) k.dbox(x, 0, 20.4, 0.5, 7.6, 0.5, conc);

  // Theatre block with its fly tower, to the right.
  k.solid(33, 0, -8, 20, 13, 28, conc);
  k.box(35, 13, -14, 14, 8, 12, dark);
  k.box(33, 13, -8, 20.4, 0.5, 28.4, dark);
  for (const z of [-18, -11, -4, 3]) k.box(43.2, 0, z, 0.7, 13, 1.2, dark);
  k.quad(33, 5.5, 6.04, 15, 6.4, win, 0, true);

  // Restaurant wing to the left, glazed under an oversailing roof.
  k.solid(-30, 0, 12, 17, 6.2, 15, conc);
  k.box(-30, 6.2, 12, 20, 0.6, 18, dark);
  k.quad(-30, 3.7, 19.54, 15, 3.2, m.windows('shop')).quad(-38.54, 3.7, 12, 12.5, 3.2, win, -Math.PI / 2, true);

  // Forecourt paving with exposed-aggregate bands.
  const pale = m.get('concrete', { color: 0xc9c5ba });
  const band = m.get('gravel', { color: 0x9d9788 });
  const fx = tartan(-26, 26, 6.5, 0.8, 0);
  const fz = tartan(17.5, 45, 6.5, 0.8, 21);
  k.pave(fx.at, fz.at, (i, j) => (fx.isBand[i] || fz.isBand[j] ? band : pale));

  // Fountain: a round pool with three "dandelion" spray heads on stems.
  const steel = m.get('chrome', { color: 0xdfe3e6 });
  k.cyl(-6, 0, 31, 6.6, 6.6, 0.5, conc, 24).collide(-6, 0, 31, 11, 0.5, 11);
  k.geo(disc(6.1, 24, true), m.get('glass', { color: 0x3d6a78 }), -6, 0.53, 31);
  for (const [x, z, h, r] of [[-7.5, 30, 3.4, 1.5], [-4.2, 32.4, 2.4, 1.15], [-5.2, 28.6, 1.6, 0.9]]) {
    k.beam([x, 0.5, z], [x, 0.5 + h, z], 0.14, steel);
    k.geo(new THREE.IcosahedronGeometry(r, 2), steel, x, 0.5 + h, z);
  }

  // Name wall, flagpoles, seats and planters.
  k.solid(15, 0, 41.5, 8, 1.4, 0.6, conc);
  k.sign('TOWN HALL', 15, 0.75, 41.82, 6, 1, 0, { bg: '#bdb8ac', fg: '#2b2b2b', style: 'block', border: false });
  k.sign('TOWN HALL', 15, 0.75, 41.18, 6, 1, Math.PI, { bg: '#bdb8ac', fg: '#2b2b2b', style: 'block', border: false });
  [0x1f3a7a, 0xb0161e, 0x1f6a3a].forEach((c, i) => flagpole(k, 19 + i * 2.2, 37, 9.5, c));
  for (const [x, z, yaw] of [[-18, 24, Math.PI / 2], [-18, 36, Math.PI / 2], [6, 38, Math.PI], [9, 25, -Math.PI / 2]]) k.prop('chch-bench', x, z, yaw);
  for (const [x, z] of [[-22, 42], [22, 22], [22, 30], [-22, 20]]) k.prop('chch-planter', x, z, x);
  k.light(-6, 4, 31, 0xcfe6ff, 1.2, 22).light(0, 6, 19, LAMP_WARM, 1.3, 24);
  k.flush();
};

/**
 * Victoria Square: lawns crossed by paths, a tiered fountain in a round pool, two bronze figures on plinths,
 * the floral clock, flower beds, seats, lamp standards and trees. A 56 m circle.
 */
export const victoriaSquare: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const path = m.get('footpath', { color: 0xc6bfae });
  const stone = m.get('limestone', { color: 0xd6d1c2 });
  const polar = (r: number, a: number): Pt2 => [Math.sin(a) * r, Math.cos(a) * r];

  k.disc(0, 0, 56, 56, [[0.17, path], [1, lawn(m)]], 0.02, 36);
  k.ribbon([[-39, -39], [39, 39]], 3, path, 0.034);
  k.ribbon([[-39, 39], [39, -39]], 3, path, 0.034);
  k.ribbon([[-55, 0], [55, 0]], 3.4, path, 0.034);
  k.ribbon([[0, -55], [0, 33]], 3.4, path, 0.034);
  const loop: Pt2[] = [];
  for (let i = 0; i < 28; i++) loop.push(polar(31, (i / 28) * Math.PI * 2));
  k.ribbon(loop, 2.6, path, 0.034, true);

  // Fountain.
  k.cyl(0, 0, 0, 5.4, 5.4, 0.55, stone, 24).collide(0, 0, 0, 9, 0.55, 9);
  k.geo(disc(4.9, 24, true), m.get('glass', { color: 0x3d6a78 }), 0, 0.58, 0);
  k.cyl(0, 0.55, 0, 0.9, 1.2, 1.1, stone, 12);
  k.geo(cone(0.5, 0.7, 12, 1.9), stone, 0, 1.65, 0);
  k.cyl(0, 2.35, 0, 0.25, 0.3, 1.3, stone, 8);
  k.geo(cone(0.3, 0.45, 12, 1.0), stone, 0, 3.65, 0);
  k.geo(sphere(0.28, 8), stone, 0, 4.35, 0);

  // Two generic bronze figures on plinths.
  statue(k, -24, 10, 0, 3.2, 'robed');
  statue(k, 24, 10, 0, 3.0, 'standing');

  // Floral clock: a tilted bed with rings of bedding plants, hour markers and hands.
  const c = k.sub(0, 0, 40, 0);
  const tilt = 0.42;
  const lift = 3.45 * Math.sin(tilt) + 0.25;
  const laid = (g: THREE.BufferGeometry, y: number) => g.translate(0, y, 0).rotateX(tilt).translate(0, lift, 0);
  const flatRing = (r0: number, r1: number) => new THREE.RingGeometry(r0, r1, 24).rotateX(-Math.PI / 2);
  const yBack = lift + 3.3 * Math.sin(tilt);
  const yFront = lift - 3.3 * Math.sin(tilt);
  c.geo(wedge(7.6, 6.6 * Math.cos(tilt), 0, yBack - 0.08, 0, yFront - 0.08), lawn(m));
  c.collide(0, 0, -0.6, 6.4, 1.6, 4.6);
  c.geo(laid(disc(3.3, 24, true), 0), m.get('foliage', { color: 0x4b7a3a }));
  c.geo(laid(flatRing(2.55, 3.15), 0.03), m.get('plain', { color: 0xc8323e }));
  c.geo(laid(flatRing(1.0, 1.5), 0.03), m.get('plain', { color: 0xefc23a }));
  c.geo(laid(ring(3.4, 0.16, 24, true), 0.02), stone);
  const white = m.get('plain', { color: 0xf3f0e6 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.geo(laid(sphere(0.17, 6).translate(Math.sin(a) * 2.1, 0, -Math.cos(a) * 2.1), 0.1), white);
  }
  const hand = (len: number, w: number, clock: number) => new THREE.BoxGeometry(w, 0.07, len).translate(0, 0, -len / 2 + 0.2).rotateY(-clock);
  c.geo(laid(hand(1.5, 0.24, (10 / 12) * Math.PI * 2), 0.16), white);
  c.geo(laid(hand(2.2, 0.16, (2 / 12) * Math.PI * 2), 0.22), white);

  // Planting and furniture, kept off the surrounding streets.
  for (const a of [1, 5, 7, -1, -5, -7]) {
    const [x, z] = polar(18, (a * Math.PI) / 8);
    if (k.free(x, z, 2)) k.prop('chch-flowerbed', x, z, (a * Math.PI) / 8 + Math.PI / 2);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (Math.PI / 4);
    const [bx, bz] = polar(8.6, a);
    k.prop('chch-bench', bx, bz, a + Math.PI);
    const [lx, lz] = polar(33.2, a);
    if (k.free(lx, lz, 1)) k.prop('chch-lamp-standard', lx, lz);
    const [tx, tz] = polar(i % 2 ? 45 : 50, a + 0.2);
    if (k.free(tx, tz, 5)) k.prop(i === 3 || i === 6 ? 'tree-willow' : 'tree-oak', tx, tz, i * 1.9, 0.9);
  }
  for (const [x, z, yaw] of [[-12, 1.9, Math.PI], [14, -1.9, 0], [1.9, -20, -Math.PI / 2], [-1.9, 18, Math.PI / 2]]) k.prop('chch-bench', x, z, yaw);
  k.light(0, 4, 0, LAMP_WARM, 1.2, 22).light(0, 4, 44, LAMP_WARM, 1, 16);
  k.flush();
};
