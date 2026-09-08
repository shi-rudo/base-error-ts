/**
 * The serializer's marker vocabulary: the strings the library itself writes in
 * place of a value it refused to expand. They are the library's own words,
 * never user data, so redaction keeps them readable on the cause spine. This
 * module is the single owner of the strings and of the predicate that
 * recognizes them; an emit site and the predicate can never drift apart.
 */

/** A node already serialized higher up in the same walk. */
export const CIRCULAR_CAUSE_CHAIN_MARKER = "[Circular cause chain]";

/** A chain cut at the cause-depth cap. */
export const MAX_CAUSE_DEPTH_MARKER = "[Max cause depth exceeded]";

/** A node that defeated serialization entirely (for example a hostile Proxy). */
export const UNSERIALIZABLE_CAUSE_MARKER = "[Unserializable cause]";

/** The tail of an aggregate cut at the width cap or a node budget. */
export function moreAggregatedErrorsMarker(dropped: number): string {
  return `[${dropped} more aggregated errors]`;
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SERIALIZER_MARKER = new RegExp(
  `^(?:${[
    CIRCULAR_CAUSE_CHAIN_MARKER,
    MAX_CAUSE_DEPTH_MARKER,
    UNSERIALIZABLE_CAUSE_MARKER,
  ]
    .map(escapeForRegExp)
    .join("|")}|${escapeForRegExp(moreAggregatedErrorsMarker(0)).replace(
    "0",
    "\\d+",
  )})$`,
);

/**
 * Whether `value` is one of the serializer's own markers, matched exactly, so
 * a value that merely resembles one is still treated as data.
 */
export function isSerializerMarker(value: unknown): boolean {
  return typeof value === "string" && SERIALIZER_MARKER.test(value);
}
