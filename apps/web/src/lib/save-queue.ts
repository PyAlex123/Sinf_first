/**
 * Saves one at a time, in the order they were asked for (review 2026-11-25). The journal answers
 * every save with the whole journal, so two saves in flight could end with the older answer on top
 * of the newer grade; and a save that came while another ran used to be dropped without a word.
 * A failed save does not stop the ones queued behind it.
 */
export class SaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  /** Saves queued or running. */
  get size(): number {
    return this.waiting;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.waiting++;
    const result = this.tail.then(task);
    this.tail = result.then(
      () => this.waiting--,
      () => this.waiting--,
    );
    return result;
  }
}
