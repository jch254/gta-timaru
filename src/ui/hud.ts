import { clamp01, damp } from '../core/math';
import type { GameContext } from '../core/types';
import { el, Flag, Retrigger, TextCache } from './dom';
import { TEXT_FONT } from './type';
import { compactCount, conditionWord, formatClock, formatDelta, formatMoney, formatTimer, minuteOfDay, parsePrompt, plateDigits, toKmh, weekdayName } from './format';

const LAMPS = 5;
/** Speedometer dial: 0 km/h at -120°, DIAL_MAX km/h at +120° (clockwise from straight up). */
const DIAL_MAX = 220;
const DIAL_SWEEP = 240;
/** Dial diameter in em (see .nw-dial in ui.css). */
export const DIAL_EM = 8.4;
const MAX_CAPS = 3;
const CONDITION_SEGMENTS = 5;

/**
 * The in-play HUD. Built once; every frame `update` compares the game state with what is on screen and only
 * writes the DOM where something changed.
 */
export class Hud {
  readonly root: HTMLDivElement;

  // Perf readout.
  private fpsOn: Flag;
  private fpsText: TextCache;
  private fpsTimer = 0;

  // Location sign.
  private locOn: Flag;
  private locTitle: TextCache;
  private locSub: TextCache;
  private locTeReo: TextCache;
  private locHasSub: Flag;
  private locHasTeReo: Flag;
  private locTime = 0;

  // Objective fingerpost + timer plate.
  private objOn: Flag;
  private objText: TextCache;
  private objFlash: Retrigger;
  private timerOn: Flag;
  private timerLabel: TextCache;
  private timerValue: TextCache;
  private timerCounts: Flag;
  private timerUrgent: Flag;
  private timerLeft = -1;
  private timerShown = -1;

  // Status: heat lamps, clock, money.
  private heat: HTMLDivElement;
  private heatOn: Flag;
  private heatEvading: Flag;
  private lamps: HTMLDivElement[] = [];
  private level = -1;
  private heatStep = -1;
  private dayText: TextCache;
  private clockText: TextCache;
  private minute = -1;
  private day = -1;
  private moneyText: TextCache;
  private moneyTick: Flag;
  private moneyShown = Number.NaN;
  private deltaText: TextCache;
  private deltaOn: Flag;
  private deltaLoss: Flag;
  private deltaSum = 0;
  private deltaTime = 0;

  // Driving cluster.
  private driveOn: Flag;
  private dial: HTMLCanvasElement;
  private dialPx = 0;
  private needle: HTMLDivElement;
  private needleDeg = -DIAL_SWEEP / 2;
  private needleShown = Number.NaN;
  private plateText: TextCache;
  private kmh = -1;
  private segments: HTMLDivElement[] = [];
  private condText: TextCache;
  private condRough: Flag;
  private condBad: Flag;
  private condition = -99;
  private vehOn: Flag;
  private vehText: TextCache;
  private vehTime = 0;
  private radioOn: Flag;
  private radioName: TextCache;
  private radioBlurb: TextCache;
  private radioTime = 0;

  // Weapon and vitals.
  private weaponName: TextCache;
  private weaponUnarmed: Flag;
  private ammoOn: Flag;
  private ammoEmpty: Flag;
  private clipText: TextCache;
  private reserveText: TextCache;
  private weaponId = '';
  private showAmmo = false;
  private clip = -1;
  private reserve = -1;
  private ammoTimer = 0;
  private healthFill: HTMLDivElement;
  private healthLow: Flag;
  private health = -1;
  private armourFill: HTMLDivElement;
  private armourOn: Flag;
  private armour = -1;

  // Centre of screen.
  private crossOn: Flag;
  private hitTick: Retrigger;
  private hurt: HTMLDivElement;
  private hurtPulse: Retrigger;
  private hurtLevel = -1;

