/**
 * The car radio. Every station "broadcasts" on its own timeline whether or not anyone is listening, so tuning
 * in drops you into the middle of whatever is on, and tuning back later finds it has moved along. Only the
 * tuned station makes sound: a look-ahead scheduler turns the next ~100 ms of its programme into WebAudio
 * events on a 25 ms timer.
 */
import { Rng } from '../../core/rng';
import { biquadQ } from '../dsp';
import type { Mixer } from '../mixer';
import { renderSound } from '../sfx';
import { Band } from './band';
import { STATIONS, nextStation, programItem, stationDef, type Item, type StationInfo } from './dial';
import type { Kit } from './kit';
import type { Ev } from './song';
import { Lookahead, STEPS_PER_BAR, TICK, firstStepAt, planTick, stepTime, type Timeline } from './timing';

interface Clock {
  /** Index of the programme item on air. */
  index: number;
  /** Audio-clock time that item started. */
  start: number;
}

export class Radio {
  readonly stations: StationInfo[] = STATIONS;
  /** Dial position, remembered from one vehicle to the next. null = switched off. */
  station: string | null = STATIONS[0].id;
  /** True while the player is sitting in something with a radio. */
  audible = false;

  private input: GainNode | null = null;
  private reverb: GainNode | null = null;
  private band: Band | null = null;
  private bandKit: Kit | null = null;
  private dying: { band: Band; at: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private look = new Lookahead();
  private clocks = new Map<string, Clock>();
  private item: Item | null = null;
  private tl: Timeline = { start: 0, stepDur: 0.125, shuffle: 0, swing: 0 };
  private nextStep = 0;
  private cacheBar = -1;
  private cache: Ev[][] = Array.from({ length: STEPS_PER_BAR }, () => []);
  private rng = new Rng((Math.random() * 0xffffffff) >>> 0);
  /** Different every session, so the first song after loading is not always the same one. */
  private session = (Math.random() * 0x7fffffff) | 0;

  constructor(
    private mixer: Mixer,
    private onChange: (id: string | null) => void,
  ) {}

  /** Moves the dial. Emits a change if the position actually changed. */
  set(id: string | null, announce = true): void {
    if (id !== null && !stationDef(id)) return;
    if (id === this.station) return;
    this.station = id;
    if (announce) this.onChange(id);
    if (!this.audible || !this.mixer.ac) return;
    this.stop(true);
    if (id === null) {
      this.blip('radioOff', 0, 0.25, 0);
    } else {
      // Sweep through the static between stations, then the new one fades up underneath it.
      this.blip('static', this.rng.int(0, 2), 0.3, 0);
      this.tune(id, 0.28);
    }
  }

  /** Next position on the dial: each station in turn, then off. */
  next(): void {
    this.set(nextStation(this.station));
  }

  /**
   * The player got into (or out of) a vehicle with a radio. `delay` lets the engine start first.
   * Coming on announces the station that was left playing, as if the dial had just been set.
   */
  setAudible(on: boolean, delay = 0.2): void {
    if (on === this.audible) return;
    this.audible = on;
    if (on && this.station) this.onChange(this.station);
    if (!this.mixer.ac) return;
    if (!on) {
      this.stop(true);
    } else if (this.station) {
      this.blip('static', this.rng.int(0, 2), 0.1, Math.max(0, delay - 0.2));
      this.tune(this.station, delay);
    }
  }

  /** Start playing the tuned station if it should be audible (e.g. audio was unlocked while driving). */
  refresh(): void {
    if (this.audible && this.station && !this.item && this.mixer.ac) this.tune(this.station, 0.1);
  }

  private graph(ac: AudioContext): GainNode {
    if (this.input) return this.input;
    // Everything on the radio comes out of a car speaker: no sub-bass.
    const input = ac.createGain();
    const speaker = ac.createBiquadFilter();
    speaker.type = 'highpass';
    speaker.frequency.value = 60;
    speaker.Q.value = biquadQ('highpass', 0.707);
    input.connect(speaker);
    speaker.connect(this.mixer.music);
    // One shared studio reverb for every band.
    const reverb = ac.createGain();
    const conv = ac.createConvolver();
    conv.buffer = this.mixer.impulse(1.3, 0.65);
    const ret = ac.createGain();
    ret.gain.value = 0.5;
    reverb.connect(conv);
    conv.connect(ret);
    ret.connect(input);
    this.input = input;
    this.reverb = reverb;
    return input;
  }

  private blip(id: 'static' | 'radioOff', variant: number, gain: number, delay: number): void {
    const ac = this.mixer.ac;
    if (!ac) return;
    const buffer = this.mixer.buffer(`sfx:${id}:${variant}`, () => renderSound(id, variant));
    this.mixer.playTo(this.graph(ac), buffer, gain, 1, delay);
  }

  /** Joins a station's broadcast `delay` seconds from now. */
  private tune(id: string, delay: number): void {
    const ac = this.mixer.ac;
    if (!ac) return;
    this.graph(ac);
    const at = ac.currentTime + delay;
    let clock = this.clocks.get(id);
    if (!clock) {
      // First time on this station: it has been on air for a while already.
      const first = programItem(id, 0, this.session);
      clock = { index: 0, start: at - this.rng.range(0.08, 0.6) * first.duration };
      this.clocks.set(id, clock);
    }
    let item = programItem(id, clock.index, this.session);
    for (let guard = 0; guard < 5000 && at >= clock.start + item.duration; guard++) {
      clock.start += item.duration;
      clock.index++;
      item = programItem(id, clock.index, this.session);
    }
    this.load(item, clock.start);
    this.nextStep = firstStepAt(this.tl, at);
    this.look.reset();
    if (this.timer === null) this.timer = setInterval(this.tick, TICK * 1000);
  }

  private load(item: Item, start: number): void {
    const ac = this.mixer.ac!;
    this.item = item;
    this.tl = { start, stepDur: item.stepDur, shuffle: item.plan.shuffle, swing: item.plan.swing };
    this.cacheBar = -1;
    if (!this.band || this.bandKit !== item.kit) {
      // A different line-up (an ad break): let the old band's tails ring out, then clear it away.
      if (this.band) this.dying.push({ band: this.band, at: ac.currentTime + 3 });
      this.band = new Band(this.mixer, item.kit, this.graph(ac), this.reverb!);
      this.bandKit = item.kit;
    }
    this.band.setTempo(item.stepDur);
  }

  private stop(fast: boolean): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.item = null;
    if (this.band) {
      if (fast) this.band.silence();
      this.dying.push({ band: this.band, at: this.mixer.now + (fast ? 0.4 : 3) });
      this.band = null;
      this.bandKit = null;
    }
  }

