import type { LandmarkBuilder } from '../../../core/types';
import { gableRoof, type Geo, Site, sub, walls } from '../rural/kit';

/** Round-headed window on a wall: `g*` are already inside a frame whose +z points out of the wall. */
function archWindow(stone: Geo, glass: Geo, x: number, y: number, w: number, h: number): void {
  const r = w / 2;
  glass.box(x, y + h / 2, 0.02, w, h, 0.04);
  glass.arch(x, y + h, 0.02, 0, r, 0.04, 0, Math.PI, 6);
  stone.arch(x, y + h, 0.06, r, r + 0.32, 0.22, 0, Math.PI, 6);
  stone.box(x, y - 0.12, 0.08, w + 0.7, 0.24, 0.26);
  for (const side of [-1, 1]) stone.box(x + side * (r + 0.16), y + h / 2, 0.06, 0.32, h, 0.22);
}

/**
 * Sacred Heart Basilica, Craigie Avenue (1911): Oamaru-stone front with an Ionic portico between twin
 * domed towers, a brick nave and transepts, and the big copper dome over the crossing.
 * Footprint about 34 m wide × 63 m deep; main dome cross at 34 m.
 */
export const basilica: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const stone = s.mat('limestone');
  const brick = s.mat('brick');
  const slate = s.mat('slate');
  const copper = s.mat('metal', 0x6fa890, { roughness: 0.7, metalness: 0.25 });
  const glass = s.mat('glass', 0x26323c);
  const timber = s.mat('timber', 0x4a2f20);
  const gold = s.mat('metal', 0xc9a24a, { roughness: 0.35, metalness: 0.8 });
  const b = s.batch();
  const gs = b.g(stone);
  const gg = b.g(glass);
  const gc = b.g(copper);

  // Nave (brick) with a slate roof running front to back.
  walls(out, f, 0, -5, 19, 13, 42, brick, 2);
  out.gable(sub(f, 0, 0, -5, Math.PI / 2), 0, 13, 0, 42.6, 20, 5, slate);
  out.box(f, 0, 12.7, -5, 19.6, 0.6, 42.4, stone);
  out.collider(f, 0, 6.5, -5, 19, 13, 42);
  for (const side of [-1, 1]) {
    for (const z of [-3.5, 2, 7.5, 13]) {
      gs.at(side * 9.5, 0, z, (side * Math.PI) / 2, () => archWindow(gs, gg, 0, 5.4, 1.7, 3.6));
      out.box(f, side * 9.6, 5.4, z + 2.75, 0.5, 13.4, 0.8, stone);
    }
  }

  // Transepts across the nave.
  walls(out, f, 0, -13, 32, 13, 12, brick, 2);
  gableRoof(out, gs, f, 0, 13, -13, 32, 12, 4.4, slate, 0.3);
  out.collider(f, 0, 6.5, -13, 32, 13, 12);
  for (const side of [-1, 1]) {
    gs.at(side * 16.34, 0, -13, (side * Math.PI) / 2, () => {
      archWindow(gs, gg, 0, 5, 2.4, 4.4);
      gg.disc(0, 14.6, 0.02, 1.0, 14);
      gs.arch(0, 14.6, 0.04, 1.0, 1.3, 0.2, 0, Math.PI * 2, 14);
    });
    for (const z of [-18.6, -7.4]) out.box(f, side * 15.7, 5.5, z, 0.9, 15, 0.9, stone);
  }

  // Apse behind the sanctuary.
  b.g(brick).lathe(0, 0, -26, [[7, -2], [7, 10.5]], 14, Math.PI, Math.PI * 2);
  gs.lathe(0, 0, -26, [[7.15, 10.5], [7.15, 11.1], [6.9, 11.1]], 14, Math.PI, Math.PI * 2);
  b.g(slate).lathe(0, 0, -26, [[7.2, 11.1], [0, 14.6]], 14, Math.PI, Math.PI * 2);
  out.collider(f, 0, 5, -29, 13, 11, 6.5);
  for (const a of [1.2, 1.5, 1.8].map((t) => t * Math.PI)) {
    gs.at(Math.cos(a) * 7, 0, -26 + Math.sin(a) * 7, Math.PI / 2 - a, () => archWindow(gs, gg, 0, 4.6, 1.3, 3));
  }

  // Crossing: stone drum, copper dome, lantern and cross.
  gs.lathe(0, 0, -13, [[6.6, 12.5], [6.6, 21.4], [7.1, 21.4], [7.1, 22], [6.3, 22]], 20);
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (Math.PI / 4);
    gs.at(Math.cos(a) * 6.5, 0, -13 + Math.sin(a) * 6.5, Math.PI / 2 - a, () => archWindow(gs, gg, 0, 16, 1.5, 3));
  }
  const dome: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    dome.push([6.4 * Math.cos(a), 22 + 7.2 * Math.sin(a)]);
  }
  gc.lathe(0, 0, -13, dome, 20, 0, Math.PI * 2, true);
  gs.lathe(0, 0, -13, [[1.25, 28.9], [1.25, 31], [1.5, 31], [1.5, 31.3]], 10);
  gc.lathe(0, 0, -13, [[1.5, 31.3], [1.2, 32], [0.6, 32.5], [0, 32.7]], 10, 0, Math.PI * 2, true);
  const gGold = b.g(gold);
  gGold.box(0, 33.5, -13, 0.14, 1.9, 0.14).box(0, 33.8, -13, 0.9, 0.14, 0.14);

  // West front: stone screen between the towers.
  walls(out, f, 0, 18, 15, 15.5, 4, stone, 2);
  out.box(f, 0, 15.9, 18, 15.6, 0.8, 4.6, stone);
  out.collider(f, 0, 7.5, 18, 27, 15, 5);
  gs.at(0, 0, 20, 0, () => {
    for (const x of [-4.4, 0, 4.4]) {
      gs.arch(x, 5.2, 0.06, 1.25, 1.6, 0.22, 0, Math.PI, 8);
      for (const side of [-1, 1]) gs.box(x + side * 1.42, 3.1, 0.06, 0.34, 4.2, 0.22);
    }
  });
  const gt = b.g(timber);
  for (const x of [-4.4, 0, 4.4]) {
    gt.box(x, 3.1, 20.03, 2.5, 4.2, 0.06);
    gt.arch(x, 5.2, 20.03, 0, 1.25, 0.06, 0, Math.PI, 8);
  }

  // Twin towers with belfries and small copper domes.
  for (const side of [-1, 1]) {
    const tx = side * 10.5;
    walls(out, f, tx, 18, 6, 21, 6, stone, 2);
    for (const y of [9.6, 14.6]) out.box(f, tx, y, 18, 6.4, 0.45, 6.4, stone);
    out.box(f, tx, 21.25, 18, 7, 0.5, 7, stone);
    out.collider(f, tx, 10.5, 18, 6, 21, 6);
    for (let i = 0; i < 4; i++) {
      const yaw = (i * Math.PI) / 2;
      gs.at(tx + Math.sin(yaw) * 3, 0, 18 + Math.cos(yaw) * 3, yaw, () => {
        archWindow(gs, gg, 0, 15.6, 1.5, 3.2);
        gg.box(0, 6, 0.02, 1, 2.4, 0.04);
        gg.box(0, 11.6, 0.02, 1, 1.8, 0.04);
      });
    }
    gs.lathe(tx, 0, 18, [[2.5, 21.5], [2.5, 23.4], [2.8, 23.4], [2.8, 23.8]], 8);
    const cap: [number, number][] = [];
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      cap.push([2.6 * Math.cos(a), 23.8 + 2.7 * Math.sin(a)]);
    }
    gc.lathe(tx, 0, 18, cap, 12, 0, Math.PI * 2, true);
    gc.lathe(tx, 0, 18, [[0.4, 26.4], [0.4, 27.1], [0, 27.5]], 6);
    gGold.box(tx, 28.2, 18, 0.1, 1.4, 0.1).box(tx, 28.4, 18, 0.7, 0.1, 0.1);
  }

  // Portico: platform, steps, six Ionic columns, entablature and pediment.
  out.box(f, 0, 0, 23.25, 18, 2, 6.5, stone);
  out.collider(f, 0, 0.5, 23.25, 18, 1, 6.5);
  for (let k = 1; k <= 4; k++) {
    const top = 1 - 0.2 * k;
    out.box(f, 0, top - 0.75, 26.2 + 0.6 * k, 18, 1.5, 0.6, stone);
    out.collider(f, 0, top / 2, 26.2 + 0.6 * k, 18, Math.max(0.1, top), 0.6);
  }
  for (let i = 0; i < 6; i++) {
    const x = -7.5 + i * 3;
    out.cylinder(f, x, 5.1, 25.3, 0.5, 0.58, 7.8, stone, 12);
    out.box(f, x, 1.1, 25.3, 1.4, 0.3, 1.4, stone);
    out.box(f, x, 9.2, 25.3, 1.7, 0.4, 1.3, stone);
    out.collider(f, x, 5, 25.3, 1, 8, 1);
  }
  out.box(f, 0, 10.1, 23.3, 17.4, 1.4, 6.4, stone);
  out.gable(sub(f, 0, 0, 23.3, Math.PI / 2), 0, 10.8, 0, 6.8, 18, 3, stone);
  gGold.box(0, 14.5, 26.5, 0.12, 1.5, 0.12).box(0, 14.75, 26.5, 0.8, 0.12, 0.12);
  s.sign(f, 'SACRED HEART BASILICA', 0, 10.1, 26.53, 9, 9, { bg: '#d9cfb4', fg: '#5a4a32', style: 'paint', border: false });
  b.flush();

  for (const side of [-1, 1]) s.prop('tree-cabbage', side * 16, 30, side, 1.1);
  s.light(0, 6, 28, 0xffe0a8, 1.4, 26);
  s.light(0, 24, -13, 0xcfe6dc, 0.8, 40);
};