  // Prompt.
  private promptOn: Flag;
  private caps: TextCache[] = [];
  private capOn: Flag[] = [];
  private promptText: TextCache;
  private promptNext: string | null = null;
  private promptShown: string | null = null;

  constructor(parent: HTMLElement) {
    const root = (this.root = el('div', 'nw-hud nw-layer', parent));

    // Damage vignette sits under everything else in the HUD.
    this.hurt = el('div', 'nw-hurt', root);
    this.hurtPulse = new Retrigger(this.hurt, 'pulse-a', 'pulse-b');

    const fps = el('div', 'nw-fps', root);
    this.fpsOn = new Flag(fps, 'on');
    this.fpsText = new TextCache(fps);

    const loc = el('div', 'nw-loc', root);
    this.locOn = new Flag(loc, 'on');
    this.locTitle = new TextCache(el('div', 'nw-loc-title', loc));
    this.locSub = new TextCache(el('div', 'nw-loc-sub', loc));
    this.locTeReo = new TextCache(el('div', 'nw-loc-reo', loc));
    this.locHasSub = new Flag(loc, 'has-sub');
    this.locHasTeReo = new Flag(loc, 'has-reo');

    const top = el('div', 'nw-top', root);
    const timer = el('div', 'nw-timer', top);
    this.timerOn = new Flag(timer, 'on');
    this.timerCounts = new Flag(timer, 'counts');
    this.timerUrgent = new Flag(timer, 'urgent');
    this.timerLabel = new TextCache(el('div', 'nw-timer-label', timer));
    this.timerValue = new TextCache(el('div', 'nw-timer-value', timer));
    const obj = el('div', 'nw-obj', top);
    this.objOn = new Flag(obj, 'on');
    const post = el('div', 'nw-obj-post', obj);
    this.objText = new TextCache(el('span', 'nw-obj-text', post));
    this.objFlash = new Retrigger(obj, 'flash-a', 'flash-b');

    const status = el('div', 'nw-status', root);
    const statusRow = el('div', 'nw-status-row', status);
    this.heat = el('div', 'nw-heat', statusRow);
    this.heatOn = new Flag(this.heat, 'on');
    this.heatEvading = new Flag(this.heat, 'evading');
    for (let i = 0; i < LAMPS; i++) this.lamps.push(el('div', i % 2 === 0 ? 'nw-lamp red' : 'nw-lamp blue', this.heat));
    const clock = el('div', 'nw-clock', statusRow);
    this.dayText = new TextCache(el('span', 'nw-clock-day', clock));
    this.clockText = new TextCache(el('span', 'nw-clock-time', clock));
    const money = el('div', 'nw-money', status);
    this.moneyText = new TextCache(el('span', 'nw-money-value', money));
    this.moneyTick = new Flag(money, 'tick');
    const delta = el('div', 'nw-money-delta', status);
    this.deltaText = new TextCache(delta);
    this.deltaOn = new Flag(delta, 'on');
    this.deltaLoss = new Flag(delta, 'loss');

    // Bottom-right column, top to bottom: radio, vehicle name, dial, weapon, vitals.
    const corner = el('div', 'nw-corner', root);
    const radio = el('div', 'nw-radio', corner);
    this.radioOn = new Flag(radio, 'on');
    el('span', 'nw-radio-led', radio);
    const radioWords = el('span', 'nw-radio-words', radio);
    this.radioName = new TextCache(el('span', 'nw-radio-name', radioWords));
    this.radioBlurb = new TextCache(el('span', 'nw-radio-blurb', radioWords));
    const veh = el('div', 'nw-veh', corner);
    this.vehOn = new Flag(veh, 'on');
    this.vehText = new TextCache(veh);

    const drive = el('div', 'nw-drive', corner);
    this.driveOn = new Flag(drive, 'on');
    const cond = el('div', 'nw-cond', drive);
    this.condRough = new Flag(cond, 'rough');
    this.condBad = new Flag(cond, 'bad');
    this.condText = new TextCache(el('div', 'nw-cond-word', cond));
    const segs = el('div', 'nw-cond-segs', cond);
    for (let i = 0; i < CONDITION_SEGMENTS; i++) this.segments.push(el('div', 'nw-cond-seg', segs));
    const dialWrap = el('div', 'nw-dial', drive);
    this.dial = el('canvas', 'nw-dial-face', dialWrap);
    this.needle = el('div', 'nw-needle', dialWrap);
    el('div', 'nw-dial-hub', dialWrap);
    const plate = el('div', 'nw-plate', dialWrap);
    this.plateText = new TextCache(el('span', 'nw-plate-digits', plate));
    el('span', 'nw-plate-unit', plate, 'km/h');

    // Weapon and vitals share one pane.
    const kit = el('div', 'nw-kit', corner);
    const weapon = el('div', 'nw-weapon', kit);
    this.weaponUnarmed = new Flag(weapon, 'unarmed');
    this.weaponName = new TextCache(el('span', 'nw-weapon-name', weapon));
    const ammo = el('span', 'nw-ammo', weapon);
    this.ammoOn = new Flag(ammo, 'on');
    this.ammoEmpty = new Flag(ammo, 'empty');
    this.clipText = new TextCache(el('span', 'nw-ammo-clip', ammo));
    el('span', 'nw-ammo-slash', ammo, '/');
    this.reserveText = new TextCache(el('span', 'nw-ammo-reserve', ammo));

    const vitals = el('div', 'nw-vitals', kit);
    const healthRow = el('div', 'nw-vital health', vitals);
    this.healthLow = new Flag(healthRow, 'low');
    el('span', 'nw-vital-icon', healthRow);
    this.healthFill = el('div', 'nw-vital-fill', el('div', 'nw-vital-bar', healthRow));
    const armourRow = el('div', 'nw-vital armour', vitals);
    this.armourOn = new Flag(armourRow, 'on');
    el('span', 'nw-vital-icon', armourRow);
    this.armourFill = el('div', 'nw-vital-fill', el('div', 'nw-vital-bar', armourRow));

    const cross = el('div', 'nw-cross', root);
    this.crossOn = new Flag(cross, 'on');
    el('i', 'nw-cross-dot', cross);
    el('i', 'nw-cross-tick n', cross);
    el('i', 'nw-cross-tick e', cross);
    el('i', 'nw-cross-tick s', cross);
    el('i', 'nw-cross-tick w', cross);
    const hit = el('div', 'nw-hit', root);
    el('i', 'nw-hit-a', hit);
    el('i', 'nw-hit-b', hit);
    this.hitTick = new Retrigger(hit, 'tick-a', 'tick-b');

    const prompt = el('div', 'nw-prompt', root);
    this.promptOn = new Flag(prompt, 'on');
    for (let i = 0; i < MAX_CAPS; i++) {
      const cap = el('kbd', 'nw-cap', prompt);
      this.caps.push(new TextCache(cap));
      this.capOn.push(new Flag(cap, 'on'));
    }
    this.promptText = new TextCache(el('span', 'nw-prompt-text', prompt));
  }

