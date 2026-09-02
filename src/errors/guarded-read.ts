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

/**
 * `instanceof` against a foreign value. The built-in check walks the
 * prototype chain of the value, so a revoked Proxy or a throwing
 * `getPrototypeOf` trap throws out of a bare `instanceof`. Such a value is not
 * an instance. A constructor with its own `Symbol.hasInstance` is the caller's
 * code, not a foreign input: its throw propagates, as a bug in that code must.
 */
export function isInstanceOf<T>(
  value: unknown,
  constructor: abstract new (...args: never[]) => T,
): value is T {
  const hasInstance: unknown = Reflect.get(constructor, Symbol.hasInstance);
  if (hasInstance !== Function.prototype[Symbol.hasInstance]) {
    return value instanceof constructor;
  }
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
}
