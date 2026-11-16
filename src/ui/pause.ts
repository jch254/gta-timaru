import type { Action, Blip, GameContext, MissionSummary, QualityLevel, SettingsData } from '../core/types';
import { el, Flag, hint, TextCache, touchOn } from './dom';
import { bilingual, cityName, cityTeReo, formatClock, formatMoney, weekdayName } from './format';
import { FullMap } from './fullmap';
import type { MapData } from './mapdata';
import type { StaticMarker } from './minimap';
import type { MenuNav } from './nav';

type ItemId = 'resume' | 'map' | 'jobs' | 'controls' | 'settings' | 'save' | 'quit';

const ITEMS: { id: ItemId; label: string }[] = [
  { id: 'resume', label: 'Resume' },
  { id: 'map', label: 'Map' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'controls', label: 'Controls' },
  { id: 'settings', label: 'Settings' },
  { id: 'save', label: 'Save game' },
  { id: 'quit', label: 'Quit to title' },
];

const PANEL_TITLES: Record<ItemId, string> = {
  resume: 'Where things stand',
  map: 'The island',
  jobs: 'Jobs',
  controls: 'Controls',
  settings: 'Settings',
  save: 'Save game',
  quit: 'Quit to title',
};

/** Panels you can step into with the keyboard / pad. */
const FOCUSABLE: Partial<Record<ItemId, boolean>> = { jobs: true, controls: true, settings: true };

interface ControlRow {
  label: string;
  /** Bindings come from `input.label(action)`. */
  actions?: Action[];
  /** Fixed text instead (mouse, sticks, triggers). */
  key?: string[];
  pad?: string[];
}

const CONTROLS: { title: string; rows: ControlRow[] }[] = [
  {
    title: 'On foot',
    rows: [
      { label: 'Walk', actions: ['forward', 'left', 'back', 'right'], pad: ['Left stick'] },
      { label: 'Look around', key: ['Mouse'], pad: ['Right stick'] },
      { label: 'Run', actions: ['sprint'] },
      { label: 'Jump', actions: ['jump'] },
      { label: 'Get in, talk, use', actions: ['interact'] },
      { label: 'Aim', actions: ['aim'] },
      { label: 'Fire, or throw a punch', actions: ['fire'] },
      { label: 'Reload', actions: ['reload'] },
      { label: 'Quick whack', actions: ['melee'] },
      { label: 'Next / previous weapon', actions: ['nextWeapon', 'prevWeapon'] },
    ],
  },
  {
    title: 'Behind the wheel',
    rows: [
      { label: 'Accelerate / brake and reverse', actions: ['forward', 'back'], pad: ['RT', 'LT'] },
      { label: 'Steer', actions: ['left', 'right'], pad: ['Left stick'] },
      { label: 'Handbrake', actions: ['handbrake'] },
      { label: 'Horn', actions: ['horn'] },
      { label: 'Radio: next / previous station', actions: ['radioNext', 'radioPrev'] },
      { label: 'Look behind', actions: ['lookBack'] },
      { label: 'Get out', actions: ['interact'] },
    ],
  },
  {
    title: 'Any time',
    rows: [
      { label: 'Camera distance', actions: ['camera'] },
      { label: 'Island map', actions: ['map'] },
      { label: 'Skip a line of talk', actions: ['skip'] },
      { label: 'Pause', actions: ['pause'] },
    ],
  },
];

/** The on-screen controller (src/touch), in the words printed on its buttons. */
const TOUCH_CONTROLS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'On the screen: on foot',
    rows: [
      [['Left thumb'], 'Walk, anywhere on the left; push to the rim to run'],
      [['Drag'], 'Look around, anywhere on the right'],
      [['Punch', 'Swing', 'Fire'], 'Hit or shoot; hold to keep going'],
      [['Jump'], 'Jump'],
      [['Use'], 'Get in, talk, pick up: shows when there is something to use'],
      [['Aim', 'Reload', 'Weapon'], 'With a firearm: aim (tap on, tap off), reload, change weapon'],
    ],
  },
  {
    title: 'On the screen: behind the wheel',
    rows: [
      [['Left thumb'], 'Steer'],
      [['Go', 'Brake'], 'Pedals; slide a thumb between them'],
      [['Hand brake', 'Out'], 'Handbrake; get out'],
      [['Horn', 'Radio', 'Behind'], 'Horn, next station, look behind'],
    ],
  },
  {
    title: 'On the screen: any time',
    rows: [
      [['II', 'Map', 'View'], 'Top-left: pause, island map, camera distance'],
      [['Skip'], 'Skip a line of talk'],
    ],
  },
];

