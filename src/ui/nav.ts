import type { InputApi } from '../core/types';

const FIRST_REPEAT = 0.38;
const REPEAT = 0.11;

/**
 * Menu navigation read from the game's own input actions, so keyboard (arrows / WASD, Enter / F / Space, Esc)
 * and gamepad (left stick or D-pad, A / Y to confirm, B or Start to back out) drive every menu the same way.
 * Call `update` once per frame while a menu is open, then read the edge flags.
 */
export class MenuNav {
  up = false;
  down = false;
  left = false;
  right = false;
  confirm = false;
  back = false;

  private vHeld = 0;
  private vTimer = 0;
  private hHeld = 0;
  private hTimer = 0;

  /**
   * Call when a menu opens: whatever is held right now (say W, from walking) is ignored until released, so
   * the selection does not jump.
   */
  reset(input: InputApi) {
    this.vHeld = axisSign(input.moveZ);
    this.hHeld = -axisSign(input.moveX);
    this.vTimer = this.hTimer = Infinity;
    this.up = this.down = this.left = this.right = this.confirm = this.back = false;
  }

  update(input: InputApi, dt: number) {
    const pad = input.gamepadActive;
    // Stick / WASD / arrows, with key-repeat.
    let up = false;
    let down = false;
    let left = false;
    let right = false;
    const v = axisSign(input.moveZ);
    if (v !== this.vHeld) {
      this.vHeld = v;
      this.vTimer = FIRST_REPEAT;
      if (v > 0) up = true;
      else if (v < 0) down = true;
    } else if (v !== 0 && (this.vTimer -= dt) <= 0) {
      this.vTimer = REPEAT;
      if (v > 0) up = true;
      else down = true;
    }
    // moveX is +1 for left.
    const h = -axisSign(input.moveX);
    if (h !== this.hHeld) {
      this.hHeld = h;
      this.hTimer = FIRST_REPEAT;
      if (h > 0) right = true;
      else if (h < 0) left = true;
    } else if (h !== 0 && (this.hTimer -= dt) <= 0) {
      this.hTimer = REPEAT;
      if (h > 0) right = true;
      else left = true;
    }
    // D-pad: on a pad these actions sit on the four directions (up, down, left, right).
    if (pad) {
      up = up || input.pressed('camera');
      down = down || input.pressed('horn');
      left = left || input.pressed('radioNext');
      right = right || input.pressed('nextWeapon');
    }
    this.up = up;
    this.down = down;
    this.left = left;
    this.right = right;
    this.confirm = input.pressed('interact') || input.pressed('jump');
    this.back = input.pressed('pause') || (pad && input.pressed('melee'));
  }
}

function axisSign(value: number): number {
  return value > 0.5 ? 1 : value < -0.5 ? -1 : 0;
}
