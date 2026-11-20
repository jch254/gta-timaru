import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import type { Action, Actor, ActorKind, CombatApi, DamageInfo, GameContext, GameEvents, MaterialLibrary, PlayerApi, RayHit, System, Vehicle } from '../core/types';
import type { Effects } from '../fx';
import { DecalRing } from '../fx/styles';
import { createCombat } from './index';
import { DRAW_TIME } from './inventory';
import { TUNING, WEAPONS } from './weapons';

/**
 * The combat system against a stand-in game: a real event bus and scene, a ray-caster over spheres
 * and a ground plane, and recording stubs for everything else.
 */

type Events = { [K in keyof GameEvents]?: GameEvents[K][] };

interface Target {
  centre: THREE.Vector3;
  radius: number;
  owner: Actor | Vehicle;
}

interface Harness {
  ctx: GameContext;
  combat: CombatApi & System & { random: () => number };
  events: EventBus<GameEvents>;
  seen: Events;
  count(type: keyof GameEvents): number;
  crimes(): string[];
  player: PlayerApi & { shakes: number[]; actions: string[]; held: (THREE.Object3D | null)[]; hits: DamageInfo[] };
  targets: Target[];
  ped(kind: ActorKind, x: number, z: number, health?: number): Actor & { hits: DamageInfo[] };
  car(x: number, z: number, cls?: string): Vehicle & { damage: number[]; impulses: { x: number; y: number; z: number }[] };
  input: { down: Set<Action>; hit: Set<Action>; lookYaw: number; lookPitch: number };
  /** Run frames for `seconds`; presses are cleared after the first frame. */
  run(seconds: number): void;
  audio: ReturnType<typeof vi.fn>;
  flash: ReturnType<typeof vi.fn>;
  saved: { key: string; serialize: () => unknown; deserialize: (data: unknown) => void }[];
  ground: { enabled: boolean };
  toasts: string[];
  aim: THREE.Vector3;
}

function harness(): Harness {
  const events = new EventBus<GameEvents>();
  const seen: Events = {};
  const record = <K extends keyof GameEvents>(type: K) => events.on(type, (e) => ((seen[type] ??= [] as never) as GameEvents[K][]).push(e));
  (['gunshot', 'impact', 'crime', 'weaponChanged', 'pickup', 'actorDamaged', 'actorDied'] as const).forEach(record);

  const targets: Target[] = [];
  const ground = { enabled: false };
  const aim = new THREE.Vector3(0, 0, 1);
  let nextId = 1;

  const raycast = (origin: THREE.Vector3, dir: THREE.Vector3, max: number, options: { mask?: number; excludeOwner?: unknown; excludeBody?: unknown } = {}): RayHit | null => {
    let best: RayHit | null = null;
    const worldOnly = options.mask === 1;
    if (!worldOnly) {
      for (const t of targets) {
        if (t.owner === options.excludeOwner) continue;
        if ('body' in t.owner && t.owner.body === options.excludeBody) continue;
        const oc = origin.clone().sub(t.centre);
        const b = oc.dot(dir);
        const c = oc.lengthSq() - t.radius * t.radius;
        const disc = b * b - c;
        if (disc < 0) continue;
        const d = -b - Math.sqrt(disc);
        if (d < 0 || d > max || (best && d >= best.distance)) continue;
        const point = origin.clone().addScaledVector(dir, d);
        best = { point, normal: point.clone().sub(t.centre).normalize(), distance: d, collider: null as never, owner: t.owner };
      }
    }
    if (ground.enabled && dir.y < -1e-6) {
      const d = -origin.y / dir.y;
      if (d >= 0 && d <= max && (!best || d < best.distance)) best = { point: origin.clone().addScaledVector(dir, d), normal: new THREE.Vector3(0, 1, 0), distance: d, collider: null as never, owner: null };
    }
    return best;
  };

  const actor = (kind: ActorKind, x: number, z: number, health = 100) => {
    const a = {
      id: nextId++,
      kind,
      group: new THREE.Group(),
      position: new THREE.Vector3(x, 0, z),
      heading: 0,
      velocity: new THREE.Vector3(),
      health,
      maxHealth: health,
      armour: 0,
      alive: true,
      vehicle: null as Vehicle | null,
      hits: [] as DamageInfo[],
      takeDamage(info: DamageInfo) {
        if (!this.alive) return;
        this.hits.push(info);
        this.health -= info.amount;
        events.emit('actorDamaged', { actor: this, info });
        if (this.health <= 0) {
          this.alive = false;
          events.emit('actorDied', { actor: this, info });
        }
      },
    };
    return a;
  };

  const base = actor('player', 0, 0);
  const player = Object.assign(base, {
    money: 0,
    controlsEnabled: true,
    aiming: false,
    sprinting: false,
    cameraHeading: 0,
    shakes: [] as number[],
    actions: [] as string[],
    held: [] as (THREE.Object3D | null)[],
    addMoney(delta: number) {
      this.money += delta;
    },
    heal(amount: number) {
      base.health = Math.min(base.maxHealth, base.health + amount);
    },
    addArmour(amount: number) {
      base.armour = Math.min(100, base.armour + amount);
    },
    aimDirection: (target: THREE.Vector3) => target.copy(aim),
    playAction(pose: string) {
      this.actions.push(pose);
    },
    shakeCamera(amount: number) {
      this.shakes.push(amount);
    },
    teleport: () => undefined,
    warpIntoVehicle: () => undefined,
    respawn: () => undefined,
    humanoid: {
      group: new THREE.Group(),
      setPose: () => undefined,
      update: () => undefined,
      setHeld: (object: THREE.Object3D | null) => {
        player.held.push(object);
        for (const child of [...hand.children]) hand.remove(child);
        if (object) hand.add(object);
      },
      handPosition: (target: THREE.Vector3) => target.set(player.position.x - 0.25, player.position.y + 1.3, player.position.z + 0.4),
      dispose: () => undefined,
    },
  }) as unknown as Harness['player'];
  const hand = new THREE.Group();

  const scene = new THREE.Scene();
  scene.add(hand);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.35, 2000);
  camera.position.set(0, 1, -3); // level with the chest-high targets, looking along `aim`

  const materials = { get: () => new THREE.MeshStandardMaterial() } as unknown as MaterialLibrary;
  const audio = vi.fn();
  const flash = vi.fn();
  const saved: Harness['saved'] = [];
  const input = { down: new Set<Action>(), hit: new Set<Action>(), lookYaw: 0, lookPitch: 0 };
  const toasts: string[] = [];

  const ctx = {
    scene,
    camera,
    events,
    input: Object.assign(input, { held: (a: Action) => input.down.has(a), pressed: (a: Action) => input.hit.has(a) }),
    clock: { elapsed: 0, paused: false },
    env: { night: 0, wind: { x: 0, z: 0 }, wetness: 0, weather: 'clear' },
    gfx: { materials, flash, renderer: { domElement: { height: 1080 } } },
    physics: { raycast, lineOfSight: () => true },
    world: {
      groundAt: () => 0,
      heightAt: () => 0,
      normalAt: (_x: number, _z: number, t: THREE.Vector3) => t.set(0, 1, 0),
      waterDepthAt: () => 0,
      surfaceAt: () => 'road',
      landmarks: [{ kind: 'marae', name: 'test marae', x: 500, z: 500, heading: 0, clearRadius: 50 }],
    },
    actors: { all: new Set<Actor>([player]) },
    vehicles: { all: [] as Vehicle[] },
    ui: { menuOpen: false, toast: (text: string) => toasts.push(text) },
    audio: { play: audio },
    save: { register: (key: string, serialize: () => unknown, deserialize: (data: unknown) => void) => saved.push({ key, serialize, deserialize }) },
    player,
  } as unknown as GameContext;

  targets.push({ centre: new THREE.Vector3(0, 1, 0), radius: 0.45, owner: player });
  const combat = createCombat(ctx) as Harness['combat'];
  combat.random = () => 0; // dead-centre shots unless a test says otherwise

  return {
    ctx,
    combat,
    events,
    seen,
    count: (type) => seen[type]?.length ?? 0,
    crimes: () => (seen.crime ?? []).map((c) => c.type),
    player,
    targets,
    ped(kind, x, z, health = 100) {
      const a = actor(kind, x, z, health);
      ctx.actors.all.add(a);
      targets.push({ centre: new THREE.Vector3(x, 1, z), radius: 0.45, owner: a });
      return a;
    },
    car(x, z, cls = 'sedan') {
      const v = {
        id: nextId++,
        spec: { id: cls === 'police' ? 'police' : 'statesman', cls, length: 4.8, width: 1.8, height: 1.4, mass: 1400, wheelRadius: 0.33, wheelWidth: 0.22, wheelbase: 2.8, track: 1.5, wheelCount: 4, health: 100 },
        group: new THREE.Group(),
        position: new THREE.Vector3(x, 0.6, z),
        velocity: new THREE.Vector3(),
        heading: 0,
        speed: 0,
        health: 100,
        destroyed: false,
        burning: false,
        slip: 0,
        wheelsOnGround: 4,
        driver: null,
        passengers: [],
        tags: new Set<string>(),
        damage: [] as number[],
        impulses: [] as { x: number; y: number; z: number }[],
        body: {
          applyImpulse: (impulse: { x: number; y: number; z: number }) => v.impulses.push(impulse),
          applyTorqueImpulse: () => undefined,
        },
        applyDamage(amount: number) {
          this.damage.push(amount);
          this.health -= amount;
        },
        seatPosition: (t: THREE.Vector3, seat = 0) => t.set(v.position.x + (seat % 2 ? 0.4 : -0.4), v.position.y, v.position.z + (seat < 2 ? 0.2 : -0.7)),
      };
      scene.add(v.group);
      const vehicle = v as unknown as ReturnType<Harness['car']>;
      ctx.vehicles.all.push(vehicle);
      targets.push({ centre: new THREE.Vector3(x, 0.8, z), radius: 1.2, owner: vehicle });
      return vehicle;
    },
    input,
    run(seconds) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        input.lookYaw = 0;
        input.lookPitch = 0;
        combat.update!(1 / 60);
        ctx.clock.elapsed += 1 / 60;
        input.hit.clear();
      }
    },
    audio,
    flash,
    saved,
    ground,
    toasts,
    aim,
  };
}