  /** The scheduler, as handed to setInterval. A fault stops the radio rather than repeating 40 times a second. */
  private tick = (): void => {
    try {
      this.schedule();
    } catch (err) {
      console.warn('audio: radio stopped after an error', err);
      try {
        this.stop(true);
      } catch {
        this.item = null;
      }
    }
  };

  private schedule(): void {
    const ac = this.mixer.ac;
    const id = this.station;
    if (!ac || !id || !this.item || !this.band || ac.state !== 'running') return;
    const now = ac.currentTime;
    const horizon = this.look.horizon(now);
    for (let guard = 0; guard < 32; guard++) {
      const item: Item = this.item;
      if (this.nextStep < item.steps) {
        const { from, to } = planTick(this.tl, this.nextStep, now, horizon);
        const end = Math.min(to, item.steps);
        for (let s = from; s < end; s++) this.emit(item, s, now);
        this.nextStep = Math.max(from, end);
        if (this.nextStep < item.steps) return;
      }
      // That item is done. Cue the next one as soon as its first beat is within reach.
      const clock = this.clocks.get(id);
      if (!clock) return;
      const nextStart = clock.start + item.duration;
      if (nextStart > now + horizon) return;
      clock.start = nextStart;
      clock.index++;
      this.load(programItem(id, clock.index, this.session), nextStart);
      this.nextStep = 0;
    }
  }

  private emit(item: Item, step: number, now: number): void {
    const band = this.band;
    if (!band) return;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const st = step - bar * STEPS_PER_BAR;
    if (bar !== this.cacheBar) {
      this.cacheBar = bar;
      for (const bucket of this.cache) bucket.length = 0;
      for (const e of item.style.bar(item.plan, bar)) {
        const k = Math.floor(e.step);
        if (k >= 0 && k < STEPS_PER_BAR) this.cache[k].push(e);
      }
      band.wobble = item.kit.tone === 'tape' ? 9 * Math.sin(now * 0.9) + 5 * Math.sin(now * 3.3) : 0;
    }
    const base = stepTime(this.tl, step);
    const loose = item.plan.humanize;
    for (const e of this.cache[st]) {
      let t = base + (e.step - st) * item.stepDur;
      if (loose) t += (this.rng.next() - 0.5) * 2 * loose;
      band.play(e, t > now + 0.002 ? t : now + 0.002);
    }
  }

  /** Per-frame housekeeping: runs the scheduler as a backstop and clears away retired bands. */
  update(): void {
    if (this.item) this.tick();
    if (!this.dying.length) return;
    const now = this.mixer.now;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (now < this.dying[i].at) continue;
      this.dying[i].band.destroy();
      this.dying.splice(i, 1);
    }
  }

  dispose(): void {
    this.stop(true);
    for (const d of this.dying) d.band.destroy();
    this.dying.length = 0;
  }
}
