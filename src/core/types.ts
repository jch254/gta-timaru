/**
 * THE CONTRACT. Every module depends on this file and on nothing inside another module.
 * Systems reach each other only through GameContext and the typed event bus.
 *
 * Conventions
 *  - Units: metres, seconds, radians, kilograms. +x east, -z north, +y up.
 *  - Heading h: forward = (sin h, 0, cos h). h = 0 faces +z (south); increasing h turns left (towards +x).
 *    An Object3D facing its local +z shows heading h with `rotation.y = h`.
 *  - New Zealand drives on the LEFT; vehicles are right-hand drive.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { EventBus } from './events';

// ───────────────────────────── Systems & context ─────────────────────────────

export interface System {
  readonly name: string;
  /** Called once after every system has been constructed and attached to the context. */
  init?(): void | Promise<void>;
  /** Fixed 60 Hz step, before the physics step. Apply forces / kinematic targets here. */
  fixedUpdate?(dt: number): void;
  /** Once per rendered frame (dt clamped to 0.1 s). Skipped while paused. */
  update?(dt: number): void;
  /** After all updates and the camera, just before rendering. */
  lateUpdate?(dt: number): void;
  dispose?(): void;
}

export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  events: EventBus<GameEvents>;
  input: InputApi;
  settings: SettingsApi;
  clock: GameClock;
  env: Environment;
  gfx: GfxApi;
  physics: PhysicsApi;
  world: WorldApi;
  player: PlayerApi;
  vehicles: VehiclesApi;
  actors: ActorsApi;
  combat: CombatApi;
  peds: PedsApi;
  traffic: TrafficApi;
  police: PoliceApi;
  missions: MissionsApi;
  ui: UiApi;
  audio: AudioApi;
  save: SaveApi;
}

/**
 * Pausing: set `clock.paused` and emit 'pausedChanged'. While paused only `lateUpdate` runs (so menus stay
 * live) and the frame is still rendered.
 */
export interface GameClock {
  /** In-game hour, 0..24. */
  hour: number;
  /** In-game day counter, starts at 1. */
  day: number;
  /** Real seconds since the session started (not advanced while paused). */
  elapsed: number;
  /** Real seconds per in-game hour (default 60 → a day lasts 24 minutes). */
  secondsPerHour: number;
  paused: boolean;
  /** Skip forward (e.g. after dying). */
  advanceHours(hours: number): void;
}

export type WeatherKind = 'clear' | 'norwester' | 'southerly' | 'fog' | 'overcast';

/** Current atmosphere, written by render/sky + render/weather, read by everyone. */
/** AI drivers light their headlamps when env.night rises past this (the player's own beams come on a touch earlier). */
export const NIGHT_HEADLIGHTS = 0.35;

export interface Environment {
  weather: WeatherKind;
  /** 0 = full day, 1 = dead of night. */
  night: number;
  /** Unit vector pointing TOWARDS the sun (or moon at night). */
  sunDir: THREE.Vector3;
  /** Rain intensity 0..1. */
  rain: number;
  /** Road wetness 0..1 (lags rain). Vehicles lose grip as this rises. */
  wetness: number;
  /** Wind vector in m/s (x, z). */
  wind: { x: number; z: number };
  /** Approximate visibility distance in metres (fog / haze). */
  visibility: number;
  /** Force a weather change (missions, debug). */
  setWeather(kind: WeatherKind, transitionSeconds?: number): void;
}

// ───────────────────────────── Events ─────────────────────────────

export type CrimeType =
  | 'gunfire'
  | 'assault'
  | 'murder'
  | 'carTheft'
  | 'carjacking'
  | 'hitAndRun'
  | 'vehicleDamage'
  | 'copAssault'
  | 'copKilled'
  | 'recklessDriving';

export interface DamageInfo {
  amount: number;
  kind: 'bullet' | 'melee' | 'vehicle' | 'explosion' | 'fall' | 'fire' | 'drown';
  /** Who caused it, if known. */
  source?: Actor | null;
  /** World-space hit point and incoming direction, if known. */
  point?: THREE.Vector3;
  direction?: THREE.Vector3;
}

export interface GameEvents {
  /** A shot was fired (drives ped panic, police response, audio). */
  gunshot: { shooter: Actor; weaponId: string; position: THREE.Vector3; direction: THREE.Vector3 };
  /** A bullet / melee swing hit something static (for decals, sparks, audio). */
  impact: { position: THREE.Vector3; normal: THREE.Vector3; surface: 'world' | 'vehicle' | 'flesh' };
  actorDamaged: { actor: Actor; info: DamageInfo };
  actorDied: { actor: Actor; info: DamageInfo };
  vehicleDamaged: { vehicle: Vehicle; amount: number; source?: Actor | null };
  vehicleDestroyed: { vehicle: Vehicle; source?: Actor | null };
  /** Vehicle body hit something hard. `speed` is the closing speed in m/s. */
  vehicleCrash: { vehicle: Vehicle; speed: number; other: Vehicle | Actor | null };
  vehicleEntered: { actor: Actor; vehicle: Vehicle; stolen: boolean; ejected: Actor | null };
  vehicleExited: { actor: Actor; vehicle: Vehicle };
  /** Something illegal happened where it could be witnessed. Police module decides the consequences. */
  crime: { type: CrimeType; position: THREE.Vector3; offender: Actor; victim?: Actor | Vehicle | null };
  wantedChanged: { level: number; previous: number };
  playerDied: { info: DamageInfo };
  playerBusted: Record<string, never>;
  playerRespawned: { reason: 'died' | 'busted' | 'load' | 'new' };
  moneyChanged: { money: number; delta: number };
  missionStarted: { id: string };
  missionCompleted: { id: string; reward: number };
  missionFailed: { id: string; reason: string };
  weaponChanged: { weaponId: string };
  pickup: { kind: string; amount: number };
  zoneChanged: { name: string; city: CityId | null };
  hourChanged: { hour: number };
  weatherChanged: { weather: WeatherKind };
  radioChanged: { stationId: string | null; name: string };
  pausedChanged: { paused: boolean };
  qualityChanged: { quality: QualityLevel };
  horn: { vehicle: Vehicle };
}

