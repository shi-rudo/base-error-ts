# Proposal 0007: non-exhaustive matching for arbitrary thrown values

**Status:** Implemented in Wave 2.

**Target release:** `6.2.0`. The change is additive.

**Dependencies:** Wave 1 (`ErrorClass`, `TypeGuard`, and general-purpose error
guards). No runtime dependency is added.

**Context:** `matchError` is intentionally specialized for closed unions of
`StructuredError` values and dispatches exhaustively by stable `code`. A
JavaScript `catch` receives `unknown`, however, and applications also need to
handle native errors, third-party error classes, Node.js error codes, and even
non-Error thrown values. Repeated `instanceof`/guard chains are verbose and
make return-type inference harder to read.

Wave 2 adds a non-exhaustive fluent matcher for this open-world case. It does
not alter `matchError` and does not attempt the closed-union proof reserved for
Wave 3.

---

## Decision

Add `matchThrown(value)` and an immutable `ThrownMatcher<TResult>` chain:

```ts
export interface ThrownMatcher<TResult> {
  with<T extends Error, const R>(
    constructor: ErrorClass<T>,
    handler: (error: T) => R,
  ): ThrownMatcher<TResult | R>;

  withAny<const C extends readonly [ErrorClass, ...ErrorClass[]], const R>(
    constructors: C,
    handler: (error: InstanceType<C[number]>) => R,
  ): ThrownMatcher<TResult | R>;

  when<T, const R>(
    guard: TypeGuard<T>,
    handler: (value: T) => R,
  ): ThrownMatcher<TResult | R>;

  when<const R>(
    predicate: (value: unknown) => boolean,
    handler: (value: unknown) => R,
  ): ThrownMatcher<TResult | R>;

  otherwise<const R>(handler: (value: unknown) => R): TResult | R;
}

export function matchThrown(value: unknown): ThrownMatcher<never>;
```

Example:

```ts
try {
  await readConfig();
} catch (error) {
  return matchThrown(error)
    .with(SyntaxError, () => ({ kind: "invalid-config" }) as const)
    .when(hasErrorCode("ENOENT"), () => ({ kind: "missing" }) as const)
    .withAny(
      [TimeoutError, ConnectionError] as const,
      (networkError) =>
        ({
          kind: "retry",
          cause: networkError,
        }) as const,
    )
    .otherwise((unknownError) => {
      throw unknownError;
    });
}
```

`ThrownMatcher` is exported because it appears in the public function return
type and is useful for library wrappers. Internal case representations remain
private.

## Why constructors and guards use separate methods

`.with()` accepts constructors only. `.when()` accepts guards and ordinary
boolean predicates.

At runtime, JavaScript provides no sound general test that distinguishes every
class constructor from every callable guard. Heuristics such as
`fn.prototype instanceof Error` fail for `Error` itself, structurally typed
constructors, transpiled classes, and custom `Symbol.hasInstance` behavior.
Calling a value to discover whether it is a guard would execute user code and
would make class-constructor errors indistinguishable from predicate errors.

The explicit split keeps runtime behavior deterministic while preserving every
capability:

```ts
matcher.with(NetworkError, handleNetwork);
matcher.when(isErrorOf(NetworkError), handleNetwork);
matcher.when(hasErrorCode("EPIPE"), handlePipe);
```

This intentionally replaces the roadmap's preliminary idea that one `.with()`
method accept both constructors and guards.

## Runtime semantics

### Evaluation

- Chain methods register cases; they do not evaluate them.
- `.otherwise()` evaluates the original input exactly once through the cases.
- Cases run in registration order; the first match wins.
- The matching handler receives the original input narrowed by its case.
- If no case matches, `.otherwise()` invokes its handler with the original
  `unknown` value.
- There is no implicit fallback, throw, coercion, or serialization.

### Constructors

- `.with()` uses local `instanceof` identity.
- `.withAny()` matches when any constructor matches and narrows its handler to
  the union of the listed instance types.
- `.withAny()` requires a non-empty tuple. An empty constructor group is an
  unreachable case and is rejected at compile time.
- The constructor list is copied when registered so later caller mutation
  cannot change matcher behavior.

### Guards and predicates

- A `TypeGuard<T>` passed to `.when()` narrows the handler input to `T`.
- A plain boolean predicate receives `unknown`; its handler also receives
  `unknown` because a boolean callback proves no static type.
- User predicate, `Symbol.hasInstance`, and handler exceptions propagate
  unchanged. The matcher must not swallow application bugs.
- Fail-closed structural inspection remains the responsibility of guards such
  as `isError` and `hasErrorCode`, not the matcher.

### Immutability and branching

Every chain operation returns a new matcher and leaves the previous matcher
unchanged:

```ts
const base = matchThrown(error).with(SyntaxError, handleSyntax);
const server = base.when(hasErrorCode("EPIPE"), handlePipe);
const browser = base.with(DOMException, handleDom);
```

Cases added to `server` must not appear in `browser`, and vice versa. This
avoids hidden mutable-builder behavior and makes reusable partial matchers safe.
The input value itself is not cloned.

## Return types and async behavior

Each chain step accumulates its handler return type. `.otherwise()` returns the
union of every registered handler result and the fallback result. No public
method may return `any`.

