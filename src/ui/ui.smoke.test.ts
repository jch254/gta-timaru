import { beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import type { Action, District, GameContext, GameEvents, MissionSummary, SettingsData, System, UiApi } from '../core/types';
import { UpdateWatch } from '../core/update';

/**
 * Smoke test for the whole UI against a tiny stand-in DOM and a fake game: builds it, runs frames, pushes
 * every kind of message through it, and walks the pause screen with the keyboard actions. There is no
 * rendering here; the point is that nothing throws and the pause / menu / pointer-lock bookkeeping is right.
 */

// ───────────── A just-enough DOM ─────────────

type Listener = (event: Record<string, unknown>) => void;

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  width = 0;
  height = 0;
  scrollTop = 0;
  clientHeight = 400;
  style: Record<string, unknown> & { setProperty(name: string, value: string): void } = {
    setProperty(name: string, value: string) {
      this[name] = value;
    },
  };
  private classes = new Set<string>();
  private listeners = new Map<string, Listener[]>();
  classList = {
    add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
    contains: (name: string) => this.classes.has(name),
  };

  constructor(readonly tag: string) {}

  get className() {
    return [...this.classes].join(' ');
  }
  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  emit(type: string, event: Record<string, unknown> = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, button: 0, clientX: 50, clientY: 5, pointerId: 1, deltaY: -100, deltaMode: 0, ...event });
  }
  getContext() {
    return fakeContext;
  }
  setPointerCapture() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 10 };
  }
  /** First descendant carrying a class. */
  find(name: string): FakeElement | null {
    for (const child of this.children) {
      if (child.classList.contains(name)) return child;
      const hit = child.find(name);
      if (hit) return hit;
    }
    return null;
  }
  findAll(name: string, out: FakeElement[] = []): FakeElement[] {
    for (const child of this.children) {
      if (child.classList.contains(name)) out.push(child);
      child.findAll(name, out);
    }
    return out;
  }
  /** Displayed, as far as the UI's own display toggles go. */
  get text(): string {
    return this.textContent + this.children.map((c) => c.text).join(' ');
  }
}

// A 2D context where every method is a no-op and every property can be set.
const fakeContext: unknown = new Proxy(
  {},
  {
    get(target: Record<string, unknown>, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 7 });
      if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      return () => undefined;
    },
    set(target: Record<string, unknown>, key: string, value: unknown) {
      target[key] = value;
      return true;
    },
  },
);

const body = new FakeElement('body');
const documentListeners = new Map<string, Listener[]>();
const fakeDocument = {
  body,
  pointerLockElement: null as unknown,
  createElement: (tag: string) => new FakeElement(tag),
  addEventListener: (type: string, fn: Listener) => documentListeners.set(type, [...(documentListeners.get(type) ?? []), fn]),
  removeEventListener: () => undefined,
  exitPointerLock() {
    fakeDocument.pointerLockElement = null;
  },
};
let reloads = 0;

// ───────────── A fake game ─────────────

const PLAINS: District = { id: 'plains', name: 'Canterbury Plains', city: null, type: 'rural' };
const CENTRAL: District = { id: 'cbd', name: 'Central City', city: 'christchurch', type: 'cbd' };

function sampleLine(ax: number, az: number, bx: number, bz: number) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 4));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: ax + ((bx - ax) * i) / n, y: 0, z: az + ((bz - az) * i) / n, tx: (bx - ax) / len, tz: (bz - az) / len, s: (len * i) / n }));
}

