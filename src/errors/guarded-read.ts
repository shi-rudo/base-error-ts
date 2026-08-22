/**
 * Guarded reads of foreign error properties.
 *
 * The error model reads `cause`, `errors`, `code` and the like from values it
 * did not create, on paths that run inside `catch`: logging, traversal, and
 * string rendering. There a new exception destroys the original error, so a
 * throwing getter or Proxy trap is a real input, not a bug to surface.
 */

/**
 * Reads one property of a foreign value. A non-object, a missing property and
 * a throwing getter all read as `undefined`.
 */
export function readProperty(value: unknown, key: string | symbol): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return (value as Record<string | symbol, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * The members of an aggregate, read by shape rather than by
 * `instanceof AggregateError`, so a cross-realm or custom fan-out error is
 * handled too. A throwing getter yields no members.
 */
export function readMembers(value: unknown): readonly unknown[] {
  const members = readProperty(value, "errors");
  return Array.isArray(members) ? members : [];
}