// ───────────────────────────── Input & settings ─────────────────────────────

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'interact' // enter / exit vehicle, talk, pick up
  | 'fire'
  | 'aim'
  | 'reload'
  | 'melee'
  | 'nextWeapon'
  | 'prevWeapon'
  | 'handbrake'
  | 'horn'
  | 'radioNext'
  | 'radioPrev'
  | 'lookBack'
  | 'camera' // cycle camera distance
  | 'pause'
  | 'map'
  | 'skip'; // move the conversation on

export interface InputApi {
  /** Is the action currently held. */
  held(action: Action): boolean;
  /** Was the action pressed since the previous frame (edge). */
  pressed(action: Action): boolean;
  /** Movement / steering axes in -1..1. moveX: +1 = left (A), moveZ: +1 = forward (W). */
  moveX: number;
  moveZ: number;
  /** Analogue throttle / brake 0..1 (keyboard gives 0 or 1). */
  throttle: number;
  brake: number;
  /** Look delta this frame, already scaled to radians (yaw: + = turn left). */
  lookYaw: number;
  lookPitch: number;
  /** True while the mouse is captured (pointer lock) or a gamepad is active. */
  captured: boolean;
  /** Ask for pointer lock (must be called from a user gesture). */
  capture(): void;
  release(): void;
  /** Human-readable binding for prompts, e.g. label('interact') → 'F'. */
  label(action: Action): string;
  gamepadActive: boolean;
}

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface SettingsData {
  quality: QualityLevel;
  /** Dynamic resolution scaling to hold 60 fps. */
  dynamicResolution: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** Real stations on the car radio, streamed from the stations' own servers. */
  liveRadio: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  showFps: boolean;
}

export interface SettingsApi {
  data: SettingsData;
  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void;
  onChange(handler: (key: keyof SettingsData) => void): () => void;
}

// ───────────────────────────── Rendering ─────────────────────────────

/** Named PBR surface types with procedural textures. Use these rather than making raw materials. */
export type SurfaceKind =
  | 'asphalt'
  | 'concrete'
  | 'footpath'
  | 'gravel'
  | 'weatherboard'
  | 'brick'
  | 'bluestone'
  | 'limestone' // Oamaru stone
  | 'plaster'
  | 'corrugated'
  | 'rooftile'
  | 'slate'
  | 'timber'
  | 'glass'
  | 'metal'
  | 'paintedMetal'
  | 'grass'
  | 'sand'
  | 'shingle'
  | 'foliage'
  | 'bark'
  | 'cloth'
  | 'skin'
  | 'rubber'
  | 'chrome'
  | 'carpaint'
  | 'plain';

export interface MaterialOptions {
  color?: number;
  roughness?: number;
  metalness?: number;
  /** Texture repeats per metre (world-space tiling for box/extruded geometry helpers). Default per surface. */
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  doubleSided?: boolean;
  /** If true the material is tinted per-vertex / per-instance (vertexColors on). */
  vertexColors?: boolean;
}

export interface MaterialLibrary {
  /**
   * Cached PBR material for a surface + options. Identical arguments return the same instance,
   * so merged geometry batches well. Materials are already wired for cascaded shadows.
   */
  get(surface: SurfaceKind, options?: MaterialOptions): THREE.MeshStandardMaterial;
  /** Emissive window material whose glow follows night-time (shared; do not mutate). */
  windows(kind?: 'house' | 'shop' | 'office'): THREE.MeshStandardMaterial;
  /** Light-emitting material driven by the game (headlights, street lamps, neon). `night` scales with darkness. */
  emitter(color: number, mode: 'always' | 'night'): THREE.MeshStandardMaterial;
  /** Painted sign texture: text on a board. Cached by arguments. */
  sign(text: string, options?: SignOptions): THREE.MeshStandardMaterial;
  /** Register a material built elsewhere (rare) so shadows / quality apply. */
  register<T extends THREE.Material>(material: T): T;
  /**
   * Like `register`, with a shader patch that survives the library's own patching (shadows, fades). `key`
   * names the patch for the program cache. Optional so test doubles need not provide it: feature-detect.
   */
  registerPatched?<T extends THREE.Material>(material: T, key: string, patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void): T;
  /**
   * Lamp of a traffic signal: an aspect on one of the two crossing axes, lit and dimmed by the library on a
   * town-wide cycle. Optional so test doubles need not provide it: feature-detect.
   */
  signalLamp?(axis: 'a' | 'b', aspect: 'red' | 'amber' | 'green'): THREE.MeshStandardMaterial;
  /** Forget and dispose a per-object material made with `register` (e.g. a vehicle's paint) when its owner is removed. */
  release(material: THREE.Material): void;
}

export interface SignOptions {
  bg?: string;
  fg?: string;
  /** 'paint' = hand-painted serif, 'block' = condensed caps, 'script' = cursive, 'neon' = glowing at night. */
  style?: 'paint' | 'block' | 'script' | 'neon';
  /** Width / height ratio of the board (default 4). */
  aspect?: number;
  border?: boolean;
}

