# Type guards & assertions

Narrowing helpers for `unknown` values (every `catch` gives you `unknown`), and
an assertion helper for invariants.

## Type guards

```ts
import {
  hasErrorCode,
  isAllOf,
  isAnyErrorOf,
  isBaseError,
  isError,
  isErrorOf,
  isStructuredError,
  isRetryable,
} from "@shirudo/base-error";
```

| Guard                           | Narrows to                        | Notes                                            |
| ------------------------------- | --------------------------------- | ------------------------------------------------ |
| `isError(v)`                    | `ErrorLike`                       | native instance or portable structural shape     |
| `hasErrorCode(code)(v)`         | `ErrorLike & { code }`            | exact string/number code                         |
| `isErrorOf(Constructor)(v)`     | constructor instance              | local `instanceof`, optional predicate           |
| `isAnyErrorOf(v, constructors)` | union of constructor instances    | local `instanceof`, empty list is false          |
| `isAllOf(v, guards)`            | intersection of guard targets     | non-empty list, ordered and short-circuiting     |
| `isBaseError(v)`                | `BaseError<string>`               | `instanceof BaseError`                           |
| `isStructuredError(v)`          | `StructuredError<string, string>` | instance **or** structural shape                 |
| `isRetryable(v)`                | `{ retryable: true }`             | duck-typed: any object with `retryable === true` |

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

### Native and Node.js-style errors

`isError` recognizes native errors and portable error-like objects with string
`name` and `message` fields (plus an optional string `stack`). Structural
recognition works after a realm boundary, but establishes shape only—not local
`instanceof Error` identity or trust.

Use `hasErrorCode` for Node.js system errors and third-party errors with stable
string or numeric codes. The code remains a literal after narrowing:

```ts
try {
  await readConfig();
} catch (error) {
  if (hasErrorCode("ENOENT")(error)) {
    error.code; // "ENOENT"
    error.message; // string
    return defaultConfig;
  }
  throw error;
}
```

A bare `{ code: "ENOENT" }` does not match; the value must also be error-like.
Property inspection fails closed for hostile proxies or throwing getters.

### Constructor guards

`isErrorOf` creates a reusable local `instanceof` guard. Its optional predicate
adds runtime filtering but does not claim more type precision than the class:

```ts
const isServerFailure = isErrorOf(NetworkError, (error) => error.status >= 500);

if (isServerFailure(error)) {
  error; // NetworkError
}
```

Use `isAnyErrorOf` when several classes share a control-flow branch:

```ts
if (isAnyErrorOf(error, [TimeoutError, ConnectionError] as const)) {
  scheduleRetry(error); // TimeoutError | ConnectionError
}
```

Constructor guards intentionally use local `instanceof` identity and therefore
do not claim to survive workers or iframe boundaries.

### Guard composition

`isAllOf` requires a non-empty guard list and narrows to the intersection of all
guard targets:

```ts
if (isAllOf(error, [isError, hasErrorCode("EPIPE")] as const)) {
  error.message; // string
  error.code; // "EPIPE"
}
```

Guards run in order and stop at the first false result. Exceptions from custom
guards are caller-code failures and propagate.

### Trust boundary

Structural guards (`isError`, `hasErrorCode`, `isStructuredError`,
`isRetryable`) are forgeable. Use them for classification and control flow, not
as authorization to disclose details, trust network payloads, or execute domain
behavior. Constructor guards establish local identity but are realm-local.

Catalog guards add a stronger, catalog-local guarantee. `AppErrors.is(value)`
accepts only instances created by that exact catalog and rejects structurally
similar, deserialized and foreign-catalog values. Use it when domain behavior
depends on membership in your closed catalog. Use structural guards when shape
recognition across a realm or wire boundary is the intended behavior.

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
  return presenter.present(err, { locales: ["en"] }); // safe public view
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
