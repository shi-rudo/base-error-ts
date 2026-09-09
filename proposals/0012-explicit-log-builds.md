# Explicit log builds and checked consumer fields

Status: implemented on PR #23; release: unreleased.

## Responsibility

The error model owns a bounded log representation, cause traversal, and redaction.
Consumers own log delivery, layout, and conversion into the recommended `OwnLogFields` contract.
The next major removes the wide `buildLogObject()` hook.
The library reads the fixed envelope itself, independently of `buildOwnLogFields()`.
`StructuredError` uses this assembly directly, so a subclass cannot replace its fields through the data hook.
The legacy record copier, continuation, cut suffix, and multi-stage fallback are removed.
Each instance property is read through the guarded reader; an unreadable field does not discard its siblings.
Root `details` keeps its existing value semantics. This decision does not migrate root details to the data copier.

The library retains its bounded data copier in `src/errors/log-data.ts`.
It is not a general JSON serializer and is not a new package export.
Its compatibility contract includes JSON conversions, callbacks, and boxed primitives already supported by this package.
Direct tests compare that contract against native JSON and pin intentional differences:
bigint strings, bounded cuts, failure markers, and primitive diagnostic views of nested errors.
Top-level nonfinite numbers and negative zero retain the existing JavaScript-value behavior.
Foreign reads remain guarded. Descriptor inspections and copied values consume an explicit allowance.
Redaction and serialization share one position rule in `log-position.ts`.
Private container provenance preserves serializer depth cuts through redaction copies.
At the depth cap, redaction emits a fresh empty container and copies no consumer fields.
After node exhaustion, already-read scalar envelope fields retain their values and types.
Non-scalar envelope fields are omitted without expansion. This preserves decisions such as `retryable: false`.

## Execution context

Each public `toLogObject()` call creates its own context.
Cause traversal, field inspection, and data copying receive that context explicitly.
No current-build variable or re-entrancy switch controls another public call.

A BaseError encountered as data receives a shallow diagnostic view directly.
The data copier does not call its `toJSON`, hooks, or cause traversal.
A private-brand check recognizes local instances without traversing consumer prototypes.
An explicit public call from consumer code retains normal public behavior.
Consumer callbacks must terminate; the library cannot interrupt their synchronous work.

The build context is private to library traversal. Consumers receive no continuation.
Explicit public calls from consumer code still start independent bounded builds.

## Redaction read allowance

Each built-in policy walk has one explicit allowance for classification, key inspections, and value reads.
The guard and the copy loop share it, including non-enumerable keys and cause-array indices.
The limit uses the existing 100,000 data allowance and can precede the separate value-node limit.
After exhaustion, the existing fail-closed boundary retains correctly typed non-sensitive envelope fields.
Its message names a redaction-size cut. It omits payload, stack, and links.
An uninspected object cannot become an opaque leaf and expose inherited serialization callbacks.
Message masking records envelope header values during the bounded copy and then updates only the copied targets.
There is no second raw traversal. Changing getters cannot invalidate the masking of a previously copied stack.
Consumer callbacks and reflection traps must terminate. The library cannot interrupt their internal work.

## Contract diagnostics

`inspectOwnLogFields` is an explicit consumer-test function.
It inspects a returned record without executing getters or serialization callbacks.
It reports reserved names such as `details`, unsupported values, and inspection limits.
The inspector checks up to 1,000 root keys and continues past the 100-field retention limit.
It reports retention width only for more than 100 valid data fields. Skipped fields have separate contract issues.
An empty issue list means the bounded inspection found no contract violation.
The function is never invoked by the production logging path.
It does not add diagnostic keys or expand marker exceptions.

## Costs and rejected alternatives

This change removes ambient coupling and the legacy envelope repair path.
It does not remove ownership of the data-copy algorithm or make the feature small.
Native JSON cannot enforce our inspection allowance before descriptor reads.
Narrowing runtime inputs now would change established cause-data behavior.
The library therefore keeps the copier with independent compatibility and adversarial tests.
The performance comparison remains reproducible in `scripts/benchmark-log-serialization.mjs`.
