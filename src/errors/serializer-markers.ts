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

/** A node that defeated serialization entirely (for example a hostile Proxy). */
export const UNSERIALIZABLE_CAUSE_MARKER = "[Unserializable cause]";

/** A data value whose conversion or inspection failed. */
export const UNSERIALIZABLE_VALUE_MARKER = "[Unserializable value]";

/** The tail of an aggregate cut at the width cap or a node budget. */
export function moreAggregatedErrorsMarker(dropped: number): string {
  return `[${dropped} more aggregated errors]`;
}

/** Work omitted because the shared log-build allowance is exhausted. */
export const MAX_LOG_SIZE_MARKER = "[Max log size exceeded]";

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