  // ───────────── Things other systems push ─────────────

  /** Contextual prompt for this frame (cleared automatically unless set again next frame). */
  prompt(text: string | null) {
    this.promptNext = text;
  }

  objective(text: string | null) {
    const value = (text ?? '').trim();
    if (!value) {
      this.objOn.set(false);
      return;
    }
    const changed = !this.objOn.on || this.objText.node.textContent !== value;
    this.objText.set(value);
    this.objOn.set(true);
    if (changed) this.objFlash.fire();
  }

  /** `seconds` given: a countdown shown as m:ss. Omitted: the label alone (a counter the caller words itself). */
  timer(label: string | null, seconds?: number) {
    if (label === null || label === undefined) {
      this.timerOn.set(false);
      this.timerLeft = -1;
      return;
    }
    this.timerLabel.set(label);
    this.timerOn.set(true);
    if (seconds === undefined || !Number.isFinite(seconds)) {
      this.timerLeft = -1;
      this.timerCounts.set(false);
      this.timerUrgent.set(false);
    } else {
      this.timerLeft = Math.max(0, seconds);
      this.timerCounts.set(true);
    }
  }

  location(title: string, sub: string, teReo: string) {
    this.locTitle.set(title);
    this.locSub.set(sub);
    this.locTeReo.set(teReo);
    this.locHasSub.set(sub.length > 0);
    this.locHasTeReo.set(teReo.length > 0);
    this.locOn.set(true);
    this.locTime = 5.5;
  }

