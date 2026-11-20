import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewer, UpdateWatch, type BuildInfo } from './update';

const OWN: BuildInfo = { build: 'abc123', builtAt: 1_000 };

describe('isNewer', () => {
  it('takes a different build made later', () => {
    expect(isNewer(OWN, { build: 'def456', builtAt: 2_000 })).toBe(true);
  });

  it('turns down the same build, and an older one (a new page reading the old version.json mid-deploy)', () => {
    expect(isNewer(OWN, { build: 'abc123', builtAt: 2_000 })).toBe(false);
    expect(isNewer(OWN, { build: 'def456', builtAt: 1_000 })).toBe(false);
    expect(isNewer(OWN, { build: 'def456', builtAt: 500 })).toBe(false);
  });

  it('turns down anything that is not a build stamp', () => {
    for (const junk of [null, undefined, 'def456', 42, [], {}, { build: '' , builtAt: 2_000 }, { build: 'def456' }, { build: 'def456', builtAt: '2000' }, { build: 7, builtAt: 2_000 }, { build: 'def456', builtAt: Infinity }]) {
      expect(isNewer(OWN, junk)).toBe(false);
    }
  });
});

/** A watch with a stand-in for version.json and a clock that only moves when told. */
function watch(answer: () => unknown) {
  let now = 100_000;
  const load = vi.fn(async () => answer());
  const w = new UpdateWatch(OWN, './version.json', load, () => now);
  return { w, load, later: (ms: number) => (now += ms) };
}

const fakeDom = () => {
  const listeners = { document: new Map<string, () => void>(), window: new Map<string, () => void>() };
  const doc = {
    hidden: false,
    addEventListener: (type: string, fn: () => void) => listeners.document.set(type, fn),
    removeEventListener: (type: string) => listeners.document.delete(type),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => listeners.window.set(type, fn),
    removeEventListener: (type: string) => listeners.window.delete(type),
  });
  return { doc, listeners };
};

describe('UpdateWatch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks nothing until started (dev, tests)', async () => {
    const { w, load } = watch(() => ({ build: 'def456', builtAt: 2_000 }));
    expect(await w.check(true)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('finds a newer build, tells every listener once, and stops asking', async () => {
    fakeDom();
    const { w, load } = watch(() => ({ build: 'def456', builtAt: 2_000 }));
    const heard: BuildInfo[] = [];
    w.onAvailable((b) => heard.push(b));
    w.start();
    expect(await w.check()).toBe(true);
    expect(w.latest).toEqual({ build: 'def456', builtAt: 2_000 });
    expect(heard).toEqual([{ build: 'def456', builtAt: 2_000 }]);
    expect(w.running).toBe(false);
    expect(await w.check(true)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(heard).toHaveLength(1);
    // Someone listening late hears straight away.
    const late = vi.fn();
    w.onAvailable(late);
    expect(late).toHaveBeenCalledWith({ build: 'def456', builtAt: 2_000 });
  });

  it('spaces asks out unless forced, and shares one ask in flight', async () => {
    fakeDom();
    const { w, load, later } = watch(() => OWN);
    w.start();
    const [a, b] = [w.check(), w.check()];
    expect(await a).toBe(false);
    expect(await b).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await w.check()).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    later(31_000);
    await w.check();
    expect(load).toHaveBeenCalledTimes(2);
    await w.check(true);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('treats a failed ask (offline, no version.json yet) as a no and tries again later', async () => {
    fakeDom();
    let fail = true;
    const { w, later } = watch(() => {
      if (fail) throw new Error('offline');
      return { build: 'def456', builtAt: 2_000 };
    });
    w.start();
    expect(await w.check()).toBe(false);
    fail = false;
    later(31_000);
    expect(await w.check()).toBe(true);
  });

  it('asks every few minutes while in view, and when the tab comes back or the network does', async () => {
    vi.useFakeTimers();
    const { doc, listeners } = fakeDom();
    const { w, load, later } = watch(() => OWN);
    w.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    // Hidden: the timer does not ask.
    doc.hidden = true;
    later(60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    doc.hidden = false;
    listeners.document.get('visibilitychange')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    later(60_000);
    listeners.window.get('online')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    w.stop();
    expect(listeners.document.size + listeners.window.size).toBe(0);
  });

  it('reloads by itself at most once per build in a tab', () => {
    const session = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) });
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const { w } = watch(() => OWN);
    expect(w.reloadOnce()).toBe(false); // nothing newer yet
    w.accept({ build: 'def456', builtAt: 2_000 });
    expect(w.reloadOnce()).toBe(true);
    expect(w.reloadOnce()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // A later build is worth one more.
    const next = new UpdateWatch({ build: 'def456', builtAt: 2_000 }, './version.json', async () => ({}));
    next.accept({ build: 'fed789', builtAt: 3_000 });
    expect(next.reloadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('will not reload by itself without session storage to remember it in', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('blocked');
      },
    });
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const { w } = watch(() => OWN);
    w.accept({ build: 'def456', builtAt: 2_000 });
    expect(w.reloadOnce()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
