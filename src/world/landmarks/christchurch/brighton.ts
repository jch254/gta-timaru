import { LAMP_WARM } from '../../scatter/util';
import type { LandmarkBuilder } from '../../../core/types';
import { clockFace } from './common';
import { Kit, pyramid, tartan } from './kit';

// Invented businesses for a mall that has seen better days.
const SHOPS = ['SANDHILLS VIDEO', 'SEAVIEW TAKEAWAYS', 'FOR LEASE', "NAN'S WOOL SHOP", 'SOUTHERLY SURF', 'MALL DAIRY', 'TO LET', 'OP SHOP', 'DUNE STREET BAKERY', 'SEASIDE MENSWEAR'];
const WALLS = [0xd9cfb8, 0xc9d3cc, 0xd8c3b4, 0xc6c8b4, 0xcfc4a8];
const AWNINGS = [0x8f5a52, 0x5f7a70, 0x6c7f93, 0xa39a84, 0x7d6a5a];

/** One tired shop unit in a kit whose +z faces the mall: plain box, parapet, faded verandah, shopfront and sign. */
function shopUnit(s: Kit, width: number, index: number): void {
  const m = s.m;
  const wall = m.get('plaster', { color: WALLS[index % WALLS.length] });
  const trim = m.get('paintedMetal', { color: 0xb8b2a4 });
  const tall = index % 3 === 1;
  const h = tall ? 7.2 : 4.3;
  s.solid(0, 0, 0, width, h, 10, wall);
  s.box(0, h, 4.75, width, 0.7, 0.5, wall);
  s.box(0, 3.0, 6.4, width - 0.4, 0.16, 2.8, m.get('corrugated', { color: AWNINGS[index % AWNINGS.length] }));
  s.box(0, 2.66, 7.77, width - 0.4, 0.4, 0.06, trim);
  s.dbox(-width / 2 + 0.6, 0, 7.6, 0.1, 3, 0.1, trim).dbox(width / 2 - 0.6, 0, 7.6, 0.1, 3, 0.1, trim);
  const name = SHOPS[index % SHOPS.length];
  const vacant = name === 'FOR LEASE' || name === 'TO LET';
  // Vacant units are boarded up.
  s.quad(-width * 0.14, 1.5, 5.03, width * 0.58, 2.0, vacant ? m.get('timber', { color: 0xb49a72 }) : m.windows('shop'));
  s.quad(width * 0.32, 1.1, 5.03, 1.0, 2.2, m.get('glass', { color: 0x2a3338 }));
  const signW = Math.min(width * 0.8, 7.5);
  if (vacant) s.sign(name, -width * 0.14, 1.6, 5.05, 2.6, 0.9, 0, { bg: '#f2ede0', fg: '#a02018', style: 'block' });
  else s.sign(name, 0, 3.62, 5.04, signW, signW / 6, 0, { bg: index % 2 ? '#e9e2cc' : '#33474f', fg: index % 2 ? '#3a3a36' : '#ece4cc', style: index % 4 === 0 ? 'script' : 'paint', aspect: 6 });
  if (tall) s.panes(m.windows('house'), width - 3, 5.7, 3, 1.4, 1.5, 5.04);
}

/**
 * New Brighton Mall, 1995: a paved pedestrian mall between two rows of tired single- and two-storey shops with
 * faded verandahs, a shade canopy, planters, seats, and the stone clock tower at the seaward end. No pier.
 *
 * The mall runs along local z (+z = towards the sea). If a pedestrian street passes within 25 m the mall
 * re-centres on it and runs along it instead, shortening itself as needed to stay inside the clear radius.
 */
