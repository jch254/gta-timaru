import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vehicle } from '../core/types';
import { Decals, type DecalStyle } from './decals';
import { FlashLights } from './lights';
import { ParticlePool, particleStyle } from './particles';
import { burstExplosion, burstGore, DECAL_BLOOD_DROP, DECAL_BLOOD_POOL, DECAL_BLOOD_SPATTER, DECAL_CAPACITY, DECAL_POCK, DecalRing, SMOKE_BLAST } from './styles';
import { TracerPool } from './tracers';

/** Reach into a pool's buffers. */
const buffers = (pool: ParticlePool) => pool as unknown as { pos: Float32Array; col: Float32Array; siz: Float32Array };
const attribute = (mesh: THREE.Mesh, name: string) => (mesh.geometry as THREE.InstancedBufferGeometry).getAttribute(name).array as Float32Array;

describe('ParticlePool', () => {
  const style = particleStyle({ lifeMin: 1, lifeMax: 1, size0: 1, size1: 3, color0: [1, 0.5, 0.25], color1: [0, 0, 0], jitter: 0, gravity: 9.8 });

  it('never holds more than its capacity: the oldest particle is recycled', () => {
    const pool = new ParticlePool(32, false);
    const before = buffers(pool).pos;
    for (let i = 0; i < 100; i++) pool.emit(style, i, 0, 0, 0, 0, 0);
    expect(pool.alive).toBe(32);
    pool.update(0.01);
    expect(pool.alive).toBe(32);
    expect(buffers(pool).pos).toBe(before); // same buffer: nothing reallocated
    expect((pool.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(32);
    // The survivors are the newest 32.
    const xs = Array.from(before.filter((_, i) => i % 3 === 0)).sort((a, b) => a - b);
    expect(xs[0]).toBe(68);
    expect(xs[31]).toBe(99);
  });

  it('ages particles out, then hides the mesh', () => {
    const pool = new ParticlePool(16, true);
    expect(pool.mesh.visible).toBe(false);
    for (let i = 0; i < 5; i++) pool.emit(style, 0, 10, 0, 0, 0, 0);
    pool.update(0.5);
    expect(pool.alive).toBe(5);
    expect(pool.mesh.visible).toBe(true);
    pool.update(0.6);
    expect(pool.alive).toBe(0);
    pool.update(0.016);
    expect(pool.mesh.visible).toBe(false);
    // And it can be used again afterwards.
    pool.emit(style, 0, 0, 0, 0, 0, 0);
    pool.update(0.1);
    expect(pool.alive).toBe(1);
    expect(pool.mesh.visible).toBe(true);
  });

  it('moves, falls, grows and fades', () => {
    const pool = new ParticlePool(4, false);
    pool.emit(style, 0, 10, 0, 2, 0, 0);
    const { pos, col, siz } = buffers(pool);
    expect(siz[0]).toBeCloseTo(1, 5);
    for (let i = 0; i < 30; i++) pool.update(1 / 60);
    expect(pos[0]).toBeCloseTo(1, 1); // 2 m/s for half a second
    expect(pos[1]).toBeLessThan(10 - 1); // fell about 1.2 m
    expect(siz[0]).toBeGreaterThan(2); // eased most of the way to 3
    expect(col[3]).toBeCloseTo(0.5, 1); // half faded
    expect(col[0]).toBeCloseTo(0.5, 1); // half-way between the two colours
  });

  it('drag, wind and buoyancy do what they say', () => {
    const pool = new ParticlePool(4, false);
    const smoke = particleStyle({ lifeMin: 5, lifeMax: 5, size0: 1, size1: 1, color0: [1, 1, 1], drag: 2, gravity: -2, wind: 1, jitter: 0 });
    pool.emit(smoke, 0, 0, 0, 10, 0, 0);
    for (let i = 0; i < 180; i++) pool.update(1 / 60, 0, 3);
    const { pos } = buffers(pool);
    expect(pos[0]).toBeGreaterThan(0.5);
    expect(pos[0]).toBeLessThan(10); // the push died away
    expect(pos[1]).toBeGreaterThan(1); // rose
    expect(pos[2]).toBeGreaterThan(2); // carried down-wind
  });

  it('clear() empties it', () => {
    const pool = new ParticlePool(8, false);
    for (let i = 0; i < 8; i++) pool.emit(style, 0, 0, 0, 0, 0, 0);
    pool.clear();
    expect(pool.alive).toBe(0);
    expect(pool.mesh.visible).toBe(false);
  });

  it('torn pieces fall, lie on the floor and are still there seconds later', () => {
    const pool = new ParticlePool(400, false);
    burstGore(pool, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), 1.5, 0);
    const emitted = pool.alive;
    expect(emitted).toBeGreaterThan(20);
    for (let i = 0; i < 180; i++) pool.update(1 / 60);
    // The drops are gone into the ground (decals take over); the pieces stay.
    expect(pool.alive).toBeGreaterThan(0);
    expect(pool.alive).toBeLessThan(emitted);
    const { pos, siz } = buffers(pool);
    for (let i = 0; i < 400; i++) if (siz[i * 2] > 0) expect(pos[i * 3 + 1]).toBeGreaterThanOrEqual(0);
  });

  it('a blast fits its pools many times over', () => {
    const smoke = new ParticlePool(2000, false);
    const glow = new ParticlePool(1000, true);
    burstExplosion(smoke, glow, new THREE.Vector3(0, 0.5, 0), 9, 0);
    expect(smoke.alive).toBeLessThan(400);
    expect(glow.alive).toBeLessThan(250);
  });

  it('blast smoke glows from the fire inside it, then goes black', () => {
    const pool = new ParticlePool(1, false);
    const shp = () => (pool as unknown as { shp: Float32Array }).shp[3];
    pool.emit(SMOKE_BLAST, 0, 0, 0, 0, 0, 0);
    for (let i = 0; i < 12; i++) pool.update(1 / 60);
    expect(shp()).toBeGreaterThan(0.5);
    for (let i = 0; i < 100; i++) pool.update(1 / 60);
    expect(shp()).toBe(0);
  });
});

describe('TracerPool', () => {
  it('streaks out and expires', () => {
    const pool = new TracerPool(8);
    pool.spawn(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 60), 5, 4, 2);
    expect(pool.active).toBe(1);
    expect(pool.mesh.visible).toBe(true);
    const starts = attribute(pool.mesh, 'iStart');
    const ends = attribute(pool.mesh, 'iEnd');
    expect(ends[2]).toBeGreaterThan(starts[2]); // already a visible streak on the first frame
    pool.update(0.05);
    expect(ends[2]).toBeGreaterThan(15);
    expect(ends[2]).toBeLessThanOrEqual(60);
    expect(starts[2]).toBeGreaterThan(0); // the tail has left the muzzle
    for (let i = 0; i < 30; i++) pool.update(1 / 60);
    expect(pool.active).toBe(0);
    pool.update(1 / 60);
    expect(pool.mesh.visible).toBe(false);
  });

  it('ignores point-blank shots and never exceeds its capacity', () => {
    const pool = new TracerPool(8);
    pool.spawn(new THREE.Vector3(), new THREE.Vector3(0, 0, 0.2), 1, 1, 1);
    expect(pool.active).toBe(0);
    for (let i = 0; i < 50; i++) pool.spawn(new THREE.Vector3(i, 0, 0), new THREE.Vector3(i, 0, 200), 1, 1, 1);
    expect(pool.active).toBe(8);
  });

  it('keeps a couple of pixels of width at any distance', () => {
    const pool = new TracerPool(2);
    pool.setViewport(58, 1080);
    const pixel = (pool.mesh.material as THREE.ShaderMaterial).uniforms.uPixel.value as number;
    // At 100 m one pixel is about a tenth of a metre.
    expect(pixel * 100).toBeGreaterThan(0.08);
    expect(pixel * 100).toBeLessThan(0.13);
  });
});

