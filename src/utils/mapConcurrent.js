/**
 * Process items with a bounded concurrency pool.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} limit
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, fn, limit) {
  const results = [];
  let i = 0;
  const cap = Math.max(1, Math.min(limit, items.length || 1));

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: Math.min(cap, items.length || 1) }, () => worker()));
  return results;
}
