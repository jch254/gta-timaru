import * as THREE from 'three';
import { damp } from '../core/math';
import type { Humanoid, HumanoidLook, HumanoidPose, MaterialLibrary } from '../core/types';
import { canvasTexture } from '../render/textures';
import { createGltfHumanoid } from './gltf';

/**
 * A skinned human figure generated in code: one continuous body lofted from anatomical cross-sections,
 * layered with clothing shells, bound to a 17-bone skeleton and animated procedurally.
 * Faces +z; origin at the feet.
 */

const enum B {
  hips,
  spine,
  chest,
  neck,
  head,
  armL,
  foreL,
  handL,
  armR,
  foreR,
  handR,
  legL,
  shinL,
  footL,
  legR,
  shinR,
  footR,
  count,
}

type Weights = [bone: B, weight: number][];

/** Elliptical cross-section. Rings are horizontal (axis y) unless `along` is 'z' (feet). */
interface Ring {
  x: number;
  y: number;
  z: number;
  rx: number;
  /** Radius towards the front (+z) and back (−z); for 'z' rings these are up / down. */
  rf: number;
  rb: number;
  w: Weights;
}

class SkinBuilder {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  skinIndex: number[] = [];
  skinWeight: number[] = [];
  /** Index lists per material group: 0 = body (vertex colours), 1 = patterned top. */
  groups: number[][] = [[], []];

  private vertex(x: number, y: number, z: number, c: THREE.Color, u: number, v: number, w: Weights): number {
    this.positions.push(x, y, z);
    this.colors.push(c.r, c.g, c.b);
    this.uvs.push(u, v);
    const a = w[0];
    const b = w[1] ?? [0, 0];
    const total = a[1] + b[1];
    this.skinIndex.push(a[0], b[0], 0, 0);
    this.skinWeight.push(a[1] / total, b[1] / total, 0, 0);
    return this.positions.length / 3 - 1;
  }

  /** Loft a closed tube through rings. */
  tube(rings: Ring[], color: THREE.Color, options: { seg?: number; group?: 0 | 1; capStart?: boolean; capEnd?: boolean; along?: 'y' | 'z' } = {}) {
    const seg = options.seg ?? 10;
    const group = this.groups[options.group ?? 0];
    const along = options.along ?? 'y';
    const first = this.positions.length / 3;
    let v = 0;
    rings.forEach((r, i) => {
      if (i > 0) v += Math.hypot(r.x - rings[i - 1].x, r.y - rings[i - 1].y, r.z - rings[i - 1].z);
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const s = Math.sin(a);
        const c = Math.cos(a);
        const depth = s >= 0 ? r.rf : r.rb;
        if (along === 'y') this.vertex(r.x + c * r.rx, r.y, r.z + s * depth, color, (k / seg) * 4, v * 6, r.w);
        else this.vertex(r.x + c * r.rx, r.y + s * depth, r.z, color, (k / seg) * 4, v * 6, r.w);
      }
    });
    // Winding depends on which way the rings run along their axis; keep faces pointing outwards.
    const a0 = along === 'y' ? rings[0].y : rings[0].z;
    const a1 = along === 'y' ? rings[rings.length - 1].y : rings[rings.length - 1].z;
    const ascending = a1 > a0;
    const flip = along === 'y' ? ascending : !ascending;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a = first + i * (seg + 1) + k;
        const b = a + seg + 1;
        if (flip) group.push(a, b, a + 1, a + 1, b, b + 1);
        else group.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const cap = (ringIndex: number, isEnd: boolean) => {
      const r = rings[ringIndex];
      const centre = this.vertex(r.x, r.y, r.z, color, 0, 0, r.w);
      const base = first + ringIndex * (seg + 1);
      // The cap faces away from the tube: towards +axis at the far end of an ascending tube, and so on.
      const positive = isEnd === ascending;
      const forward = along === 'y' ? !positive : positive;
      for (let k = 0; k < seg; k++) {
        if (forward) group.push(centre, base + k, base + k + 1);
        else group.push(centre, base + k + 1, base + k);
      }
    };
    if (options.capStart) cap(0, false);
    if (options.capEnd) cap(rings.length - 1, true);
  }

  /** Small rigid ellipsoid (eyes, ears, hat parts…). */
  blob(x: number, y: number, z: number, rx: number, ry: number, rz: number, color: THREE.Color, bone: B, detail = 6) {
    const rings: Ring[] = [];
    for (let i = 0; i <= detail; i++) {
      const t = (i / detail) * Math.PI;
      const r = Math.max(0.0005, Math.sin(t));
      rings.push({ x, y: y - Math.cos(t) * ry, z, rx: rx * r, rf: rz * r, rb: rz * r, w: [[bone, 1]] });
    }
    this.tube(rings, color, { seg: detail + 2 });
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color, bone: B) {
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const faces: [number, number, number][][] = [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
      [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]],
      [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]],
      [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]],
    ];
    for (const f of faces) {
      const i = f.map((p) => this.vertex(x + p[0], y + p[1], z + p[2], color, 0, 0, [[bone, 1]]));
      this.groups[0].push(i[0], i[1], i[2], i[0], i[2], i[3]);
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    const index = [...this.groups[0], ...this.groups[1]];
    geo.setIndex(index);
    geo.addGroup(0, this.groups[0].length, 0);
    if (this.groups[1].length) geo.addGroup(this.groups[0].length, this.groups[1].length, 1);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.boundingSphere!.radius *= 1.6; // limbs move outside the rest pose
    return geo;
  }
}

