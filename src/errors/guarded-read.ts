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

/** Distinguish a failed read from an undefined value at fail-closed boundaries. */
export function readPropertyResult(
  value: object,
  key: string | symbol,
): { readable: true; value: unknown } | { readable: false } {
  try {
    return {
      readable: true,
      value: (value as Record<string | symbol, unknown>)[key],
    };
  } catch {
    return { readable: false };
  }
}

/** Reads an own property. An inherited or unreadable property reads as absent. */
export function readOwnProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Object.prototype.hasOwnProperty.call(value, key)
      ? readProperty(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads at most `limit` own descriptors and yields the enumerable string keys.
 * Symbols and non-enumerable keys consume the limit. Key enumeration itself
 * remains eager, because JavaScript has no lazy own-key operation.
 * Returns false when enumeration fails, so a data copy can report the loss.
 */
export function* readOwnEnumerableKeys(
  value: object,
  limit: number,
  budget?: { nodes: number; readonly limit: number },
): Generator<string, boolean> {
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  let cut = false;
  for (let index = 0; index < keys.length && index < limit; index++) {
    // One final inspected key can hold the cut marker before the caller stops.
    if (cut) return true;
    if (budget !== undefined) {
      cut = budget.nodes >= budget.limit;
      if (!cut) budget.nodes++;
    }
    const key = keys[index];
    if (typeof key !== "string") continue;
    try {
      if (Object.prototype.propertyIsEnumerable.call(value, key)) yield key;
    } catch {
      // An unreadable descriptor costs its key only.
    }
  }
  return true;
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

/** The intrinsic tag can invoke a foreign Symbol.toStringTag getter. */
export function readObjectTag(value: object): string | undefined {
  try {
    return Object.prototype.toString.call(value);
  } catch {
    return undefined;
  }
}

/** A diagnostic constructor name, including a callable constructor's name. */
export function readConstructorName(value: object): string | undefined {
  const constructor = readProperty(value, "constructor");
  try {
    const name: unknown =
      typeof constructor === "function"
        ? Reflect.get(constructor, "name")
        : readProperty(constructor, "name");
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** A failed callback lookup differs from an absent callback. */
export const UNREADABLE_TO_JSON: unique symbol = Symbol("unreadable.toJSON");

/** JSON permits callable objects to supply a toJSON method. */
export function readToJSON(value: unknown): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return undefined;
  try {
    return Reflect.get(value, "toJSON");
  } catch {
    return UNREADABLE_TO_JSON;
  }
}

/** Reflection failed; distinct from an absent own property or null prototype. */
export const UNREADABLE_REFLECTION: unique symbol = Symbol(
  "unreadable.reflection",
);

/** Inspect an own property without invoking its getter. Proxy traps can run. */
export function readOwnPropertyDescriptor(
  value: object,
  key: string | symbol,
): PropertyDescriptor | undefined | typeof UNREADABLE_REFLECTION {
  try {
    return Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    return UNREADABLE_REFLECTION;
  }
}

/** Read a prototype without accessing consumer constructor properties. */
export function readPrototype(
  value: object,
): object | null | typeof UNREADABLE_REFLECTION {
  try {
    return Reflect.getPrototypeOf(value);
  } catch {
    return UNREADABLE_REFLECTION;
  }
}

/** Own-key enumeration is eager even when subsequent inspection is bounded. */
export function readOwnKeys(
  value: object,
): (string | symbol)[] | typeof UNREADABLE_REFLECTION {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return UNREADABLE_REFLECTION;
  }
}
