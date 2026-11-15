import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Humanoid, HumanoidLook, HumanoidPose, MaterialLibrary } from '../../core/types';
import type { BodyTemplate, ClipPair } from './assets';
import { hatGeometry } from './hats';
import { bodyVariant, hairOf, lookMaterials, shadowVariant, sleevesOf, type LookMaterials } from './looks';

/**
 * One rigged figure. Legs and torso are animated as two channels, each cross-fading between clips, so a
 * person can walk while aiming or throw a punch on the move. Faces +z, origin at the feet.
 */

/** Standing height of an average man (metres); women are 6% shorter, as on the code-built figure. */
const HEIGHT = 1.78;
const FEMALE_HEIGHT = 0.94;
/**
 * The base bodies are comic-book broad. Width (x and z) is narrowed to ordinary proportions and then
 * widened again by the look's bulk; the head is scaled back so faces stay the same.
 */
const BASE_WIDTH = { male: 0.9, female: 0.95 };
/** The base bodies are over eight heads tall; a slightly larger head reads as an ordinary person. */
const HEAD_SIZE = 1.06;
/** Cross-fade rate (1/s): about 0.2 s to settle. */
const FADE = 14;
/** Hips above the origin when seated, to match the code-built figure the vehicles were laid out for. */
const SEAT = 0.16;
const BIKE_SEAT = 0.4;
/** Grip point in the right hand bone's frame: out along the palm, on the palm side, towards the thumb. */
const PALM = new THREE.Vector3(-0.03, 0.088, 0.016);
/** Where the sprint clip's stride sits relative to the walk and jog cycles. */
const SPRINT_PHASE = 0.92;

/** Least time between animation updates at each level of detail (seconds): distant figures tick at 30 and 15 Hz. */
const TICK = [0, 0, 1 / 30, 1 / 15];
/** Index start that puts a draw range past the end of any index list: nothing is drawn. */
const NOTHING = 1e9;

/** Every rigged figure alive, for the crowd manager (crowd.ts) that sets their level of detail. */
export const figures = new Set<GltfHumanoid>();

/** The shadow stand-in is never seen in the colour pass, so its material only has to exist. */
let shadowMaterial: THREE.MeshBasicMaterial | null = null;

const LOWER = 0;
const UPPER = 1;
const enum Kind {
  Loop,
  Gait,
  Once,
}

interface Slot {
  pair: ClipPair;
  action: THREE.AnimationAction;
  weight: number;
  target: number;
  kind: Kind;
  /** Gait: phase offset. Once: the trigger it was started for. */
  tag: number;
}

const X = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _rx = new THREE.Quaternion();
const _vx = new THREE.Vector3();
const _vy = new THREE.Vector3();
const _vz = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _gait = { a: null as ClipPair | null, b: null as ClipPair | null, w: 0, cycle: 1, phaseA: 0, phaseB: 0 };

export class GltfHumanoid implements Humanoid {
  readonly group = new THREE.Group();
  private model: THREE.Object3D;
  private mesh!: THREE.SkinnedMesh;
  private mixer: THREE.AnimationMixer;
  private hold = new THREE.Group();
  private held: THREE.Object3D | null = null;
  private pelvis: THREE.Object3D;
  private spine: THREE.Object3D[];
  private hand: THREE.Object3D;
  private channels: [Slot[], Slot[]] = [[], []];
  private pose: HumanoidPose = 'idle';
  private speed = 0;
  private aimPitch = 0;
  private clock = Math.random() * 20;
  private gaitPhase = Math.random();
  /** Each figure idles at its own pace, so a crowd standing about does not sway in step. */
  private idleRate = 0.78 + Math.random() * 0.44;
  private trigger = 0;
  private punches = 0;
  private aimWeight = 0;
  private steadyWeight = 0;
  /** The spine as the mixer left it, and as it was after the aim layer: see `update`. */
  private spineBase = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private spineOut = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private spineBent = false;
  private rootY: number;
  private standY: number;
  private size: number;
  private snap = true;
  private mats: LookMaterials;
  /** Stands in for the body in the shadow pass only: a tenth of the triangles in one draw call. */
  private shadow: THREE.SkinnedMesh;
  private hat: THREE.Mesh | null = null;
  private variant: (level: number) => THREE.BufferGeometry;
  /** Level of detail drawn (0 full … 3 far), and whether anybody can see the figure at all. */
  private level = 0;
  private awake = true;
  /** Animation time not yet applied (figures out of sight or far away are not posed every frame). */
  private pending = Math.random() * 0.05;

