export interface Semaphore {
  withPermit<T>(operation: () => Promise<T>): Promise<T>;
}

export function createSemaphore(maxPermits: number): Semaphore {
  let activePermits = 0;
  const waiters: Array<() => void> = [];

  async function acquirePermit(): Promise<void> {
    if (activePermits < maxPermits && waiters.length === 0) {
      activePermits += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      waiters.push(() => {
        activePermits += 1;
        resolve();
      });
    });
  }

  function releasePermit(): void {
    activePermits -= 1;
    const next = waiters.shift();
    next?.();
  }

  return {
    async withPermit<T>(operation: () => Promise<T>): Promise<T> {
      await acquirePermit();

      try {
        return await operation();
      } finally {
        releasePermit();
      }
    },
  };
}

export interface KeyedSerialTaskQueue<TKey> {
  run<T>(key: TKey, operation: () => Promise<T>): Promise<T>;
}

export function createKeyedSerialTaskQueue<TKey>(): KeyedSerialTaskQueue<TKey> {
  const queues = new Map<TKey, Promise<void>>();

  return {
    async run<T>(key: TKey, operation: () => Promise<T>): Promise<T> {
      const previous = queues.get(key) ?? Promise.resolve();
      let release: (() => void) | undefined;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const next = previous.catch(() => undefined).then(() => current);

      queues.set(key, next);
      await previous.catch(() => undefined);

      try {
        return await operation();
      } finally {
        release?.();
        if (queues.get(key) === next) {
          queues.delete(key);
        }
      }
    },
  };
}