interface SettingRow {
  key: keyof SettingsData;
  node: HTMLDivElement;
  /** Discrete choices (also used for on / off). */
  values?: (string | boolean)[];
  chips?: HTMLDivElement[];
  /** Slider. */
  min?: number;
  max?: number;
  step?: number;
  fill?: HTMLDivElement;
  valueText?: TextCache;
  format?: (value: number) => string;
}

const QUALITY: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const percent = (v: number) => `${Math.round(v * 100)}%`;

const STATE_STAMP: Record<MissionSummary['state'], string> = {
  locked: 'Not yet',
  available: 'Going',
  active: 'On the go',
  done: 'Done',
};

export interface PauseHost {
  ctx: GameContext;
  /**
   * Close the pause screen. `gesture` says whether this came from a click or a confirm key, which lets the
   * browser re-lock the pointer straight away (it will not after a bare Esc).
   */
  resume(gesture: boolean): void;
  toast(text: string, seconds?: number): void;
  sound(id: 'uiMove' | 'uiSelect'): void;
}

/**
 * The pause screen: a stack of yellow fingerposts on the left, a ledger sheet on the right that previews
 * whatever is highlighted (and can be stepped into for Jobs, Controls and Settings), and the island map.
 */
export class PauseMenu {
  isOpen = false;
  readonly map: FullMap;

  private root: HTMLDivElement;
  private shown: Flag;
  private mapOn: Flag;
  private posts: HTMLDivElement[] = [];
  private postLabels: TextCache[] = [];
  private index = -1;
  private focus: 'menu' | 'panel' = 'menu';
  private screen: 'main' | 'map' = 'main';
  private mapDirect = false;
  private panel: HTMLDivElement;
  private panelFocus: Flag;
  private panelTitle: TextCache;
  private scroll: HTMLDivElement;
  private panes: Partial<Record<ItemId, HTMLDivElement>> = {};
  private pane: ItemId | null = null;
  private status: TextCache;
  private foot: HTMLDivElement;
  private footKey = '';
  private quitArmed = false;
  private savedNote = '';
  private openedAt = 0;
  private lockLoss = false;

  private settings: SettingRow[] = [];
  private settingIndex = 0;
  private jobs: MissionSummary[] = [];
  private jobRows: HTMLDivElement[] = [];
  private jobIndex = 0;

  constructor(
    parent: HTMLElement,
    private host: PauseHost,
    data: MapData,
    blips: readonly Blip[],
    markers: readonly StaticMarker[],
  ) {
    this.root = el('div', 'nw-pause', parent);
    this.shown = new Flag(this.root, 'on');
    this.mapOn = new Flag(this.root, 'map');

    const main = el('div', 'nw-pause-main', this.root);
    const head = el('div', 'nw-pause-head', main);
    el('div', 'nw-pause-kicker', head, 'Paused');
    el('div', 'nw-pause-title', head, 'Timmaz Hard');
    this.status = new TextCache(el('div', 'nw-pause-status', head));

    const body = el('div', 'nw-pause-body', main);
    const menu = el('div', 'nw-menu', body);
    ITEMS.forEach((item, i) => {
      const post = el('div', 'nw-post', menu);
      this.postLabels.push(new TextCache(el('span', 'nw-post-text', post)));
      this.postLabels[i].set(item.label);
      post.addEventListener('pointerenter', () => {
        if (this.screen !== 'main') return;
        this.setFocus('menu');
        this.select(i, false);
      });
      post.addEventListener('click', () => {
        if (this.screen !== 'main') return;
        this.setFocus('menu');
        this.select(i, false);
        this.activate();
      });
      this.posts.push(post);
    });

    this.panel = el('div', 'nw-panel nw-ledger', body);
    this.panelFocus = new Flag(this.panel, 'focus');
    this.panelTitle = new TextCache(el('div', 'nw-panel-title', this.panel));
    this.scroll = el('div', 'nw-panel-scroll', this.panel);
    this.panel.addEventListener('pointerdown', () => {
      if (this.pane && FOCUSABLE[this.pane]) this.setFocus('panel');
    });

    this.foot = el('div', 'nw-pause-foot', main);
    this.map = new FullMap(this.root, host.ctx, data, blips, markers);
  }

