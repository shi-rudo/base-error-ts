/**
 * The bounds of every walker in the error model. A walker follows a cause
 * chain, an aggregate, or a data tree that this library did not build, on a
 * path that runs inside `catch`. Each walker carries a depth cap, a node
 * budget, a width cap, and a seen set, because depth does not bound width,
 * and a shared reference expands once per reference. This module is the one
 * place where the numbers stand. A walker imports its cap from here and
 * states, at its own site, how it counts.
 *
 * Every cap is host-stack independent, so behavior is identical on the small
 * stack of an edge isolate and on Node.
 */

/**
 * Largest number of cause hops a walker follows. The log serializer, the
 * string render, the cause spine of the redaction walker, the reconstruction
 * in `StructuredError.fromJSON`, and the default depth of the traversal
 * helpers all cut at this hop. One value for every surface, so a chain is cut
 * at the same node in the log, in `toString()`, after a round-trip, and in
 * `getRootCause`, and a pathologically deep (but acyclic) chain can never
 * overflow the stack while logging.
 */
export const MAX_CAUSE_DEPTH = 100;

/**
 * Largest number of members a walker takes from one aggregate node. The cause
 * depth bounds the spine, not an aggregate's width: one `Promise.any` over a
 * large pool rejects with a member per branch, and a log line is not the
 * place for thousands of them. The serializer and the string render collapse
 * the remainder into a count marker. `fromJSON` mirrors the cap, so this
 * library's own log shape round-trips unchanged while a hostile payload
 * cannot amplify: every reconstructed `Error` captures a stack, which is far
 * more expensive than the array entry that asks for it.
 */
export const MAX_AGGREGATE_MEMBERS = 100;

/**
 * Deepest nesting a walker descends into a data tree: a `details` subtree in
 * the redaction walker, and a value handed to `cloneJsonSafe`. Each walker
 * recurses once per level, so without the cap a deeply nested input overflows
 * the host stack. Past the cap the redaction walker writes a marker at the
 * deep end, so the shallow fields survive, and the clone rejects the value
 * like any other value that is not JSON-safe.
 */
export const MAX_DATA_DEPTH = 100;

/**
 * Total-node budget for one walk over a data tree: a redaction walk, the JSON
 * round-trip of one data value in the log object, and one `cloneJsonSafe`
 * call. The unit is one visited value, a container or a leaf, in all three
 * walkers; the redaction walker charges the values of its data regions only,
 * because the root and cause envelopes are bounded by the spine caps. The depth cap bounds depth, not width, and shared (DAG) references
 * are cloned once per reference, so a small input can legally expand
 * exponentially (`{a, b}` doubling per level). Past the budget the walk
 * degrades to its marker or its rejection instead of running the blowup to
 * completion. The budget sits far above any sane log or wire payload.
 */
export const MAX_DATA_NODES = 100_000;

/**
 * Total number of cause-graph nodes one `StructuredError.fromJSON` call
 * reconstructs. The depth cap and the width cap still allow `100^depth`
 * reconstructions, and a shared reference makes such a payload tiny in
 * memory, so the walk also carries a node budget. The serializer has no
 * total-node cap (depth and width per node compound), so no finite budget
 * covers every legal serializer output, and this value cannot come from the
 * serializer caps. 10,000 is a deliberate ceiling: every realistic log shape
 * round-trips losslessly, while a hostile payload is capped at about 10^4
 * stack captures, which is tens of milliseconds and not seconds.
 */
export const MAX_RECONSTRUCTED_CAUSE_NODES = 10_000;

/**
 * Default of the `maxNodes` option of the tree traversal (`aggregates: true`).
 * The caller can raise it. The default keeps a retry decision over a wide
 * fan-out cheap by construction.
 */
export const DEFAULT_TRAVERSAL_NODES = 1000;
