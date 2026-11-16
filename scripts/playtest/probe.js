// Scene watchdog for glitch hunts: every few frames, looks for things that could draw as a huge or broken
// shape, and collects what it finds in window.__probe.found (deduplicated by kind and object name).
//   node scripts/shot.mjs … --eval "$(cat scripts/playtest/probe.js)"      then read window.__probe.report()
// Checked: non-finite camera or world matrices; visible meshes of implausible size that are not the known big
// ones (terrain, sea, sky, Alps); instanced meshes drawing more instances than they hold or holding non-finite
// instance matrices; skinned meshes whose bones are non-finite or far from the mesh; figure shadow stand-ins
// whose draw range was left open after the colour pass.
const ctx = dev.ctx;
const THREE_OK = (m) => {
  const e = m.elements;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) return false;
  return true;
};
const probe = (window.__probe = { found: new Map(), frames: 0, checks: 0 });
const note = (kind, o, extra) => {
  const key = kind + '|' + (o.name || o.type) + '|' + (o.parent?.name || '');
  const hit = probe.found.get(key);
  if (hit) hit.n++;
  else probe.found.set(key, { kind, name: o.name || o.type, parent: o.parent?.name || o.parent?.type, extra, n: 1, frame: probe.frames });
};
const big = /terrain|far|sea|sky|alps|water|dome|backdrop|rain|cloud/i;
const check = () => {
  probe.checks++;
  if (!THREE_OK(ctx.camera.matrixWorld)) note('camera-nan', ctx.camera);
  const eye = ctx.camera.position;
  ctx.scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    if (!THREE_OK(o.matrixWorld)) return note('matrix-nan', o);
    const g = o.geometry;
    if (o.isInstancedMesh) {
      const cap = o.instanceMatrix.count;
      if (o.count > cap) note('instances-over', o, `${o.count}/${cap}`);
      const a = o.instanceMatrix.array;
      const n = Math.min(o.count, cap) * 16;
      for (let i = 0; i < n; i += 5) {
        if (!Number.isFinite(a[i])) {
          note('instance-nan', o, i >> 4);
          break;
        }
      }
    }
    if (o.isSkinnedMesh && o.skeleton) {
      const b = o.skeleton.boneMatrices;
      const e = o.matrixWorld.elements;
      for (let i = 0; b && i < b.length; i += 16) {
        if (!Number.isFinite(b[i]) || !Number.isFinite(b[i + 12])) {
          note('bone-nan', o);
          break;
        }
      }
      const root = o.skeleton.bones[0];
      if (root) {
        const r = root.matrixWorld.elements;
        const d = Math.hypot(r[12] - e[12], r[13] - e[13], r[14] - e[14]);
        if (d > 30) note('bones-far', o, Math.round(d));
      }
      if (o.material?.colorWrite === false && g.drawRange.count !== 0) note('standin-range-open', o, g.drawRange.count);
    }
    const s = o.boundingSphere || g?.boundingSphere;
    if (s && !o.isInstancedMesh) {
      const e = o.matrixWorld.elements;
      const scale = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
      const r = s.radius * scale;
      const tag = (o.name || '') + (o.parent?.name || '') + (o.material?.name || '') + (o.material?.userData?.kind || '');
      const d = Math.hypot(e[12] - eye.x, e[14] - eye.z);
      // Something tens of metres across that belongs to a car, a figure or a prop is wrong.
      if (r > 60 && (o.isSkinnedMesh || o.userData.near || o.userData.far || o.userData.figure)) note('giant-part', o, Math.round(r));
      else if (!Number.isFinite(r)) note('bounds-nan', o);
      else if (r > 4000 && !big.test(tag) && d < 500 && !o.frustumCulled === false) note('giant-mesh', o, Math.round(r));
    }
  });
};
const hook = () => {
  if (++probe.frames % 4 === 0) check();
};
dev.game.hooks.add(hook);
probe.stop = () => dev.game.hooks.delete(hook);
probe.report = () => ({ frames: probe.frames, checks: probe.checks, found: [...probe.found.values()] });
return 'probe on';
