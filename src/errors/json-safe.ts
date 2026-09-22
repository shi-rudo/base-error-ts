/**
 * Shared JSON-safety helper. A value the error model snapshots or puts on a
 * wire must survive `JSON.stringify` losslessly and must not carry a hostile
 * prototype. This module is the single clone-and-freeze implementation, so the
 * JSON-safety guarantee lives at exactly one place.
 */

import { MAX_DATA_DEPTH, MAX_DATA_NODES } from "./walker-bounds.js";

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
 * Deep-clones `value` into a frozen, JSON-safe structure. It throws if any part
 * is not JSON-safe:
 *
 * - a non-finite number (`NaN`/`Infinity`), a function, or a symbol;
 * - a `Date`/`Map`/`Set` or other exotic object, or an `Array` subclass;
 * - a symbol-keyed object or a sparse array;
 * - a circular reference, or a container nested deeper than
 *   {@link MAX_DATA_DEPTH} levels;
 * - a value expanding past {@link MAX_DATA_NODES} total nodes (a
 *   shared-reference blowup).
 *
 * The returned clone is deeply frozen and decoupled from the source. It is
 * safe on a wire object that is shared or mutated afterward.
 *
 * An `undefined` property is skipped: it reads the same as an absent one, and
 * `JSON.stringify` drops it. An `undefined` list element is rejected, because
 * JSON turns it into `null`.
 *
 * `errorMessage` replaces the default rejection message, so each boundary
 * keeps its own error contract over the one shared walker.
 */
export function cloneJsonSafe(
  value: unknown,
  options?: { readonly errorMessage?: string },
): JsonSafeValue {
  return cloneInto(
    value,
    0,
    new Set(),
    { nodes: 0 },
    options?.errorMessage ?? "value is not JSON-safe",
  );
}

function cloneInto(
  value: unknown,
  depth: number,
  seen: Set<object>,
  state: { nodes: number },
  errorMessage: string,
): JsonSafeValue {
  if (++state.nodes > MAX_DATA_NODES) {
    throw new Error(errorMessage);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new Error(errorMessage);
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new Error(errorMessage);
  }
  if (depth >= MAX_DATA_DEPTH) {
    // The value can pass JSON.stringify, so the caller's message alone would
    // send the reader to the library source. Name the one reason that is not
    // visible on the value.
    throw new Error(
      `${errorMessage} (nested deeper than ${MAX_DATA_DEPTH} levels)`,
    );
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(errorMessage);
      }
      // Built index by index: `map` would construct the result through the
      // source's `Symbol.species`, which an own `constructor` key controls.
      const clone: JsonSafeValue[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error(errorMessage);
        }
        clone.push(
          cloneInto(value[index], depth + 1, seen, state, errorMessage),
        );
      }
      return Object.freeze(clone);
    }

    if (
      !isPlainObject(value) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw new Error(errorMessage);
    }
    const clone = Object.create(null) as Record<string, JsonSafeValue>;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      clone[key] = cloneInto(item, depth + 1, seen, state, errorMessage);
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}
