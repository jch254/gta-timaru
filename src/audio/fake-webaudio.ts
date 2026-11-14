/**
 * A strict stand-in for the WebAudio API, for tests only (never imported by the game).
 *
 * It makes no sound. What it does is check every call the audio system makes the way a browser would
 * (non-finite parameters, negative times, starting a source twice, a ConvolverNode buffer at the wrong sample
 * rate, …) and keep the node graph, so tests can count how many nodes are still wired to the output and prove
 * that finished notes are cleaned up.
 */

type Listener = (this: FakeSource, ev: { target: FakeSource }) => void;

function fail(name: string, message: string): never {
  const err = new Error(message);
  err.name = name;
  throw err;
}

const finite = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('TypeError', `${what}: non-finite value ${String(v)}`);
  return v as number;
};

const time = (t: unknown, what: string): number => {
  const v = finite(t, what);
  if (v < 0) fail('RangeError', `${what}: negative time ${v}`);
  return v;
};

export class FakeParam {
  /** Number of automation events scheduled on this parameter. */
  events = 0;
  /** Nodes modulating this parameter. */
  inputs = new Set<FakeNode>();
  private v: number;

  constructor(
    readonly owner: FakeNode,
    readonly name: string,
    initial: number,
    private min = -Infinity,
    private max = Infinity,
  ) {
    this.v = initial;
  }

  private check(v: unknown, how: string): number {
    const x = finite(v, `${this.owner.kind}.${this.name} ${how}`);
    if (x < this.min - 1e-9 || x > this.max + 1e-9) fail('RangeError', `${this.owner.kind}.${this.name} ${how}: ${x} outside [${this.min}, ${this.max}]`);
    return x;
  }

  get value(): number {
    return this.v;
  }

  set value(v: number) {
    this.v = this.check(v, 'value');
  }

  setValueAtTime(v: number, t: number): this {
    this.v = this.check(v, 'setValueAtTime');
    time(t, `${this.owner.kind}.${this.name} setValueAtTime`);
    this.events++;
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): this {
    this.v = this.check(v, 'linearRamp');
    time(t, `${this.owner.kind}.${this.name} linearRamp`);
    this.events++;
    return this;
  }

  exponentialRampToValueAtTime(v: number, t: number): this {
    const x = this.check(v, 'exponentialRamp');
    if (x === 0) fail('RangeError', `${this.owner.kind}.${this.name}: exponential ramp to zero`);
    if (this.v !== 0 && Math.sign(this.v) !== Math.sign(x)) fail('RangeError', `${this.owner.kind}.${this.name}: exponential ramp across zero`);
    this.v = x;
    time(t, `${this.owner.kind}.${this.name} exponentialRamp`);
    this.events++;
    return this;
  }

  setTargetAtTime(v: number, t: number, tc: number): this {
    this.v = this.check(v, 'setTarget');
    time(t, `${this.owner.kind}.${this.name} setTarget`);
    if (finite(tc, 'timeConstant') < 0) fail('RangeError', `${this.owner.kind}.${this.name}: negative time constant`);
    this.events++;
    return this;
  }

  cancelScheduledValues(t: number): this {
    time(t, `${this.owner.kind}.${this.name} cancel`);
    return this;
  }
}

export class FakeNode {
  outputs = new Set<FakeNode | FakeParam>();
  inputs = new Set<FakeNode>();
  params: FakeParam[] = [];

  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {
    context.created++;
    context.byKind[kind] = (context.byKind[kind] ?? 0) + 1;
  }

  protected param(name: string, initial: number, min?: number, max?: number): FakeParam {
    const p = new FakeParam(this, name, initial, min, max);
    this.params.push(p);
    return p;
  }

