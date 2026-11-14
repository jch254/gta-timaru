/**
 * Turns a Kit (data) into a little mixing desk of WebAudio nodes and plays note events on it.
 * One Band exists per tuned station; it is torn down when the dial moves.
 *
 *   notes → strip (drive → filters → pump → level → pan) ─┬→ station bus → broadcast chain → out
 *                                                         ├→ reverb send (shared convolver)
 *                                                         └→ delay send → tempo-synced feedback delay ┘
 */
import { Rng } from '../../core/rng';
import { biquadQ, driveCurve, renderPluck } from '../dsp';
import type { Mixer } from '../mixer';
import { renderDrum } from './drums';
import { VOWELS, type Inst, type Kit, type Patch, type WaveName } from './kit';
import type { Ev } from './song';
import { midiHz } from './theory';

interface Strip {
  input: GainNode;
  level: GainNode;
  pump: GainNode | null;
  pumpDepth: number;
  del: GainNode;
  delBase: number;
}

interface Voice {
  osc: OscillatorNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  env: GainNode;
}

const PLUCK_SR = 22050;

/**
 * The station's bus compressor and levels. The strips sum to peaks around 0.9; `trim` brings that down so the
 * compressor works a few dB rather than flattening everything, and `output` (after the compressor's built-in
 * make-up gain) leaves a station peaking a little under half scale. Tune by ear here.
 */
export const BROADCAST = { trim: 0.55, threshold: -14, knee: 12, ratio: 3, output: 0.85 };

/** Harmonic recipes for the custom oscillator shapes. */
const WAVES: Record<Exclude<WaveName, OscillatorType>, number[]> = {
  organ: [1, 0.75, 0.5, 0.25, 0, 0.2, 0, 0.12],
  soft: [1, 0.35, 0.12, 0.05],
  reed: [1, 0, 0.5, 0, 0.3, 0, 0.18, 0, 0.1],
  bright: Array.from({ length: 20 }, (_, i) => 1 / Math.pow(i + 1, 0.9)),
  pulse: Array.from({ length: 24 }, (_, i) => Math.sin(Math.PI * (i + 1) * 0.22) / (i + 1)),
};

export class Band {
  /** Everything the band plays leaves through here. */
  readonly out: GainNode;
  /** Slow pitch drift in cents for worn-out tape (lo-fi stations); set by the radio each tick. */
  wobble = 0;
  private ac: AudioContext;
  private bus: GainNode;
  private strips = new Map<string, Strip>();
  private delay: DelayNode;
  private revSend: GainNode;
  private waves = new Map<string, PeriodicWave>();
  private voices = new Map<string, Voice>();
  private lastHz = new Map<string, number>();
  private chokes = new Map<string, GainNode>();
  private persistent: AudioScheduledSourceNode[] = [];
  private rng = new Rng(0xba9d);
  private stepDur = 0.125;

