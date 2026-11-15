/**
 * Live stations: real New Zealand radio, played from each station's own public stream while the player is in
 * a car. Unlike the six invented stations (dial.ts) nothing here is generated or shipped with the game: the
 * browser connects to the station's server and the station sends whatever is on air right now, 2020s news,
 * ads and all.
 *
 * To add or remove a station, edit LIVE_STATIONS. A stream has to be HTTPS, a plain AAC or MP3 stream (not an
 * HLS playlist), and has to send an Access-Control-Allow-Origin header, because the sound is routed through the
 * game's mixer (car-speaker filter, the music volume setting, ducking when paused).
 */
import type { StationInfo } from './dial';

export interface LiveStation extends StationInfo {
  url: string;
}

export const LIVE_STATIONS: readonly LiveStation[] = [
  { id: 'live-rock', name: 'The Rock', blurb: 'Live radio', url: 'https://mediaworks.streamguys1.com/rock_net_icy' },
  { id: 'live-zm', name: 'ZM', blurb: 'Live radio', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/NZME_33AAC.aac' },
  { id: 'live-edge', name: 'The Edge', blurb: 'Live radio', url: 'https://mediaworks.streamguys1.com/edge_net_icy' },
  { id: 'live-brian', name: 'Brian FM', blurb: 'Live radio', url: 'https://ais-sa1.streamon.fm/7358_128k.aac' },
  { id: 'live-more', name: 'More FM', blurb: 'Live radio · Canterbury', url: 'https://mediaworks.streamguys1.com/more-chc-high_icy' },
  { id: 'live-breeze', name: 'The Breeze', blurb: 'Live radio · Canterbury', url: 'https://mediaworks.streamguys1.com/breeze-chc-high_icy' },
  { id: 'live-hits', name: 'The Hits', blurb: 'Live radio', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/NZME_71AAC.aac' },
  { id: 'live-hauraki', name: 'Radio Hauraki', blurb: 'Live radio', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/NZME_04AAC.aac' },
  { id: 'live-sound', name: 'The Sound', blurb: 'Live radio', url: 'https://mediaworks.streamguys1.com/sound_net_icy' },
  { id: 'live-rnz', name: 'RNZ National', blurb: 'Live radio', url: 'https://stream-ice.radionz.co.nz/national_aac64' },
];

export const liveStation = (id: string | null): LiveStation | undefined => (id === null ? undefined : LIVE_STATIONS.find((s) => s.id === id));

export type LiveState = 'off' | 'connecting' | 'playing' | 'failed';

/** What the radio needs from a stream player. The real one is LiveStream; tests pass a stand-in. */
export interface LivePlayer {
  /** False where there is no <audio> element or it cannot play AAC: the live stations then stay off the dial. */
  readonly available: boolean;
  readonly state: LiveState;
  /** Connects to `url` and fades it up into `dest` once sound arrives. `onFail` is called if it never does. */
  start(ac: AudioContext, dest: AudioNode, url: string, onFail: () => void): void;
  /** Drops the connection. */
  stop(): void;
}

/** Commercial radio is mastered far hotter than the generated stations; this brings it down to sit with them. */
const LIVE_LEVEL = 0.5;
/** How long to wait for the first sound before giving up on a stream. */
const CONNECT_TIMEOUT = 12_000;

type ElementFactory = () => HTMLAudioElement;

function browserFactory(): ElementFactory | null {
  if (typeof Audio === 'undefined') return null;
  try {
    const probe = new Audio();
    if (!probe.canPlayType('audio/aac') && !probe.canPlayType('audio/aacp') && !probe.canPlayType('audio/mp4; codecs="mp4a.40.2"')) return null;
  } catch {
    return null;
  }
  return () => new Audio();
}

/**
 * One <audio> element, kept for the life of the game and pointed at whichever stream is tuned. It is wired
 * into WebAudio once (an element can only ever be given one source node) and silenced by a gain between
 * stations.
 */
export class LiveStream implements LivePlayer {
  state: LiveState = 'off';

  private el: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retried = false;
  private attempt = 0;
  private onFail: (() => void) | null = null;
  private url = '';

  constructor(private make: ElementFactory | null = browserFactory()) {}

  get available(): boolean {
    return this.make !== null;
  }

  start(ac: AudioContext, dest: AudioNode, url: string, onFail: () => void): void {
    this.stop();
    const el = this.element(ac, dest);
    if (!el || !this.gain) {
      this.state = 'failed';
      onFail();
      return;
    }
    this.url = url;
    this.onFail = onFail;
    this.retried = false;
    this.state = 'connecting';
    this.gain.gain.cancelScheduledValues(ac.currentTime);
    this.gain.gain.setValueAtTime(0, ac.currentTime);
    this.connect(el);
  }

  stop(): void {
    this.clearTimer();
    this.attempt++;
    this.onFail = null;
    const el = this.el;
    if (this.state !== 'off' && el) {
      // Marked off first: dropping the source makes the element fire events of its own.
      this.state = 'off';
      this.gain?.gain.cancelScheduledValues(0);
      this.gain?.gain.setValueAtTime(0, 0);
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {
        // An element that will not reset is at least paused and silent.
      }
    }
    this.state = 'off';
  }

  private element(ac: AudioContext, dest: AudioNode): HTMLAudioElement | null {
    if (this.el) return this.el;
    if (!this.make || typeof ac.createMediaElementSource !== 'function') return null;
    try {
      const el = this.make();
      // Without this the browser treats the stream as opaque and WebAudio plays it as silence.
      el.crossOrigin = 'anonymous';
      el.preload = 'none';
      const source = ac.createMediaElementSource(el);
      const gain = ac.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(dest);
      el.addEventListener('playing', () => this.playing(ac));
      el.addEventListener('error', () => this.dropped());
      el.addEventListener('ended', () => this.dropped());
      this.el = el;
      this.gain = gain;
      return el;
    } catch {
      return null;
    }
  }

  private connect(el: HTMLAudioElement): void {
    this.clearTimer();
    // Retuning interrupts the previous play() request, which then rejects late: only the newest attempt counts.
    const attempt = ++this.attempt;
    this.timer = setTimeout(() => this.dropped(), CONNECT_TIMEOUT);
    try {
      el.src = this.url;
      const started = el.play();
      if (started && typeof started.catch === 'function') {
        started.catch(() => {
          if (attempt === this.attempt) this.dropped();
        });
      }
    } catch {
      this.dropped();
    }
  }

  private playing(ac: AudioContext): void {
    if (this.state !== 'connecting' || !this.gain) return;
    this.clearTimer();
    this.state = 'playing';
    this.gain.gain.cancelScheduledValues(ac.currentTime);
    this.gain.gain.setTargetAtTime(LIVE_LEVEL, ac.currentTime, 0.25);
  }

  /** The stream errored, ended or never started. One quiet retry, then report it. */
  private dropped(): void {
    if (this.state !== 'connecting' && this.state !== 'playing') return;
    this.clearTimer();
    const el = this.el;
    if (!this.retried && el) {
      this.retried = true;
      this.state = 'connecting';
      this.timer = setTimeout(() => {
        if (this.state === 'connecting') this.connect(el);
      }, 1500);
      return;
    }
    const onFail = this.onFail;
    this.stop();
    this.state = 'failed';
    onFail?.();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
