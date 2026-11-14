/**
 * Mission data format. A mission is a list of declarative steps that `runner.ts` interprets; nothing in
 * a definition touches the game directly except the `custom` escape hatch and the optional hooks.
 */
import type { ActorKind, GameContext, HumanoidLook, PedHandle, SfxId, Vehicle, VehicleClass, WeatherKind } from '../core/types';

/** One subtitled line. `seconds` defaults to a reading time worked out from the length. */
export interface Line {
  who?: string;
  text: string;
  seconds?: number;
}

/** Road name fragment(s), matched case-insensitively against `RoadEdge.name`. */
export type RoadName = string | readonly string[];

/**
 * Where something is. A bare string is a contract place id. The object form starts from a place, an
 * absolute point, a named junction or a spawned entity, optionally snaps to the road network, then applies
 * offsets. Everything is resolved at run time, so definitions never carry map coordinates.
 */
export interface SpotObject {
  /** Contract place id: origin and heading of the local frame. */
  place?: string;
  /** Absolute position (rare; prefer places). */
  x?: number;
  z?: number;
  /** Handle of a spawned vehicle / pedestrian: the spot follows it. */
  entity?: string;
  /**
   * A landmark by kind (e.g. 'marae'): the one nearest the place `near`, else the first on the map.
   * `edge` moves the point from the landmark's centre towards its front, as a fraction of its clear radius
   * (1 = the front edge of the cleared ground, where it meets the road).
   */
  landmark?: string;
  near?: string;
  edge?: number;
  /** The junction where two named roads meet. Falls back to `place` / `x,z` (+ `dx,dz`) when not found. */
  junction?: readonly [RoadName, RoadName];
  /** World-axis offset (east, south) applied to the place / point. Ignored when a junction was found. */
  dx?: number;
  dz?: number;
  /**
   * Snap to the nearest drivable road (within 60 m):
   *  - 'lane'  kerb-side lane centre on the spot's own side of the road, heading the way that lane runs
   *  - 'road'  centre line
   *  - 'verge' just off the carriageway (footpath / shoulder) on `side`
   *  - 'node'  nearest junction node
   */
  snap?: 'lane' | 'road' | 'verge' | 'node';
  /** Only snap to roads whose name contains this (falls back to any road). */
  road?: RoadName;
  /** Face along the road in the direction that leads towards this spot. */
  toward?: Spot;
  /** Slide this many metres along the road in the facing direction (after snapping). */
  along?: number;
  /** 'verge' side relative to the facing direction: 1 = left, -1 = right. Default: the side the place is on. */
  side?: 1 | -1;
  /** 'verge': metres beyond the edge of the seal (default 1.7, the footpath centre). 'lane': extra metres towards the kerb. */
  out?: number;
  /** 'lane': park against the kerb (a car's width in from it) instead of in the middle of the lane. */
  kerb?: boolean;
  /** Final offsets in the resolved frame: metres ahead / to the left. */
  forward?: number;
  left?: number;
  /** Added to the resolved heading (radians). */
  turn?: number;
}

export type Spot = string | SpotObject;

/** What a `custom` step, a hook or a custom fail test may use. */
export interface MissionRuntime {
  readonly ctx: GameContext;
  readonly def: MissionDef;
  /** Seconds since the mission / the current step began. */
  readonly elapsed: number;
  readonly stepTime: number;
  /** Scratch numbers for custom logic; cleared when the mission ends. */
  readonly vars: Record<string, number>;
  /** A spawned mission vehicle / pedestrian by handle (null until it exists). */
  vehicle(name: string): Vehicle | null;
  ped(name: string): PedHandle | null;
  say(lines: readonly Line[]): void;
  objective(text: string | null): void;
  fail(reason: string): void;
  /** Freeze / unfreeze the player; always restored when the mission ends. */
  freezePlayer(frozen: boolean): void;
}

export type MissionResult = 'passed' | 'failed' | 'aborted';

/** Checked every frame while the step (or, at mission level, the whole mission) is running. */
export type FailCondition =
  | { kind: 'vehicleDestroyed'; vehicle: string; reason?: string }
  /** Health fell below this fraction of the spec's health. */
  | { kind: 'vehicleDamaged'; vehicle: string; below: number; reason?: string }
  /** A vehicle / pedestrian got further than this from the player. */
  | { kind: 'escaped'; target: string; distance: number; reason?: string }
  | { kind: 'pedDied'; ped: string; reason?: string }
  /** The player is out of the vehicle and this far from it. */
  | { kind: 'abandoned'; vehicle: string; distance: number; reason?: string }
  | { kind: 'wantedAbove'; level: number; reason?: string }
  | { kind: 'custom'; test(run: MissionRuntime): boolean; reason: string };

