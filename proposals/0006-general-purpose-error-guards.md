# Proposal 0006: general-purpose error guards

**Status:** Implemented in Wave 1.

**Target release:** `6.1.0`. The change is additive.

**Dependencies:** None. The implementation remains zero-dependency and must
work in Node.js, browsers, and edge runtimes.

**Context:** the package currently narrows its own error families
(`isBaseError`, `isStructuredError`) and retryability (`isRetryable`), but it
does not provide reusable guards for native errors, Node.js-style error codes,
or arbitrary custom `Error` subclasses. Consumers therefore repeat unsafe
casts in `catch (error: unknown)` blocks. Wave 1 closes that gap and establishes
the guard primitives required by the general matcher planned for Wave 2.

---

## Decision

Add five general-purpose guards and three supporting public types:

```ts
export type ErrorLike = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type TypeGuard<T> = (value: unknown) => value is T;

export type ErrorClass<T extends Error = Error> = abstract new (
  ...args: never[]
) => T;

export function isError(value: unknown): value is ErrorLike;

export function hasErrorCode<const C extends string | number>(
  code: C,
): TypeGuard<ErrorLike & { readonly code: C }>;

export function isErrorOf<T extends Error>(
  constructor: ErrorClass<T>,
  predicate?: (error: T) => boolean,
): TypeGuard<T>;

export function isAnyErrorOf<const C extends readonly ErrorClass[]>(
  value: unknown,
  constructors: C,
): value is InstanceType<C[number]>;

export function isAllOf<
  const G extends readonly [TypeGuard<unknown>, ...TypeGuard<unknown>[]],
>(value: unknown, guards: G): value is GuardIntersection<G>;
```

`GuardIntersection` is an exported or internal helper depending on declaration
emit requirements. It computes the intersection of the types narrowed by the
guards in `G`; it must not collapse heterogeneous guards to one inferred type.

All functions live in `src/errors/guards.ts` and are exported from the package
root. Existing guard names and semantics remain unchanged.

## Semantics

### `isError`

`isError` recognizes:

1. native `Error` instances and subclasses; and
2. cross-realm/error-like objects whose `name` and `message` properties are
   strings and whose `stack`, when present, is a string.

It returns `ErrorLike`, not `Error`, because a structural cross-realm value is
not guaranteed to have the local realm's `Error` prototype. This keeps the
type predicate honest while exposing the portable fields callers need.

Property reads must fail closed: hostile proxies or throwing getters return
`false` instead of making the guard throw. Symbol and primitive inputs return
`false`.

`isError` is a structural classification helper, not proof that data is trusted
or belongs to a domain error type.

### `hasErrorCode`

`hasErrorCode(code)` returns a reusable guard for error-like values whose own or
inherited `code` property is exactly equal to `code`. Codes are limited to
strings and numbers, covering Node.js system errors and common third-party
errors while preserving literal inference.

The value must first satisfy `isError`; an arbitrary DTO such as
`{ code: "ENOENT" }` is not classified as an error. Property access follows the
same fail-closed rule as `isError`.

Examples:

```ts
try {
  await readConfig();
} catch (error) {
  if (hasErrorCode("ENOENT")(error)) {
    error.code; // "ENOENT"
    error.message; // string
  }
}
```

### `isErrorOf`

`isErrorOf(Constructor)` returns a reusable `instanceof` guard for a concrete
local constructor. The optional predicate applies additional runtime filtering:

```ts
const isServerFailure = isErrorOf(NetworkError, (error) => error.status >= 500);
```

The returned type remains `NetworkError`; a boolean predicate cannot prove a
more specific numeric range. Predicate exceptions are not swallowed because
they are caller-code failures, not failed structural inspection.

This guard deliberately does not pretend that generic constructors have stable
cross-realm identity. Wave 4 may provide stable static guards for generated
error classes.

### `isAnyErrorOf`

`isAnyErrorOf(value, constructors)` returns true when `value instanceof` any
constructor. A readonly tuple preserves the union of all instance types. An
empty constructor list is valid and returns false.

### `isAllOf`

`isAllOf(value, guards)` requires a non-empty readonly tuple and returns true
only when every guard matches. Its narrowed type is the intersection of every
guard's target type. Guard execution is ordered and short-circuits on the first
false result. Exceptions from user-provided guards propagate.

The non-empty constraint avoids a vacuous `true` result that appears to narrow
an arbitrary value without evidence.

## Trust boundary

The new functions perform classification only:

- `isError` and `hasErrorCode` are structural and therefore forgeable.
- `isErrorOf` and `isAnyErrorOf` establish local constructor identity through
  `instanceof`, but do not survive realm boundaries.
- None of these guards authorize public presentation, retry, disclosure, or
  domain behavior by themselves.
- Existing `isStructuredError` behavior is not changed in this wave.

Documentation must state these limits. In particular, `hasErrorCode("ENOENT")`
is suitable for control flow around a caught filesystem error, not for trusting
an error payload received over a network.

## Rejected alternatives

### Return `value is Error` from structural `isError`

Rejected because a cross-realm or plain structural value is not an instance of
the local `Error` constructor. `ErrorLike` accurately describes the guarantee.

### Accept `{ code: C }` without verifying an error shape