export interface GfxApi {
  renderer: THREE.WebGLRenderer;
  materials: MaterialLibrary;
  quality: QualityLevel;
  /**
   * A registered copy of `material` that is clipped away inside the near-detail radius. Use for distant
   * stand-ins (far terrain, skyline boxes) that full-detail chunks replace up close. World module only.
   */
  farVariant<T extends THREE.MeshStandardMaterial>(material: T): T;
  setNearFade(x: number, z: number, radius: number): void;
  /** A registered copy of `material` for backdrop scenery: a fixed blend towards the horizon colour instead of distance fog. */
  backdropVariant<T extends THREE.MeshStandardMaterial>(material: T, haze: number): T;
  /** Darkness 0..1 (mirrors `ctx.env.night`) and how many pooled point lights this quality level allows. */
  night: number;
  /** How wet the roads are, 0 dry … 1 streaming. */
  wetness: number;
  lampCount: number;
  /** Screen-space effects other systems may trigger. */
  flash(color: number, strength: number, seconds: number): void;
  /** Current smoothed frames per second and frame time (ms). */
  fps: number;
  frameMs: number;
  /** Renderer statistics for the last frame. */
  stats: { drawCalls: number; triangles: number; renderScale: number };
}

// ───────────────────────────── Physics ─────────────────────────────

/** Collision group bits. */
export const enum CollisionGroup {
  World = 1 << 0, // terrain, buildings, static props
  Vehicle = 1 << 1,
  Character = 1 << 2, // player, peds, police on foot
  Debris = 1 << 3, // small dynamic props (bins, signs)
  Sensor = 1 << 4,
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
  /** Game object that owns the collider, if registered. */
  owner: Actor | Vehicle | null;
}

export interface PhysicsApi {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  /** Interaction-group value: this collider is in `memberships` and collides with `filter` (bitmasks of CollisionGroup). */
  groups(memberships: number, filter: number): number;
  /** Associate a collider with its game object so raycasts / contacts can resolve it. */
  setOwner(collider: RAPIER.Collider, owner: Actor | Vehicle | null): void;
  ownerOf(collider: RAPIER.Collider): Actor | Vehicle | null;
  /** Ray cast against `mask` groups (default: World | Vehicle | Character). */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    options?: { mask?: number; excludeBody?: RAPIER.RigidBody | null; excludeOwner?: Actor | Vehicle | null },
  ): RayHit | null;
  /** True if nothing in World blocks the segment a→b. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** Fixed cuboid in the world (static props added outside chunk generation). Returns a remover. */
  addStaticBox(center: THREE.Vector3, halfExtents: THREE.Vector3, heading: number): () => void;
}

// ───────────────────────────── World ─────────────────────────────

export type CityId = 'christchurch' | 'timaru' | 'lyttelton' | 'newbrighton' | 'ashburton' | 'temuka' | 'rakaia' | 'washdyke';

export type RoadClass =
  | 'highway' // SH1 open road: 100 km/h, sealed shoulders
  | 'arterial' // four-lane avenue: 60 km/h
  | 'street' // ordinary sealed street: 50 km/h
  | 'lane' // narrow back street / service lane: 30 km/h
  | 'gravel' // rural side road
  | 'pedestrian'; // mall / square paving: no traffic

export type DistrictType =
  | 'cbd' // 3–10 storey commercial, stone civic buildings
  | 'shops' // 1–2 storey verandah shopfronts
  | 'villa' // weatherboard villas and bungalows
  | 'statehouse' // plainer state houses
  | 'industrial' // sheds, yards, car yards
  | 'port' // warehouses, tanks, containers
  | 'township' // small-town main street mix
  | 'park'
  | 'rural'
  | 'beach';

export interface District {
  id: string;
  /** Suburb / locality name shown on the HUD. */
  name: string;
  /** Te reo Māori name where one is well attested (shown alongside the English name in the HUD and map). */
  teReo?: string;
  city: CityId | null;
  type: DistrictType;
}

export interface EdgeSample {
  x: number;
  y: number;
  z: number;
  /** Unit tangent a→b. */
  tx: number;
  tz: number;
  /** Distance from node a. */
  s: number;
}

export interface RoadNode {
  index: number;
  x: number;
  y: number;
  z: number;
  /** Indices of connected edges. */
  edges: number[];
}

export interface RoadEdge {
  index: number;
  name: string;
  cls: RoadClass;
  /** Node indices. Samples run a → b. */
  a: number;
  b: number;
  /** Evenly spaced centreline samples (≈4 m apart), including both ends. */
  samples: EdgeSample[];
  length: number;
  /** Sealed carriageway width in metres. */
  width: number;
  /** Lanes per direction. */
  lanes: number;
  /** Speed limit in m/s. */
  speedLimit: number;
  /** Traffic may only travel a→b. */
  oneway: boolean;
  bridge: boolean;
  tunnel: boolean;
  /** Has kerbs and footpaths (urban). */
  footpaths: boolean;
  /** Vehicles (traffic AI) may use this edge. */
  drivable: boolean;
}

