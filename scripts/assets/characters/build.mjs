// Builds the shipped character models from the raw Quaternius downloads (all CC0):
//
//   assets-staging/characters/x-base   Universal Base Characters [Standard]   (bodies, hair, textures)
//   assets-staging/characters/x-ual1   Universal Animation Library [Standard] (animations)
//
// → src/assets/models/characters/male.glb, female.glb (one skinned mesh each, clothes included)
//   src/assets/models/characters/anims.glb            (all clips on one timeline, sliced at load)
//
// The base bodies come in their underwear. Clothes are grown from the body here: the covered part of the
// skin is cut out, smoothed and pushed outwards into a shell (top, sleeves, trousers / shorts, socks), and
// shoes are lofted around the feet. Every piece keeps the skin weights of the body under it, so it follows
// the same skeleton. The runtime picks sleeve / leg lengths and hair by drawing different index ranges
// ("parts", listed in the file's root extras) and colours each range with its own material.
//
// usage: sh scripts/assets/characters/fetch.sh     (downloads and unpacks the two packs; once)
//        node scripts/assets/characters/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import { io, readModel } from './lib.mjs';
import { Mesh, append, assignCornerUVs, clip, compact, computeNormals, fromPrimitive, lips, normalize, offset, smooth, smoothstep, sub, unwrapAngles } from './meshkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STAGING = path.join(ROOT, 'assets-staging/characters');
const BASE = path.join(STAGING, 'x-base/Universal Base Characters[Standard]');
const BODY_DIR = path.join(BASE, 'Base Characters/Godot - UE');
const TEX_DIR = path.join(BASE, 'Base Characters/Textures');
const HAIR_DIR = path.join(BASE, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)');
const UAL1 = path.join(STAGING, 'x-ual1/Universal Animation Library[Standard]/Unreal-Godot');
const OUT = path.join(ROOT, 'src/assets/models/characters');

/** Shell UVs are stored as metres / UV_METRES so they stay inside 0..1 (16-bit normalised). */
const UV_METRES = 2.16;
/** Texel layout of the per-look "misc" atlas the runtime paints (eyes on the left, colour cells on the right). */
const CELL = { hair: [0.625, 0.25], shoes: [0.875, 0.25], socks: [0.625, 0.75], sole: [0.875, 0.75] };

const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Pistol_Aim_Neutral', 'Punch_Jab', 'Punch_Cross', 'Crouch_Idle_Loop', 'Driving_Loop', 'Sitting_Idle_Loop', 'Death01'];
const FPS = 30;

// ───────────────────────────── skeleton ─────────────────────────────

/** Joints of a source skin, minus the "_leaf" end bones (their weights fold into the parent). */
function readSkeleton(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const src = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const keep = [];
  const jointMap = new Array(src.length).fill(-1);
  src.forEach((node, i) => {
    if (node.getName().includes('_leaf')) return;
    jointMap[i] = keep.length;
    keep.push({ name: node.getName(), node, t: node.getTranslation(), r: node.getRotation(), s: node.getScale(), ibm: ibm.getElement(i, []), world: node.getWorldMatrix(), parent: -1 });
  });
  const index = new Map(keep.map((j, i) => [j.name, i]));
  src.forEach((node, i) => {
    const parent = node.getParentNode();
    if (jointMap[i] < 0) jointMap[i] = index.get(parent.getName());
    else if (parent && index.has(parent.getName())) keep[jointMap[i]].parent = index.get(parent.getName());
  });
  const at = (name) => {
    const m = keep[index.get(name)].world;
    return [m[12], m[13], m[14]];
  };
  return { joints: keep, jointMap, index, at };
}

// ───────────────────────────── textures ─────────────────────────────

const srgbToLinear = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const linearToSrgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));

/**
 * The skin albedo with its own tone divided out, so the runtime can multiply any skin colour back in.
 * Returns the JPEG and the gain the runtime must apply to the look's skin colour.
 */
async function neutralSkin(file, size) {
  const { data, info } = await sharp(file).resize(size, size).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  const lum = [];
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r - b < 28 || r < g) continue; // underwear, padding
    const lin = [srgbToLinear[r], srgbToLinear[g], srgbToLinear[b]];
    sum[0] += lin[0];
    sum[1] += lin[1];
    sum[2] += lin[2];
    lum.push(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
  }
  const mean = sum.map((s) => s / lum.length);
  const meanLum = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
  lum.sort((a, b) => a - b);
  const gain = lum[Math.floor(lum.length * 0.985)] / meanLum;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = linearToSrgb(Math.min(1, srgbToLinear[data[i]] / (mean[i % 3] * gain)));
  const jpeg = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 86, chromaSubsampling: '4:4:4' }).toBuffer();
  return { jpeg, gain };
}

async function normalMap(file, size) {
  return sharp(file).resize(size, size).removeAlpha().jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
}

