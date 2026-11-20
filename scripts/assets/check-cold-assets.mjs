// Validate the shipped files, not just the inputs to the baker.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';

const assets = new URL('../../src/assets/', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, assets)));
const manifest = await json('textures/manifest.json');
const maps = Object.values(manifest.surfaces).flatMap(s => [s.map, s.normalMap, s.roughnessMap]);
maps.push(...(await readdir(new URL('textures/ground/', assets))).filter(f => f.endsWith('.jpg')).map(f => 'ground/' + f));
let phoneBytes = 0, desktopBytes = 0;
for (const file of new Set(maps)) {
  const bytes = await readFile(new URL('phone-textures/' + file, assets));
  const { width, height } = await sharp(bytes).metadata();
  assert.equal(width, file.endsWith('_rgh.jpg') ? 256 : 512, file);
  assert.equal(width, height, file);
  phoneBytes += bytes.length;
  desktopBytes += (await stat(new URL('textures/' + file, assets))).size;
}
assert.ok(phoneBytes < 4 * 1024 ** 2 && phoneBytes < desktopBytes * 0.4, 'phone surface byte budget');

const main = await json('foliage/atlas.json'), strip = await json('foliage/extra.json');
const cells = [...Object.values(main.cells), ...Object.values(strip.cells).map(c => ({ ...c, y: c.y + main.size }))];
const alpha = async file => sharp(await readFile(new URL(file, assets))).extractChannel('alpha').raw().toBuffer();
const source = Buffer.concat([await alpha('foliage/' + main.file), await alpha('foliage/' + strip.file)]);
function coverage(data, stride, c, level) {
  let pass = 0, count = 0;
  for (let y = c.y >> level; y < (c.y + c.h) >> level; y++) {
    for (let x = c.x >> level; x < (c.x + c.w) >> level; x++) {
      pass += Number(data[y * stride + x] >= 128);
      count++;
    }
  }
  return pass / count;
}
const reference = cells.map(c => coverage(source, main.size, c, 0));
let mipBytes = 0, phoneMipBytes = 0, maxError = 0, rgbaBytes = 0;
for (let i = 0;; i++) {
  const width = Math.max(1, main.size >> i), height = Math.max(1, (main.size + strip.height) >> i);
  const file = `foliage/mips/leaf-${i}.webp`;
  const bytes = await readFile(new URL(file, assets));
  const { data, info } = await sharp(bytes).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [width, height], file);
  for (const [j, c] of cells.entries()) {
    // A handful of pixels cannot represent an arbitrary fraction of a cell.
    if ((c.w >> i) * (c.h >> i) < 64) continue;
    const error = Math.abs(coverage(data, width, c, i) - reference[j]);
    maxError = Math.max(maxError, error);
    assert.ok(error < 0.04, `${file} cell ${j}: coverage drift ${error}`);
  }
  mipBytes += bytes.length;
  if (i) { phoneMipBytes += bytes.length; rgbaBytes += width * height * 4; }
  if (width === 1 && height === 1) break;
}
assert.ok(phoneMipBytes < 1024 ** 2 && rgbaBytes < 7 * 1024 ** 2, 'phone foliage budget');
console.log({ desktopBytes, phoneBytes, mipBytes, phoneMipBytes, phoneMipRGBA8: rgbaBytes, maxCoverageDrift: maxError });
