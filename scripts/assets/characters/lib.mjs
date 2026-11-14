// Shared helpers for the character asset scripts.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Read a .glb or .gltf. The Quaternius .gltf files reference a couple of images under names that are not
 * in the zip ("T_Eye_Normal_png.png"); those fall back to the same name without "_png", or are dropped.
 */
export async function readModel(file) {
  if (file.endsWith('.glb')) return io.read(file);
  const dir = path.dirname(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = {};
  for (const b of json.buffers ?? []) if (b.uri) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))));
  for (const img of json.images ?? []) {
    if (!img.uri) continue;
    const candidates = [img.uri, img.uri.replace('_png.png', '.png')];
    const found = candidates.map((c) => path.join(dir, decodeURIComponent(c))).find((p) => fs.existsSync(p));
    resources[img.uri] = found ? new Uint8Array(fs.readFileSync(found)) : new Uint8Array(0);
  }
  return io.readJSON({ json, resources });
}
