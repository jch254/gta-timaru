/**
 * The audio graph: buses, limiter, reverb, the pool of one-shot voices and the buffer cache.
 *
 *   one-shot strips ┐
 *   vehicle / sirens ├→ world → muffle filter → diegetic (pause duck) ┐
 *   ambience        ┘                                                 ├→ sfx (settings) ┐
 *   interface sounds → ui ─────────────────────────────────────────────┘                 ├→ sum → compressor → soft clip → master → out
 *   radio → music duck → music (settings) ──────────────────────────────────────────────┘
 *
 * Nothing here runs until `unlock()` has created the AudioContext; every method is a no-op before that.
 *
 * Sample rates: sounds are synthesised at a fixed rate (dsp.SR) so they are identical on every machine, then
 * converted to the AudioContext's own rate when the AudioBuffer is made. Every AudioBuffer is created at
 * `ac.sampleRate` (44.1 kHz on some machines, 48 kHz on others), which a ConvolverNode insists on.
 */
import { Rng } from '../core/rng';
import { Bank } from './bank';
import { SR, biquadQ, renderImpulse, renderNoise, resample, softClipCurve, type NoiseColor } from './dsp';
import { allocateVoice, type Listener, type VoiceSlot } from './spatial';

/** Simultaneous one-shot voices. */
export const VOICE_COUNT = 24;
/** Plucked-string buffers kept in memory (about 0.2 MB each at 48 kHz). */
export const MAX_PLUCKS = 64;

/** Mix constants gathered in one place for tuning by ear. */
export const MIX = {
  /** Headroom into the master compressor. */
  sum: 0.9,
  compressor: { threshold: -10, knee: 8, ratio: 6, attack: 0.004, release: 0.22 },
  /** Undoes the compressor's built-in make-up gain (≈ +3.2 dB for the settings above). */
  makeup: 0.69,
  reverbReturn: 0.7,
  /** Music level while the game is paused. */
  pausedMusic: 0.3,
};

interface Strip extends VoiceSlot {
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  send: GainNode;
  src: AudioBufferSourceNode | null;
}

export interface VoiceOptions {
  id: string;
  gain: number;
  rate: number;
  pan: number;
  cutoff: number;
  reverb: number;
  delay: number;
  priority: number;
  limit: number;
}

/** The looping noise beds every continuous layer is filtered from. */
export function renderNoiseBed(color: NoiseColor): Float32Array {
  return renderNoise(color, color === 'white' ? 2 : 5, new Rng(color.length * 7919 + color.charCodeAt(0)));
}

function disconnectSelf(this: AudioNode): void {
  this.disconnect();
}

/** Slider position (0..1) to gain: a gentle audio taper. */
export function taper(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.pow(c, 1.5);
}

export class Mixer {
  ac: AudioContext | null = null;
  readonly listener: Listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  /** Input for diegetic sound (already spatialised by the caller). */
  world!: GainNode;
  /** Input for interface sounds. */
  ui!: GainNode;
  /** Input for the radio. */
  music!: GainNode;
  /** Reverb send input for diegetic sound. */
  reverb!: GainNode;
  /** Number of one-shots dropped because every voice was busy with something more important. */
  dropped = 0;
  /** Sounds rendered ahead of time, waiting to become AudioBuffers. */
  readonly bank = new Bank();

  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private diegetic!: GainNode;
  private muffle!: BiquadFilterNode;
  private strips: Strip[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private plucks: string[] = [];
  private paused = false;
  private wantRunning = false;
  /** Set if WebAudio could not be started: everything stays a no-op. */
  private failed = false;
  private rng = new Rng(0x90551995);

  /**
   * Creates the context (first call) and resumes it. Safe to call repeatedly and never throws: if WebAudio is
   * missing or the graph cannot be built the mixer simply stays silent.
   */
  unlock(master: number, music: number, sfx: number): boolean {
    if (this.failed) return false;
    this.wantRunning = true;
    if (this.ac) {
      this.resume();
      return false;
    }
    let ac: AudioContext | null = null;
    try {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return false;
      }
      ac = new Ctor({ latencyHint: 'interactive' });
      this.ac = ac;
      this.build(ac, master, music, sfx);
    } catch (err) {
      console.warn('audio: could not start WebAudio, continuing in silence', err);
      this.failed = true;
      this.ac = null;
      this.strips.length = 0;
      this.buffers.clear();
      if (ac) void ac.close().catch(() => undefined);
      return false;
    }
    this.resume();
    // Some browsers only start audio inside a gesture handler: keep trying until it runs.
    window.addEventListener('pointerdown', this.resume);
    window.addEventListener('keydown', this.resume);
    document.addEventListener('visibilitychange', this.onVisibility);
    return true;
  }

