import { MAX_DATA_WIDTH, MAX_LOG_NODES } from "../errors/walker-bounds.js";

/**
 * Log data with `leaves` leaves in arrays no wider than the width cap of the
 * log-data copy. The copy visits every leaf, so the value can spend the log
 * budget. One wide array cannot: the copy takes its first entries only.
 */
export function leavesInChunks(
  leaves: number = MAX_LOG_NODES,
  leaf: (index: number) => unknown = () => 1,
): unknown[][] {
  const chunks: unknown[][] = [];
  for (let start = 0; start < leaves; start += MAX_DATA_WIDTH) {
    const size = Math.min(MAX_DATA_WIDTH, leaves - start);
    chunks.push(
      Array.from({ length: size }, (_, offset) => leaf(start + offset)),
    );
  }
  return chunks;
}

/**
 * An object with `keys` keys, `k0` to `k{keys - 1}`, in nested objects no
 * wider than the width cap. The copy reads every key.
 */
export function keysInChunks(
  keys: number,
  value: (index: number) => unknown = (index) => index,
): Record<string, Record<string, unknown>> {
  const chunks: Record<string, Record<string, unknown>> = {};
  for (let start = 0; start < keys; start += MAX_DATA_WIDTH) {
    const chunk: Record<string, unknown> = {};
    const end = Math.min(keys, start + MAX_DATA_WIDTH);
    for (let index = start; index < end; index++)
      chunk[`k${index}`] = value(index);
    chunks[`c${start / MAX_DATA_WIDTH}`] = chunk;
  }
  return chunks;
}