const muzzle = () => new THREE.Vector3(0, 1, 0.6);
const ahead = () => new THREE.Vector3(0, 0, 1);

afterEach(() => vi.restoreAllMocks());

describe('combat: loadout', () => {
  it('starts with fists only and registers its save slice', () => {
    const h = harness();
    expect(h.combat.current.id).toBe('fists');
    expect(h.combat.has('fists')).toBe(true);
    expect(h.combat.has('pistol')).toBe(false);
    expect([...h.combat.weapons.keys()]).toEqual(WEAPONS.map((w) => w.id));
    expect(h.combat.ammo()).toEqual({ clip: 0, reserve: 0 });
    expect(h.saved.map((s) => s.key)).toEqual(['combat']);
    expect(h.combat.createWeaponModel('fists')).toBeNull();
    expect(h.combat.createWeaponModel('pistol')).toBeInstanceOf(THREE.Object3D);
  });

  it('announces weapon changes and round-trips through the save slice', () => {
    const h = harness();
    h.combat.give('pistol', 30);
    h.combat.give('bat', 0);
    h.combat.give('rifle', 12);
    expect(h.seen.weaponChanged).toEqual([{ weaponId: 'pistol' }]);
    h.combat.select('rifle');
    expect(h.combat.current.id).toBe('rifle');
    const data = JSON.parse(JSON.stringify(h.saved[0].serialize()));

    const other = harness();
    other.saved[0].deserialize(data);
    expect(other.combat.current.id).toBe('rifle');
    expect(other.combat.ammo('pistol')).toEqual(h.combat.ammo('pistol'));
    expect(other.combat.ammo('rifle')).toEqual({ clip: 5, reserve: 7 });
    expect(other.combat.has('bat')).toBe(true);
    expect(other.seen.weaponChanged?.at(-1)).toEqual({ weaponId: 'rifle' });
    // An old save from before combat existed.
    other.saved[0].deserialize(null);
    expect(other.combat.current.id).toBe('fists');
  });

  it('is disarmed when busted and loses half the spare rounds in hospital', () => {
    const h = harness();
    h.combat.give('pistol', 9 + 40);
    h.combat.give('shotgun', 5 + 9);
    h.events.emit('playerRespawned', { reason: 'died' });
    expect(h.combat.has('pistol')).toBe(true);
    expect(h.combat.ammo('pistol')).toEqual({ clip: 9, reserve: 20 });
    expect(h.combat.ammo('shotgun')).toEqual({ clip: 5, reserve: 4 });
    h.events.emit('playerBusted', {});
    expect(h.combat.has('pistol')).toBe(false);
    expect(h.combat.current.id).toBe('fists');
    expect(h.seen.weaponChanged?.at(-1)).toEqual({ weaponId: 'fists' });
  });
});

