import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '../fake-webaudio';
import { Mixer } from '../mixer';
import { STATIONS } from './dial';
import { LIVE_STATIONS, LiveStream, liveStation, type LivePlayer, type LiveState } from './live';
import { Radio } from './radio';

/** Stands in for the stream player: records what the radio asks of it. */
class StubPlayer implements LivePlayer {
  state: LiveState = 'off';
  started: string[] = [];
  stops = 0;
  private fail: (() => void) | null = null;

  constructor(readonly available = true) {}

  start(_ac: AudioContext, _dest: AudioNode, url: string, onFail: () => void): void {
    this.started.push(url);
    this.fail = onFail;
    this.state = 'playing';
  }

  stop(): void {
    if (this.state !== 'off') this.stops++;
    this.state = 'off';
    this.fail = null;
  }

  /** The stream gave up. */
  drop(): void {
    const fail = this.fail;
    this.state = 'failed';
    fail?.();
  }
}

const noop = () => {};

function unlocked(): Mixer {
  const mixer = new Mixer();
  mixer.unlock(0.8, 0.7, 0.9);
  return mixer;
}

describe('live stations', () => {
  beforeEach(() => {
    FakeAudioContext.instances.length = 0;
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('are distinct, secure, plain streams that do not collide with the invented stations', () => {
    const ids = LIVE_STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(LIVE_STATIONS.map((s) => s.name)).size).toBe(LIVE_STATIONS.length);
    expect(new Set(LIVE_STATIONS.map((s) => s.url)).size).toBe(LIVE_STATIONS.length);
    for (const s of LIVE_STATIONS) {
      expect(s.url.startsWith('https://')).toBe(true);
      expect(s.url.includes('.m3u8')).toBe(false);
      expect(STATIONS.some((made) => made.id === s.id)).toBe(false);
      expect(s.name.length).toBeGreaterThan(0);
    }
    expect(liveStation(ids[0])?.name).toBe(LIVE_STATIONS[0].name);
    expect(liveStation(STATIONS[0].id)).toBeUndefined();
    expect(liveStation(null)).toBeUndefined();
  });

  it('stay off the dial where the browser cannot play them', () => {
    const radio = new Radio(new Mixer(), noop, new StubPlayer(false));
    expect(radio.stations.map((s) => s.id)).toEqual(STATIONS.map((s) => s.id));
    expect(radio.station).toBe(STATIONS[0].id);
    radio.set(LIVE_STATIONS[0].id);
    expect(radio.station).toBe(STATIONS[0].id);
  });

  it('come first on the dial, then the invented stations, then off', () => {
    const heard: (string | null)[] = [];
    const radio = new Radio(new Mixer(), (id) => heard.push(id), new StubPlayer());
    const all = [...LIVE_STATIONS.map((s) => s.id), ...STATIONS.map((s) => s.id)];
    expect(radio.stations.map((s) => s.id)).toEqual(all);
    expect(radio.station).toBe(all[0]);
    for (let i = 0; i < all.length + 1; i++) radio.next();
    expect(heard).toEqual([...all.slice(1), null, all[0]]);
    // And backwards: from the first station to off, then the last station, and so on down.
    heard.length = 0;
    for (let i = 0; i < all.length + 1; i++) radio.prev();
    expect(heard).toEqual([null, ...all.slice(1).reverse(), all[0]]);
    expect(radio.nameOf(LIVE_STATIONS[1].id)).toBe(LIVE_STATIONS[1].name);
    expect(radio.nameOf(STATIONS[0].id)).toBe(STATIONS[0].name);
    expect(radio.nameOf(null)).toBe('Radio off');
  });

  it('connect when the player is in a car and drop the stream on retuning or getting out', () => {
    const player = new StubPlayer();
    const names: string[] = [];
    const radio = new Radio(unlocked(), (_id, name) => names.push(name), player);
    expect(player.started).toEqual([]);

    radio.setAudible(true, 0);
    expect(player.started).toEqual([LIVE_STATIONS[0].url]);
    expect(names).toEqual([LIVE_STATIONS[0].name]);

    radio.next();
    expect(player.stops).toBe(1);
    expect(player.started).toEqual([LIVE_STATIONS[0].url, LIVE_STATIONS[1].url]);

    // On to an invented station: the stream goes, the band plays.
    radio.set(STATIONS[0].id);
    expect(player.stops).toBe(2);
    expect(player.state).toBe('off');
    expect(player.started).toHaveLength(2);

    radio.set(LIVE_STATIONS[2].id);
    expect(player.started).toHaveLength(3);
    radio.setAudible(false);
    expect(player.stops).toBe(3);
    expect(player.state).toBe('off');
    radio.dispose();
  });

  it('say so when a stream fails, and do not keep reconnecting', () => {
    const player = new StubPlayer();
    const names: string[] = [];
    const radio = new Radio(unlocked(), (_id, name) => names.push(name), player);
    radio.setAudible(true, 0);
    player.drop();
    expect(names[names.length - 1]).toBe(`${LIVE_STATIONS[0].name}: no signal`);
    for (let i = 0; i < 10; i++) radio.refresh();
    expect(player.started).toHaveLength(1);
    // Moving the dial tries the next one.
    radio.next();
    expect(player.started).toHaveLength(2);
    radio.dispose();
  });

  it('can be switched off: they leave the dial and a live station being played gives way', () => {
    const player = new StubPlayer();
    const radio = new Radio(unlocked(), noop, player);
    radio.setAudible(true, 0);
    expect(liveStation(radio.station)).toBeDefined();
    radio.setLive(false);
    expect(radio.stations.map((s) => s.id)).toEqual(STATIONS.map((s) => s.id));
    expect(radio.station).toBe(STATIONS[0].id);
    expect(player.state).toBe('off');
    radio.setLive(true);
    expect(radio.stations).toHaveLength(LIVE_STATIONS.length + STATIONS.length);
    // Already listening to something: turning them back on does not retune.
    expect(radio.station).toBe(STATIONS[0].id);
    radio.dispose();
  });

  it('are the default again when switched back on before the dial has been touched', () => {
    const radio = new Radio(new Mixer(), noop, new StubPlayer());
    radio.setLive(false);
    expect(radio.station).toBe(STATIONS[0].id);
    radio.setLive(true);
    expect(radio.station).toBe(LIVE_STATIONS[0].id);
  });
});

/** The few parts of an <audio> element and an AudioContext the stream player touches. */
function fakeElement() {
  const handlers = new Map<string, () => void>();
  const el = {
    /** One per play() call, so a test can fail an earlier request after a later one was made. */
    rejects: [] as ((reason: unknown) => void)[],
    crossOrigin: null as string | null,
    preload: '',
    src: '',
    plays: 0,
    pauses: 0,
    loads: 0,
    addEventListener: (type: string, handler: () => void) => handlers.set(type, handler),
    play() {
      el.plays++;
      return new Promise<void>((_resolve, rej) => {
        el.rejects.push(rej);
      });
    },
    pause() {
      el.pauses++;
    },
    removeAttribute(name: string) {
      if (name === 'src') el.src = '';
    },
    load() {
      el.loads++;
    },
    fire: (type: string) => handlers.get(type)?.(),
  };
  return el;
}

function fakeContext() {
  const gain = { value: 1, target: -1, cancelScheduledValues: noop, setValueAtTime: (v: number) => void (gain.value = v), setTargetAtTime: (v: number) => void (gain.target = v) };
  const ac = {
    currentTime: 3,
    sources: 0,
    createMediaElementSource: () => {
      ac.sources++;
      return { connect: noop };
    },
    createGain: () => ({ gain, connect: noop }),
  };
  return { ac, gain };
}

describe('the stream player', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const el = fakeElement();
    const { ac, gain } = fakeContext();
    const stream = new LiveStream(() => el as unknown as HTMLAudioElement);
    const failed = vi.fn();
    const start = (url: string) => stream.start(ac as unknown as AudioContext, {} as AudioNode, url, failed);
    return { el, ac, gain, stream, failed, start };
  };

  it('is unavailable without an <audio> element', () => {
    const stream = new LiveStream(null);
    expect(stream.available).toBe(false);
    const failed = vi.fn();
    stream.start(fakeContext().ac as unknown as AudioContext, {} as AudioNode, 'https://example.test/a', failed);
    expect(stream.state).toBe('failed');
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('asks for the stream cross-origin, stays silent until sound arrives, then fades up', () => {
    const { el, gain, stream, start, failed } = setup();
    start('https://example.test/rock');
    expect(el.crossOrigin).toBe('anonymous');
    expect(el.src).toBe('https://example.test/rock');
    expect(el.plays).toBe(1);
    expect(stream.state).toBe('connecting');
    expect(gain.value).toBe(0);
    el.fire('playing');
    expect(stream.state).toBe('playing');
    expect(gain.target).toBeGreaterThan(0);
    expect(gain.target).toBeLessThan(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('uses one element and one source node however often it is retuned', () => {
    const { el, ac, stream, start } = setup();
    start('https://example.test/a');
    start('https://example.test/b');
    start('https://example.test/c');
    expect(ac.sources).toBe(1);
    expect(el.src).toBe('https://example.test/c');
    expect(stream.state).toBe('connecting');
  });

  it('drops the connection when stopped', () => {
    const { el, stream, start } = setup();
    start('https://example.test/a');
    el.fire('playing');
    stream.stop();
    expect(stream.state).toBe('off');
    expect(el.pauses).toBe(1);
    expect(el.src).toBe('');
    expect(el.loads).toBe(1);
  });

  it('retries once, then reports the failure', () => {
    const { el, stream, start, failed } = setup();
    start('https://example.test/a');
    el.fire('error');
    expect(stream.state).toBe('connecting');
    expect(failed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1600);
    expect(el.plays).toBe(2);
    el.fire('error');
    expect(stream.state).toBe('failed');
    expect(failed).toHaveBeenCalledTimes(1);
    expect(el.src).toBe('');
  });

  it('gives up on a stream that never starts', () => {
    const { stream, start, failed } = setup();
    start('https://example.test/a');
    vi.advanceTimersByTime(13_000);
    expect(failed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(stream.state).toBe('failed');
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('ignores the late rejection of a play() that retuning interrupted', async () => {
    const { el, stream, start, failed } = setup();
    start('https://example.test/a');
    start('https://example.test/b');
    el.rejects[0](new Error('interrupted by a new load'));
    await Promise.resolve();
    await Promise.resolve();
    expect(stream.state).toBe('connecting');
    expect(el.plays).toBe(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it('says nothing after being stopped', () => {
    const { el, stream, start, failed } = setup();
    start('https://example.test/a');
    stream.stop();
    el.fire('error');
    el.fire('playing');
    vi.advanceTimersByTime(30_000);
    expect(stream.state).toBe('off');
    expect(failed).not.toHaveBeenCalled();
  });
});
