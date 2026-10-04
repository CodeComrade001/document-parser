/**
 * Maps `items` through `worker` with at most `limit` in flight. Results keep
 * input order. On the first failure no new work is started and the error is
 * rethrown once in-flight work settles.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  const run = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}