  // ───────────── Open / close ─────────────

  open(screen: 'menu' | 'map', lockLoss: boolean) {
    this.isOpen = true;
    this.openedAt = performance.now();
    this.lockLoss = lockLoss;
    this.quitArmed = false;
    this.postLabels[ITEMS.length - 1].set(ITEMS[ITEMS.length - 1].label);
    this.refreshStatus();
    this.shown.set(true);
    this.focus = 'menu';
    this.panelFocus.set(false);
    for (const post of this.posts) post.classList.remove('sel');
    this.index = -1;
    this.select(0, false);
    // Always refill the first sheet: the clock, place and cash have moved on since last time.
    this.showPane(ITEMS[0].id, true);
    if (screen === 'map') {
      this.mapDirect = true;
      this.showMap();
    } else {
      this.mapDirect = false;
      this.screen = 'main';
      this.mapOn.set(false);
    }
  }

  close() {
    this.isOpen = false;
    this.shown.set(false);
    this.map.close();
    this.mapOn.set(false);
    this.screen = 'main';
  }

  private showMap(focus?: { x: number; z: number }) {
    this.screen = 'map';
    this.mapOn.set(true);
    this.map.open(focus);
  }

  private closeMap() {
    this.map.close();
    this.screen = 'main';
    this.mapOn.set(false);
    this.mapDirect = false;
  }

  private refreshStatus() {
    const { clock, player, world } = this.host.ctx;
    if (!clock || !player) return;
    const p = player.position;
    const district = world.districtAt(p.x, p.z);
    this.status.set(`${weekdayName(clock.day)} ${formatClock(clock.hour)}  ·  ${world.locationName(p.x, p.z)}, ${bilingual(cityName(district.city), cityTeReo(district.city))}`);
  }

  // ───────────── Selection ─────────────

  private select(index: number, sound: boolean) {
    if (index === this.index) return;
    this.posts[this.index]?.classList.remove('sel');
    this.index = index;
    this.posts[index].classList.add('sel');
    if (ITEMS[index].id !== 'quit' && this.quitArmed) {
      this.quitArmed = false;
      this.postLabels[ITEMS.length - 1].set(ITEMS[ITEMS.length - 1].label);
    }
    this.showPane(ITEMS[index].id);
    if (sound) this.host.sound('uiMove');
  }

  private setFocus(focus: 'menu' | 'panel') {
    if (focus === this.focus) return;
    this.focus = focus;
    this.panelFocus.set(focus === 'panel');
    if (focus === 'panel') {
      if (this.pane === 'settings') this.selectSetting(this.settingIndex);
      if (this.pane === 'jobs') this.selectJob(this.jobIndex, false);
    }
  }

  private activate() {
    const id = ITEMS[this.index].id;
    const { ctx } = this.host;
    this.host.sound('uiSelect');
    switch (id) {
      case 'resume':
        this.host.resume(true);
        break;
      case 'map':
        this.mapDirect = false;
        this.showMap();
        break;
      case 'jobs':
      case 'controls':
      case 'settings':
        if (id !== 'jobs' || this.jobs.length > 0) this.setFocus('panel');
        break;
      case 'save': {
        ctx.save.save();
        this.savedNote = `Saved ${weekdayName(ctx.clock.day)} ${formatClock(ctx.clock.hour)}.`;
        this.host.toast('Game saved');
        this.showPane('save', true);
        break;
      }
      case 'quit':
        if (!this.quitArmed) {
          this.quitArmed = true;
          this.postLabels[this.index].set('Sure? Press again');
        } else {
          location.reload();
        }
        break;
    }
  }

  // ───────────── Panes ─────────────

