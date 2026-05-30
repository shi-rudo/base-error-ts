# Proposal 0002 — `toStructuredError` bridge & validation aggregate

**Status:** Draft / for discussion — no implementation yet.
**Context:** `Result<T, E>` is intentionally *out of scope* for this library and
lives in [`@shirudo/result`](https://github.com/shi-rudo/result-ts), whose `E`
is unconstrained — so `StructuredError` already fits as the error type. This
proposal closes the two remaining DDD gaps:

1. **`toStructuredError`** — a canonical `unknown → StructuredError` coercion.
   The missing piece at the seam with `@shirudo/result`: the `errorMapper` slot
   of `fromThrowable` / `fromPromise` and the `errorFn` of `filter` all want a
   stable way to turn an arbitrary thrown value into a domain error. Also useful
   standalone in `catch`.
2. **Validation aggregate** — collect N field-level failures into one error that
   serializes to RFC 9457 with an `errors[]` extension. The most common
   DDD/enterprise need (value-object / command validation) that the library
   cannot express today.

Both stay zero-dependency and **do not** depend on `@shirudo/result` (the bridge
is decoupled — it just happens to fit result-ts's mapper slots).

---

## Part 1 — `toStructuredError`

Guarantee a `StructuredError` from any caught value.

```ts
import { toStructuredError } from "@shirudo/base-error";

try {
  await repo.save(order);
} catch (e) {
  const err = toStructuredError(e, {
    code: "ORDER_PERSIST_FAILED",
    category: "INFRASTRUCTURE",
    retryable: true,
  });
  logger.error(err.toLogObject());
  return err.toProblemDetails({ status: 503 });
}
```

### Signature

```ts
type CoerceOptions<TCode extends string, TCategory extends string> = {
  /** Internal code for the fallback. Default: "UNKNOWN_ERROR". */
  code?: TCode;
  /** Internal category for the fallback. Default: "INTERNAL". */
  category?: TCategory;
  /** Retryable flag for the fallback. Default: false. */
  retryable?: boolean;
  /** Override the technical message (otherwise derived from the value). */
  message?: string;
  /** Public mapping for the fallback. */
  publicCode?: string;
  publicMessage?: string;
};

export function toStructuredError<
  TCode extends string = "UNKNOWN_ERROR",
  TCategory extends string = "INTERNAL",
>(value: unknown, options?: CoerceOptions<TCode, TCategory>): StructuredError<TCode, TCategory>;
```

### Behavior

| Input `value` | Result |
| --- | --- |
| already a `StructuredError` **instance** | returned as-is (no double-wrap, options ignored) |
| any other `Error` (incl. plain `BaseError`) | new `StructuredError`: `message = value.message`, `cause = value`, defaults from options |
| `string` | `message = value`, no cause, defaults from options |
| anything else (number, object, null, undefined) | `message = options.message ?? "Unknown error"`, `cause = value` (preserved for logs), defaults from options |

- The original value is preserved as `cause` whenever it is an `Error` or a
  non-string object, so the chain/stack survives (the Anti-Corruption-Layer
  "wrap the foreign thing" pattern).
- Pass-through is by `instanceof StructuredError` only. A duck-typed plain object
  that *looks* structured is treated as foreign and wrapped — reconstructing
  serialized errors is `fromJSON`'s job (proposal 0003), not coercion's.

### result-ts integration

```ts
import { Result } from "@shirudo/result";
import { toStructuredError } from "@shirudo/base-error";

// errorMapper slot — no hand-written mapper:
const r = Result.fromThrowable(() => JSON.parse(input), toStructuredError);

// or customized per call site:
const r2 = Result.fromPromise(
  db.query(sql),
  (e) => toStructuredError(e, { code: "DB_ERROR", category: "INFRASTRUCTURE", retryable: true }),
);
```

`toStructuredError`'s optional second parameter means it satisfies the
`(unknown) => E` mapper shape directly.

### Open questions

- **Default `code`.** `"UNKNOWN_ERROR"` vs reusing the public `"INTERNAL_ERROR"`
  constant. The internal code and the *public* default (`INTERNAL_ERROR`) are
  different layers; proposed internal default `"UNKNOWN_ERROR"`.
- **Primitives as `cause`.** Setting `cause` to a non-Error (number/object) is
  legal (`cause: unknown`) and preserves info; for bare strings we skip it since
  the message already carries it. Confirm this split.
- Naming: `toStructuredError` vs `ensureStructuredError`. Proposed
  `toStructuredError` (shorter, reads as a conversion).

### Test plan

- Pass-through identity for a real `StructuredError`.
- `Error` → message/cause preserved, defaults applied.
- `string`, `number`, `null`, `undefined`, plain object → correct fallback +
  cause preservation.
- Options override code/category/retryable/message/public*.
- Typed: literal `code`/`category` from options flow into the return type
  (verified via `tsc`).
- Plugs into a `(unknown) => StructuredError` mapper slot (type-level).

---

## Part 2 — Validation aggregate

Collect multiple field failures into one error and emit RFC 9457 `errors[]`.

```ts
import { ValidationError } from "@shirudo/base-error";

const v = new ValidationError("Registration is invalid");
if (!isEmail(email)) v.addIssue({ path: "email", message: "Enter a valid email." });
if (age < 18) v.addIssue({ path: "age", message: "Must be 18 or older.", code: "TOO_YOUNG" });
if (v.hasIssues()) throw v;
```

### Types & API

```ts
export type ValidationIssue = {
  /** Field / JSON-pointer-ish path the issue applies to. */
  path?: string;
  /** Human-readable, client-safe message. */
  message: string;
  /** Optional machine-readable issue code. */
  code?: string;
};

export class ValidationError extends StructuredError<
  "VALIDATION_FAILED",
  "VALIDATION",
  { issues: ValidationIssue[] }
> {
  constructor(message: string, options?: { issues?: ValidationIssue[]; cause?: unknown });

  /** Append an issue; returns `this` for chaining. */
  addIssue(issue: ValidationIssue): this;
  /** Append many. */
  addIssues(issues: ValidationIssue[]): this;
  /** True when at least one issue was collected. */
  hasIssues(): boolean;
  /** Read-only view of the collected issues. */
  readonly issues: readonly ValidationIssue[];
}
```

- `code = "VALIDATION_FAILED"`, `category = "VALIDATION"`, `retryable = false`
  baked in, so it slots into a catalog union and `matchError`/`matchTag` like any
  other structured error.
- Overrides `_tag` to the literal `"ValidationError"` (minification-safe,
  per proposal 0001's reasoning).

### RFC 9457 mapping

Validation issues are the **public contract** — they exist to guide the client.
So `ValidationError.toProblemDetails()` emits them by default as an `errors`
extension member (unlike normal `details`, which stay internal):

```ts
v.toProblemDetails({ status: 422 });
// {
//   status: 422,
//   detail: "Registration is invalid",
//   code: "INTERNAL_ERROR",          // still safe-by-default for code
//   retryable: false,
//   errors: [
//     { path: "email", message: "Enter a valid email." },
//     { path: "age", message: "Must be 18 or older.", code: "TOO_YOUNG" },
//   ],
// }
```

This is a **deliberate, documented exception** to "details never cross": the
issues are author-written, client-safe strings (the same reasoning that lets
localized messages surface). It is implemented on top of the existing
`extensions` mechanism, so the safe-by-default invariant for standard/library
members is untouched (issues can't clobber `code`/`status`/…).

Options:

- `toProblemDetails({ status, extensionKey })` — default key `"errors"`; allow
  `"invalid-params"` (RFC 7807 example style) or a custom name.
- The status is **not** defaulted by the type — the boundary chooses (commonly
  400 or 422).

### result-ts integration

`Result` short-circuits on the first `Err`, so multi-error accumulation is
imperative (collect issues, then one `ValidationError`) — the idiomatic pattern.
Once built, it composes like any error:

```ts
function parseRegistration(input: unknown): Result<Registration, ValidationError> {
  const v = new ValidationError("Registration is invalid");
  // ...collect issues...
  return v.hasIssues() ? Result.err(v) : Result.ok(registration);
}
```

### Open questions

- **Default extension key:** `errors` (proposed) vs `invalid-params` (RFC 7807
  appendix). `errors` is the more common modern convention.
- **Subclass vs standalone:** subclassing `StructuredError` (proposed) keeps it
  in the ecosystem (`instanceof StructuredError`, `code`, catalog, match). A
  standalone `AggregateError`-style type would lose that. Recommend subclass.
- **Issue shape:** `path`/`message`/`code` (proposed) vs richer (severity,
  value). Keep minimal in v1.
- **`toErrorResponse` parity:** should the aggregate also surface issues in
  `toErrorResponse`'s `details`? Likely yes via the same projection.

### Test plan

- `addIssue`/`addIssues`/`hasIssues`/`issues` accumulation and immutability.
- `instanceof StructuredError`, `code === "VALIDATION_FAILED"`, stable `_tag`.
- `toProblemDetails` emits `errors[]`; honors a custom extension key; standard
  members still win (issues can't override `code`/`status`).
- `toLogObject` carries the issues in `details` (full fidelity for logs).
- Empty aggregate (no issues) behaves sanely.

---

## Sequencing

1. **`toStructuredError`** first — tiny, pure, immediately closes the result-ts
   seam. Low risk.
2. **Validation aggregate** second — larger (new class + RFC 9457 projection +
   docs). Dogfood the `errors[]` shape before locking the extension key.

## Decisions to confirm before implementation

1. `toStructuredError` default internal `code` → `"UNKNOWN_ERROR"`?
2. Validation extension key → `"errors"` (default) with opt-in `"invalid-params"`?
3. `ValidationError` as a `StructuredError` subclass (recommended)?

## Non-goals

- No `Result` type here — that's `@shirudo/result`.
- No applicative/accumulating validation combinators (imperative collection is
  the v1 story).
- No new runtime dependencies; no dependency on `@shirudo/result`.
