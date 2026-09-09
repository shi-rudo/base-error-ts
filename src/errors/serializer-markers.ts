/**
 * The serializer's marker vocabulary: the strings the library itself writes in
 * place of a value it refused to expand. Matching text alone proves no origin.
 * BaseError records emitted slots privately and preserves their provenance
 * through its redaction copies. This module owns only the marker text.
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