  constructor(
    private mixer: Mixer,
    private kit: Kit,
    dest: AudioNode,
    reverb: AudioNode,
  ) {
    const ac = (this.ac = mixer.ac!);
    const gain = (v: number): GainNode => {
      const g = ac.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode => {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = biquadQ(type, q);
      return b;
    };

    // Broadcast chain: a firm compressor (it is radio, after all), then the transmitter's tone.
    this.bus = gain(BROADCAST.trim);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = BROADCAST.threshold;
    comp.knee.value = BROADCAST.knee;
    comp.ratio.value = BROADCAST.ratio;
    comp.attack.value = 0.008;
    comp.release.value = 0.18;
    this.bus.connect(comp);
    let tail: AudioNode = comp;
    const chain = (n: AudioNode): void => {
      tail.connect(n);
      tail = n;
    };
    if (kit.tone === 'am') {
      chain(filter('highpass', 180));
      chain(filter('lowpass', 4200, 0.8));
      const presence = filter('peaking', 1800, 1);
      presence.gain.value = 3;
      chain(presence);
    } else if (kit.tone === 'tape') {
      chain(filter('highpass', 110));
      chain(filter('lowpass', 6000, 0.6));
      const warm = ac.createWaveShaper();
      warm.curve = driveCurve(1.6);
      chain(warm);
    } else {
      chain(filter('highpass', 45));
    }
    this.out = gain(0);
    chain(this.out);
    this.out.connect(dest);
    this.out.gain.setTargetAtTime(kit.level * BROADCAST.output, ac.currentTime, 0.05);
    if (kit.tone !== 'fm') {
      // A bed of transmitter hiss.
      const hiss = mixer.loop(mixer.noise('pink'));
      const hissGain = gain(kit.tone === 'am' ? 0.035 : 0.025);
      hiss.connect(hissGain);
      hissGain.connect(this.bus);
      this.persistent.push(hiss);
    }

    this.revSend = gain(kit.reverb);
    this.revSend.connect(reverb);

    // Feedback delay with a darkening, thinning loop so repeats fall away behind the band.
    this.delay = ac.createDelay(2);
    this.delay.delayTime.value = kit.delay.steps * this.stepDur;
    const loopLp = filter('lowpass', kit.delay.lp, 0.6);
    const loopHp = filter('highpass', 280, 0.6);
    const feedback = gain(kit.delay.feedback);
    this.delay.connect(loopLp);
    loopLp.connect(loopHp);
    loopHp.connect(feedback);
    feedback.connect(this.delay);
    const delayOut = gain(0.8);
    loopHp.connect(delayOut);
    delayOut.connect(this.bus);
    delayOut.connect(this.revSend);

    for (const [name, s] of Object.entries(kit.strips)) {
      const input = gain(1);
      let node: AudioNode = input;
      const next = (n: AudioNode): void => {
        node.connect(n);
        node = n;
      };
      if (s.drive) {
        const shaper = ac.createWaveShaper();
        shaper.curve = driveCurve(s.drive);
        shaper.oversample = '2x';
        next(shaper);
      }
      if (s.lp) next(filter('lowpass', s.lp, 0.7));
      if (s.hp) next(filter('highpass', s.hp, 0.7));
      let pump: GainNode | null = null;
      if (s.pump) {
        pump = gain(1);
        next(pump);
      }
      const level = gain(s.gain);
      next(level);
      if (s.pan) {
        const pan = ac.createStereoPanner();
        pan.pan.value = s.pan;
        level.connect(pan);
        pan.connect(this.bus);
      } else {
        level.connect(this.bus);
      }
      if (s.rev) {
        const rev = gain(s.rev);
        level.connect(rev);
        rev.connect(this.revSend);
      }
      const del = gain(s.del ?? 0);
      level.connect(del);
      del.connect(this.delay);
      this.strips.set(name, { input, level, pump, pumpDepth: s.pump ?? 0, del, delBase: s.del ?? 0 });
    }
  }

  /** Call when the tempo changes (new track): retunes the delay to the beat. */
  setTempo(stepDur: number): void {
    this.stepDur = stepDur;
    this.delay.delayTime.setTargetAtTime(Math.min(1.9, this.kit.delay.steps * stepDur), this.ac.currentTime, 0.05);
  }

  /** Plays one event at audio-clock time `t`. Unknown channels are ignored. */
  play(ev: Ev, t: number): void {
    const dur = ev.d * this.stepDur;
    if (ev.ch === 'throw') {
      // Dub move: open a strip's delay send for a moment so that hit goes spinning off into the echo.
      const s = this.strips.get(String(ev.a));
      if (s) {
        s.del.gain.setValueAtTime(0.9, t - 0.01 > 0 ? t - 0.01 : 0);
        s.del.gain.setValueAtTime(s.delBase, t + dur);
      }
      return;
    }
    const inst = this.kit.insts[ev.ch];
    if (!inst) return;
    const strip = this.strips.get(inst.bus);
    if (!strip) return;
    switch (inst.type) {
      case 'drum':
        this.drum(inst, strip, ev, t);
        break;
      case 'synth':
        this.synth(inst, strip, ev, t, dur);
        break;
      case 'pluck':
        this.pluck(inst, strip, ev, t, dur);
        break;
      case 'voice':
        this.voice(inst, strip, ev, t, dur);
        break;
      case 'riser':
        this.riser(inst, strip, ev, t, dur);
        break;
    }
  }

  private drum(inst: Extract<Inst, { type: 'drum' }>, strip: Strip, ev: Ev, t: number): void {
    const ac = this.ac;
    const id = inst.drum;
    const buffer = this.mixer.buffer(`drum:${id}`, () => renderDrum(id));
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (inst.rate ?? 1) * (1 + (this.rng.next() - 0.5) * 0.02);
    const g = ac.createGain();
    g.gain.value = inst.gain * ev.v * (0.92 + 0.16 * this.rng.next());
    src.connect(g);
    g.connect(strip.input);
    src.onended = () => g.disconnect();
    src.start(t);
    if (inst.choke) {
      // A closed hi-hat cuts off the open one.
      const prev = this.chokes.get(inst.choke);
      if (prev) prev.gain.setTargetAtTime(0, t, 0.008);
      this.chokes.set(inst.choke, g);
    }
    if (inst.pump) {
      // Side-chain: everything marked to pump ducks under the kick and swells back.
      const release = Math.min(0.32, this.stepDur * 3.2);
      for (const s of this.strips.values()) {
        if (!s.pump) continue;
        s.pump.gain.setValueAtTime(1 - s.pumpDepth, t);
        s.pump.gain.linearRampToValueAtTime(1, t + release);
      }
    }
  }

  private wave(osc: OscillatorNode, name: WaveName): void {
    if (name === 'sine' || name === 'square' || name === 'sawtooth' || name === 'triangle') {
      osc.type = name;
      return;
    }
    if (name === 'custom') return;
    let w = this.waves.get(name);
    if (!w) {
      const h = WAVES[name];
      const real = new Float32Array(h.length + 1);
      const imag = new Float32Array(h.length + 1);
      for (let i = 0; i < h.length; i++) imag[i + 1] = h[i];
      w = this.ac.createPeriodicWave(real, imag);
      this.waves.set(name, w);
    }
    osc.setPeriodicWave(w);
  }

  private synth(inst: Extract<Inst, { type: 'synth' }>, strip: Strip, ev: Ev, t: number, dur: number): void {
    const ac = this.ac;
    const p: Patch = inst.patch;
    const notes = ev.ns ?? (ev.n !== undefined ? [ev.n] : []);
    if (!notes.length) return;
    const oct = (inst.oct ?? 0) * 12;
    const detunes = p.unison ? [0, ...p.unison] : [0];
    const count = notes.length * detunes.length;
    // Detuned copies of one note add almost in phase, so scale by a bit more than the square root.
    const peak = (inst.gain * ev.v) / (Math.pow(count, 0.7) * (1 + (p.sub ? p.sub[2] : 0)));
    const off = Math.max(t + dur, t + p.a + 0.01);
    const end = off + p.r * 5 + 0.03;

    const amp = ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + p.a);
    amp.gain.setTargetAtTime(peak * p.s, t + p.a, p.d);
    amp.gain.setTargetAtTime(0, off, p.r);
    amp.connect(strip.input);
    let dest: AudioNode = amp;
    if (p.cutoff !== undefined) {
      const f0 = midiHz(notes[0] + oct);
      const base = Math.min(16000, p.cutoff + (p.track ?? 0) * f0);
      const filt = ac.createBiquadFilter();
      filt.type = p.ftype ?? 'lowpass';
      filt.Q.value = biquadQ(filt.type, p.q ?? 0.707);
      if (p.envAmt) {
        filt.frequency.setValueAtTime(Math.min(18000, base + p.envAmt * (0.4 + 0.6 * ev.v)), t);
        filt.frequency.setTargetAtTime(base, t + p.a, p.envDecay ?? 0.1);
      } else {
        filt.frequency.setValueAtTime(base, t);
      }
      filt.connect(amp);
      dest = filt;
    }

    let lfoGain: GainNode | null = null;
    if (p.vib) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = p.vib[0];
      lfoGain = ac.createGain();
      lfoGain.gain.setValueAtTime(0, t);
      lfoGain.gain.setTargetAtTime(p.vib[1], t + p.vib[2], 0.12);
      lfo.connect(lfoGain);
      lfo.start(t);
      lfo.stop(end);
    }