describe('Decals', () => {
  const up = new THREE.Vector3(0, 1, 0);
  const at = (x: number) => new THREE.Vector3(x, 0, 0);

  it('recycles the oldest in each ring and keeps rings separate', () => {
    const decals = new Decals(DECAL_CAPACITY);
    const blood = DECAL_CAPACITY[DecalRing.Blood];
    for (let i = 0; i < blood + 15; i++) decals.add(DECAL_BLOOD_SPATTER, 0, at(i), up, null, 0.4, 0.3);
    expect(decals.active).toBe(blood);
    for (let i = 0; i < 5; i++) decals.add(DECAL_POCK, 0, at(i), up, null, 0.03, 0.03);
    expect(decals.active).toBe(blood + 5);
    expect(decals.capacity).toBe(DECAL_CAPACITY.reduce((a, b) => a + b, 0));
    expect(decals.mesh.visible).toBe(true);
  });

  it('a trail of drops never takes the pools under bodies', () => {
    const decals = new Decals(DECAL_CAPACITY);
    for (let i = 0; i < 3; i++) decals.add(DECAL_BLOOD_POOL, 0, at(i), up, null, 0.6, 0.5);
    const drops = DECAL_CAPACITY[DecalRing.Drop];
    for (let i = 0; i < drops * 3; i++) decals.add(DECAL_BLOOD_DROP, 0, at(i), up, null, 0.05, 0.05);
    expect(DECAL_BLOOD_DROP.ring).not.toBe(DECAL_BLOOD_POOL.ring);
    expect(decals.active).toBe(3 + drops);
  });

  it('lingers, fades, then frees the slot', () => {
    const decals = new Decals([4]);
    const style: DecalStyle = { ...DECAL_BLOOD_SPATTER, ring: 0, life: 60, fade: 10, grow: 0, alpha: 0.9 };
    const slot = decals.add(style, 100, at(0), up, null, 0.5, 0.5);
    const color = attribute(decals.mesh, 'iColor');
    decals.update(130);
    expect(color[slot * 4 + 3]).toBeCloseTo(0.9, 5);
    decals.update(165);
    expect(color[slot * 4 + 3]).toBeCloseTo(0.45, 5);
    expect(decals.active).toBe(1);
    decals.update(171);
    expect(decals.active).toBe(0);
    expect(color[slot * 4 + 3]).toBe(0);
    decals.update(172);
    expect(decals.mesh.visible).toBe(false);
  });

  it('keeps a decal laid at any moment of the clock (no rounding makes it born in the future)', () => {
    const decals = new Decals([64]);
    const style: DecalStyle = { ...DECAL_BLOOD_SPATTER, ring: 0 };
    let now = 1234.5;
    for (let i = 0; i < 40; i++) {
      now += 1 / 60 + i * 1e-5;
      decals.add(style, now, at(i), up, null, 0.3, 0.3);
      decals.update(now);
    }
    expect(decals.active).toBe(40);
  });

  it('a pool grows from small to full size', () => {
    const decals = new Decals([4]);
    const style: DecalStyle = { ...DECAL_BLOOD_POOL, ring: 0 };
    const slot = decals.add(style, 0, at(0), up, new THREE.Vector3(1, 0, 0), 0.8, 0.6);
    const u = attribute(decals.mesh, 'iU');
    const v = attribute(decals.mesh, 'iV');
    const lengthU = () => Math.hypot(u[slot * 3], u[slot * 3 + 1], u[slot * 3 + 2]);
    const first = lengthU();
    expect(first).toBeCloseTo(0.8 * style.growFrom, 5);
    decals.update(style.grow / 2);
    const mid = lengthU();
    expect(mid).toBeGreaterThan(first);
    expect(mid).toBeLessThan(0.8);
    decals.update(style.grow + 1);
    expect(lengthU()).toBeCloseTo(0.8, 5);
    // Axes lie in the surface, at right angles, the first along the requested direction.
    expect(u[slot * 3 + 1]).toBeCloseTo(0, 6);
    expect(u[slot * 3]).toBeCloseTo(0.8, 5);
    expect(u[slot * 3] * v[slot * 3] + u[slot * 3 + 2] * v[slot * 3 + 2]).toBeCloseTo(0, 6);
    expect(Math.hypot(v[slot * 3], v[slot * 3 + 2])).toBeCloseTo(0.6, 5);
    // Lifted just clear of the ground.
    expect(attribute(decals.mesh, 'iPos')[slot * 3 + 1]).toBeCloseTo(style.lift, 6);
  });

  it('a pock rides on its vehicle and goes when the vehicle does', () => {
    const decals = new Decals([4]);
    const style: DecalStyle = { ...DECAL_POCK, ring: 0 };
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const vehicle = { position: new THREE.Vector3(10, 1, 0), group } as unknown as Vehicle;
    // On the left flank (+x side) of a car facing +z.
    const slot = decals.add(style, 0, new THREE.Vector3(10.9, 1.2, 0.5), new THREE.Vector3(1, 0, 0), null, 0.03, 0.03);
    decals.attach(slot, vehicle);
    const pos = attribute(decals.mesh, 'iPos');
    // The car drives off and turns a quarter left (its +z now points along world +x).
    vehicle.position.set(50, 1, 20);
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    decals.update(1);
    // Local (0.9 + lift, 0.2, 0.5) rotated: x' = z, z' = -x.
    expect(pos[slot * 3]).toBeCloseTo(50.5, 4);
    expect(pos[slot * 3 + 1]).toBeCloseTo(1.2, 4);
    expect(pos[slot * 3 + 2]).toBeCloseTo(20 - 0.9 - style.lift, 4);
    group.removeFromParent();
    decals.update(2);
    expect(decals.active).toBe(0);
  });
});