/** Countdown length: fixed, or scaled by the road distance from the player to `to` when the step starts. */
export interface TimerSpec {
  seconds?: number;
  base?: number;
  perKm?: number;
  to?: Spot;
  label?: string;
  /** Fail reason on expiry. */
  reason?: string;
}

/** Something that happens a set time into a step. */
export interface Cue {
  /** Seconds since the step began. */
  at: number;
  lines?: readonly Line[];
  /** Raise the wanted level to at least this, and hold it there for the rest of the step. */
  wanted?: number;
  toast?: string;
  sfx?: SfxId;
}

export interface StepCommon {
  /** Label for debugging and tests. */
  id?: string;
  /** Skip this step when the spot cannot be found on the map (optional story beats). */
  needs?: Spot;
  /** Objective line. Omit to keep the previous one; null clears it. `{n}` is replaced by a count where one applies. */
  objective?: string | null;
  /** Fail when this runs out (step-scoped; see `startTimer` for one that spans steps). */
  timer?: number | TimerSpec;
  failIf?: readonly FailCondition[];
  /** Dialogue queued when the step begins (never blocks). */
  lines?: readonly Line[];
  toast?: string;
  cues?: readonly Cue[];
  police?: {
    /** Keep the wanted level at or above this while the step runs. */
    minLevel?: number;
    heatPerSecond?: number;
    /** Suspend the law for the step (always restored). */
    suspend?: boolean;
    /** Drop any wanted level when the step begins. */
    clear?: boolean;
  };
}

export interface GoToStep extends StepCommon {
  kind: 'goTo';
  to: Spot;
  /** Default 6 m. */
  radius?: number;
  /** 'any' (default), on 'foot', or in a 'vehicle' (a specific one with `vehicle`). */
  mode?: 'any' | 'foot' | 'vehicle';
  vehicle?: string;
  /** Must be nearly stationary. */
  stop?: boolean;
  /** In-world ring and map blip (both default true). */
  marker?: boolean;
  blip?: boolean;
}

export interface EnterVehicleStep extends StepCommon {
  kind: 'enterVehicle';
  /** A spawned mission vehicle… */
  vehicle?: string;
  /** …or any vehicle of these spec ids / classes. */
  spec?: string | readonly string[];
  cls?: VehicleClass | readonly VehicleClass[];
}

export interface DeliverVehicleStep extends StepCommon {
  kind: 'deliverVehicle';
  vehicle: string;
  to: Spot;
  /** Default 8 m. */
  radius?: number;
  /** Fail if health drops below this fraction of the spec's health. */
  minHealth?: number;
  damageReason?: string;
  /** Objective shown while the player is out of the vehicle. */
  returnObjective?: string;
  /** Only counts with no wanted level. */
  clean?: boolean;
  cleanObjective?: string;
  /** Fade out, step the player out and take the vehicle away. */
  handover?: boolean;
}

export interface SpawnVehicleStep extends StepCommon {
  kind: 'spawnVehicle';
  /** Handle for later steps. */
  as: string;
  spec: string;
  at: Spot;
  color?: number;
  tags?: readonly string[];
  /** The player may take it without it counting as theft. */
  owned?: boolean;
  /** Health multiplier. */
  health?: number;
  /** AI-driven (rivals, chase targets): needs the traffic module; the handle is skipped if that is unavailable. */
  ai?: { aggression?: number; cruiseSpeed?: number };
  /** Spawn once the player is this close (default 500 m) and the area is loaded. */
  activate?: number;
  /** Hold the step until the spawn has happened (default: carry on, later steps wait as needed). */
  wait?: boolean;
}

export interface PedDef {
  as: string;
  at: Spot;
  name?: string;
  /** Default 'gang' when attacking, otherwise 'scripted'. */
  kind?: ActorKind;
  behaviour?: 'wander' | 'stand' | 'flee' | 'attack' | 'follow';
  weapon?: string;
  health?: number;
  look?: Partial<HumanoidLook>;
}

export interface SpawnPedsStep extends StepCommon {
  kind: 'spawnPeds';
  peds: readonly PedDef[];
  /** Default 250 m. */
  activate?: number;
  wait?: boolean;
}

export interface SpawnPickupStep extends StepCommon {
  kind: 'spawnPickup';
  as?: string;
  /** 'health' | 'armour' | 'cash' | weapon id. */
  pickup: string;
  at: Spot;
  amount?: number;
  activate?: number;
}

export interface EliminateStep extends StepCommon {
  kind: 'eliminate';
  /** Pedestrian handles (must die) and / or vehicle handles (must be destroyed). */
  targets: readonly string[];
  blips?: boolean;
}

export interface LoseHeatStep extends StepCommon {
  kind: 'loseHeat';
  /** Make sure there is at least this much heat to lose. */
  atLeast?: number;
  /** The law cannot be shaken for this long: `atLeast` is held, then the player may lose them. */
  holdFor?: number;
  /** A mission vehicle the player has to keep hold of: the objective changes while they are out of it. */
  vehicle?: string;
  returnObjective?: string;
}

