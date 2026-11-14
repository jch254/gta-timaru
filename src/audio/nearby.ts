/**
 * Looping, positional voices that follow other vehicles: sirens (at most three) and the whoosh of passing
 * traffic (at most three). Distance gain and pan are refreshed every frame; no Doppler.
 */
import type { Vehicle } from '../core/types';
import { biquadQ } from './dsp';
import { sirenHz } from './gearbox';
import type { Mixer } from './mixer';
import { attenuation, panFor, type Listener } from './spatial';

export const MAX_SIRENS = 3;
export const MAX_PASSERS = 3;
const SIREN_RANGE = 260;
const SIREN_REF = 22;
const PASS_RANGE = 70;
const PASS_REF = 6;

/**
 * Fills `out` with the nearest vehicles (closest first) that pass `want`, within `range` of the listener.
 * Unused entries are null. No allocation.
 */
export function pickNearest(
  vehicles: readonly Vehicle[],
  l: Listener,
  range: number,
  want: (v: Vehicle) => boolean,
  out: (Vehicle | null)[],
  dist: number[],
): void {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = null;
  for (let k = 0; k < vehicles.length; k++) {
    const v = vehicles[k];
    if (!want(v)) continue;
    const d = Math.hypot(v.position.x - l.x, v.position.z - l.z);
    if (d > range) continue;
    for (let i = 0; i < n; i++) {
      if (out[i] === null || d < dist[i]) {
        for (let j = n - 1; j > i; j--) {
          out[j] = out[j - 1];
          dist[j] = dist[j - 1];
        }
        out[i] = v;
        dist[i] = d;
        break;
      }
    }
  }
}

interface Voice {
  vehicle: Vehicle | null;
  clock: number;
  gain: GainNode;
  pan: StereoPannerNode;
  sources: AudioScheduledSourceNode[];
  osc: OscillatorNode;
  band: BiquadFilterNode;
}

const wantsSiren = (v: Vehicle) => v.siren && !v.destroyed;

abstract class Followers {
  protected voices: Voice[] = [];
  protected picked: (Vehicle | null)[];
  protected dist: number[];
  private idle = 0;

  constructor(
    protected mixer: Mixer,
    private max: number,
  ) {
    this.picked = new Array<Vehicle | null>(max).fill(null);
    this.dist = new Array<number>(max).fill(0);
  }

  protected abstract make(ac: AudioContext): Voice;
  protected abstract drive(voice: Voice, v: Vehicle, now: number, dt: number): void;

  /** Call after `pickNearest` has filled `picked`. */
  protected assign(dt: number): void {
    const ac = this.mixer.ac;
    if (!ac) return;
    const now = ac.currentTime;
    let any = false;
    // Release voices whose vehicle dropped out of the nearest set.
    for (const voice of this.voices) {
      if (!voice.vehicle) continue;
      let keep = false;
      for (let i = 0; i < this.max; i++) if (this.picked[i] === voice.vehicle) keep = true;
      if (!keep) {
        voice.vehicle = null;
        voice.gain.gain.setTargetAtTime(0, now, 0.08);
      }
    }
    // Give every picked vehicle a voice.
    for (let i = 0; i < this.max; i++) {
      const v = this.picked[i];
      if (!v) continue;
      any = true;
      let voice: Voice | null = null;
      for (const c of this.voices) if (c.vehicle === v) voice = c;
      if (!voice) {
        for (const c of this.voices) if (!c.vehicle && !voice) voice = c;
        if (!voice && this.voices.length < this.max) {
          voice = this.make(ac);
          this.voices.push(voice);
        }
        if (!voice) continue;
        voice.vehicle = v;
        voice.clock = 0;
      }
      voice.clock += dt;
      this.drive(voice, v, now, dt);
    }
    // Nothing to follow for a while: let the oscillators go.
    this.idle = any ? 0 : this.idle + dt;
    if (this.idle > 4 && this.voices.length) this.release();
  }

  release(): void {
    for (const voice of this.voices) {
      for (const s of voice.sources) {
        try {
          s.stop();
        } catch {
          // Already stopped.
        }
        s.disconnect();
      }
      voice.pan.disconnect();
      voice.gain.disconnect();
    }
    this.voices.length = 0;
    this.idle = 0;
  }
}