Async handlers require no separate API:

```ts
const result = matchThrown(error)
  .with(NetworkError, async (networkError) => retry(networkError))
  .otherwise(() => "not-retried" as const);
// Promise<RetryResult> | "not-retried"
```

The matcher is synchronous dispatch. It returns the selected handler's value
unchanged and does not eagerly await or wrap it. Callers use `await` when their
handler set can produce promises.

## Operators not included in Wave 2

### `.withNot()`

Rejected for this wave. The complement of a constructor within `unknown`
cannot be narrowed usefully, and broad negative cases make ordering mistakes
easy. A normal `.otherwise()` expresses the safe open-world fallback.

### `.select()`

Rejected. It assumes a particular `data`/`details` convention and adds no
capability beyond destructuring inside a typed handler.

### `.map()`

Rejected. Transforming the subject mid-chain complicates case type-state and
evaluation timing. Normalize before matching (`toStructuredError`, cause-chain
helpers, or ordinary code) and pass the normalized value to `matchThrown`.

### `.exhaustive()`

Out of scope. Arbitrary `unknown` is open-world. Sound exhaustive matching over
a caller-declared closed constructor union is Wave 3.

### Async matcher variants

Rejected. Normal TypeScript return inference already preserves promises. A
second implementation would duplicate semantics and increase bundle/API size.

## Compatibility and release impact

- Additive root exports: `matchThrown` and `ThrownMatcher`.
- Existing `matchError` source, types, semantics, and documentation remain
  intact.
- No export-map change and no runtime dependency.
- Target release: `6.2.0`.
- Measure root ESM/CJS and gzip deltas against `6.1.0` during completion review.

## Implementation shape

Expected files:

```text
src/errors/match-thrown.ts                    matcher and public interface
src/__tests__/match-thrown.test.ts            runtime behavior
src/__tests__/match-thrown.types.ts           compile-only type fixtures
src/index.ts                                  root exports
docs/guide/matching.md                        open-world matcher documentation
README.md                                     feature/API pointer if warranted
CHANGELOG.md                                  release note
```

## Runtime test plan

- `.with()` matches an exact class and subclasses via `instanceof`.
- `.withAny()` matches every listed class and rejects unrelated values.
- `.when()` narrows and matches reusable Wave-1 guards.
- A plain boolean predicate handles non-Error thrown values.
- Registration order is first-match-wins.
- Fallback receives the original value when no case matches.
- Matchers with no registered cases invoke the fallback.
- Guards and handlers are lazy until `.otherwise()`.
- Only tests up to and including the first successful case execute.
- Predicate, `Symbol.hasInstance`, handler, and fallback exceptions propagate.
- Constructor arrays are snapshotted at registration.
- Branching a partial matcher does not leak cases between branches.
- Promise-returning handlers are returned unchanged and work in Workers.

## Compile-time test plan

Compile-only fixtures under `src/__tests__` must prove:

- `.with()` handler input is the constructor instance type.
- `.withAny()` handler input is the precise constructor-instance union.
- `.when(TypeGuard<T>)` handler input is `T`.
- `.when(booleanPredicate)` handler input remains `unknown`.
- `.otherwise()` returns the exact union of case and fallback results.
- Promise and synchronous return values remain a union without an async API.
- Invalid non-Error constructors are rejected.
- Empty `.withAny([])` calls are rejected.
- Handler properties unavailable on the narrowed type are rejected.
- An `IsAny` assertion proves the public chain and result types are not `any`.

Every negative guarantee uses `@ts-expect-error`; Vitest assertions alone are
not accepted as type-level proof.

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

- This proposal is reviewed and changed to **Accepted** before production code
  changes.
- Runtime tests are observed failing before implementation and passing after.
- Compile-only fixtures verify every inference and rejection above.
- `matchError` has no behavioral or type regression.
- Documentation clearly separates closed/code-based `matchError` from
  open-world `matchThrown`.
- Bundle-size delta is recorded in the completion review.
- Wave 2 is complete only after implementation, verification, documentation,
  changelog, and completion review.

## Completion review

Completed on 2026-06-21.

- Added the accepted `matchThrown` API with constructor cases, non-empty
  constructor groups, narrowing guards, boolean predicates, and an explicit
  fallback.
- Matcher chains and constructor-group snapshots are immutable; dispatch is
  lazy and first-match-wins.
- Return unions preserve literals and promises without public `any` fallbacks
  or a duplicate async API.
- Added 14 focused runtime tests plus compile-only positive and negative type
  fixtures. The full Node suite passes 334 tests; the Workers suite passes 320.
- Verified `pnpm typecheck`, `pnpm test:run`, `pnpm test:workers`, `pnpm lint`,
  `pnpm build`, and `pnpm docs:build`.
- Updated the matching guide, README feature list, and changelog.
- Root bundle delta against the pre-Wave-2 `6.1.0` build, measured with the
  same standalone `tsup` command:
  - ESM: 29,994 B → 30,336 B (+342 B); gzip 8,275 B → 8,450 B (+175 B).
  - CJS: 30,669 B → 31,033 B (+364 B); gzip 8,395 B → 8,575 B (+180 B).

Wave 2 is complete. Wave 3 remains **Not started** and requires its own planning
and proposal review before implementation.