export const newBrightonMall: LandmarkBuilder = (p, out) => {
  const graph = out.world.graph;
  const hit = graph.nearest(p.x, p.z, 25, (e) => e.cls === 'pedestrian');
  let k: Kit;
  let half = 52;
  if (hit) {
    const s = graph.pointAt(hit.edge, hit.s);
    const along = Math.atan2(s.tx, s.tz);
    k = Kit.at(p, out, { x: hit.x, z: hit.z, heading: Math.cos(along - p.heading) >= 0 ? along : along + Math.PI });
    half = Math.min(52, Math.sqrt(59 * 59 - (20.5 + hit.distance) ** 2));
  } else {
    k = Kit.at(p, out);
  }
  const m = k.m;

  // Paving: terracotta pavers with pale concrete bands across the mall.
  const paver = m.get('footpath', { color: 0xc48a6e });
  const strip = m.get('footpath', { color: 0xb37a60 });
  const pale = m.get('concrete', { color: 0xcbc6ba });
  const bands = tartan(-half, half, 8, 0.8, 0);
  k.pave([-10, -3.5, 3.5, 10], bands.at, (i, j) => (bands.isBand[j] ? pale : i === 1 ? strip : paver));

  // Shops down both sides.
  const units = Math.max(2, Math.round((half * 2) / 21));
  const pitch = (half * 2) / units;
  for (let i = 0; i < units; i++) {
    const z = -half + (i + 0.5) * pitch;
    // Each unit stands on its own patch of ground: the land may fall towards the beach.
    shopUnit(k.seat(15, z, -Math.PI / 2), pitch - 0.5, i * 2);
    shopUnit(k.seat(-15, z, Math.PI / 2), pitch - 0.5, i * 2 + 1);
  }

  // Clock tower at the seaward end (beside the walking line when the street runs right through).
  const cz = half - 7;
  const cx = k.free(0, cz, 1.5) ? 0 : 6.3;
  const stone = m.get('limestone', { color: 0xd6ceba });
  const t = k.seat(cx, cz);
  t.solid(0, 0, 0, 4.4, 1.1, 4.4, stone);
  t.solid(0, 1.1, 0, 3.4, 10.4, 3.4, stone);
  t.box(0, 11.5, 0, 4.0, 0.4, 4.0, stone);
  t.box(0, 11.9, 0, 3.7, 3.0, 3.7, stone);
  t.box(0, 14.9, 0, 4.2, 0.4, 4.2, stone);
  t.geo(pyramid(3.9, 3.9, 2.6), m.get('slate', { color: 0x7fb7a2 }), 0, 15.3, 0);
  t.dbox(0, 17.9, 0, 0.1, 1.2, 0.1, m.get('paintedMetal', { color: 0x2a2a2a }));
  t.faces(0, 0, 3.7, 3.7).forEach(({ k: face }) => {
    clockFace(face, 0, 13.4, 0.02, 1.15, 0, 2, 51);
    face.panes(m.get('glass', { color: 0x1c252b }), 1, 7.2, 1, 0.5, 3.2, -0.11);
  });

  // The 1978 shade canopy: a flat frame on four posts.
  const yellow = m.get('paintedMetal', { color: 0xc6a544 });
  const sz = -half / 3;
  k.box(0, 3.6, sz, 9.6, 0.25, 9.6, yellow);
  for (const x of [-4.4, 4.4]) for (const z of [-4.4, 4.4]) k.dbox(x, 0, sz + z, 0.26, 3.6, 0.26, yellow);

  // Planters, seats, lamps and a few cabbage trees.
  for (let z = -half + 7, i = 0; z < half - 12; z += 11, i++) {
    for (const side of [-1, 1]) {
      if (Math.abs(z - sz) < 6) continue;
      if (k.free(side * 5.6, z, 0.4)) k.prop('chch-planter', side * 5.6, z, i + side);
      if (k.free(side * 7.3, z + 5.5, 0.4)) k.prop('chch-bench', side * 7.3, z + 5.5, (-side * Math.PI) / 2);
      if (i % 2 === 0 && k.free(side * 8.9, z + 2.5, 0.4)) k.prop('chch-lamp-standard', side * 8.9, z + 2.5);
    }
  }
  for (const [x, z] of [[-6.2, -half + 2.5], [6.2, -half + 2.5], [-6.2, half - 2.5], [6.2, half - 2.5]]) if (k.free(x, z, 1)) k.prop('tree-cabbage', x, z, x + z, 0.9);
  k.light(cx, 5, cz, LAMP_WARM, 1.2, 22).light(0, 3.2, sz, LAMP_WARM, 1.1, 18);
  k.flush();
};
