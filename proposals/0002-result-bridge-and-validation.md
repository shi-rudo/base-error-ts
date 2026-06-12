# Proposal 0002: `toStructuredError` bridge & validation aggregate

**Status:** Accepted. Decisions locked (see _Decisions_ below). Implementation
sequenced: `toStructuredError` first, validation aggregate second.
**Context:** `Result<T, E>` is intentionally _out of scope_ for this library and
lives in [`@shirudo/result`](https://github.com/shi-rudo/result-ts), whose `E`
is unconstrained, so `StructuredError` already fits as the error type. This
proposal closes the two remaining DDD gaps:

1. **`toStructuredError`:** a canonical `unknown → StructuredError` coercion
   that gives any caught value a consistent **structured envelope** at the
   boundary (it does _not_ fabricate a domain error; see the framing note). The
   missing piece at the seam with `@shirudo/result`: the `errorMapper` slot of
   `fromThrowable` / `fromPromise` and the `errorFn` of `filter` all want a stable
   way to wrap an arbitrary thrown value. Also useful standalone in `catch`.
2. **Validation aggregate:** collect N field-level failures into one error that
   can serialize to an RFC 9457 `errors[]` extension **on explicit opt-in**. The
   most common DDD/enterprise need (value-object / command validation) that the
   library cannot express today.

Both stay zero-dependency and **do not** depend on `@shirudo/result` (the bridge
is decoupled; it just happens to fit result-ts's mapper slots).

---

## Part 1: `toStructuredError`

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
>(
  value: unknown,
  options?: CoerceOptions<TCode, TCategory>,
): StructuredError<TCode, TCategory>;
```

### Behavior

| Input `value`                                   | Result                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| already a `StructuredError` **instance**        | returned as-is (no double-wrap, options ignored)                                                            |
| any other `Error` (incl. plain `BaseError`)     | new `StructuredError`: `message = value.message`, `cause = value`, defaults from options                    |
| `string`                                        | `message = value`, no cause, defaults from options                                                          |
| anything else (number, object, null, undefined) | `message = options.message ?? "Unknown error"`, `cause = value` (preserved for logs), defaults from options |

- The original value is preserved as `cause` whenever it is an `Error` or a
  non-string object, so the chain/stack survives (the Anti-Corruption-Layer
  "wrap the foreign thing" pattern).
- Pass-through is by `instanceof StructuredError` only. A duck-typed plain object
  that _looks_ structured is treated as foreign and wrapped. Reconstructing
  serialized errors is `fromJSON`'s job (proposal 0003), not coercion's.

### Framing: an envelope, not a domain error

An unknown thrown value is almost always an _unexpected_/infrastructure failure
or a programmer bug, **not** a domain error. `toStructuredError` does not
fabricate domain semantics; it gives the unexpected failure a consistent,
loggable, safe-to-serialize **envelope** at the boundary. The honest defaults
encode exactly that: `code = "UNKNOWN_ERROR"`, `category = "INTERNAL"`,
`retryable = false`.

This is a boundary/observability tool, not a modeling tool. In particular, do
**not** use it to swallow programmer errors: a `TypeError`/`RangeError`/assertion
is a bug, and wrapping it into a tidy envelope where it gets "handled" hides it.
At a catch-all, prefer to rethrow genuine bugs and coerce only what you mean to
turn into a response:

```ts
catch (e) {
  if (e instanceof TypeError || e instanceof RangeError) throw e; // a bug: surface it
  return toStructuredError(e).toProblemDetails({ status: 500 });
}
```

The library deliberately does **not** auto-classify bugs (a `TypeError` can be
thrown legitimately); that judgement stays with the caller.

### result-ts integration

```ts
import { Result } from "@shirudo/result";
import { toStructuredError } from "@shirudo/base-error";

// errorMapper slot: no hand-written mapper.
const r = Result.fromThrowable(() => JSON.parse(input), toStructuredError);

// or customized per call site:
const r2 = Result.fromPromise(db.query(sql), (e) =>
  toStructuredError(e, {
    code: "DB_ERROR",
    category: "INFRASTRUCTURE",
    retryable: true,
  }),
);
```

`toStructuredError`'s optional second parameter means it satisfies the
`(unknown) => E` mapper shape directly.

### Resolved (shipped in `src/errors/coerce.ts`)

- **Default `code`** = `"UNKNOWN_ERROR"` (distinct from the public
  `INTERNAL_ERROR`), `category` `"INTERNAL"`, `retryable` `false`.
- **`cause`**: non-Error values (objects/numbers/null) are preserved as `cause`;
  a bare string only becomes the message.
- **Naming**: `toStructuredError`.

### Test plan

- Pass-through identity for a real `StructuredError`.
- `Error` → message/cause preserved, defaults applied.
- `string`, `number`, `null`, `undefined`, plain object → correct fallback +
  cause preservation.
- Options override code/category/retryable/message/public\*.
- Typed: literal `code`/`category` from options flow into the return type
  (verified via `tsc`).
- Plugs into a `(unknown) => StructuredError` mapper slot (type-level).

---

## Part 2: Validation aggregate

Collect multiple field failures into one error and emit RFC 9457 `errors[]`.

```ts
import { ValidationError } from "@shirudo/base-error";

const v = new ValidationError("Registration is invalid");
if (!isEmail(email))
  v.addIssue({ message: "Enter a valid email.", path: ["email"] });
if (age < 18) v.addIssue({ message: "Must be 18 or older.", path: ["age"] });
if (v.hasIssues()) throw v;

// Or pipe a validator's issues straight in (Standard Schema):
const result = schema["~standard"].validate(input);
if (result.issues)
  throw new ValidationError("Invalid input", { issues: result.issues });
```

### Types & API

```ts
// Structurally identical to Standard Schema's `Issue` (standardschema.dev), so
// validator output from Zod / Valibot / ArkType / TanStack Form pipes straight
// in with no remapping, and with no dependency (the shape is matched, not
// imported). Extra fields a validator attaches are kept for logs but NEVER
// cross to a client (see `publicIssues` / RFC 9457 mapping).
export type ValidationIssue = {
  /** Human-readable message. Keep it client-safe if you choose to expose it. */
  readonly message: string;
  /** Path to the offending value (Standard Schema form). */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

export class ValidationError extends StructuredError<
  "VALIDATION_FAILED",
  "VALIDATION",
  { issues: ValidationIssue[] }
> {
  constructor(
    message: string,
    options?: { issues?: ValidationIssue[]; cause?: unknown },
  );

  /** Append an issue; returns `this` for chaining. */
  addIssue(issue: ValidationIssue): this;
  /** Append many. */
  addIssues(issues: ValidationIssue[]): this;
  /** True when at least one issue was collected. */
  hasIssues(): boolean;
  /** Full collected issues (with any validator extras), for internal/log use. */
  readonly issues: readonly ValidationIssue[];

  /**
   * The client-safe projection of the issues: a fixed whitelist
   * (`message`, `path`, `code?`, `pointer?`); never raw validator extras.
   * This is the only shape allowed to cross to a client, and only when the
   * caller explicitly includes it (see RFC 9457 mapping).
   */
  publicIssues(options?: {
    mapIssue?: (issue: ValidationIssue) => PublicIssue;
  }): PublicIssue[];
}

/** The fixed, client-safe shape an issue takes on the wire. */
export type PublicIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
  /** Included only when the source issue carried one. */
  code?: string;
  /** Optional derived string path (e.g. "address.zip") for HTTP clients. */
  pointer?: string;
};
```

- `code = "VALIDATION_FAILED"`, `category = "VALIDATION"`, `retryable = false`
  baked in, so it slots into a catalog union and `matchError`/`matchTag` like any
  other structured error.
- Overrides `_tag` to the literal `"ValidationError"` (minification-safe,
  per proposal 0001's reasoning).

### RFC 9457 mapping: opt-in, fixed safe subset, configurable shape

Issues do **not** cross to a client by default. There is **no exception** to
safe-by-default: a `ValidationError` stores its full issues internally
(`toLogObject` has them, with any validator extras), and surfacing them is an
explicit, reviewable opt-in, exactly like `expose` / `mapDetails` elsewhere.
The caller, who knows the messages are client-safe, asks for them.

Two mechanical guarantees:

1. **Only a fixed whitelist crosses.** Whatever is stored, `publicIssues()`
   yields only `{ message, path, code?, pointer? }`, never raw validator extras
   (a Zod native issue may carry `received`/the rejected input value; those must
   never reach the wire).
2. **Crossing is explicit**, reusing the existing `extensions` mechanism:

```ts
v.toProblemDetails({ status: 422, extensions: { errors: v.publicIssues() } });
// {
//   status: 422,
//   detail: "Registration is invalid",
//   code: "INTERNAL_ERROR",          // still safe-by-default
//   retryable: false,
//   errors: [
//     { message: "Enter a valid email.", path: ["email"] },
//     { message: "Must be 18 or older.", path: ["age"] },
//   ],
// }
```

An optional `includeIssues: true` convenience flag may do exactly the same
(emit `publicIssues()` under the configured key), sugar over the explicit form,
not a hidden default.

#### Standard Schema in, configurable shape out

These are two different layers and we use both:

- **Ingestion = Standard Schema.** `ValidationIssue` matches it, so validator
  output pipes in unchanged.
- **Wire shape = the caller's transport contract.** RFC 9457 does **not** mandate
  any validation format (`invalid-params` was only a non-normative example in
  RFC 7807's appendix). So the output shape and key are configurable:
  - Default: a neutral `errors: [{ message, path, code? }]`.
  - RFC-7807 preset: `invalid-params: [{ name, reason }]`, where `name` is the
    stringified path and `reason` the message, available via the `mapIssue`
    hook + an `extensionKey` option.
  - Any custom shape via `mapIssue`.

Status is never defaulted by the type; the boundary chooses (commonly 400/422).

### result-ts integration

`Result` short-circuits on the first `Err`, so multi-error accumulation is
imperative (collect issues, then one `ValidationError`): the idiomatic pattern.
Once built, it composes like any error:

```ts
function parseRegistration(
  input: unknown,
): Result<Registration, ValidationError> {
  const v = new ValidationError("Registration is invalid");
  // ...collect issues...
  return v.hasIssues() ? Result.err(v) : Result.ok(registration);
}
```

### Resolved decisions

- **Exposure:** opt-in, never default. Surfacing issues is explicit (via
  `publicIssues()` + `extensions`, or an `includeIssues` sugar flag). No
  exception to safe-by-default.
- **What can cross:** only the fixed `PublicIssue` whitelist
  (`message`/`path`/`code?`/`pointer?`), never raw validator extras.
- **Ingestion vs wire:** Standard Schema in; output shape/key configurable
  (default `errors`/`{message,path,code?}`, RFC-7807 `invalid-params`/`{name,reason}`
  preset via `mapIssue`).
- **Subclass vs standalone:** subclass `StructuredError` (keeps `instanceof`,
  `code`, catalog, match). Resolved.
- **Issue shape:** Standard Schema's `Issue`. Resolved.

### Resolved (shipped in `src/errors/validation.ts`)

- **`code`/`category` override**: allowed as an optional generic override,
  defaulting to `VALIDATION_FAILED`/`VALIDATION`.

### Test plan

- `addIssue`/`addIssues`/`hasIssues` accumulation; `issues` getter returns a
  read-only view (internal array is appended to, not reassigned by callers).
- `instanceof StructuredError`, `code === "VALIDATION_FAILED"`, stable `_tag`.
- **Default does NOT expose issues**: `toProblemDetails()` without opt-in has no
  `errors[]`.
- `publicIssues()` returns only the whitelist; **validator extras
  (e.g. Zod `received`) never appear** even when present on stored issues.
- Opt-in via `extensions` / `includeIssues` emits the chosen key/shape; standard
  members still win (issues can't override `code`/`status`).
- `mapIssue` produces the RFC-7807 `invalid-params`/`{name,reason}` shape.
- `toLogObject` carries the full issues (with extras) for logs.
- Empty aggregate (no issues) behaves sanely.

---

## Sequencing

1. **`toStructuredError`** first: tiny, pure, immediately closes the result-ts
   seam. Low risk.
2. **Validation aggregate** second: larger (new class + RFC 9457 projection +
   docs). Dogfood the `errors[]` shape before locking the extension key.

## Decisions (locked)

1. `toStructuredError` default internal `code` = `"UNKNOWN_ERROR"`,
   `category` = `"INTERNAL"`, `retryable` = `false`.
2. Validation issues are **opt-in only** (no default exposure); only the
   `PublicIssue` whitelist (`message`/`path`/`code?`/`pointer?`) can ever cross.
3. Default wire shape `errors`/`{message,path,code?}`, with an RFC-7807
   `invalid-params`/`{name,reason}` preset via the `mapIssue` hook.
4. `ValidationError` is a `StructuredError` subclass.
5. `ValidationError` allows an optional `code`/`category` override, defaulting to
   `"VALIDATION_FAILED"`/`"VALIDATION"`.

## Non-goals

- No `Result` type here; that's `@shirudo/result`.
- No applicative/accumulating validation combinators (imperative collection is
  the v1 story).
- No new runtime dependencies; no dependency on `@shirudo/result`.
