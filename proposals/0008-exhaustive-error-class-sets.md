# Proposal 0008: exhaustive local Error-class sets

**Status:** Implemented in Wave 3.

**Target release:** `6.3.0`. The change is additive.

## Decision

Add `defineErrorClassSet`, a reusable definition for a finite set of local
Error constructors:

```ts
const InfrastructureErrors = defineErrorClassSet({
  timeout: TimeoutError,
  network: NetworkError,
});

InfrastructureErrors.match(error, {
  timeout: handleTimeout,
  network: handleNetwork,
});
```

This is separate from the open-world `matchThrown(value)` chain. The latter
continues to accept arbitrary constructors and guards and always terminates in
an explicit `.otherwise()` fallback.

## Why keys establish exhaustiveness

TypeScript compares classes structurally. Two distinct classes with the same
members can therefore be the same static type even though `instanceof`
distinguishes them at runtime. Literal definition keys provide a finite,
nominal set that the handler table can cover exactly.

A handler object is preferable to fluent type-state for this closed case:

- every key is visible in one place;
- missing and additional handlers are rejected directly;
- no terminal `.exhaustive()` method is needed;
- reusable definitions retain their keys through const-generic inference;
- constructor validation and snapshotting happen once.

## Type semantics

- Definitions are non-empty and use finite, non-numeric string-literal keys;
  numeric-looking keys are rejected because object enumeration can reorder
  them.
- Values must be Error constructors.
- A widened `ErrorClassMap` is rejected because `string` is not a finite set;
  use inference or `satisfies ErrorClassMap`.
- Each handler receives `InstanceType` of its keyed constructor.
- Every definition key is required and undeclared handler keys are rejected.
- The return type is the exact union of handler return types.

## Runtime semantics

- Symbol or numeric-looking keys, empty definitions, and duplicate constructor
  identities are rejected when the set is defined.
- The definition is copied and frozen; the returned set is frozen.
- Matching evaluates constructors in definition order using local
  `instanceof`; the first match wins.
- Subclasses must precede base classes when both are present.
- If no constructor matches, `match` throws.
- `Symbol.hasInstance` and handler exceptions propagate unchanged.

## Non-goals

- Cross-realm or structural Error recognition; use guards with `matchThrown`.
- Negative cases, field selection, subject transformation, or async-specific
  variants.
- Proving that an arbitrary runtime `unknown` belongs to the declared set.

## Verification

- Runtime tests cover class dispatch, out-of-set values, empty and duplicate
  definitions, symbol and numeric-looking keys, snapshots, and freezing.
- Compile-only tests cover finite keys, Error-only constructors, exact handler
  coverage, structurally identical classes, handler narrowing, reusable
  definitions, and exact non-`any` result unions.
- Typecheck, Node tests, Workers tests, lint, package build, and docs build must
  all pass.