describe('combat: fire()', () => {
  it('lets anyone shoot: damage, one gunshot, an impact, tracers, and no crime for an NPC', () => {
    const h = harness();
    const cop = h.ped('cop', 0, 20);
    cop.heading = Math.PI;
    expect(h.combat.fire(cop, 'pistol', new THREE.Vector3(0, 1.2, 19.4), new THREE.Vector3(0, 0, -2))).toBe(true);
    expect(h.player.health).toBeLessThan(100);
    expect(h.player.hits).toHaveLength(1);
    expect(h.player.hits[0].kind).toBe('bullet');
    expect(h.player.hits[0].source).toBe(cop);
    expect(h.player.hits[0].direction!.z).toBeCloseTo(-1, 5);
    expect(h.count('gunshot')).toBe(1);
    expect(h.seen.gunshot![0].direction.length()).toBeCloseTo(1, 6);
    expect(h.seen.impact).toHaveLength(1);
    expect(h.seen.impact![0].surface).toBe('flesh');
    expect(h.count('crime')).toBe(0);
  });

  it('refuses unknown weapons, dead shooters and zero directions; melee ids swing instead', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 1.2);
    expect(h.combat.fire(h.player, 'bazooka', muzzle(), ahead())).toBe(false);
    expect(h.combat.fire(h.player, 'pistol', muzzle(), new THREE.Vector3())).toBe(false);
    expect(h.combat.fire(h.player, 'bat', muzzle(), ahead())).toBe(true);
    expect(ped.hits[0].kind).toBe('melee');
    expect(h.count('gunshot')).toBe(0);
    ped.alive = false;
    expect(h.combat.fire(ped, 'pistol', muzzle(), ahead())).toBe(false);
  });

  it('reports the player: gunfire at most every two seconds, assault per victim hit', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 15, 1000);
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(h.crimes()).toEqual(['gunfire', 'assault']);
    expect(h.seen.crime![1].victim).toBe(ped);
    expect(h.seen.crime![0].offender).toBe(h.player);
    h.ctx.clock.elapsed += 1;
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(h.crimes()).toEqual(['gunfire', 'assault', 'assault']);
    h.ctx.clock.elapsed += TUNING.gunfireCrimeInterval;
    h.combat.fire(h.player, 'pistol', muzzle(), new THREE.Vector3(1, 0, 0)); // a miss still makes noise
    expect(h.crimes()).toEqual(['gunfire', 'assault', 'assault', 'gunfire']);
    expect(ped.hits).toHaveLength(2);
  });

  it('a kill is murder, once; police are their own crimes', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 10, 20);
    h.combat.fire(h.player, 'rifle', muzzle(), ahead());
    expect(ped.alive).toBe(false);
    expect(h.crimes()).toEqual(['gunfire', 'murder']);
    const cop = h.ped('cop', 5, 0, 60);
    const east = new THREE.Vector3(1, 0, 0);
    h.combat.fire(h.player, 'pistol', new THREE.Vector3(0.6, 1, 0), east);
    h.combat.fire(h.player, 'pistol', new THREE.Vector3(0.6, 1, 0), east);
    h.combat.fire(h.player, 'pistol', new THREE.Vector3(0.6, 1, 0), east);
    expect(cop.alive).toBe(false);
    expect(h.crimes().slice(2)).toEqual(['copAssault', 'copAssault', 'copKilled']);
  });

  it('counts a death the victim reports late', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 10, 20);
    // This ped's system only works out it is dead on its next update.
    ped.takeDamage = function (info: DamageInfo) {
      this.hits.push(info);
      this.health -= info.amount;
    };
    h.combat.fire(h.player, 'rifle', muzzle(), ahead());
    expect(h.crimes()).toEqual(['gunfire', 'assault']);
    ped.alive = false;
    h.events.emit('actorDied', { actor: ped, info: ped.hits[0] });
    h.events.emit('actorDied', { actor: ped, info: ped.hits[0] });
    expect(h.crimes()).toEqual(['gunfire', 'assault', 'murder']);
    // Someone else's kill is not the player's crime.
    const other = h.ped('ped', 9, 9);
    h.events.emit('actorDied', { actor: other, info: { amount: 50, kind: 'bullet', source: ped } });
    expect(h.crimes()).toHaveLength(3);
  });

  it('running someone down is murder (or killing a cop), once; the wheels of anyone else are not', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 10, 50);
    // Knocked flat and run over: two blows, one death.
    ped.takeDamage({ amount: 40, kind: 'vehicle', source: h.player });
    expect(h.crimes()).toEqual([]); // the hit itself is the pedestrian system's hit-and-run
    ped.takeDamage({ amount: 60, kind: 'vehicle', source: h.player });
    expect(ped.alive).toBe(false);
    h.events.emit('actorDied', { actor: ped, info: ped.hits[1] });
    expect(h.crimes()).toEqual(['murder']);
    const cop = h.ped('cop', 5, 0, 60);
    cop.takeDamage({ amount: 90, kind: 'vehicle', source: h.player });
    expect(h.crimes()).toEqual(['murder', 'copKilled']);
    // A traffic driver's doing, or an empty car rolling downhill.
    h.ped('ped', 9, 9).takeDamage({ amount: 200, kind: 'vehicle', source: h.ped('ped', 30, 30) });
    h.ped('ped', 12, 9).takeDamage({ amount: 200, kind: 'vehicle', source: null });
    expect(h.crimes()).toHaveLength(2);
    // Crashing your own car is no crime.
    h.player.takeDamage({ amount: 200, kind: 'vehicle', source: h.player });
    expect(h.crimes()).toHaveLength(2);
  });

  it('a shotgun blast is one gunshot and one damage call per target, pellets summed', () => {
    const h = harness();
    const shotgun = h.combat.weapons.get('shotgun')!;
    const ped = h.ped('ped', 0, 4, 1000);
    h.combat.fire(h.player, 'shotgun', muzzle(), ahead());
    expect(h.count('gunshot')).toBe(1);
    expect(h.seen.impact).toHaveLength(shotgun.pellets);
    expect(ped.hits).toHaveLength(1);
    expect(ped.hits[0].amount).toBeCloseTo(shotgun.damage * shotgun.pellets, 5);
    expect(h.crimes()).toEqual(['gunfire', 'assault']);
  });

  it('spreads pellets and loses damage with range', () => {
    const h = harness();
    const shotgun = h.combat.weapons.get('shotgun')!;
    let seed = 1;
    h.combat.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const far = h.ped('ped', 0, 28, 1000);
    h.ground.enabled = true;
    h.combat.fire(h.player, 'shotgun', muzzle(), ahead());
    // At 27 m a 0.45 m target catches only some of the pattern, each pellet well down on damage.
    const total = far.hits.reduce((s, hit) => s + hit.amount, 0);
    expect(far.hits.length).toBeLessThanOrEqual(1);
    expect(total).toBeLessThan(shotgun.damage * shotgun.pellets * 0.5);
    expect(h.count('gunshot')).toBe(1);
  });

  it('hurts vehicles instead of the people inside, and reports vehicle damage sparingly', () => {
    const h = harness();
    const car = h.car(0, 12);
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(car.damage).toHaveLength(1);
    expect(car.damage[0]).toBeGreaterThan(0);
    expect(car.damage[0]).toBeLessThan(h.combat.weapons.get('pistol')!.damage); // cars shrug off pistol rounds
    expect(h.seen.impact![0].surface).toBe('vehicle');
    expect(h.crimes()).toEqual(['gunfire', 'vehicleDamage']);
    expect(h.seen.crime![1].victim).toBe(car);
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(h.crimes().filter((c) => c === 'vehicleDamage')).toHaveLength(1);
    h.ctx.clock.elapsed += TUNING.vehicleCrimeInterval + 0.01;
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(h.crimes().filter((c) => c === 'vehicleDamage')).toHaveLength(2);
  });

  it('a shooter in a car does not hit their own car', () => {
    const h = harness();
    const car = h.car(0, 0);
    const ped = h.ped('ped', 0, 9);
    h.player.vehicle = car;
    h.combat.fire(h.player, 'pistol', new THREE.Vector3(0, 1, 0), ahead());
    expect(car.damage).toHaveLength(0);
    expect(ped.hits).toHaveLength(1);
  });

  /** Someone sitting in `car`: no collider of their own (seated people have none), only the seat. */
  const seated = (h: Harness, car: Vehicle, kind: ActorKind, health: number, seat?: number) => {
    const a = h.ped(kind, car.position.x, car.position.z, health);
    h.targets.splice(
      h.targets.findIndex((t) => t.owner === a),
      1,
    );
    a.vehicle = car;
    if (seat === undefined) car.driver = a;
    else {
      (a as { seat?: number }).seat = seat;
      car.passengers.push(a);
    }
    return a;
  };
  // In line with the driver's seat of a car at (0, 12) (seat 0 sits 0.4 m to the left), at head and at sill height.
  const atDriver = () => new THREE.Vector3(-0.4, 1.1, 0.6);
  const atSill = () => new THREE.Vector3(-0.4, 0.4, 0.6);

  it("the player's rounds carry on into whoever sits in the line of fire: a cop in a car can be shot dead", () => {
    const h = harness();
    const car = h.car(0, 12, 'police');
    const cop = seated(h, car, 'cop', 30);
    const pistol = h.combat.weapons.get('pistol')!;
    h.combat.fire(h.player, 'pistol', atDriver(), ahead());
    expect(car.damage).toHaveLength(1);
    expect(cop.hits).toHaveLength(1);
    expect(cop.hits[0].kind).toBe('bullet');
    expect(cop.hits[0].source).toBe(h.player);
    expect(cop.hits[0].amount).toBeCloseTo(pistol.damage * TUNING.cabinDamage, 5);
    expect(cop.velocity.length()).toBe(0); // knocked about in the seat, not out of it
    expect(h.seen.impact!.map((i) => i.surface)).toEqual(['vehicle', 'flesh']);
    expect(h.crimes()).toEqual(['gunfire', 'vehicleDamage', 'copAssault']);
    h.combat.fire(h.player, 'pistol', atDriver(), ahead());
    expect(cop.alive).toBe(false);
    expect(h.crimes().at(-1)).toBe('copKilled');
  });

  it('a round low in the door, or through an empty seat, only hurts the car', () => {
    const h = harness();
    const car = h.car(0, 12);
    const driver = seated(h, car, 'ped', 100);
    h.combat.fire(h.player, 'pistol', atSill(), ahead());
    h.combat.fire(h.player, 'pistol', new THREE.Vector3(0.4, 1.1, 0.6), ahead()); // the empty front passenger seat
    expect(car.damage).toHaveLength(2);
    expect(driver.hits).toHaveLength(0);
  });

  it('hits only the first person in line, passengers by their seat', () => {
    const h = harness();
    const car = h.car(0, 12);
    const driver = seated(h, car, 'ped', 100);
    const behind = seated(h, car, 'ped', 100, 2); // the seat behind the driver, nearer the muzzle
    const beside = seated(h, car, 'ped', 90, 1);
    h.combat.fire(h.player, 'pistol', atDriver(), ahead());
    expect(behind.hits).toHaveLength(1);
    expect(driver.hits).toHaveLength(0);
    expect(beside.hits).toHaveLength(0);
    h.combat.fire(h.player, 'pistol', new THREE.Vector3(0.4, 1.1, 0.6), ahead());
    expect(beside.hits).toHaveLength(1);
    // A shotgun's pellets through the same window are summed into one blow.
    h.combat.fire(h.player, 'shotgun', new THREE.Vector3(0.4, 1.1, 0.6), ahead());
    expect(beside.hits).toHaveLength(2);
    expect(beside.alive).toBe(false);
    expect(h.crimes()).toContain('murder');
  });

  it("nobody else's rounds reach the people inside, and the player's never reach a cameo or the player", () => {
    const h = harness();
    const car = h.car(0, 12);
    const driver = seated(h, car, 'ped', 100);
    const cop = h.ped('cop', -0.4, -6);
    h.combat.fire(cop, 'pistol', atDriver(), ahead());
    expect(car.damage).toHaveLength(1);
    expect(driver.hits).toHaveLength(0);

    const star = h.car(0, 12);
    h.targets.splice(
      h.targets.findIndex((t) => t.owner === car),
      1,
    );
    const cameo = seated(h, star, 'scripted', 100);
    (cameo as { invulnerable?: boolean }).invulnerable = true;
    h.combat.fire(h.player, 'pistol', atDriver(), ahead());
    expect(cameo.hits).toHaveLength(0);

    const mine = h.car(0, 12);
    h.targets.splice(
      h.targets.findIndex((t) => t.owner === star),
      1,
    );
    mine.driver = h.player;
    h.player.vehicle = mine;
    h.combat.fire(h.player, 'pistol', atDriver(), ahead()); // (own car excluded: nothing to hit)
    h.combat.fire(cop, 'pistol', atDriver(), ahead());
    expect(h.player.hits).toHaveLength(0);
  });

  it('world hits are impacts on the world', () => {
    const h = harness();
    h.ground.enabled = true;
    h.combat.fire(h.player, 'pistol', muzzle(), new THREE.Vector3(0, -1, 1));
    expect(h.seen.impact).toHaveLength(1);
    expect(h.seen.impact![0].surface).toBe('world');
    expect(h.seen.impact![0].position.y).toBeCloseTo(0, 5);
    expect(h.seen.impact![0].normal.y).toBe(1);
  });
});

