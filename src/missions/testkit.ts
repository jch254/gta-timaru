/**
 * Test support only (not imported by the game): a fake GameContext made of plain objects that implement
 * just what the missions module touches, on a toy map with every contract place on it.
 *
 * Toy map (metres, +x east, -z north):
 *   - the four avenues: a 1 km square with its SW corner at the origin, Colombo Street up the middle
 *   - SH1 running 6 km south from the SW corner to "Timaru"
 *   - Dyers Pass Road from the SE corner out to the Kiwi and down to Lyttelton
 *   - Arowhenua marae beside SH1, 30 m back from the road
 */
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type {
  Action,
  Actor,
  Autopilot,
  Blip,
  DamageInfo,
  EdgeSample,
  GameContext,
  GameEvents,
  LandmarkPlacement,
  PedHandle,
  PedSpawnOptions,
  Place,
  RoadEdge,
  RoadGraph,
  RoadHit,
  RoadNode,
  Vehicle,
  VehicleSpec,
  WeaponSpec,
  WeatherKind,
} from '../core/types';
import { PLACE_IDS, VEHICLE_IDS, WEAPON_IDS } from './ids';

// ───────────────────────────── Road graph ─────────────────────────────

const NODE_AT: [number, number][] = [
  [0, 0], // 0 SW: Moorhouse / Deans (four-aves-start)
  [500, 0], // 1 S: Moorhouse / Colombo
  [1000, 0], // 2 SE: Moorhouse / Fitzgerald
  [1000, -1000], // 3 NE: Fitzgerald / Bealey
  [500, -1000], // 4 N: Bealey / Colombo
  [0, -1000], // 5 NW: Bealey / Deans
  [0, 3000], // 6 SH1 at the Rangitata
  [0, 6000], // 7 SH1 at Timaru
  [1500, 800], // 8 top of Dyers Pass
  [2000, 1500], // 9 Lyttelton
];

const EDGE_DEFS: [string, number, number, number][] = [
  ['Moorhouse Avenue', 0, 1, 2],
  ['Moorhouse Avenue', 1, 2, 2],
  ['Fitzgerald Avenue', 2, 3, 2],
  ['Bealey Avenue', 3, 4, 2],
  ['Bealey Avenue', 4, 5, 2],
  ['Deans Avenue', 5, 0, 2],
  ['Colombo Street', 1, 4, 1],
  ['State Highway 1', 0, 6, 1],
  ['State Highway 1', 6, 7, 1],
  ['Dyers Pass Road', 2, 8, 1],
  ['Dyers Pass Road', 8, 9, 1],
];

