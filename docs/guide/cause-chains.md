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

| Helper                          | Meaning                                           |
| ------------------------------- | ------------------------------------------------- |
| `isChainRetryable(error)`       | Every `StructuredError` in the chain is retryable |
| `someChainRetryable(error)`     | At least one link is retryable                    |
| `getRootCauseRetryable(error)`  | Retryability of the root cause                    |
| `getFirstRetryableCause(error)` | First retryable error found                       |

```ts
import { someChainRetryable } from "@shirudo/base-error";

if (someChainRetryable(error)) {
  await retryWithBackoff();
}
```

## Guards

`isErrorWithCause(value)` and `isRetryableStructuredError(value)` are type
guards for narrowing unknown values while traversing.

## Serialization

`toLogObject()` already serializes the cause chain (cycle-safe, and depth-capped
at 100 so a pathologically deep chain can't overflow the stack), so your logs
capture the full provenance without manual walking. See
[Observability & logging](./observability).