  constructor(
    look: HumanoidLook,
    materials: MaterialLibrary,
    private body: BodyTemplate,
  ) {
    const female = body.female;
    this.model = cloneSkinned(body.scene);
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.mesh = o as THREE.SkinnedMesh;
    });
    const bone = (name: string) => this.model.getObjectByName(name)!;
    this.pelvis = bone('pelvis');
    this.spine = [bone('spine_01'), bone('spine_02'), bone('spine_03')];
    this.hand = bone('hand_r');

    // Size: uniform scale for height, x / z for build.
    const tall = HEIGHT * THREE.MathUtils.clamp(look.height ?? 1, 0.8, 1.25) * (female ? FEMALE_HEIGHT : 1);
    this.size = tall / (body.head.top + body.lift + (HEAD_SIZE - 1) * (body.head.top - body.head.eyeY + 0.1));
    const build = (female ? BASE_WIDTH.female : BASE_WIDTH.male) * THREE.MathUtils.clamp(look.bulk ?? 1, 0.85, 1.3) ** 0.85;
    this.model.scale.set(this.size * build, this.size, this.size * build);
    this.standY = this.rootY = body.lift * this.size;
    this.model.position.y = this.rootY;
    const head = bone('Head');

    // Body parts and materials for this look.
    const style = look.topStyle ?? 'tee';
    const hat = look.hat && look.hat !== 'none' ? look.hat : null;
    const mats = (this.mats = lookMaterials(look, body, materials));
    // No two heads quite the same shape: a little wider or narrower, longer or shorter.
    head.scale.set((HEAD_SIZE / build) * mats.traits.wide, HEAD_SIZE * mats.traits.long, HEAD_SIZE / build);
    const sleeves = sleevesOf(style);
    const hair = hairOf(look, body);
    this.variant = (level) => bodyVariant(body, level, sleeves, !!look.shorts, hair, hat !== null, look.hat);
    this.mesh.geometry = this.variant(0);
    this.mesh.material = mats.list;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = this.mesh.geometry.boundingSphere!.clone();
    this.mesh.boundingBox = this.mesh.geometry.boundingBox!.clone();
    this.mesh.userData.figure = true;
    // The shadow comes from a second mesh on the same skeleton. Its draw range is emptied just before the
    // colour pass would draw it and restored just before the shadow pass does, so it only ever casts.
    shadowMaterial ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const cast = shadowVariant(body, sleeves, !!look.shorts, hair, hat !== null);
    this.shadow = new THREE.SkinnedMesh(cast, shadowMaterial);
    this.shadow.position.copy(this.mesh.position);
    this.shadow.quaternion.copy(this.mesh.quaternion);
    this.shadow.scale.copy(this.mesh.scale);
    this.shadow.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    this.shadow.castShadow = true;
    this.shadow.boundingSphere = this.mesh.boundingSphere.clone();
    this.shadow.boundingBox = this.mesh.boundingBox.clone();
    this.shadow.userData.figure = true;
    this.shadow.onBeforeRender = () => cast.setDrawRange(NOTHING, 0);
    this.shadow.onBeforeShadow = () => cast.setDrawRange(0, Infinity);
    this.mesh.parent!.add(this.shadow);
    if (hat) {
      const mesh = (this.hat = new THREE.Mesh(hatGeometry(hat, look.hatColor ?? 0x25304a, body.head, female ? 'f' : 'm'), mats.hat));
      mesh.castShadow = true;
      mesh.userData.figure = true;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(body.headRest).invert();
      head.add(mesh);
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    this.group.add(this.model, this.hold);
    this.pose0(0);
    figures.add(this);
  }

  /**
   * Set by the crowd manager every frame: which level of detail to draw, whether the figure casts a shadow,
   * and whether it is anywhere it could be seen (figures that are not are not animated until they are).
   */
  setDetail(level: number, shadow: boolean, awake: boolean, legacy = false) {
    if (level !== this.level) {
      this.level = level;
      this.mesh.geometry = this.variant(level);
      this.mesh.material = level >= 3 ? this.mats.far() : this.mats.list;
      if (this.hat) this.hat.visible = level < 3;
    }
    this.shadow.visible = shadow && !legacy;
    this.mesh.castShadow = shadow && legacy;
    if (this.hat) this.hat.castShadow = shadow && (level < 2 || legacy);
    if (awake && !this.awake && this.pending > 0) {
      // Back in view: catch up in one step, without a visible blend from wherever it was left.
      this.snap = true;
      this.pose0(this.pending);
      this.pending = 0;
    }
    this.awake = awake;
  }

  /** Whether the figure is in a scene (pooled figures are kept but detached). */
  get attached(): boolean {
    let o: THREE.Object3D | null = this.group;
    while (o.parent) o = o.parent;
    return (o as THREE.Scene).isScene === true;
  }

  setPose(pose: HumanoidPose, options: { speed?: number; aimPitch?: number } = {}) {
    if (pose !== this.pose) {
      this.pose = pose;
      this.trigger++;
      if (pose === 'punch') this.punches++;
    }
    this.speed = options.speed ?? 0;
    this.aimPitch = options.aimPitch ?? 0;
  }

  setHeld(object: THREE.Object3D | null) {
    if (this.held) this.hold.remove(this.held);
    this.held = object;
    if (object) {
      this.hold.add(object);
      this.syncHold();
    }
  }

  handPosition(target: THREE.Vector3): THREE.Vector3 {
    this.syncHold();
    return this.hold.getWorldPosition(target);
  }

  update(dt: number) {
    this.pending = Math.min(this.pending + dt, 8);
    if (!this.awake || this.pending < TICK[this.level] * 0.9) return;
    const step = this.pending;
    this.pending = 0;
    this.pose0(step);
  }

  /** Advance the animation by `dt` and pose the skeleton. */
  private pose0(dt: number) {
    this.clock += dt;
    const pose = this.pose;
    const k = this.snap ? 1 : 1 - Math.exp(-dt * (pose === 'punch' ? 30 : FADE));
    for (const channel of this.channels) for (const slot of channel) slot.target = 0;

    const moving = this.speed > 0.3;
    let rootY = this.standY;
    let aiming = false;
    switch (pose) {
      case 'idle':
        this.loop(LOWER, 'Stand');
        this.loop(UPPER, 'Stand');
        break;
      case 'walk':
      case 'run': {
        const v = this.speed > 0.05 ? this.speed : pose === 'run' ? 5.2 : 1.3;
        this.locomotion(v, dt, true);
        break;
      }
      case 'jump':
        this.once(LOWER, 'Jump_Start', 0.1, 1);
        this.once(UPPER, 'Jump_Start', 0.1, 1);
        break;
      case 'fall':
        this.loop(LOWER, 'Jump_Loop');
        this.loop(UPPER, 'Jump_Loop');
        break;
      case 'aim':
      case 'aimRifle': {
        const clip = pose === 'aim' ? 'Pistol_Aim_Neutral' : 'Rifle_Aim';
        aiming = true;
        this.loop(UPPER, clip);
        if (moving) this.locomotion(this.speed, dt, false);
        else this.loop(LOWER, clip);
        break;
      }
      case 'punch': {
        // Alternate hands; skip the wind-up so the fist lands about a tenth of a second in.
        const clip = this.punches % 2 ? 'Punch_Cross' : 'Punch_Jab';
        this.once(UPPER, clip, clip === 'Punch_Cross' ? 0.13 : 0.1, 1.15);
        if (moving) this.locomotion(this.speed, dt, false);
        else this.once(LOWER, clip, clip === 'Punch_Cross' ? 0.13 : 0.1, 1.15);
        break;
      }
      case 'cower':
        this.loop(LOWER, 'Cower');
        this.loop(UPPER, 'Cower');
        break;
      case 'handsUp':
        this.loop(UPPER, 'Hands_Up');
        if (moving) this.locomotion(this.speed, dt, false);
        else this.loop(LOWER, 'Hands_Up');
        break;
      case 'point':
        this.loop(UPPER, 'Point_Up');
        if (moving) this.locomotion(this.speed, dt, false);
        else this.loop(LOWER, 'Point_Up');
        break;
      case 'drive':
      case 'sit':
      case 'ride': {
        const clip = pose === 'drive' ? 'Driving_Loop' : pose === 'sit' ? 'Sitting_Idle_Loop' : 'Ride';
        const pair = this.loop(LOWER, clip);
        this.loop(UPPER, clip);
        rootY = (pose === 'ride' ? BIKE_SEAT : SEAT) - pair.pelvisY * this.size;
        break;
      }
      case 'dead':
        this.once(LOWER, 'Death01', 0, 1);
        this.once(UPPER, 'Death01', 0, 1);
        break;
    }

    for (const channel of this.channels) {
      let total = 0;
      for (let i = channel.length - 1; i >= 0; i--) {
        const slot = channel[i];
        slot.weight += (slot.target - slot.weight) * k;
        if (slot.target === 0 && slot.weight < 0.004) {
          slot.action.stop();
          channel.splice(i, 1);
        } else total += slot.weight;
      }
      // Weights in a channel always add up to one, or the bind pose would leak in.
      for (const slot of channel) slot.action.setEffectiveWeight(total > 0 ? slot.weight / total : 1);
    }
    this.aimWeight += ((aiming ? 1 : 0) - this.aimWeight) * k;
    this.steadyWeight += ((aiming && moving ? 1 : 0) - this.steadyWeight) * k;
    this.rootY += (rootY - this.rootY) * k;
    this.model.position.y = this.rootY;
    this.snap = false;

    this.mixer.update(dt);

    // The mixer only writes a bone when its animated value changes, so on a held pose last frame's aim
    // tilt would still be there and would compound. Work from the spine as the mixer last set it.
    for (let i = 0; i < this.spine.length; i++) {
      const q = this.spine[i].quaternion;
      if (this.spineBent && q.equals(this.spineOut[i])) q.copy(this.spineBase[i]);
      else this.spineBase[i].copy(q);
    }
    this.spineBent = this.aimWeight > 0.002;
    if (this.spineBent) {
      this.applyAim(pose === 'aimRifle' ? 'Rifle_Aim' : 'Pistol_Aim_Neutral');
      for (let i = 0; i < this.spine.length; i++) this.spineOut[i].copy(this.spine[i].quaternion);
    }
    if (this.held) this.syncHold();
  }

  dispose() {
    this.setHeld(null);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.channels[0].length = this.channels[1].length = 0;
    this.group.removeFromParent();
    figures.delete(this);
    // Geometry, materials and textures are shared; only the bone texture belongs to this figure.
    this.mesh.skeleton.dispose();
    this.mats.release();
  }

  // ───────────── animation channels ─────────────

  private slot(channel: number, name: string, kind: Kind): Slot {
    const list = this.channels[channel];
    const pair = this.body.clips.get(name)!;
    for (const slot of list) if (slot.pair === pair && slot.kind === kind) return slot;
    const action = this.mixer.clipAction(channel === LOWER ? pair.lower : pair.upper);
    action.reset();
    action.setEffectiveWeight(0);
    action.play();
    const slot: Slot = { pair, action, weight: 0, target: 0, kind, tag: -1 };
    list.push(slot);
    return slot;
  }

  /** A looping clip, kept in step with its other half through the figure's own clock. */
  private loop(channel: number, name: string, weight = 1): ClipPair {
    const slot = this.slot(channel, name, Kind.Loop);
    if (slot.tag < 0) {
      slot.tag = 0;
      slot.action.setLoop(THREE.LoopRepeat, Infinity);
      slot.action.setEffectiveTimeScale(name === 'Stand' ? this.idleRate : 1);
      slot.action.time = slot.pair.duration > 0 ? this.clock % slot.pair.duration : 0;
    }
    slot.target = weight;
    return slot.pair;
  }

  /** A clip played once from `start` and held on its last frame; restarts whenever the pose is re-entered. */
  private once(channel: number, name: string, start: number, timeScale: number) {
    const slot = this.slot(channel, name, Kind.Once);
    if (slot.tag !== this.trigger) {
      slot.tag = this.trigger;
      slot.action.reset();
      slot.action.setLoop(THREE.LoopOnce, 1);
      slot.action.clampWhenFinished = true;
      slot.action.setEffectiveTimeScale(timeScale);
      slot.action.time = start;
      slot.action.play();
    }
    slot.target = 1;
  }

  /** A walk / jog / sprint clip driven by the shared stride phase rather than by its own clock. */
  private stride(channel: number, pair: ClipPair, weight: number, phase: number) {
    const slot = this.slot(channel, pair.name, Kind.Gait);
    if (slot.tag < 0) {
      slot.tag = 0;
      slot.action.setLoop(THREE.LoopRepeat, Infinity);
      slot.action.setEffectiveTimeScale(0);
    }
    const t = this.gaitPhase + phase;
    slot.action.time = (t - Math.floor(t)) * pair.duration;
    slot.target = weight;
  }

  /**
   * Blend walk → jog → sprint so the stride matches the ground speed: the two nearest clips are mixed
   * and both are played at the cycle length that makes the mix cover `speed` metres a second.
   */
  private locomotion(speed: number, dt: number, arms: boolean) {
    const clips = this.body.clips;
    const walk = clips.get('Walk_Loop')!;
    const jog = clips.get('Jog_Fwd_Loop')!;
    const sprint = clips.get('Sprint_Loop')!;
    const s = this.size;
    const v0 = this.body.speeds.walk * s;
    const v1 = this.body.speeds.jog * s;
    const v2 = this.body.speeds.sprint * s;
    const g = _gait;
    g.b = null;
    g.w = 0;
    g.phaseA = g.phaseB = 0;
    const mix = (a: ClipPair, va: number, b: ClipPair, vb: number) => {
      const sa = va * a.duration;
      const sb = vb * b.duration;
      g.a = a;
      g.b = b;
      g.w = THREE.MathUtils.clamp((speed * a.duration - sa) / (sb - sa - speed * (b.duration - a.duration)), 0, 1);
      g.cycle = a.duration + g.w * (b.duration - a.duration);
    };
    if (speed <= v0) {
      g.a = walk;
      g.cycle = (walk.duration * v0) / Math.max(speed, v0 * 0.4);
    } else if (speed < v1) mix(walk, v0, jog, v1);
    else if (speed < v2) {
      mix(jog, v1, sprint, v2);
      g.phaseB = SPRINT_PHASE;
    } else {
      g.a = sprint;
      g.phaseA = SPRINT_PHASE;
      g.cycle = (sprint.duration * v2) / Math.min(speed, v2 * 1.3);
    }
    this.gaitPhase = (this.gaitPhase + dt / g.cycle) % 1;
    this.stride(LOWER, g.a!, 1 - g.w, g.phaseA);
    if (g.b && g.w > 0) this.stride(LOWER, g.b, g.w, g.phaseB);
    if (arms) {
      this.stride(UPPER, g.a!, 1 - g.w, g.phaseA);
      if (g.b && g.w > 0) this.stride(UPPER, g.b, g.w, g.phaseB);
    }
  }

  // ───────────── procedural layers ─────────────

  /** Tilt the torso (and with it the arms and head) to the aim pitch; keep it square while the legs walk. */
  private applyAim(clip: string) {
    const hips = _qa.copy(this.body.rootQuat).multiply(this.pelvis.quaternion);
    const steady = this.steadyWeight * this.aimWeight;
    if (steady > 0.002) {
      // Hold the chest where the aim clip's own stance would have it, whatever the walking hips do.
      _qb.copy(hips).invert().multiply(this.body.clips.get(clip)!.pelvisQuat);
      this.spine[0].quaternion.premultiply(_qc.identity().slerp(_qb, steady));
    }
    const step = (this.aimPitch * this.aimWeight) / this.spine.length;
    if (Math.abs(step) < 1e-4) return;
    // Positive pitch aims down: a rotation about the figure's x axis, shared between the spine bones.
    _rx.setFromAxisAngle(X, step);
    for (const bone of this.spine) {
      _qd.copy(hips).invert().multiply(_rx).multiply(hips).multiply(bone.quaternion);
      bone.quaternion.copy(_qd);
      hips.multiply(_qd);
    }
  }

  /**
   * Keep the attach point in the right palm. It hangs off the figure's group rather than the hand bone so
   * held objects are never scaled or sheared by the body's build. Its +z runs out of the fist along the
   * hand, +y is the thumb side (up when the arm is raised); while aiming it is squared to the aim line.
   */
  private syncHold() {
    const hand = this.hand;
    hand.updateWorldMatrix(true, false);
    const e = hand.matrixWorld.elements;
    _vz.set(e[4], e[5], e[6]).normalize();
    _vy.set(e[8], e[9], e[10]);
    _vy.addScaledVector(_vz, -_vy.dot(_vz)).normalize();
    _vx.crossVectors(_vy, _vz);
    _qa.setFromRotationMatrix(_m.makeBasis(_vx, _vy, _vz));
    _qb.setFromRotationMatrix(_m.extractRotation(this.group.matrixWorld)).invert();
    this.hold.quaternion.copy(_qb.multiply(_qa));
    if (this.aimWeight > 0.002) this.hold.quaternion.slerp(_qc.setFromAxisAngle(X, this.aimPitch), this.aimWeight);
    this.hold.position.copy(this.group.worldToLocal(_p.copy(PALM).applyMatrix4(hand.matrixWorld)));
  }
}
