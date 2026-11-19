#!/usr/bin/env node
// A contact sheet of every vehicle in the roster, each tile captioned with its invented name and the real
// 1995 vehicle it stands for (docs/CONTRACT.md table). Needs the dev server on port 5195.
//
//   node scripts/roster-sheet.mjs                        # shoots every vehicle, writes shots/roster/*.jpg
//   node scripts/roster-sheet.mjs --sheet-only           # recompose shots/roster/sheet.jpg from existing tiles
//   node scripts/roster-sheet.mjs --only corolla,police  # just these ids
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

/** id → [invented name, real vehicle]. Kept in step with docs/CONTRACT.md by hand. */
const ROSTER = [
  ['statesman', 'Holbrook Chancellor', 'Holden Commodore VN, 1988-91'],
  ['kingswood', 'Holbrook Wentworth', 'Holden Kingswood HQ-HZ, 1971-80'],
  ['v8sedan', 'Lachlan Taipan 5.0', 'Ford Falcon XD/XE V8, 1979-84'],
  ['wagon', 'Lachlan Homestead', 'Ford Falcon XF wagon, 1984-88'],
  ['taxi', 'Lachlan Bannerman', 'Ford Falcon XF taxi'],
  ['cortina', 'Lachlan Marlow', 'Ford Cortina Mk IV/V, 1976-83'],
  ['valiant', 'Carrington Valour', 'Chrysler Valiant, early 1970s'],
  ['triumph', 'Stanmore Cavalcade', 'Triumph 2500, to 1979'],
  ['mini', 'Pemberton Pip', 'Mini, 1960s-70s'],
  ['corolla', 'Hinode Verity', 'Toyota Corolla AE82, 1983-87'],
  ['corona', 'Hinode Regent', 'Toyota Corona T140, 1982-87'],
  ['sigma', 'Kashima Meridian', 'Mitsubishi Sigma, 1980-87'],
  ['accord', 'Kiyose Accolade', 'Honda Accord, 1985-89'],
  ['datsun', 'Sagami Sparrow 1200', 'Datsun 120Y, 1973-78'],
  ['hatch', 'Lachlan Wren 1.3', 'Ford Laser KA/KB, 1981-85'],
  ['leone', 'Tanzawa Snowline 4WD', 'Subaru Leone 4WD wagon, 1979-84'],
  ['import', 'Hinode Emissary', 'Toyota Cresta GX71 import, 1984-88'],
  ['coupe', 'Sagami Altair Turbo', 'Nissan Skyline R32 import, 1989-93'],
  ['hothatch', 'Minato Kaze Turbo', 'Mazda Familia BF turbo import'],
  ['lada', 'Zarya 1500', 'Lada Riva, Dairy Board trade'],
  ['ute', 'Hinode Tussock', 'Toyota Hilux, 1983-88'],
  ['landrover', 'Pemberton Uplander', 'Land Rover Series III'],
  ['van', 'Hinode Bento', 'Toyota Hiace H50, 1982-89'],
  ['farmtruck', 'Pemberton Drayman', 'Bedford TK, timber stock crate'],
  ['stocktruck', 'Tateyama Hauler', 'Hino-class stock truck, late 80s'],
  ['bus', 'Brenner Townliner', 'MAN SL202, red and white'],
  ['bike', 'Akagi Raijin 750', 'Suzuki GSX-R750 class'],
  ['farmbike', 'Kiyose Trailhand 200', 'Honda XR200 class farm bike'],
  ['police', 'Holbrook Chancellor Police', 'Holden Commodore VR, 1995 livery'],
  ['trafficcar', 'Kashima V30 Police', 'Mitsubishi V3000 ex-MoT, 1988-92'],
];

const argv = process.argv.slice(2);
const sheetOnly = argv.includes('--sheet-only');
const onlyArg = argv.indexOf('--only');
const only = onlyArg >= 0 ? argv[onlyArg + 1].split(',') : null;
const outDir = 'shots/roster';
mkdirSync(outDir, { recursive: true });

const rows = ROSTER.filter(([id]) => !only || only.includes(id));
if (!sheetOnly) {
  for (const [id] of rows) {
    const out = `${outDir}/${id}.jpg`;
    // Three-quarter front view, mid-afternoon, same spot every time so the sheet compares like with like.
    execFileSync('node', ['scripts/shot.mjs', '--car', id, '--place', 'four-aves-start', '--time', '15', '--look', '0.9,0.1,0.62', '--size', '960x540', '--out', out], { stdio: 'inherit' });
  }
}

const W = 480;
const H = 270;
const CAP = 46;
const COLS = 5;
const tiles = [];
for (let i = 0; i < rows.length; i++) {
  const [id, name, real] = rows[i];
  const file = `${outDir}/${id}.jpg`;
  if (!existsSync(file)) {
    console.warn(`missing ${file}, skipped`);
    continue;
  }
  const img = await sharp(file).resize(W, H).toBuffer();
  const caption = Buffer.from(
    `<svg width="${W}" height="${CAP}"><rect width="${W}" height="${CAP}" fill="#14130f"/>` +
      `<text x="10" y="18" font-family="Helvetica, Arial" font-size="15" font-weight="bold" fill="#f2ead6">${name}</text>` +
      `<text x="10" y="37" font-family="Helvetica, Arial" font-size="13" fill="#b8ad8f">${real} · ${id}</text></svg>`,
  );
  const tile = await sharp({ create: { width: W, height: H + CAP, channels: 3, background: '#14130f' } })
    .composite([
      { input: img, top: 0, left: 0 },
      { input: await sharp(caption).png().toBuffer(), top: H, left: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
  tiles.push(tile);
}
const colCount = Math.min(COLS, tiles.length);
const rowCount = Math.ceil(tiles.length / colCount);
const sheet = sharp({ create: { width: colCount * W, height: rowCount * (H + CAP), channels: 3, background: '#14130f' } });
await sheet
  .composite(tiles.map((input, i) => ({ input, left: (i % colCount) * W, top: Math.floor(i / colCount) * (H + CAP) })))
  .jpeg({ quality: 86 })
  .toFile(`${outDir}/sheet.jpg`);
console.log(`${tiles.length} tiles -> ${outDir}/sheet.jpg`);
