# Cause chains

Errors wrap other errors. `BaseError` preserves the native `cause` across
runtimes, and the package ships traversal helpers for walking and querying the
chain, useful for retry logic, root-cause logging and diagnostics.

```ts
import { getRootCause, findInCauseChain } from "@shirudo/base-error";
```

## Walking the chain

| Helper                               | Returns                                   |
| ------------------------------------ | ----------------------------------------- |
| `getRootCause(error, maxDepth?)`     | The deepest cause (cycle- and depth-safe) |
| `findInCauseChain(error, predicate)` | First matching error in the chain         |
| `filterCauseChain(error, predicate)` | All matching errors                       |
| `someCauseChain(error, predicate)`   | `true` if any link matches                |
| `everyCauseChain(error, predicate)`  | `true` if every link matches              |

```ts
const root = getRootCause(error);

const timeout = findInCauseChain(
  error,
  (e) => e instanceof StructuredError && e.code === "QUERY_TIMEOUT",
);
```

## Retryability across the chain

Whether an operation can be retried often depends not on the top error but on
something deeper in the chain:

| Helper                          | Meaning                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `isChainRetryable(error)`       | At least one full `StructuredError` in the chain is retryable  |
| `someChainRetryable(error)`     | At least one link has `retryable === true` (no shape required) |
| `getRootCauseRetryable(error)`  | Retryability of the root cause                                 |
| `getFirstRetryableCause(error)` | First retryable error found                                    |

```ts
import { someChainRetryable } from "@shirudo/base-error";

if (someChainRetryable(error)) {
  await retryWithBackoff();
}
```

## Guards

`isErrorWithCause(value)` and `isRetryableStructuredError(value)` are type
guards for narrowing unknown values while traversing.

## Aggregate errors: opt in

By default the helpers follow `cause` and nothing else. An `AggregateError`
(from `Promise.any`, or from a dual-stack connect failure on Node 20+) holds its
branch failures in `errors`, and that array is skipped:

```ts
const aggregate = new AggregateError([retryableTimeout, retryableRefused]);
const err = new StructuredError({
  code: "QUERY_FAILED",
  /* ... */ cause: aggregate,
});

someChainRetryable(err); // false: the branches are not visited
someChainRetryable(err, { aggregates: true }); // true
```

Every helper that takes a `maxDepth` number also takes an options object:

| Option       | Default | Meaning                                                       |
| ------------ | ------- | ------------------------------------------------------------- |
| `maxDepth`   | `100`   | Maximum number of hops to follow. A member counts as one hop. |
| `aggregates` | `false` | Also walk `errors`, on any value that carries that shape.     |
| `maxNodes`   | `1000`  | Maximum nodes visited when `aggregates` is on.                |

With `aggregates: true` the walk is depth-first: a node, then its `cause`, then
its members. `maxNodes` exists because depth bounds a chain but not the width of
a tree; past the budget the walk stops, so a wide aggregate degrades to a
partial answer instead of unbounded work. Cycles and shared branches end at the
repeated node, as in the linear walk.

`getRootCause` takes no `aggregates` option on purpose: a tree has no single
deepest node, so "the root cause" of an aggregate is not defined. Use
`filterCauseChain(err, predicate, { aggregates: true })` to collect the branches
instead.

The default stays linear so an existing retry decision cannot change meaning
under your feet. Logs never needed the opt-in: `toLogObject()` always serializes
aggregate members (see [Observability & logging](./observability)).

## Serialization

`toLogObject()` already serializes the cause chain (cycle-safe, and depth-capped
at 100 so a pathologically deep chain can't overflow the stack), so your logs
capture the full provenance without manual walking. See
[Observability & logging](./observability).