describe('combat: melee()', () => {
  it('hits what is in front, within reach, with a knock', () => {
    const h = harness();
    const ped = h.ped('ped', 0.3, 1.3);
    expect(h.combat.melee(h.player, 14)).toBe(ped);
    expect(ped.hits[0].kind).toBe('melee');
    expect(ped.hits[0].amount).toBe(14);
    expect(ped.velocity.z).toBeGreaterThan(1);
    expect(h.seen.impact![0].surface).toBe('flesh');
    expect(h.crimes()).toEqual(['assault']);
  });

  it('misses what is out of reach or behind', () => {
    const h = harness();
    const far = h.ped('ped', 0, 4);
    const behind = h.ped('ped', 0, -1.2);
    expect(h.combat.melee(h.player, 14, 1.6)).toBeNull();
    expect(far.hits).toHaveLength(0);
    expect(behind.hits).toHaveLength(0);
    h.player.heading = Math.PI;
    expect(h.combat.melee(h.player, 14, 1.6)).toBe(behind);
  });

  it('prefers a person to the car beside them, dents cars, and cannot be done from a seat', () => {
    const h = harness();
    const car = h.car(1.6, 1.4);
    const ped = h.ped('ped', -0.4, 1.2);
    expect(h.combat.melee(h.player, 32, 2)).toBe(ped);
    ped.alive = false;
    h.targets.splice(h.targets.findIndex((t) => t.owner === ped), 1);
    expect(h.combat.melee(h.player, 32, 2)).toBe(car);
    expect(car.damage[0]).toBeGreaterThan(0);
    expect(car.impulses).toHaveLength(1);
    h.player.vehicle = car;
    expect(h.combat.melee(h.player, 32, 2)).toBeNull();
  });
});

describe('combat: explode()', () => {
  it('hurts by distance, spares people in vehicles, throws and damages cars', () => {
    const h = harness();
    const near = h.ped('ped', 2, 0, 1000);
    const mid = h.ped('ped', 0, 6, 1000);
    const far = h.ped('ped', 0, 30, 1000);
    const car = h.car(-5, 0);
    const driver = h.ped('ped', -5, 0, 1000);
    driver.vehicle = car;
    h.player.position.set(0, 0, -40);
    h.combat.explode(new THREE.Vector3(0, 0.9, 0), 9, 120, null);
    expect(near.hits[0].amount).toBeCloseTo(120, 5); // inside the core
    expect(near.hits[0].kind).toBe('explosion');
    expect(mid.hits[0].amount).toBeGreaterThan(20);
    expect(mid.hits[0].amount).toBeLessThan(near.hits[0].amount);
    expect(far.hits).toHaveLength(0);
    expect(driver.hits).toHaveLength(0);
    expect(car.damage[0]).toBeGreaterThan(0);
    expect(car.impulses[0].x).toBeLessThan(0); // pushed away, to the west
    expect(car.impulses[0].y).toBeGreaterThan(0); // and up
    expect(mid.velocity.z).toBeGreaterThan(0);
    expect(h.audio).toHaveBeenCalledWith('explosion', expect.anything());
    expect(h.player.shakes.at(-1)).toBeGreaterThan(0);
    expect(h.flash).toHaveBeenCalled();
    expect(h.count('crime')).toBe(0); // nobody to blame
  });

  it('blames the player for their own explosions', () => {
    const h = harness();
    h.player.position.set(0, 0, -60);
    h.ped('ped', 1, 0, 50);
    h.ped('cop', 0, 5, 1000);
    h.combat.explode(new THREE.Vector3(0, 0.9, 0), 9, 120, h.player);
    expect(h.crimes().sort()).toEqual(['copAssault', 'murder']);
  });

  it('cover takes most of the blast', () => {
    const h = harness();
    h.player.position.set(0, 0, -60);
    const open = h.ped('ped', 3, 0, 1000);
    (h.ctx.physics as unknown as { lineOfSight: () => boolean }).lineOfSight = () => false;
    const hidden = h.ped('ped', -3, 0, 1000);
    h.combat.explode(new THREE.Vector3(0, 0.9, 0), 9, 100, null);
    expect(open.hits[0].amount).toBeCloseTo(hidden.hits[0].amount, 5); // same distance, same (blocked) answer
    expect(hidden.hits[0].amount).toBeCloseTo(100 * TUNING.explosionCover * (1 - (3 - 2.25) / 6.75), 3);
  });
});

