# Type guards & assertions

Narrowing helpers for `unknown` values (every `catch` gives you `unknown`), and
an assertion helper for invariants.

## Type guards

```ts
import {
  isBaseError,
  isStructuredError,
  isRetryable,
} from "@shirudo/base-error";
```

| Guard                  | Narrows to                        | Notes                                            |
| ---------------------- | --------------------------------- | ------------------------------------------------ |
| `isBaseError(v)`       | `BaseError<string>`               | `instanceof BaseError`                           |
| `isStructuredError(v)` | `StructuredError<string, string>` | instance **or** structural shape                 |
| `isRetryable(v)`       | `{ retryable: true }`             | duck-typed: any object with `retryable === true` |

```ts
try {
  await doWork();
} catch (e) {
  if (isStructuredError(e)) {
    e.code; // typed; narrow further with matchError
  } else if (isBaseError(e)) {
    e.timestamp; // BaseError fields available
  }
  throw e;
}
```

### `isStructuredError` is two-phase

It first checks `instanceof StructuredError` (the common case), then falls back
to **duck-typing**: any object with `code: string`, `category: string` and
`retryable: boolean`. The fallback is deliberate: it recognizes structured
errors that crossed a realm boundary (worker/iframe) or were serialized and
parsed back, where `instanceof` no longer holds.

The cost of duck-typing is that an unrelated object with those three fields also
passes. When you need a guaranteed real instance, use `instanceof StructuredError`
directly.

## `guard()`: invariant assertions

`guard` throws the given error when a condition is falsy, and narrows the type
on the truthy path (a TypeScript assertion signature):

```ts
import { guard } from "@shirudo/base-error";

function getName(user: User | null): string {
  guard(user, new UserNotFoundError(id));
  return user.name; // user is narrowed to `User` here
}
```

Pass a **factory** when the error is expensive to build. It is only constructed
on failure, not on the happy path:

```ts
guard(user, () => new UserNotFoundError(id));
```

## `toStructuredError()`: coerce any caught value

Where guards _narrow_, `toStructuredError` _guarantees_: it turns any `unknown`
into a `StructuredError`, giving an unexpected failure a consistent, loggable,
safe-to-serialize **envelope** at the boundary.

```ts
import { toStructuredError } from "@shirudo/base-error";

try {
  await repo.save(order);
} catch (e) {
  if (e instanceof TypeError) throw e; // a bug: surface it, don't swallow
  const err = toStructuredError(e, {
    code: "ORDER_PERSIST_FAILED",
    category: "INFRASTRUCTURE",
    retryable: true,
  });
  logger.error(err.toLogObject());
  return err.toProblemDetails({ status: 503 });
}
```

| Input               | Result                                                     |
| ------------------- | ---------------------------------------------------------- |
| a `StructuredError` | returned unchanged (options ignored)                       |
| any other `Error`   | wrapped: its `message` kept, original preserved as `cause` |
| a `string`          | becomes the message                                        |
| anything else       | fallback message, value preserved as `cause`               |

Honest defaults: `code` `"UNKNOWN_ERROR"`, `category` `"INTERNAL"`, `retryable`
`false`. It is a **boundary/observability tool, not a modeling tool**: it does
not fabricate domain semantics, and you should rethrow genuine programmer bugs
(`TypeError`/`RangeError`/assertions) rather than wrap them.

Because its second parameter is optional, it slots directly into the
error-mapper position of a `Result` type's `fromThrowable`-style constructor:

```ts
const r = Result.fromThrowable(() => JSON.parse(input), toStructuredError);
```

## Cause-chain guards

For walking and testing `cause` chains there are dedicated guards
(`isErrorWithCause`, `isRetryableStructuredError`) and helpers
(`isChainRetryable`, `someChainRetryable`, …); see
[Cause chains](./cause-chains).
