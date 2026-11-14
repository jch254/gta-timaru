import { TerrainModel } from '../height';
import type { Author } from './helpers';

/** Port Hills crest line (west → east). The Summit Road, the passes and the tunnel are laid out against it. */
export const CREST: [number, number][] = [
  [-150, -2830],
  [400, -2815],
  [1000, -2790],
  [1500, -2800],
  [2000, -2780],
  [2600, -2805],
];

/** Coast, harbours, hills and downs. Everything else is the (nearly flat) plain from the terrain model. */
export function buildTerrain(a: Author) {
  const t = a.b.terrain;

  // East coast, north → south: Pegasus Bay, the peninsula, then the long curve of the Canterbury Bight.
  t.coast.push(
    [-6144, 2760],
    [-5000, 2690],
    [-4400, 2620],
    [-3700, 2650],
    [-3000, 2780],
    [-2250, 2760],
    [-1500, 2540],
    [-600, 2360],
    [300, 2150],
    [1700, 1750],
    [2900, 1350],
    [3600, 1090],
    [4100, 860],
    [4400, 730],
    [4700, 700],
    [5000, 740],
    [5300, 760],
    [6144, 640],
  );

  t.flats.push({ name: 'Christchurch', x: 150, z: -4300, r: 1700, height: 8 });
  t.flats.push({ name: 'Ashburton', x: -1190, z: 320, r: 520, height: 15 });

  // Port Hills: one long ridge with the two named tops standing above the passes.
  t.ridges.push({ name: 'Port Hills', pts: CREST, height: 140, width: 440, rough: 0.07 });
  // The far side of Lyttelton Harbour (the Mount Herbert side of Banks Peninsula): scenery only.
  t.ridges.push({ name: 'Banks Peninsula', pts: [[1250, -1830], [1900, -1780], [2600, -1810]], height: 135, width: 330, rough: 0.3 });
  // Timaru sits on the toe of old lava flows: the town falls east to the sea.
  t.ridges.push({ name: 'Timaru hill', pts: [[110, 4420], [150, 5000], [90, 5750]], height: 22, width: 540, rough: 0.08 });

  t.inlets.push({ name: 'Lyttelton Harbour', x: 2150, z: -2115, rx: 1150, rz: 215 });
  t.inlets.push({ name: 'Avon-Heathcote Estuary', x: 2520, z: -3780, rx: 330, rz: 230 });
  t.inlets.push({ name: 'Caroline Bay', x: 900, z: 4650, rx: 230, rz: 200 });

  // Lyttelton's reclaimed wharves.
  t.moles.push({ name: 'Lyttelton wharves', x: 1620, z: -2262, rx: 340, rz: 112, height: 3 });
  // Timaru's artificial harbour: reclamation, the north mole and the eastern extension.
  t.moles.push({ name: 'Port reclamation', x: 770, z: 5130, rx: 320, rz: 170, height: 4.2 });
  t.moles.push({ name: 'North Mole', x: 860, z: 4830, rx: 265, rz: 30, height: 4.4 });
  t.moles.push({ name: 'Eastern Extension', x: 1092, z: 4915, rx: 30, rz: 112, height: 4.4 });
  // The apron between the mole and the reclamation, so Port Loop Road stays at wharf level.
  t.moles.push({ name: 'Port apron', x: 668, z: 4915, rx: 62, rz: 84, height: 4.3 });
  t.moles.push({ name: 'No. 1 Wharf apron', x: 676, z: 4925, rx: 86, rz: 96, height: 4.3 });

  t.downs.push({ name: 'Timaru downs', x: -560, z: 5050, r: 1180, amp: 20, wavelength: 420 });
  t.downs.push({ name: 'Geraldine downs', x: -2500, z: 2700, r: 700, amp: 26, wavelength: 380 });

  // Hill roads are laid out against the finished landform.
  const model = new TerrainModel(t);
  a.natural = (x, z) => model.natural(x, z);
}