  connect<T extends FakeNode | FakeParam>(dest: T): T {
    if (dest instanceof FakeNode) {
      if (dest.context !== this.context) fail('InvalidAccessError', 'connect: node belongs to another context');
      if (dest instanceof FakeSource) fail('IndexSizeError', `connect: ${dest.kind} has no inputs`);
      dest.inputs.add(this);
    } else if (dest instanceof FakeParam) {
      dest.inputs.add(this);
    } else {
      fail('TypeError', `connect: not an AudioNode or AudioParam (${String(dest)})`);
    }
    this.outputs.add(dest);
    return dest;
  }

  disconnect(dest?: FakeNode | FakeParam): void {
    const targets = dest ? [dest] : [...this.outputs];
    for (const d of targets) {
      d.inputs.delete(this);
      this.outputs.delete(d);
    }
  }
}

export class FakeBuffer {
  readonly duration: number;
  private channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(ch: number): Float32Array {
    if (!(ch >= 0 && ch < this.numberOfChannels)) fail('IndexSizeError', `getChannelData(${ch})`);
    return this.channels[ch];
  }
}

export class FakeSource extends FakeNode {
  onended: Listener | null = null;
  started = false;
  ended = false;
  startTime = 0;
  stopTime = Infinity;

  start(when = 0, offset = 0): void {
    if (this.started) fail('InvalidStateError', `${this.kind}: start called twice`);
    time(when, `${this.kind}.start`);
    time(offset, `${this.kind}.start offset`);
    this.started = true;
    this.startTime = Math.max(when, this.context.currentTime);
    this.context.sources.add(this);
  }

  stop(when = 0): void {
    if (!this.started) fail('InvalidStateError', `${this.kind}: stop before start`);
    time(when, `${this.kind}.stop`);
    this.stopTime = Math.max(when, this.context.currentTime);
  }

  /** When the source falls silent of its own accord (overridden by buffer sources). */
  naturalEnd(): number {
    return Infinity;
  }
}

class FakeOscillator extends FakeSource {
  frequency = this.param('frequency', 440, 0, 24000);
  detune = this.param('detune', 0, -153600, 153600);
  wave: FakePeriodicWave | null = null;
  private shape = 'sine';

  constructor(context: FakeAudioContext) {
    super(context, 'oscillator');
  }

  get type(): string {
    return this.shape;
  }

  set type(v: string) {
    if (!['sine', 'square', 'sawtooth', 'triangle'].includes(v)) fail('InvalidStateError', `oscillator.type = ${v}`);
    this.shape = v;
  }

  setPeriodicWave(w: FakePeriodicWave): void {
    if (!(w instanceof FakePeriodicWave)) fail('TypeError', 'setPeriodicWave: not a PeriodicWave');
    this.wave = w;
    this.shape = 'custom';
  }
}

class FakeBufferSource extends FakeSource {
  playbackRate = this.param('playbackRate', 1, 0.01, 64);
  detune = this.param('detune', 0);
  loop = false;
  private buf: FakeBuffer | null = null;

  constructor(context: FakeAudioContext) {
    super(context, 'bufferSource');
  }

  get buffer(): FakeBuffer | null {
    return this.buf;
  }

  set buffer(b: FakeBuffer | null) {
    if (b !== null && !(b instanceof FakeBuffer)) fail('TypeError', 'bufferSource.buffer: not an AudioBuffer');
    if (b !== null && this.buf !== null) fail('InvalidStateError', 'bufferSource.buffer set twice');
    this.buf = b;
  }

  override start(when = 0, offset = 0): void {
    if (!this.buf) fail('InvalidStateError', 'bufferSource started without a buffer');
    super.start(when, offset);
  }

  override naturalEnd(): number {
    if (this.loop || !this.buf) return Infinity;
    return this.startTime + this.buf.duration / Math.max(0.01, this.playbackRate.value);
  }
}

class FakeGain extends FakeNode {
  gain = this.param('gain', 1, -100, 100);
  constructor(context: FakeAudioContext) {
    super(context, 'gain');
  }
}