describe('combat: the player', () => {
  it('fires on a press, once per press, from the hand towards the crosshair', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 25, 1000);
    h.combat.give('pistol', 30);
    h.run(DRAW_TIME + 0.05);
    h.input.hit.add('fire');
    h.input.down.add('fire');
    h.run(1); // holding the button does not keep firing a semi-automatic
    expect(h.count('gunshot')).toBe(1);
    expect(h.combat.ammo()).toEqual({ clip: 8, reserve: 21 });
    expect(ped.hits).toHaveLength(1);
    // From beside the body, yet converging on what the camera centre is on.
    const shot = h.seen.gunshot![0];
    expect(shot.position.x).toBeLessThan(-0.1);
    expect(shot.direction.x).toBeGreaterThan(0);
    expect(shot.shooter).toBe(h.player);
    // Recoil: a shake and a kick upwards.
    expect(h.player.shakes).toHaveLength(1);
    // From the hip the player swings round and raises the gun.
    expect(h.player.actions).toEqual(['aim']);
    expect(h.crimes()).toEqual(['gunfire', 'assault']);
  });

  it('kicks the view up on each shot and lets it spring back', () => {
    const h = harness();
    h.combat.give('shotgun', 5);
    h.run(DRAW_TIME + 0.05);
    const level = h.ctx.camera.quaternion.clone();
    const forward = new THREE.Vector3();
    /** One frame as the game runs it: update, the chase camera resets the view, then lateUpdate. */
    const frame = () => {
      h.combat.update!(1 / 60);
      h.input.hit.clear();
      h.ctx.camera.quaternion.copy(level);
      h.combat.lateUpdate!(1 / 60);
      h.ctx.clock.elapsed += 1 / 60;
      return h.ctx.camera.getWorldDirection(forward).y;
    };
    expect(frame()).toBeCloseTo(0, 6);
    h.input.hit.add('fire');
    const first = frame();
    expect(first).toBeGreaterThan(0.04); // snapped up at once
    expect(h.player.shakes).toHaveLength(1);
    const next = frame();
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(first);
    for (let i = 0; i < 60; i++) frame();
    expect(Math.abs(frame())).toBeLessThan(1e-3); // settled
    // Paused, the view holds where it is instead of drifting.
    h.input.hit.add('fire');
    h.run(1.1);
    h.input.hit.add('fire');
    frame();
    (h.ctx.clock as { paused: boolean }).paused = true;
    h.ctx.camera.quaternion.copy(level);
    h.combat.lateUpdate!(1 / 60);
    const held = h.ctx.camera.getWorldDirection(forward).y;
    h.ctx.camera.quaternion.copy(level);
    h.combat.lateUpdate!(1 / 60);
    expect(h.ctx.camera.getWorldDirection(forward).y).toBeCloseTo(held, 9);
  });

  it('buffers an early press, reloads when dry, and clicks when out', () => {
    const h = harness();
    h.combat.give('rifle', 2);
    h.input.hit.add('fire'); // pressed while still drawing: too early to buffer, lost
    h.run(DRAW_TIME - 0.1);
    expect(h.count('gunshot')).toBe(0);
    h.input.hit.add('fire'); // a tenth of a second before it is ready: buffered
    h.run(0.05);
    expect(h.count('gunshot')).toBe(0);
    h.run(0.1);
    expect(h.count('gunshot')).toBe(1);
    h.run(0.4);
    expect(h.count('gunshot')).toBe(1);
    h.run(1.3);
    h.input.hit.add('fire');
    h.run(0.1);
    expect(h.count('gunshot')).toBe(2);
    expect(h.combat.ammo()).toEqual({ clip: 0, reserve: 0 });
    h.run(1.5);
    h.input.hit.add('fire');
    h.run(0.1);
    expect(h.count('gunshot')).toBe(2);
    expect(h.audio).toHaveBeenCalledWith('empty', expect.anything());
    // Fresh rounds for the empty gun in hand start a reload, announced once.
    h.combat.give('rifle', 5);
    expect(h.audio.mock.calls.filter((c) => c[0] === 'reload')).toHaveLength(1);
    h.run(h.combat.weapons.get('rifle')!.reloadTime + 0.1);
    expect(h.combat.ammo()).toEqual({ clip: 5, reserve: 0 });
  });

  it('aims only with a gun, cycles weapons, and holds the right model', () => {
    const h = harness();
    h.input.down.add('aim');
    h.run(0.1);
    expect(h.player.aiming).toBe(false); // fists
    expect(h.player.held.at(-1)).toBeNull();
    h.combat.give('bat', 0);
    h.run(0.1);
    expect(h.player.aiming).toBe(false);
    expect(h.player.held.at(-1)?.name).toBe('weapon:bat');
    h.combat.give('pistol', 9);
    h.input.hit.add('nextWeapon');
    h.run(0.1);
    expect(h.combat.current.id).toBe('pistol');
    expect(h.player.aiming).toBe(true);
    expect(h.player.held.at(-1)?.name).toBe('weapon:pistol');
    // Aiming, the barrel lies on the aim line whatever the hand is doing.
    h.aim.set(0.6, 0.2, 0.77).normalize();
    h.run(0.6);
    const model = h.player.held.at(-1)!;
    const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(model.children[0].getWorldQuaternion(new THREE.Quaternion()));
    expect(barrel.angleTo(h.aim)).toBeLessThan(0.02);
    h.input.hit.add('prevWeapon');
    h.run(0.1);
    expect(h.combat.current.id).toBe('bat');
    expect(h.player.aiming).toBe(false);
    // Menus and cutscenes take the controls away.
    h.combat.select('pistol');
    (h.ctx.ui as { menuOpen: boolean }).menuOpen = true;
    h.input.hit.add('fire');
    h.run(0.6);
    expect(h.player.aiming).toBe(false);
    expect(h.count('gunshot')).toBe(0);
  });

  it('swings with the melee key or the fire button, landing a moment later', () => {
    const h = harness();
    const ped = h.ped('ped', 0, 1.2, 1000);
    h.input.hit.add('fire');
    h.run(1 / 60);
    expect(h.player.actions).toEqual(['punch']);
    expect(ped.hits).toHaveLength(0); // wind-up
    h.run(TUNING.meleeHitDelay + 0.05);
    expect(ped.hits).toHaveLength(1);
    expect(ped.hits[0].amount).toBe(h.combat.weapons.get('fists')!.damage);
    // With a gun in hand the melee key still throws a punch.
    h.combat.give('pistol', 9);
    h.run(1);
    h.input.hit.add('melee');
    h.run(0.5);
    expect(ped.hits).toHaveLength(2);
    expect(ped.hits[1].kind).toBe('melee');
    expect(h.count('gunshot')).toBe(0);
    // The bat hits harder.
    h.combat.give('bat', 0);
    h.combat.select('bat');
    h.run(1);
    h.input.hit.add('melee');
    h.run(0.5);
    expect(ped.hits[2].amount).toBe(h.combat.weapons.get('bat')!.damage);
  });

  it('in a vehicle: no model, pistol drive-by only, level with the car', () => {
    const h = harness();
    const car = h.car(0, 0);
    const ped = h.ped('ped', -12, 0.45, 1000); // off to the right (−x) of a car facing +z
    h.combat.give('shotgun', 5);
    h.combat.give('pistol', 18);
    h.run(0.5);
    h.player.vehicle = car;
    h.aim.set(-1, -0.4, 0).normalize(); // the chase camera looks down at the car
    h.input.down.add('aim');
    h.input.hit.add('fire');
    h.run(0.1);
    expect(h.player.held.at(-1)).toBeNull();
    expect(h.player.aiming).toBe(true); // reached for the pistol
    expect(h.combat.current.id).toBe('pistol');
    h.run(1);
    expect(h.count('gunshot')).toBe(1);
    const shot = h.seen.gunshot![0];
    expect(shot.direction.y).toBeCloseTo(0, 5);
    expect(shot.direction.x).toBeCloseTo(-1, 5);
    expect(shot.position.x).toBeLessThan(-0.9); // outside the driver's window
    expect(ped.hits).toHaveLength(1);
    expect(car.damage).toHaveLength(0);
    // Long guns stay stowed while driving.
    h.combat.select('shotgun');
    h.run(0.5);
    expect(h.player.aiming).toBe(false);
  });
});

