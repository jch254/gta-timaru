/**
 * Continuous sound of the vehicle the player is driving: engine (two rendered exhaust-pulse loops cross-faded
 * across the rev range and bent with playbackRate), induction noise, tyre squeal, road rumble, wind and gravel.
 * The graph only exists while the player is in a vehicle.
 */
import { damp } from '../core/math';
import { Rng } from '../core/rng';
import type { GroundSurface, Vehicle } from '../core/types';
import { biquadQ } from './dsp';
import { GEARBOXES, newGearbox, stepGearbox, type GearboxSpec, type GearboxState } from './gearbox';
import type { Mixer } from './mixer';
import { ENGINE_BASE_RPM, renderEngineLoop, renderGravelLoop, type EngineKind } from './sfx-render';

/** Engine level by type. The bike's two cylinders make a sparser, peakier loop, so it needs more gain for the same loudness. */
const ENGINE_GAIN: Record<Vehicle['spec']['engineSound'], number> = { four: 0.45, six: 0.48, v8: 0.56, diesel: 0.52, bike: 0.75, electric: 0.3 };

/** The exhaust-pulse loop for an engine type and rev band (same seed every time, so it can be pre-rendered). */
export const renderEngine = (kind: EngineKind, band: 0 | 1): Float32Array => renderEngineLoop(kind, band, new Rng(band ? 0xbeef : 0xc0ffee));
export const renderGravel = (): Float32Array => renderGravelLoop(new Rng(0x6ea7e1));
export const ENGINE_KINDS: readonly EngineKind[] = ['four', 'six', 'v8', 'diesel', 'bike'];

/** How loose the ground is, 0 (sealed) .. 1 (metal road). */
export function looseness(surface: GroundSurface): number {
  switch (surface) {
    case 'gravel':
    case 'shingle':
      return 1;
    case 'sand':
      return 0.6;
    case 'grass':
    case 'field':
      return 0.35;
    default:
      return 0;
  }
}

interface Graph {
  bus: GainNode;
  sources: AudioScheduledSourceNode[];
  low: AudioBufferSourceNode | null;
  high: AudioBufferSourceNode | null;
  lowGain: GainNode;
  highGain: GainNode;
  tone: BiquadFilterNode;
  engine: GainNode;
  intakeBand: BiquadFilterNode;
  intake: GainNode;
  skidA: BiquadFilterNode;
  skidB: BiquadFilterNode;
  skid: GainNode;
  roadTone: BiquadFilterNode;
  road: GainNode;
  windBand: BiquadFilterNode;
  wind: GainNode;
  gravelSrc: AudioBufferSourceNode;
  gravel: GainNode;
  hum: OscillatorNode | null;
  whine: OscillatorNode | null;
  whineGain: GainNode | null;
  /** Context time after which a detached graph is torn down. */
  killAt: number;
}

export class VehicleAudio {
  /** Current revs and gear, for anyone curious (debug HUD). */
  gearbox: GearboxState = newGearbox(GEARBOXES.six);
  private spec: GearboxSpec = GEARBOXES.six;
  private vehicle: Vehicle | null = null;
  private graph: Graph | null = null;
  private dying: Graph[] = [];
  private startAt = 0;
  private load = 0;
  private loose = 0;
  private prevThrottle = 0;
  private time = 0;
  private rng = new Rng(0xe9612e);

  constructor(
    private mixer: Mixer,
    private backfire: (vehicle: Vehicle, delay: number) => void,
  ) {}

  get active(): Vehicle | null {
    return this.vehicle;
  }

  /** The player took the wheel. `startDelay` = seconds until the engine catches (0 = already running). */
  attach(vehicle: Vehicle, startDelay: number): void {
    this.detach();
    const ac = this.mixer.ac;
    if (!ac) return;
    this.vehicle = vehicle;
    this.spec = GEARBOXES[vehicle.spec.engineSound];
    this.gearbox = newGearbox(this.spec);
    this.load = 0;
    this.prevThrottle = 0;
    // Leave room for the starter motor, then catch with a little flare of revs.
    this.startAt = ac.currentTime + startDelay;
    if (startDelay > 0) this.gearbox.rpm = this.spec.idle + (this.spec.redline - this.spec.idle) * 0.3;
    this.graph = this.build(ac, vehicle.spec.engineSound);
  }

  /** The player got out: the engine dies away and the graph is released. */
  detach(): void {
    const g = this.graph;
    const ac = this.mixer.ac;
    this.vehicle = null;
    this.graph = null;
    if (!g || !ac) return;
    const t = ac.currentTime;
    g.bus.gain.cancelScheduledValues(t);
    g.bus.gain.setTargetAtTime(0, t, 0.09);
    if (g.low) g.low.playbackRate.setTargetAtTime(0.4, t, 0.2);
    g.killAt = t + 0.6;
    this.dying.push(g);
  }