class FakeBiquad extends FakeNode {
  frequency = this.param('frequency', 350, 0, 24000);
  // Low-pass / high-pass Q is in dB and may be negative; the others take a positive quality factor.
  Q = this.param('Q', 1, -770, 1000);
  gain = this.param('gain', 0, -40, 40);
  detune = this.param('detune', 0);
  private kindOf = 'lowpass';

  constructor(context: FakeAudioContext) {
    super(context, 'biquad');
  }

  get type(): string {
    return this.kindOf;
  }

  set type(v: string) {
    if (!['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'].includes(v)) fail('TypeError', `biquad.type = ${v}`);
    this.kindOf = v;
  }
}

class FakePanner extends FakeNode {
  pan = this.param('pan', 0, -1, 1);
  constructor(context: FakeAudioContext) {
    super(context, 'stereoPanner');
  }
}

class FakeDelay extends FakeNode {
  delayTime: FakeParam;
  constructor(context: FakeAudioContext, max: number) {
    super(context, 'delay');
    if (!(max > 0 && max < 180)) fail('NotSupportedError', `createDelay(${max})`);
    this.delayTime = this.param('delayTime', 0, 0, max);
  }
}

class FakeCompressor extends FakeNode {
  threshold = this.param('threshold', -24, -100, 0);
  knee = this.param('knee', 30, 0, 40);
  ratio = this.param('ratio', 12, 1, 20);
  attack = this.param('attack', 0.003, 0, 1);
  release = this.param('release', 0.25, 0, 1);
  constructor(context: FakeAudioContext) {
    super(context, 'compressor');
  }
}

class FakeShaper extends FakeNode {
  private table: Float32Array | null = null;
  private over = 'none';

  constructor(context: FakeAudioContext) {
    super(context, 'waveShaper');
  }

  get curve(): Float32Array | null {
    return this.table;
  }

  set curve(c: Float32Array | null) {
    if (c !== null) {
      if (!(c instanceof Float32Array) || c.length < 2) fail('InvalidStateError', 'waveShaper.curve must be a Float32Array of 2+ points');
      if (!c.every(Number.isFinite)) fail('TypeError', 'waveShaper.curve has non-finite points');
    }
    this.table = c;
  }

  get oversample(): string {
    return this.over;
  }

  set oversample(v: string) {
    if (!['none', '2x', '4x'].includes(v)) fail('TypeError', `waveShaper.oversample = ${v}`);
    this.over = v;
  }
}

class FakeConvolver extends FakeNode {
  normalize = true;
  private ir: FakeBuffer | null = null;

  constructor(context: FakeAudioContext) {
    super(context, 'convolver');
  }

  get buffer(): FakeBuffer | null {
    return this.ir;
  }

  set buffer(b: FakeBuffer | null) {
    if (b !== null) {
      if (!(b instanceof FakeBuffer)) fail('TypeError', 'convolver.buffer: not an AudioBuffer');
      // The rule a real browser enforces, and the one that bites when the machine runs at 48 kHz.
      if (b.sampleRate !== this.context.sampleRate) {
        fail('NotSupportedError', `The buffer sample rate of ${b.sampleRate} does not match the context rate of ${this.context.sampleRate} Hz`);
      }
      if (b.numberOfChannels < 1 || b.numberOfChannels > 4 || b.numberOfChannels === 3) fail('NotSupportedError', 'convolver.buffer channel count');
    }
    this.ir = b;
  }
}

export class FakePeriodicWave {
  constructor(real: Float32Array, imag: Float32Array) {
    if (!(real instanceof Float32Array) || !(imag instanceof Float32Array)) fail('TypeError', 'createPeriodicWave: Float32Arrays required');
    if (real.length !== imag.length || real.length < 2) fail('IndexSizeError', 'createPeriodicWave: arrays must match and hold 2+ values');
  }
}

export interface FakeOptions {
  sampleRate?: number;
  /** Name of a create* method that should throw (to test start-up failures). */
  breakOn?: string;
}

