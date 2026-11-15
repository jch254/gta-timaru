import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { buildLods, type BodyLods } from './lods';
import { buildDerivedClips } from './poses';
import { tailor, type Fit } from './tailor';

/**
 * Loads the character models (see scripts/assets/characters/build.mjs for how they are made) and turns
 * them into templates: one body per sex (a single skinned mesh whose index ranges are the selectable
 * parts) and one set of animation clips per body, each split into a lower-body and an upper-body half.
 */

export interface HeadMetrics {
  /** All in the body's bind space (metres, T-pose, feet near y = 0). */
  top: number;
  hatLine: number;
  eyeY: number;
  earY: number;
  rx: number;
  z0: number;
  z1: number;
  skullZ0: number;
  skullZ1: number;
}

interface BodyExtras {
  parts: Record<string, [start: number, count: number]>;
  uvMetres: number;
  skinGain: number;
  lift: number;
  head: HeadMetrics;
  hairStyles: string[];
}

interface AnimExtras {
  fps: number;
  clips: Record<string, [start: number, frames: number]>;
  speeds: Record<string, number>;
  pelvisY: number;
}

/** One animation as raw keys: a quaternion per bone per frame, plus the hips' position. */
export interface ClipData {
  name: string;
  frames: number;
  fps: number;
  rotations: Map<string, Float32Array>;
  pelvis: Float32Array;
}

/** A clip split in two so legs and torso can play different things. */
export interface ClipPair {
  name: string;
  duration: number;
  lower: THREE.AnimationClip;
  upper: THREE.AnimationClip;
  /** Hip height above the origin on the first frame (bind-space metres): used to seat the figure. */
  pelvisY: number;
  /** Orientation of the hips on the first frame, in model space. */
  pelvisQuat: THREE.Quaternion;
}

export interface BodyTemplate {
  female: boolean;
  /** The 'Armature' group: the skinned mesh and the root bone. Cloned per instance. */
  scene: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  parts: Record<string, [start: number, count: number]>;
  /** Cheaper versions of the geometry for figures further off. */
  lods: BodyLods;
  /** Where the garments begin and end, in the bind pose. */
  fit: Fit;
  skinMap: THREE.Texture | null;
  skinNormal: THREE.Texture | null;
  skinGain: number;
  uvMetres: number;
  /** Height of the sole under the bind-space origin. */
  lift: number;
  head: HeadMetrics;
  hairStyles: Set<string>;
  /** Rest pose, model space. */
  headRest: THREE.Matrix4;
  rootQuat: THREE.Quaternion;
  clips: Map<string, ClipPair>;
  /** Ground speed each locomotion clip was animated at (m/s, before scaling). */
  speeds: { walk: number; jog: number; sprint: number };
}

export const LOWER_BONES = new Set(['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);

const templates: { male: BodyTemplate | null; female: BodyTemplate | null } = { male: null, female: null };

export function bodyTemplate(female: boolean): BodyTemplate | null {
  return female ? templates.female : templates.male;
}

export function charactersReady(): boolean {
  return templates.male !== null && templates.female !== null;
}

function sliceClips(gltf: GLTF): { clips: ClipData[]; extras: AnimExtras } {
  const extras = gltf.userData as AnimExtras;
  const source = gltf.animations[0];
  if (!source || !extras.clips) throw new Error('characters: animation file has no clip table');
  const clips: ClipData[] = [];
  for (const [name, [start, frames]] of Object.entries(extras.clips)) {
    const data: ClipData = { name, frames, fps: extras.fps, rotations: new Map(), pelvis: new Float32Array(frames * 3) };
    for (const track of source.tracks) {
      const dot = track.name.lastIndexOf('.');
      const bone = track.name.slice(0, dot);
      if (track.name.endsWith('.quaternion')) data.rotations.set(bone, (track.values as Float32Array).slice(start * 4, (start + frames) * 4));
      else if (track.name === 'pelvis.position') data.pelvis = (track.values as Float32Array).slice(start * 3, (start + frames) * 3);
    }
    clips.push(data);
  }
  return { clips, extras };
}

/** Turn raw keys into the lower / upper pair of clips the mixer plays. */
export function makeClipPair(data: ClipData, pelvisScale: number, rootQuat: THREE.Quaternion): ClipPair {
  const times = new Float32Array(data.frames);
  for (let i = 0; i < data.frames; i++) times[i] = i / data.fps;
  const lower: THREE.KeyframeTrack[] = [];
  const upper: THREE.KeyframeTrack[] = [];
  for (const [bone, values] of data.rotations) (LOWER_BONES.has(bone) ? lower : upper).push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  const pelvis = pelvisScale === 1 ? data.pelvis : data.pelvis.map((v) => v * pelvisScale);
  lower.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvis));
  const duration = (data.frames - 1) / data.fps;
  const q = data.rotations.get('pelvis')!;
  // The hips' local translation is in the root bone's frame (rotated a quarter turn about x): local z is up.
  return {
    name: data.name,
    duration,
    lower: new THREE.AnimationClip(`${data.name}.lower`, duration, lower),
    upper: new THREE.AnimationClip(`${data.name}.upper`, duration, upper),
    pelvisY: pelvis[2],
    pelvisQuat: rootQuat.clone().multiply(new THREE.Quaternion(q[0], q[1], q[2], q[3])),
  };
}

