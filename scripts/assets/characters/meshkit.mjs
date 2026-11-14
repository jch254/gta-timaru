// Small indexed-mesh toolkit for the character build: clipping by a scalar field, welding, smoothing,
// offset shells, hem lips and UV unwrapping. Vertices are plain objects so they are easy to interpolate:
//   { p:[x,y,z], n:[x,y,z], uv:[u,v], c:[r,g,b], s:[[joint, weight], …], q:[x,y,z] }
// `s` holds up to four skin influences; `q` is the position on the skin a shell vertex was grown from.

export class Mesh {
  constructor(v = [], t = []) {
    this.v = v;
    this.t = t;
  }
  clone() {
    return new Mesh(this.v.map(cloneVert), this.t.map((t) => [...t]));
  }
}

export function cloneVert(v) {
  return { p: [...v.p], n: [...v.n], uv: [...v.uv], c: [...v.c], s: v.s.map((e) => [...e]), q: v.q ? [...v.q] : undefined };
}

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mixSkin(a, b, t) {
  const m = new Map();
  for (const [j, w] of a) m.set(j, (m.get(j) ?? 0) + w * (1 - t));
  for (const [j, w] of b) m.set(j, (m.get(j) ?? 0) + w * t);
  const s = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const total = s.reduce((acc, e) => acc + e[1], 0) || 1;
  return s.map(([j, w]) => [j, w / total]);
}

export function lerpVert(a, b, t) {
  return {
    p: mix(a.p, b.p, t),
    n: normalize(mix(a.n, b.n, t)),
    uv: mix(a.uv, b.uv, t),
    c: mix(a.c, b.c, t),
    s: mixSkin(a.s, b.s, t),
    q: a.q && b.q ? mix(a.q, b.q, t) : undefined,
  };
}

/** Keep the part of the mesh where field(vertex) >= 0, cutting triangles cleanly along the zero line. */
export function clip(mesh, field) {
  const f = mesh.v.map(field);
  const out = new Mesh();
  const remap = new Map();
  const cuts = new Map();
  const keep = (i) => {
    let k = remap.get(i);
    if (k === undefined) {
      k = out.v.length;
      out.v.push(cloneVert(mesh.v[i]));
      remap.set(i, k);
    }
    return k;
  };
  // Always interpolate from the inside vertex so both triangles sharing an edge get the same point.
  const cut = (inside, outside) => {
    const key = `${inside}_${outside}`;
    let k = cuts.get(key);
    if (k === undefined) {
      const t = f[inside] / (f[inside] - f[outside]);
      k = out.v.length;
      out.v.push(lerpVert(mesh.v[inside], mesh.v[outside], t));
      cuts.set(key, k);
    }
    return k;
  };
  for (const tri of mesh.t) {
    const ins = tri.map((i) => f[i] >= 0);
    const count = ins.filter(Boolean).length;
    if (count === 0) continue;
    if (count === 3) {
      out.t.push(tri.map(keep));
      continue;
    }
    // Rotate so the odd one out comes first; winding is preserved.
    const odd = count === 1 ? ins.indexOf(true) : ins.indexOf(false);
    const [a, b, c] = [tri[odd], tri[(odd + 1) % 3], tri[(odd + 2) % 3]];
    if (count === 1) {
      out.t.push([keep(a), cut(a, b), cut(a, c)]);
    } else {
      const kb = keep(b);
      const kc = keep(c);
      const ab = cut(b, a);
      const ca = cut(c, a);
      out.t.push([ab, kb, kc], [ab, kc, ca]);
    }
  }
  return out;
}

/** Drop vertices no triangle uses. */
export function compact(mesh) {
  const remap = new Map();
  const out = new Mesh();
  for (const tri of mesh.t) {
    out.t.push(
      tri.map((i) => {
        let k = remap.get(i);
        if (k === undefined) {
          k = out.v.length;
          out.v.push(mesh.v[i]);
          remap.set(i, k);
        }
        return k;
      }),
    );
  }
  return out;
}

