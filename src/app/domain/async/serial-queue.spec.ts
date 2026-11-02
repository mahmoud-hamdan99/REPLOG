import { SerialQueue } from './serial-queue';

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SerialQueue', () => {
  it('runs tasks one at a time, in submission order', async () => {
    const queue = new SerialQueue();
    const order: string[] = [];
    let running = 0;
    let maxConcurrent = 0;

    const task = (name: string) => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await Promise.resolve();
      order.push(name);
      running -= 1;
    };

    await Promise.all([queue.run(task('a')), queue.run(task('b')), queue.run(task('c'))]);

    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxConcurrent).toBe(1);
  });

  it('does not start the next task until the previous one settles', async () => {
    const queue = new SerialQueue();
    const gate = deferred<void>();
    const started: string[] = [];

    const first = queue.run(async () => {
      started.push('first');
      await gate.promise;
    });
    const second = queue.run(async () => {
      started.push('second');
    });

    await Promise.resolve();
    expect(started).toEqual(['first']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
  });

  it('gives the rejection to the caller and keeps the lane alive', async () => {
    const queue = new SerialQueue();
    const failure = queue.run(() => Promise.reject(new Error('write failed')));

    await expect(failure).rejects.toThrow('write failed');

    // The critical part: one failed write must not kill the session.
    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('returns each task its own value', async () => {
    const queue = new SerialQueue();
    const values = await Promise.all([
      queue.run(() => Promise.resolve(1)),
      queue.run(() => Promise.resolve(2)),
    ]);

    expect(values).toEqual([1, 2]);
  });

  it('reports pending depth and drains to idle', async () => {
    const queue = new SerialQueue();
    expect(queue.isIdle).toBe(true);

    const gate = deferred<void>();
    void queue.run(() => gate.promise);
    void queue.run(() => Promise.resolve());

    expect(queue.pending).toBe(2);
    expect(queue.isIdle).toBe(false);

    gate.resolve();
    await queue.drain();

    expect(queue.pending).toBe(0);
    expect(queue.isIdle).toBe(true);
  });

  it('drains work that a running task enqueues', async () => {
    const queue = new SerialQueue();
    const done: string[] = [];

    void queue.run(async () => {
      done.push('outer');
      void queue.run(async () => {
        done.push('inner');
      });
    });

    await queue.drain();
    expect(done).toEqual(['outer', 'inner']);
  });

  it('drains immediately when nothing is queued', async () => {
    await expect(new SerialQueue().drain()).resolves.toBeUndefined();
  });
});