describe('FlashLights', () => {
  it('keeps two lights in the scene for good and fades each flash to nothing', () => {
    const scene = new THREE.Scene();
    const lights = new FlashLights(scene, 2);
    const inScene = () => scene.children.filter((c) => (c as THREE.PointLight).isPointLight) as THREE.PointLight[];
    expect(inScene()).toHaveLength(2);
    expect(inScene().every((l) => l.intensity === 0)).toBe(true);
    expect(lights.flash(1, 2, 3, 0xffffff, 50, 12, 0.1)).toBe(true);
    expect(inScene().filter((l) => l.intensity > 0)).toHaveLength(1);
    lights.update(0.05);
    const lit = inScene().find((l) => l.intensity > 0)!;
    expect(lit.intensity).toBeCloseTo(12.5, 5); // quadratic fade: half-way through = a quarter
    expect(lit.position.toArray()).toEqual([1, 2, 3]);
    lights.update(0.06);
    expect(inScene().every((l) => l.intensity === 0)).toBe(true);
    expect(inScene()).toHaveLength(2);
  });

  it('never lights more than two, and a bright blast is not bumped by a small flash', () => {
    const scene = new THREE.Scene();
    const lights = new FlashLights(scene, 2);
    expect(lights.flash(0, 0, 0, 0xffffff, 1000, 40, 0.5)).toBe(true);
    expect(lights.flash(5, 0, 0, 0xffffff, 900, 40, 0.5)).toBe(true);
    expect(lights.flash(9, 0, 0, 0xffffff, 50, 12, 0.07)).toBe(false);
    const lit = scene.children.filter((c) => (c as THREE.PointLight).isPointLight && (c as THREE.PointLight).intensity > 0);
    expect(lit).toHaveLength(2);
    // Once they have died down, a muzzle flash gets a light again.
    lights.update(0.48);
    expect(lights.flash(9, 0, 0, 0xffffff, 50, 12, 0.07)).toBe(true);
  });
});
