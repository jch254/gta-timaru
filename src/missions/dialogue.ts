import type { GameContext } from '../core/types';
import type { Line } from './types';

/** Reading time for a subtitle when the line does not give one. */
export function lineSeconds(line: Line): number {
  if (line.seconds !== undefined) return line.seconds;
  return Math.min(6.5, Math.max(2.2, 1.3 + line.text.length * 0.055));
}

/** Plays queued subtitle lines one after another, independent of whatever else the mission is doing. */
export class Dialogue {
  private queue: Line[] = [];
  private head = 0;
  private wait = 0;

  constructor(private ctx: GameContext) {}

  say(lines: readonly Line[]) {
    for (let i = 0; i < lines.length; i++) this.queue.push(lines[i]);
  }

  /** Lines still to come, or one still on screen. */
  get busy(): boolean {
    return this.wait > 0 || this.head < this.queue.length;
  }

  clear() {
    this.queue.length = 0;
    this.head = 0;
    this.wait = 0;
  }

  update(dt: number) {
    // The player can move the talk along: the line on screen ends now and the next one starts.
    if (this.wait > 0.3 && this.ctx.input.pressed('skip')) {
      this.wait = dt;
      this.ctx.ui.skipSubtitle();
    }
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.wait = 0;
    }
    if (this.head < this.queue.length) {
      const line = this.queue[this.head++];
      const seconds = lineSeconds(line);
      this.ctx.ui.subtitle(line.text, seconds, line.who);
      this.wait = seconds + 0.25;
    } else if (this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
    }
  }
}