describe('combat: pickups', () => {
  it('are collected on foot within reach, and removed', () => {
    const h = harness();
    h.combat.spawnPickup('cash', 0.5, 0.5, 120);
    h.combat.spawnPickup('cash', 30, 0, 999);
    h.run(0.1);
    expect(h.player.money).toBe(120);
    expect(h.seen.pickup).toEqual([{ kind: 'cash', amount: 120 }]);
    expect(h.audio).toHaveBeenCalledWith('cash', expect.anything());
    h.run(0.5);
    expect(h.player.money).toBe(120);
  });

  it('heal and armour only when needed; weapons arrive with ammunition', () => {
    const h = harness();
    h.combat.spawnPickup('health', 0.3, 0);
    h.combat.spawnPickup('armour', -0.3, 0, 40);
    h.combat.spawnPickup('shotgun', 0, 0.4);
    h.run(0.1);
    expect(h.seen.pickup?.map((p) => p.kind).sort()).toEqual(['armour', 'shotgun']);
    expect(h.player.armour).toBe(40);
    expect(h.combat.has('shotgun')).toBe(true);
    expect(h.combat.ammo('shotgun').clip + h.combat.ammo('shotgun').reserve).toBeGreaterThan(0);
    expect(h.combat.current.id).toBe('shotgun'); // drawn, since the player was unarmed
    h.player.health = 30;
    h.run(0.1);
    expect(h.player.health).toBe(30 + TUNING.healthPickup);
    expect(h.audio).toHaveBeenCalledWith('pickup', expect.anything());
  });

  it('respawn after their timer, can be removed, and are left alone from a car', () => {
    const h = harness();
    const remove = h.combat.spawnPickup('cash', 0.2, 0, 10, 5);
    h.run(0.1);
    expect(h.player.money).toBe(10);
    h.run(4);
    expect(h.player.money).toBe(10);
    h.run(1.2);
    expect(h.player.money).toBe(20);
    remove();
    h.run(6);
    expect(h.player.money).toBe(20);
    h.player.vehicle = h.car(40, 40);
    h.combat.spawnPickup('cash', 0, 0.2, 5);
    h.run(0.2);
    expect(h.player.money).toBe(20);
    h.player.vehicle = null;
    h.run(0.1);
    expect(h.player.money).toBe(25);
  });

  it('weapon drops fade on their timer and share the drop cap with cash', () => {
    const h = harness();
    const live = () => (h.combat as unknown as { livePickups(): { kind: string; x: number; z: number }[] }).livePickups();
    h.player.position.set(200, 0, 200); // well out of collecting range
    h.combat.spawnPickup('pistol', 0, 0, 8, 0, { ttl: 1.5, drop: true });
    expect(live().map((p) => p.kind)).toEqual(['pistol']);
    h.run(2);
    expect(live()).toEqual([]); // faded away by itself
    // Dropped weapons and dropped cash share one cap: the oldest drop makes way.
    h.combat.spawnPickup('shotgun', 1, 0, 3, 0, { ttl: 60, drop: true });
    for (let i = 0; i < TUNING.maxCashDrops; i++) h.combat.spawnPickup('cash', 2 + i, 0, 5, 0, { ttl: 60, drop: true });
    const kinds = live().map((p) => p.kind);
    expect(kinds.length).toBe(TUNING.maxCashDrops);
    expect(kinds).not.toContain('shotgun');
    // Placed pickups are not drops and are left alone by the cap.
    h.combat.spawnPickup('health', 50, 0);
    expect(live().length).toBe(TUNING.maxCashDrops + 1);
  });

  it('ignores unknown kinds and stays out of marae', () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = h.ctx.scene.children.length;
    h.combat.spawnPickup('jetpack', 0, 0)();
    h.combat.spawnPickup('cash', 510, 505, 50)();
    expect(h.ctx.scene.children.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('pedestrians and gang members sometimes drop cash; police never do', () => {
    const h = harness();
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // under the drop chance
    h.player.position.set(50, 0, 50);
    const ped = h.ped('ped', 50.2, 50.2, 10);
    const cop = h.ped('cop', 80, 80, 10);
    cop.takeDamage({ amount: 50, kind: 'bullet' });
    h.run(0.1);
    expect(h.count('pickup')).toBe(0);
    ped.takeDamage({ amount: 50, kind: 'bullet' });
    h.run(0.1);
    expect(h.seen.pickup).toHaveLength(1);
    expect(h.seen.pickup![0].kind).toBe('cash');
    expect(h.player.money).toBeGreaterThanOrEqual(TUNING.cashDropMin);
    expect(h.player.money).toBeLessThanOrEqual(TUNING.cashDropMax);
    // An unlucky roll drops nothing.
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    const other = h.ped('ped', 50.1, 50.1, 10);
    other.takeDamage({ amount: 50, kind: 'bullet' });
    h.run(0.1);
    expect(h.seen.pickup).toHaveLength(1);
  });
});

describe('combat: blood and marks', () => {
  const fxOf = (h: Harness) => (h.combat as unknown as { fx: Effects }).fx;
  const decalPositions = (fx: Effects) => (fx.decals.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('iPos').array as Float32Array;
  /** Live decals in one ring: the gore splats (DecalRing.Drop) are counted apart from the other stains. */
  const inRing = (fx: Effects, ring: number) => {
    const d = fx.decals as unknown as { ringStart: number[]; ringSize: number[]; live: Uint8Array };
    let n = 0;
    for (let i = d.ringStart[ring]; i < d.ringStart[ring] + d.ringSize[ring]; i++) n += d.live[i];
    return n;
  };
  const splats = (fx: Effects) => inRing(fx, DecalRing.Drop);
  const stains = (fx: Effects) => fx.decals.active - splats(fx);

  it('a bullet in a person sprays blood on along the shot, marks the ground, and pools when they die', () => {
    const h = harness();
    const fx = fxOf(h);
    const ped = h.ped('ped', 0, 6, 40);
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(fx.smoke.alive).toBeGreaterThanOrEqual(12); // drops and mist
    expect(fx.decals.active).toBe(1); // spatter
    const spatterZ = decalPositions(fx)[2];
    expect(spatterZ).toBeGreaterThan(5.5); // beyond the victim, down-range
    expect(ped.alive).toBe(true);
    h.ctx.clock.elapsed += 1;
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(ped.alive).toBe(false);
    expect(fx.decals.active).toBe(3); // second spatter and the pool
  });

  it('a car hitting someone throws blood on down the road and across its front; the pool waits for the body to land', () => {
    const h = harness();
    const fx = fxOf(h);
    const ped = h.ped('ped', 0, 6);
    // A box of a car facing +z, its nose just short of them.
    const car = h.car(0, 3);
    car.group.position.copy(car.position);
    car.group.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4.8), new THREE.MeshBasicMaterial()));
    car.group.updateMatrixWorld(true);
    car.velocity.set(0, 0, 14);
    h.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 14, under: false });
    expect(fx.smoke.alive).toBeGreaterThan(10);
    expect(stains(fx)).toBe(2);
    expect(splats(fx)).toBeGreaterThan(0); // hit hard enough to tear: pieces landing round them
    const pos = decalPositions(fx);
    const slots = [...Array(fx.decals.capacity).keys()];
    const road = slots.find((i) => pos[i * 3 + 2] > 6);
    const panel = slots.find((i) => Math.abs(pos[i * 3 + 2] - 5.4) < 0.05);
    expect(road).toBeDefined(); // thrown on ahead of the car
    expect(pos[road! * 3 + 1]).toBeLessThan(0.1);
    expect(panel).toBeDefined(); // on the grille
    // The car takes it away with it.
    car.position.z += 20;
    car.group.position.copy(car.position);
    h.run(1 / 60);
    expect(pos[panel! * 3 + 2]).toBeCloseTo(25.4, 1);

    // Killed and still flying: no pool until the body stops, then one where it lies.
    const before = fx.decals.active;
    ped.velocity.set(0, 0, 8);
    ped.takeDamage({ amount: 200, kind: 'vehicle', source: null });
    expect(ped.alive).toBe(false);
    h.run(0.5);
    expect(fx.decals.active).toBe(before);
    ped.position.z = 14;
    ped.velocity.set(0, 0, 0);
    h.run(1 / 60);
    expect(fx.decals.active).toBe(before + 1);
    expect(slots.some((i) => Math.abs(pos[i * 3 + 2] - 13.6) < 0.01)).toBe(true);
  });

  it('wheels going over someone squeeze blood out either side, smear it along the road and print it on down the road', () => {
    const h = harness();
    const fx = fxOf(h);
    const ped = h.ped('ped', 2, 8);
    ped.heading = Math.PI / 2; // lying back along −x from the feet
    const car = h.car(1.4, 8);
    car.velocity.set(0, 0, 6);
    h.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 6, under: true });
    expect(fx.smoke.alive).toBeGreaterThan(8);
    expect(stains(fx)).toBe(2); // the smear, and a splash thrown out to one side
    expect(splats(fx)).toBeGreaterThan(0); // and what the tyre tore out
    const pos = decalPositions(fx);
    const u = (fx.decals.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('iU').array as Float32Array;
    // Under the body, not the feet, and drawn out along the car's travel.
    expect(pos[0]).toBeCloseTo(1.4, 3);
    expect(pos[2]).toBeCloseTo(8, 3);
    expect(Math.abs(u[2])).toBeGreaterThan(Math.abs(u[0]) * 5);
    // The splash went sideways, off the line of travel.
    expect(Math.abs(pos[3] - 1.4)).toBeGreaterThan(0.3);

    // Driving on, the tyres print red on the road for a while, then wear clean.
    const before = fx.decals.active;
    const drive = (metres: number) => {
      for (let i = 0; i < metres / 0.1; i++) {
        car.position.z += 0.1;
        h.run(1 / 60);
      }
    };
    drive(8);
    const printed = fx.decals.active - before;
    expect(printed).toBeGreaterThan(10); // two rear wheels, a print every 75 cm
    drive(30);
    const worn = fx.decals.active;
    drive(10);
    expect(fx.decals.active).toBe(worn);
    expect(worn - before).toBeLessThan(2 * Math.ceil(24 / 0.75) + 4);
  });

  it('a cameo struck or run over by a car shows no blood', () => {
    const h = harness();
    const fx = fxOf(h);
    const cameo = Object.assign(h.ped('scripted', 0, 6), { invulnerable: true });
    const car = h.car(0, 3);
    car.velocity.set(0, 0, 14);
    h.events.emit('vehicleHitActor', { actor: cameo, vehicle: car, speed: 14, under: false });
    h.events.emit('vehicleHitActor', { actor: cameo, vehicle: car, speed: 14, under: true });
    expect(fx.smoke.alive).toBe(0);
    expect(fx.decals.active).toBe(0);
  });

  it('someone badly hurt and on their feet leaves a trail of drops as they go, and stops when they die', () => {
    const h = harness();
    const fx = fxOf(h);
    const ped = h.ped('ped', 0, 6, 100);
    ped.health = 55;
    h.events.emit('actorDamaged', { actor: ped, info: { amount: 45, kind: 'bullet', direction: new THREE.Vector3(0, 0, 1) } });
    h.run(1 / 60);
    const at = splats(fx);
    for (let i = 0; i < 20; i++) {
      ped.position.z += 0.5;
      h.run(1 / 10);
    }
    const trail = splats(fx) - at;
    expect(trail).toBeGreaterThan(3); // ten metres
    expect(trail).toBeLessThan(20);
    ped.alive = false;
    h.run(1 / 60);
    const dead = splats(fx);
    for (let i = 0; i < 10; i++) {
      ped.position.z += 0.5;
      h.run(1 / 10);
    }
    expect(splats(fx)).toBe(dead);
  });

  it('a punch does not open anyone up', () => {
    const h = harness();
    const fx = fxOf(h);
    const ped = h.ped('ped', 0, 6, 100);
    ped.health = 50;
    h.events.emit('actorDamaged', { actor: ped, info: { amount: 14, kind: 'melee' } });
    for (let i = 0; i < 20; i++) {
      ped.position.z += 0.5;
      h.run(1 / 10);
    }
    expect(splats(fx)).toBe(0);
  });

  it('hits soak the clothes where they land: a round more than a punch, a bat in between, a blast sooting them', () => {
    const h = harness();
    const fx = fxOf(h);
    const stains: [THREE.Vector3 | null, number, number][] = [];
    const figure = { stain: (point: THREE.Vector3 | null, size: number, soot = 0) => stains.push([point?.clone() ?? null, size, soot]) };
    const ped = Object.assign(h.ped('ped', 0, 6, 1000), { figure });
    const at = new THREE.Vector3(0, 1.3, 5.8);
    h.events.emit('actorDamaged', { actor: ped, info: { amount: 26, kind: 'bullet', point: at, direction: new THREE.Vector3(0, 0, 1) } });
    h.events.emit('actorDamaged', { actor: ped, info: { amount: 14, kind: 'melee', point: at } });
    h.events.emit('actorDamaged', { actor: ped, info: { amount: 32, kind: 'melee', point: at } });
    expect(stains).toHaveLength(3);
    expect(stains[0][0]!.distanceTo(at)).toBeLessThan(1e-6);
    expect(stains[0][1]).toBeGreaterThan(stains[2][1]);
    expect(stains[2][1]).toBeGreaterThan(stains[1][1]);
    stains.length = 0;
    h.events.emit('actorDamaged', { actor: ped, info: { amount: 60, kind: 'explosion', point: at, direction: new THREE.Vector3(0, 0, 1) } });
    expect(stains.length).toBeGreaterThan(0);
    expect(stains[0][2]).toBeGreaterThan(0.5);
    expect(fx).toBeDefined();
  });

  it('a cameo is never stained', () => {
    const h = harness();
    const stains: unknown[] = [];
    const figure = { stain: (...args: unknown[]) => stains.push(args) };
    const cameo = Object.assign(h.ped('scripted', 0, 6), { invulnerable: true, figure });
    const car = h.car(0, 3);
    car.velocity.set(0, 0, 14);
    h.events.emit('actorDamaged', { actor: cameo, info: { amount: 26, kind: 'bullet', point: new THREE.Vector3(0, 1.3, 6) } });
    h.events.emit('vehicleHitActor', { actor: cameo, vehicle: car, speed: 14, under: false });
    h.events.emit('vehicleHitActor', { actor: cameo, vehicle: car, speed: 14, under: true });
    expect(stains).toHaveLength(0);
  });

  it('a car leaves them bloodied front and legs; wheels over them, where the tyre went', () => {
    const h = harness();
    const stains: THREE.Vector3[] = [];
    const figure = { stain: (point: THREE.Vector3 | null) => point && stains.push(point.clone()) };
    const ped = Object.assign(h.ped('ped', 0, 6), { figure });
    const car = h.car(0, 3);
    car.velocity.set(0, 0, 14);
    h.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 14, under: false });
    expect(stains).toHaveLength(2);
    expect(stains[0].y).toBeGreaterThan(stains[1].y);
    expect(stains[0].z).toBeLessThan(6); // the side that faced the car
    stains.length = 0;
    h.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 6, under: true });
    expect(stains.length).toBeGreaterThan(0);
    expect(stains[0].y).toBeLessThan(0.5); // lying in the road
  });

  it('a punch draws a little blood; the bat draws more', () => {
    const h = harness();
    const fx = fxOf(h);
    h.ped('ped', 0, 1.2, 1000);
    h.combat.melee(h.player, h.combat.weapons.get('fists')!.damage);
    const punch = fx.smoke.alive;
    expect(punch).toBeGreaterThan(4); // drops and a little haze, not just a puff of cloth
    expect(fx.decals.active).toBe(1); // drips on the ground
    h.run(1);
    expect(fx.smoke.alive).toBe(0);
    h.combat.melee(h.player, h.combat.weapons.get('bat')!.damage, 2);
    expect(fx.smoke.alive).toBeGreaterThan(punch * 1.8);
    expect(fx.decals.active).toBe(2);
  });

  it('a shot through someone splashes the wall behind them, and the splash runs down it', () => {
    const h = harness();
    const fx = fxOf(h);
    h.ped('ped', 0, 6, 1000);
    // A wall across the street 2 m behind them, facing back up it.
    const physics = h.ctx.physics as unknown as { raycast: (o: THREE.Vector3, d: THREE.Vector3, max: number, opts?: { mask?: number }) => RayHit | null };
    const ray = physics.raycast;
    physics.raycast = (o, d, max, opts) => {
      if (opts?.mask !== 3 || d.z <= 0) return ray(o, d, max, opts);
      const distance = (8 - o.z) / d.z;
      if (distance > max) return null;
      return { point: o.clone().addScaledVector(d, distance), normal: new THREE.Vector3(0, 0, -1), distance, collider: null as never, owner: null };
    };
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(fx.decals.active).toBe(2); // on the ground, and on the wall
    const pos = decalPositions(fx);
    const u = (fx.decals.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('iU').array as Float32Array;
    const slot = [...Array(fx.decals.capacity).keys()].find((i) => Math.abs(pos[i * 3 + 2] - 8) < 0.05)!;
    expect(slot).toBeDefined();
    expect(pos[slot * 3 + 1]).toBeGreaterThan(0.5); // up on the wall, at the height of the wound
    expect(u[slot * 3 + 1]).toBeLessThan(0); // laid with its runs going downhill
  });

  it('a blast throws blood out of the people it catches, and they pool where they land', () => {
    const h = harness();
    const fx = fxOf(h);
    h.player.position.set(0, 0, -40);
    const ped = h.ped('ped', 2, 10, 60);
    h.combat.explode(new THREE.Vector3(0, 0.8, 10), 9, 120, null);
    expect(ped.alive).toBe(false);
    expect(stains(fx)).toBe(2); // the scorch and the spatter beyond them
    expect(splats(fx)).toBeGreaterThan(0); // caught close: in pieces
    // Thrown by the blast; the pool waits for the body to stop.
    ped.velocity.set(0, 0, 0);
    h.run(1 / 60);
    expect(stains(fx)).toBe(3);
  });

  it('a body thrown by a car smears the road as it slides, but not while it is in the air', () => {
    const h = harness();
    const fx = fxOf(h);
    const ped = h.ped('ped', 0, 6);
    const car = h.car(0, 3);
    car.velocity.set(0, 0, 14);
    h.events.emit('vehicleHitActor', { actor: ped, vehicle: car, speed: 14, under: false });
    const before = fx.decals.active;
    // Up over the bonnet: nothing.
    ped.group.position.set(0, 1.2, 6);
    for (let i = 0; i < 10; i++) {
      ped.position.z += 0.3;
      h.run(1 / 60);
    }
    expect(fx.decals.active).toBe(before);
    // Down and sliding: a smear every half-metre or so.
    ped.group.position.y = 0;
    for (let i = 0; i < 20; i++) {
      ped.position.z += 0.2;
      h.run(1 / 60);
    }
    const smears = fx.decals.active - before;
    expect(smears).toBeGreaterThanOrEqual(5);
    expect(smears).toBeLessThanOrEqual(8);
  });

  it('bullets leave holes in the world and pocks that ride on cars', () => {
    const h = harness();
    const fx = fxOf(h);
    h.ground.enabled = true;
    h.combat.fire(h.player, 'pistol', muzzle(), new THREE.Vector3(0, -1, 1).normalize());
    expect(fx.decals.active).toBe(1);

    const car = h.car(0, 12);
    car.group.position.copy(car.position);
    car.group.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4.6), new THREE.MeshBasicMaterial()));
    car.group.updateMatrixWorld(true);
    h.ctx.clock.elapsed += 5;
    h.combat.fire(h.player, 'pistol', muzzle(), ahead());
    expect(fx.decals.active).toBe(2);
    expect(fx.glow.alive).toBeGreaterThan(6); // sparks
    // The pock sits on the panel the bullet struck (the box's near face), not on the physics shape.
    const pos = decalPositions(fx);
    const slot = [...Array(fx.decals.capacity).keys()].find((i) => Math.abs(pos[i * 3 + 2] - (12 - 2.3)) < 0.05)!;
    expect(slot).toBeDefined();
    // And goes with the car when it moves.
    car.position.x += 30;
    car.group.position.copy(car.position);
    h.run(1 / 60);
    expect(pos[slot * 3]).toBeCloseTo(30, 1);
    // Scrapped with the car.
    car.group.removeFromParent();
    h.run(1 / 60);
    expect(fx.decals.active).toBe(1);
  });

  it('an explosion scorches the ground and keeps burning for a while', () => {
    const h = harness();
    const fx = fxOf(h);
    h.player.position.set(0, 0, -30);
    h.combat.explode(new THREE.Vector3(0, 0.8, 10), 9, 100, null);
    expect(fx.decals.active).toBe(1);
    expect(fx.glow.alive).toBeGreaterThan(40);
    expect(fx.smoke.alive).toBeGreaterThan(40);
    h.run(3);
    expect(fx.smoke.alive).toBeGreaterThan(10); // the column
    h.run(14);
    expect(fx.smoke.alive).toBe(0);
    expect(fx.glow.alive).toBe(0);
    expect(fx.decals.active).toBe(1); // the scorch outlasts the fire
  });
});

