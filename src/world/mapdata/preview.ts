import type { CompiledMap } from '../map';
import type { MapSource, Shape } from '../mapsource';

const BOUNDS = { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 };

const DISTRICT_TINT: Record<string, string> = {
  cbd: '#b0483a',
  shops: '#d9822b',
  villa: '#7fae4a',
  statehouse: '#a9b84e',
  industrial: '#7b6d8d',
  port: '#4d6f96',
  township: '#c9a227',
  park: '#2f8a3c',
  rural: '#c8d6a0',
  beach: '#e8d48a',
};

const ROAD_STYLE: Record<string, { color: string; width: number }> = {
  highway: { color: '#c62828', width: 13 },
  arterial: { color: '#ef6c00', width: 12 },
  street: { color: '#ffffff', width: 6.5 },
  lane: { color: '#d7d7d7', width: 4 },
  gravel: { color: '#b08d57', width: 4.5 },
  pedestrian: { color: '#e986c8', width: 7 },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 10) / 10).toString();

function shapeSvg(shape: Shape, attrs: string): string {
  if (shape.kind === 'rect') return `<rect x="${n(shape.minX)}" y="${n(shape.minZ)}" width="${n(shape.maxX - shape.minX)}" height="${n(shape.maxZ - shape.minZ)}" ${attrs}/>`;
  if (shape.kind === 'circle') return `<circle cx="${n(shape.x)}" cy="${n(shape.z)}" r="${n(shape.r)}" ${attrs}/>`;
  return `<polygon points="${shape.pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" ${attrs}/>`;
}

function shapeCentre(shape: Shape): [number, number] {
  if (shape.kind === 'rect') return [(shape.minX + shape.maxX) / 2, (shape.minZ + shape.maxZ) / 2];
  if (shape.kind === 'circle') return [shape.x, shape.z];
  let x = 0;
  let z = 0;
  for (const p of shape.pts) {
    x += p[0];
    z += p[1];
  }
  return [x / shape.pts.length, z / shape.pts.length];
}