  private showPane(id: ItemId, force = false) {
    if (id === this.pane && !force) return;
    if (this.pane && this.pane !== id) this.panes[this.pane]!.style.display = 'none';
    this.pane = id;
    this.panelTitle.set(PANEL_TITLES[id]);
    let pane = this.panes[id];
    if (!pane) {
      pane = this.panes[id] = el('div', `nw-pane nw-pane-${id}`, this.scroll);
      if (id === 'settings') this.buildSettings(pane);
      if (id === 'controls') this.buildControls(pane);
    }
    pane.style.display = '';
    this.scroll.scrollTop = 0;
    switch (id) {
      case 'resume':
        this.fillStatus(pane);
        break;
      case 'map':
        this.fillText(pane, [
          'The whole of the island, Christchurch to Timaru, as it stood in 1995.',
          touchOn() ? 'Tap MAP, top-left, at any time to unfold it without stopping here first.' : `Press ${this.host.ctx.input.label('map')} at any time to unfold it without stopping here first.`,
        ]);
        break;
      case 'jobs':
        this.fillJobs(pane);
        break;
      case 'settings':
        this.refreshSettings();
        break;
      case 'save':
        this.fillText(pane, ['Writes your progress to this browser: cash, kit, jobs done and where you are standing.', this.savedNote || (this.host.ctx.save.exists() ? 'There is a save on file. Saving again replaces it.' : 'Nothing saved yet.')]);
        break;
      case 'quit':
        this.fillText(pane, ['Back to the title screen.', 'Anything since your last save is gone for good, so save first if it matters.']);
        break;
      case 'controls':
        break;
    }
  }

  private fillText(pane: HTMLElement, lines: string[]) {
    pane.textContent = '';
    for (const line of lines) el('p', 'nw-para', pane, line);
  }

  private fillStatus(pane: HTMLElement) {
    const { ctx } = this.host;
    pane.textContent = '';
    const { clock, player, world, police, missions } = ctx;
    if (!player || !clock) return;
    const p = player.position;
    const district = world.districtAt(p.x, p.z);
    const street = world.locationName(p.x, p.z);
    const town = bilingual(cityName(district.city), cityTeReo(district.city));
    const level = Math.round(police?.level ?? 0);
    const active = missions?.active ?? null;
    const rows: [string, string][] = [
      ['Day', `${weekdayName(clock.day)}, ${formatClock(clock.hour)} (day ${clock.day})`],
      ['Where', street === district.name ? `${street}, ${town}` : `${street}, ${district.name}, ${town}`],
      ['Cash', formatMoney(player.money)],
      ['Heat', level <= 0 ? 'Nobody is looking for you' : `${level} of 5 lamps lit`],
      ['On the go', active ? active.title : 'Nothing at the moment'],
    ];
    for (const [key, value] of rows) {
      const row = el('div', 'nw-kv', pane);
      el('span', 'nw-kv-key', row, key);
      el('span', 'nw-kv-value', row, value);
    }
  }

  private fillJobs(pane: HTMLElement) {
    const { ctx } = this.host;
    pane.textContent = '';
    this.jobRows.length = 0;
    this.jobs = ctx.missions?.list() ?? [];
    this.jobIndex = 0;
    if (this.jobs.length === 0) {
      el('p', 'nw-para', pane, 'Nothing on the books yet.');
      el('p', 'nw-para', pane, 'Ask around. Aunty Rena usually knows who is hiring.');
      return;
    }
    this.jobs.forEach((job, i) => {
      const row = el('div', `nw-job state-${job.state}`, pane);
      const top = el('div', 'nw-job-top', row);
      el('span', 'nw-job-title', top, job.title);
      el('span', 'nw-stamp', top, STATE_STAMP[job.state] ?? job.state);
      if (job.giver) el('div', 'nw-job-giver', row, `For ${job.giver}`);
      if (job.blurb) el('div', 'nw-job-blurb', row, job.blurb);
      const place = ctx.world.places.find((q) => q.id === job.placeId);
      const foot = el('div', 'nw-job-foot', row);
      el('span', 'nw-job-pay', foot, job.reward > 0 ? `Pays ${formatMoney(job.reward)}` : 'No pay in it');
      if (place) el('span', 'nw-job-place', foot, `Start: ${bilingual(place.name, place.teReo)}`);
      row.addEventListener('pointerenter', () => this.selectJob(i, false));
      row.addEventListener('click', () => {
        this.selectJob(i, false);
        this.openJob();
      });
      this.jobRows.push(row);
    });
    // Start on the job in hand, else the first one going.
    const start = this.jobs.findIndex((j) => j.state === 'active');
    const going = this.jobs.findIndex((j) => j.state === 'available');
    this.jobIndex = start >= 0 ? start : Math.max(0, going);
    if (this.focus === 'panel') this.selectJob(this.jobIndex, false);
  }