  vehicle(name: string) {
    this.vehText.set(name);
    this.vehOn.set(true);
    this.vehTime = 4.5;
  }

  radio(name: string, blurb: string) {
    this.radioName.set(name);
    this.radioBlurb.set(blurb);
    this.radioOn.set(true);
    this.radioTime = 4;
  }

  moneyChanged(delta: number) {
    if (!delta) return;
    // Changes in quick succession add up into one figure.
    this.deltaSum = this.deltaTime > 0 ? this.deltaSum + delta : delta;
    this.deltaText.set(formatDelta(this.deltaSum));
    this.deltaLoss.set(this.deltaSum < 0);
    this.deltaOn.set(true);
    this.deltaTime = 2.2;
  }

  /** Ask for a fresh ammo read next frame (after a shot, a reload, a pickup). */
  ammoChanged() {
    this.ammoTimer = 0;
  }

  /** Red vignette pulse: `strength` 0..1 from how hard the hit was. */
  hurtPulseNow(strength: number) {
    const level = Math.round(clamp01(strength) * 4);
    if (level !== this.hurtLevel) {
      this.hurtLevel = level;
      this.hurt.style.setProperty('--nw-hurt', String(0.35 + level * 0.15));
    }
    this.hurtPulse.fire();
  }

  /** The little tick round the crosshair when a shot lands on somebody. */
  hitMarker() {
    this.hitTick.fire();
  }

  // ───────────── Layout ─────────────

  /** Repaints the speedometer face for the current text size. */
  layout(fontPx: number, dpr: number) {
    const px = Math.max(48, Math.round(DIAL_EM * fontPx * dpr));
    if (px === this.dialPx) return;
    this.dialPx = px;
    this.dial.width = this.dial.height = px;
    const g = this.dial.getContext('2d');
    if (g) paintDial(g, px);
  }

  // ───────────── Per frame ─────────────

