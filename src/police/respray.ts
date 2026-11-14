import type { Rng } from '../core/rng';
import type { GameContext, Place, Vehicle } from '../core/types';
import { sprayCost } from './response';
import { TUNING } from './tuning';

const SPEAKER = 'Panelbeater';

/** Resolves when the promise does, or after `ms` regardless: a fade that never settles must not lock the shop. */
function settle(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

/** Panel & paint shops (places tagged 'spray'): a respray and new plates loses the heat, for a price. */
export class Respray {
  private places: Place[] = [];
  private blips = false;
  private busy = false;
  /** The car the player was sitting in at a shop on the previous frame. */
  private candidate: Vehicle | null = null;

  constructor(
    private ctx: GameContext,
    private rng: Rng,
    private onResprayed: () => void,
  ) {}

  init() {
    this.places = this.ctx.world.placesTagged('spray');
  }

  /** Spray shops are marked on the map for as long as there is heat to lose. */
  showBlips(on: boolean) {
    if (on !== this.blips) this.setBlips(on);
  }

  /** Call every frame. `seen`: an officer has eyes on the player. */
  update(level: number, seen: boolean) {
    const { ctx } = this;
    this.showBlips(level > 0);
    const previous = this.candidate;
    this.candidate = null;
    if (this.busy || level === 0 || !ctx.player.alive) return;

    const pressed = ctx.input.pressed('interact');
    const driving = ctx.player.vehicle;
    // The player's own handler runs first and steps out of the car on the same key press, so on a press
    // act on the car they were sitting in a frame ago.
    const car = driving ?? (pressed ? previous : null);
    if (!car) return;
    let atShop = false;
    for (const place of this.places) {
      if (Math.hypot(place.x - car.position.x, place.z - car.position.z) <= TUNING.sprayRange) {
        atShop = true;
        break;
      }
    }
    // Pulled up at the shop, not flying past it.
    if (!atShop || Math.abs(car.speed) > 6) return;
    if (driving) this.candidate = driving;
    if (seen) {
      if (driving) ctx.ui.prompt('Lose the cops before a respray');
      return;
    }
    if (driving) ctx.ui.prompt(`${ctx.input.label('interact')}  Respray and new plates — $${sprayCost(level, TUNING.sprayBase, TUNING.sprayPerLevel)}`);
    // Only for a car they were already sitting in: the press that gets into a car parked here is not a sale.
    if (pressed && previous === car && ctx.player.controlsEnabled && !ctx.ui.menuOpen) void this.buy(car, level);
  }

  private async buy(vehicle: Vehicle, level: number) {
    const { ctx, rng } = this;
    const cost = sprayCost(level, TUNING.sprayBase, TUNING.sprayPerLevel);
    if (vehicle.destroyed || vehicle.burning) return;
    if (vehicle.tags.has('police')) {
      ctx.ui.subtitle('Not a chance. Every cop in Canterbury knows that one.', 3.5, SPEAKER);
      return;
    }
    if (ctx.player.money < cost) {
      ctx.ui.subtitle(`That's $${cost}, mate. Come back when you've got it.`, 3.5, SPEAKER);
      return;
    }
    this.busy = true;
    ctx.player.controlsEnabled = false;
    try {
      ctx.player.addMoney(-cost);
      ctx.audio.play('cash');
      await settle(ctx.ui.fade(true, 0.6), 1500);
      // The Vehicle contract exposes `color` only; the lead hooks the actual repaint.
      const colors = vehicle.spec.colors.filter((c) => c !== vehicle.color);
      if (colors.length) vehicle.color = rng.pick(colors);
      if (ctx.player.alive && ctx.player.vehicle !== vehicle && !vehicle.destroyed && ctx.vehicles.all.includes(vehicle)) ctx.player.warpIntoVehicle(vehicle);
      this.onResprayed();
      await settle(ctx.ui.fade(false, 0.6), 1500);
      ctx.ui.subtitle('Good as new. Never saw you.', 3, SPEAKER);
    } finally {
      if (ctx.player.alive) ctx.player.controlsEnabled = true;
      this.busy = false;
    }
  }

  private setBlips(on: boolean) {
    this.blips = on;
    for (const place of this.places) {
      const id = `spray-${place.id}`;
      if (on) this.ctx.ui.setBlip({ id, kind: 'shop', x: place.x, z: place.z, label: 'Respray' });
      else this.ctx.ui.removeBlip(id);
    }
  }

  dispose() {
    if (this.blips) this.setBlips(false);
  }
}