/** Bilinear luminance lookup into a texture (0..1, linear), for baking hair shading into vertex colours. */
async function luminanceSampler(file, size = 512) {
  const { data } = await sharp(file).resize(size, size).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(size * size);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.2126 * srgbToLinear[data[i * 3]] + 0.7152 * srgbToLinear[data[i * 3 + 1]] + 0.0722 * srgbToLinear[data[i * 3 + 2]];
  const sorted = Float32Array.from(lum).sort();
  const ref = sorted[Math.floor(sorted.length * 0.9)];
  return (u, v) => {
    const x = Math.min(size - 1, Math.max(0, Math.floor((u - Math.floor(u)) * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor((v - Math.floor(v)) * size)));
    return Math.min(1, Math.max(0.3, lum[y * size + x] / ref));
  };
}

// ───────────────────────────── body ─────────────────────────────

const absx = (v) => Math.abs(v.p[0]);

function paint(mesh, uv, shade) {
  for (const v of mesh.v) {
    v.uv = [...uv];
    if (shade) v.c = shade(v);
  }
  return mesh;
}

/** Lofted shoe around one foot. */
function buildShoe(body, sk, side, m) {
  const foot = sk.index.get(`foot_${side}`);
  const ball = sk.index.get(`ball_${side}`);
  const verts = body.v.filter((v) => v.p[1] < m.ankleY + 0.05 && v.s.reduce((a, [j, w]) => a + (j === foot || j === ball ? w : 0), 0) > 0.5);
  const zs = verts.map((v) => v.p[2]);
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const bottom = m.footMinY - m.sole;
  const collar = m.ankleY + 0.03;
  const N = 9;
  const M = 14;
  const rings = [];
  for (let k = 0; k < N; k++) {
    const z = zmin + ((zmax - zmin) * k) / (N - 1);
    const half = (zmax - zmin) / (N - 1) / 2 + 0.005;
    let slice = verts.filter((v) => Math.abs(v.p[2] - z) <= half && v.p[1] < collar + 0.02);
    if (!slice.length) slice = verts.filter((v) => Math.abs(v.p[2] - z) <= half * 3);
    const xs = slice.map((v) => v.p[0]);
    const top = Math.min(collar, Math.max(...slice.map((v) => v.p[1])) + 0.005);
    rings.push({ z, x0: Math.min(...xs) - 0.004, x1: Math.max(...xs) + 0.004, top });
  }
  // Round off the toe and the heel.
  const toe = rings[N - 1];
  const heel = rings[0];
  const shrink = (r, z, k, drop) => {
    const cx = (r.x0 + r.x1) / 2;
    const hw = ((r.x1 - r.x0) / 2) * k;
    return { z, x0: cx - hw, x1: cx + hw, top: bottom + (r.top - bottom) * drop };
  };
  rings.push(shrink(toe, toe.z + 0.012, 0.72, 0.8));
  rings.unshift(shrink(heel, heel.z - 0.008, 0.8, 0.95));
  const mesh = new Mesh();
  const pw = (x, e) => Math.sign(x) * Math.abs(x) ** e;
  const nearest = (p) => {
    let best = verts[0];
    let bd = Infinity;
    for (const v of verts) {
      const d = (v.p[0] - p[0]) ** 2 + (v.p[1] - p[1]) ** 2 + (v.p[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  // Two lofts along the foot: the upper, and a slightly wider flat slab for the sole.
  const loft = (cell, shape) => {
    const part = new Mesh();
    const vert = (p) => {
      part.v.push({ p, n: [0, 1, 0], uv: [...cell], c: [1, 1, 1], s: nearest(p).s.map((e) => [...e]), q: undefined });
      return part.v.length - 1;
    };
    const grid = rings.map((r) => {
      const { cx, hw, y0, y1, ex, eu, ed } = shape(r);
      const ring = [];
      for (let i = 0; i < M; i++) {
        const a = (i / M) * Math.PI * 2;
        const s = Math.sin(a);
        ring.push(vert([cx + hw * pw(Math.cos(a), ex), (y0 + y1) / 2 + ((y1 - y0) / 2) * pw(s, s < 0 ? ed : eu), r.z]));
      }
      return ring;
    });
    for (let k = 0; k < grid.length - 1; k++) {
      for (let i = 0; i < M; i++) {
        const a = grid[k][i];
        const b = grid[k][(i + 1) % M];
        const c = grid[k + 1][i];
        const d = grid[k + 1][(i + 1) % M];
        part.t.push([a, c, b], [b, c, d]);
      }
    }
    const cap = (ring, r, flip) => {
      const { cx, y0, y1 } = shape(r);
      const centre = vert([cx, (y0 + y1) / 2, r.z + (flip ? -0.004 : 0.004)]);
      for (let i = 0; i < M; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % M];
        part.t.push(flip ? [centre, a, b] : [centre, b, a]);
      }
    };
    cap(grid[0], rings[0], true);
    cap(grid[grid.length - 1], rings[rings.length - 1], false);
    computeNormals(part);
    // Face outwards whatever the ring winding was.
    const probe = part.v[grid[4][0]];
    if ((probe.p[0] - shape(rings[4]).cx) * probe.n[0] < 0) {
      for (const t of part.t) t.reverse();
      computeNormals(part);
    }
    append(mesh, part);
  };
  const welt = bottom + m.sole + 0.006;
  loft(CELL.shoes, (r) => ({ cx: (r.x0 + r.x1) / 2, hw: (r.x1 - r.x0) / 2, y0: welt - 0.008, y1: Math.max(r.top, welt + 0.012), ex: 0.62, eu: 0.75, ed: 0.3 }));
  loft(CELL.sole, (r) => ({ cx: (r.x0 + r.x1) / 2, hw: (r.x1 - r.x0) / 2 + 0.003, y0: bottom, y1: welt, ex: 0.5, eu: 0.25, ed: 0.25 }));
  return mesh;
}


/**
 * Make a limb's shell hang like a tube instead of clinging to the muscles: in every slice along the limb
 * the cross-section is grown about its own centre until it is at least `target(t, ref)` in radius, where
 * `ref` is the largest radius found in the slices `isRef(t)` picks. `pick(v)` gives { t, g } (position
 * along the limb, which limb) or null; `axes` are the two coordinate indices of the cross-section.
 */
function tube(mesh, pick, axes, isRef, target, bin = 0.02) {
  const [ia, ib] = axes;
  const slices = new Map();
  const picked = mesh.v.map(pick);
  mesh.v.forEach((v, i) => {
    const c = picked[i];
    if (!c) return;
    const key = `${c.g}|${Math.round(c.t / bin)}`;
    const e = slices.get(key) ?? { a: 0, b: 0, n: 0, r: 0, t: Math.round(c.t / bin) * bin, g: c.g };
    e.a += v.p[ia];
    e.b += v.p[ib];
    e.n++;
    slices.set(key, e);
  });
  for (const e of slices.values()) {
    e.a /= e.n;
    e.b /= e.n;
  }
  mesh.v.forEach((v, i) => {
    const c = picked[i];
    if (!c) return;
    const e = slices.get(`${c.g}|${Math.round(c.t / bin)}`);
    e.r = Math.max(e.r, Math.hypot(v.p[ia] - e.a, v.p[ib] - e.b));
  });
  const ref = new Map();
  for (const e of slices.values()) if (isRef(e.t)) ref.set(e.g, Math.max(ref.get(e.g) ?? 0, e.r));
  // Thin slices at the cut ends say nothing reliable about the limb's size: leave those alone.
  for (const e of slices.values()) e.f = e.n < 5 || e.r < 0.015 ? 1 : Math.min(1.8, Math.max(1, target(e.t, ref.get(e.g) ?? e.r) / e.r));
  mesh.v.forEach((v, i) => {
    const c = picked[i];
    if (!c) return;
    const k = c.t / bin;
    const k0 = Math.floor(k);
    const e0 = slices.get(`${c.g}|${k0}`) ?? slices.get(`${c.g}|${k0 + 1}`);
    const e1 = slices.get(`${c.g}|${k0 + 1}`) ?? e0;
    const u = k - k0;
    const f = 1 + (e0.f + (e1.f - e0.f) * u - 1) * (c.w ?? 1);
    const ca = e0.a + (e1.a - e0.a) * u;
    const cb = e0.b + (e1.b - e0.b) * u;
    v.p[ia] = ca + (v.p[ia] - ca) * f;
    v.p[ib] = cb + (v.p[ib] - cb) * f;
  });
}

/**
 * Let a top hang from the chest and shoulder blades instead of following the waist in: below the chest
 * each slice is widened to a fraction of the chest's own half-width, front depth and back depth.
 */
function drapeTorso(mesh, m, zc, k) {
  const bin = 0.02;
  const torso = (v) => Math.abs(v.q[0]) < m.armholeX - 0.02;
  const slices = new Map();
  for (const v of mesh.v) {
    if (!torso(v)) continue;
    const key = Math.round(v.p[1] / bin);
    const e = slices.get(key) ?? { x: 0.01, f: 0.01, b: 0.01 };
    e.x = Math.max(e.x, Math.abs(v.p[0]));
    e.f = Math.max(e.f, v.p[2] - zc);
    e.b = Math.max(e.b, zc - v.p[2]);
    slices.set(key, e);
  }
  const ref = { x: 0, f: 0, b: 0 };
  for (const [key, e] of slices) {
    const y = key * bin;
    if (y < m.chestY - 0.08 || y > m.chestY + 0.14) continue;
    ref.x = Math.max(ref.x, e.x);
    ref.f = Math.max(ref.f, e.f);
    ref.b = Math.max(ref.b, e.b);
  }
  for (const e of slices.values()) {
    e.fx = Math.min(1.6, Math.max(1, (ref.x * k.side) / e.x));
    e.ff = Math.min(1.6, Math.max(1, (ref.f * k.front) / e.f));
    e.fb = Math.min(1.9, Math.max(1, (ref.b * k.back) / e.b));
  }
  for (const v of mesh.v) {
    const w = (1 - smoothstep(m.armholeX - 0.1, m.armholeX - 0.015, Math.abs(v.q[0]))) * (1 - smoothstep(m.chestY - 0.04, m.chestY + 0.1, v.p[1]));
    if (w <= 0) continue;
    const kk = v.p[1] / bin;
    const k0 = Math.floor(kk);
    const e0 = slices.get(k0) ?? slices.get(k0 + 1);
    const e1 = slices.get(k0 + 1) ?? e0;
    if (!e0) continue;
    const u = kk - k0;
    const lerp = (key) => e0[key] + (e1[key] - e0[key]) * u;
    const dz = v.p[2] - zc;
    v.p[0] *= 1 + (lerp('fx') - 1) * w;
    v.p[2] = zc + dz * (1 + (lerp(dz > 0 ? 'ff' : 'fb') - 1) * w);
  }
}

/**
 * Distance round a torso-like shell, for unwrapping patterns without stretch: slices of the shell are
 * measured as polygons (mean radius in each of `sectors` directions about `zc`), and a vertex's u is how
 * far round its slice it sits, scaled so one lap is exactly `lap` metres (patterns then meet at the seam).
 * `angleOf(v)` is 0 at the seam; the returned function takes a vertex and its (unwrapped) angle.
 */
function girth(mesh, pick, angleOf, zc, lap, bin = 0.03, sectors = 48) {
  const TAU = Math.PI * 2;
  const rows = new Map();
  for (const v of mesh.v) {
    if (!pick(v)) continue;
    const key = Math.round(v.p[1] / bin);
    const row = rows.get(key) ?? { sum: new Float64Array(sectors), n: new Float64Array(sectors) };
    let a = angleOf(v);
    if (a < 0) a += TAU;
    const sIdx = Math.min(sectors - 1, Math.floor((a / TAU) * sectors));
    row.sum[sIdx] += Math.hypot(v.p[0], v.p[2] - zc);
    row.n[sIdx]++;
    rows.set(key, row);
  }
  for (const row of rows.values()) {
    const r = new Float64Array(sectors);
    for (let i = 0; i < sectors; i++) {
      if (row.n[i]) {
        r[i] = row.sum[i] / row.n[i];
        continue;
      }
      // Empty direction: borrow from the nearest measured ones either side.
      let a = 1;
      let b = 1;
      while (a < sectors && !row.n[(i - a + sectors) % sectors]) a++;
      while (b < sectors && !row.n[(i + b) % sectors]) b++;
      const ra = row.sum[(i - a + sectors) % sectors] / (row.n[(i - a + sectors) % sectors] || 1);
      const rb = row.sum[(i + b) % sectors] / (row.n[(i + b) % sectors] || 1);
      r[i] = (ra * b + rb * a) / (a + b);
    }
    // cum[i] = distance from the seam to the middle of sector i.
    const point = (i) => {
      const a = ((i + 0.5) / sectors) * TAU;
      return [Math.sin(a) * r[i], Math.cos(a) * r[i]];
    };
    row.cum = new Float64Array(sectors + 1);
    for (let i = 1; i <= sectors; i++) {
      const p0 = point(i - 1);
      const p1 = point(i % sectors);
      row.cum[i] = row.cum[i - 1] + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    }
    row.total = row.cum[sectors];
  }
  const keys = [...rows.keys()].sort((a, b) => a - b);
  const nearest = (key) => rows.get(key) ?? rows.get(keys.reduce((best, k) => (Math.abs(k - key) < Math.abs(best - key) ? k : best), keys[0]));
  const along = (row, angle) => {
    const laps = Math.floor(angle / TAU);
    const f = ((angle - laps * TAU) / TAU) * sectors - 0.5;
    const i = Math.floor(f);
    const t = f - i;
    // Before the middle of the first sector we are on the closing segment of the previous lap.
    const d = i < 0 ? row.cum[sectors - 1] - row.total + t * (row.cum[sectors] - row.cum[sectors - 1]) : row.cum[i] + t * (row.cum[i + 1] - row.cum[i]);
    return (d / row.total + laps) * lap;
  };
  return (v, angle) => {
    const k = v.p[1] / bin;
    const k0 = Math.floor(k);
    const a = along(nearest(k0), angle);
    const b = along(nearest(k0 + 1), angle);
    return a + (b - a) * (k - k0);
  };
}

async function buildBody(name, { gltf, albedo, normal, hairs, collarR, drape }) {
  const doc = await readModel(path.join(BODY_DIR, gltf));
  const sk = readSkeleton(doc);
  const meshes = doc.getRoot().listMeshes();
  const byMaterial = (prefix) => fromPrimitive(meshes.find((mm) => mm.listPrimitives()[0].getMaterial().getName().startsWith(prefix)).listPrimitives()[0], sk.jointMap);
  const body = byMaterial('MI_Superhero');
  const eyesSrc = byMaterial('MI_Eyes');
  const browsSrc = byMaterial('MI_Hair');
  const headJoint = sk.index.get('Head');

  // ── Measurements (T-pose, facing +z, left arm along +x) ──
  const J = sk.at;
  const neck = J('neck_01');
  const headTop = Math.max(...body.v.map((v) => v.p[1]));
  const midline = body.v.filter((v) => Math.abs(v.p[0]) < 0.012 && v.p[1] > J('calf_l')[1] && v.p[1] < J('spine_01')[1]);
  const crotchY = Math.min(...midline.map((v) => v.p[1]));
  const neckAxisZ = neck[2] + 0.012;
  // The collar is where the body's surface passes through a sphere sitting on the base of the neck.
  const neckRing = body.v.filter((v) => Math.abs(v.p[1] - neck[1]) < 0.01 && Math.abs(v.p[0]) < 0.1);
  const ringZ = neckRing.map((v) => v.p[2]);
  const collar = [0, neck[1] + 0.01, (Math.min(...ringZ) + Math.max(...ringZ)) / 2 + 0.02];
  const neckDist = (v) => Math.hypot(v.p[0], v.p[1] - collar[1], v.p[2] - collar[2]);
  const eyeY = eyesSrc.v.reduce((a, v) => a + v.p[1], 0) / eyesSrc.v.length;
  const m = {
    shoulderX: J('upperarm_l')[0],
    elbowX: J('lowerarm_l')[0],
    wristX: J('hand_l')[0],
    armY: J('upperarm_l')[1],
    armZ: J('lowerarm_l')[2],
    hipX: J('thigh_l')[0],
    hipY: J('thigh_l')[1],
    kneeY: J('calf_l')[1],
    ankleY: J('foot_l')[1],
    legZ: J('calf_l')[2],
    chestY: J('spine_03')[1],
    crotchY,
    footMinY: Math.min(...body.v.map((v) => v.p[1])),
    sole: 0.016,
  };
  m.hemY = crotchY + 0.07;
  m.waistY = m.hemY + 0.12;
  m.shortsY = Math.max(m.kneeY + 0.09, crotchY - 0.13);
  m.trouserY = m.ankleY + 0.005;
  m.armholeX = m.shoulderX + 0.035;
  m.shortX = m.armholeX + 0.15;
  m.cuffX = m.wristX - 0.012;
  m.collarR = collarR;
  m.collarTopY = neck[1] + 0.045;
  console.log(name, 'measures', Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(3)])), 'headTop', headTop.toFixed(3), 'eyeY', eyeY.toFixed(3));

  // ── Skin that can show ──
  const headField = (v) => Math.max(v.p[1] - (m.collarTopY - 0.03), m.collarR + 0.035 - neckDist(v));
  const skinHead = clip(body, headField);
  const skinHands = clip(body, (v) => absx(v) - (m.cuffX - 0.03));
  const arms = clip(clip(body, (v) => absx(v) - (m.armholeX - 0.05)), (v) => m.cuffX - 0.03 - absx(v));
  const skinForearms = clip(arms, (v) => absx(v) - (m.shortX - 0.04));
  const skinUpperArms = clip(arms, (v) => m.shortX - 0.04 - absx(v));
  const skinLowerLegs = clip(clip(body, (v) => m.shortsY + 0.05 - v.p[1]), (v) => v.p[1] - (m.ankleY + 0.04));

  // ── Top: torso and sleeves as one shell ──
  let top = body;
  top = clip(top, (v) => v.p[1] - m.hemY);
  top = clip(top, (v) => m.collarTopY - v.p[1]);
  top = clip(top, (v) => neckDist(v) - m.collarR);
  top = compact(clip(top, (v) => m.cuffX - absx(v)));
  for (const v of top.v) v.q = [...v.p];
  smooth(top, 40);
  computeNormals(top);
  // A little further out at the hem, where it lies over the waistband.
  offset(top, (v) => 0.012 + 0.006 * (1 - smoothstep(m.hemY, m.hemY + 0.14, v.q[1])));
  drapeTorso(top, m, neckAxisZ, drape);
  // Sleeves: as wide as the upper arm all the way down, narrowing a little to the cuff.
  tube(
    top,
    (v) => (Math.abs(v.q[0]) > m.armholeX - 0.02 ? { t: Math.abs(v.q[0]), g: Math.sign(v.q[0]), w: smoothstep(m.armholeX - 0.02, m.armholeX + 0.05, Math.abs(v.q[0])) } : null),
    [1, 2],
    (t) => t > m.armholeX + 0.03 && t < m.elbowX,
    (t, ref) => ref * (0.96 - 0.2 * smoothstep(m.elbowX - 0.05, m.cuffX, t)),
  );
  smooth(top, 10);
  computeNormals(top);
  const torsoAngle = (v) => Math.atan2(-v.p[0], -(v.p[2] - neckAxisZ));
  const topGirth = girth(top, (v) => Math.abs(v.q[0]) < m.armholeX, torsoAngle, neckAxisZ, 1.08);
  top = assignCornerUVs(top, (tri) => {
    const cx = (tri[0].q[0] + tri[1].q[0] + tri[2].q[0]) / 3;
    if (Math.abs(cx) > m.armholeX) {
      const ang = unwrapAngles(tri.map((v) => Math.atan2(v.p[2] - m.armZ, -(v.p[1] - m.armY)) * Math.sign(cx)));
      return tri.map((v, i) => [((ang[i] / (Math.PI * 2)) * 0.36) / UV_METRES, Math.abs(v.p[0]) / UV_METRES]);
    }
    const ang = unwrapAngles(tri.map(torsoAngle));
    return tri.map((v, i) => [topGirth(v, ang[i]) / UV_METRES, v.p[1] / UV_METRES]);
  });
  const topTorso = clip(top, (v) => m.armholeX - Math.abs(v.q[0]));
  const sleeves = clip(top, (v) => Math.abs(v.q[0]) - m.armholeX);
  const topShort = clip(sleeves, (v) => m.shortX - Math.abs(v.q[0]));
  const topLong = clip(sleeves, (v) => Math.abs(v.q[0]) - m.shortX);
  const near = (a, b, f, value, tol = 0.004) => Math.abs(f(a) - value) < tol && Math.abs(f(b) - value) < tol;
  const qx = (v) => Math.abs(v.q[0]);
  const topArmholeLips = lips(topTorso, (a, b) => near(a, b, qx, m.armholeX));
  const topTorsoLips = lips(topTorso, (a, b) => !near(a, b, qx, m.armholeX));
  const topShortLips = lips(topShort, (a, b) => near(a, b, qx, m.shortX));
  const topCuffLips = lips(topLong, (a, b) => near(a, b, qx, m.cuffX, 0.012));

  // ── Legs: trousers, cut at the shorts hem ──
  let legs = clip(body, (v) => m.waistY - v.p[1]);
  legs = compact(clip(legs, (v) => v.p[1] - m.trouserY));
  for (const v of legs.v) v.q = [...v.p];
  smooth(legs, 18);
  computeNormals(legs);
  // Thinner where the top covers it, so the waistband never shows through the shirt.
  offset(legs, (v) => 0.006 + 0.006 * (1 - smoothstep(m.hemY - 0.05, m.hemY, v.q[1])));
  // Straight legs: from the knee down the trousers keep nearly the knee's width.
  tube(
    legs,
    (v) => (v.q[1] < m.kneeY + 0.1 ? { t: v.q[1], g: Math.sign(v.q[0]), w: 1 - smoothstep(m.kneeY, m.kneeY + 0.1, v.q[1]) } : null),
    [0, 2],
    (t) => Math.abs(t - m.kneeY) < 0.05,
    (t, ref) => ref * (0.9 + 0.1 * smoothstep(m.ankleY, m.kneeY, t)),
  );
  smooth(legs, 2);
  computeNormals(legs);
  const seatGirth = girth(legs, (v) => v.q[1] >= m.crotchY, torsoAngle, neckAxisZ, 1.08);
  legs = assignCornerUVs(legs, (tri) => {
    const cy = (tri[0].q[1] + tri[1].q[1] + tri[2].q[1]) / 3;
    const cx = (tri[0].q[0] + tri[1].q[0] + tri[2].q[0]) / 3;
    if (cy < m.crotchY) {
      const side = Math.sign(cx) || 1;
      const ang = unwrapAngles(tri.map((v) => Math.atan2(-(v.p[0] - side * m.hipX) * side, -(v.p[2] - m.legZ))));
      return tri.map((v, i) => [((ang[i] / (Math.PI * 2)) * 0.54) / UV_METRES, v.p[1] / UV_METRES]);
    }
    const ang = unwrapAngles(tri.map(torsoAngle));
    return tri.map((v, i) => [seatGirth(v, ang[i]) / UV_METRES, v.p[1] / UV_METRES]);
  });
  const qy = (v) => v.q[1];
  const legsUpper = clip(legs, (v) => v.q[1] - m.shortsY);
  const legsLower = clip(legs, (v) => m.shortsY - v.q[1]);
  const legsShortsLips = lips(legsUpper, (a, b) => near(a, b, qy, m.shortsY));
  const legsAnkleLips = lips(legsLower, (a, b) => near(a, b, qy, m.trouserY, 0.012));

  // ── Shoes and socks ──
  const shoes = new Mesh();
  append(shoes, buildShoe(body, sk, 'l', m));
  append(shoes, buildShoe(body, sk, 'r', m));
  let socks = clip(clip(body, (v) => m.ankleY + 0.1 - v.p[1]), (v) => v.p[1] - (m.ankleY - 0.03));
  socks = compact(clip(socks, (v) => 0.1 - Math.abs(v.p[2] - m.legZ)));
  for (const v of socks.v) v.q = [...v.p];
  smooth(socks, 2);
  computeNormals(socks);
  offset(socks, () => 0.0045);
  computeNormals(socks);
  paint(socks, CELL.socks);
  const sockLips = paint(lips(socks, (a, b) => a.q[1] > m.ankleY + 0.05 && b.q[1] > m.ankleY + 0.05, [0.6, 0.6, 0.6]), CELL.socks);

  // ── Eyes (front half only) and brows ──
  const eyeZ = eyesSrc.v.reduce((a, v) => a + v.p[2], 0) / eyesSrc.v.length;
  const eyes = compact(new Mesh(eyesSrc.v, eyesSrc.t.filter((t) => (eyesSrc.v[t[0]].p[2] + eyesSrc.v[t[1]].p[2] + eyesSrc.v[t[2]].p[2]) / 3 > eyeZ - 0.002)));
  for (const v of eyes.v) v.uv = [Math.min(1, Math.max(0, v.uv[0])) * 0.5, Math.min(1, Math.max(0, v.uv[1]))];

  // ── Hair ──
  const head = J('Head');
  const skull = body.v.filter((v) => v.p[1] > eyeY + 0.03);
  const hatLineY = eyeY + 0.05;
  const band = body.v.filter((v) => Math.abs(v.p[1] - hatLineY) < 0.012);
  const headMetrics = {
    top: headTop,
    hatLine: hatLineY,
    eyeY,
    rx: Math.max(...band.map((v) => Math.abs(v.p[0]))),
    z0: Math.min(...band.map((v) => v.p[2])),
    z1: Math.max(...band.map((v) => v.p[2])),
    skullZ0: Math.min(...skull.map((v) => v.p[2])),
    skullZ1: Math.max(...skull.map((v) => v.p[2])),
    earY: eyeY - 0.01,
  };
  const hairLum = {};
  const loadHair = async (file, fit) => {
    const hdoc = await readModel(path.join(HAIR_DIR, `${file}.gltf`));
    const prim = hdoc.getRoot().listMeshes()[0].listPrimitives()[0];
    const tex = prim.getMaterial().getBaseColorTexture().getURI().replace('_png.png', '.png');
    hairLum[tex] ??= await luminanceSampler(path.join(HAIR_DIR, tex));
    const mesh = fromPrimitive(prim);
    for (const v of mesh.v) {
      v.s = [[headJoint, 1]];
      const l = hairLum[tex](v.uv[0], v.uv[1]);
      v.c = [l, l, l];
      v.uv = [...CELL.hair];
      if (fit) v.p = fit(v.p);
    }
    return mesh;
  };
  const hair = {};
  for (const [style, build] of Object.entries(hairs)) hair[style] = await build(loadHair, { head, m: headMetrics, eyeY });
  const browLum = await luminanceSampler(path.join(HAIR_DIR, 'T_Hair_1_BaseColor.png'));
  for (const v of browsSrc.v) {
    const l = Math.min(0.8, browLum(v.uv[0], v.uv[1]));
    v.c = [l, l, l];
    v.uv = [...CELL.hair];
  }

  // ── Assemble: one vertex buffer, parts as index ranges (order matters: variants are contiguous) ──
  const all = new Mesh();
  const parts = {};
  const put = (key, ...pieces) => {
    const start = all.t.length * 3;
    for (const piece of pieces) append(all, compact(piece));
    parts[key] = [start, all.t.length * 3 - start];
  };
  put('skinLowerLegs', skinLowerLegs);
  put('skinHead', skinHead, skinHands);
  put('skinForearms', skinForearms);
  put('skinUpperArms', skinUpperArms);
  put('topArmholeLips', topArmholeLips);
  put('topTorso', topTorso, topTorsoLips);
  put('topShort', topShort);
  put('topShortLips', topShortLips);
  put('topLong', topLong, topCuffLips);
  put('legsUpper', legsUpper);
  put('legsShortsLips', legsShortsLips);
  put('legsLower', legsLower, legsAnkleLips);
  put('misc', shoes, socks, sockLips, eyes, browsSrc);
  for (const [style, mesh] of Object.entries(hair)) {
    put(`hair_${style}_low`, clip(mesh, (v) => hatLineY - v.p[1]));
    put(`hair_${style}_high`, clip(mesh, (v) => v.p[1] - hatLineY));
  }
  console.log(name, 'verts', all.v.length, 'tris', all.t.length, Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v[1] / 3])));

  // ── Write ──
  const out = new Document();
  out.createExtension(KHRMeshQuantization).setRequired(true);
  const buffer = out.createBuffer();
  const n = all.v.length;
  const position = new Float32Array(n * 3);
  const nrm = new Int8Array(n * 3);
  const uv = new Uint16Array(n * 2);
  const color = new Uint8Array(n * 3);
  const jointsArr = new Uint8Array(n * 4);
  const weights = new Uint8Array(n * 4);
  all.v.forEach((v, i) => {
    position.set(v.p, i * 3);
    const nn = normalize(v.n);
    nrm.set(nn.map((x) => Math.round(x * 127)), i * 3);
    uv.set([Math.round(Math.min(1, Math.max(0, v.uv[0])) * 65535), Math.round(Math.min(1, Math.max(0, v.uv[1])) * 65535)], i * 2);
    color.set(v.c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)), i * 3);
    const s = v.s.slice(0, 4);
    const total = s.reduce((a, e) => a + e[1], 0);
    const q = s.map(([, w]) => Math.round((w / total) * 255));
    q[0] += 255 - q.reduce((a, b) => a + b, 0);
    s.forEach(([j], k) => {
      jointsArr[i * 4 + k] = j;
      weights[i * 4 + k] = q[k];
    });
  });
  const index = n < 65536 ? new Uint16Array(all.t.length * 3) : new Uint32Array(all.t.length * 3);
  all.t.forEach((t, i) => index.set(t, i * 3));
  const acc = (type, array, normalized = false) => out.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);

  const { jpeg, gain } = await neutralSkin(path.join(TEX_DIR, albedo), 1024);
  const material = out
    .createMaterial('skin')
    .setRoughnessFactor(0.62)
    .setMetallicFactor(0)
    .setBaseColorTexture(out.createTexture('skin').setImage(jpeg).setMimeType('image/jpeg'))
    .setNormalTexture(out.createTexture('skinNormal').setImage(await normalMap(path.join(BODY_DIR, normal), 1024)).setMimeType('image/jpeg'));
  const prim = out
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', position))
    .setAttribute('NORMAL', acc('VEC3', nrm, true))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv, true))
    .setAttribute('COLOR_0', acc('VEC3', color, true))
    .setAttribute('JOINTS_0', acc('VEC4', jointsArr))
    .setAttribute('WEIGHTS_0', acc('VEC4', weights, true))
    .setIndices(acc('SCALAR', index))
    .setMaterial(material);
  const nodes = sk.joints.map((j) => out.createNode(j.name).setTranslation(j.t).setRotation(j.r).setScale(j.s));
  sk.joints.forEach((j, i) => {
    if (j.parent >= 0) nodes[j.parent].addChild(nodes[i]);
  });
  const skin = out.createSkin('Armature').setInverseBindMatrices(acc('MAT4', new Float32Array(sk.joints.flatMap((j) => j.ibm))));
  nodes.forEach((node) => skin.addJoint(node));
  skin.setSkeleton(nodes[0]);
  const meshNode = out.createNode('Body').setMesh(out.createMesh('Body').addPrimitive(prim)).setSkin(skin);
  const armature = out.createNode('Armature').addChild(meshNode).addChild(nodes[0]);
  out.createScene(name).addChild(armature);
  out.getRoot().setExtras({
    parts,
    uvMetres: UV_METRES,
    skinGain: +gain.toFixed(4),
    lift: +(m.sole - m.footMinY).toFixed(4),
    head: Object.fromEntries(Object.entries(headMetrics).map(([k, v]) => [k, +v.toFixed(4)])),
    hairStyles: Object.keys(hair),
  });
  await out.transform(prune(), dedup());
  const file = path.join(OUT, `${name}.glb`);
  await io.write(file, out);
  console.log(name, '→', path.relative(ROOT, file), (fs.statSync(file).size / 1024).toFixed(0), 'KB');
  return sk;
}