export class Sirens extends Followers {
  private send: GainNode | null = null;

  constructor(mixer: Mixer) {
    super(mixer, MAX_SIRENS);
  }

  update(dt: number, vehicles: readonly Vehicle[]): void {
    if (!this.mixer.ac) return;
    pickNearest(vehicles, this.mixer.listener, SIREN_RANGE, wantsSiren, this.picked, this.dist);
    this.assign(dt);
  }

  protected make(ac: AudioContext): Voice {
    if (!this.send) {
      this.send = ac.createGain();
      this.send.gain.value = 0.3;
      this.send.connect(this.mixer.reverb);
    }
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 700;
    // The horn speaker: everything through a broad mid-range band.
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 0.8;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const pan = ac.createStereoPanner();
    osc.connect(band);
    band.connect(gain);
    gain.connect(pan);
    pan.connect(this.mixer.world);
    gain.connect(this.send);
    osc.start();
    return { vehicle: null, clock: 0, gain, pan, sources: [osc], osc, band };
  }

  protected drive(voice: Voice, v: Vehicle, now: number): void {
    const l = this.mixer.listener;
    const d = Math.hypot(v.position.x - l.x, v.position.y - l.y, v.position.z - l.z);
    voice.osc.frequency.setTargetAtTime(sirenHz(voice.clock, v.id), now, 0.025);
    // Riding in the car with the siren on: take the edge off.
    const own = d < 4 ? 0.55 : 1;
    voice.gain.gain.setTargetAtTime(0.3 * own * attenuation(d, SIREN_REF, SIREN_RANGE), now, 0.08);
    voice.pan.pan.setTargetAtTime(panFor(l, v.position.x, v.position.z), now, 0.08);
  }
}

/** Road and engine noise of traffic going past. */
export class PassBy extends Followers {
  private skip: Vehicle | null = null;
  private want = (v: Vehicle): boolean => v !== this.skip && !v.destroyed && Math.abs(v.speed) > 3;

  constructor(mixer: Mixer) {
    super(mixer, MAX_PASSERS);
  }

  /** `own` is the player's vehicle (it has its own, much richer sound). */
  update(dt: number, vehicles: readonly Vehicle[], own: Vehicle | null): void {
    if (!this.mixer.ac) return;
    this.skip = own;
    pickNearest(vehicles, this.mixer.listener, PASS_RANGE, this.want, this.picked, this.dist);
    this.assign(dt);
  }

  protected make(ac: AudioContext): Voice {
    const noise = this.mixer.loop(this.mixer.noise('pink'));
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 600;
    band.Q.value = 0.7;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const drone = ac.createBiquadFilter();
    drone.type = 'lowpass';
    drone.frequency.value = 280;
    drone.Q.value = biquadQ('lowpass', 0.707);
    const droneGain = ac.createGain();
    droneGain.gain.value = 0.22;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const pan = ac.createStereoPanner();
    noise.connect(band);
    band.connect(gain);
    osc.connect(drone);
    drone.connect(droneGain);
    droneGain.connect(gain);
    gain.connect(pan);
    pan.connect(this.mixer.world);
    osc.start();
    return { vehicle: null, clock: 0, gain, pan, sources: [noise, osc], osc, band };
  }

  protected drive(voice: Voice, v: Vehicle, now: number): void {
    const l = this.mixer.listener;
    const speed = Math.abs(v.speed);
    const d = Math.hypot(v.position.x - l.x, v.position.y - l.y, v.position.z - l.z);
    const heavy = v.spec.cls === 'truck' || v.spec.cls === 'bus' ? 0.7 : v.spec.cls === 'bike' ? 1.6 : 1;
    voice.band.frequency.setTargetAtTime(380 + 22 * speed, now, 0.1);
    voice.osc.frequency.setTargetAtTime((42 + 2.4 * speed) * heavy, now, 0.1);
    // Fade in over the first quarter second so a newly assigned voice never pops.
    const fade = Math.min(1, voice.clock / 0.25);
    voice.gain.gain.setTargetAtTime(0.5 * fade * Math.min(1, speed / 14) * attenuation(d, PASS_REF, PASS_RANGE), now, 0.1);
    voice.pan.pan.setTargetAtTime(panFor(l, v.position.x, v.position.z), now, 0.08);
  }
}