export function makeGraph(): RoadGraph {
  const nodes: RoadNode[] = NODE_AT.map(([x, z], index) => ({ index, x, y: 0, z, edges: [] }));
  const edges: RoadEdge[] = EDGE_DEFS.map(([name, a, b, lanes], index) => {
    nodes[a].edges.push(index);
    nodes[b].edges.push(index);
    const length = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z);
    return { index, name, cls: lanes > 1 ? 'arterial' : 'street', a, b, samples: [], length, width: lanes > 1 ? 14 : 8, lanes, speedLimit: 14, oneway: false, bridge: false, tunnel: false, footpaths: true, drivable: true } as RoadEdge;
  });
  const tangent = (e: RoadEdge) => {
    const a = nodes[e.a];
    const b = nodes[e.b];
    return { tx: (b.x - a.x) / e.length, tz: (b.z - a.z) / e.length };
  };
  const pointAt = (edge: RoadEdge, s: number): EdgeSample => {
    const t = tangent(edge);
    const c = Math.min(Math.max(s, 0), edge.length);
    return { x: nodes[edge.a].x + t.tx * c, y: 0, z: nodes[edge.a].z + t.tz * c, tx: t.tx, tz: t.tz, s: c };
  };
  const graph: RoadGraph = {
    nodes,
    edges,
    nearest(x, z, maxDistance = 60, filter) {
      let best: RoadHit | null = null;
      for (const edge of edges) {
        if (filter && !filter(edge)) continue;
        const t = tangent(edge);
        const a = nodes[edge.a];
        const s = Math.min(Math.max((x - a.x) * t.tx + (z - a.z) * t.tz, 0), edge.length);
        const p = pointAt(edge, s);
        const distance = Math.hypot(x - p.x, z - p.z);
        if (distance > Math.min(maxDistance, 60) || (best && distance >= best.distance)) continue;
        // Left of the a→b direction (tx, tz) is (tz, -tx).
        const offset = (x - p.x) * t.tz - (z - p.z) * t.tx;
        best = { edge, s, distance, offset, x: p.x, y: 0, z: p.z };
      }
      return best;
    },
    pointAt,
    lanePoint(edge, s, dir, lane = 0) {
      const p = pointAt(edge, s);
      const laneWidth = edge.width / 2 / edge.lanes;
      const off = edge.width / 2 - laneWidth * (lane + 0.5);
      // Keep left: left of the travel direction.
      return { x: p.x + p.tz * dir * off, y: 0, z: p.z - p.tx * dir * off, heading: Math.atan2(p.tx * dir, p.tz * dir) };
    },
    footpathPoint(edge, s, side) {
      const p = pointAt(edge, s);
      const off = side * (edge.width / 2 + 1.7);
      return { x: p.x + p.tz * off, y: 0, z: p.z - p.tx * off };
    },
    endNode: (edge, dir) => nodes[dir === 1 ? edge.b : edge.a],
    route(from, to) {
      // Breadth-first: fewest edges (good enough for a toy map).
      const prev = new Map<number, { node: number; edge: RoadEdge; dir: 1 | -1 }>();
      const queue = [from];
      const seen = new Set([from]);
      while (queue.length) {
        const n = queue.shift()!;
        if (n === to) break;
        for (const ei of nodes[n].edges) {
          const edge = edges[ei];
          const dir: 1 | -1 = edge.a === n ? 1 : -1;
          const next = dir === 1 ? edge.b : edge.a;
          if (seen.has(next)) continue;
          seen.add(next);
          prev.set(next, { node: n, edge, dir });
          queue.push(next);
        }
      }
      if (from !== to && !prev.has(to)) return null;
      const out: { edge: RoadEdge; dir: 1 | -1 }[] = [];
      for (let n = to; n !== from; ) {
        const step = prev.get(n)!;
        out.unshift({ edge: step.edge, dir: step.dir });
        n = step.node;
      }
      return out;
    },
    nearestNode(x, z) {
      let best = nodes[0];
      for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < Math.hypot(best.x - x, best.z - z)) best = n;
      return best;
    },
  };
  return graph;
}

// ───────────────────────────── Places ─────────────────────────────

const PLACE_AT: Record<string, [x: number, z: number, tags: string[]]> = {
  'timaru-spawn': [10, 5905, ['spawn']],
  'timaru-chipshop': [10, 5900, ['safehouse', 'mission']],
  'smithfield-carpark': [40, 5400, ['mission']],
  'timaru-port-lockup': [45, 5990, ['mission']],
  'timaru-hospital': [-200, 5800, ['hospital']],
  'timaru-police': [-200, 5700, ['police']],
  'timaru-gunshop': [-12, 5850, ['gunshop']],
  'timaru-panelbeater': [-200, 5600, ['spray']],
  'caroline-bay': [200, 5800, ['mission']],
  'washdyke-saleyards': [-12, 5000, ['mission']],
  'temuka-pub': [10, 4200, ['mission']],
  'rangitata-layby': [12, 2900, ['mission']],
  'hinds-woolshed': [-40, 2200, ['mission']],
  'ashburton-stock-agent': [10, 1500, ['mission']],
  'ashburton-police': [-200, 1500, ['police']],
  'ashburton-panelbeater': [-200, 1400, ['spray']],
  'rakaia-salmon': [-10, 700, ['mission']],
  'chch-garage': [300, 9, ['safehouse', 'mission']],
  'four-aves-start': [0, 0, ['mission']],
  'cathedral-square': [505, -520, ['mission']],
  'arts-centre': [490, -500, ['mission']],
  'antigua-boatsheds': [510, -300, ['mission']],
  'chch-hospital': [200, -300, ['hospital']],
  'chch-police': [300, -300, ['police']],
  'chch-gunshop': [510, -700, ['gunshop']],
  'chch-panelbeater': [700, 9, ['spray']],
  'lancaster-park': [800, 100, ['mission']],
  'new-brighton-beach': [2500, -900, ['mission']],
  'sign-of-the-kiwi': [1505, 805, ['mission']],
  'lyttelton-wharf': [1995, 1495, ['mission']],
};