  private build(ac: AudioContext, master: number, music: number, sfx: number): void {
    const gain = (v: number) => {
      const g = ac.createGain();
      g.gain.value = v;
      return g;
    };
    this.master = gain(taper(master));
    this.master.connect(ac.destination);
    const clip = ac.createWaveShaper();
    clip.curve = softClipCurve();
    clip.connect(this.master);
    const pre = gain(0.5 * MIX.makeup);
    pre.connect(clip);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = MIX.compressor.threshold;
    comp.knee.value = MIX.compressor.knee;
    comp.ratio.value = MIX.compressor.ratio;
    comp.attack.value = MIX.compressor.attack;
    comp.release.value = MIX.compressor.release;
    comp.connect(pre);
    const sum = gain(MIX.sum);
    sum.connect(comp);

    this.sfxBus = gain(taper(sfx));
    this.sfxBus.connect(sum);
    this.musicBus = gain(taper(music));
    this.musicBus.connect(sum);
    this.music = gain(1);
    this.music.connect(this.musicBus);

    this.diegetic = gain(1);
    this.diegetic.connect(this.sfxBus);
    this.muffle = ac.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = biquadQ('lowpass', 0.707);
    this.muffle.connect(this.diegetic);
    this.world = gain(1);
    this.world.connect(this.muffle);
    this.ui = gain(1);
    this.ui.connect(this.sfxBus);

    this.reverb = gain(1);
    const conv = ac.createConvolver();
    conv.buffer = this.impulse(1.7, 0.45);
    const ret = gain(MIX.reverbReturn);
    this.reverb.connect(conv);
    conv.connect(ret);
    ret.connect(this.world);

    for (let i = 0; i < VOICE_COUNT; i++) {
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = biquadQ('lowpass', 0.707);
      const g = gain(0);
      const pan = ac.createStereoPanner();
      const send = gain(0);
      filter.connect(g);
      g.connect(pan);
      pan.connect(this.world);
      g.connect(send);
      send.connect(this.reverb);
      this.strips.push({ filter, gain: g, pan, send, src: null, until: 0, priority: 0, level: 0, id: '', started: 0 });
    }
  }

  private resume = (): void => {
    const ac = this.ac;
    if (!ac || !this.wantRunning) return;
    if (ac.state === 'running') {
      window.removeEventListener('pointerdown', this.resume);
      window.removeEventListener('keydown', this.resume);
      return;
    }
    if (document.visibilityState !== 'hidden') void ac.resume().catch(() => undefined);
  };

  /** A hidden tab throttles timers and stops the game loop: freeze the audio clock with it. */
  private onVisibility = (): void => {
    const ac = this.ac;
    if (!ac || !this.wantRunning) return;
    if (document.visibilityState === 'hidden') void ac.suspend().catch(() => undefined);
    else void ac.resume().catch(() => undefined);
  };

  get now(): number {
    return this.ac ? this.ac.currentTime : 0;
  }

  get running(): boolean {
    return this.ac !== null && this.ac.state === 'running';
  }

  setVolumes(master: number, music: number, sfx: number): void {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    this.master.gain.setTargetAtTime(taper(master), t, 0.03);
    this.musicBus.gain.setTargetAtTime(taper(music), t, 0.03);
    this.sfxBus.gain.setTargetAtTime(taper(sfx), t, 0.03);
  }

  /** Paused: the world falls silent, the radio drops back, interface sounds stay. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    this.diegetic.gain.cancelScheduledValues(t);
    this.diegetic.gain.setTargetAtTime(paused ? 0 : 1, t, 0.04);
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(paused ? MIX.pausedMusic : 1, t, 0.08);
  }

  /** Smothers the world (the player is down). */
  setMuffled(muffled: boolean): void {
    const ac = this.ac;
    if (!ac) return;
    this.muffle.frequency.setTargetAtTime(muffled ? 380 : 20000, ac.currentTime, muffled ? 0.5 : 0.12);
  }

  /** Briefly pulls the radio down under a stinger. */
  duckMusic(level: number, seconds: number): void {
    const ac = this.ac;
    if (!ac || this.paused) return;
    const t = ac.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(level, t, 0.05);
    this.music.gain.setTargetAtTime(1, t + seconds, 0.4);
  }

  // ───────────── buffers ─────────────