  update(ctx: GameContext, dt: number, paused: boolean) {
    const { player, combat, police, clock, gfx, settings } = ctx;
    const live = paused ? 0 : dt;

    // Prompt: shown only on frames where somebody asked for it.
    const prompt = this.promptNext;
    this.promptNext = null;
    if (prompt !== this.promptShown) {
      this.promptShown = prompt;
      if (prompt) {
        const parsed = parsePrompt(prompt);
        for (let i = 0; i < MAX_CAPS; i++) {
          const key = parsed.keys[i];
          this.capOn[i].set(key !== undefined);
          if (key !== undefined) this.caps[i].set(key);
        }
        this.promptText.set(parsed.text);
      }
      this.promptOn.set(!!prompt);
    }

    // Timed pieces.
    if (this.locTime > 0 && (this.locTime -= live) <= 0) this.locOn.set(false);
    if (this.vehTime > 0 && (this.vehTime -= live) <= 0) this.vehOn.set(false);
    if (this.radioTime > 0 && (this.radioTime -= live) <= 0) this.radioOn.set(false);
    if (this.deltaTime > 0 && (this.deltaTime -= live) <= 0) this.deltaOn.set(false);
    if (this.timerLeft >= 0) {
      this.timerLeft = Math.max(0, this.timerLeft - live);
      const whole = Math.ceil(this.timerLeft - 1e-6);
      if (whole !== this.timerShown) {
        this.timerShown = whole;
        this.timerValue.set(formatTimer(this.timerLeft));
        this.timerUrgent.set(whole <= 10);
      }
    }

    // Perf readout, four times a second.
    const showFps = !!settings?.data.showFps && !!gfx;
    this.fpsOn.set(showFps);
    if (showFps && (this.fpsTimer -= dt) <= 0) {
      this.fpsTimer = 0.25;
      const s = gfx.stats;
      const at = player?.position;
      this.fpsText.set(
        `${gfx.fps.toFixed(0)} fps  ${gfx.frameMs.toFixed(1)} ms\n${s.drawCalls} calls  ${compactCount(s.triangles)} tris\nscale ${s.renderScale.toFixed(2)}  ${gfx.quality}` +
          (at ? `\n${at.x.toFixed(0)}, ${at.y.toFixed(1)}, ${at.z.toFixed(0)}` : ''),
      );
    }

    // Clock (a game minute is a real second, so this writes about once a second).
    if (clock) {
      const minute = minuteOfDay(clock.hour);
      if (minute !== this.minute) {
        this.minute = minute;
        this.clockText.set(formatClock(clock.hour));
      }
      if (clock.day !== this.day) {
        this.day = clock.day;
        this.dayText.set(weekdayName(clock.day, true));
      }
    }

    // Heat lamps.
    if (police) {
      const level = Math.max(0, Math.min(LAMPS, Math.round(police.level || 0)));
      const step = level < LAMPS ? Math.round(clamp01(police.heat || 0) * 4) : 0;
      if (level !== this.level) {
        this.level = level;
        for (let i = 0; i < LAMPS; i++) {
          this.lamps[i].classList.toggle('lit', i < level);
          this.lamps[i].classList.toggle('next', i === level);
        }
        this.heatOn.set(level > 0);
      }
      if (step !== this.heatStep) {
        this.heatStep = step;
        this.heat.style.setProperty('--nw-warm', String(step * 0.25));
      }
      this.heatEvading.set(level > 0 && police.evading > 0);
    }

    if (!player) return;

    // Money ticks towards the real figure.
    const money = Math.round(player.money || 0);
    if (Number.isNaN(this.moneyShown)) {
      this.moneyShown = money;
      this.moneyText.set(formatMoney(money));
    } else if (this.moneyShown !== money) {
      const gap = money - this.moneyShown;
      const step = Math.max(1, Math.ceil(Math.abs(gap) * Math.min(1, dt * 7)));
      this.moneyShown += Math.sign(gap) * Math.min(Math.abs(gap), step);
      this.moneyText.set(formatMoney(this.moneyShown));
      this.moneyTick.set(this.moneyShown !== money);
    }

    // Vitals: bars move with a transform, so no layout.
    const health = Math.round(clamp01(player.health / (player.maxHealth || 100)) * 200);
    if (health !== this.health) {
      this.health = health;
      this.healthFill.style.transform = `scaleX(${health / 200})`;
      this.healthLow.set(health > 0 && health <= 50);
    }
    const armour = Math.round(clamp01((player.armour || 0) / 100) * 200);
    if (armour !== this.armour) {
      this.armour = armour;
      this.armourFill.style.transform = `scaleX(${armour / 200})`;
      this.armourOn.set(armour > 0);
    }

    // Weapon and ammo.
    const weapon = combat?.current;
    if (weapon) {
      if (weapon.id !== this.weaponId) {
        this.weaponId = weapon.id;
        this.weaponName.set(weapon.name);
        this.showAmmo = weapon.kind !== 'fists' && weapon.kind !== 'melee';
        this.ammoOn.set(this.showAmmo);
        this.weaponUnarmed.set(weapon.kind === 'fists');
        this.ammoTimer = 0;
      }
      if (this.showAmmo && (this.ammoTimer -= dt) <= 0) {
        this.ammoTimer = 0.1;
        const ammo = combat.ammo();
        if (ammo.clip !== this.clip) {
          this.clip = ammo.clip;
          this.clipText.set(String(ammo.clip));
        }
        if (ammo.reserve !== this.reserve) {
          this.reserve = ammo.reserve;
          this.reserveText.set(String(ammo.reserve));
        }
        this.ammoEmpty.set(ammo.clip <= 0);
      }
    }

    this.crossOn.set(!!player.aiming && player.alive);

    // Driving cluster.
    const vehicle = player.vehicle;
    this.driveOn.set(!!vehicle);
    if (vehicle) {
      const kmh = toKmh(vehicle.speed);
      if (kmh !== this.kmh) {
        this.kmh = kmh;
        this.plateText.set(plateDigits(kmh));
      }
      const target = -DIAL_SWEEP / 2 + Math.min(1, (Math.abs(vehicle.speed) * 3.6) / DIAL_MAX) * DIAL_SWEEP;
      this.needleDeg = damp(this.needleDeg, target, 14, dt);
      const shown = Math.round(this.needleDeg * 2) / 2;
      if (shown !== this.needleShown) {
        this.needleShown = shown;
        this.needle.style.transform = `rotate(${shown}deg)`;
      }
      const fraction = clamp01(vehicle.health / (vehicle.spec.health || 100));
      const condition = vehicle.burning ? -1 : Math.ceil(fraction * 20);
      if (condition !== this.condition) {
        this.condition = condition;
        const lit = vehicle.burning ? 0 : Math.ceil(fraction * CONDITION_SEGMENTS);
        for (let i = 0; i < CONDITION_SEGMENTS; i++) this.segments[i].classList.toggle('lit', i < lit);
        this.condText.set(conditionWord(fraction, vehicle.burning));
        this.condRough.set(!vehicle.burning && fraction <= 0.75 && fraction > 0.25);
        this.condBad.set(vehicle.burning || fraction <= 0.25);
      }
    }
  }
}