  private selectJob(index: number, scroll: boolean) {
    if (this.jobRows.length === 0) return;
    const next = Math.max(0, Math.min(this.jobRows.length - 1, index));
    this.jobRows[this.jobIndex]?.classList.remove('sel');
    this.jobIndex = next;
    this.jobRows[next].classList.add('sel');
    if (scroll) this.jobRows[next].scrollIntoView({ block: 'nearest' });
  }

  /** Shows where the selected job starts on the island map. */
  private openJob() {
    const job = this.jobs[this.jobIndex];
    if (!job) return;
    const place = this.host.ctx.world.places.find((q) => q.id === job.placeId);
    if (!place) return;
    this.host.sound('uiSelect');
    this.mapDirect = false;
    this.showMap({ x: place.x, z: place.z });
  }

  private bindings(actions: Action[], pad: boolean): string[] {
    const input = this.host.ctx.input;
    const was = input.gamepadActive;
    const out: string[] = [];
    try {
      for (const action of actions) {
        input.gamepadActive = false;
        const key = input.label(action);
        if (pad) {
          input.gamepadActive = true;
          const button = input.label(action);
          // No pad button: label() falls back to the key, which tells us there is nothing to show.
          if (button !== key && !out.includes(button)) out.push(button);
        } else if (!out.includes(key)) out.push(key);
      }
    } finally {
      input.gamepadActive = was;
    }
    return out;
  }

  private buildControls(pane: HTMLElement) {
    // The on-screen controller first, shown only while it is in use (see .nw-if-touch in ui.css).
    const touch = el('div', 'nw-ctl-touch nw-if-touch', pane);
    for (const group of TOUCH_CONTROLS) {
      el('div', 'nw-ctl-group', touch, group.title);
      for (const [buttons, what] of group.rows) {
        const row = el('div', 'nw-touch-row', touch);
        const keys = el('span', 'nw-ctl-keys', row);
        for (const button of buttons) el('kbd', 'nw-cap pad', keys, button);
        el('span', 'nw-ctl-label', row, what);
      }
    }
    el('p', 'nw-para nw-note', touch, 'In menus: tap to choose; Back, top-right, goes back. A keyboard or a gamepad still works:');
    const header = el('div', 'nw-ctl-row nw-ctl-head', pane);
    el('span', 'nw-ctl-label', header, '');
    el('span', 'nw-ctl-keys', header, 'Keyboard & mouse');
    el('span', 'nw-ctl-keys', header, 'Gamepad');
    for (const group of CONTROLS) {
      el('div', 'nw-ctl-group', pane, group.title);
      for (const spec of group.rows) {
        const row = el('div', 'nw-ctl-row', pane);
        el('span', 'nw-ctl-label', row, spec.label);
        const keys = el('span', 'nw-ctl-keys', row);
        for (const key of spec.key ?? this.bindings(spec.actions ?? [], false)) el('kbd', 'nw-cap', keys, key);
        const pad = el('span', 'nw-ctl-keys', row);
        const buttons = spec.pad ?? this.bindings(spec.actions ?? [], true);
        if (buttons.length === 0) el('span', 'nw-ctl-none', pad, '—');
        for (const button of buttons) el('kbd', 'nw-cap pad', pad, button);
      }
    }
    el('p', 'nw-para nw-note nw-if-keys', pane, 'In menus: arrows or the left stick to move, Enter or A to choose, Esc or B to go back.');
  }

  // ───────────── Settings ─────────────