export interface WaitStep extends StepCommon {
  kind: 'wait';
  seconds: number;
}

/** Like `wait`, with the countdown on screen. */
export interface SurviveStep extends StepCommon {
  kind: 'survive';
  seconds: number;
  label?: string;
}

export interface RivalDef {
  as: string;
  spec: string;
  name?: string;
  aggression?: number;
  cruiseSpeed?: number;
}

export interface RaceStep extends StepCommon {
  kind: 'race';
  /** Start line: a lane spot. Rivals line up around it. */
  grid: Spot;
  /** In order; the last one is the finish. */
  checkpoints: readonly Spot[];
  laps?: number;
  /** Checkpoint radius, default 22 m. */
  radius?: number;
  rivals: readonly RivalDef[];
  /** Seconds, default 3. */
  countdown?: number;
  /**
   * With no rivals available (traffic AI missing) the lap is against the clock instead: the par time is the
   * course length divided by this average speed (m/s).
   */
  parSpeed?: number;
  loseReason?: string;
}

export interface ChaseStep extends StepCommon {
  kind: 'chase';
  /** An AI vehicle handle. It drives to `to`; the step ends when it gets there, is wrecked, or the player beats it there. */
  target: string;
  to: Spot;
  /** Fail when the target is further than this for more than `grace` seconds (default 4). */
  maxDistance: number;
  grace?: number;
  /** Default 60 m. */
  arriveRadius?: number;
  cruiseSpeed?: number;
  aggression?: number;
  lostReason?: string;
}

export interface SayStep extends StepCommon {
  kind: 'say';
  lines: readonly Line[];
  /** Wait for the dialogue queue to finish. */
  block?: boolean;
}

/** Change what spawned pedestrians are doing (an ambush that waits for its cue). */
export interface SetBehaviourStep extends StepCommon {
  kind: 'setBehaviour';
  peds: readonly string[];
  behaviour: 'wander' | 'stand' | 'flee' | 'attack' | 'follow';
}

export interface SetWeatherStep extends StepCommon {
  kind: 'setWeather';
  weather: WeatherKind;
  transition?: number;
}

export interface SetTimeStep extends StepCommon {
  kind: 'setTime';
  hour: number;
  /** Leave the clock alone if it is already inside this window (wraps past midnight). */
  unlessBetween?: readonly [number, number];
  /** Fade to black around the jump. */
  fade?: boolean;
}

export interface GiveWeaponStep extends StepCommon {
  kind: 'giveWeapon';
  weapon: string;
  ammo: number;
  select?: boolean;
  armour?: number;
}

export interface SetWantedStep extends StepCommon {
  kind: 'setWanted';
  /** Raise the wanted level to at least this. */
  level: number;
}

export interface StartTimerStep extends StepCommon {
  kind: 'startTimer';
  /** A countdown that keeps running across steps until `stopTimer`. */
  time: number | TimerSpec;
}

export interface StopTimerStep extends StepCommon {
  kind: 'stopTimer';
}

export interface DespawnStep extends StepCommon {
  kind: 'despawn';
  handles: readonly string[];
}

export interface CustomStep extends StepCommon {
  kind: 'custom';
  enter?(run: MissionRuntime): void;
  /** Return true when done. Omit for a one-shot. */
  tick?(run: MissionRuntime, dt: number): boolean | void;
  exit?(run: MissionRuntime): void;
}

export type Step =
  | GoToStep
  | EnterVehicleStep
  | DeliverVehicleStep
  | SpawnVehicleStep
  | SpawnPedsStep
  | SpawnPickupStep
  | EliminateStep
  | LoseHeatStep
  | WaitStep
  | SurviveStep
  | RaceStep
  | ChaseStep
  | SayStep
  | SetBehaviourStep
  | SetWeatherStep
  | SetTimeStep
  | GiveWeaponStep
  | SetWantedStep
  | StartTimerStep
  | StopTimerStep
  | DespawnStep
  | CustomStep;

export interface MissionDef {
  id: string;
  title: string;
  giver: string;
  /** Map blip label; defaults to the giver's first letter. */
  initial?: string;
  blurb: string;
  reward: number;
  /** Contract place id where the mission starts. */
  placeId: string;
  /** Mission ids that must be done first. */
  requires?: readonly string[];
  steps: readonly Step[];
  /** Conditions that apply to every step (once the handles they mention exist). */
  failIf?: readonly FailCondition[];
  /** Ambient population multipliers while the mission runs (restored afterwards). */
  pedDensity?: number;
  trafficDensity?: number;
  /** Passing this one finishes the story. */
  finale?: boolean;
  onStart?(run: MissionRuntime): void;
  onEnd?(run: MissionRuntime, result: MissionResult): void;
}
