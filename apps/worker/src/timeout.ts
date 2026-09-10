// The hard job budget. A single `AbortSignal` is threaded into every LLM call
// and every adapter; on expiry the runner stops scheduling new work, drains
// briefly, writes what exists and finishes the job as `partial`.

export class JobBudget {
  readonly deadline: number;
  #controller = new AbortController();
  #timer: ReturnType<typeof setTimeout>;

  constructor(timeoutSec: number, now: number = Date.now()) {
    const ms = Math.max(0, Math.round(timeoutSec * 1000));
    this.deadline = now + ms;
    this.#timer = setTimeout(() => {
      if (!this.#controller.signal.aborted) {
        this.#controller.abort(new Error("job budget exceeded"));
      }
    }, ms);
    this.#timer.unref?.();
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get expired(): boolean {
    return this.#controller.signal.aborted || Date.now() >= this.deadline;
  }

  remainingMs(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  /** Resolves once the budget is spent (abort fired, or the deadline passed). */
  whenExpired(): Promise<void> {
    if (this.expired) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => resolve();
      this.#controller.signal.addEventListener("abort", done, { once: true });
      const t = setTimeout(done, this.remainingMs());
      t.unref?.();
    });
  }

  dispose(): void {
    clearTimeout(this.#timer);
  }
}
