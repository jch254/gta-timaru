/**
 * The ambience bed: a handful of filtered-noise layers whose levels cross-fade with district, hour and weather,
 * plus wildlife and distant-traffic one-shots scattered around the listener.
 */
import { Rng } from '../core/rng';
import type { GameContext } from '../core/types';
import { ambienceMix, gust, surfEnvelope, type AmbienceInput } from './ambience-mix';
import { biquadQ } from './dsp';
import type { Mixer } from './mixer';
import { renderCrickets, renderRainLoop, type SoundId } from './sfx-render';

type Emit = (id: SoundId, x: number, y: number, z: number, volume: number) => void;

export const renderRain = (): Float32Array => renderRainLoop(new Rng(0x7a15));

interface Graph {
  sources: AudioBufferSourceNode[];
  city: GainNode;
  traffic: GainNode;
  windLow: GainNode;
  windLowBand: BiquadFilterNode;
  windHigh: GainNode;
  windHighBand: BiquadFilterNode;
  wires: GainNode;
  wireA: BiquadFilterNode;
  wireB: BiquadFilterNode;
  rainHiss: GainNode;
  rainTop: BiquadFilterNode;
  rainPatter: GainNode;
  roof: GainNode;
  surf: GainNode;
  surfTone: BiquadFilterNode;
  crickets: GainNode;
}

const BED_KEYS = ['city', 'traffic', 'windLow', 'windHigh', 'wires', 'rainHiss', 'rainPatter', 'roof', 'surf', 'crickets'] as const;
const RATE_KEYS = ['bellbirds', 'chirps', 'magpies', 'gulls', 'sheep', 'moreporks', 'carPass'] as const;

/** Sound and distance band (metres) for each wildlife / traffic emitter. */
const EMITTERS: Record<(typeof RATE_KEYS)[number], { id: SoundId; near: number; far: number; up: number }> = {
  bellbirds: { id: 'bellbird', near: 8, far: 45, up: 6 },
  chirps: { id: 'chirp', near: 4, far: 25, up: 4 },
  magpies: { id: 'magpie', near: 12, far: 70, up: 8 },
  gulls: { id: 'gull', near: 15, far: 90, up: 14 },
  sheep: { id: 'sheep', near: 25, far: 110, up: 0 },
  moreporks: { id: 'morepork', near: 30, far: 110, up: 8 },
  carPass: { id: 'carPass', near: 45, far: 110, up: 0 },
};

export class Ambience {
  /** 0..1 nearness to the sea, refreshed twice a second. */
  coast = 0;
  private graph: Graph | null = null;
  private input: AmbienceInput = { district: 'rural', hour: 12, night: 0, rain: 0, wind: 0, weather: 'clear', coast: 0, inVehicle: false, speed: 0 };
  private target = ambienceMix(this.input);
  private mix = ambienceMix(this.input);
  private rng = new Rng(0xa3b1e9ce);
  private time = 0;
  private slow = 0;
  private fast = 0;
  private surfPhase = 0;
  private surfPeriod = 9;
  private tramStops: { x: number; z: number }[] | null = null;
  private tramTimer = 20;

  constructor(
    private mixer: Mixer,
    private ctx: GameContext,
    private emit: Emit,
  ) {
    for (const k of BED_KEYS) this.mix[k] = 0;
  }

  private build(ac: AudioContext): Graph {
    const m = this.mixer;
    const bus = ac.createGain();
    bus.connect(m.world);
    const gain = (v = 0, dest: AudioNode = bus) => {
      const g = ac.createGain();
      g.gain.value = v;
      g.connect(dest);
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q: number, dest: AudioNode) => {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = biquadQ(type, q);
      b.connect(dest);
      return b;
    };
    const white = m.loop(m.noise('white'));
    const pink = m.loop(m.noise('pink'));
    const brown = m.loop(m.noise('brown'));
    const cricketSrc = m.loop(m.buffer('loop:crickets', renderCrickets));
    const rainSrc = m.loop(m.buffer('loop:rain', renderRain));

    const city = gain();
    brown.connect(filter('lowpass', 260, 0.6, city));
    const traffic = gain();
    pink.connect(filter('bandpass', 520, 0.5, traffic));
    const windLow = gain();
    const windLowBand = filter('bandpass', 400, 0.7, windLow);
    pink.connect(windLowBand);
    const windHigh = gain();
    const windHighBand = filter('bandpass', 2400, 0.6, windHigh);
    white.connect(windHighBand);
    // Wind in the wires: two very narrow bands of noise make a faint, wavering whistle.
    const wires = gain();
    const wireMake = gain(4, wires);
    const wireA = filter('bandpass', 520, 35, wireMake);
    const wireB = filter('bandpass', 780, 40, wireMake);
    white.connect(wireA);
    white.connect(wireB);
    const rainHiss = gain();
    const rainTop = filter('lowpass', 9000, 0.5, rainHiss);
    white.connect(filter('highpass', 2200, 0.5, rainTop));
    const rainPatter = gain();
    rainSrc.connect(rainPatter);
    const roof = gain();
    white.connect(filter('bandpass', 400, 0.7, gain(3, roof)));
    const surf = gain();
    const surfTone = filter('lowpass', 900, 0.5, surf);
    pink.connect(surfTone);
    const crickets = gain();
    cricketSrc.connect(crickets);

    return { sources: [white, pink, brown, cricketSrc, rainSrc], city, traffic, windLow, windLowBand, windHigh, windHighBand, wires, wireA, wireB, rainHiss, rainTop, rainPatter, roof, surf, surfTone, crickets };
  }

