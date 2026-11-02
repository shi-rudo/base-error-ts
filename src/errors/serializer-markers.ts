/**
 * The serializer's marker vocabulary: the strings the library itself writes in
 * place of a value it refused to expand. This module owns the marker text and
 * the predicate that recognizes a marker on the cause spine.
 */

/** A node that is its own ancestor: the cause graph has a cycle. */
export const CIRCULAR_CAUSE_CHAIN_MARKER = "[Circular cause chain]";

/** A node that the same walk already wrote, without a cycle. */
export const SHARED_CAUSE_MARKER = "[Shared cause]";

/** A chain cut at the cause-depth cap. */
export const MAX_CAUSE_DEPTH_MARKER = "[Max cause depth exceeded]";

/** A data container cut at the data-depth cap. */
export const MAX_DATA_DEPTH_MARKER = "[Max data depth exceeded]";

/** A node that defeated serialization entirely (for example a hostile Proxy). */
export const UNSERIALIZABLE_CAUSE_MARKER = "[Unserializable cause]";

/** A data value whose conversion or inspection failed. */
export const UNSERIALIZABLE_VALUE_MARKER = "[Unserializable value]";

/** The tail of an aggregate cut at the width cap or a node budget. */
export function moreAggregatedErrorsMarker(dropped: number): string {
  return `[${dropped} more aggregated errors]`;
}

/** The tail of a data array cut at the width cap. */
export function moreItemsMarker(dropped: number): string {
  return `[${dropped} more items]`;
}

/**
 * The key that holds the number of keys a data object dropped at the width
 * cap. A key, not an entry, because an object has no tail.
 */
export const MORE_KEYS_KEY = "[more keys]";

/** Binary data, written as its type and its size instead of its entries. */
export function binaryDataMarker(type: string, size: number): string {
  return `[${type}(${size})]`;
}

/** The tail of a string cut at the length cap. */
export function moreCharactersMarker(dropped: number): string {
  return `[${dropped} more characters]`;
}

/** Work omitted because the shared log-build allowance is exhausted. */
export const MAX_LOG_SIZE_MARKER = "[Max log size exceeded]";

/** The message of the recovery record when a redaction policy throws. */
export const LOG_REDACTION_FAILED_MARKER = "[log redaction failed]";

/** A cause node in `toString` whose tag cannot be read, such as a revoked Proxy. */
export const UNRENDERABLE_CAUSE_MARKER = "[Unrenderable cause]";

/** Most keys that the circular-object marker names. */
const MAX_CIRCULAR_OBJECT_MARKER_KEYS = 5;

/**
 * A data object that is its own ancestor, named by its type and its first
 * keys. The marker pulls at most one key past the named ones, and that key
 * adds "...". The marker sits in data, so a policy masks it like any other
 * data value.
 */
export function circularObjectMarker(
  type: string,
  keys: Iterable<string>,
): string {
  const named: string[] = [];
  let more = false;
  for (const key of keys) {
    if (named.length === MAX_CIRCULAR_OBJECT_MARKER_KEYS) {
      more = true;
      break;
    }
    named.push(key);
  }
  const keyInfo = named.length > 0 ? ` with keys: [${named.join(", ")}]` : "";
  return `[Circular ${type}${keyInfo}${more ? "..." : ""}]`;
}

const CAUSE_SPINE_MARKERS: ReadonlySet<string> = new Set([
  CIRCULAR_CAUSE_CHAIN_MARKER,
  SHARED_CAUSE_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
  MAX_LOG_SIZE_MARKER,
]);

const MORE_AGGREGATED_ERRORS = /^\[\d+ more aggregated errors\]$/;

/**
 * Whether `value` is a marker that the serializer writes in a cause slot or
 * in a list of aggregate members. Recognition is by value: a consumer string
 * that equals a marker passes too, and it carries the marker text only.
 */
export function isCauseSpineMarker(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (CAUSE_SPINE_MARKERS.has(value) || MORE_AGGREGATED_ERRORS.test(value))
  );
}