  /**
   * Wraps rendered samples in a cached AudioBuffer at the context's sample rate. `render` produces samples at
   * `sr` and only runs if the bank has not got to it yet. Looping material (noise beds, engine and texture
   * loops) is converted as a circle so the seam stays clean.
   */
  buffer(key: string, render: () => Float32Array, sr = SR): AudioBuffer {
    let b = this.buffers.get(key);
    if (!b) {
      const ac = this.ac!;
      const loop = key.startsWith('noise:') || key.startsWith('loop:') || key.startsWith('engine:');
      const data = resample(this.bank.take(key, render), sr, ac.sampleRate, loop);
      b = ac.createBuffer(1, data.length, ac.sampleRate);
      b.getChannelData(0).set(data);
      this.buffers.set(key, b);
      if (key.startsWith('pluck:')) {
        // Plucked notes are rendered per pitch on demand: keep only the most recently made ones.
        this.plucks.push(key);
        if (this.plucks.length > MAX_PLUCKS) this.buffers.delete(this.plucks.shift()!);
      }
    }
    return b;
  }

  noise(color: NoiseColor): AudioBuffer {
    return this.buffer(`noise:${color}`, () => renderNoiseBed(color));
  }

  /** Reverb impulse response, generated directly at the context's sample rate. */
  impulse(seconds: number, bright: number): AudioBuffer {
    const ac = this.ac!;
    const [l, r] = renderImpulse(seconds, this.rng, bright, 0.012, ac.sampleRate);
    const b = ac.createBuffer(2, l.length, ac.sampleRate);
    b.getChannelData(0).set(l);
    b.getChannelData(1).set(r);
    return b;
  }

  /**
   * A looping source, already started. By default it starts at a random point in the buffer (so two layers
   * cut from the same noise never line up); pass `offset` to start at a known point instead.
   */
  loop(buffer: AudioBuffer, rate = 1, offset = -1): AudioBufferSourceNode {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(ac.currentTime, offset >= 0 ? offset : this.rng.next() * buffer.duration);
    return src;
  }

  // ───────────── one-shots ─────────────

  /** Plays a buffer through a pooled, spatialised voice strip. Returns false if it was dropped. */
  playVoice(buffer: AudioBuffer, o: VoiceOptions): boolean {
    const ac = this.ac;
    if (!ac || o.gain <= 0.0005) return false;
    const now = ac.currentTime;
    const idx = allocateVoice(this.strips, now, o.id, o.priority, o.gain, o.limit);
    if (idx < 0) {
      this.dropped++;
      return false;
    }
    const s = this.strips[idx];
    let t = now + o.delay;
    if (s.until > now && s.src) {
      // Steal: pull the strip down fast, then reuse it.
      s.gain.gain.cancelScheduledValues(now);
      s.gain.gain.setTargetAtTime(0, now, 0.004);
      s.filter.frequency.cancelScheduledValues(now);
      s.pan.pan.cancelScheduledValues(now);
      s.send.gain.cancelScheduledValues(now);
      try {
        s.src.stop(now + 0.02);
      } catch {
        // Already stopped.
      }
      t = Math.max(t, now + 0.022);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate;
    src.onended = disconnectSelf;
    src.connect(s.filter);
    s.filter.frequency.setValueAtTime(Math.min(20000, o.cutoff), t);
    s.gain.gain.setValueAtTime(o.gain, t);
    s.pan.pan.setValueAtTime(o.pan, t);
    s.send.gain.setValueAtTime(o.reverb, t);
    src.start(t);
    s.src = src;
    s.until = t + buffer.duration / o.rate + 0.03;
    s.priority = o.priority;
    s.level = o.gain;
    s.id = o.id;
    s.started = now;
    return true;
  }

  /** Plays a buffer straight into a bus (interface sounds, radio static). */
  playTo(dest: AudioNode, buffer: AudioBuffer, gain: number, rate = 1, delay = 0): void {
    const ac = this.ac;
    if (!ac) return;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(dest);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start(ac.currentTime + delay);
  }

  /** How many one-shot voices are sounding right now. */
  activeVoices(): number {
    const now = this.now;
    let n = 0;
    for (const s of this.strips) if (s.until > now) n++;
    return n;
  }

  dispose(): void {
    this.wantRunning = false;
    window.removeEventListener('pointerdown', this.resume);
    window.removeEventListener('keydown', this.resume);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const ac = this.ac;
    this.ac = null;
    if (ac) void ac.close().catch(() => undefined);
  }
}