export interface RoadHit {
  edge: RoadEdge;
  /** Distance along the edge from node a. */
  s: number;
  /** Perpendicular distance from the centreline (always ≥ 0). */
  distance: number;
  /** Signed offset: + is left of the a→b direction. */
  offset: number;
  x: number;
  y: number;
  z: number;
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
  /** Nearest road centreline within maxDistance (≤ 60 m). */
  nearest(x: number, z: number, maxDistance?: number, filter?: (edge: RoadEdge) => boolean): RoadHit | null;
  /** Position on an edge at distance s from node a (clamped). */
  pointAt(edge: RoadEdge, s: number): EdgeSample;
  /**
   * Centre of a traffic lane. dir = 1 travels a→b, -1 travels b→a. Lane 0 is the kerb-side (leftmost) lane.
   * Returns world position and heading for a vehicle in that lane. Traffic keeps LEFT.
   */
  lanePoint(edge: RoadEdge, s: number, dir: 1 | -1, lane?: number): { x: number; y: number; z: number; heading: number };
  /** Footpath point: side = 1 is left of a→b, -1 right. */
  footpathPoint(edge: RoadEdge, s: number, side: 1 | -1): { x: number; y: number; z: number };
  /** The node at the far end of `edge` when travelling in `dir`. */
  endNode(edge: RoadEdge, dir: 1 | -1): RoadNode;
  /** Shortest drivable route between two nodes as a list of (edge, dir); null if unreachable. */
  route(fromNode: number, toNode: number): { edge: RoadEdge; dir: 1 | -1 }[] | null;
  nearestNode(x: number, z: number): RoadNode;
}

/** A named point authored in the map data (mission markers, spawn points, shop doors…). */
export interface Place {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  city: CityId | null;
  /** Free-form tags: 'hospital', 'police', 'safehouse', 'spawn', 'payphone', 'gunshop', 'spray', 'mission'… */
  tags: string[];
  /** Te reo Māori name where one is well attested. */
  teReo?: string;
}

export interface LandmarkPlacement {
  /** Builder id registered in world/landmarks (e.g. 'chch-cathedral'). */
  kind: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  /** Lots and props are kept out of this radius. */
  clearRadius: number;
  /** Visible from far away (kept loaded at any distance). */
  skyline?: boolean;
  params?: Record<string, number | string | boolean>;
}

/** A railway or tram line as a sampled path (for trains, trams, level crossings). */
export interface RailLine {
  name: string;
  kind: 'main' | 'tram' | 'siding';
  /** Points every ~6 m; y is ground height. */
  points: { x: number; y: number; z: number }[];
  length: number;
}

export type GroundSurface = 'road' | 'footpath' | 'gravel' | 'grass' | 'sand' | 'shingle' | 'water' | 'paving' | 'field';

export interface WorldApi {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  seaLevel: number;
  graph: RoadGraph;
  places: Place[];
  landmarks: LandmarkPlacement[];
  railways: RailLine[];
  /** Terrain height (ignores bridge decks and buildings). Cheap; safe to call often. */
  heightAt(x: number, z: number): number;
  /** Height to stand / drive on: terrain, or the bridge deck when over one. */
  groundAt(x: number, z: number): number;
  /** Terrain normal. */
  normalAt(x: number, z: number, target?: THREE.Vector3): THREE.Vector3;
  /** Water depth at a point (0 on dry land). Sea, harbour and river channels. */
  waterDepthAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): GroundSurface;
  districtAt(x: number, z: number): District;
  /** Building plots whose footprint may lie within `radius` of a point (built or not yet streamed in). Optional so test doubles need not provide it. */
  lotsNear?(x: number, z: number, radius: number): Lot[];
  /** Best human-readable location: street name when on one, else suburb. */
  locationName(x: number, z: number): string;
  place(id: string): Place;
  placesTagged(tag: string): Place[];
  nearestPlace(x: number, z: number, tag: string): Place | null;
  /** True once terrain + colliders exist around this point (safe to spawn physics objects). */
  isLoaded(x: number, z: number): boolean;
  /** Ask the streamer to load around an extra focus (cutscenes, far spawns). Returns a release function. */
  addFocus(x: number, z: number, radius: number): () => void;
  /** Resolves when the area around (x,z) is loaded. */
  whenLoaded(x: number, z: number): Promise<void>;
}

// ───────────────────────────── Actors ─────────────────────────────

export type ActorKind = 'player' | 'ped' | 'cop' | 'gang' | 'scripted';

export interface Actor {
  readonly id: number;
  readonly kind: ActorKind;
  /** Root object; position is the feet. */
  readonly group: THREE.Object3D;
  /** Feet position (same vector as group.position). */
  readonly position: THREE.Vector3;
  heading: number;
  /** World velocity, m/s. */
  readonly velocity: THREE.Vector3;
  health: number;
  maxHealth: number;
  armour: number;
  alive: boolean;
  /** Vehicle currently occupied, if any. */
  vehicle: Vehicle | null;
  /** Display name for barks / missions. */
  name?: string;
  /** Cannot be hurt (cameo characters): `takeDamage` changes nothing and a hit draws no blood. */
  readonly invulnerable?: boolean;
  takeDamage(info: DamageInfo): void;
}

export interface ActorsApi {
  /** Every live actor (player, peds, police…). Systems add/remove their own. */
  all: Set<Actor>;
  nextId(): number;
  /** Actors within radius of a point (cheap linear scan; counts are small). */
  near(x: number, z: number, radius: number, filter?: (a: Actor) => boolean): Actor[];
}

/** Poses the humanoid rig understands. */
export type HumanoidPose =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'fall'
  | 'aim'
  | 'aimRifle'
  | 'punch'
  | 'cower'
  | 'handsUp'
  | 'point' // one arm up, pointing at the sky
  | 'orate' // one hand raised to the crowd, palm out: holding forth
  | 'drive'
  | 'ride' // motorbike
  | 'sit'
  | 'dead';