  /** Sea or harbour (water lying at sea level), as opposed to a river channel. */
  private isSea(x: number, z: number): boolean {
    const w = this.ctx.world;
    const depth = w.waterDepthAt(x, z);
    return depth > 0.3 && Math.abs(w.heightAt(x, z) + depth - w.seaLevel) < 0.25;
  }

  private probeCoast(x: number, z: number): number {
    let nearest = Infinity;
    if (this.isSea(x, z)) nearest = 0;
    // The open coast is always to the east; the harbour cuts in from it, so look north and south as well.
    for (const d of [25, 60, 110, 170, 240]) {
      if (d >= nearest) break;
      if (this.isSea(x + d, z) || (d <= 170 && (this.isSea(x, z + d) || this.isSea(x, z - d)))) nearest = d;
    }
    if (nearest === Infinity) return 0;
    const t = Math.min(1, nearest / 240);
    return 1 - t * t * (3 - 2 * t);
  }

  update(dt: number): void {
    const ac = this.mixer.ac;
    if (!ac) return;
    const g = this.graph ?? (this.graph = this.build(ac));
    const { ctx } = this;
    const p = ctx.player.position;
    this.time += dt;

    // Where are we? District and coast lookups are throttled.
    this.slow -= dt;
    if (this.slow <= 0) {
      this.slow = 0.5;
      this.input.district = ctx.world.districtAt(p.x, p.z).type;
      this.coast = this.probeCoast(p.x, p.z);
    }
    const i = this.input;
    i.hour = ctx.clock.hour;
    i.night = ctx.env.night;
    i.rain = ctx.env.rain;
    i.wind = Math.hypot(ctx.env.wind.x, ctx.env.wind.z);
    i.weather = ctx.env.weather;
    i.coast = this.coast;
    i.inVehicle = ctx.player.vehicle !== null;
    i.speed = ctx.player.vehicle ? Math.abs(ctx.player.vehicle.speed) : 0;
    ambienceMix(i, this.target);

    // Cross-fade the beds over a couple of seconds; wildlife rates follow at once.
    const k = 1 - Math.exp(-0.7 * dt);
    for (const key of BED_KEYS) this.mix[key] += (this.target[key] - this.mix[key]) * k;

    this.surfPhase += dt / this.surfPeriod;
    if (this.surfPhase >= 1) {
      this.surfPhase -= 1;
      this.surfPeriod = this.rng.range(7, 11.5);
    }

    // Parameters only need refreshing ten times a second.
    this.fast -= dt;
    if (this.fast <= 0) {
      this.fast = 0.1;
      this.apply(g, ac.currentTime);
    }

    this.wildlife(dt, p.x, p.y, p.z);
  }

  private apply(g: Graph, now: number): void {
    const m = this.mix;
    const T = 0.15;
    const gusting = gust(this.time);
    // Distant traffic comes and goes in slow swells.
    const swell = 0.65 + 0.35 * Math.sin(this.time * 0.23) * Math.sin(this.time * 0.071 + 1);
    g.city.gain.setTargetAtTime(m.city, now, T);
    g.traffic.gain.setTargetAtTime(m.traffic * swell, now, T);
    g.windLow.gain.setTargetAtTime(m.windLow * gusting, now, T);
    g.windLowBand.frequency.setTargetAtTime(300 + 260 * gusting, now, T);
    g.windHigh.gain.setTargetAtTime(m.windHigh * gusting * gusting, now, T);
    g.windHighBand.frequency.setTargetAtTime(1700 + 900 * gusting, now, T);
    g.wires.gain.setTargetAtTime(m.wires * Math.max(0, gusting - 0.5), now, T);
    g.wireA.frequency.setTargetAtTime(430 + 110 * gusting, now, 0.4);
    g.wireB.frequency.setTargetAtTime(640 + 170 * gusting, now, 0.4);
    g.rainHiss.gain.setTargetAtTime(m.rainHiss, now, T);
    g.rainTop.frequency.setTargetAtTime(this.input.inVehicle ? 3800 : 9000, now, 0.3);
    g.rainPatter.gain.setTargetAtTime(m.rainPatter, now, T);
    g.roof.gain.setTargetAtTime(m.roof, now, T);
    const wave = surfEnvelope(this.surfPhase);
    g.surf.gain.setTargetAtTime(m.surf * wave, now, T);
    g.surfTone.frequency.setTargetAtTime(450 + 2600 * wave, now, T);
    g.crickets.gain.setTargetAtTime(m.crickets, now, T);
  }

  private wildlife(dt: number, x: number, y: number, z: number): void {
    const r = this.rng;
    for (const key of RATE_KEYS) {
      const rate = this.target[key];
      if (rate <= 0 || r.next() >= rate * dt) continue;
      const e = EMITTERS[key];
      const a = r.next() * Math.PI * 2;
      const d = r.range(e.near, e.far);
      // Gulls keep to the seaward (eastern) side.
      const ex = key === 'gulls' ? x + Math.abs(Math.sin(a)) * d : x + Math.sin(a) * d;
      this.emit(e.id, ex, y + e.up, z + Math.cos(a) * d, r.range(0.6, 1));
    }
    // The heritage tram rings its bell around the central loop by day.
    this.tramTimer -= dt;
    if (this.tramTimer <= 0) {
      this.tramTimer = r.range(22, 55);
      if (this.input.night > 0.5) return;
      const stops = this.tramStops ?? (this.tramStops = this.ctx.world.landmarks.filter((l) => l.kind === 'tram-stop').map((l) => ({ x: l.x, z: l.z })));
      for (const s of stops) {
        if (Math.hypot(s.x - x, s.z - z) < 130) {
          this.emit('tramBell', s.x + r.range(-25, 25), y + 1, s.z + r.range(-25, 25), 0.8);
          break;
        }
      }
    }
  }
}