function makeGame() {
  const events = new EventBus<GameEvents>();
  const hits = new Set<Action>();
  const held = new Set<Action>();
  const calls = { capture: 0, release: 0, saves: 0, sounds: 0 };
  const settingsData: SettingsData = { quality: 'high', dynamicResolution: true, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, liveRadio: true, mouseSensitivity: 1, invertY: false, showFps: true };
  const missions: MissionSummary[] = [
    { id: 'm1', title: 'A Favour for Rena', giver: 'Aunty Rena', blurb: 'Fetch the ute from Smithfield.', reward: 300, state: 'done', placeId: 'timaru-chipshop' },
    { id: 'm2', title: 'North on One', giver: 'Dazza', blurb: 'Run a wagon up to Christchurch.', reward: 800, state: 'available', placeId: 'chch-garage' },
    { id: 'm3', title: 'Later', giver: 'Dazza', blurb: 'Not yet.', reward: 0, state: 'locked', placeId: 'nowhere' },
  ];
  const position = { x: 10, y: 0, z: -20 };
  const vehicle = { spec: { name: 'Holbrook Statesman', health: 100 }, speed: 0, health: 100, burning: false, position };
  const places = [
    { id: 'timaru-chipshop', name: 'Chip Shop', x: 300, z: 800, heading: 0, city: 'timaru' as const, tags: ['safehouse', 'mission'] },
    { id: 'chch-garage', name: 'Workshop', x: -200, z: -700, heading: 0, city: 'christchurch' as const, tags: ['safehouse', 'mission'], teReo: 'Test' },
    { id: 'chch-hospital', name: 'Christchurch Hospital', x: -300, z: -500, heading: 0, city: 'christchurch' as const, tags: ['hospital'] },
    { id: 'spawn', name: 'Spawn', x: 0, z: 0, heading: 0, city: null, tags: ['spawn'] },
  ];
  const input = {
    hits,
    heldSet: held,
    held: (a: Action) => held.has(a),
    pressed: (a: Action) => hits.has(a),
    moveX: 0,
    moveZ: 0,
    throttle: 0,
    brake: 0,
    lookYaw: 0,
    lookPitch: 0,
    captured: false,
    capture() {
      calls.capture++;
    },
    release() {
      calls.release++;
    },
    label(a: Action) {
      return this.gamepadActive && a === 'jump' ? 'A' : a.slice(0, 1).toUpperCase();
    },
    gamepadActive: false,
  };
  const ctx = {
    events,
    input,
    settings: {
      data: settingsData,
      set<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
        settingsData[key] = value;
      },
      onChange: () => () => undefined,
    },
    clock: { hour: 9.5, day: 1, elapsed: 0, secondsPerHour: 60, paused: false, advanceHours() {} },
    gfx: { fps: 60, frameMs: 16.6, quality: 'high', stats: { drawCalls: 300, triangles: 512345, renderScale: 0.9 }, renderer: { domElement: new FakeElement('canvas') } },
    world: {
      bounds: { minX: -1024, maxX: 1024, minZ: -1024, maxZ: 1024 },
      graph: {
        edges: [
          { cls: 'street', tunnel: false, samples: sampleLine(-400, 0, 400, 0) },
          { cls: 'highway', tunnel: false, samples: sampleLine(0, -900, 0, 900) },
          { cls: 'gravel', tunnel: true, samples: sampleLine(500, 500, 700, 700) },
        ],
      },
      railways: [
        { name: 'Main South Line', kind: 'main', length: 800, points: sampleLine(-400, 100, 400, 100) },
        { name: 'Tram', kind: 'tram', length: 200, points: sampleLine(-100, -50, 100, -50) },
      ],
      places,
      landmarks: [{ kind: 'x', name: 'Port Hills', x: 100, z: 100, heading: 0, clearRadius: 10 }],
      waterDepthAt: (x: number) => (x > 800 ? 4 : 0),
      districtAt: (x: number, z: number) => (Math.abs(x) < 300 && Math.abs(z) < 300 ? CENTRAL : PLAINS),
      locationName: () => 'Colombo Street',
    },
    player: { position, heading: 1, cameraHeading: 2, health: 80, maxHealth: 100, armour: 25, money: 0, alive: true, aiming: false, vehicle: null as unknown },
    combat: {
      current: { id: 'fists', name: 'Fists', kind: 'fists' },
      ammo: () => ({ clip: 7, reserve: 42 }),
    },
    police: { level: 0, heat: 0, evading: 0 },
    missions: { list: () => missions, active: null as MissionSummary | null },
    audio: {
      play() {
        calls.sounds++;
      },
      radio: { stations: [{ id: 'kea', name: 'Kea FM', blurb: 'Classic hits' }], current: null },
    },
    save: {
      exists: () => false,
      save() {
        calls.saves++;
        return { ok: true };
      },
    },
  };
  return { ctx: ctx as unknown as GameContext, raw: ctx, events, input, hits, held, calls, settingsData, vehicle, position };
}

type Ui = UiApi & System;
let createUi: (ctx: GameContext, updates?: UpdateWatch) => Ui;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.document = fakeDocument;
  g.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 2, innerWidth: 1280, innerHeight: 720 };
  g.getComputedStyle = () => ({ fontSize: '16px' });
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
  };
  g.location = {
    reload() {
      reloads++;
    },
  };
  ({ createUi } = await import('./index'));
});

