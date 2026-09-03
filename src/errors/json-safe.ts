/**
 * Shared JSON-safety helper. A value the error model snapshots or puts on a
 * wire must survive `JSON.stringify` losslessly and must not carry a hostile
 * prototype. This module is the single clone-and-freeze implementation, so the
 * JSON-safety guarantee lives at exactly one place.
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
 * Total-node budget for one {@link cloneJsonSafe} call. Cycles are rejected,
 * but shared (DAG) references are cloned once per reference, so a small input
 * can legally expand exponentially (`{a, b}` doubling per level). The budget
 * turns that CPU-exhaustion shape into the ordinary "not JSON-safe" failure
 * the callers already handle, and sits far above any sane wire payload.
 */
const MAX_CLONE_NODES = 100_000;

/**
 * Deepest container nesting one {@link cloneJsonSafe} call descends into. The
 * clone recurses once per level, so without a cap a deeply nested input
 * overflows the host stack, which is far smaller on an edge isolate than on
 * Node, and surfaces as a raw `RangeError` instead of the rejection the
 * callers handle. A container past the cap is rejected like any other value
 * that is not JSON-safe. Matches the depth cap of the other walkers.
 */
const MAX_CLONE_DEPTH = 100;

/**
 * Deep-clones `value` into a frozen, JSON-safe structure, or throws if any part
 * is not JSON-safe: a non-finite number (`NaN`/`Infinity`), a function, a
 * symbol, a `Date`/`Map`/`Set` or other exotic object, a symbol-keyed object, a
 * sparse array, a circular reference, a container nested deeper than
 * {@link MAX_CLONE_DEPTH} levels, or a value expanding past
 * {@link MAX_CLONE_NODES} total nodes (a shared-reference blowup). The returned
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
  if (++state.nodes > MAX_CLONE_NODES) {
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
  if (depth >= MAX_CLONE_DEPTH) {
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
