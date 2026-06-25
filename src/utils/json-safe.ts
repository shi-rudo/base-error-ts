/**
 * Shared JSON-safety helper. A value that crosses a wire (an HTTP body, an RPC
 * boundary, `postMessage`) must survive `JSON.stringify` losslessly and must not
 * carry a hostile prototype. This module is the single clone-and-freeze
 * implementation reused by the problem-details adapter and the public-error
 * transport stage, so the two cannot drift.
 */

/** The subset of values that round-trips through JSON without loss. */
export type JsonSafeValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonSafeValue[]
  | { readonly [key: string]: JsonSafeValue };

/** True for a value with `Object.prototype` or a null prototype (a plain record). */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-clones `value` into a frozen, JSON-safe structure, or throws if any part
 * is not JSON-safe: a non-finite number (`NaN`/`Infinity`), a function, a
 * symbol, a `Date`/`Map`/`Set` or other exotic object, a symbol-keyed object, a
 * sparse array, or a circular reference. The returned clone is deeply frozen and
 * decoupled from the source, so it is safe to place on a wire object that may be
 * shared or mutated afterward.
 */
export function cloneJsonSafe(value: unknown): JsonSafeValue {
  return cloneInto(value, new Set());
}

function cloneInto(value: unknown, seen: Set<object>): JsonSafeValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new Error("value is not JSON-safe");
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new Error("value is not JSON-safe");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error("value is not JSON-safe");
        }
      }
      return Object.freeze(
        value.map((item) => cloneInto(item, seen)),
      ) as readonly JsonSafeValue[];
    }

    if (
      !isPlainObject(value) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw new Error("value is not JSON-safe");
    }
    const clone = Object.create(null) as Record<string, JsonSafeValue>;
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneInto(item, seen);
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}