  private buildSettings(pane: HTMLElement) {
    const choice = (key: keyof SettingsData, label: string, values: (string | boolean)[], names: string[], note?: string) => {
      const node = el('div', 'nw-set', pane);
      const text = el('div', 'nw-set-label', node, label);
      if (note) el('div', 'nw-set-note', text, note);
      const control = el('div', 'nw-chips', node);
      const row: SettingRow = { key, node, values, chips: [] };
      const at = this.settings.length;
      values.forEach((value, i) => {
        const chip = el('div', 'nw-chip', control, names[i]);
        chip.addEventListener('click', () => {
          this.pickSetting(at);
          this.apply(row, value);
        });
        row.chips!.push(chip);
      });
      node.addEventListener('pointerenter', () => this.pickSetting(at));
      this.settings.push(row);
    };
    const slider = (key: keyof SettingsData, label: string, min: number, max: number, step: number, format: (v: number) => string) => {
      const node = el('div', 'nw-set', pane);
      el('div', 'nw-set-label', node, label);
      const control = el('div', 'nw-slide', node);
      const track = el('div', 'nw-slide-track', control);
      const fill = el('div', 'nw-slide-fill', track);
      const valueText = new TextCache(el('div', 'nw-slide-value', control));
      const row: SettingRow = { key, node, min, max, step, fill, valueText, format };
      const at = this.settings.length;
      const setFrom = (clientX: number) => {
        const rect = track.getBoundingClientRect();
        const t = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
        this.apply(row, snap(min + t * (max - min), min, max, step));
      };
      let dragging = false;
      track.addEventListener('pointerdown', (e) => {
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        this.pickSetting(at);
        setFrom(e.clientX);
      });
      track.addEventListener('pointermove', (e) => {
        if (dragging) setFrom(e.clientX);
      });
      const stop = () => {
        dragging = false;
      };
      track.addEventListener('pointerup', stop);
      track.addEventListener('pointercancel', stop);
      node.addEventListener('pointerenter', () => this.pickSetting(at));
      this.settings.push(row);
    };

    // Headed groups, so the eye can jump straight to picture, sound or controls. (The rows keep their order.)
    const group = (title: string) => el('div', 'nw-set-group', pane, title);
    group('Picture');
    choice('quality', 'Picture quality', QUALITY, ['Low', 'Medium', 'High', 'Ultra']);
    choice('dynamicResolution', 'Dynamic resolution', [false, true], ['Off', 'On'], 'Eases the render scale to hold 60 frames a second');
    group('Sound');
    slider('masterVolume', 'Master volume', 0, 1, 0.05, percent);
    slider('musicVolume', 'Radio and music', 0, 1, 0.05, percent);
    slider('sfxVolume', 'Effects', 0, 1, 0.05, percent);
    choice('liveRadio', 'Live radio stations', [false, true], ['Off', 'On'], 'Real stations in cars, streamed from their own servers. Off keeps the game offline');
    group('Controls');
    slider('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.1, (v) => `${v.toFixed(1)}×`);
    choice('invertY', 'Invert look up / down', [false, true], ['Off', 'On']);
    group('Extras');
    choice('showFps', 'Show frame rate', [false, true], ['Off', 'On'], 'Frames, frame time, draw calls, triangles, render scale');
  }

  private pickSetting(index: number) {
    if (this.pane !== 'settings') return;
    this.setFocus('panel');
    this.selectSetting(index);
  }

  private selectSetting(index: number) {
    if (this.settings.length === 0) return;
    const next = Math.max(0, Math.min(this.settings.length - 1, index));
    this.settings[this.settingIndex]?.node.classList.remove('sel');
    this.settingIndex = next;
    this.settings[next].node.classList.add('sel');
  }

  private apply(row: SettingRow, value: string | boolean | number) {
    this.host.ctx.settings.set(row.key, value as never);
    this.refreshSettings();
  }

  /** Brings every control in line with the stored settings (cheap; only touches what changed). */
  refreshSettings() {
    const data = this.host.ctx.settings.data;
    for (const row of this.settings) {
      const value = data[row.key];
      if (row.chips && row.values) {
        for (let i = 0; i < row.chips.length; i++) row.chips[i].classList.toggle('on', row.values[i] === value);
      } else if (row.fill && row.valueText && typeof value === 'number') {
        const t = Math.min(1, Math.max(0, (value - row.min!) / (row.max! - row.min!)));
        row.fill.style.transform = `scaleX(${t.toFixed(3)})`;
        row.valueText.set(row.format!(value));
      }
    }
  }

  private nudgeSetting(direction: number) {
    const row = this.settings[this.settingIndex];
    if (!row) return;
    const value = this.host.ctx.settings.data[row.key];
    if (row.values) {
      const at = row.values.indexOf(value as string | boolean);
      // Choices step through in order and stop at the ends; for a switch, right is on.
      const next = Math.max(0, Math.min(row.values.length - 1, at + direction));
      if (next !== at) {
        this.apply(row, row.values[next]);
        this.host.sound('uiMove');
      }
    } else if (typeof value === 'number') {
      const next = snap(value + direction * row.step!, row.min!, row.max!, row.step!);
      if (next !== value) {
        this.apply(row, next);
        this.host.sound('uiMove');
      }
    }
  }

  private cycleSetting() {
    const row = this.settings[this.settingIndex];
    if (!row?.values) return;
    const value = this.host.ctx.settings.data[row.key];
    const at = row.values.indexOf(value as string | boolean);
    this.apply(row, row.values[(at + 1) % row.values.length]);
    this.host.sound('uiSelect');
  }

  // ───────────── Per frame ─────────────

  layout(cssW: number, cssH: number, dpr: number, fontPx: number) {
    this.map.layout(cssW, cssH, dpr, fontPx);
  }

  private hints(pad: boolean) {
    const key = `${this.focus}|${this.pane}|${pad ? 1 : 0}`;
    if (key === this.footKey) return;
    this.footKey = key;
    const foot = this.foot;
    foot.textContent = '';
    const choose = pad ? ['A'] : ['Enter'];
    const back = pad ? ['B'] : ['Esc'];
    if (this.focus === 'menu') {
      hint(foot, ['↑', '↓'], 'Choose');
      hint(foot, choose, 'Select');
      hint(foot, back, 'Resume');
    } else if (this.pane === 'settings') {
      hint(foot, ['↑', '↓'], 'Choose');
      hint(foot, ['←', '→'], 'Change');
      hint(foot, back, 'Back');
    } else if (this.pane === 'jobs') {
      hint(foot, ['↑', '↓'], 'Choose');
      hint(foot, choose, 'Show on the map');
      hint(foot, back, 'Back');
    } else {
      hint(foot, ['↑', '↓'], 'Scroll');
      hint(foot, back, 'Back');
    }
  }

  update(nav: MenuNav, dt: number) {
    if (!this.isOpen) return;
    const input = this.host.ctx.input;
    if (this.screen === 'map') {
      const result = this.map.update(nav, dt);
      if (result === 'resume') this.host.resume(true);
      else if (result === 'back' && this.mapDirect) this.host.resume(false);
      else if (result === 'back') this.closeMap();
      return;
    }
    this.hints(input.gamepadActive);
    if (input.pressed('map')) {
      this.mapDirect = false;
      this.showMap();
      return;
    }
    if (nav.back) {
      // The Esc that dropped pointer lock can also arrive as a key press: it must not close the menu it opened.
      if (this.lockLoss && performance.now() - this.openedAt < 350) return;
      if (this.focus === 'panel') this.setFocus('menu');
      else this.host.resume(false);
      return;
    }
    if (this.focus === 'menu') {
      const n = ITEMS.length;
      if (nav.up) this.select((this.index + n - 1) % n, true);
      else if (nav.down) this.select((this.index + 1) % n, true);
      else if (nav.confirm) this.activate();
      else if (nav.right && FOCUSABLE[ITEMS[this.index].id]) this.activate();
      return;
    }
    // Inside the sheet.
    if (this.pane === 'settings') {
      if (nav.up || nav.down) {
        const n = this.settings.length;
        this.selectSetting((this.settingIndex + (nav.down ? 1 : n - 1)) % n);
        this.settings[this.settingIndex].node.scrollIntoView({ block: 'nearest' });
        this.host.sound('uiMove');
      } else if (nav.left) this.nudgeSetting(-1);
      else if (nav.right) this.nudgeSetting(1);
      else if (nav.confirm) this.cycleSetting();
    } else if (this.pane === 'jobs') {
      if (nav.up || nav.down) {
        const n = this.jobRows.length;
        if (n > 0) {
          this.selectJob((this.jobIndex + (nav.down ? 1 : n - 1)) % n, true);
          this.host.sound('uiMove');
        }
      } else if (nav.confirm) this.openJob();
      else if (nav.left) this.setFocus('menu');
    } else {
      if (nav.up) this.scroll.scrollTop -= this.scroll.clientHeight * 0.25;
      else if (nav.down) this.scroll.scrollTop += this.scroll.clientHeight * 0.25;
      else if (nav.left) this.setFocus('menu');
    }
  }
}

function snap(value: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  // Round away float dust so 0.30000000000000004 is stored as 0.3.
  return Math.min(max, Math.max(min, Math.round(stepped * 1000) / 1000));
}
