import * as THREE from 'three';
import type { ClipData, HeadMetrics } from './assets';

/**
 * Poses the animation library does not have (hands up, cowering, shouldering a long gun, riding a
 * motorbike), made at load time by re-posing arms and legs on top of a library clip with a little IK.
 * The result is ordinary clip data, so these cross-fade like any other animation.
 */

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => ['l', 'r'].flatMap((side) => ['01', '02', '03'].map((n) => `${f}_${n}_${side}`)));

class Poser {
  private bones = new Map<string, THREE.Object3D>();
  /** Bind pose of every bone (fingers straight, arms out). */
  readonly rest = new Map<string, THREE.Quaternion>();

  constructor(private scene: THREE.Object3D) {
    scene.traverse((o) => {
      this.bones.set(o.name, o);
      this.rest.set(o.name, o.quaternion.clone());
    });
    scene.position.set(0, 0, 0);
    scene.quaternion.identity();
    scene.scale.set(1, 1, 1);
  }

  /** Open the hands: 0 leaves the clip's fingers alone, 1 straightens them completely. */
  relaxFingers(amount: number) {
    for (const name of FINGERS) this.bones.get(name)?.quaternion.slerp(this.rest.get(name)!, amount);
  }

  bone(name: string): THREE.Object3D {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`characters: no bone ${name}`);
    return bone;
  }

  load(clip: ClipData, frame = 0) {
    for (const [name, values] of clip.rotations) this.bones.get(name)?.quaternion.fromArray(values, frame * 4);
    this.bone('pelvis').position.fromArray(clip.pelvis, frame * 3);
    this.scene.updateMatrixWorld(true);
  }

  position(name: string): THREE.Vector3 {
    this.scene.updateMatrixWorld(true);
    return this.bone(name).getWorldPosition(new THREE.Vector3());
  }

  private setWorld(bone: THREE.Object3D, world: THREE.Quaternion) {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  }

  /** Point a bone (its +y runs to its child) along a model-space direction, turning it as little as possible. */
  aim(name: string, direction: THREE.Vector3) {
    this.scene.updateMatrixWorld(true);
    const bone = this.bone(name);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const current = UP.clone().applyQuaternion(world);
    this.setWorld(bone, new THREE.Quaternion().setFromUnitVectors(current, direction.clone().normalize()).multiply(world));
  }

  /** Roll a bone about its own length until `localAxis` faces `towards` as nearly as it can. */
  twist(name: string, localAxis: THREE.Vector3, towards: THREE.Vector3) {
    this.scene.updateMatrixWorld(true);
    const bone = this.bone(name);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const axis = UP.clone().applyQuaternion(world);
    const from = localAxis.clone().applyQuaternion(world);
    from.addScaledVector(axis, -from.dot(axis));
    const to = towards.clone().addScaledVector(axis, -towards.dot(axis));
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
    from.normalize();
    to.normalize();
    const angle = Math.atan2(new THREE.Vector3().crossVectors(from, to).dot(axis), from.dot(to));
    this.setWorld(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(world));
  }

  /** Extra rotation about a model-space axis. */
  turn(name: string, axis: THREE.Vector3, angle: number) {
    this.scene.updateMatrixWorld(true);
    const bone = this.bone(name);
    this.setWorld(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  }

  /** Two-bone IK: put a hand at `target`, elbow towards `pole`; optionally set which way fingers and palm face. */
  reach(side: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3, hand?: { fingers: THREE.Vector3; palm: THREE.Vector3 }) {
    const shoulder = this.position(`upperarm_${side}`);
    const l1 = this.bone(`lowerarm_${side}`).position.length();
    const l2 = this.bone(`hand_${side}`).position.length();
    const to = target.clone().sub(shoulder);
    const d = THREE.MathUtils.clamp(to.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.004);
    const dir = to.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(bend, h);
    this.aim(`upperarm_${side}`, elbow.clone().sub(shoulder));
    this.aim(`lowerarm_${side}`, shoulder.clone().addScaledVector(dir, d).sub(elbow));
    if (hand) {
      this.aim(`hand_${side}`, hand.fingers);
      // The palm faces the hand bone's +x on the left hand and −x on the right.
      this.twist(`hand_${side}`, new THREE.Vector3(side === 'l' ? 1 : -1, 0, 0), hand.palm);
    }
  }

  /**
   * Clip data that is `base` with every bone this poser moved since `load(base)` changed: either held
   * rigid at its new rotation, or ('offset') keeping the clip's own motion on top of the new pose.
   */
  bake(name: string, base: ClipData, mode: 'hold' | 'offset' = 'hold'): ClipData {
    const rotations = new Map<string, Float32Array>();
    const first = new THREE.Quaternion();
    const q = new THREE.Quaternion();
    for (const [bone, values] of base.rotations) {
      const now = this.bones.get(bone)?.quaternion;
      first.fromArray(values, 0);
      if (!now || Math.abs(now.dot(first)) > 0.999999) {
        rotations.set(bone, values);
        continue;
      }
      const out = new Float32Array(values.length);
      const delta = now.clone().multiply(first.invert());
      for (let f = 0; f < base.frames; f++) {
        if (mode === 'hold') now.toArray(out, f * 4);
        else q.fromArray(values, f * 4).premultiply(delta).toArray(out, f * 4);
      }
      rotations.set(bone, out);
    }
    const shift = this.bone('pelvis').position.clone().sub(new THREE.Vector3().fromArray(base.pelvis, 0));
    const pelvis = shift.lengthSq() < 1e-10 ? base.pelvis : base.pelvis.map((value, i) => value + shift.getComponent(i % 3));
    return { name, frames: base.frames, fps: base.fps, rotations, pelvis };
  }

  /** `clip` with its fingers opened by `amount` on every frame. */
  openHands(clip: ClipData, amount: number): ClipData {
    const rotations = new Map(clip.rotations);
    const q = new THREE.Quaternion();
    for (const name of FINGERS) {
      const values = clip.rotations.get(name);
      const rest = this.rest.get(name);
      if (!values || !rest) continue;
      const out = new Float32Array(values.length);
      for (let f = 0; f < clip.frames; f++) q.fromArray(values, f * 4).slerp(rest, amount).toArray(out, f * 4);
      rotations.set(name, out);
    }
    return { ...clip, rotations };
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildDerivedClips(scratch: THREE.Object3D, clips: ClipData[], head: HeadMetrics): ClipData[] {
  const poser = new Poser(scratch);
  const get = (name: string) => {
    const clip = clips.find((c) => c.name === name);
    if (!clip) throw new Error(`characters: missing clip ${name}`);
    return clip;
  };
  const out: ClipData[] = [];
  const sides = [
    ['l', 1],
    ['r', -1],
  ] as const;

  // Standing about. The library's idle is a wide, braced, fists-clenched hero stance; bring the feet under
  // the hips and let the arms hang, keeping the clip's breathing and weight shifts on top.
  const idle = get('Idle_Loop');
  poser.load(idle);
  const grounded = Math.min(poser.position('ball_l').y, poser.position('ball_r').y);
  for (const [side, s] of sides) {
    poser.aim(`thigh_${side}`, v(s * 0.035, -1, 0.02));
    poser.aim(`calf_${side}`, v(s * 0.012, -1, -0.035));
    poser.aim(`foot_${side}`, v(s * 0.14, -0.445, 0.885));
    poser.aim(`upperarm_${side}`, v(s * 0.12, -1, -0.02));
    poser.aim(`lowerarm_${side}`, v(s * 0.07, -1, 0.17));
    poser.aim(`hand_${side}`, v(s * 0.03, -1, 0.12));
    poser.twist(`hand_${side}`, v(side === 'l' ? 1 : -1, 0, 0), v(-s, 0, 0.15));
  }
  poser.relaxFingers(0.62);
  // The hero idle glowers from under its brows; lift the chin to look ahead.
  poser.turn('neck_01', X, -0.07);
  poser.turn('Head', X, -0.12);
  // The hips ride on a quarter-turned root: its local z is up. Put the feet back on the ground.
  poser.bone('pelvis').position.z -= Math.min(poser.position('ball_l').y, poser.position('ball_r').y) - grounded;
  const stand = poser.bake('Stand', idle, 'offset');
  out.push(stand);
  out.push(poser.openHands(get('Walk_Loop'), 0.55), poser.openHands(get('Sitting_Idle_Loop'), 0.5));

  // Hands up: upper arms out to the side, forearms vertical, palms forward.
  poser.load(stand);
  poser.relaxFingers(0.7);
  for (const [side, s] of sides) {
    const shoulder = poser.position(`upperarm_${side}`);
    poser.reach(side, shoulder.clone().add(v(s * 0.2, 0.33, 0.1)), v(s, -0.7, -0.1), { fingers: v(s * 0.08, 1, 0.05), palm: v(0, 0, 1) });
  }
  out.push(poser.bake('Hands_Up', stand));

  // Holding forth: the right hand raised open beside the head, palm to the crowd, the left arm easy.
  poser.load(stand);
  poser.relaxFingers(0.78);
  poser.reach('r', poser.position('upperarm_r').add(v(-0.22, 0.3, 0.18)), v(-1, -0.5, -0.1), { fingers: v(-0.1, 1, 0.15), palm: v(0.2, 0.05, 1) });
  poser.turn('neck_01', X, -0.05);
  poser.turn('Head', X, -0.08);
  out.push(poser.bake('Orate', stand));

  // Pointing at the sky: right arm straight up and out, index finger extended, eyes following it.
  poser.load(stand);
  const sky = v(-0.14, 0.8, 0.58).normalize();
  poser.reach('r', poser.position('upperarm_r').addScaledVector(sky, 2), v(-1, -0.6, -0.2), { fingers: sky, palm: v(1, -0.35, 0) });
  for (const joint of ['01', '02', '03']) poser.bone(`index_${joint}_r`).quaternion.copy(poser.rest.get(`index_${joint}_r`)!);
  poser.turn('neck_01', X, -0.1);
  poser.turn('Head', X, -0.2);
  out.push(poser.bake('Point_Up', stand));

  // Cowering: crouched, head down, hands clasped over the back of the head.
  const crouch = get('Crouch_Idle_Loop');
  poser.load(crouch);
  poser.turn('spine_03', X, 0.18);
  poser.turn('neck_01', X, 0.3);
  const skull = poser.position('Head').add(v(0, head.top - head.eyeY, -0.03));
  for (const [side, s] of sides) {
    poser.reach(side, skull.clone().add(v(s * 0.075, -0.02, -0.03)), v(s, -0.1, 0.8), { fingers: v(-s * 0.75, 0.1, -0.55), palm: v(0, -1, 0.3) });
  }
  out.push(poser.bake('Cower', crouch));

  // Long gun at the shoulder: body bladed to the right, right hand at the grip, left hand under the fore-end.
  const pistol = get('Pistol_Aim_Neutral');
  poser.load(pistol);
  poser.turn('spine_02', Y, -0.32);
  poser.turn('neck_01', Y, 0.26);
  const pocket = poser.position('upperarm_r');
  const grip = pocket.clone().add(v(0.07, -0.085, 0.27));
  poser.reach('r', grip, v(-1, -0.9, -0.2), { fingers: v(0.05, 0.05, 1), palm: v(1, 0, 0) });
  poser.reach('l', grip.clone().add(v(0.03, 0.035, 0.31)), v(0.35, -1, 0), { fingers: v(-0.35, 0.2, 1), palm: v(-0.25, 1, 0) });
  out.push(poser.bake('Rifle_Aim', pistol));

  // Motorbike: leaning on to the bars, knees bent, feet on the pegs.
  const drive = get('Driving_Loop');
  poser.load(drive);
  poser.turn('pelvis', X, 0.16);
  poser.turn('spine_01', X, 0.2);
  poser.turn('spine_02', X, 0.14);
  poser.turn('neck_01', X, -0.22);
  poser.turn('Head', X, -0.16);
  const hips = poser.position('pelvis');
  for (const [side, s] of sides) {
    // Knees out round the tank, shins dropping nearly straight to the footpegs beside the engine.
    poser.aim(`thigh_${side}`, v(s * 0.6, -0.5, 0.55));
    poser.aim(`calf_${side}`, v(-s * 0.06, -1, -0.3));
    poser.aim(`foot_${side}`, v(0, -0.25, 0.95));
    poser.reach(side, hips.clone().add(v(s * 0.27, 0.36, 0.5)), v(s * 0.8, -0.7, 0), { fingers: v(0, -0.2, 1), palm: v(0, -1, 0) });
  }
  out.push(poser.bake('Ride', drive));
  return out;
}