describe('combat: effects stay within budget', () => {
  it('a long firefight with explosions never grows the scene', () => {
    const h = harness();
    h.ground.enabled = true;
    const car = h.car(4, 10);
    h.ped('ped', 0, 8, 1e9);
    h.combat.give('shotgun', 5);
    const children = () => h.ctx.scene.children.length;
    h.run(0.1);
    const before = children();
    let seed = 7;
    h.combat.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      h.combat.fire(h.player, i % 3 === 0 ? 'shotgun' : 'pistol', muzzle(), new THREE.Vector3((i % 7) * 0.08 - 0.1, -0.02, 1).normalize());
      if (i % 40 === 0) h.combat.explode(new THREE.Vector3(i % 9, 0.8, 12), 9, 1, null);
      car.burning = i > 100 && i < 200;
      h.run(1 / 60);
    }
    expect(children()).toBe(before);
    const lights = h.ctx.scene.children.filter((c) => (c as THREE.PointLight).isPointLight);
    expect(lights).toHaveLength(2);
  });
});

describe('combat: the shotgun in a patrol car', () => {
  const drive = (h: Harness, vehicle: Vehicle) => {
    vehicle.driver = h.player;
    h.player.vehicle = vehicle;
    h.events.emit('vehicleEntered', { actor: h.player, vehicle, stolen: true, ejected: null });
  };

  it('is the player\'s the first time they take the wheel, once per car', () => {
    const h = harness();
    drive(h, h.car(0, 12));
    expect(h.combat.has('shotgun')).toBe(false);
    expect(h.toasts).toHaveLength(0);

    const patrol = h.car(10, 12, 'police');
    drive(h, patrol);
    expect(h.combat.has('shotgun')).toBe(true);
    expect(h.combat.ammo('shotgun')).toEqual({ clip: 5, reserve: TUNING.copCarShells - 5 });
    expect(h.combat.current.id).toBe('shotgun'); // empty-handed, so it is drawn
    expect(h.seen.weaponChanged?.at(-1)).toEqual({ weaponId: 'shotgun' });
    expect(h.audio).toHaveBeenCalledWith('pickup', expect.anything());
    expect(h.toasts).toHaveLength(1);
    // The rack in that car is empty now.
    drive(h, patrol);
    expect(h.combat.ammo('shotgun')).toEqual({ clip: 5, reserve: 5 });
    expect(h.toasts).toHaveLength(1);

    // Any police vehicle (a roadblock car, the armed-response van) carries one: shells for the gun already held.
    const van = h.car(20, 12);
    van.tags.add('police');
    drive(h, van);
    expect(h.combat.ammo('shotgun')).toEqual({ clip: 5, reserve: 5 + TUNING.copCarShells });
    expect(h.toasts[1]).toContain(`${TUNING.copCarShells} shotgun shells`);
    // No pickup event: that would claim a one-off world pickup lying under the player's feet.
    expect(h.count('pickup')).toBe(0);
  });

  it('does not come with someone else at the wheel, and is left in the rack while the player is full up', () => {
    const h = harness();
    const crewed = h.car(0, 12, 'police');
    const cop = h.ped('cop', 0, 12);
    crewed.driver = cop;
    h.events.emit('vehicleEntered', { actor: cop, vehicle: crewed, stolen: false, ejected: null });
    expect(h.combat.has('shotgun')).toBe(false);

    h.combat.give('shotgun', 999);
    const patrol = h.car(10, 12, 'police');
    drive(h, patrol);
    expect(h.toasts).toHaveLength(0);
    h.events.emit('playerRespawned', { reason: 'died' }); // half the spare shells gone
    const reserve = h.combat.ammo('shotgun').reserve;
    drive(h, patrol);
    expect(h.combat.ammo('shotgun').reserve).toBe(reserve + TUNING.copCarShells);
  });
});
