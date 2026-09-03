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
 * Deep-clones `value` into a frozen, JSON-safe structure, or throws if any part
 * is not JSON-safe: a non-finite number (`NaN`/`Infinity`), a function, a
 * symbol, a `Date`/`Map`/`Set` or other exotic object, a symbol-keyed object, a
 * sparse array, a circular reference, a container nested deeper than
 * {@link MAX_DATA_DEPTH} levels, or a value expanding past
 * {@link MAX_DATA_NODES} total nodes (a shared-reference blowup). The returned
 * clone is deeply frozen and decoupled from the source, so it is safe to place
 * on a wire object that may be shared or mutated afterward.
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
    throw new Error(errorMessage);
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error(errorMessage);
        }
      }
      return Object.freeze(
        value.map((item) =>
          cloneInto(item, depth + 1, seen, state, errorMessage),
        ),
      ) as readonly JsonSafeValue[];
    }

    if (
      !isPlainObject(value) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw new Error(errorMessage);
    }
    const clone = Object.create(null) as Record<string, JsonSafeValue>;
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneInto(item, depth + 1, seen, state, errorMessage);
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}
