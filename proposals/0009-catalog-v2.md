# Proposal 0009: Catalog v2

**Status:** Implemented in Wave 4.

**Target release:** `7.0.0`.

## Decision

Catalog v2 separates code factories from catalog operations:

```ts
const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
    metadata: { httpStatus: 404 },
  },
});

const error = AppErrors.create.USER_NOT_FOUND("missing", {
  details: { userId: "123" },
});
```

Factories live under `create`; `meta`, `create`, and `is` are therefore valid
error codes. `CatalogError` derives only from the factory namespace and
`CatalogErrorOf<C, K>` extracts one code-specific type.

## Provenance guards

Each catalog owns a private `WeakMap` of instances produced by its factories:

```ts
AppErrors.is(value); // catalog union
AppErrors.is(value, "USER_NOT_FOUND"); // one generated error type
```

The guard also verifies the instance's current code, category, and retryability
against the immutable definition snapshot. Errors from another catalog,
structural lookalikes, reconstructed wire values, and mutated identities fail
closed. This boundary intentionally recognizes local provenance only.

## Definition model

- Definitions are finite, non-empty, string-keyed objects.
- Specs require a non-empty category and boolean retryability.
- `detailsType<T>()` is a compile-time-only marker and replaces consumer-side
  assertions.
- `metadata` is inferred per code, JSON-safe, recursively copied, and frozen.
- `redaction` supports deny- and allow-list policies with an optional mask.
- Definitions, factory namespaces, code lists, and returned metadata are
  snapshotted and frozen.

The fixed `httpStatus` field is removed. Transport mappings belong in generic
metadata owned by the consumer:

```ts
metadata: { httpStatus: 404, grpcCode: "NOT_FOUND", exitCode: 4 }
```

## Runtime semantics

- Factories preserve the existing `message, options` call shape.
- Details and cause values remain per-call inputs.
- Catalog redaction is applied before the instance is returned.
- `codes` exposes the immutable finite code list.
- `meta(code)` returns the immutable category/retryability/metadata snapshot.
- Unknown metadata codes throw; malformed definitions fail during catalog
  creation rather than during error handling.

## Non-goals

- Trusting structural, cross-realm, serialized, or upstream error values.
- Runtime validation of code-specific details.
- Catalog merging or composition.
- HTTP, gRPC, CLI, or framework adapters.
- Matcher transformation, selection, negative cases, or async-specific APIs.

## Migration

- `AppErrors.CODE(...)` becomes `AppErrors.create.CODE(...)`.
- `details: {} as T` becomes `details: detailsType<T>()`.
- `httpStatus: 404` becomes `metadata: { httpStatus: 404 }`.
- `AppErrors.meta(code).httpStatus` becomes
  `AppErrors.meta(code).metadata.httpStatus`.

## Verification

- Compile-only tests cover factory placement, exact details and metadata types,
  finite definitions, union and code-specific guards, and non-`any` results.
- Runtime tests cover construction, metadata snapshots, freezing, malformed
  definitions, provenance isolation, forged/reconstructed values, identity
  mutation, redaction policies, and JSON-safety.
- Node, Workers, typecheck, lint, package build, docs build, and package dry-runs
  must all pass.