    const glideFrom = p.glide && notes.length === 1 ? this.lastHz.get(ev.ch) : undefined;
    let last: OscillatorNode | null = null;
    for (const m of notes) {
      const f = midiHz(m + oct);
      for (const cents of detunes) {
        const o = ac.createOscillator();
        this.wave(o, p.wave);
        if (glideFrom && p.glide) {
          o.frequency.setValueAtTime(glideFrom, t);
          o.frequency.exponentialRampToValueAtTime(f, t + p.glide);
        } else {
          o.frequency.setValueAtTime(f, t);
        }
        o.detune.value = cents + this.wobble;
        if (lfoGain) lfoGain.connect(o.detune);
        if (p.fm) {
          const mod = ac.createOscillator();
          mod.frequency.setValueAtTime(f * p.fm[0], t);
          const depth = ac.createGain();
          const index = p.fm[1] * f * (0.5 + 0.5 * ev.v);
          depth.gain.setValueAtTime(index, t);
          depth.gain.setTargetAtTime(index * p.fm[3], t, p.fm[2]);
          mod.connect(depth);
          depth.connect(o.frequency);
          mod.start(t);
          mod.stop(end);
        }
        o.connect(dest);
        o.start(t);
        o.stop(end);
        last = o;
      }
      if (p.sub) {
        const o = ac.createOscillator();
        o.type = p.sub[0];
        o.frequency.setValueAtTime(midiHz(m + oct + p.sub[1]), t);
        o.detune.value = this.wobble;
        const g = ac.createGain();
        g.gain.value = p.sub[2];
        o.connect(g);
        g.connect(dest);
        o.start(t);
        o.stop(end);
      }
    }
    if (notes.length === 1) this.lastHz.set(ev.ch, midiHz(notes[0] + oct));
    if (last) last.onended = () => amp.disconnect();
  }

  private pluck(inst: Extract<Inst, { type: 'pluck' }>, strip: Strip, ev: Ev, t: number, dur: number): void {
    const ac = this.ac;
    const notes = ev.ns ?? (ev.n !== undefined ? [ev.n] : []);
    const up = ev.a === 'up';
    const spread = inst.strum ?? 0;
    const n = notes.length;
    for (let k = 0; k < n; k++) {
      const midi = Math.round(notes[up ? n - 1 - k : k] + (inst.oct ?? 0) * 12);
      const buffer = this.mixer.buffer(`pluck:${inst.id}:${midi}`, () => renderPluck(midiHz(midi), inst.string, new Rng(midi * 7919 + 13), PLUCK_SR), PLUCK_SR);
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const rate = Math.pow(2, this.wobble / 1200);
      const at = t + k * spread * (0.8 + 0.4 * this.rng.next());
      if (ev.a === 'bend') {
        // Push up into the note from a tone below.
        src.playbackRate.setValueAtTime(rate * 0.891, at);
        src.playbackRate.linearRampToValueAtTime(rate, at + 0.09);
      } else {
        src.playbackRate.value = rate;
      }
      const g = ac.createGain();
      const vel = (inst.gain * ev.v * (0.85 + 0.3 * this.rng.next())) / Math.sqrt(Math.max(1, n * 0.6));
      g.gain.setValueAtTime(vel, at);
      // Palm-muted notes are choked almost at once; open ones ring until the note ends.
      if (inst.mute) g.gain.setTargetAtTime(0, at + 0.015, inst.mute);
      else g.gain.setTargetAtTime(0, at + dur, 0.06);
      src.connect(g);
      g.connect(strip.input);
      src.onended = () => g.disconnect();
      src.start(at);
      src.stop(at + (inst.mute ? 0.4 : dur + 0.4));
    }
  }

  /** One syllable from a wordless formant "voice": a buzz through two moving band-pass filters. */
  private voice(inst: Extract<Inst, { type: 'voice' }>, strip: Strip, ev: Ev, t: number, dur: number): void {
    const ac = this.ac;
    let v = this.voices.get(ev.ch);
    if (!v) {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      const env = ac.createGain();
      env.gain.value = 0;
      const band = (f: number, q: number, level: number): BiquadFilterNode => {
        const b = ac.createBiquadFilter();
        b.type = 'bandpass';
        b.frequency.value = f;
        b.Q.value = q;
        const g = ac.createGain();
        g.gain.value = level;
        osc.connect(b);
        b.connect(g);
        g.connect(env);
        return b;
      };
      const f1 = band(700, 6, 1);
      const f2 = band(1200, 8, 0.6);
      band(2600, 6, 0.22);
      env.connect(strip.input);
      osc.start();
      this.persistent.push(osc);
      v = { osc, f1, f2, env };
      this.voices.set(ev.ch, v);
    }
    const [a, b] = VOWELS[Math.abs(Math.round(Number(ev.a ?? 0))) % VOWELS.length];
    v.osc.frequency.setTargetAtTime(midiHz(ev.n ?? 45), t, 0.025);
    v.f1.frequency.setTargetAtTime(a, t, 0.018);
    v.f2.frequency.setTargetAtTime(b, t, 0.018);
    v.env.gain.setTargetAtTime(inst.gain * ev.v, t, 0.012);
    v.env.gain.setTargetAtTime(0, t + dur * 0.8, 0.028);
  }

  /** A rising band of noise: the sweep before a drop. */
  private riser(inst: Extract<Inst, { type: 'riser' }>, strip: Strip, ev: Ev, t: number, dur: number): void {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = this.mixer.noise('white');
    src.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.6;
    band.frequency.setValueAtTime(350, t);
    band.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(inst.gain * ev.v * 2, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.02);
    src.connect(band);
    band.connect(g);
    g.connect(strip.input);
    src.onended = () => g.disconnect();
    src.start(t);
    src.stop(t + dur + 0.15);
  }

  /** Fades the band out. Call `destroy` once the tails have had time to die. */
  silence(): void {
    const t = this.ac.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.03);
  }

  destroy(): void {
    for (const s of this.persistent) {
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
      s.disconnect();
    }
    this.persistent.length = 0;
    this.out.disconnect();
    this.revSend.disconnect();
    this.bus.disconnect();
    for (const s of this.strips.values()) s.level.disconnect();
    this.strips.clear();
    this.voices.clear();
    this.chokes.clear();
  }
}
