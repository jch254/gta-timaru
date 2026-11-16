// Watches level-of-detail states for cars, figures and plants and reports every switch with where it is on
// screen, so before/after crops can be cut from consecutive frames (scripts/playtest/lodpairs.mjs).
// Use as the --eval of scripts/playtest/frames.mjs; then call `window.__lod.diff()` in --each after the frame
// has been drawn. Each switch: { k: kind, id, a: state before, b: state after, x, y: screen px, d: metres }.
const ctx = dev.ctx;
const v3 = new (ctx.camera.position.constructor)();
const screen = (x, y, z) => {
  v3.set(x, y, z).project(ctx.camera);
  return [Math.round((v3.x * 0.5 + 0.5) * innerWidth), Math.round((0.5 - v3.y * 0.5) * innerHeight), v3.z];
};
const snapshot = () => {
  const s = new Map();
  for (const v of ctx.vehicles.all) {
    const lod = v.group.children.find((o) => o.isLOD) ?? v.group.getObjectByProperty?.('isLOD', true);
    if (!lod) continue;
    const p = v.position;
    s.set('car' + v.id, { k: 'car', state: lod.distant ? 'far' : 'near', x: p.x, y: p.y + 0.7, z: p.z });
  }
  for (const a of ctx.actors.all) {
    if (a === ctx.player) continue;
    let body = null;
    a.group.traverse((o) => {
      if (o.isSkinnedMesh && o.userData.figure && o.material?.colorWrite !== false) body = o;
    });
    if (!body || !body.geometry.index) continue;
    const tris = body.geometry.index.count / 3;
    const level = tris > 9000 ? 0 : tris > 3500 ? 1 : tris > 1200 ? 2 : 3;
    s.set('fig' + a.id, { k: 'fig', state: level, x: a.position.x, y: a.position.y + 1.0, z: a.position.z });
  }
  const near = ctx.scene.getObjectByName('plants-near');
  if (near) {
    for (const mesh of near.children) {
      if (!mesh.isInstancedMesh || !mesh.visible) continue;
      const m = mesh.instanceMatrix.array;
      const h = (mesh.geometry.boundingSphere?.center.y ?? 2) + 0;
      for (let i = 0; i < mesh.count; i++) {
        const x = m[i * 16 + 12];
        const y = m[i * 16 + 13];
        const z = m[i * 16 + 14];
        const key = 'plant' + Math.round(x * 4) + ',' + Math.round(z * 4);
        const sy = Math.hypot(m[i * 16 + 4], m[i * 16 + 5], m[i * 16 + 6]);
        const top = y + h * sy;
        const e = s.get(key);
        if (!e || top > e.y) s.set(key, { k: h * sy > 2.5 ? 'tree' : 'shrub', state: 'near', x, y: top, z });
      }
    }
  }
  return s;
};
let before = snapshot();
window.__lod = {
  diff() {
    const now = snapshot();
    const out = [];
    const eye = ctx.camera.position;
    const add = (id, e, a, b) => {
      const [x, y, depth] = screen(e.x, e.y, e.z);
      if (depth > 1 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
      out.push({ k: e.k, id, a, b, x, y, d: Math.round(Math.hypot(e.x - eye.x, e.z - eye.z)) });
    };
    for (const [id, e] of now) {
      const old = before.get(id);
      if (old && old.state !== e.state) add(id, e, old.state, e.state);
      else if (!old && id.startsWith('plant')) add(id, e, 'far', 'near');
    }
    for (const [id, e] of before) if (!now.has(id) && id.startsWith('plant')) add(id, e, 'near', 'far');
    before = now;
    return out.length ? out : undefined;
  },
};
