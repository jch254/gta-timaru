import type { LandmarkBuilder } from '../../../core/types';
import { flagpole, Geo, Site, walls, windowRow } from '../rural/kit';

/**
 * Timaru Hospital as a 1970s complex: a seven-storey concrete ward block with stair towers, a two-storey
 * podium with the main entrance and an ambulance bay, a brick boiler house with its stack, and a marked
 * car park across the front. Ward block 48 × 14 × 23 m.
 */
export const hospital: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const panel = s.mat('concrete', 0xd9d4c6);
  const dark = s.mat('concrete', 0xa8a294);
  const brick = s.mat('brick');
  const office = m.windows('office');
  const b = s.batch();

  // Ward block.
  walls(out, f, 0, -24, 48, 23.4, 14, panel, 2);
  out.box(f, 0, 23.7, -24, 48.8, 0.6, 14.8, dark);
  out.collider(f, 0, 11.7, -24, 48, 23.4, 14);
  for (const face of [1, -1]) out.quad(f, 0, 11.9, -24 + face * 7.04, 45, 22.4, office, face === 1 ? 0 : Math.PI, true);
  for (const side of [-1, 1]) {
    walls(out, f, side * 26.2, -24, 4.4, 25.4, 9, dark, 2);
    out.collider(f, side * 26.2, 12.7, -24, 4.4, 25.4, 9);
    for (let k = 0; k < 7; k++) out.quad(f, side * 26.2, 2.8 + k * 3.2, -19.47, 1.2, 1.7, m.get('glass'));
  }
  out.box(f, 8, 26, -24, 10, 4, 8, s.mat('corrugated', 0xb9b4a8));
  out.box(f, -12, 25, -25, 5, 2, 5, dark);

  // Podium with the main entrance.
  walls(out, f, 0, -6, 60, 7.4, 20, s.mat('concrete', 0xcfc8b8), 2);
  out.box(f, 0, 7.6, -6, 60.6, 0.5, 20.6, dark);
  out.collider(f, 0, 3.7, -6, 60, 7.4, 20);
  out.quad(f, 0, 4, 4.04, 55, 6.4, office, 0, true);
  for (const side of [-1, 1]) out.quad(f, side * 30.04, 4, -6, 15, 6.4, office, (side * Math.PI) / 2, true);
  out.box(f, -8, 1.7, 4.02, 8, 3.4, 0.12, s.mat('concrete', 0xcfc8b8));
  out.box(f, -8, 1.25, 4.1, 4, 2.5, 0.08, s.mat('glass', 0x31424c));
  out.box(f, -8, 3.5, 7.2, 14, 0.4, 6.4, panel);
  for (const x of [-14, -2]) out.cylinder(f, x, 1.6, 9.8, 0.2, 0.2, 3.6, dark, 8);
  s.sign(f, 'TIMARU HOSPITAL', -8, 5.6, 4.08, 12, 8, { bg: '#f2efe6', fg: '#1d3a5a', style: 'block' });
  s.sign(f, 'MAIN ENTRANCE', -8, 3.5, 10.42, 5, 8, { bg: '#1d3a5a', fg: '#f2efe6', style: 'block', border: false });

  // Ambulance bay.
  out.box(f, 21, 3.7, 8.2, 12, 0.35, 8.4, panel);
  for (const x of [15.6, 26.4]) out.cylinder(f, x, 1.7, 11.8, 0.18, 0.18, 3.7, dark, 8);
  out.box(f, 21, 1.5, 4.1, 5, 3, 0.1, s.mat('paintedMetal', 0x8a8f94));
  s.sign(f, 'ACCIDENT & EMERGENCY', 21, 3.72, 12.42, 8, 8, { bg: '#b0271f', fg: '#ffffff', style: 'block', border: false });

  // Boiler house and stack.
  walls(out, f, -36, -36, 12, 7, 9, brick);
  out.box(f, -36, 7.15, -36, 12.6, 0.3, 9.6, s.mat('corrugated', 0x8f959a));
  out.collider(f, -36, 3.5, -36, 12, 7, 9);
  out.cylinder(f, -39, 12, -29.6, 0.9, 1.3, 27, brick, 12);
  out.collider(f, -39, 12.5, -29.6, 2.4, 25, 2.4);
  out.box(f, -36, 2.2, -31.46, 3.2, 3.6, 0.1, s.mat('paintedMetal', 0x55606a));

  // Car park.
  const tar = new Geo();
  s.drape(tar, 0, 30.5, 66, 33, 0.05);
  tar.flush(out, s.ground('asphalt'), f);
  const paint = new Geo();
  s.bays(paint, 0, 43.5, 22, Math.PI);
  s.bays(paint, -15, 31.6, 11, Math.PI);
  s.bays(paint, -15, 26.4, 11);
  s.bays(paint, 16, 31.6, 9, Math.PI);
  s.bays(paint, 16, 26.4, 9);
  paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
  const yellow = new Geo();
  s.drape(yellow, 21, 16.4, 9, 0.5, 0.1);
  for (let i = 0; i < 5; i++) s.line(yellow, 17 + i * 2, 14.2, 18.4 + i * 2, 16.2, 0.2);
  yellow.flush(out, s.ground('plain', 0xe2b53a, -4), f);

  flagpole(b.g(s.mat('paintedMetal', 0xf2efe6)), -24, s.gy(-24, 10), 10, 9);
  b.flush();
  s.prop('lamp', -31, 22, Math.PI / 2);
  s.prop('lamp', 31, 38, -Math.PI / 2);
  s.prop('tree-oak', 37, 9, 0.5, 0.9);
  s.prop('tree-oak', -38, 8, 2.1, 1);
  for (const x of [-22, -16, 2, 8]) s.prop('bush', x, 5.4, x);
  s.light(-8, 3, 9, 0xfff0d0, 1.6, 30);
  s.light(21, 3.2, 10, 0xffe0d0, 1.4, 28);
};

