/** A build's stamp, as baked into the code and written to dist/version.json (see vite.config.ts). */
export interface BuildInfo {
  build: string;
  builtAt: number;
}

/** How often a running game asks whether a newer build is out, and the least time between two asks. */
const POLL_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;
/** The build this tab last reloaded by itself to get, so a page still served stale can never reload in a loop. */
const RELOADED_KEY = '03-quest.reloaded-for';

type Load = (url: string) => Promise<unknown>;

const loadJson: Load = async (url) => {
  // Past the browser's cache every time; the deploy also uploads version.json with no-cache for CloudFront.
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

/**
 * Whether `remote` (whatever version.json held) is a build that replaced `own`. It has to be a different build
 * and a later one: between the deploy's uploads a new page can read the old version.json, which must not count.
 */
export function isNewer(own: BuildInfo, remote: unknown): remote is BuildInfo {
  if (!remote || typeof remote !== 'object') return false;
  const { build, builtAt } = remote as Partial<BuildInfo>;
  return typeof build === 'string' && build !== '' && build !== own.build && typeof builtAt === 'number' && Number.isFinite(builtAt) && builtAt > own.builtAt;
}

/**
 * Notices when a newer build of the game has been deployed than the one running in this tab, by reading
 * version.json now and then: every few minutes while the tab is in view, when it comes back into view, when
 * the network comes back, and whenever something asks (the pause screen, a failed start). Once a newer build
 * has been seen it stops asking and tells whoever is listening; what to do about it is theirs to decide.
 */
export class UpdateWatch {
  /** The newer build, once one has been seen. */
  latest: BuildInfo | null = null;

  private listeners = new Set<(latest: BuildInfo) => void>();
  private offs: (() => void)[] = [];
  private pending: Promise<boolean> | null = null;
  private lastCheck = -Infinity;

  constructor(
    readonly own: BuildInfo,
    private url: string,
    private load: Load = loadJson,
    private now: () => number = () => Date.now(),
  ) {}

  get running(): boolean {
    return this.offs.length > 0;
  }

  start() {
    if (this.running || this.latest) return;
    const poll = () => {
      if (!document.hidden) void this.check();
    };
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('online', poll);
    this.offs.push(
      () => clearInterval(timer),
      () => document.removeEventListener('visibilitychange', poll),
      () => window.removeEventListener('online', poll),
    );
  }

  stop() {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /**
   * Asks version.json whether a newer build is out. Resolves true once one has been seen. Asks are spaced at
   * least half a minute apart unless `force`d, and nothing is asked before `start()` (in dev, or in tests).
   * A failed ask (offline, or no version.json yet) is just a no: the next one tries again.
   */
  check(force = false): Promise<boolean> {
    if (this.latest) return Promise.resolve(true);
    if (!this.running) return Promise.resolve(false);
    if (this.pending) return this.pending;
    if (!force && this.now() - this.lastCheck < MIN_GAP_MS) return Promise.resolve(false);
    this.lastCheck = this.now();
    this.pending = this.load(this.url)
      .then(
        (remote) => this.accept(remote),
        () => false,
      )
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** Takes what version.json held; true if it names a newer build (and then everyone listening hears of it). */
  accept(remote: unknown): boolean {
    if (this.latest) return true;
    if (!isNewer(this.own, remote)) return false;
    const latest = (this.latest = { build: remote.build, builtAt: remote.builtAt });
    this.stop();
    for (const fn of [...this.listeners]) {
      try {
        fn(latest);
      } catch (err) {
        console.error('update: a listener failed', err);
      }
    }
    this.listeners.clear();
    return true;
  }

  /** Calls `fn` once a newer build is out (straight away if it already is). Returns the way to stop listening. */
  onAvailable(fn: (latest: BuildInfo) => void): () => void {
    if (this.latest) {
      fn(this.latest);
      return () => undefined;
    }
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Reloads onto the newer build without the player asking, at most once per build in this tab. Returns false,
   * and does nothing, if there is no newer build, if this tab already reloaded for it (the page that came back
   * was still the old one), or if the tab has no session storage to remember that in.
   */
  reloadOnce(): boolean {
    const latest = this.latest;
    if (!latest) return false;
    try {
      if (sessionStorage.getItem(RELOADED_KEY) === latest.build) return false;
      sessionStorage.setItem(RELOADED_KEY, latest.build);
    } catch {
      return false;
    }
    location.reload();
    return true;
  }
}

/** This tab's watch, for the build it is running. main.ts starts it (outside dev). */
export const updates = new UpdateWatch({ build: __BUILD_ID__, builtAt: __BUILT_AT__ }, `${import.meta.env.BASE_URL}version.json`);
