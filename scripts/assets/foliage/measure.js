// For `node scripts/shot.mjs ... --eval "$(cat scripts/assets/foliage/measure.js)"`: what the plants in view cost.
// Draw calls and triangles are averaged over 40 frames (the shadow cascades take turns, so single frames differ)
// with the plant field running, and again with every plant handed back to the world's own instanced meshes
// (each kind's first shape in full at any distance, which is how plants were drawn before the field existed).
const { plantField } = await import('/src/world/props/foliage.ts');
const sample = async () => {
  let calls = 0;
  let tris = 0;
  const n = 40;
  for (let i = 0; i < n; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const s = dev.stats();
    calls += s.calls;
    tris += s.tris;
  }
  return { calls: Math.round(calls / n), tris: Math.round(tris / n) };
};
await sleep(3000);
const field = await sample();
const census = plantField.census();
plantField.suspend();
await sleep(500);
const plain = await sample();
plantField.resume();
await sleep(500);
return { field, plain, census };