function makePlaces(only?: readonly string[]): Place[] {
  const ids = only ?? PLACE_IDS;
  return ids.map((id) => {
    const [x, z, tags] = PLACE_AT[id];
    return { id, name: id.replace(/-/g, ' '), x, z, heading: 0, city: null, tags };
  });
}

/** Arowhenua, beside SH1: its front (heading +x) faces the highway 30 m away. */
export const MARAE: LandmarkPlacement = { kind: 'marae', name: 'Arowhenua Marae', x: -80, z: 4500, heading: Math.PI / 2, clearRadius: 50 };

// ───────────────────────────── Actors and vehicles ─────────────────────────────

let nextId = 1;

export class FakeVehicle {
  readonly id = nextId++;
  readonly group = new THREE.Group();
  readonly body = null;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = 0;
  speed = 0;
  controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  driver: Actor | null = null;
  passengers: Actor[] = [];
  health: number;
  destroyed = false;
  burning = false;
  color = 0;
  wheelsOnGround = 4;
  slip = 0;
  siren = false;
  headlightsOn = false;
  controller: Vehicle['controller'] = 'none';
  tags = new Set<string>();
  recovered = 0;
  constructor(readonly spec: VehicleSpec) {
    this.health = spec.health;
  }
  applyDamage(amount: number) {
    this.health -= amount;
    if (this.health <= 0) this.destroyed = true;
  }
  doorPosition(target: THREE.Vector3) {
    return target.set(this.position.x + 1.6, 0, this.position.z);
  }
  seatPosition(target: THREE.Vector3) {
    return target.copy(this.position);
  }
  teleport(x: number, y: number, z: number, heading: number) {
    this.position.set(x, y, z);
    this.heading = heading;
  }
  recover() {
    this.recovered++;
  }
  horn() {}
}

export class FakePed {
  readonly id = nextId++;
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading: number;
  health: number;
  maxHealth: number;
  armour = 0;
  alive = true;
  vehicle: Vehicle | null = null;
  removed = false;
  behaviour: string;
  kind: Actor['kind'];
  name?: string;
  constructor(readonly options: PedSpawnOptions) {
    this.position.set(options.x, 0, options.z);
    this.heading = options.heading ?? 0;
    this.health = this.maxHealth = options.health ?? 100;
    this.behaviour = options.behaviour ?? 'wander';
    this.kind = options.kind ?? 'ped';
    this.name = options.name;
  }
  takeDamage(info: DamageInfo) {
    this.health -= info.amount;
    if (this.health <= 0) this.alive = false;
  }
  kill() {
    this.health = 0;
    this.alive = false;
  }
  setBehaviour(behaviour: string) {
    this.behaviour = behaviour;
  }
  goTo() {
    return Promise.resolve(true);
  }
  say() {}
  enterVehicle() {}
  remove() {
    this.removed = true;
  }
}

/** Drives its vehicle in straight lines through the end of each route leg (or at a target) at `speed`. */
export class FakeAutopilot implements Autopilot {
  cruiseSpeed = 20;
  aggression = 1;
  avoidObstacles = true;
  arrived = false;
  edge: RoadEdge | null = null;
  dir: 1 | -1 = 1;
  s = 0;
  stuckTime = 0;
  stopped = false;
  updates = 0;
  private path: { x: number; z: number }[] = [];
  constructor(
    public vehicle: Vehicle,
    private graph: RoadGraph,
    private speed: () => number,
  ) {}
  setRoute(route: { edge: RoadEdge; dir: 1 | -1 }[]) {
    this.path = route.map((leg) => this.graph.endNode(leg.edge, leg.dir));
    this.arrived = false;
    this.stopped = false;
  }
  setTarget(x: number, z: number) {
    this.path = [{ x, z }];
    this.arrived = false;
    this.stopped = false;
  }
  update(dt: number) {
    this.updates++;
    let move = this.speed() * dt;
    const p = this.vehicle.position;
    while (move > 0 && this.path.length) {
      const t = this.path[0];
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d <= move) {
        p.x = t.x;
        p.z = t.z;
        move -= d;
        this.path.shift();
      } else {
        p.x += ((t.x - p.x) / d) * move;
        p.z += ((t.z - p.z) / d) * move;
        move = 0;
      }
    }
    if (!this.path.length) this.arrived = true;
  }
  stop() {
    this.stopped = true;
    this.path = [];
  }
}