/** Append `src` to `dst`; returns { start, count } in triangle-index units (×3 for indices). */
export function append(dst, src) {
  const base = dst.v.length;
  const start = dst.t.length;
  for (const v of src.v) dst.v.push(v);
  for (const t of src.t) dst.t.push([t[0] + base, t[1] + base, t[2] + base]);
  return { start: start * 3, count: src.t.length * 3 };
}

/** Class id per vertex: vertices at the same position (UV-seam duplicates) share a class. */
export function weld(mesh, tolerance = 1e-5) {
  const ids = new Int32Array(mesh.v.length);
  const seen = new Map();
  const k = 1 / tolerance;
  mesh.v.forEach((v, i) => {
    const key = `${Math.round(v.p[0] * k)},${Math.round(v.p[1] * k)},${Math.round(v.p[2] * k)}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = seen.size;
      seen.set(key, id);
    }
    ids[i] = id;
  });
  return { ids, count: seen.size };
}

/** Directed boundary edges [a, b] (vertex indices, in triangle winding order), judged on welded classes. */
export function boundaryEdges(mesh, welded = weld(mesh)) {
  const { ids } = welded;
  const uses = new Map();
  for (const tri of mesh.t) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const ca = ids[a];
      const cb = ids[b];
      if (ca === cb) continue;
      const key = ca < cb ? `${ca}_${cb}` : `${cb}_${ca}`;
      const u = uses.get(key);
      if (u) u.n++;
      else uses.set(key, { n: 1, a, b });
    }
  }
  const out = [];
  for (const u of uses.values()) if (u.n === 1) out.push([u.a, u.b]);
  return out;
}

/** Area-weighted smooth normals over welded classes (UV seams stay smooth). */
export function computeNormals(mesh, welded = weld(mesh)) {
  const { ids, count } = welded;
  const acc = Array.from({ length: count }, () => [0, 0, 0]);
  for (const [a, b, c] of mesh.t) {
    const n = cross(sub(mesh.v[b].p, mesh.v[a].p), sub(mesh.v[c].p, mesh.v[a].p));
    for (const i of [a, b, c]) {
      const t = acc[ids[i]];
      t[0] += n[0];
      t[1] += n[1];
      t[2] += n[2];
    }
  }
  mesh.v.forEach((v, i) => {
    v.n = normalize(acc[ids[i]]);
  });
}

/**
 * Taubin smoothing (no shrinkage) over welded classes. Boundary loops are smoothed only along
 * themselves so hems stay where they were cut.
 */
export function smooth(mesh, iterations, lambda = 0.5, mu = -0.53) {
  const welded = weld(mesh);
  const { ids, count } = welded;
  const neighbours = Array.from({ length: count }, () => new Set());
  for (const [a, b, c] of mesh.t) {
    const [ca, cb, cc] = [ids[a], ids[b], ids[c]];
    neighbours[ca].add(cb).add(cc);
    neighbours[cb].add(ca).add(cc);
    neighbours[cc].add(ca).add(cb);
  }
  const boundary = Array.from({ length: count }, () => null);
  for (const [a, b] of boundaryEdges(mesh, welded)) {
    (boundary[ids[a]] ??= new Set()).add(ids[b]);
    (boundary[ids[b]] ??= new Set()).add(ids[a]);
  }
  let pos = Array.from({ length: count }, () => null);
  mesh.v.forEach((v, i) => {
    pos[ids[i]] = [...v.p];
  });
  const step = (factor) => {
    const next = pos.map((p, i) => {
      const ring = boundary[i] ?? neighbours[i];
      if (!ring.size) return p;
      const avg = [0, 0, 0];
      for (const j of ring) {
        avg[0] += pos[j][0];
        avg[1] += pos[j][1];
        avg[2] += pos[j][2];
      }
      return [p[0] + (avg[0] / ring.size - p[0]) * factor, p[1] + (avg[1] / ring.size - p[1]) * factor, p[2] + (avg[2] / ring.size - p[2]) * factor];
    });
    pos = next;
  };
  for (let i = 0; i < iterations; i++) {
    step(lambda);
    step(mu);
  }
  mesh.v.forEach((v, i) => {
    v.p = [...pos[ids[i]]];
  });
}

/** Push every vertex out along its normal by distance(vertex). */
export function offset(mesh, distance) {
  for (const v of mesh.v) {
    const d = distance(v);
    v.p = add(v.p, scale(v.n, d));
  }
}

/**
 * Strips that close the gap between a shell's open edge and the skin underneath: from each boundary edge
 * accepted by `accept(a, b)` down to the skin position (`q`) the edge grew from. Returns a new mesh.
 */
export function lips(mesh, accept, shade = [0.42, 0.42, 0.42], inset = 0.002) {
  const out = new Mesh();
  for (const [ia, ib] of boundaryEdges(mesh)) {
    const a = mesh.v[ia];
    const b = mesh.v[ib];
    if (!a.q || !b.q || !accept(a, b)) continue;
    // Outward from the mesh interior, across the edge.
    const edge = normalize(sub(b.p, a.p));
    const nrm = normalize(cross(edge, normalize(add(a.n, b.n))));
    const base = out.v.length;
    const inner = (v) => sub(v.q, scale(v.n, inset));
    const mk = (v, p, k) => ({ p, n: nrm, uv: [...v.uv], c: scale(shade, k), s: v.s.map((e) => [...e]), q: undefined });
    out.v.push(mk(a, [...a.p], 1.5), mk(b, [...b.p], 1.5), mk(a, inner(a), 0.7), mk(b, inner(b), 0.7));
    out.t.push([base + 1, base, base + 2], [base + 1, base + 2, base + 3]);
  }
  return out;
}

/**
 * Per-corner UVs: uvOf(tri, corner, vertex) → [u, v]; vertices are split where corners disagree.
 * Used for cylindrical unwraps with a seam.
 */
export function assignCornerUVs(mesh, uvOf) {
  const out = new Mesh();
  const seen = new Map();
  for (const tri of mesh.t) {
    const uvs = uvOf(tri.map((i) => mesh.v[i]));
    out.t.push(
      tri.map((i, corner) => {
        const uv = uvs[corner];
        const key = `${i}|${Math.round(uv[0] * 20000)}|${Math.round(uv[1] * 20000)}`;
        let k = seen.get(key);
        if (k === undefined) {
          k = out.v.length;
          const v = cloneVert(mesh.v[i]);
          v.uv = uv;
          out.v.push(v);
          seen.set(key, k);
        }
        return k;
      }),
    );
  }
  return out;
}

/**
 * Cylindrical unwrap helper for one triangle: angles around an axis, unwrapped so the triangle does
 * not straddle the seam. `angleOf(vertex)` in radians; returns the three angles in [0, 3π).
 */
export function unwrapAngles(angles) {
  const a = angles.map((x) => (x < 0 ? x + Math.PI * 2 : x));
  const max = Math.max(...a);
  return a.map((x) => (max - x > Math.PI ? x + Math.PI * 2 : x));
}

/** Read a glTF primitive into a Mesh. `jointMap[i]` renames skin joint i (or -1 to drop to its parent upstream). */
export function fromPrimitive(prim, jointMap) {
  const P = prim.getAttribute('POSITION');
  const N = prim.getAttribute('NORMAL');
  const UV = prim.getAttribute('TEXCOORD_0');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const mesh = new Mesh();
  const n = P.getCount();
  for (let i = 0; i < n; i++) {
    const j = J ? J.getElement(i, []) : [0, 0, 0, 0];
    const w = W ? W.getElement(i, []) : [1, 0, 0, 0];
    const m = new Map();
    for (let k = 0; k < 4; k++) {
      if (w[k] <= 0) continue;
      const joint = jointMap ? jointMap[j[k]] : j[k];
      m.set(joint, (m.get(joint) ?? 0) + w[k]);
    }
    const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    mesh.v.push({
      p: P.getElement(i, []),
      n: N ? N.getElement(i, []) : [0, 1, 0],
      uv: UV ? UV.getElement(i, []) : [0, 0],
      c: [1, 1, 1],
      s: [...m.entries()].sort((x, y) => y[1] - x[1]).map(([joint, weight]) => [joint, weight / total]),
      q: undefined,
    });
  }
  const I = prim.getIndices();
  for (let t = 0; t < I.getCount(); t += 3) mesh.t.push([I.getScalar(t), I.getScalar(t + 1), I.getScalar(t + 2)]);
  return mesh;
}
