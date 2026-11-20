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

  it('is exactly the seven contract weapons, in cycling order', () => {
    expect(WEAPONS.map((w) => w.id)).toEqual(['fists', 'knife', 'bat', 'katana', 'pistol', 'shotgun', 'rifle']);
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

  it('the knife is quick and short, the katana the best thing there is to swing, and only they are blades', () => {
    const fists = byId.get('fists')!;
    const knife = byId.get('knife')!;
    const bat = byId.get('bat')!;
    const katana = byId.get('katana')!;
    expect(WEAPONS.filter((w) => w.blade).map((w) => w.id)).toEqual(['knife', 'katana']);
    for (const w of [knife, katana]) expect(w.kind).toBe('melee');
    // The knife: between a fist and the bat for hurt, quicker than either, and no longer than the arm behind it.
    expect(knife.damage).toBeGreaterThanOrEqual(24);
    expect(knife.damage).toBeLessThanOrEqual(28);
    expect(knife.rate).toBeGreaterThan(fists.rate);
    expect(knife.range).toBeLessThan(bat.range);
    expect(knife.range).toBeGreaterThanOrEqual(fists.range);
    // The katana: the longest reach and the most damage of anything swung; slower than the knife, quicker than the bat.
    expect(katana.damage).toBeGreaterThanOrEqual(50);
    expect(katana.damage).toBeLessThanOrEqual(60);
    for (const w of WEAPONS) if (!isRanged(w) && w !== katana) expect(katana.damage * katana.rate, w.id).toBeGreaterThan(w.damage * w.rate);
    expect(katana.range).toBeGreaterThan(bat.range);
    expect(katana.rate).toBeLessThan(knife.rate);
    expect(katana.rate).toBeGreaterThan(bat.rate);
    // A blade draws more blood than the bat.
    expect(feelOf('knife').blood).toBeGreaterThan(feelOf('bat').blood);
    expect(feelOf('katana').blood).toBeGreaterThan(feelOf('knife').blood);
    // The knife is sold over the counter for less than the bat; the katana is not for sale anywhere.
    expect(knife.price).toBeGreaterThan(0);
    expect(knife.price).toBeLessThan(bat.price);
    expect(katana.price).toBe(0);
    // The names say what they are (docs/CONTRACT.md rule 6: no brands).
    expect(knife.name).toBe('Boning Knife');
    expect(katana.name).toBe('Katana');
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
    for (const id of ['knife', 'bat', 'katana', 'pistol', 'shotgun', 'rifle']) {
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
      if (isRanged(WEAPONS.find((w) => w.id === id)!)) expect(Math.abs(box.max.z - feelOf(id).barrel)).toBeLessThan(0.08);
    }
    expect(lengths.pistol).toBeLessThan(0.35);
    expect(lengths.bat).toBeGreaterThan(0.8);
    expect(lengths.bat).toBeLessThan(1);
    expect(lengths.shotgun).toBeGreaterThan(0.9);
    expect(lengths.rifle).toBeGreaterThan(0.9);
    expect(lengths.rifle).toBeLessThan(1.3);
    // A knife for the hand (drawn a little over size, like the pistol) and a sword a metre long.
    expect(lengths.knife).toBeGreaterThan(0.28);
    expect(lengths.knife).toBeLessThan(0.45);
    expect(lengths.katana).toBeGreaterThan(0.9);
    expect(lengths.katana).toBeLessThan(1.1);
  });

  it('a blade is a blade: thin, edge down, most of its length in front of the hand, curving up to the point', () => {
    const models = new WeaponModels(fakeMaterials());
    for (const [id, bladeFrom, handle] of [['knife', 0.09, 0.2], ['katana', 0.07, 0.3]] as const) {
      const model = models.display(id)!;
      const box = bounds(model);
      // The handle is behind and around the hand; the blade is the longer part.
      expect(-box.min.z, id).toBeLessThan(handle);
      expect(box.max.z, id).toBeGreaterThan(-box.min.z * 1.5);
      // Steel in front of the guard is thin from side to side, and the point sits above the line of the grip.
      let thick = 0;
      let tipY = 0;
      let tipZ = -Infinity;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const at = mesh.geometry.getAttribute('position');
        for (let i = 0; i < at.count; i++) {
          if (at.getZ(i) > bladeFrom + 0.04) thick = Math.max(thick, Math.abs(at.getX(i)));
          if (at.getZ(i) > tipZ) {
            tipZ = at.getZ(i);
            tipY = at.getY(i);
          }
        }
      });
      expect(thick, id).toBeGreaterThan(0);
      expect(thick, id).toBeLessThan(0.006);
      expect(tipY, id).toBeGreaterThan(0.004);
    }
  });

  it('hands guns out lying along the forearm, and what is swung tipped up out of the fist: never held like a gun', () => {
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
    // The blades: the sword as far up as the bat (it has to clear the ground beside a hanging arm), the
    // knife less (a jab leads with the point), both well off the forearm line a gun lies on.
    for (const id of ['knife', 'katana']) {
      const held = models.held(id)!;
      expect(held.name).toBe(`weapon:${id}`);
      const point = new THREE.Vector3(0, 0, 1).applyQuaternion(held.children[0].quaternion);
      expect(point.angleTo(new THREE.Vector3(0, 0, 1)), id).toBeGreaterThan(0.4);
      expect(point.y, id).toBeGreaterThan(0.4);
      expect(point.z, id).toBeGreaterThan(0.3);
      expect(Math.abs(point.x), id).toBeLessThan(1e-6);
      // The edge leads the swing: it faces forward and down, away from the knuckles' top.
      const edge = new THREE.Vector3(0, -1, 0).applyQuaternion(held.children[0].quaternion);
      expect(edge.z, id).toBeGreaterThan(0.4);
    }
    expect(HAND_FIT.katana.tilt).toBeGreaterThanOrEqual(HAND_FIT.bat.tilt);
    expect(HAND_FIT.knife.tilt).toBeLessThan(HAND_FIT.bat.tilt);
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
    // One mesh per material, for every weapon: two for the knife (handle, steel), four for the sword.
    expect(meshes(models.held('knife')!)).toHaveLength(2);
    expect(meshes(models.held('katana')!)).toHaveLength(4);
    for (const id of WEAPON_ORDER) if (id !== 'fists') expect(meshes(models.held(id)!).length, id).toBeLessThanOrEqual(4);
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