// ───────────────────────────── The context ─────────────────────────────

export interface FakeOptions {
  /** Pedestrian module present (false = the stub, which throws). */
  peds?: boolean;
  /** Traffic module present (false = the stub: no drivers, no autopilot). */
  traffic?: boolean;
  /** Subset of place ids on the map (default: all of them). */
  places?: readonly string[];
  /** Put Arowhenua marae on the map (default true). */
  marae?: boolean;
  /** Vehicle spec ids in the roster (default: all of them). */
  specs?: readonly string[];
}

const CLASS_OF: Record<string, VehicleSpec['cls']> = { statesman: 'sedan', v8sedan: 'sedan', coupe: 'coupe', hatch: 'hatch', wagon: 'wagon', ute: 'ute', farmtruck: 'truck', van: 'van', bike: 'bike', police: 'police', bus: 'bus' };
const PRICE_OF: Record<string, number> = { fists: 0, bat: 45, pistol: 400, shotgun: 850, rifle: 1200 };

export function makeFake(options: FakeOptions = {}) {
  const events = new EventBus<GameEvents>();
  const graph = makeGraph();
  const places = makePlaces(options.places);
  const landmarks: LandmarkPlacement[] = options.marae === false ? [] : [MARAE];

  const world = {
    bounds: { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 },
    seaLevel: 0,
    graph,
    places,
    landmarks,
    railways: [],
    /** Everything is loaded unless a test says otherwise. */
    loaded: true as boolean,
    foci: [] as { x: number; z: number; radius: number }[],
    water: (_x: number, _z: number) => 0,
    heightAt: () => 0,
    groundAt: () => 0,
    waterDepthAt(x: number, z: number) {
      return this.water(x, z);
    },
    place(id: string): Place {
      const p = places.find((q) => q.id === id);
      if (!p) throw new Error(`Unknown place "${id}"`);
      return p;
    },
    placesTagged: (tag: string) => places.filter((p) => p.tags.includes(tag)),
    nearestPlace: () => null,
    isLoaded(_x: number, _z: number) {
      return this.loaded;
    },
    addFocus(x: number, z: number, radius: number) {
      const focus = { x, z, radius };
      this.foci.push(focus);
      return () => {
        const i = this.foci.indexOf(focus);
        if (i >= 0) this.foci.splice(i, 1);
      };
    },
    whenLoaded: () => Promise.resolve(),
  };

  const specs = new Map<string, VehicleSpec>();
  for (const id of options.specs ?? VEHICLE_IDS) specs.set(id, { id, name: id, cls: CLASS_OF[id] ?? 'sedan', health: 100, length: 4.6, width: 1.8 } as VehicleSpec);

  const player = {
    id: nextId++,
    kind: 'player' as const,
    group: new THREE.Group(),
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: 0,
    health: 100,
    maxHealth: 100,
    armour: 0,
    alive: true,
    vehicle: null as Vehicle | null,
    money: 0,
    controlsEnabled: true,
    aiming: false,
    sprinting: false,
    cameraHeading: 0,
    takeDamage() {},
    addMoney(delta: number) {
      this.money = Math.max(0, Math.round(this.money + delta));
      events.emit('moneyChanged', { money: this.money, delta });
    },
    teleport(x: number, z: number, heading = 0) {
      if (this.vehicle) {
        this.vehicle.driver = null;
        this.vehicle = null;
      }
      this.position.set(x, 0, z);
      this.heading = heading;
    },
    heal(amount: number) {
      this.health = Math.min(this.maxHealth, this.health + amount);
    },
    addArmour(amount: number) {
      this.armour = Math.min(100, this.armour + amount);
    },
    warpIntoVehicle(vehicle: Vehicle) {
      this.vehicle = vehicle;
      vehicle.driver = this as unknown as Actor;
      vehicle.controller = 'player';
      this.position.copy(vehicle.position);
    },
  };

  const vehicles = {
    specs,
    all: [] as Vehicle[],
    removed: [] as Vehicle[],
    spawn(specId: string, x: number, z: number, heading: number, opts: { color?: number; controller?: Vehicle['controller']; tags?: string[] } = {}): Vehicle | null {
      const spec = specs.get(specId);
      if (!spec) throw new Error(`Unknown vehicle spec "${specId}"`);
      if (!world.isLoaded(x, z)) return null;
      const v = new FakeVehicle(spec);
      v.position.set(x, 0, z);
      v.heading = heading;
      v.controller = opts.controller ?? 'none';
      for (const tag of opts.tags ?? []) v.tags.add(tag);
      this.all.push(v as unknown as Vehicle);
      return v as unknown as Vehicle;
    },
    remove(vehicle: Vehicle) {
      const i = this.all.indexOf(vehicle);
      if (i < 0) return;
      this.all.splice(i, 1);
      this.removed.push(vehicle);
      if (vehicle.driver) vehicle.driver.vehicle = null;
    },
    nearest: () => null,
    pickSpec: () => 'statesman',
    enter() {},
    exit() {},
  };

  const pedList: FakePed[] = [];
  const peds = {
    density: 1,
    count: 0,
    all: pedList,
    spawn(o: PedSpawnOptions): PedHandle {
      if (options.peds === false) throw new Error('Pedestrians are not implemented yet');
      const ped = new FakePed(o);
      pedList.push(ped);
      return ped as unknown as PedHandle;
    },
  };

  const autopilots: FakeAutopilot[] = [];
  const traffic = {
    density: 1,
    count: 0,
    /** m/s the fake autopilots move at. */
    aiSpeed: 20,
    autopilots,
    spawnDriver(specId: string, x: number, z: number, o: { tags?: string[] } = {}): Vehicle | null {
      if (options.traffic === false) return null;
      const v = vehicles.spawn(specId, x, z, 0, { controller: 'traffic', tags: o.tags });
      if (v) v.driver = new FakePed({ x, z, kind: 'ped', name: 'driver' }) as unknown as Actor;
      return v;
    },
    createAutopilot(vehicle: Vehicle): Autopilot {
      if (options.traffic === false) throw new Error('Traffic is not implemented yet');
      const ap = new FakeAutopilot(vehicle, graph, () => this.aiSpeed);
      autopilots.push(ap);
      return ap;
    },
  };

  const police = {
    level: 0,
    heat: 0,
    evading: 0,
    enabled: true,
    cleared: 0,
    setLevel(level: number) {
      const previous = this.level;
      this.level = level;
      events.emit('wantedChanged', { level, previous });
    },
    addHeat(amount: number) {
      this.heat += amount;
    },
    clear() {
      this.cleared++;
      this.level = 0;
      this.heat = 0;
    },
    flushed: 0,
    flush() {
      this.flushed++;
      this.cleared++;
      this.level = 0;
      this.heat = 0;
    },
  };

  const weapons = new Map<string, WeaponSpec>();
  for (const id of WEAPON_IDS) {
    const ranged = id === 'pistol' || id === 'shotgun' || id === 'rifle';
    weapons.set(id, { id, name: id, kind: id === 'bat' ? 'melee' : (id as WeaponSpec['kind']), magazine: ranged ? 6 : 0, price: PRICE_OF[id] } as WeaponSpec);
  }
  const combat = {
    weapons,
    owned: new Set<string>(['fists']),
    given: [] as { id: string; ammo: number }[],
    selected: 'fists',
    pickups: [] as { kind: string; x: number; z: number; amount?: number; respawn?: number; removed: boolean }[],
    has(id: string) {
      return this.owned.has(id);
    },
    give(id: string, ammo: number) {
      this.owned.add(id);
      this.given.push({ id, ammo });
    },
    select(id: string) {
      this.selected = id;
    },
    spawnPickup(kind: string, x: number, z: number, amount?: number, respawn?: number) {
      const record = { kind, x, z, amount, respawn, removed: false };
      this.pickups.push(record);
      return () => {
        record.removed = true;
      };
    },
  };

  const ui = {
    menuOpen: false,
    objectiveText: null as string | null,
    objectives: [] as (string | null)[],
    timerLabel: null as string | null,
    timerSeconds: undefined as number | undefined,
    blips: new Map<string, Blip>(),
    banners: [] as { title: string; sub?: string; tone?: string }[],
    subtitles: [] as { text: string; speaker?: string }[],
    toasts: [] as string[],
    promptText: null as string | null,
    fades: [] as boolean[],
    chooses: [] as { title: string; body: string; options: string[] }[],
    /** What the next `choose` resolves with. */
    answer: (_title: string, _options: string[]): number => -1,
    prompt(text: string | null) {
      this.promptText = text;
    },
    subtitle(text: string, _seconds?: number, speaker?: string) {
      this.subtitles.push({ text, speaker });
    },
    banner(title: string, sub?: string, _seconds?: number, tone?: string) {
      this.banners.push({ title, sub, tone });
    },
    toast(text: string) {
      this.toasts.push(text);
    },
    objective(text: string | null) {
      this.objectiveText = text;
      this.objectives.push(text);
    },
    timer(label: string | null, seconds?: number) {
      this.timerLabel = label;
      this.timerSeconds = seconds;
    },
    setBlip(blip: Blip) {
      this.blips.set(blip.id, blip);
    },
    removeBlip(id: string) {
      this.blips.delete(id);
    },
    fade(toBlack: boolean) {
      this.fades.push(toBlack);
      return Promise.resolve();
    },
    choose(title: string, body: string, opts: string[]) {
      this.chooses.push({ title, body, options: opts });
      return Promise.resolve(this.answer(title, opts));
    },
  };

  const audio = {
    played: [] as string[],
    play(id: string) {
      this.played.push(id);
    },
    unlock() {},
    radio: { stations: [], current: null, next() {}, set() {} },
  };

  const slices = new Map<string, { serialize: () => unknown; deserialize: (data: unknown) => void }>();
  const save = {
    stored: null as Record<string, unknown> | null,
    saves: 0,
    exists() {
      return this.stored !== null;
    },
    register(key: string, serialize: () => unknown, deserialize: (data: unknown) => void) {
      slices.set(key, { serialize, deserialize });
    },
    save() {
      this.saves++;
      const out: Record<string, unknown> = {};
      for (const [key, slice] of slices) out[key] = slice.serialize();
      // Through JSON, as the real save file goes.
      this.stored = JSON.parse(JSON.stringify(out));
    },
    load() {
      if (!this.stored) return false;
      for (const [key, slice] of slices) if (key in this.stored) slice.deserialize(this.stored[key]);
      return true;
    },
    clear() {
      this.stored = null;
    },
  };

  const clock = {
    hour: 12,
    day: 1,
    elapsed: 0,
    secondsPerHour: 60,
    paused: false,
    advanceHours(hours: number) {
      this.hour += hours;
      while (this.hour >= 24) {
        this.hour -= 24;
        this.day++;
      }
    },
  };

  const env = {
    weather: 'clear' as WeatherKind,
    night: 0,
    rain: 0,
    wetness: 0,
    wind: { x: 0, z: 0 },
    visibility: 10000,
    sunDir: new THREE.Vector3(0, 1, 0),
    setWeather(kind: WeatherKind) {
      this.weather = kind;
    },
  };

  const input = {
    pressedNow: new Set<Action>(),
    pressed(action: Action) {
      return this.pressedNow.has(action);
    },
    held: () => false,
    label: () => 'F',
  };

  const scene = new THREE.Scene();
  const ctx = { scene, events, world, player, vehicles, peds, traffic, police, combat, ui, audio, save, clock, env, input, actors: { all: new Set(), nextId: () => nextId++, near: () => [] } } as unknown as GameContext;

  return {
    ctx,
    events,
    world,
    player,
    vehicles,
    peds,
    traffic,
    police,
    combat,
    ui,
    audio,
    save,
    clock,
    env,
    input,
    scene,
    /** Put the player (and whatever they are driving) somewhere. */
    moveTo(x: number, z: number) {
      player.position.set(x, 0, z);
      if (player.vehicle) player.vehicle.position.set(x, 0, z);
    },
    /** Sit the player in a vehicle's driving seat. */
    drive(vehicle: Vehicle) {
      player.vehicle = vehicle;
      vehicle.driver = player as unknown as Actor;
      vehicle.controller = 'player';
      player.position.copy(vehicle.position);
    },
    /** Step the player out where they are. */
    getOut() {
      if (!player.vehicle) return;
      player.vehicle.driver = null;
      player.vehicle = null;
    },
  };
}

export type Fake = ReturnType<typeof makeFake>;

/** Let pending promise callbacks (fades, dialogs) run. */
export async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
