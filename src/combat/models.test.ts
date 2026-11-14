import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../core/types';
import { HAND_FIT, WeaponModels } from './models';
import { feelOf, isLongGun, isRanged, WEAPON_FEEL, WEAPON_ORDER, WEAPONS } from './weapons';

/** A material library that needs no canvas: one plain material per distinct request. */
function fakeMaterials(): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  return {
    get(surface: string, options: object = {}) {
      const key = surface + JSON.stringify(options);
      let m = cache.get(key);
      if (!m) cache.set(key, (m = new THREE.MeshStandardMaterial()));
      return m;
    },
  } as unknown as MaterialLibrary;
}

const bounds = (object: THREE.Object3D) => {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
};

describe('weapon data', () => {
  const byId = new Map(WEAPONS.map((w) => [w.id, w]));

  it('is exactly the five contract weapons, in cycling order', () => {
    expect(WEAPONS.map((w) => w.id)).toEqual(['fists', 'bat', 'pistol', 'shotgun', 'rifle']);
    expect([...WEAPON_ORDER]).toEqual(WEAPONS.map((w) => w.id));
    expect(Object.keys(WEAPON_FEEL).sort()).toEqual([...WEAPON_ORDER].sort());
  });

  it('only the pistol can be fired from a vehicle, and nothing is automatic', () => {
    expect(WEAPONS.filter((w) => w.driveBy).map((w) => w.id)).toEqual(['pistol']);
    expect(WEAPONS.some((w) => w.automatic)).toBe(false);
  });

  it('melee weapons have no magazine; guns have one, a reload time and a price', () => {
    for (const w of WEAPONS) {
      expect(w.damage).toBeGreaterThan(0);
      expect(w.rate).toBeGreaterThan(0);
      expect(w.pellets).toBeGreaterThanOrEqual(1);
      if (isRanged(w)) {
        expect(w.magazine).toBeGreaterThan(0);
        expect(w.reloadTime).toBeGreaterThan(0);
        expect(w.price).toBeGreaterThan(0);
        expect(feelOf(w.id).pickupAmmo).toBeGreaterThan(0);
        expect(feelOf(w.id).maxReserve).toBeGreaterThanOrEqual(w.magazine);
      } else {
        expect(w.magazine).toBe(0);
        expect(w.range).toBeLessThan(3);
      }
    }
    expect(byId.get('fists')!.price).toBe(0);
    expect(isRanged(byId.get('bat')!)).toBe(false);
    expect(byId.get('bat')!.damage).toBeGreaterThan(byId.get('fists')!.damage);
  });

  it('gives each gun its role: shotgun short and wide, rifle slow, accurate and long', () => {
    const pistol = byId.get('pistol')!;
    const shotgun = byId.get('shotgun')!;
    const rifle = byId.get('rifle')!;
    expect(shotgun.pellets).toBeGreaterThan(1);
    expect(shotgun.range).toBeLessThan(pistol.range);
    expect(shotgun.spread).toBeGreaterThan(pistol.spread);
    expect(rifle.range).toBeGreaterThan(pistol.range * 2);
    expect(rifle.spread).toBeLessThan(pistol.spread);
    expect(rifle.rate).toBeLessThan(shotgun.rate);
    expect(rifle.damage).toBeGreaterThan(pistol.damage);
    expect(isLongGun(rifle) && isLongGun(shotgun)).toBe(true);
    expect(isLongGun(pistol)).toBe(false);
    expect(feelOf('nonsense')).toBe(WEAPON_FEEL.fists);
  });
});

describe('WeaponModels', () => {
  it('has nothing to hold for fists or unknown ids', () => {
    const models = new WeaponModels(fakeMaterials());
    expect(models.held('fists')).toBeNull();
    expect(models.held('bazooka')).toBeNull();
    expect(models.display('fists')).toBeNull();
  });

  it('builds every other weapon pointing along +z from a grip at the origin', () => {
    const models = new WeaponModels(fakeMaterials());
    const lengths: Record<string, number> = {};
    for (const id of ['bat', 'pistol', 'shotgun', 'rifle']) {
      const model = models.display(id)!;
      expect(model).toBeInstanceOf(THREE.Object3D);
      const box = bounds(model);
      // The business end reaches further forward than the butt reaches back, and the grip is inside.
      expect(box.max.z).toBeGreaterThan(-box.min.z);
      expect(box.min.z).toBeLessThan(0);
      expect(box.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
      // Slim: nothing sticks out sideways.
      expect(box.max.x - box.min.x).toBeLessThan(0.16);
      lengths[id] = box.max.z - box.min.z;
      // The stated barrel length is about where the muzzle is.
      if (id !== 'bat') expect(Math.abs(box.max.z - feelOf(id).barrel)).toBeLessThan(0.08);
    }
    expect(lengths.pistol).toBeLessThan(0.35);
    expect(lengths.bat).toBeGreaterThan(0.8);
    expect(lengths.bat).toBeLessThan(1);
    expect(lengths.shotgun).toBeGreaterThan(0.9);
    expect(lengths.rifle).toBeGreaterThan(0.9);
    expect(lengths.rifle).toBeLessThan(1.3);
  });

  it('hands guns out lying along the forearm, and the bat tipped up', () => {
    const models = new WeaponModels(fakeMaterials());
    for (const id of ['pistol', 'shotgun', 'rifle']) {
      expect(HAND_FIT[id].tilt).toBe(0);
      const held = models.held(id)!;
      expect(held.quaternion.equals(new THREE.Quaternion())).toBe(true);
      expect(held.children).toHaveLength(1);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(held.children[0].quaternion);
      expect(forward.angleTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
    }
    const bat = models.held('bat')!;
    const tip = new THREE.Vector3(0, 0, 1).applyQuaternion(bat.children[0].quaternion);
    expect(tip.y).toBeGreaterThan(0.5); // towards +y: up when the arm is raised
    expect(tip.z).toBeGreaterThan(0.3);
    expect(Math.abs(tip.x)).toBeLessThan(1e-6);
  });

  it('shares geometry between instances and keeps the mesh count small', () => {
    const models = new WeaponModels(fakeMaterials());
    const a = models.held('rifle')!;
    const b = models.held('rifle')!;
    expect(a).not.toBe(b);
    const meshes = (o: THREE.Object3D) => {
      const list: THREE.Mesh[] = [];
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) list.push(c as THREE.Mesh);
      });
      return list;
    };
    const ma = meshes(a);
    const mb = meshes(b);
    expect(ma.length).toBeGreaterThan(0);
    expect(ma.length).toBeLessThanOrEqual(4);
    ma.forEach((m, i) => expect(m.geometry).toBe(mb[i].geometry));
  });

  it('builds the three pickup models', () => {
    const models = new WeaponModels(fakeMaterials());
    for (const kind of ['health', 'armour', 'cash'] as const) {
      const size = bounds(models.pickup(kind)).getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.25);
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.7);
    }
  });
});
