// Dump the structure of a glTF/GLB: node tree, skins, meshes, materials, textures, animations.
// usage: node scripts/assets/characters/inspect.mjs <file> [--anims] [--nodes]
import { getBounds } from '@gltf-transform/functions';
import { readModel } from './lib.mjs';

const [file, ...flags] = process.argv.slice(2);
const doc = await readModel(file);
const root = doc.getRoot();
console.log('extensions:', root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || '-');
for (const scene of root.listScenes()) {
  const b = getBounds(scene);
  console.log('scene', scene.getName(), 'bounds', b.min.map((v) => v.toFixed(3)), b.max.map((v) => v.toFixed(3)));
}
console.log('meshes:');
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const attrs = prim.listSemantics().map((s) => `${s}:${prim.getAttribute(s).getType()}/${prim.getAttribute(s).getComponentType()}`);
    console.log(`  ${mesh.getName()} verts=${prim.getAttribute('POSITION').getCount()} tris=${(prim.getIndices()?.getCount() ?? 0) / 3} mat=${prim.getMaterial()?.getName()} targets=${prim.listTargets().length} [${attrs.join(' ')}]`);
  }
}
console.log('materials:');
for (const m of root.listMaterials()) {
  console.log(`  ${m.getName()} base=${m.getBaseColorFactor().map((v) => v.toFixed(2))} map=${m.getBaseColorTexture()?.getURI() || m.getBaseColorTexture()?.getName()} normal=${m.getNormalTexture()?.getURI() || m.getNormalTexture()?.getName()} orm=${m.getMetallicRoughnessTexture()?.getURI() || m.getMetallicRoughnessTexture()?.getName()} rough=${m.getRoughnessFactor()} metal=${m.getMetallicFactor()} alpha=${m.getAlphaMode()} ds=${m.getDoubleSided()}`);
}
console.log('textures:');
for (const t of root.listTextures()) console.log(`  ${t.getName()} ${t.getURI()} ${t.getMimeType()} ${t.getSize()?.join('x')} ${(t.getImage()?.byteLength / 1024).toFixed(0)}KB`);
console.log('skins:');
for (const s of root.listSkins()) console.log(`  ${s.getName()} joints=${s.listJoints().length} skeleton=${s.getSkeleton()?.getName()}`);
if (flags.includes('--nodes')) {
  const walk = (n, d) => {
    const t = n.getTranslation().map((v) => v.toFixed(4));
    const r = n.getRotation().map((v) => v.toFixed(4));
    const s = n.getScale().map((v) => v.toFixed(3));
    console.log(`${'  '.repeat(d)}${n.getName()}${n.getMesh() ? ' [mesh ' + n.getMesh().getName() + ']' : ''}${n.getSkin() ? ' [skin]' : ''} t=${t} r=${r} s=${s}`);
    for (const c of n.listChildren()) walk(c, d + 1);
  };
  for (const scene of root.listScenes()) for (const n of scene.listChildren()) walk(n, 0);
}
const anims = root.listAnimations();
console.log('animations:', anims.length);
if (flags.includes('--anims')) {
  for (const a of anims) {
    let dur = 0;
    const paths = { translation: 0, rotation: 0, scale: 0, weights: 0 };
    let keys = 0;
    for (const ch of a.listChannels()) {
      const s = ch.getSampler();
      const input = s.getInput();
      dur = Math.max(dur, input.getMax([])[0]);
      paths[ch.getTargetPath()]++;
      keys = Math.max(keys, input.getCount());
    }
    console.log(`  ${a.getName().padEnd(34)} ${dur.toFixed(2)}s keys=${keys} T=${paths.translation} R=${paths.rotation} S=${paths.scale}`);
  }
}