/** Interpolated cross-section at parameter t (0..1 along the ring list by index). */
function sample(rings: Ring[], t: number): Ring {
  const f = Math.min(rings.length - 1, Math.max(0, t * (rings.length - 1)));
  const i = Math.min(rings.length - 2, Math.floor(f));
  const k = f - i;
  const a = rings[i];
  const b = rings[i + 1];
  const mix = (p: number, q: number) => p + (q - p) * k;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), rx: mix(a.rx, b.rx), rf: mix(a.rf, b.rf), rb: mix(a.rb, b.rb), w: k < 0.5 ? a.w : b.w };
}

/** Clothing shell: the body rings from t0 to t1, fattened, with a slightly flared hem. */
function shell(rings: Ring[], t0: number, t1: number, grow: number, steps: number, flareEnd = 0.012): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i <= steps; i++) {
    const r = sample(rings, t0 + ((t1 - t0) * i) / steps);
    const g = grow + (i === steps ? flareEnd : 0);
    out.push({ ...r, rx: r.rx + g, rf: r.rf + g, rb: r.rb + g });
  }
  return out;
}

let plaid: THREE.Texture | null = null;
let stripes: THREE.Texture | null = null;
const patterned = new Map<string, THREE.MeshStandardMaterial>();
let bodyMaterial: THREE.MeshStandardMaterial | null = null;

function patternMaterial(style: 'bushShirt' | 'jersey', color: number, m: MaterialLibrary): THREE.MeshStandardMaterial {
  const key = `${style}|${color}`;
  let mat = patterned.get(key);
  if (mat) return mat;
  if (style === 'bushShirt') {
    plaid ??= (() => {
      const t = canvasTexture(64, 64, (g) => {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = 'rgba(0,0,0,0.8)';
        g.fillRect(0, 0, 32, 32);
        g.fillRect(32, 32, 32, 32);
        g.fillStyle = 'rgba(0,0,0,0.38)';
        g.fillRect(32, 0, 32, 32);
        g.fillRect(0, 32, 32, 32);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 1, 64);
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2.6, 2.8);
      return t;
    })();
  } else {
    stripes ??= (() => {
      const t = canvasTexture(8, 64, (g) => {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 8, 64);
        g.fillStyle = 'rgba(0,0,0,0.72)';
        g.fillRect(0, 0, 8, 32);
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, 1.1);
      return t;
    })();
  }
  mat = m.register(new THREE.MeshStandardMaterial({ color, map: style === 'bushShirt' ? plaid : stripes, roughness: 0.95 }));
  patterned.set(key, mat);
  return mat;
}

/** Joint angles (radians) that define a pose. */
interface Joints {
  rootY: number;
  rootPitch: number;
  hipSway: number;
  spine: number; // forward lean
  twist: number;
  head: number;
  headYaw: number;
  armL: number; // shoulder swing (negative = forward)
  armLOut: number;
  elbowL: number;
  armR: number;
  armROut: number;
  elbowR: number;
  legL: number; // positive = forward
  kneeL: number;
  legR: number;
  kneeR: number;
}

const REST: Joints = { rootY: 0, rootPitch: 0, hipSway: 0, spine: 0, twist: 0, head: 0, headYaw: 0, armL: 0.04, armLOut: 0.03, elbowL: -0.16, armR: 0.04, armROut: 0.03, elbowR: -0.16, legL: 0, kneeL: 0.03, legR: 0, kneeR: 0.03 };

export class HumanoidRig implements Humanoid {
  readonly group = new THREE.Group();
  private bones: THREE.Bone[] = [];
  private mesh: THREE.SkinnedMesh;
  private hand = new THREE.Group();
  private j: Joints = { ...REST };
  private target: Joints = { ...REST };
  private pose: HumanoidPose = 'idle';
  private speed = 0;
  private aimPitch = 0;
  private phase = Math.random() * 6;
  private poseTime = 0;
  private hipY: number;
  private held: THREE.Object3D | null = null;