/** Paints the static speedometer face: black disc, silver rim, white ticks, numbers every 40 km/h. */
function paintDial(g: CanvasRenderingContext2D, px: number) {
  const c = px / 2;
  const r = px / 2 - 1;
  g.clearRect(0, 0, px, px);
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(12, 13, 16, 0.86)';
  g.fill();
  g.lineWidth = Math.max(1.5, px * 0.022);
  g.strokeStyle = '#cfd4d8';
  g.stroke();
  g.beginPath();
  g.arc(c, c, r - px * 0.035, 0, Math.PI * 2);
  g.lineWidth = Math.max(1, px * 0.008);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.stroke();

  g.lineCap = 'butt';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.max(8, Math.round(px * 0.098))}px ${TEXT_FONT}`;
  for (let v = 0; v <= DIAL_MAX; v += 10) {
    // Angle clockwise from straight up.
    const a = ((-DIAL_SWEEP / 2 + (v / DIAL_MAX) * DIAL_SWEEP) * Math.PI) / 180;
    const sx = Math.sin(a);
    const sy = -Math.cos(a);
    const major = v % 20 === 0;
    const outer = r - px * 0.06;
    const inner = outer - px * (major ? 0.075 : 0.04);
    g.beginPath();
    g.moveTo(c + sx * outer, c + sy * outer);
    g.lineTo(c + sx * inner, c + sy * inner);
    g.lineWidth = Math.max(1, px * (major ? 0.016 : 0.009));
    g.strokeStyle = v >= 180 ? '#e8623f' : major ? '#ffffff' : 'rgba(255,255,255,0.7)';
    g.stroke();
    if (v % 40 === 0) {
      const tr = inner - px * 0.075;
      g.fillStyle = v >= 180 ? '#e8623f' : '#e9edf0';
      g.fillText(String(v), c + sx * tr, c + sy * tr);
    }
  }
}
