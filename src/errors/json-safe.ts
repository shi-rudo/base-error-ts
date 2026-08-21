/**
 * Shared JSON-safety helper. A value that crosses a wire (an HTTP body, an RPC
 * boundary, `postMessage`) must survive `JSON.stringify` losslessly and must not
 * carry a hostile prototype. This module is the single clone-and-freeze
 * implementation for the public-error transport stage (`toProblem`), so the
 * wire-safety guarantee lives at exactly one place.
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
 * Deep-clones `value` into a frozen, JSON-safe structure, or throws if any part
 * is not JSON-safe: a non-finite number (`NaN`/`Infinity`), a function, a
 * symbol, a `Date`/`Map`/`Set` or other exotic object, a symbol-keyed object, a
 * sparse array, a circular reference, or a value expanding past
 * {@link MAX_CLONE_NODES} total nodes (a shared-reference blowup). The returned
 * clone is deeply frozen and decoupled from the source, so it is safe to place
 * on a wire object that may be shared or mutated afterward.
 */
export function cloneJsonSafe(value: unknown): JsonSafeValue {
  return cloneInto(value, new Set(), { nodes: 0 });
}

function cloneInto(
  value: unknown,
  seen: Set<object>,
  state: { nodes: number },
): JsonSafeValue {
  if (++state.nodes > MAX_CLONE_NODES) {
    throw new Error("value is not JSON-safe");
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
        value.map((item) => cloneInto(item, seen, state)),
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
      clone[key] = cloneInto(item, seen, state);
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}