  constructor(look: HumanoidLook, m: MaterialLibrary) {
    const H = (look.height ?? 1) * (look.female ? 0.94 : 1);
    const K = look.bulk ?? 1;
    const fem = !!look.female;
    const style = look.topStyle ?? 'tee';
    const col = (hex: number) => new THREE.Color(hex);
    const skin = col(look.skin);
    const top = col(style === 'hiVis' ? 0xe6ee2c : look.top);
    const legsC = col(look.legs);
    const shoe = col(look.shoes);
    const hair = col(look.hair);
    const hatC = col(look.hatColor ?? 0x25304a);
    const dark = col(0x1c1612);
    const hasPattern = style === 'bushShirt' || style === 'jersey';
    const topGroup: 0 | 1 = hasPattern ? 1 : 0;
    const topColor = hasPattern ? col(0xffffff) : top;

    // ── Skeleton (rest pose: standing, arms by the sides) ──
    const shoulderX = (fem ? 0.165 : 0.19) * K;
    const hipX = 0.092 * (fem ? 1.04 : 1);
    const P: Record<number, [number, number, number]> = {
      [B.hips]: [0, 0.96, 0],
      [B.spine]: [0, 1.07, 0],
      [B.chest]: [0, 1.24, 0],
      [B.neck]: [0, 1.49, 0.005],
      [B.head]: [0, 1.56, 0.01],
      [B.armL]: [shoulderX, 1.43, 0],
      [B.foreL]: [shoulderX + 0.035, 1.14, 0],
      [B.handL]: [shoulderX + 0.046, 0.875, 0.015],
      [B.armR]: [-shoulderX, 1.43, 0],
      [B.foreR]: [-shoulderX - 0.035, 1.14, 0],
      [B.handR]: [-shoulderX - 0.046, 0.875, 0.015],
      [B.legL]: [hipX, 0.93, 0],
      [B.shinL]: [hipX + 0.004, 0.5, 0.005],
      [B.footL]: [hipX + 0.006, 0.08, -0.01],
      [B.legR]: [-hipX, 0.93, 0],
      [B.shinR]: [-hipX - 0.004, 0.5, 0.005],
      [B.footR]: [-hipX - 0.006, 0.08, -0.01],
    };
    const parent: Record<number, B | -1> = {
      [B.hips]: -1,
      [B.spine]: B.hips,
      [B.chest]: B.spine,
      [B.neck]: B.chest,
      [B.head]: B.neck,
      [B.armL]: B.chest,
      [B.foreL]: B.armL,
      [B.handL]: B.foreL,
      [B.armR]: B.chest,
      [B.foreR]: B.armR,
      [B.handR]: B.foreR,
      [B.legL]: B.hips,
      [B.shinL]: B.legL,
      [B.footL]: B.shinL,
      [B.legR]: B.hips,
      [B.shinR]: B.legR,
      [B.footR]: B.shinR,
    };
    for (let i = 0; i < B.count; i++) {
      const bone = new THREE.Bone();
      const p = P[i];
      const q = parent[i] >= 0 ? P[parent[i]] : [0, 0, 0];
      bone.position.set((p[0] - q[0]) * H, (p[1] - q[1]) * H, (p[2] - q[2]) * H);
      this.bones.push(bone);
      if (parent[i] >= 0) this.bones[parent[i]].add(bone);
    }
    this.hipY = 0.96 * H;

    // ── Body mesh ──
    const sb = new SkinBuilder();
    const R = (x: number, y: number, z: number, rx: number, rf: number, rb: number, w: Weights): Ring => ({ x: x * H, y: y * H, z: z * H, rx: rx * H, rf: rf * H, rb: rb * H, w });
    const belly = 1 + (K - 1) * 2.2;
    const hipW = fem ? 1.07 : 1;
    const waistW = fem ? 0.86 : 1;
    const shW = fem ? 0.87 : 1;
    const torso: Ring[] = [
      R(0, 0.855, 0, 0.09 * K, 0.075 * K, 0.085 * K, [[B.hips, 1]]),
      R(0, 0.91, 0, 0.162 * K * hipW, 0.098 * K, 0.118 * K, [[B.hips, 1]]),
      R(0, 0.975, 0, 0.168 * K * hipW, 0.104 * K, 0.122 * K, [[B.hips, 1]]),
      R(0, 1.05, 0, 0.152 * K * waistW, 0.104 * belly, 0.104 * K, [[B.hips, 0.5], [B.spine, 0.5]]),
      R(0, 1.12, 0, 0.143 * K * waistW, 0.1 * belly, 0.096 * K, [[B.spine, 1]]),
      R(0, 1.2, 0, 0.155 * K * (fem ? 0.93 : 1), 0.108 * K, 0.1 * K, [[B.spine, 0.5], [B.chest, 0.5]]),
      R(0, 1.3, 0.004, 0.176 * K * shW, (fem ? 0.138 : 0.122) * K, 0.106 * K, [[B.chest, 1]]),
      R(0, 1.38, 0, 0.186 * K * shW, 0.116 * K, 0.106 * K, [[B.chest, 1]]),
      R(0, 1.435, -0.004, 0.198 * K * shW, 0.092 * K, 0.098 * K, [[B.chest, 1]]),
      R(0, 1.47, -0.004, 0.115 * K, 0.07, 0.078, [[B.chest, 1]]),
      R(0, 1.498, 0, 0.06, 0.058, 0.062, [[B.chest, 0.5], [B.neck, 0.5]]),
    ];
    const head: Ring[] = [
      R(0, 1.47, 0.0, 0.056, 0.054, 0.058, [[B.chest, 0.6], [B.neck, 0.4]]),
      R(0, 1.52, 0.004, 0.052, 0.054, 0.056, [[B.neck, 1]]),
      R(0, 1.540, 0.008, 0.0594, 0.0713, 0.0648, [[B.neck, 0.5], [B.head, 0.5]]),
      R(0, 1.568, 0.012, 0.0691, 0.0907, 0.0778, [[B.head, 1]]),
      R(0, 1.599, 0.012, 0.0756, 0.0972, 0.0907, [[B.head, 1]]),
      R(0, 1.636, 0.012, 0.0799, 0.1004, 0.0972, [[B.head, 1]]),
      R(0, 1.672, 0.012, 0.0821, 0.0983, 0.1015, [[B.head, 1]]),
      R(0, 1.705, 0.012, 0.0826, 0.0994, 0.1048, [[B.head, 1]]),
      R(0, 1.739, 0.01, 0.0778, 0.0929, 0.1015, [[B.head, 1]]),
      R(0, 1.769, 0.006, 0.0583, 0.0691, 0.0799, [[B.head, 1]]),
      R(0, 1.786, 0.004, 0.0238, 0.0302, 0.0367, [[B.head, 1]]),
    ];
    const arm = (s: 1 | -1): Ring[] => {
      const [up, fo, ha] = s === 1 ? [B.armL, B.foreL, B.handL] : [B.armR, B.foreR, B.handR];
      const x = (v: number) => s * (shoulderX + v);
      const a = 0.9 + (K - 1) * 0.8 + (fem ? -0.1 : 0.1);
      return [
        R(x(-0.02), 1.436, 0, 0.04 * a, 0.05 * a, 0.05 * a, [[B.chest, 0.6], [up, 0.4]]),
        R(x(0.008), 1.4, 0, 0.056 * a, 0.058 * a, 0.058 * a, [[up, 1]]),
        R(x(0.02), 1.3, 0, 0.049 * a, 0.052 * a, 0.05 * a, [[up, 1]]),
        R(x(0.03), 1.19, 0, 0.042 * a, 0.044 * a, 0.044 * a, [[up, 0.75], [fo, 0.25]]),
        R(x(0.035), 1.14, 0, 0.04 * a, 0.041 * a, 0.043 * a, [[up, 0.5], [fo, 0.5]]),
        R(x(0.039), 1.08, 0.003, 0.042 * a, 0.045 * a, 0.041 * a, [[fo, 0.85], [up, 0.15]]),
        R(x(0.043), 0.97, 0.008, 0.034 * a, 0.036 * a, 0.034 * a, [[fo, 1]]),
        R(x(0.046), 0.885, 0.014, 0.026, 0.03, 0.028, [[fo, 0.5], [ha, 0.5]]),
        R(x(0.047), 0.85, 0.016, 0.018, 0.042, 0.04, [[ha, 1]]),
        R(x(0.048), 0.79, 0.02, 0.017, 0.044, 0.04, [[ha, 1]]),
        R(x(0.047), 0.735, 0.026, 0.014, 0.036, 0.032, [[ha, 1]]),
        R(x(0.046), 0.705, 0.03, 0.008, 0.02, 0.018, [[ha, 1]]),
      ];
    };
    const leg = (s: 1 | -1): Ring[] => {
      const [th, sh, ft] = s === 1 ? [B.legL, B.shinL, B.footL] : [B.legR, B.shinR, B.footR];
      const x = (v: number) => s * (hipX + v);
      const a = 0.94 + (K - 1) * 0.9;
      return [
        R(x(-0.004), 0.94, 0, 0.088 * a * hipW, 0.094 * a, 0.108 * a, [[B.hips, 0.65], [th, 0.35]]),
        R(x(0), 0.86, 0, 0.09 * a * hipW, 0.094 * a, 0.1 * a, [[th, 1]]),
        R(x(0.002), 0.74, 0.003, 0.078 * a, 0.085 * a, 0.08 * a, [[th, 1]]),
        R(x(0.003), 0.6, 0.006, 0.064 * a, 0.068 * a, 0.066 * a, [[th, 0.8], [sh, 0.2]]),
        R(x(0.004), 0.5, 0.008, 0.054 * a, 0.06 * a, 0.054 * a, [[th, 0.5], [sh, 0.5]]),
        R(x(0.005), 0.44, 0.004, 0.052 * a, 0.05 * a, 0.058 * a, [[sh, 0.85], [th, 0.15]]),
        R(x(0.006), 0.35, 0, 0.054 * a, 0.047 * a, 0.066 * a, [[sh, 1]]),
        R(x(0.006), 0.2, -0.004, 0.041 * a, 0.04 * a, 0.045 * a, [[sh, 1]]),
        R(x(0.006), 0.1, -0.008, 0.034, 0.036, 0.038, [[sh, 0.6], [ft, 0.4]]),
        R(x(0.006), 0.06, -0.008, 0.034, 0.038, 0.04, [[ft, 1]]),
      ];
    };

    // Skin: head and neck, forearms / hands, lower legs (covered parts are replaced by clothing shells).
    sb.tube(head, skin, { seg: 12, capEnd: true });
    const longSleeves = style === 'bushShirt' || style === 'jacket' || style === 'uniform' || style === 'hiVis' || style === 'jersey';
    const sleeveEnd = style === 'singlet' ? 0 : longSleeves ? 0.64 : 0.24;
    const trouserEnd = look.shorts ? 0.36 : 0.86;
    for (const s of [1, -1] as const) {
      const a = arm(s);
      const l = leg(s);
      sb.tube(a.slice(style === 'singlet' ? 0 : longSleeves ? 6 : 2), skin, { seg: 8, capEnd: true, capStart: true });
      sb.tube(l.slice(look.shorts ? 3 : 8), skin, { seg: 9 });
      if (sleeveEnd > 0) sb.tube(shell(a, 0, sleeveEnd, style === 'jacket' ? 0.016 : 0.008, longSleeves ? 8 : 3, 0.006), topColor, { seg: 9, group: topGroup, capStart: true });
      sb.tube(shell(l, 0, trouserEnd, look.shorts ? 0.012 : 0.007, look.shorts ? 4 : 9, look.shorts ? 0.01 : 0.004), legsC, { seg: 10 });
      // Shoe: lofted along z from heel to toe, sole flat on the ground.
      const fx = s * (hipX + 0.006);
      const shoeRings: Ring[] = [
        [-0.085, 0.036, 0.062],
        [-0.05, 0.046, 0.088],
        [0.02, 0.05, 0.084],
        [0.09, 0.052, 0.062],
        [0.15, 0.05, 0.046],
        [0.185, 0.036, 0.03],
      ].map(([z, hw, h]) => ({ x: fx * H, y: (h / 2) * H, z: z * H, rx: hw * H, rf: (h / 2) * H, rb: (h / 2) * H, w: [[s === 1 ? B.footL : B.footR, 1]] as Weights }));
      sb.tube(shoeRings, shoe, { seg: 8, along: 'z', capStart: true, capEnd: true });
    }
    // Pelvis (trousers) then the top over it, with a hem.
    sb.tube(shell(torso, 0, 0.36, 0.006, 4, 0), legsC, { seg: 14, capStart: true });
    const topGrow = style === 'jacket' ? 0.018 : style === 'singlet' ? 0.004 : 0.009;
    sb.tube(shell(torso, 0.23, style === 'singlet' ? 0.86 : 0.97, topGrow, 9, 0).reverse(), topColor, { seg: 14, group: topGroup });
    if (style === 'singlet') sb.tube(torso.slice(7), skin, { seg: 12 });
    else if (style === 'bushShirt' || style === 'jacket' || style === 'uniform') {
      // Collar.
      sb.tube(shell(torso, 0.9, 1, 0.014, 2, 0.012), topColor, { seg: 12, group: topGroup });
    }
    if (style === 'hiVis') sb.tube(shell(torso, 0.5, 0.56, 0.014, 1, 0), col(0xd8d8d0), { seg: 14 });

    // Face.
    const hy = (v: number) => v * H;
    sb.blob(0, hy(1.646), hy(0.114), hy(0.014), hy(0.024), hy(0.016), skin, B.head, 5);
    for (const s of [1, -1]) {
      sb.blob(s * hy(0.034), hy(1.679), hy(0.1), hy(0.012), hy(0.0065), hy(0.006), col(0xf4f0e8), B.head, 4);
      sb.blob(s * hy(0.034), hy(1.679), hy(0.104), hy(0.006), hy(0.006), hy(0.004), dark, B.head, 4);
      sb.box(s * hy(0.034), hy(1.697), hy(0.104), hy(0.03), hy(0.0055), hy(0.006), hair, B.head);
      sb.blob(s * hy(0.086), hy(1.662), hy(0.006), hy(0.009), hy(0.026), hy(0.015), skin, B.head, 4);
    }
    sb.box(0, hy(1.606), hy(0.103), hy(0.038), hy(0.0055), hy(0.006), col(look.female ? 0x9a4a48 : 0x8a5a4c), B.head);

    // Hair and hats.
    const hat = look.hat ?? 'none';
    const hairStyle = look.hairStyle ?? (fem ? 'long' : 'short');
    const cap = (grow: number, from: number, colour: THREE.Color, frontLift = 0) => {
      const rings = head.slice(from).map((r, i) => ({ ...r, rx: r.rx + grow, rf: r.rf + grow * (i === 0 ? frontLift : 1), rb: r.rb + grow }));
      sb.tube(rings, colour, { seg: 12, capEnd: true });
    };
    if (hairStyle !== 'bald' && hat !== 'helmet') {
      cap(hy(0.007), 7, hair, 0.4);
      // Sides and back below the crown.
      const back = (y0: number, y1: number, depth: number) => {
        const rings: Ring[] = [];
        for (let i = 0; i <= 4; i++) {
          const y = y1 + ((y0 - y1) * i) / 4;
          rings.push(R(0, y, -0.03 - depth * 0.3, 0.079 - i * 0.004, 0.02, 0.079 + depth, [[B.head, y > 1.5 ? 1 : 0.4], [B.neck, y > 1.5 ? 0 : 0.6]]));
        }
        sb.tube(rings, hair, { seg: 10, capEnd: true });
      };
      if (hairStyle === 'short') back(1.74, 1.6, 0.012);
      if (hairStyle === 'mullet') back(1.74, 1.47, 0.02);
      if (hairStyle === 'long') back(1.74, 1.38, 0.022);
      if (hairStyle === 'bob') back(1.74, 1.53, 0.026);
    }
    if (hat === 'cap' || hat === 'police') {
      cap(hy(0.012), 8, hatC, 1);
      sb.box(0, hy(1.735), hy(0.135), hy(0.13), hy(0.012), hy(0.09), hatC, B.head);
      if (hat === 'police') sb.box(0, hy(1.752), hy(0.09), hy(0.05), hy(0.03), hy(0.01), col(0xd8d8d0), B.head);
    } else if (hat === 'beanie') {
      cap(hy(0.014), 7, hatC, 1);
    } else if (hat === 'brim') {
      cap(hy(0.012), 8, hatC, 1);
      sb.blob(0, hy(1.742), hy(0.008), hy(0.19), hy(0.008), hy(0.2), hatC, B.head, 8);
    } else if (hat === 'helmet') {
      sb.blob(0, hy(1.69), hy(0.008), hy(0.118), hy(0.125), hy(0.135), hatC, B.head, 8);
    }

    const geometry = sb.build();
    bodyMaterial ??= m.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }));
    const materials: THREE.Material[] = [bodyMaterial];
    if (hasPattern) materials.push(patternMaterial(style as 'bushShirt' | 'jersey', look.top, m));
    this.mesh = new THREE.SkinnedMesh(geometry, materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.add(this.bones[B.hips]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.group.add(this.mesh);

    this.hand.position.set(0, -0.085 * H, 0.03 * H);
    // Held objects are modelled pointing along +z; down the forearm is the bone's -y.
    this.hand.rotation.x = Math.PI / 2;
    this.bones[B.handR].add(this.hand);
  }

  setPose(pose: HumanoidPose, options: { speed?: number; aimPitch?: number } = {}) {
    if (pose !== this.pose) {
      this.pose = pose;
      this.poseTime = 0;
    }
    this.speed = options.speed ?? 0;
    this.aimPitch = options.aimPitch ?? 0;
  }

  setHeld(object: THREE.Object3D | null) {
    if (this.held) this.hand.remove(this.held);
    this.held = object;
    if (object) this.hand.add(object);
  }

  handPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.hand.getWorldPosition(target);
  }

  update(dt: number) {
    this.poseTime += dt;
    const t = this.target;
    Object.assign(t, REST);
    const speed = this.speed;
    switch (this.pose) {
      case 'idle': {
        this.phase += dt * 1.5;
        const b = Math.sin(this.phase);
        t.spine = b * 0.012;
        t.rootY = b * 0.004;
        t.hipSway = Math.sin(this.phase * 0.31) * 0.02;
        t.armL = 0.04 + b * 0.015;
        t.armR = 0.04 - b * 0.015;
        t.headYaw = Math.sin(this.phase * 0.23) * 0.18;
        break;
      }
      case 'walk':
      case 'run': {
        const run = this.pose === 'run';
        // Stride frequency follows speed so feet do not skate.
        this.phase += dt * (run ? 4.6 + speed * 1.15 : 2.4 + speed * 2.9);
        const s = Math.sin(this.phase);
        const c = Math.cos(this.phase);
        const amp = run ? 0.85 : 0.42 + Math.min(0.14, speed * 0.05);
        t.legL = s * amp + (run ? 0.12 : 0.02);
        t.legR = -s * amp + (run ? 0.12 : 0.02);
        // Knee flexes through the swing phase (leg travelling forward) and stays near straight in stance.
        const swingL = Math.max(0, c);
        const swingR = Math.max(0, -c);
        t.kneeL = swingL * swingL * (run ? 1.75 : 0.95) + (run ? 0.22 : 0.06);
        t.kneeR = swingR * swingR * (run ? 1.75 : 0.95) + (run ? 0.22 : 0.06);
        t.armL = -s * amp * (run ? 0.95 : 0.7) + 0.05;
        t.armR = s * amp * (run ? 0.95 : 0.7) + 0.05;
        t.elbowL = run ? -1.35 : -0.28 - Math.max(0, -s) * 0.25;
        t.elbowR = run ? -1.35 : -0.28 - Math.max(0, s) * 0.25;
        t.armLOut = t.armROut = run ? 0.12 : 0.05;
        t.spine = run ? 0.2 : 0.045;
        t.rootY = -Math.abs(s) * (run ? 0.055 : 0.022) + (run ? -0.02 : 0);
        t.twist = -s * (run ? 0.16 : 0.08);
        t.hipSway = s * (run ? 0.03 : 0.045);
        break;
      }
      case 'jump':
      case 'fall': {
        t.legL = 0.55;
        t.kneeL = 1.0;
        t.legR = -0.2;
        t.kneeR = 0.55;
        t.armL = t.armR = -0.5;
        t.armLOut = t.armROut = 0.75;
        t.elbowL = t.elbowR = -0.5;
        break;
      }
      case 'aim':
      case 'aimRifle': {
        const rifle = this.pose === 'aimRifle';
        // The forearm stays in line with the upper arm so a held barrel points where the arm points.
        // aimPitch is positive when aiming DOWN (callers pass minus the elevation).
        t.armR = -Math.PI / 2 + this.aimPitch;
        t.armROut = rifle ? 0.06 : -0.1;
        t.elbowR = -0.06;
        t.armL = -Math.PI / 2 + 0.1 + this.aimPitch;
        t.armLOut = rifle ? -0.55 : -0.46;
        t.elbowL = rifle ? -0.45 : -0.28;
        t.twist = rifle ? -0.42 : -0.1;
        t.spine = 0.06;
        t.head = this.aimPitch * 0.5;
        t.headYaw = rifle ? 0.3 : 0.08;
        if (speed > 0.3) {
          this.phase += dt * (2.4 + speed * 2.9);
          const s = Math.sin(this.phase);
          const c = Math.cos(this.phase);
          t.legL = s * 0.4;
          t.legR = -s * 0.4;
          t.kneeL = Math.max(0, c) ** 2 * 0.8 + 0.1;
          t.kneeR = Math.max(0, -c) ** 2 * 0.8 + 0.1;
        } else {
          t.legL = 0.12;
          t.legR = -0.14;
          t.kneeL = t.kneeR = 0.12;
          t.rootY = -0.015;
        }
        break;
      }
      case 'punch': {
        const p = Math.min(1, this.poseTime / 0.3);
        const jab = Math.sin(p * Math.PI);
        t.armR = -1.5 * jab - 0.35;
        t.elbowR = -1.7 * (1 - jab) - 0.1;
        t.armL = -0.95;
        t.elbowL = -1.75;
        t.twist = -0.55 * jab + 0.2;
        t.spine = 0.14;
        t.legL = 0.28;
        t.legR = -0.22;
        t.kneeL = 0.2;
        t.kneeR = 0.15;
        break;
      }
      case 'cower': {
        t.rootY = -0.4;
        t.legL = t.legR = 1.35;
        t.kneeL = t.kneeR = 2.25;
        t.spine = 0.7;
        t.armL = t.armR = -2.55;
        t.elbowL = t.elbowR = -1.9;
        t.armLOut = t.armROut = 0.3;
        t.head = 0.45;
        break;
      }
      case 'handsUp': {
        t.armL = t.armR = -2.95;
        t.armLOut = t.armROut = 0.38;
        t.elbowL = t.elbowR = -0.35;
        break;
      }
      case 'point': {
        t.armR = -2.35;
        t.armROut = 0.12;
        t.elbowR = -0.08;
        t.head = -0.2;
        break;
      }
      case 'orate': {
        t.armR = -1.85;
        t.armROut = 0.4;
        t.elbowR = -0.55;
        t.head = -0.08;
        break;
      }
      case 'drive':
      case 'sit': {
        t.rootY = -this.hipY + 0.16;
        t.legL = t.legR = 1.32;
        t.kneeL = t.kneeR = 1.2;
        t.spine = -0.1;
        if (this.pose === 'drive') {
          t.armL = t.armR = -1.12;
          t.elbowL = t.elbowR = -0.5;
          t.armLOut = t.armROut = -0.06;
        } else {
          t.armL = t.armR = -0.35;
          t.elbowL = t.elbowR = -0.9;
        }
        break;
      }
      case 'ride': {
        t.rootY = -this.hipY + 0.4;
        t.legL = t.legR = 1.05;
        t.kneeL = t.kneeR = 1.55;
        t.spine = 0.5;
        t.armL = t.armR = -1.3;
        t.elbowL = t.elbowR = -0.3;
        t.armLOut = t.armROut = 0.14;
        t.head = -0.42;
        break;
      }
      case 'dead': {
        t.rootPitch = -Math.PI / 2;
        t.rootY = -this.hipY + 0.11;
        t.armLOut = 0.95;
        t.armROut = 0.55;
        t.elbowL = -0.5;
        t.legL = 0.16;
        t.legR = -0.1;
        t.kneeR = 0.3;
        t.headYaw = 0.6;
        break;
      }
    }

    const rate = this.pose === 'punch' ? 30 : this.pose === 'dead' ? 6 : 13;
    const j = this.j;
    for (const key of Object.keys(j) as (keyof Joints)[]) j[key] = damp(j[key], t[key], rate, dt);

    const b = this.bones;
    b[B.hips].position.y = this.hipY + j.rootY;
    b[B.hips].rotation.set(j.rootPitch, j.twist * -0.35, j.hipSway);
    b[B.spine].rotation.set(j.spine * 0.5, j.twist * 0.5, -j.hipSway * 0.6);
    b[B.chest].rotation.set(j.spine * 0.5, j.twist * 0.85, -j.hipSway * 0.4);
    b[B.neck].rotation.set(j.head * 0.5 - j.spine * 0.35, j.headYaw * 0.5 - j.twist * 0.5, 0);
    b[B.head].rotation.set(j.head * 0.5 - j.spine * 0.3, j.headYaw * 0.5 - j.twist * 0.5, 0);
    b[B.armL].rotation.set(j.armL, 0, j.armLOut);
    b[B.armR].rotation.set(j.armR, 0, -j.armROut);
    b[B.foreL].rotation.x = j.elbowL;
    b[B.foreR].rotation.x = j.elbowR;
    b[B.legL].rotation.set(-j.legL, 0, -j.hipSway * 0.5);
    b[B.legR].rotation.set(-j.legR, 0, -j.hipSway * 0.5);
    b[B.shinL].rotation.x = j.kneeL;
    b[B.shinR].rotation.x = j.kneeR;
    // Feet stay roughly level with the ground while standing or walking.
    const flat = this.pose === 'drive' || this.pose === 'sit' || this.pose === 'ride' || this.pose === 'dead' || this.pose === 'cower' ? 0.25 : 0.85;
    b[B.footL].rotation.x = (j.legL - j.kneeL) * flat;
    b[B.footR].rotation.x = (j.legR - j.kneeR) * flat;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    this.group.removeFromParent();
  }
}

/** A person: the rigged glTF model when those assets are loaded, otherwise the code-built figure. */
export function createHumanoid(look: HumanoidLook, materials: MaterialLibrary): Humanoid {
  return createGltfHumanoid(look, materials) ?? new HumanoidRig(look, materials);
}
