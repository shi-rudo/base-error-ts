/**
 * The ISO-8601 string that the log writes as `timestampIso` for a
 * `timestamp`, or `undefined` when the value is no instant that `Date`
 * accepts. `toISOString` throws outside the date range, and a log build must
 * not throw.
 */
export function toTimestampIso(timestamp: unknown): string | undefined {
  if (typeof timestamp !== "number") return undefined;
  const instant = new Date(timestamp);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}