/** Top-down SVG of the whole map (1 unit = 1 m; north up) for eyeballing the authored data. */
export function renderPreview(src: MapSource, map: CompiledMap): string {
  const out: string[] = [];
  const W = BOUNDS.maxX - BOUNDS.minX;
  const H = BOUNDS.maxZ - BOUNDS.minZ;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOUNDS.minX} ${BOUNDS.minZ} ${W} ${H}" width="${W / 4}" height="${H / 4}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect x="${BOUNDS.minX}" y="${BOUNDS.minZ}" width="${W}" height="${H}" fill="#9cc3dd"/>`);

  // Land, shaded by height, as run-length rows of 24 m cells.
  const CELL = 24;
  const shade = (h: number) => (h < 0 ? '' : h < 2.3 ? '#efe2ad' : h < 26 ? '#dfe8c4' : h < 60 ? '#cdd3a2' : h < 100 ? '#b9b683' : h < 140 ? '#a39a6c' : '#8c8062');
  out.push('<g shape-rendering="crispEdges">');
  for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += CELL) {
    let runStart = BOUNDS.minX;
    let runColor = shade(map.terrain.natural(BOUNDS.minX + CELL / 2, z + CELL / 2));
    for (let x = BOUNDS.minX + CELL; x <= BOUNDS.maxX; x += CELL) {
      const c = x < BOUNDS.maxX ? shade(map.terrain.natural(x + CELL / 2, z + CELL / 2)) : '\0';
      if (c !== runColor) {
        if (runColor) out.push(`<rect x="${runStart}" y="${z}" width="${x - runStart}" height="${CELL}" fill="${runColor}"/>`);
        runStart = x;
        runColor = c;
      }
    }
  }
  out.push('</g>');

  // Districts, low priority first.
  out.push('<g>');
  for (const d of [...src.districts].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))) {
    out.push(shapeSvg(d.shape, `fill="${DISTRICT_TINT[d.type] ?? '#888'}" fill-opacity="0.42" stroke="${DISTRICT_TINT[d.type] ?? '#888'}" stroke-opacity="0.7" stroke-width="1.5"`));
  }
  out.push('</g>');

  // Rivers.
  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const r of map.rivers) {
    const pts = r.samples.map((s) => `${n(s.x)},${n(s.z)}`).join(' ');
    if (r.braided) out.push(`<polyline points="${pts}" stroke="#cfcabb" stroke-width="${r.width}"/>`);
    out.push(`<polyline points="${pts}" stroke="#4f93c4" stroke-width="${r.braided ? r.width * 0.45 : r.width}" stroke-opacity="${r.braided ? 0.75 : 1}"/>`);
  }
  out.push('</g>');

  // Landmark clear circles (under the roads so encroachment shows).
  out.push('<g>');
  for (const l of src.landmarks) {
    out.push(`<circle cx="${n(l.x)}" cy="${n(l.z)}" r="${l.clearRadius}" fill="#7a3fb5" fill-opacity="0.22" stroke="#7a3fb5" stroke-width="1.2"/>`);
  }
  out.push('</g>');

  // Roads: casing first, then fill, by class so main roads sit on top.
  const order = ['gravel', 'lane', 'street', 'pedestrian', 'arterial', 'highway'];
  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const cls of order) {
    const st = ROAD_STYLE[cls];
    for (const e of map.graph.edges) {
      if (e.cls !== cls) continue;
      const pts = e.samples.map((s) => `${n(s.x)},${n(s.z)}`).join(' ');
      const casing = e.bridge ? '#222' : e.tunnel ? '#555' : '#777';
      out.push(`<polyline points="${pts}" stroke="${casing}" stroke-width="${st.width + (e.bridge ? 5 : 2)}"${e.tunnel ? ' stroke-dasharray="10 8"' : ''}/>`);
    }
    for (const e of map.graph.edges) {
      if (e.cls !== cls) continue;
      const pts = e.samples.map((s) => `${n(s.x)},${n(s.z)}`).join(' ');
      out.push(`<polyline points="${pts}" stroke="${st.color}" stroke-width="${st.width}"${e.tunnel ? ' stroke-dasharray="10 8"' : ''}${cls === 'gravel' ? ' stroke-dasharray="14 5"' : ''}/>`);
    }
  }
  // One-way arrows.
  for (const e of map.graph.edges) {
    if (!e.oneway || e.length < 40) continue;
    const m = map.graph.pointAt(e, e.length / 2);
    const a = (Math.atan2(m.tz, m.tx) * 180) / Math.PI;
    out.push(`<path d="M-7,-4 L5,0 L-7,4" stroke="#1c4fa0" stroke-width="2" transform="translate(${n(m.x)},${n(m.z)}) rotate(${n(a)})"/>`);
  }
  out.push('</g>');

  // Rails.
  out.push('<g fill="none">');
  for (const r of map.rails) {
    const pts = r.samples.map((s) => `${n(s.x)},${n(s.z)}`).join(' ');
    const tram = r.source.kind === 'tram';
    out.push(`<polyline points="${pts}" stroke="${tram ? '#0a7d6c' : '#111'}" stroke-width="${tram ? 2.2 : r.source.bridge ? 5 : 3}"/>`);
    out.push(`<polyline points="${pts}" stroke="${tram ? '#bff5ea' : '#fff'}" stroke-width="${tram ? 0.8 : 1.4}" stroke-dasharray="${tram ? '4 4' : '9 9'}"/>`);
  }
  out.push('</g>');

  // Street names: one label per source road, along its longest straight run.
  out.push('<g text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="2.2" stroke-linejoin="round">');
  const seen = new Map<string, [number, number][]>();
  for (const r of src.roads) {
    let best = 0;
    let bi = 0;
    let total = 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const len = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
      total += len;
      if (len > best) {
        best = len;
        bi = i;
      }
    }
    const main = r.cls === 'highway' || r.cls === 'arterial';
    if (total < (main ? 60 : 90)) continue;
    const a = r.pts[bi];
    const c = r.pts[bi + 1];
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2;
    const prior = seen.get(r.name) ?? [];
    if (prior.some(([px, pz]) => Math.hypot(px - mx, pz - mz) < 320)) continue;
    seen.set(r.name, [...prior, [mx, mz]]);
    let ang = (Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    const size = r.cls === 'highway' ? 15 : r.cls === 'arterial' ? 13 : r.cls === 'gravel' ? 12 : 9;
    out.push(`<text font-size="${size}" fill="#1b1b1b"${main ? ' font-weight="bold"' : ''} transform="translate(${n(mx)},${n(mz)}) rotate(${n(ang)})" dy="-${r.cls === 'street' ? 5 : 8}">${esc(r.name)}</text>`);
  }
  out.push('</g>');

  // District names.
  out.push('<g text-anchor="middle" fill="#3b2f5b" fill-opacity="0.85" font-style="italic" paint-order="stroke" stroke="#fff" stroke-opacity="0.7" stroke-width="2.5">');
  const named = new Set<string>();
  for (const d of src.districts) {
    if (named.has(d.name)) continue;
    named.add(d.name);
    const [x, z] = shapeCentre(d.shape);
    out.push(`<text font-size="22" x="${n(x)}" y="${n(z)}">${esc(d.name)}${d.teReo ? ` · ${esc(d.teReo)}` : ''}</text>`);
  }
  out.push('</g>');

  // Landmarks and places.
  out.push('<g paint-order="stroke" stroke="#fff" stroke-width="2">');
  for (const l of src.landmarks) {
    const fx = l.x + Math.sin(l.heading) * Math.min(l.clearRadius, 24);
    const fz = l.z + Math.cos(l.heading) * Math.min(l.clearRadius, 24);
    out.push(`<line x1="${n(l.x)}" y1="${n(l.z)}" x2="${n(fx)}" y2="${n(fz)}" stroke="#7a3fb5" stroke-width="2.5"/>`);
    out.push(`<circle cx="${n(l.x)}" cy="${n(l.z)}" r="4" fill="#7a3fb5" stroke="none"/>`);
    out.push(`<text font-size="9" fill="#4a1f7a" x="${n(l.x + 6)}" y="${n(l.z - 5)}">${esc(l.kind)}${l.skyline ? ' ▲' : ''}</text>`);
  }
  for (const p of src.places) {
    const fx = p.x + Math.sin(p.heading) * 10;
    const fz = p.z + Math.cos(p.heading) * 10;
    out.push(`<line x1="${n(p.x)}" y1="${n(p.z)}" x2="${n(fx)}" y2="${n(fz)}" stroke="#d00000" stroke-width="2"/>`);
    out.push(`<circle cx="${n(p.x)}" cy="${n(p.z)}" r="3.5" fill="#d00000" stroke="none"/>`);
    out.push(`<text font-size="9" fill="#a00000" font-weight="bold" x="${n(p.x + 6)}" y="${n(p.z + 9)}">${esc(p.id)}</text>`);
  }
  out.push('</g>');

  out.push(`<rect x="${BOUNDS.minX + 150}" y="${BOUNDS.minZ + 150}" width="${W - 300}" height="${H - 300}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-dasharray="30 20" stroke-width="3"/>`);
  out.push('</svg>');
  return out.join('\n');
}