/**
 * Timaru police station as a 1970s three-storey block: brick ground floor, concrete panels and strip
 * windows above, a radio mast on the roof, garages and a fenced yard behind, visitor parking in front.
 */
export const police: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const panel = s.mat('concrete', 0xcfc8b8);
  const brick = s.mat('brick');
  const dark = s.mat('paintedMetal', 0x3a3f44);
  const b = s.batch();

  walls(out, f, 0, -5, 30, 10.8, 13, panel);
  out.box(f, 0, 1.3, -5, 30.2, 4.6, 13.2, brick);
  out.box(f, 0, 11, -5, 30.6, 0.5, 13.6, s.mat('concrete', 0xa8a294));
  out.collider(f, 0, 5.4, -5, 30, 10.8, 13);
  for (const face of [1, -1]) out.quad(f, 0, 7, -5 + face * 6.54, 27.5, 6.4, m.windows('office'), face === 1 ? 0 : Math.PI, true);
  for (const side of [-1, 1]) out.quad(f, side * 15.04, 7, -5, 10, 6.4, m.windows('office'), (side * Math.PI) / 2, true);
  windowRow(out, f, 0, 14, 5, 2.1, 1.63, 1.8, 1.3, m.windows('shop'));
  windowRow(out, f, -14, -8, 2, 2.1, 1.63, 1.8, 1.3, m.windows('shop'));

  // Entrance: steps, canopy, sign and the blue lamp.
  out.box(f, -4, 1.25, 1.64, 3, 2.5, 0.08, s.mat('glass', 0x31424c));
  out.box(f, -4, 2.95, 3, 6, 0.3, 3, panel);
  out.box(f, -4, -0.3, 3, 6, 0.9, 3, s.mat('concrete'));
  out.collider(f, -4, 0.07, 3, 6, 0.15, 3);
  for (const x of [-6.7, -1.3]) out.cylinder(f, x, 1.5, 4.3, 0.12, 0.12, 2.8, dark, 8);
  s.sign(f, 'POLICE', -4, 3.75, 1.66, 5, 4, { bg: '#1d3f8a', fg: '#ffffff', style: 'block' });
  const gDark = b.g(dark);
  gDark.post(-0.4, 0, 4.6, 0.1, 2.6);
  b.g(m.emitter(0x4a7cff, 'night')).box(-0.4, 2.8, 4.6, 0.36, 0.42, 0.36);

  // Roof plant and radio mast.
  out.box(f, -8, 12.2, -6, 6, 2, 5, s.mat('corrugated', 0xb9b4a8));
  gDark.tube([9, 11.2, -7], [9, 23, -7], 0.16, 0.06, 6);
  for (const y of [15, 18, 21]) gDark.beam([8, y, -7], [10, y, -7], 0.05).beam([9, y, -8], [9, y, -6], 0.05);
  for (const [x, z] of [[8, -7], [10, -7], [9, -8]] as const) gDark.tube([x, 21, z], [x, 24.5, z], 0.02, 0.012, 4, false);

  // Yard: garages with roller doors, tarseal, chain-link fence.
  walls(out, f, -4, -27, 20, 3.4, 6, s.mat('concrete', 0xbdb6a6));
  out.box(f, -4, 3.55, -27, 20.6, 0.3, 6.6, s.mat('corrugated', 0x8f959a));
  out.collider(f, -4, 1.7, -27, 20, 3.4, 6);
  for (let i = 0; i < 5; i++) out.box(f, -12 + i * 4, 1.35, -23.97, 3.2, 2.7, 0.08, s.mat('paintedMetal', 0x55606a));
  const tar = new Geo();
  s.drape(tar, 0, -17.8, 30, 12, 0.05);
  s.drape(tar, 0, 11.5, 28, 13, 0.05);
  tar.flush(out, s.ground('asphalt'), f);
  const paint = new Geo();
  s.bays(paint, 2, 13.4, 8, Math.PI);
  paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
  const wire = b.g(s.mat('metal', 0x8f959a, { roughness: 0.6 }));
  s.fence(wire, [[15.4, -11.6], [15.4, -30.4], [8, -30.4]], { height: 2, spacing: 3, rails: 2, post: 0.07, rail: [0.04, 0.04] });
  s.fence(wire, [[-15.4, -11.6], [-15.4, -30.4]], { height: 2, spacing: 3, rails: 2, post: 0.07, rail: [0.04, 0.04] });

  flagpole(b.g(s.mat('paintedMetal', 0xf2efe6)), 11, s.gy(11, 4.5), 4.5, 8);
  b.flush();
  s.signBoard(f, 'TIMARU POLICE STATION', -10.5, 1.5, 19.5, 5, 5, { bg: '#1d3f8a', fg: '#ffffff', style: 'block' });
  for (const sx of [-2.2, 2.2]) out.box(f, -10.5 + sx, 0.75, 19.5, 0.1, 2.3, 0.1, dark);
  s.prop('lamp', 14.5, 17, -Math.PI / 2);
  s.light(-4, 2.6, 4, 0xbfd0ff, 1.5, 22);
  s.light(0, 4, -18, 0xfff0d0, 1.2, 26);
};
