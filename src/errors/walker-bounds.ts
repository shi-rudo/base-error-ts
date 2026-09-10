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
 * overflow the stack while logging. The public JSDoc of the traversal
 * options in `cause-chain.ts` repeats this number as the consumer's
 * contract; change both together.
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
 * Largest number of own fields one serialized node carries, at the root and on
 * a cause alike. The envelope is written by this library and is fixed, but a
 * subclass contributes its own fields through `buildOwnLogFields`, so the key
 * count of a node is consumer-controlled. This retention cap limits each
 * node independently of the shared build and redaction allowances.
 * Past the cap the reader stops silently.
 * A diagnostic key here could collide with consumer fields.
 */
export const MAX_OWN_LOG_FIELDS = 100;

/**
 * Largest number of keys the own-fields reader examines to fill one node. It
 * sits above {@link MAX_OWN_LOG_FIELDS} because a reserved name and a value
 * with no JSON form are skipped without landing, so the reader needs room to
 * pass them. Reading and copying then cost the cap rather than the length of
 * the record. Enumerating the keys still costs the record's size, because
 * JavaScript has no lazy walk of own keys.
 */
export const MAX_OWN_LOG_FIELDS_READ: number = MAX_OWN_LOG_FIELDS * 10;

/**
 * Deepest nesting in a data tree. The redaction walker writes a marker at
 * the cap, and `cloneJsonSafe` rejects the value. The log data serializer
 * keeps an empty container at the cap, without reading its children.
 * Cause depth counts separately, so a deep cause retains its shallow data.
 */
export const MAX_DATA_DEPTH = 100;

/**
 * Total-node budget for one walk over a data tree: a redaction walk, the JSON
 * copy of log data, and one `cloneJsonSafe` call. Log data shares its
 * allowance with the whole build (MAX_LOG_NODES). The unit is one visited
 * value, a container or a leaf, in these
 * walkers; the redaction walker charges the values of its data regions only,
 * while the shared read allowance covers every redaction region.
 * The depth cap bounds depth, not width, and shared (DAG) references
 * are cloned once per reference, so a small input can legally expand
 * exponentially (`{a, b}` doubling per level). Past the budget the walk
 * degrades to its marker or its rejection instead of running the blowup to
 * completion. The budget sits far above any sane log or wire payload.
 */
export const MAX_DATA_NODES = 100_000;

/**
 * Shared foreign-read allowance for redaction, using the data walk's cap.
 * Classification, own-key enumeration, descriptors, and values each cost one.
 * Exhaustion keeps only the safe envelope with the redaction-size message.
 */
export const MAX_REDACTION_READS: number = MAX_DATA_NODES;

/**
 * Shared allowance for one synchronous log build, including cause nodes and
 * data visits and own-key inspections across all fields. Public calls from
 * consumer callbacks get independent allowances.
 * One final key per active hook can carry a size cut. Fixed scalar envelope
 * fields survive exhaustion without further expansion. Matches the data cap.
 */
export const MAX_LOG_NODES: number = MAX_DATA_NODES;

/**
 * Total cause nodes reconstructed by fromJSON. Stack captures are costlier
 * than log values, so reconstruction gets one tenth of the log allowance.
 */
export const MAX_RECONSTRUCTED_CAUSE_NODES = 10_000;

/**
 * Default of the `maxNodes` option of the tree traversal (`aggregates: true`).
 * The caller can raise it. The default keeps a retry decision over a wide
 * fan-out cheap by construction. The public JSDoc of the traversal options in
 * `cause-chain.ts` repeats this number as the consumer's contract; change
 * both together.
 */
export const DEFAULT_TRAVERSAL_NODES = 1000;