export class FakeAudioContext {
  static options: FakeOptions = {};
  static instances: FakeAudioContext[] = [];

  readonly sampleRate: number;
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  readonly destination: FakeNode;
  created = 0;
  byKind: Record<string, number> = {};
  sources = new Set<FakeSource>();
  /** Sample rates of every AudioBuffer created. */
  bufferRates: number[] = [];
  bufferSeconds = 0;
  private breakOn: string | undefined;

  constructor() {
    this.sampleRate = FakeAudioContext.options.sampleRate ?? 48000;
    this.breakOn = FakeAudioContext.options.breakOn;
    this.destination = new FakeNode(this, 'destination');
    FakeAudioContext.instances.push(this);
  }

  private make<T>(name: string, build: () => T): T {
    if (this.state === 'closed') fail('InvalidStateError', `${name} on a closed context`);
    if (this.breakOn === name) fail('NotSupportedError', `${name} is broken in this test`);
    return build();
  }

  createGain = (): FakeGain => this.make('createGain', () => new FakeGain(this));
  createOscillator = (): FakeOscillator => this.make('createOscillator', () => new FakeOscillator(this));
  createBufferSource = (): FakeBufferSource => this.make('createBufferSource', () => new FakeBufferSource(this));
  createBiquadFilter = (): FakeBiquad => this.make('createBiquadFilter', () => new FakeBiquad(this));
  createStereoPanner = (): FakePanner => this.make('createStereoPanner', () => new FakePanner(this));
  createDelay = (max = 1): FakeDelay => this.make('createDelay', () => new FakeDelay(this, max));
  createDynamicsCompressor = (): FakeCompressor => this.make('createDynamicsCompressor', () => new FakeCompressor(this));
  createWaveShaper = (): FakeShaper => this.make('createWaveShaper', () => new FakeShaper(this));
  createConvolver = (): FakeConvolver => this.make('createConvolver', () => new FakeConvolver(this));
  createPeriodicWave = (real: Float32Array, imag: Float32Array): FakePeriodicWave => this.make('createPeriodicWave', () => new FakePeriodicWave(real, imag));

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return this.make('createBuffer', () => {
      if (!(Number.isInteger(channels) && channels >= 1 && channels <= 32)) fail('NotSupportedError', `createBuffer channels ${channels}`);
      if (!(Number.isInteger(length) && length >= 1)) fail('NotSupportedError', `createBuffer length ${length}`);
      if (!(sampleRate >= 8000 && sampleRate <= 96000)) fail('NotSupportedError', `createBuffer sampleRate ${sampleRate}`);
      this.bufferRates.push(sampleRate);
      this.bufferSeconds += (channels * length) / sampleRate;
      return new FakeBuffer(channels, length, sampleRate);
    });
  }

  resume(): Promise<void> {
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    if (this.state !== 'closed') this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Moves the audio clock on and fires `onended` for every source that has finished. */
  advance(dt: number): void {
    this.currentTime += dt;
    for (const s of this.sources) {
      const end = Math.min(s.stopTime, s.naturalEnd());
      if (end > this.currentTime) continue;
      s.ended = true;
      this.sources.delete(s);
      s.onended?.call(s, { target: s });
    }
  }

  /** Nodes still wired (directly, or by modulating a parameter) into the output, finished sources excluded. */
  liveNodes(): number {
    const seen = new Set<FakeNode>();
    const stack: FakeNode[] = [this.destination];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const i of n.inputs) stack.push(i);
      for (const p of n.params) for (const i of p.inputs) stack.push(i);
    }
    let live = 0;
    for (const n of seen) if (!(n instanceof FakeSource && n.ended)) live++;
    return live - 1;
  }

  /** Sources currently sounding (started, not yet ended). */
  activeSources(): number {
    let n = 0;
    for (const s of this.sources) if (s.startTime <= this.currentTime) n++;
    return n;
  }
}
