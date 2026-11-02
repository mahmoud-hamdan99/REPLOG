/**
 * A serial write lane.
 *
 * docs/ARCHITECTURE.md section 7.2: a burst of taps must not interleave
 * transactions. Two overlapping read-modify-write cycles against the same
 * workout can each read the pre-write state and the second then overwrites the
 * first — a confirmed set silently lost, which is exactly the failure this
 * module's one job is to prevent.
 *
 * Every task is chained onto the previous one, so tasks run in submission order
 * and never concurrently. A task that rejects does not break the chain: its
 * caller sees the rejection, and the next task still runs. A lane that stopped
 * on the first error would turn one failed write into a dead session.
 */
export class SerialQueue {
  /** The tail of the chain. Settled-and-resolved when the lane is idle. */
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** Tasks submitted and not yet settled, including the running one. */
  get pending(): number {
    return this.depth;
  }

  get isIdle(): boolean {
    return this.depth === 0;
  }

  /**
   * Queues `task` behind everything already submitted.
   *
   * The returned promise settles with the task's own outcome. The internal
   * chain deliberately swallows that outcome so one caller's failure is not
   * re-thrown into the next caller's task.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    this.depth += 1;

    const result = this.tail.then(() => task());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result.finally(() => {
      this.depth -= 1;
    });
  }

  /** Resolves once everything submitted so far has settled. */
  async drain(): Promise<void> {
    // Looping rather than awaiting once: a task may enqueue another task, and
    // a single await would return while that successor is still pending.
    while (this.depth > 0) {
      await this.tail;
    }
  }
}
