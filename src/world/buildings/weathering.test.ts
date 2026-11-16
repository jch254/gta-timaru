import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../../core/types';
import { batchHint, setBatchHint } from '../../render/materials';
import { agedSign, weathered } from './weathering';

/** A library that makes real materials and accepts shader patches, as the game's does. */
function library(): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const get = (key: string, color: number) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = new THREE.MeshStandardMaterial({ color })));
    return m;
  };
  return {
    get: (surface, options = {}) => get(`${surface}|${options.color}`, options.color ?? 0xffffff),
    windows: () => get('windows', 0),
    emitter: (color) => get(`emitter|${color}`, color),
    sign: (text) => get(`sign|${text}`, 0xffffff),
    register: (m) => m,
    registerPatched: (m) => m,
    release: () => undefined,
  };
}

/** What the shader reads back out of the three numbers in the vertex colour. */
function decode(c: THREE.Color) {
  const tint = [c.r % 256, c.g % 256, c.b % 256].map((v) => (v / 255) ** 2 * 2);
  return {
    tint,
    ground: Math.floor(c.r / 256) * 0.125 - 32,
    seed: Math.floor(c.g / 256) % 64,
    age: Math.floor(c.g / 16384) % 8,
    fresh: Math.floor(c.g / 131072) % 2 === 1,
    top: (Math.floor(c.b / 256) % 256) * 0.25,
  };
}

describe('weathering', () => {
  it('packs the tint and the wear into the vertex colour and gets them back', () => {
    const lib = library();
    const m = weathered(lib, 'plaster', 0xd9d2bf, { ground: 137.4, seed: 41, age: 5, top: 7.6, fresh: true });
    expect(m).not.toBeNull();
    const hint = batchHint(m!);
    expect(hint?.base).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((hint!.base as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    const d = decode(hint!.color!);
    const want = new THREE.Color(0xd9d2bf);
    for (let i = 0; i < 3; i++) expect(d.tint[i]).toBeCloseTo(want.toArray()[i], 1);
    expect(d.ground).toBeCloseTo(137.4, 0);
    expect(d).toMatchObject({ seed: 41, age: 5, fresh: true });
    expect(d.top).toBeCloseTo(7.6, 0);
    // Every number must survive a 32-bit float, which is what a vertex attribute is.
    for (const v of hint!.color!.toArray()) expect(Math.fround(v)).toBe(v);
  });

  it('hands back the same handle for the same piece, one base per surface, and nothing for surfaces that do not weather', () => {
    const lib = library();
    const wear = { ground: 12, seed: 3, age: 2 };
    const a = weathered(lib, 'brick', undefined, wear);
    expect(weathered(lib, 'brick', undefined, wear)).toBe(a);
    const b = weathered(lib, 'brick', 0xe6d6cc, { ...wear, top: 5 });
    expect(b).not.toBe(a);
    expect(batchHint(b!)?.base).toBe(batchHint(a!)?.base);
    expect(batchHint(weathered(lib, 'slate', undefined, wear)!)?.base).not.toBe(batchHint(a!)?.base);
    expect(weathered(lib, 'gravel', undefined, wear)).toBeNull();
    expect(weathered(lib, 'glass', undefined, wear)).toBeNull();
  });

  it('falls back to the library when it cannot patch shaders', () => {
    const { registerPatched: _omit, ...plain } = library();
    expect(weathered(plain, 'brick', undefined, { ground: 0, seed: 0, age: 3 })).toBeNull();
    const sign = plain.sign('OPEN');
    expect(agedSign(plain, sign, { ground: 0, seed: 0, age: 3 })).toBe(sign);
  });

  it('ages atlas signs on a copy of their page and leaves neon alone', () => {
    const lib = library();
    const wear = { ground: 0, seed: 9, age: 4 };
    const page = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const sign = new THREE.MeshStandardMaterial();
    setBatchHint(sign, { base: page, uv: [0.1, 0.2, 0.3, 0.05] });
    const aged = agedSign(lib, sign, wear);
    expect(aged).not.toBe(sign);
    const hint = batchHint(aged)!;
    expect(hint.base).not.toBe(page);
    expect((hint.base as THREE.MeshStandardMaterial).map).toBe(page.map);
    expect(hint.uv).toEqual([0.1, 0.2, 0.3, 0.05]);
    expect(decode(hint.color!)).toMatchObject({ seed: 9, age: 4 });
    const neonPage = new THREE.MeshStandardMaterial({ emissiveMap: new THREE.Texture() });
    const neon = new THREE.MeshStandardMaterial();
    setBatchHint(neon, { base: neonPage, uv: [0, 0, 1, 1] });
    expect(agedSign(lib, neon, wear)).toBe(neon);
    expect(agedSign(lib, new THREE.MeshStandardMaterial(), wear)).toBeInstanceOf(THREE.MeshStandardMaterial);
  });
});