  private build(ac: AudioContext, kind: Vehicle['spec']['engineSound']): Graph {
    const m = this.mixer;
    const sources: AudioScheduledSourceNode[] = [];
    const gain = (v = 0) => {
      const g = ac.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q: number) => {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = biquadQ(type, q);
      return b;
    };
    const bus = gain(1);
    bus.connect(m.world);

    // Engine.
    const lowGain = gain();
    const highGain = gain();
    const tone = filter('lowpass', 600, 0.8);
    const engine = gain();
    lowGain.connect(tone);
    highGain.connect(tone);
    tone.connect(engine);
    engine.connect(bus);
    let low: AudioBufferSourceNode | null = null;
    let high: AudioBufferSourceNode | null = null;
    let hum: OscillatorNode | null = null;
    let whine: OscillatorNode | null = null;
    let whineGain: GainNode | null = null;
    if (kind === 'electric') {
      hum = ac.createOscillator();
      hum.type = 'triangle';
      hum.frequency.value = 50;
      hum.connect(lowGain);
      hum.start();
      whine = ac.createOscillator();
      whine.type = 'sawtooth';
      whine.frequency.value = 200;
      whineGain = gain();
      const whineBand = filter('bandpass', 1200, 1.5);
      whine.connect(whineBand);
      whineBand.connect(whineGain);
      whineGain.connect(engine);
      whine.start();
      sources.push(hum, whine);
    } else {
      const k: EngineKind = kind;
      // Both loops start on the same firing stroke and are always bent by the same ratio, so their exhaust
      // pulses stay lined up and the cross-fade between them sounds like one engine, not two.
      const rpm = this.gearbox.rpm;
      low = m.loop(m.buffer(`engine:${k}:0`, () => renderEngine(k, 0)), rpm / ENGINE_BASE_RPM[0], 0);
      high = m.loop(m.buffer(`engine:${k}:1`, () => renderEngine(k, 1)), rpm / ENGINE_BASE_RPM[1], 0);
      low.connect(lowGain);
      high.connect(highGain);
      sources.push(low, high);
    }

    // Shared noise beds.
    const white = m.loop(m.noise('white'));
    const pink = m.loop(m.noise('pink'));
    const brown = m.loop(m.noise('brown'));
    sources.push(white, pink, brown);

    const intakeBand = filter('bandpass', 500, 1.2);
    const intake = gain();
    pink.connect(intakeBand);
    intakeBand.connect(intake);
    intake.connect(bus);

    const skidA = filter('bandpass', 1250, 9);
    const skidB = filter('bandpass', 1700, 8);
    const skid = gain();
    white.connect(skidA);
    white.connect(skidB);
    skidA.connect(skid);
    skidB.connect(skid);
    skid.connect(bus);

    const roadTone = filter('lowpass', 200, 0.7);
    const road = gain();
    brown.connect(roadTone);
    roadTone.connect(road);
    road.connect(bus);

    const windBand = filter('bandpass', 600, 0.5);
    const wind = gain();
    pink.connect(windBand);
    windBand.connect(wind);
    wind.connect(bus);

    const gravelSrc = m.loop(m.buffer('loop:gravel', renderGravel));
    const gravel = gain();
    gravelSrc.connect(gravel);
    gravel.connect(bus);
    sources.push(gravelSrc);

    return { bus, sources, low, high, lowGain, highGain, tone, engine, intakeBand, intake, skidA, skidB, skid, roadTone, road, windBand, wind, gravelSrc, gravel, hum, whine, whineGain, killAt: 0 };
  }