Rejected because unrelated data objects frequently have a `code` field. The
guard is named `hasErrorCode`, so it must first establish an error-like shape.

### Claim predicate refinement from a boolean callback

Rejected because a predicate such as `status >= 500` does not produce a useful
literal/range type in TypeScript. The callback filters values at runtime but
the returned guard narrows only to the constructor's instance type.

### Add matcher functionality in Wave 1

Rejected. Wave 1 provides independently useful primitives. Fluent matching,
case ordering, and exhaustive type-state have separate design risks and remain
in Waves 2 and 3.

### Mirror an external API exactly

Rejected where that would weaken semantics. Capability parity means equivalent
safe behavior, not API compatibility with another package.

## Compatibility and release impact

- Additive root exports only; no existing export is renamed or changed.
- No package export-map change is required.
- No runtime dependency is added.
- Release: `6.1.0`.
- Expected bundle impact: small; measure the root bundle before and after the
  implementation and record the result in the completion review.
- No deprecation or migration step is required.

Potential naming collisions in consumer code are normal named-import concerns;
the package currently exports no `isError`, `hasErrorCode`, `isErrorOf`,
`isAnyErrorOf`, or `isAllOf` symbols.

## Implementation shape

Expected files:

```text
src/errors/guards.ts                         extend runtime guards and types
src/__tests__/error-guards.test.ts           runtime behavior
src/__tests__/error-guards.types.ts          compile-only positive/negative tests
src/index.ts                                 root exports
docs/guide/guards.md                         usage and trust-boundary documentation
README.md                                    feature/API pointer if warranted
CHANGELOG.md                                 release note
```

Internal property inspection should use one small helper that catches failures
from proxies/getters. It must not stringify arbitrary input or invoke user
serialization hooks.

## Test plan

### Runtime tests

`isError`:

- native `Error` and subclasses;
- structural cross-realm-like shape;
- optional valid/invalid `stack`;
- null, undefined, primitives, arrays, functions, and incomplete objects;
- throwing getters and proxies fail closed.

`hasErrorCode`:

- Node-style string codes and numeric codes;
- exact comparison and literal preservation;
- inherited code property;
- wrong code/type and missing code;
- `{ code }` without an error shape is rejected;
- throwing code getter/proxy fails closed.

`isErrorOf`:

- exact class and subclass instances;
- unrelated errors and non-errors;
- predicate true/false;
- predicate runs only after `instanceof` succeeds;
- predicate exceptions propagate.

`isAnyErrorOf`:

- first, middle, and no constructor match;
- subclass match;
- empty list returns false;
- non-error values return false.

`isAllOf`:

- intersection of two compatible guards;
- short-circuit order;
- false result;
- user-guard exception propagation.

The tests must run in the normal Vitest suite and the Workers suite where the
existing configuration supports them.

### Compile-time tests

Create a compile-only file under `src/__tests__` so the existing `pnpm
typecheck` command verifies it. Tests cover:

- literal `code` inference from `hasErrorCode("ENOENT")`;
- constructor instance inference from `isErrorOf`;
- union inference from a readonly constructor tuple;
- intersection inference from heterogeneous guards;
- rejection of an empty `isAllOf` tuple;
- rejection of string/number codes widened to unsupported values;
- `ErrorLike` exposes only portable error fields; documentation does not claim
  local `instanceof Error` identity for structural matches;
- required `@ts-expect-error` checks fail the build if an invalid call starts
  compiling unexpectedly.

Vitest assertions alone are not accepted as proof of these type guarantees.

## Verification commands

Implementation is complete only when all commands pass:

```sh
pnpm typecheck
pnpm test:run
pnpm test:workers
pnpm lint
pnpm build
pnpm docs:build
```

## Definition of done

- The proposal is reviewed and changed to **Accepted** before implementation.
- All five guards and required public types match the accepted signatures and
  semantics.
- Runtime and negative compile-time tests cover the cases above.
- Existing guard tests remain unchanged or are migrated without loss.
- Trust and cross-realm limitations are documented.
- Bundle-size delta is recorded in the wave completion review.
- Wave 1 is complete only after implementation, verification, documentation,
  changelog, and completion review are finished.

## Completion review

Completed on 2026-06-21.

- Added all five accepted guards and the `ErrorLike`, `ErrorClass`, and
  `TypeGuard` public types.
- Added 18 focused runtime tests plus compile-only positive and negative type
  fixtures. The full Node suite passes 320 tests; the Workers suite passes 306.
- Verified `pnpm typecheck`, `pnpm test:run`, `pnpm test:workers`, `pnpm lint`,
  `pnpm build`, and `pnpm docs:build`.
- Hardened inspection against throwing property access, `getPrototypeOf` traps,
  malformed fields on native `Error` instances, and invalid structural `stack`
  values.
- Updated the guards guide, README feature list, and changelog.
- Root bundle delta against the pre-Wave-1 `HEAD` build:
  - ESM: 29,066 B → 29,214 B (+148 B); gzip 8,093 B → 8,226 B (+133 B).
  - CJS: 29,639 B → 29,889 B (+250 B); gzip 8,195 B → 8,345 B (+150 B).

Wave 1 is complete. Wave 2 remains **Not started** and requires its own planning
and proposal review before implementation.