// ───────────────────────────── hair styles ─────────────────────────────

/** Move a hairpiece modelled on one head onto another (heads differ in height and a little in size). */
const refit = (from, to, k = 1) => (p) => [to.x + (p[0] - from.x) * k, to.y + (p[1] - from.y) * k, to.z + (p[2] - from.z) * k];
/** Pull the lower part of a hairpiece downwards (longer hair). */
const lengthen = (mesh, fromY, factor, back = 0) => {
  for (const v of mesh.v) {
    if (v.p[1] >= fromY) continue;
    const d = fromY - v.p[1];
    v.p = [v.p[0], fromY - d * factor, v.p[2] - d * back];
  }
  return mesh;
};
const merge = (...meshes) => {
  const out = new Mesh();
  for (const mm of meshes) append(out, mm);
  return out;
};

// Head anchors of the two source bodies (crown of the skull, centre): hairpieces are refitted between them.
const MALE_HEAD = { x: 0, y: 1.81, z: -0.017 };
const FEMALE_HEAD = { x: 0, y: 1.767, z: -0.011 };

const MALE_HAIR = {
  short: (load) => load('Hair_SimpleParted'),
  long: async (load, h) => lengthen(await load('Hair_Long', refit(FEMALE_HEAD, MALE_HEAD, 1.03)), h.eyeY - 0.03, 1.45, 0.12),
  bob: (load) => load('Hair_Long', refit(FEMALE_HEAD, MALE_HEAD, 1.03)),
  mullet: async (load, h) => {
    const back = lengthen(await load('Hair_Long', refit(FEMALE_HEAD, MALE_HEAD, 1.0)), h.eyeY - 0.03, 1.3, 0.1);
    return merge(await load('Hair_SimpleParted'), clip(clip(back, (v) => -0.035 - v.p[2]), (v) => h.eyeY + 0.035 - v.p[1]));
  },
};
const FEMALE_HAIR = {
  short: (load) => load('Hair_SimpleParted', refit(MALE_HEAD, FEMALE_HEAD, 0.985)),
  long: async (load, h) => lengthen(await load('Hair_Long'), h.eyeY - 0.03, 1.6, 0.12),
  bob: (load) => load('Hair_Long'),
  mullet: async (load, h) => {
    const back = lengthen(await load('Hair_Long'), h.eyeY - 0.03, 1.3, 0.1);
    return merge(await load('Hair_SimpleParted', refit(MALE_HEAD, FEMALE_HEAD, 0.985)), clip(clip(back, (v) => -0.035 - v.p[2]), (v) => h.eyeY + 0.035 - v.p[1]));
  },
};