export interface HumanoidLook {
  skin: number;
  hair: number;
  top: number;
  /** 'tee' | 'bushShirt' (plaid) | 'singlet' | 'jersey' (rugby stripe) | 'jacket' | 'uniform' | 'hiVis' */
  topStyle?: 'tee' | 'bushShirt' | 'singlet' | 'jersey' | 'jacket' | 'uniform' | 'hiVis';
  legs: number;
  /** Shorts (stubbies) instead of trousers. */
  shorts?: boolean;
  shoes: number;
  /** Sock colour (default off-white). */
  socks?: number;
  /** 'none' | 'cap' | 'beanie' | 'brim' | 'police' | 'helmet' */
  hat?: 'none' | 'cap' | 'beanie' | 'brim' | 'police' | 'helmet';
  hatColor?: number;
  /** Default: 'short' for men, 'long' for women. The mullet is period-correct. */
  hairStyle?: 'short' | 'long' | 'mullet' | 'bob' | 'bald';
  /** Body build multipliers (1 = average). */
  height?: number;
  bulk?: number;
  female?: boolean;
}

export interface Humanoid {
  readonly group: THREE.Group;
  /** Blend to a pose. `speed` (m/s) drives the gait; `aimPitch` tilts the arms when aiming. */
  setPose(pose: HumanoidPose, options?: { speed?: number; aimPitch?: number }): void;
  update(dt: number): void;
  /** Attach an object to the right hand (weapon) or remove with null. */
  setHeld(object: THREE.Object3D | null): void;
  /** World position of the right hand / muzzle attach point. */
  handPosition(target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export interface PlayerApi extends Actor {
  money: number;
  addMoney(delta: number): void;
  /** Teleport on foot (leaves any vehicle). */
  teleport(x: number, z: number, heading?: number): void;
  /** Put the player straight into a vehicle's driver seat. */
  warpIntoVehicle(vehicle: Vehicle): void;
  /** Freeze input (cutscenes, menus). */
  controlsEnabled: boolean;
  /** Aim direction (unit) and whether the player is aiming a weapon. */
  aimDirection(target: THREE.Vector3): THREE.Vector3;
  aiming: boolean;
  sprinting: boolean;
  /** The camera's yaw heading (for minimap rotation etc.). */
  cameraHeading: number;
  /** Play a one-off pose (punch, reload flinch…) for `seconds`, overriding locomotion. */
  playAction(pose: HumanoidPose, seconds: number): void;
  /** Kick the camera (recoil, explosions). 0..1. */
  shakeCamera(amount: number): void;
  heal(amount: number): void;
  addArmour(amount: number): void;
  /** Respawn points are Places tagged 'hospital' / 'police'. */
  respawn(reason: 'died' | 'busted' | 'load' | 'new', at?: { x: number; z: number; heading?: number }): void;
  humanoid: Humanoid;
}

// ───────────────────────────── Vehicles ─────────────────────────────

export type VehicleClass = 'sedan' | 'coupe' | 'hatch' | 'wagon' | 'ute' | 'truck' | 'van' | 'bike' | 'bus' | 'police' | 'tram';

export interface VehicleSpec {
  id: string;
  /** Invented make and model name, e.g. "Holbrook Chancellor". */
  name: string;
  cls: VehicleClass;
  /** Builder id in vehicles/models. */
  model: string;
  /** Overall body size in metres. */
  length: number;
  width: number;
  height: number;
  mass: number;
  wheelRadius: number;
  wheelWidth: number;
  wheelbase: number;
  track: number;
  /** 2 for motorbikes (physics still uses a hidden stabilised 4-wheel layout). */
  wheelCount: 2 | 4 | 6;
  /** Peak drive force in newtons (total). */
  engineForce: number;
  /** Top speed in m/s (drive force tapers to zero here). */
  topSpeed: number;
  reverseSpeed: number;
  drive: 'rwd' | 'fwd' | 'awd';
  /** Total brake force coefficient. */
  brakeForce: number;
  /** Max steering lock in radians at low speed. */
  steerLock: number;
  /** Tyre grip multiplier (1 = average road car). */
  grip: number;
  /** Rear grip multiplier relative to front: < 1 = tail-happy. */
  rearGripBias: number;
  suspensionStiffness: number;
  suspensionDamping: number;
  suspensionTravel: number;
  /** Centre of mass height offset below body centre (m); bigger = more stable. */
  comDrop: number;
  seats: number;
  health: number;
  /** Paint choices. */
  colors: number[];
  /** Resale / chop-shop value in dollars. */
  value: number;
  /** Relative spawn frequency by district type (missing = 0). */
  spawn: Partial<Record<DistrictType, number>>;
  /** Engine sound character for audio. */
  engineSound: 'four' | 'six' | 'v8' | 'diesel' | 'bike' | 'electric';
  /** May appear as ambient traffic / parked. */
  traffic: boolean;
}

/** What a model builder returns. Model faces +z, origin on the ground under the centre. */
export interface VehicleModel {
  group: THREE.Group;
  /** Wheel pivots in order FL, FR, RL, RR (… extra axles after). Physics positions them each frame. */
  wheels: THREE.Object3D[];
  /** Driver-door world side: NZ = right-hand drive → driver sits on the right (local -x). */
  seats: { x: number; y: number; z: number }[];
  /** Shared emissive materials the vehicle system drives. */
  headlights?: THREE.MeshStandardMaterial;
  taillights?: THREE.MeshStandardMaterial;
  /** Police / emergency beacons (toggled by `siren`). */
  beacons?: THREE.MeshStandardMaterial[];
  /** Parts that should detach or deform as damage rises (optional). */
  damageParts?: THREE.Object3D[];
  /** Body panels to darken when wrecked. */
  bodyMaterial?: THREE.MeshStandardMaterial;
  /** Steering handlebar / front fork pivot for bikes. */
  steerPivot?: THREE.Object3D;
}

export type VehicleModelBuilder = (spec: VehicleSpec, color: number, materials: MaterialLibrary) => VehicleModel;

export interface VehicleControls {
  /** 0..1 */
  throttle: number;
  /** 0..1 (also reverses when stopped) */
  brake: number;
  /** -1..1, + = left */
  steer: number;
  handbrake: boolean;
}

export interface Vehicle {
  readonly id: number;
  readonly spec: VehicleSpec;
  readonly group: THREE.Group;
  readonly body: RAPIER.RigidBody;
  /** Chassis centre (updated every frame). */
  readonly position: THREE.Vector3;
  heading: number;
  /** Signed forward speed, m/s. */
  speed: number;
  readonly velocity: THREE.Vector3;
  controls: VehicleControls;
  /** Whoever is driving. Null = parked / abandoned. */
  driver: Actor | null;
  passengers: Actor[];
  health: number;
  destroyed: boolean;
  /** Engine on fire; will explode shortly. */
  burning: boolean;
  color: number;
  /** Number of wheels touching ground. */
  wheelsOnGround: number;
  /** Lateral slip 0..1 (for tyre squeal / smoke). */
  slip: number;
  siren: boolean;
  headlightsOn: boolean;
  /** Who owns the AI for this vehicle; systems use it to avoid fighting over controls. */
  controller: 'none' | 'player' | 'traffic' | 'police' | 'mission';
  /** Free-form tags ('parked', 'mission', 'roadblock', 'racer'…). */
  tags: Set<string>;
  applyDamage(amount: number, source?: Actor | null, point?: THREE.Vector3): void;
  /** World position beside the driver's (right) door — where a person stands to get in / out. */
  doorPosition(target: THREE.Vector3, seat?: number): THREE.Vector3;
  /** World position of a seat (for placing a seated humanoid). */
  seatPosition(target: THREE.Vector3, seat?: number): THREE.Vector3;
  /** Put the vehicle somewhere (resets velocity). */
  teleport(x: number, y: number, z: number, heading: number): void;
  /** Flip back onto its wheels. */
  recover(): void;
  horn(): void;
}

export interface VehiclesApi {
  specs: Map<string, VehicleSpec>;
  all: Vehicle[];
  /** Spawn at ground level. Returns null if the area is not loaded. */
  spawn(specId: string, x: number, z: number, heading: number, options?: { color?: number; controller?: Vehicle['controller']; tags?: string[] }): Vehicle | null;
  remove(vehicle: Vehicle): void;
  nearest(x: number, z: number, maxDistance: number, filter?: (v: Vehicle) => boolean): Vehicle | null;
  /** Random traffic-eligible spec id suited to a district. */
  pickSpec(district: DistrictType, rng?: { next(): number }): string;
  /** Seat / unseat helpers used by player, peds and police alike. */
  enter(actor: Actor, vehicle: Vehicle, seat?: number): void;
  exit(actor: Actor): void;
}

/** Steers a vehicle towards targets; shared by traffic, police and missions. Created via `ctx.vehicles`-independent helper in vehicles/autopilot. */
export interface Autopilot {
  vehicle: Vehicle;
  /** Follow a lane route. */
  setRoute(route: { edge: RoadEdge; dir: 1 | -1 }[], startS?: number): void;
  /** Or drive straight at a world point (pursuit / off-road). */
  setTarget(x: number, z: number): void;
  /** Cruise speed cap in m/s (also limited by the road's speed limit × obeyLimit). */
  cruiseSpeed: number;
  /** 1 = obey limits; 1.6 = boy racer; 2+ = pursuit. */
  aggression: number;
  /** Brake for vehicles / people ahead. */
  avoidObstacles: boolean;
  /** True when the route is finished or the target reached. */
  readonly arrived: boolean;
  /** Current route edge and position, for junction logic. */
  readonly edge: RoadEdge | null;
  readonly dir: 1 | -1;
  readonly s: number;
  /** Seconds the vehicle has been unable to move. */
  readonly stuckTime: number;
  update(dt: number): void;
  stop(): void;
}

// ───────────────────────────── Combat ─────────────────────────────

export interface WeaponSpec {
  id: string;
  name: string;
  kind: 'fists' | 'melee' | 'pistol' | 'smg' | 'shotgun' | 'rifle';
  damage: number;
  /** Shots per second. */
  rate: number;
  range: number;
  magazine: number;
  reloadTime: number;
  /** Radians of cone half-angle. */
  spread: number;
  pellets: number;
  automatic: boolean;
  /** Can be fired from a vehicle (drive-by). */
  driveBy: boolean;
  /** Price at a gun shop. */
  price: number;
}

export interface CombatApi {
  weapons: Map<string, WeaponSpec>;
  /** Player loadout. */
  current: WeaponSpec;
  ammo(weaponId?: string): { clip: number; reserve: number };
  give(weaponId: string, ammo: number): void;
  has(weaponId: string): boolean;
  select(weaponId: string): void;
  /** Remove everything except fists (busted). */
  disarm(): void;
  /**
   * Fire a weapon for any actor (peds, police use this too). Does hit-scan, damage, tracers and emits 'gunshot'.
   * Returns true if a shot was fired (rate limiting is the caller's job for NPCs).
   */
  fire(shooter: Actor, weaponId: string, origin: THREE.Vector3, direction: THREE.Vector3): boolean;
  /** Short-range melee swing in front of the actor. */
  melee(attacker: Actor, damage: number, reach?: number): Actor | Vehicle | null;
  /** Spawn an explosion (vehicles call this when they blow). */
  explode(position: THREE.Vector3, radius: number, damage: number, source?: Actor | null): void;
  /** A small mesh of the weapon to attach to a humanoid's hand (`humanoid.setHeld`). Null for fists. */
  createWeaponModel(weaponId: string): THREE.Object3D | null;
  /** World pickups: 'health' | 'armour' | 'cash' | weapon id. Returns a remover. */
  spawnPickup(kind: string, x: number, z: number, amount?: number, respawnSeconds?: number): () => void;
  serialize(): unknown;
  deserialize(data: unknown): void;
}

// ───────────────────────────── AI ─────────────────────────────

export interface PedSpawnOptions {
  x: number;
  z: number;
  heading?: number;
  look?: Partial<HumanoidLook>;
  kind?: ActorKind;
  name?: string;
  health?: number;
  /** 'wander' (default) | 'stand' | 'flee' | 'attack' (hostile to player) | 'follow' */
  behaviour?: 'wander' | 'stand' | 'flee' | 'attack' | 'follow';
  weaponId?: string;
  /** Scripted peds are never despawned by the ambient population. */
  persistent?: boolean;
  /**
   * Cannot be hurt, killed or knocked down (cameo characters). Hits, blasts and vehicle strikes are
   * reported to `onHit` instead, so the owner can have them protest and walk off.
   */
  invulnerable?: boolean;
  onHit?(info: DamageInfo): void;
}

export interface PedHandle extends Actor {
  setBehaviour(behaviour: NonNullable<PedSpawnOptions['behaviour']>, target?: Actor | { x: number; z: number }): void;
  /** Walk / run to a point; resolves true when reached. */
  goTo(x: number, z: number, run?: boolean): Promise<boolean>;
  say(text: string): void;
  enterVehicle(vehicle: Vehicle, seat?: number): void;
  /** Hold a pose over the idle for a few seconds (arms raised, pointing at the sky). Optional so test doubles need not provide it. */
  gesture?(pose: HumanoidPose, seconds: number, aimPitch?: number): void;
  remove(): void;
}

export interface PedsApi {
  /** Ambient population density multiplier (missions can thin crowds). */
  density: number;
  spawn(options: PedSpawnOptions): PedHandle;
  count: number;
}

export interface TrafficApi {
  density: number;
  /** Spawn an AI-driven vehicle on the road nearest to (x,z) heading along it. */
  spawnDriver(specId: string, x: number, z: number, options?: { aggression?: number; tags?: string[]; persistent?: boolean }): Vehicle | null;
  /** Autopilot factory, for missions and police. */
  createAutopilot(vehicle: Vehicle): Autopilot;
  count: number;
}

export interface PoliceApi {
  /** 0..5 */
  level: number;
  /** Heat within the current level, 0..1 (HUD can flash while being lost). */
  heat: number;
  /** Seconds remaining until the level drops while out of sight (0 when seen). */
  evading: number;
  setLevel(level: number): void;
  addHeat(amount: number): void;
  clear(): void;
  /** Missions can suspend the law briefly. */
  enabled: boolean;
}

// ───────────────────────────── Missions ─────────────────────────────

export interface MissionSummary {
  id: string;
  title: string;
  giver: string;
  blurb: string;
  reward: number;
  state: 'locked' | 'available' | 'active' | 'done';
  /** Where to start it. */
  placeId: string;
}

export interface MissionsApi {
  list(): MissionSummary[];
  active: MissionSummary | null;
  /** A dialogue line is on screen (the touch overlay tucks its buttons away behind one). */
  readonly talking: boolean;
  start(id: string): boolean;
  /** Abandon the active mission. */
  abort(reason?: string): void;
  serialize(): unknown;
  deserialize(data: unknown): void;
}

// ───────────────────────────── UI & audio ─────────────────────────────

export type BlipKind = 'mission' | 'objective' | 'safehouse' | 'shop' | 'police' | 'hospital' | 'vehicle' | 'enemy' | 'friend' | 'pickup';

export interface Blip {
  id: string;
  kind: BlipKind;
  x: number;
  z: number;
  label?: string;
  /** Follows an object if set. */
  follow?: { position: THREE.Vector3 };
  /** Draw a route line / keep pinned to the minimap edge when off-screen. */
  pinned?: boolean;
}

export interface UiApi {
  /** One-line contextual prompt near the bottom ("F  Nick the ute"). Pass null to clear. Re-set every frame it applies. */
  prompt(text: string | null): void;
  /** Dialogue / radio chatter subtitle. */
  subtitle(text: string, seconds?: number, speaker?: string): void;
  /** Cut the subtitle on screen short (the player pressed skip). */
  skipSubtitle(): void;
  /** Big centre-screen moment (mission title, wasted, busted). */
  banner(title: string, sub?: string, seconds?: number, tone?: 'neutral' | 'good' | 'bad'): void;
  /** Small corner notification. */
  toast(text: string, seconds?: number): void;
  /** Current objective line (null clears). */
  objective(text: string | null): void;
  /** Countdown / counter shown with the objective (null clears). */
  timer(label: string | null, seconds?: number): void;
  setBlip(blip: Blip): void;
  removeBlip(id: string): void;
  /** Fade the screen to black and back (resolves at full black). */
  fade(toBlack: boolean, seconds?: number): Promise<void>;
  /** True while a full-screen menu (pause, map, shop) is open. */
  menuOpen: boolean;
  /** Simple choice dialog (shops, mission accept). Resolves with the chosen index or -1. */
  choose(title: string, body: string, options: string[]): Promise<number>;
}

export type SfxId =
  | 'pistol'
  | 'shotgun'
  | 'smg'
  | 'rifle'
  | 'punch'
  | 'reload'
  | 'empty'
  | 'ricochet'
  | 'bodyHit'
  | 'crashSmall'
  | 'crashBig'
  | 'glass'
  | 'explosion'
  | 'horn'
  | 'hornTruck'
  | 'doorOpen'
  | 'doorClose'
  | 'engineStart'
  | 'skid'
  | 'siren'
  | 'pickup'
  | 'cash'
  | 'missionPass'
  | 'missionFail'
  | 'uiMove'
  | 'uiSelect'
  | 'footstep'
  | 'splash'
  | 'tramBell'
  | 'sheep'
  | 'magpie'
  | 'scream';

export interface AudioApi {
  /** One-shot; positional if `at` is given. */
  play(id: SfxId, options?: { at?: THREE.Vector3; volume?: number; pitch?: number }): void;
  /** Resume the AudioContext after a user gesture. */
  unlock(): void;
  radio: {
    stations: { id: string; name: string; blurb: string }[];
    current: string | null;
    next(): void;
    set(id: string | null): void;
  };
}

// ───────────────────────────── Save ─────────────────────────────

export interface SaveApi {
  /** Is there a saved game. */
  exists(): boolean;
  /** Write the current game (called at safehouses, after missions, on pause). */
  save(): void;
  /** Load into the running game. Returns false if there is nothing to load. */
  load(): boolean;
  clear(): void;
  /** Modules register a slice of the save file. */
  register(key: string, serialize: () => unknown, deserialize: (data: unknown) => void): void;
}

// ───────────────────────────── World generation contract ─────────────────────────────

/** A building plot generated along a road edge. Local frame: front faces the road. */
export interface Lot {
  /** Centre of the plot. */
  x: number;
  z: number;
  /** Ground height at the centre. */
  y: number;
  /** Heading the FRONT faces (towards the road). */
  heading: number;
  /** Plot width along the road and depth away from it, metres. */
  width: number;
  depth: number;
  district: District;
  /** Road it fronts. */
  edge: RoadEdge;
  /** Deterministic seed. */
  seed: number;
  /** True at a street corner. */
  corner: boolean;
}

/**
 * Accumulates static geometry for one chunk. Everything added is merged per material into a few meshes,
 * given colliders where requested, and thrown away when the chunk unloads.
 * All coordinates are WORLD space. `transform` helpers place local geometry.
 */
export interface ChunkBuilder {
  readonly materials: MaterialLibrary;
  readonly world: WorldApi;
  /** Level of detail: 0 = near (full detail), 1 = reduced (skip small props / interiors). */
  readonly lod: 0 | 1;
  /** Add geometry (world space, or local with `matrix`). Geometry is copied; caller may reuse / dispose it. */
  addGeometry(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void;
  /**
   * Convenience: axis-aligned box in a local frame, UV-mapped in metres so textures tile correctly.
   * `frame` is a matrix from local → world (see `frameAt`).
   */
  box(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number, material: THREE.Material): void;
  /** Gable / hip roof prism: ridge along local x, spanning w (x) × d (z), rising `rise` from y. */
  gable(frame: THREE.Matrix4, cx: number, y: number, cz: number, w: number, d: number, rise: number, material: THREE.Material, hip?: number): void;
  /** Cylinder with axis along local y. */
  cylinder(frame: THREE.Matrix4, cx: number, cy: number, cz: number, radiusTop: number, radiusBottom: number, h: number, material: THREE.Material, segments?: number): void;
  /**
   * Flat quad (sign, window, decal) centred at (cx,cy,cz), facing local +z rotated by `yaw` about y.
   * UVs span 0..1 across the quad, or metres when `uvMetres` is set (tiling textures, office window grids).
   */
  quad(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, material: THREE.Material, yaw?: number, uvMetres?: boolean): void;
  /** Static box collider in the same local frame (use for walls, big props). */
  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void;
  /** Instanced vegetation / repeated props by kind (see world/props registry). */
  instance(kind: string, x: number, y: number, z: number, heading?: number, scale?: number, tint?: number): void;
  /** A point light that only exists at night near the player (street lamps, shop fronts). Budgeted; may be dropped. */
  light(x: number, y: number, z: number, color: number, intensity: number, range: number): void;
  /** Matrix placing a local frame at a world position with heading (local +z = facing direction). */
  frameAt(x: number, y: number, z: number, heading: number): THREE.Matrix4;
}

/** Builds one building / lot into the chunk. Registered per district type with a weight. */
export type LotBuilder = (lot: Lot, out: ChunkBuilder, rng: { next(): number; range(a: number, b: number): number; int(a: number, b: number): number; chance(p: number): boolean; pick<T>(list: readonly T[]): T }) => void;

/**
 * Adds ambient detail to a square of world as its chunk loads: fences, livestock, shelter belts, street
 * furniture, boats on the river… Must be deterministic for a given area (seed from the coordinates).
 */
export type Scatterer = (area: { minX: number; minZ: number; size: number; seed: number }, out: ChunkBuilder) => void;

/** Builds a bespoke landmark. Called once per placement when its chunk loads (or at start for skyline landmarks). */
/**
 * Builds one landmark into a chunk. A heavy builder may be a generator function instead: the world runs it
 * a slice per frame so a cathedral-sized build does not land in one frame (`runLandmark` exhausts either).
 */
export type LandmarkBuilder = (placement: LandmarkPlacement, out: ChunkBuilder) => void | Generator<void>;