  /** Per-frame parameter update. `surface` is the ground under the vehicle. */
  update(dt: number, surface: GroundSurface): void {
    const ac = this.mixer.ac;
    const v = this.vehicle;
    const g = this.graph;
    if (!ac || !v || !g) return;
    const now = ac.currentTime;
    this.time += dt;
    const spec = this.spec;
    const speed = Math.abs(v.speed);
    const grounded = v.wheelsOnGround > 0;
    const alive = !v.destroyed;
    // Reversing is driven by the brake control.
    const throttle = alive ? Math.min(1, Math.max(v.controls.throttle, v.speed < -0.5 ? v.controls.brake : 0)) : 0;
    const changed = stepGearbox(this.gearbox, spec, speed / Math.max(1, v.spec.topSpeed), throttle, grounded, dt);
    const shifting = this.gearbox.shift > 0;
    const loadTarget = shifting ? 0.1 : throttle;
    this.load = damp(this.load, loadTarget, loadTarget > this.load ? 14 : 7, dt);
    const range = spec.redline - spec.idle;
    const revs = range > 0 ? (this.gearbox.rpm - spec.idle) / range : 0;
    const K = 0.035;

    // Engine on / off envelope: silent until the starter has done its work, dead when wrecked.
    let power = alive ? Math.min(1, Math.max(0, (now - this.startAt) / 0.12)) : 0;
    // A burning engine misfires.
    if (v.burning) power *= 0.45 + 0.55 * Math.abs(Math.sin(this.time * 23) * Math.sin(this.time * 7.1));
    const level = ENGINE_GAIN[v.spec.engineSound];

    if (g.low && g.high) {
      // Lumpy idle: the revs hunt a little when there is no load on the engine.
      const lump = 1 + (1 - Math.min(1, revs * 4)) * 0.018 * Math.sin(this.time * 9.3) * Math.sin(this.time * 2.1);
      const rpm = Math.max(300, this.gearbox.rpm * lump);
      g.low.playbackRate.setTargetAtTime(rpm / ENGINE_BASE_RPM[0], now, K);
      g.high.playbackRate.setTargetAtTime(rpm / ENGINE_BASE_RPM[1], now, K);
      const x = Math.min(1, Math.max(0, (revs - 0.22) / 0.4));
      const mix = x * x * (3 - 2 * x);
      g.lowGain.gain.setTargetAtTime(Math.cos(mix * Math.PI * 0.5), now, K);
      g.highGain.gain.setTargetAtTime(Math.sin(mix * Math.PI * 0.5), now, K);
      // On the throttle the note opens up; off it, it closes down and drops back.
      g.tone.frequency.setTargetAtTime(480 + 2500 * revs + 2900 * this.load, now, K);
      g.engine.gain.setTargetAtTime(power * level * (0.2 + 0.25 * revs + 0.3 * this.load), now, K);
      g.intakeBand.frequency.setTargetAtTime(320 + 1500 * revs, now, K);
      g.intake.gain.setTargetAtTime(power * (0.05 + 0.32 * this.load * (0.3 + 0.7 * revs)), now, K);
    } else if (g.hum && g.whine && g.whineGain) {
      const f = speed / Math.max(1, v.spec.topSpeed);
      g.hum.frequency.setTargetAtTime(50 + 70 * f, now, K);
      g.whine.frequency.setTargetAtTime(180 + 1500 * f, now, K);
      g.lowGain.gain.setTargetAtTime(0.5, now, K);
      g.tone.frequency.setTargetAtTime(400 + 1200 * f, now, K);
      g.whineGain.gain.setTargetAtTime(0.25 + 0.6 * this.load, now, K);
      g.engine.gain.setTargetAtTime(power * level * (0.15 + 0.5 * Math.min(1, f * 1.5) + 0.2 * this.load), now, K);
    }

    // Tyres.
    this.loose = damp(this.loose, looseness(surface), 6, dt);
    const rolling = grounded ? 1 : 0;
    const slide = rolling * Math.min(1, Math.max(0, (v.slip - 0.22) / 0.5)) * Math.min(1, speed / 7);
    const squeal = slide * (1 - Math.min(1, this.loose * 1.4));
    const wob = 1 + 0.05 * Math.sin(this.time * 31) + 0.03 * Math.sin(this.time * 12.7);
    g.skidA.frequency.setTargetAtTime((1150 + 380 * slide) * wob, now, K);
    g.skidB.frequency.setTargetAtTime((1620 + 520 * slide) * wob, now, K);
    // Two narrow bands of noise carry little energy, hence the big gain.
    g.skid.gain.setTargetAtTime(2.3 * Math.pow(squeal, 1.5), now, 0.05);

    const pace = Math.min(1, speed / 40);
    g.roadTone.frequency.setTargetAtTime(170 + 15 * speed, now, 0.1);
    g.road.gain.setTargetAtTime(rolling * 0.3 * Math.pow(pace, 1.4) * (1 + 0.4 * this.loose), now, 0.08);
    const bike = v.spec.cls === 'bike';
    g.windBand.frequency.setTargetAtTime(480 + 20 * speed, now, 0.1);
    g.wind.gain.setTargetAtTime((bike ? 0.5 : 0.22) * Math.pow(Math.min(1, speed / 45), 2), now, 0.1);
    g.gravelSrc.playbackRate.setTargetAtTime(0.6 + speed / 24, now, 0.08);
    g.gravel.gain.setTargetAtTime(rolling * this.loose * Math.min(1, speed / 12 + slide) * 0.4, now, 0.06);

    // Lift off hard at high revs and the big engines pop on the overrun.
    const kind = v.spec.engineSound;
    if (changed === 0 && (kind === 'v8' || kind === 'bike') && this.prevThrottle > 0.7 && throttle < 0.1 && revs > 0.55 && this.rng.chance(0.35)) {
      this.backfire(v, this.rng.range(0.08, 0.3));
    }
    this.prevThrottle = throttle;
  }

  /** Releases graphs whose fade-out has finished. Runs every frame, paused or not. */
  housekeep(): void {
    if (!this.dying.length) return;
    const now = this.mixer.now;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const g = this.dying[i];
      if (now < g.killAt) continue;
      for (const s of g.sources) {
        try {
          s.stop();
        } catch {
          // Never started or already stopped.
        }
        s.disconnect();
      }
      g.bus.disconnect();
      this.dying.splice(i, 1);
    }
  }
}
