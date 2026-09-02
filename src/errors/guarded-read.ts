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
 * The members of an aggregate, materialized. `members` holds at most the
 * requested number of them, and `total` is the count the aggregate reports,
 * so a consumer can mark the members it did not take.
 */
export type AggregateMembers = {
  readonly members: readonly unknown[];
  readonly total: number;
};

/**
 * Reads the members of an aggregate by shape (an array-valued `errors`)
 * rather than by `instanceof AggregateError`, so a cross-realm or custom
 * fan-out error is handled too. Returns `undefined` when `errors` is not an
 * array, which includes a throwing getter and a revoked Proxy.
 *
 * The result is a fresh, frozen copy of at most `limit` members, each read
 * through a guarded index read. The foreign array is never handed on: a
 * consumer that sliced or iterated it would run its index getters, its
 * `length` trap and its `Symbol.species` outside any guard. A `length` that
 * is not a non-negative safe integer reads as zero members, and a member whose
 * read throws reads as `undefined`.
 */
export function readMembers(
  value: unknown,
  limit: number,
): AggregateMembers | undefined {
  const errors = readProperty(value, "errors");
  if (!isArrayValue(errors)) return undefined;

  const total = toMemberCount(readProperty(errors, "length"));
  const count = Math.min(total, Math.max(0, limit));
  const members: unknown[] = [];
  for (let index = 0; index < count; index++) {
    members.push(readProperty(errors, String(index)));
  }
  return { members: Object.freeze(members), total };
}

/** `Array.isArray` itself throws on a revoked Proxy; such a value is no array. */
function isArrayValue(value: unknown): boolean {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function toMemberCount(length: unknown): number {
  return typeof length === "number" &&
    Number.isSafeInteger(length) &&
    length >= 0
    ? length
    : 0;
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