// ───────────────────────────── animations ─────────────────────────────

async function buildAnimations(target) {
  const doc = await io.read(path.join(UAL1, 'UAL1_Standard.glb'));
  const rm = await io.read(path.join(UAL1, 'UAL1_Standard_RM.glb'));
  const src = readSkeleton(doc);
  const pelvisScale = target.at('pelvis')[1] / src.at('pelvis')[1];
  const out = new Document();
  const buffer = out.createBuffer();
  const nodes = target.joints.map((j) => out.createNode(j.name).setTranslation(j.t).setRotation(j.r).setScale(j.s));
  target.joints.forEach((j, i) => {
    if (j.parent >= 0) nodes[j.parent].addChild(nodes[i]);
  });
  out.createScene('anims').addChild(out.createNode('Armature').addChild(nodes[0]));

  const animated = target.joints.map((j, i) => ({ j, i })).filter(({ j }) => j.name !== 'root');
  const rot = new Map(animated.map(({ j }) => [j.name, []]));
  const pelvis = [];
  const table = {};
  const speeds = {};
  let cursor = 0;
  for (const name of CLIPS) {
    const anim = doc.getRoot().listAnimations().find((a) => a.getName() === name);
    if (!anim) throw new Error(`missing clip ${name}`);
    const channels = new Map();
    let duration = 0;
    for (const ch of anim.listChannels()) {
      const sampler = ch.getSampler();
      const times = sampler.getInput().getArray();
      duration = Math.max(duration, times[times.length - 1]);
      channels.set(`${ch.getTargetNode().getName()}.${ch.getTargetPath()}`, { times, values: sampler.getOutput().getArray(), size: ch.getTargetPath() === 'rotation' ? 4 : 3 });
    }
    const frames = Math.round(duration * FPS) + 1;
    const sample = (key, f, fallback) => {
      const c = channels.get(key);
      if (!c) return fallback;
      const t = f / FPS;
      let k = 0;
      while (k < c.times.length - 2 && c.times[k + 1] <= t) k++;
      const k1 = Math.min(c.times.length - 1, k + 1);
      const span = c.times[k1] - c.times[k];
      const a = span > 0 ? Math.min(1, Math.max(0, (t - c.times[k]) / span)) : 0;
      const v0 = Array.from(c.values.subarray(k * c.size, k * c.size + c.size));
      const v1 = Array.from(c.values.subarray(k1 * c.size, k1 * c.size + c.size));
      if (c.size === 4 && v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2] + v0[3] * v1[3] < 0) for (let i = 0; i < 4; i++) v1[i] = -v1[i];
      const v = v0.map((x, i) => x + (v1[i] - x) * a);
      if (c.size === 4) {
        const l = Math.hypot(...v);
        return v.map((x) => x / l);
      }
      return v;
    };
    // Root motion must already be absent from this file; make sure of it.
    const rootT = channels.get('root.translation');
    if (rootT) {
      const first = Array.from(rootT.values.subarray(0, 3));
      const last = Array.from(rootT.values.subarray(rootT.values.length - 3));
      if (Math.hypot(...sub(first, last)) > 0.01) throw new Error(`${name}: root moves in the in-place file`);
    }
    const first = sample('pelvis.translation', 0, target.joints[target.index.get('pelvis')].t);
    for (let f = 0; f < frames; f++) {
      for (const { j } of animated) rot.get(j.name).push(...sample(`${j.name}.rotation`, f, j.r));
      const p = sample('pelvis.translation', f, target.joints[target.index.get('pelvis')].t);
      // Seated clips are authored away from the origin; keep the hips over it (the game places the seat).
      const anchored = name.startsWith('Sitting') || name.startsWith('Driving');
      pelvis.push((anchored ? p[0] - first[0] : p[0]) * pelvisScale, (anchored ? p[1] - first[1] : p[1]) * pelvisScale, p[2] * pelvisScale);
    }
    table[name] = [cursor, frames];
    cursor += frames;
    // Authored ground speed from the root-motion twin of the clip.
    const twin = rm.getRoot().listAnimations().find((a) => a.getName() === name);
    const tr = twin?.listChannels().find((ch) => ch.getTargetNode().getName() === 'root' && ch.getTargetPath() === 'translation');
    if (tr) {
      const v = tr.getSampler().getOutput().getArray();
      const t = tr.getSampler().getInput().getArray();
      const d = Math.hypot(v[v.length - 3] - v[0], v[v.length - 2] - v[1], v[v.length - 1] - v[2]);
      if (d > 0.2) speeds[name] = +(d / (t[t.length - 1] - t[0])).toFixed(3);
    }
  }
  // Ground speed of the gaits: how fast a planted foot travels backwards under the hips. (The library's
  // root-motion files average the whole stride, which under-reads the running clips and makes feet skate.)
  {
    const bones = target.joints.map((j) => {
      const bone = new THREE.Object3D();
      bone.position.fromArray(j.t);
      bone.quaternion.fromArray(j.r);
      return bone;
    });
    target.joints.forEach((j, i) => {
      if (j.parent >= 0) bones[j.parent].add(bones[i]);
    });
    const pelvisBone = bones[target.index.get('pelvis')];
    const p = new THREE.Vector3();
    for (const name of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop']) {
      const [start, frames] = table[name];
      const track = [];
      for (let f = 0; f < frames; f++) {
        for (const { j, i } of animated) bones[i].quaternion.fromArray(rot.get(j.name), (start + f) * 4);
        pelvisBone.position.fromArray(pelvis, (start + f) * 3);
        bones[0].updateMatrixWorld(true);
        track.push(['ball_l', 'ball_r'].map((n) => bones[target.index.get(n)].getWorldPosition(p).toArray()));
      }
      let sum = 0;
      let n = 0;
      for (const side of [0, 1]) {
        const low = Math.min(...track.map((t) => t[side][1]));
        for (let f = 1; f < frames; f++) {
          if (track[f][side][1] > low + 0.02 || track[f - 1][side][1] > low + 0.02) continue;
          sum += (track[f - 1][side][2] - track[f][side][2]) * FPS;
          n++;
        }
      }
      if (n >= 2 && name === 'Walk_Loop') speeds[name] = +(sum / n).toFixed(3);
    }
    // The running clips are mostly airborne, so neither figure is reliable for them: these two were set
    // by measuring foot slide in dev/characters.html across 2.5–7.5 m/s.
    speeds.Jog_Fwd_Loop = 5.6;
    speeds.Sprint_Loop = 7.8;
  }
  const times = out.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: cursor }, (_, i) => i / FPS)).setBuffer(buffer);
  const anim = out.createAnimation('all');
  for (const { j, i } of animated) {
    const q = Int16Array.from(rot.get(j.name), (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
    const sampler = out.createAnimationSampler().setInput(times).setOutput(out.createAccessor().setType('VEC4').setArray(q).setNormalized(true).setBuffer(buffer)).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(out.createAnimationChannel().setTargetNode(nodes[i]).setTargetPath('rotation').setSampler(sampler));
  }
  const ps = out.createAnimationSampler().setInput(times).setOutput(out.createAccessor().setType('VEC3').setArray(new Float32Array(pelvis)).setBuffer(buffer)).setInterpolation('LINEAR');
  anim.addSampler(ps).addChannel(out.createAnimationChannel().setTargetNode(nodes[target.index.get('pelvis')]).setTargetPath('translation').setSampler(ps));
  out.getRoot().setExtras({ fps: FPS, clips: table, speeds, pelvisY: +target.at('pelvis')[1].toFixed(4) });
  const file = path.join(OUT, 'anims.glb');
  await io.write(file, out);
  console.log('anims →', path.relative(ROOT, file), (fs.statSync(file).size / 1024).toFixed(0), 'KB', 'frames', cursor, 'speeds', speeds);
}

// ───────────────────────────── main ─────────────────────────────

fs.mkdirSync(OUT, { recursive: true });
const male = await buildBody('male', { gltf: 'Superhero_Male_FullBody.gltf', albedo: 'T_Superhero_Male_Ligh.png', normal: 'T_Superhero_Male_Normal.png', hairs: MALE_HAIR, collarR: 0.092, drape: { side: 0.88, front: 0.97, back: 0.9 } });
await buildBody('female', { gltf: 'Superhero_Female_FullBody.gltf', albedo: 'T_Superhero_Female_Light_BaseColor.png', normal: 'T_Superhero_Female_Normal.png', hairs: FEMALE_HAIR, collarR: 0.078, drape: { side: 0.9, front: 0.9, back: 0.9 } });
await buildAnimations(male);
let total = 0;
for (const f of fs.readdirSync(OUT)) total += fs.statSync(path.join(OUT, f)).size;
console.log('total', (total / 1024 / 1024).toFixed(2), 'MB');