function makeTemplate(gltf: GLTF, female: boolean, anims: { clips: ClipData[]; extras: AnimExtras }): BodyTemplate {
  const extras = gltf.userData as BodyExtras;
  const scene = gltf.scene.getObjectByName('Armature') ?? gltf.scene;
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh || !extras.parts) throw new Error('characters: body file has no skinned mesh or part table');
  const body = mesh as THREE.SkinnedMesh;
  const material = body.material as THREE.MeshStandardMaterial;
  for (const map of [material.map, material.normalMap]) {
    if (!map) continue;
    map.anisotropy = 4;
  }
  // Re-cut the clothes before anything is derived from the mesh.
  const fit = tailor(body.geometry, extras.parts);
  scene.updateMatrixWorld(true);
  const head = scene.getObjectByName('Head');
  const root = scene.getObjectByName('root');
  const pelvis = scene.getObjectByName('pelvis');
  if (!head || !root || !pelvis) throw new Error('characters: skeleton is missing bones');
  const rootQuat = root.quaternion.clone();
  // Clips were baked for the male skeleton; scale the hips' travel to this body's leg length.
  const pelvisScale = pelvis.getWorldPosition(new THREE.Vector3()).y / anims.extras.pelvisY;
  const template: BodyTemplate = {
    female,
    scene,
    geometry: body.geometry,
    parts: extras.parts,
    lods: buildLods(body.geometry, extras.parts, body.skeleton.bones.map((bone) => bone.name)),
    fit,
    skinMap: material.map,
    skinNormal: material.normalMap,
    skinGain: extras.skinGain,
    uvMetres: extras.uvMetres,
    lift: extras.lift,
    head: extras.head,
    hairStyles: new Set(extras.hairStyles),
    headRest: head.matrixWorld.clone(),
    rootQuat,
    clips: new Map(),
    speeds: { walk: anims.extras.speeds.Walk_Loop ?? 1, jog: anims.extras.speeds.Jog_Fwd_Loop ?? 5, sprint: anims.extras.speeds.Sprint_Loop ?? 8 },
  };
  const all = [...anims.clips, ...buildDerivedClips(cloneSkinned(scene), anims.clips, extras.head)];
  for (const data of all) template.clips.set(data.name, makeClipPair(data, pelvisScale, rootQuat));
  return template;
}

let loading: Promise<boolean> | null = null;

export function loadCharacters(onProgress?: (fraction: number) => void): Promise<boolean> {
  loading ??= (async () => {
    try {
      const files = import.meta.glob('../../assets/models/characters/*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
      const find = (name: string) => Object.entries(files).find(([path]) => path.endsWith(`/${name}.glb`))?.[1];
      const wanted = ['male', 'female', 'anims'].map(find);
      if (wanted.some((w) => !w)) return false;
      const loader = new GLTFLoader();
      let done = 0;
      const [male, female, anims] = await Promise.all(
        wanted.map(async (resolve) => {
          const gltf = await loader.loadAsync(await resolve!());
          onProgress?.(++done / wanted.length);
          return gltf;
        }),
      );
      const sliced = sliceClips(anims);
      templates.male = makeTemplate(male, false, sliced);
      templates.female = makeTemplate(female, true, sliced);
      return true;
    } catch (error) {
      console.warn('Character models unavailable; using the code-built figures.', error);
      templates.male = templates.female = null;
      return false;
    }
  })();
  return loading;
}
