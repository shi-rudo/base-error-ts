# Handling caught errors

A `catch` gives you `unknown`. Narrow it, dispatch on it, or wrap it; never
assume its shape.

## Guards

| Guard | Narrows to | Trust |
| --- | --- | --- |
| `Errors.is(v)`, `Errors.is(v, "CODE")` | that catalog's union, or one member | strongest: only instances this catalog created |
| `isErrorOf(Class, predicate?)(v)` | the class instance | local `instanceof`, not across realms |
| `isAnyErrorOf(v, [A, B] as const)` | `A \| B` | local `instanceof` |
| `isBaseError(v)` | `BaseError` | `instanceof` |
| `isStructuredError(v)` | `StructuredError` | `instanceof`, then shape (`code`, `category`, `retryable`) |
| `isError(v)` | error-like | shape only |
| `hasErrorCode("ENOENT")(v)` | error-like with that literal `code` | shape only; for Node.js and third-party codes |
| `isRetryable(v)` | `{ retryable: true }` | shape only |
| `isAllOf(v, [g1, g2] as const)` | intersection of the guards | as its guards |

Shape guards recognize errors that crossed a worker, iframe or wire boundary,
and they can be forged. Use them for classification, not to decide what to
disclose or which domain behavior to run. All guards fail closed: a throwing
getter or proxy reads as "no match".

## Closed dispatch: `matchError`

Exhaustive over a closed union of literal codes, with per-case narrowing of
`details`. A missing code is a compile error unless a `_` case catches the
rest:

```ts
import { matchError } from "@shirudo/base-error";

if (OrderErrors.is(e)) {
  return matchError(e, {
    ORDER_NOT_FOUND: (x) => notFound(x.details?.orderId),
    STOCK_RESERVATION_FAILED: () => retryLater(),
  });
}
throw e;
```

Narrow from `unknown` first; exhaustiveness needs the union type. Per-case
`details` narrowing needs a union of distinct error types, which a catalog
gives; a single `StructuredError<"A" | "B">` narrows only the code.

## Closed classes: `defineErrorClassSet`

For a group of local Error classes the application owns:

```ts
import { defineErrorClassSet } from "@shirudo/base-error";

const NetworkErrors = defineErrorClassSet({ timeout: TimeoutError, refused: ConnectionRefusedError });

const action = NetworkErrors.match(e, {
  timeout: () => "retry" as const,
  refused: () => "reconnect" as const,
});
```

Every key needs exactly one handler. `match` throws when the value is none of
the classes; list subclasses before their base classes.

## Open world: `matchThrown`

For values the application does not own (native errors, third-party classes,
Node.js codes, anything thrown):

```ts
import { hasErrorCode, matchThrown } from "@shirudo/base-error";

return matchThrown(e)
  .with(SyntaxError, () => defaults)
  .when(hasErrorCode("ENOENT"), () => defaults)
  .withAny([TimeoutError, ConnectionRefusedError] as const, (x) => retry(x))
  .otherwise((other) => {
    throw other;
  });
```

`.otherwise` is mandatory; cases run in order, the first match wins, and
handler exceptions propagate. There is no `.exhaustive()`.

## Wrapping: `toStructuredError`

Turns any caught value into a `StructuredError` so it can be logged and
projected:

```ts
import { toStructuredError } from "@shirudo/base-error";

try {
  await store.save(order);
} catch (e) {
  if (e instanceof TypeError || e instanceof RangeError) throw e; // a bug: surface it
  const wrapped = toStructuredError(e, {
    code: "ORDER_PERSIST_FAILED",
    category: "INFRASTRUCTURE",
    retryable: true,
  });
  logger.error({ err: wrapped });
  return project(publicErrors, wrapped);
}
```

- A real `StructuredError` passes through unchanged and ignores the options.
- Another error is wrapped with its message kept and the original as `cause`.
- A string becomes the message; anything else gets a fallback message and is
  kept as `cause`.
- Without options the defaults are `UNKNOWN_ERROR`, `INTERNAL`, `retryable:
  false`. It invents no domain meaning; model expected failures with a catalog.
- Its optional second parameter lets it serve as the error mapper of a
  `Result` constructor, such as `Result.fromThrowable(fn, toStructuredError)`.

## Invariants: `guard`

```ts
import { guard } from "@shirudo/base-error";

guard(order, () => OrderErrors.create.ORDER_NOT_FOUND("order missing", { details: { orderId } }));
order.lines; // narrowed to the non-null type
```

Pass a factory when the error is costly to build; it runs only on failure.

## Cause chains and retryability

| Helper | Returns |
| --- | --- |
| `getRootCause(e, maxDepth?)` | the deepest cause, cycle- and depth-safe |
| `findInCauseChain(e, predicate)` | the first matching link |
| `filterCauseChain`, `someCauseChain`, `everyCauseChain` | all matches, any, every |
| `isChainRetryable(e)` | a full `StructuredError` in the chain is retryable |
| `someChainRetryable(e)` | any link has `retryable === true` |
| `getRootCauseRetryable(e)`, `getFirstRetryableCause(e)` | the root's flag, the first retryable link |

A nullish `cause` ends the chain. The helpers follow `cause` only; pass
`{ aggregates: true }` to also visit the members of an `AggregateError` or
`StructuredAggregateError`.
