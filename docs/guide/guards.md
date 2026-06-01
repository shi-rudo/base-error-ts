# Type guards & assertions

Narrowing helpers for `unknown` values (every `catch` gives you `unknown`), and
an assertion helper for invariants.

## Type guards

```ts
import { isBaseError, isStructuredError, isRetryable } from "@shirudo/base-error";
```

| Guard | Narrows to | Notes |
| --- | --- | --- |
| `isBaseError(v)` | `BaseError<string>` | `instanceof BaseError` |
| `isStructuredError(v)` | `StructuredError<string, string>` | instance **or** structural shape |
| `isRetryable(v)` | `{ retryable: true }` | duck-typed: any object with `retryable === true` |

```ts
try {
  await doWork();
} catch (e) {
  if (isStructuredError(e)) {
    e.code; // typed — narrow further with matchError
  } else if (isBaseError(e)) {
    e.timestamp; // BaseError fields available
  }
  throw e;
}
```

### `isStructuredError` is two-phase

It first checks `instanceof StructuredError` (the common case), then falls back
to **duck-typing** — any object with `code: string`, `category: string` and
`retryable: boolean`. The fallback is deliberate: it recognizes structured
errors that crossed a realm boundary (worker/iframe) or were serialized and
parsed back, where `instanceof` no longer holds.

The cost of duck-typing is that an unrelated object with those three fields also
passes. When you need a guaranteed real instance, use `instanceof StructuredError`
directly.

## `guard()` — invariant assertions

`guard` throws the given error when a condition is falsy, and narrows the type
on the truthy path (a TypeScript assertion signature):

```ts
import { guard } from "@shirudo/base-error";

function getName(user: User | null): string {
  guard(user, new UserNotFoundError(id));
  return user.name; // user is narrowed to `User` here
}
```

Pass a **factory** when the error is expensive to build — it is only constructed
on failure, not on the happy path:

```ts
guard(user, () => new UserNotFoundError(id));
```

## Cause-chain guards

For walking and testing `cause` chains there are dedicated guards
(`isErrorWithCause`, `isRetryableStructuredError`) and helpers
(`isChainRetryable`, `someChainRetryable`, …) — see
[Cause chains](./cause-chains).
