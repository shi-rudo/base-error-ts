# Proposal 0001: Error catalog & exhaustive `matchError`

> Historical v5/v6 design. The catalog surface is superseded by Proposal 0009
> for v7; the `matchError` decision remains current.

**Status:** Draft / for discussion. No implementation yet.
**Audience:** DDD and enterprise users modeling domain errors as a closed set.

## Why

Two recurring needs that teams currently solve with their own wrappers:

1. **Modeling:** domain errors are an algebraic sum type. Today you `switch`
   on `code` with no compile-time guarantee that every case is handled. When a
   new code is added, nothing tells you which call sites are now incomplete.
2. **Governance:** there is no single source of truth that says, for each
   code, its category, retryability, HTTP status and public mapping. That
   metadata ends up scattered across hand-written subclasses, drifting over
   time.

These compose: a catalog (2) defines the closed set; `matchError` (1) consumes
it exhaustively. Both stay type-only / zero-dependency and keep the
safe-by-default philosophy intact.

---

## Part 1: `matchError`

Exhaustive, type-narrowing dispatch on `code`.

```ts
import { matchError } from "@shirudo/base-error";

const message = matchError(err, {
  USER_NOT_FOUND: (e) => `No user ${e.details?.userId}`,
  EMAIL_TAKEN: () => "That email is taken",
  RATE_LIMITED: (e) => `Retry after ${e.details?.retryAfter}s`,
});
```

- If `err`'s type is a **closed union** of error types with literal `code`s and
  you omit a handler, it is a **compile error**, unless you add a `_` default:

  ```ts
  matchError(err, {
    USER_NOT_FOUND: () => 404,
    _: (e) => {
      log(e.code);
      return 500;
    }, // catch-all opt-out
  });
  ```

- Each handler receives the error **narrowed to that case**, so
  `e.details` is the precise per-code type (see catalog interplay below).

### Type sketch

```ts
type Cases<E extends StructuredError<string, string>, R> =
  // exhaustive form: every code must be handled
  | { [K in E["code"]]: (e: Extract<E, { code: K }>) => R }
  // partial form: requires a `_` catch-all
  | ({ [K in E["code"]]?: (e: Extract<E, { code: K }>) => R } & {
      _: (e: E) => R;
    });

export function matchError<E extends StructuredError<string, string>, R>(
  error: E,
  cases: Cases<E, R>,
): R;
```

### Trade-offs / open questions

- **Per-case narrowing needs a real union.** `Extract<E, { code: K }>` only
  narrows `details` etc. when `E` is a _union of distinct_ error types (the
  catalog produces exactly this). For a single
  `StructuredError<"A" | "B">`, all cases share one type, so only `code`
  narrows (still useful, but no per-case `details`).
- **`catch` gives `unknown`.** Callers must narrow first
  (`isStructuredError`) and annotate the union; `matchError` cannot invent
  exhaustiveness from `unknown`. Document this clearly.
- **Default position.** Should `_` receive the full union `E` (proposed) or
  `unknown`? Proposed: the union, so the catch-all stays typed.
- Naming: `matchError` vs `match` vs `fold`. `matchError` avoids collisions.

---

## Part 2: `defineErrors` (catalog)

A declarative single source of truth that generates typed factories.

```ts
import { defineErrors } from "@shirudo/base-error";

export const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    httpStatus: 404,
    publicCode: "USER_NOT_FOUND",
    publicMessage: "The requested user was not found.",
    details: {} as { userId: string }, // per-code details type
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
    httpStatus: 429,
    details: {} as { retryAfter: number },
  },
});

// Construct: category/retryable/public* are baked in from the catalog.
throw AppErrors.USER_NOT_FOUND("user 123 missing in primary db", {
  details: { userId: "123" },
});

// Closed union for matchError:
type AppError = ReturnType<(typeof AppErrors)[keyof typeof AppErrors]>;
```

What the catalog buys:

- **Consistency:** every code provably has a category, retryability, HTTP
  status and public mapping. No drift.
- **Less boilerplate:** no hand-written subclass per code.
- **HTTP status resolution:** the boundary no longer guesses `status`.

  ```ts
  err.toProblemDetails({ status: AppErrors.meta(err.code).httpStatus });
  // or a sugar helper: toProblemDetails(err) that reads the catalog
  ```

- **Docs / OpenAPI generation:** iterate the catalog to emit a code table or
  JSON-Schema for the error responses (separate helper or example, not core).

### Trade-offs / open questions

- **Instances vs nominal classes.** Generating one `StructuredError` instance
  per call (code carried in `.code`) is simplest and gives the union needed by
  `matchError`. Generating a distinct _class_ per code would add per-code
  `instanceof` at the cost of more machinery, likely unnecessary since `code`
  is the discriminant.
- **Factory signature.** Proposed `(message: string, opts?: { details, cause,
publicMessage?, traceId? }) => StructuredError`. Required `details` when the
  per-code details type is non-empty (enforced via the type).
- **`meta()` surface.** A `AppErrors.meta(code)` accessor returns the static
  row (category/httpStatus/…) for boundary code and docs. Keep it minimal.
- **Type complexity.** The mapped types to thread per-code `details` into both
  the factory and the resulting union are advanced; needs care to keep error
  messages readable. This is the main implementation risk.

---

## Decision: tagged instances, not nominal classes per code

`defineErrors` produces **instances of a single `StructuredError`**, with the
literal `code` carried in the type, not a distinct class per code.

Why:

- It faithfully models the domain as a **tagged union / sum type**, the
  functional-DDD representation (Wlaschin) and the modern TS norm (ts-pattern,
  neverthrow, Effect all discriminate on a tag, not a class hierarchy).
- Per-case narrowing in `matchError` does **not** need nominal classes: a
  factory returning `StructuredError<"USER_NOT_FOUND", "NOT_FOUND", { userId }>`
  already gives each union member a literal `code`, so `Extract<E, { code: K }>`
  narrows `details` fully.
- The only thing nominal classes would add is per-code `instanceof`, which is
  **redundant** (`instanceof StructuredError` + `code` + `matchError` cover
  every runtime check), while compounding the per-code-details type machinery
  (the main implementation risk) and nudging users toward scattered,
  non-exhaustive `instanceof` branches that defeat the purpose of `matchError`.
- It is consistent with the stable-`_tag` decision (narrow on `code`, not on a
  per-class tag).

**Escape hatch for OO/framework interop:** anyone who genuinely needs per-code
`instanceof` (e.g. a NestJS exception filter) can still hand-write
`class UserNotFoundError extends StructuredError`, exactly as today. The catalog
is the ergonomic default; manual subclasses remain the opt-out.

## How they compose

```ts
function toResponse(err: AppError) {
  return matchError(err, {
    USER_NOT_FOUND: (e) => e.toProblemDetails({ status: 404, locale: "en" }),
    RATE_LIMITED: (e) =>
      e.toProblemDetails({
        status: 429,
        extensions: { retryAfter: e.details.retryAfter },
      }),
  });
}
```

The catalog defines the set; `matchError` enforces that every member is
handled; the existing safe serializers do the projection.

## Non-goals

- Not a validation/schema library.
- No bundled OpenAPI generator in core (a doc/example at most).
- No new runtime dependencies; both features are type-level + thin factories.

## Suggested sequencing

1. `matchError` first: small, pure types, immediately useful even with
   hand-written unions. Low risk.
2. `defineErrors` second: larger type surface; design the details-threading
   carefully and dogfood against a real catalog before locking the API.