function setup(updates?: UpdateWatch) {
  body.children = [];
  const game = makeGame();
  const ui = createUi(game.ctx, updates);
  (game.ctx as { ui: UiApi }).ui = ui;
  void ui.init?.();
  const root = body.children[0];
  /** One frame: `press` are edge presses for this frame only. */
  const frame = (press: Action[] = [], dt = 1 / 60) => {
    for (const a of press) game.hits.add(a);
    ui.lateUpdate?.(dt);
    game.hits.clear();
  };
  const frames = (n: number, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) frame([], dt);
  };
  return { ...game, ui, root, frame, frames };
}

describe('UI smoke test', () => {
  it('builds, runs frames and shows the basics', () => {
    const { root, frames, raw } = setup();
    expect(root.classList.contains('nw-ui')).toBe(true);
    frames(5);
    expect(root.find('nw-money-value')!.textContent).toBe('NZ$0');
    expect(root.find('nw-clock-time')!.textContent).toBe('9:30 am');
    expect(root.find('nw-clock-day')!.textContent).toBe('Fri');
    expect(root.find('nw-weapon-name')!.textContent).toBe('Fists');
    expect(root.find('nw-ammo')!.classList.contains('on')).toBe(false);
    expect(root.find('nw-fps')!.textContent).toContain('60 fps');
    expect(root.find('nw-fps')!.textContent).toContain('512k tris');
    expect(root.find('nw-mini-canvas')!.width).toBeGreaterThan(100);
    expect(root.find('nw-heat')!.classList.contains('on')).toBe(false);
    expect(root.find('nw-vital')!.find('nw-vital-fill')!.style.transform).toBe('scaleX(0.8)');

    // A gun: ammo appears. Heat: lamps light. Aiming: crosshair.
    raw.combat.current = { id: 'pistol', name: 'Pistol', kind: 'pistol' };
    raw.police.level = 3;
    raw.police.evading = 4;
    raw.player.aiming = true;
    frames(10);
    expect(root.find('nw-ammo')!.classList.contains('on')).toBe(true);
    expect(root.find('nw-ammo-clip')!.textContent).toBe('7');
    expect(root.find('nw-ammo-reserve')!.textContent).toBe('42');
    expect(root.findAll('nw-lamp').filter((l) => l.classList.contains('lit'))).toHaveLength(3);
    expect(root.find('nw-heat')!.classList.contains('evading')).toBe(true);
    expect(root.find('nw-cross')!.classList.contains('on')).toBe(true);
  });

  it('shows the prompt only on frames that ask for it, with a keycap', () => {
    const { ui, root, frame } = setup();
    const prompt = root.find('nw-prompt')!;
    ui.prompt('F  Nick the ute');
    frame();
    expect(prompt.classList.contains('on')).toBe(true);
    expect(prompt.find('nw-cap')!.textContent).toBe('F');
    expect(prompt.find('nw-prompt-text')!.textContent).toBe('Nick the ute');
    frame();
    expect(prompt.classList.contains('on')).toBe(false);
  });

  it('handles objective, timer, subtitles, banner, toasts, blips and events', async () => {
    const { ui, root, frame, frames, events, raw, vehicle, ctx } = setup();
    ui.objective('Get to the chip shop');
    ui.timer('Time left', 75);
    frame();
    expect(root.find('nw-obj')!.classList.contains('on')).toBe(true);
    expect(root.find('nw-timer-value')!.textContent).toBe('1:15');
    frames(60);
    expect(root.find('nw-timer-value')!.textContent).toBe('1:14');
    ui.timer('Sheep: 3 of 10');
    frame();
    expect(root.find('nw-timer')!.classList.contains('counts')).toBe(false);
    ui.timer(null);
    ui.objective(null);
    frame();
    expect(root.find('nw-obj')!.classList.contains('on')).toBe(false);
    expect(root.find('nw-timer')!.classList.contains('on')).toBe(false);

    ui.subtitle('Kia ora, e hoa.', 1, 'Rena');
    ui.subtitle('Got a job for you.', 1);
    frame();
    const sub = root.find('nw-sub')!;
    expect(sub.classList.contains('on')).toBe(true);
    expect(sub.find('nw-sub-who')!.textContent).toBe('Rena');
    expect(sub.find('nw-sub-text')!.textContent).toBe('Kia ora, e hoa.');
    frames(70);
    expect(sub.find('nw-sub-text')!.textContent).toBe('Got a job for you.');
    frames(70);
    expect(sub.classList.contains('on')).toBe(false);

    ui.banner('North on One', 'A job for Dazza', 1, 'good');
    frame();
    const banner = root.find('nw-banner')!;
    expect(banner.classList.contains('on')).toBe(true);
    expect(banner.classList.contains('tone-good')).toBe(true);
    frames(70);
    expect(banner.classList.contains('on')).toBe(false);

    ui.toast('Picked up a cricket bat', 1);
    ui.toast('Picked up a cricket bat', 1);
    expect(root.findAll('nw-toast').filter((t) => t.classList.contains('on'))).toHaveLength(1);
    frames(70);
    expect(root.findAll('nw-toast').filter((t) => t.classList.contains('on'))).toHaveLength(0);

    ui.setBlip({ id: 'a', kind: 'objective', x: 500, z: 500, pinned: true, label: 'Drop-off' });
    ui.setBlip({ id: 'b', kind: 'enemy', x: 0, z: 0, follow: { position: { x: 20, y: 0, z: 30 } } as never });
    ui.setBlip({ id: 'a', kind: 'objective', x: 600, z: 500, pinned: true });
    frames(3);
    ui.removeBlip('a');
    ui.removeBlip('missing');
    frames(3);

    // Events from other systems.
    events.emit('zoneChanged', { name: 'Colombo Street', city: 'christchurch' });
    expect(root.find('nw-loc')!.classList.contains('on')).toBe(true);
    expect(root.find('nw-loc-title')!.textContent).toBe('Colombo Street');
    expect(root.find('nw-loc-sub')!.textContent).toBe('Central City · Christchurch · Ōtautahi');
    raw.player.vehicle = vehicle;
    events.emit('vehicleEntered', { actor: ctx.player, vehicle: vehicle as never, stolen: true, ejected: null });
    vehicle.speed = 27.78;
    vehicle.health = 20;
    frames(30);
    expect(root.find('nw-veh')!.textContent).toBe('Holbrook Statesman');
    expect(root.find('nw-drive')!.classList.contains('on')).toBe(true);
    expect(root.find('nw-plate-digits')!.textContent).toBe('100');
    expect(root.find('nw-cond-word')!.textContent).toBe('Munted');
    events.emit('radioChanged', { stationId: 'kea', name: 'Kea FM' });
    expect(root.find('nw-radio-blurb')!.textContent).toBe('Classic hits');
    events.emit('radioChanged', { stationId: null, name: '' });
    expect(root.find('nw-radio-name')!.textContent).toBe('Radio off');

    raw.player.money = 1250;
    events.emit('moneyChanged', { money: 1250, delta: 1250 });
    expect(root.find('nw-money-delta')!.textContent).toBe('+$1,250');
    frames(120);
    expect(root.find('nw-money-value')!.textContent).toBe('NZ$1,250');

    events.emit('actorDamaged', { actor: ctx.player, info: { amount: 30, kind: 'bullet' } });
    events.emit('gunshot', { shooter: ctx.player, weaponId: 'pistol', position: {} as never, direction: {} as never });
    events.emit('impact', { position: { x: 60, y: 1, z: 60 } as never, normal: {} as never, surface: 'flesh' });
    frame();
    expect(root.find('nw-hurt')!.classList.contains('pulse-a')).toBe(true);
    expect(root.find('nw-hit')!.classList.contains('tick-a')).toBe(true);
    events.emit('playerDied', { info: { amount: 100, kind: 'bullet' } });
    expect(banner.find('nw-banner-title')!.textContent).toBe('Carked it');
    expect(banner.classList.contains('tone-bad')).toBe(true);

    await ui.fade(true, 0.01);
    expect(root.find('nw-fade')!.style.opacity).toBe('1');
    await ui.fade(false, 0);
    expect(root.find('nw-fade')!.style.opacity).toBe('0');
  });

  it('runs the choice dialog from the keyboard and the mouse', async () => {
    const { ui, root, frame, calls, input } = setup();
    frame();
    const picked = ui.choose('Sports & Guns', 'What will it be?', ['Pistol', 'Shotgun', 'Nothing today']);
    expect(ui.menuOpen).toBe(true);
    expect(calls.release).toBe(1);
    // The press that opened it is not also taken as a choice.
    frame(['interact']);
    expect(root.find('nw-choose')!.classList.contains('on')).toBe(true);
    input.moveZ = -1;
    frame();
    input.moveZ = 0;
    frame();
    frame(['interact']);
    expect(await picked).toBe(1);
    expect(ui.menuOpen).toBe(false);
    expect(calls.capture).toBe(1);

    const cancelled = ui.choose('Again', '', ['One', 'Two']);
    frame();
    frame(['pause']);
    expect(await cancelled).toBe(-1);

    const clicked = ui.choose('Mouse', '', ['One', 'Two', 'Three']);
    frame();
    root.findAll('nw-option')[2].emit('click');
    expect(await clicked).toBe(2);
    expect(ui.menuOpen).toBe(false);
  });

  it('pauses, walks every screen and resumes', () => {
    const { ui, root, frame, frames, raw, events, calls, settingsData, input, held } = setup();
    const paused: boolean[] = [];
    events.on('pausedChanged', ({ paused: p }) => paused.push(p));
    frames(3);
    frame(['pause']);
    expect(raw.clock.paused).toBe(true);
    expect(ui.menuOpen).toBe(true);
    expect(paused).toEqual([true]);
    expect(root.classList.contains('nw-paused')).toBe(true);
    const pause = root.find('nw-pause')!;
    expect(pause.classList.contains('on')).toBe(true);
    const posts = root.findAll('nw-post');
    expect(posts.map((p) => p.text.trim())).toEqual(['Resume', 'Map', 'Jobs', 'Controls', 'Settings', 'Save game', 'New version', 'Quit to title']);
    // New version stays out of sight (and out of the walk) until a newer build is deployed.
    expect(posts[6].style.display).toBe('none');
    expect(posts[0].classList.contains('sel')).toBe(true);
    expect(pause.find('nw-pause-status')!.textContent).toContain('Friday 9:30 am');

    const down = () => {
      input.moveZ = -1;
      frame();
      input.moveZ = 0;
      frame();
    };
    // Map: opens, pans, zooms, centres, backs out to the menu.
    down();
    expect(posts[1].classList.contains('sel')).toBe(true);
    frame(['interact']);
    expect(pause.classList.contains('map')).toBe(true);
    input.moveX = 1;
    held.add('nextWeapon');
    frames(10);
    input.moveX = 0;
    held.clear();
    const mapCanvas = root.find('nw-map-canvas')!;
    mapCanvas.emit('pointerdown');
    mapCanvas.emit('pointermove', { clientX: 90, clientY: 40 });
    mapCanvas.emit('pointerup');
    mapCanvas.emit('wheel');
    frame(['interact']);
    frames(40); // lets the land survey finish and the labels appear
    frame(['pause']);
    expect(pause.classList.contains('map')).toBe(false);
    expect(raw.clock.paused).toBe(true);

    // Jobs: listed with state, giver and pay; Enter shows the job on the map.
    down();
    const jobs = root.findAll('nw-job');
    expect(jobs).toHaveLength(3);
    expect(jobs[1].text).toContain('North on One');
    expect(jobs[1].text).toContain('For Dazza');
    expect(jobs[1].text).toContain('Pays NZ$800');
    expect(jobs[1].text).toContain('Workshop · Test');
    expect(jobs[0].find('nw-stamp')!.textContent).toBe('Done');
    frame(['interact']);
    expect(root.find('nw-panel')!.classList.contains('focus')).toBe(true);
    expect(jobs[1].classList.contains('sel')).toBe(true);
    frame(['interact']);
    expect(pause.classList.contains('map')).toBe(true);
    frame(['pause']);
    frame(['pause']); // out of the sheet, back to the posts
    expect(root.find('nw-panel')!.classList.contains('focus')).toBe(false);

    // Controls: a table built from input.label().
    down();
    expect(root.findAll('nw-ctl-row').length).toBeGreaterThan(15);
    expect(root.find('nw-pane-controls')!.text).toContain('Left stick');

    // Settings: step in, change things with the arrows.
    down();
    frame(['interact']);
    const rows = root.findAll('nw-set');
    expect(rows).toHaveLength(9);
    expect(rows[0].classList.contains('sel')).toBe(true);
    expect(rows[0].findAll('nw-chip').map((c) => c.classList.contains('on'))).toEqual([false, false, true, false]);
    const right = () => {
      input.moveX = -1;
      frame();
      input.moveX = 0;
      frame();
    };
    const left = () => {
      input.moveX = 1;
      frame();
      input.moveX = 0;
      frame();
    };
    right();
    expect(settingsData.quality).toBe('ultra');
    right();
    expect(settingsData.quality).toBe('ultra');
    left();
    left();
    expect(settingsData.quality).toBe('medium');
    down();
    left();
    expect(settingsData.dynamicResolution).toBe(false);
    frame(['interact']);
    expect(settingsData.dynamicResolution).toBe(true);
    down();
    left();
    expect(settingsData.masterVolume).toBeCloseTo(0.75);
    expect(rows[2].find('nw-slide-value')!.textContent).toBe('75%');
    // Mouse on a slider track: half way along.
    rows[3].find('nw-slide-track')!.emit('pointerdown', { clientX: 50 });
    expect(settingsData.musicVolume).toBeCloseTo(0.5);
    rows[5].findAll('nw-chip')[0].emit('click');
    expect(settingsData.liveRadio).toBe(false);
    rows[8].findAll('nw-chip')[0].emit('click');
    expect(settingsData.showFps).toBe(false);
    frame(['pause']);
    expect(raw.clock.paused).toBe(true);

    // Save, then quit (which asks twice).
    down();
    frame(['interact']);
    expect(calls.saves).toBe(1);
    expect(root.findAll('nw-toast').some((t) => t.classList.contains('on') && t.textContent === 'Game saved')).toBe(true);
    down();
    frame(['interact']);
    expect(reloads).toBe(0);
    expect(posts[7].text).toContain('Sure?');
    frame(['interact']);
    expect(reloads).toBe(1);

    // Esc at the posts resumes.
    frame(['pause']);
    expect(raw.clock.paused).toBe(false);
    expect(ui.menuOpen).toBe(false);
    expect(paused).toEqual([true, false]);
    expect(root.classList.contains('nw-paused')).toBe(false);
    expect(calls.capture).toBeGreaterThan(0);
  });

  it('opens the map directly and toggles it shut with the same key', () => {
    const { ui, root, frame, frames, raw } = setup();
    frames(2);
    frame(['map']);
    expect(raw.clock.paused).toBe(true);
    expect(root.find('nw-pause')!.classList.contains('map')).toBe(true);
    frames(5);
    frame(['map']);
    expect(raw.clock.paused).toBe(false);
    expect(ui.menuOpen).toBe(false);
    // Esc from a directly-opened map also goes straight back to the game.
    frame(['map']);
    frame();
    frame(['pause']);
    expect(raw.clock.paused).toBe(false);
  });

  it('pauses when pointer lock is lost and asks for a click before carrying on after a bare Esc', () => {
    const { ui, root, frame, frames, raw, calls } = setup();
    frames(2);
    const lockChange = () => documentListeners.get('pointerlockchange')!.forEach((fn) => fn({}));
    fakeDocument.pointerLockElement = {};
    lockChange();
    fakeDocument.pointerLockElement = null;
    lockChange();
    expect(raw.clock.paused).toBe(true);
    expect(ui.menuOpen).toBe(true);
    // The same Esc arriving as a key press straight away must not close the menu again.
    frame(['pause']);
    expect(root.find('nw-pause')!.classList.contains('on')).toBe(true);

    // A later Esc closes the menu but holds the game for a click (the browser will not re-lock on Esc).
    const realNow = performance.now;
    try {
      const base = realNow.call(performance);
      performance.now = () => base + 1000;
      frame(['pause']);
    } finally {
      performance.now = realNow;
    }
    expect(root.find('nw-pause')!.classList.contains('on')).toBe(false);
    expect(root.find('nw-shield')!.classList.contains('on')).toBe(true);
    expect(raw.clock.paused).toBe(true);
    expect(ui.menuOpen).toBe(true);
    const before = calls.capture;
    root.find('nw-shield')!.emit('mousedown');
    expect(root.find('nw-shield')!.classList.contains('on')).toBe(false);
    expect(raw.clock.paused).toBe(false);
    expect(ui.menuOpen).toBe(false);
    expect(calls.capture).toBe(before + 1);
  });

  it('offers a newer build: one toast in free roam, then a pause post that saves and reloads', () => {
    const watch = new UpdateWatch({ build: 'old', builtAt: 1 }, 'version.json');
    const { root, frame, frames, raw, calls } = setup(watch);
    frames(2);
    const posts = root.findAll('nw-post');
    const update = posts[6];
    expect(update.text.trim()).toBe('New version');
    const toasted = () => root.findAll('nw-toast').filter((t) => t.classList.contains('on')).map((t) => t.textContent);
    const job: MissionSummary = { id: 'm2', title: 'North on One', giver: 'Dazza', blurb: '', reward: 800, state: 'active', placeId: 'chch-garage' };

    // Out mid-job: the post appears, but the toast waits for the job to finish.
    raw.missions.active = job;
    expect(watch.accept({ build: 'new', builtAt: 2 })).toBe(true);
    frames(3);
    expect(update.style.display).toBe('');
    expect(toasted()).toEqual([]);
    raw.missions.active = null;
    frame();
    expect(toasted()).toEqual(['A new version of 03 Quest is out. Pause to get it.']);
    frames(600);
    expect(toasted()).toEqual([]); // said once only

    // The pause screen: a line on the first sheet, and the post now in the walk between Save game and Quit.
    raw.missions.active = job;
    frame(['pause']);
    expect(root.find('nw-pane-resume')!.text).toContain('A new version of 03 Quest is out');
    const down = () => {
      raw.input.moveZ = -1;
      frame();
      raw.input.moveZ = 0;
      frame();
    };
    for (let i = 0; i < 6; i++) down();
    expect(update.classList.contains('sel')).toBe(true);
    expect(root.find('nw-pane-update')!.text).toContain('North on One, will have to be started again');

    // Asks twice, like Quit; moving off an armed post puts its label back.
    const saves = calls.saves;
    const reloaded = reloads;
    frame(['interact']);
    expect(update.text).toContain('Sure?');
    down();
    expect(posts[7].classList.contains('sel')).toBe(true);
    expect(update.text.trim()).toBe('New version');
    raw.input.moveZ = 1;
    frame();
    raw.input.moveZ = 0;
    frame();
    expect(update.classList.contains('sel')).toBe(true);
    frame(['interact']);
    expect(update.text).toContain('Sure?');
    expect(calls.saves).toBe(saves);
    expect(reloads).toBe(reloaded);
    // A failed write cancels the reload and leaves the update available to retry.
    const save = raw.save.save;
    raw.save.save = () => ({ ok: false, message: 'No space' });
    frame(['interact']);
    expect(reloads).toBe(reloaded);
    expect(root.find('nw-pane-update')!.text).toContain('No space');
    raw.save.save = save;
    frame(['interact']);
    frame(['interact']);
    expect(calls.saves).toBe(saves + 1);
    expect(reloads).toBe(reloaded + 1);
  });

  it('leaves un-pausing to whoever paused the game first', () => {
    const { frame, raw, events } = setup();
    const seen: boolean[] = [];
    events.on('pausedChanged', ({ paused }) => seen.push(paused));
    raw.clock.paused = true;
    frame(['pause']);
    frame(['pause']);
    expect(raw.clock.paused).toBe(true);
    expect(seen).toEqual([]);
  });

  it('tolerates stub systems', () => {
    const game = makeGame();
    body.children = [];
    game.raw.missions.list = () => [];
    game.raw.audio.radio.stations = [];
    game.raw.combat.ammo = () => ({ clip: 0, reserve: 0 });
    game.raw.world.places = [];
    game.raw.world.landmarks = [];
    game.raw.world.railways = [];
    const ui = createUi(game.ctx);
    void ui.init?.();
    for (let i = 0; i < 5; i++) ui.lateUpdate?.(1 / 60);
    game.hits.add('pause');
    ui.lateUpdate?.(1 / 60);
    game.hits.clear();
    game.input.moveZ = -1;
    for (let i = 0; i < 3; i++) {
      ui.lateUpdate?.(1 / 60);
      game.input.moveZ = game.input.moveZ ? 0 : -1;
    }
    expect(body.children[0].find('nw-pane-jobs')?.text ?? '').toContain('Nothing on the books');
    game.events.emit('radioChanged', { stationId: 'gone', name: '' });
    ui.dispose?.();
    expect(body.children).toHaveLength(0);
  });
});
