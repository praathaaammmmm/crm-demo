/** Pure helpers that turn API data into chart rows. No invented values: every row is a count from real records. */

export interface CountRow<K extends string> {
  key: K;
  count: number;
}

/** Counts items per key in a fixed category order (zeros included), so a category never moves between renders. */
export function countBy<T, K extends string>(items: readonly T[], keyOf: (item: T) => K, order: readonly K[]): CountRow<K>[] {
  const counts = new Map<K, number>(order.map((key) => [key, 0]));
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

/** Whole-number percentage of `part` in `total`; null when there is nothing to divide. */
export function percentOf(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

export interface DistributionRow {
  key: string;
  label: string;
  value: number;
  /** Count and share, printed beside the bar. */
  text: string;
}

/**
 * Bar rows for a part-of-whole distribution: each row prints its count and share of the total.
 * `hideZero` drops empty categories (for long, sparse category lists).
 */
export function distributionRows<K extends string>(
  rows: readonly CountRow<K>[],
  labelOf: (key: K) => string,
  options: { hideZero?: boolean } = {},
): DistributionRow[] {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows
    .filter((row) => !options.hideZero || row.count > 0)
    .map((row) => {
      const share = percentOf(row.count, total);
      return { key: row.key, label: labelOf(row.key), value: row.count, text: share === null ? String(row.count) : `${String(row.count)} · ${String(share)}%` };
    });
}

export const totalOf = (rows: readonly { count: number }[]): number => rows.reduce((sum, row) => sum + row.count, 0);

/** "1 automation", "2 automations": count with the right noun form. */
export const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;
