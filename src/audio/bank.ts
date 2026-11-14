/**
 * Pre-rendering queue. Synthesising a sound takes a few milliseconds of maths, so the whole library is rendered
 * in small slices in the background (it starts while the world is still loading, before any AudioContext exists)
 * and handed to the mixer as plain sample arrays when a sound is first needed. Pure: no WebAudio.
 */
export type RenderJob = () => Float32Array;

export class Bank {
  private ready = new Map<string, Float32Array>();
  private jobs: { key: string; render: RenderJob }[] = [];
  private next = 0;
  /** Keys already handed over (or rendered on demand): never render those again. */
  private done = new Set<string>();

  queue(key: string, render: RenderJob): void {
    this.jobs.push({ key, render });
  }

  get pending(): number {
    return this.jobs.length - this.next;
  }

  /**
   * Renders queued jobs until `budgetMs` has been spent (always at least one job). Returns true when the
   * queue is empty. `clock` is injectable for tests.
   */
  work(budgetMs: number, clock: () => number = () => performance.now()): boolean {
    const t0 = clock();
    while (this.next < this.jobs.length) {
      const job = this.jobs[this.next++];
      if (!this.done.has(job.key) && !this.ready.has(job.key)) this.ready.set(job.key, job.render());
      if (clock() - t0 >= budgetMs) break;
    }
    if (this.next >= this.jobs.length) {
      this.jobs.length = 0;
      this.next = 0;
      return true;
    }
    return false;
  }

  /** The samples for `key`: pre-rendered if the queue got to it, otherwise rendered now. Hands over ownership. */
  take(key: string, render: RenderJob): Float32Array {
    const data = this.ready.get(key) ?? render();
    this.ready.delete(key);
    this.done.add(key);
    return data;
  }

  has(key: string): boolean {
    return this.ready.has(key);
  }
}
