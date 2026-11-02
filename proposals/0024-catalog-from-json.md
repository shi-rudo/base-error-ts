# Restore a catalog error from JSON

Status: accepted; release: 10.0.0.
Tracking: `base-error-ts-lzi`.

## Decision

A catalog restores its own errors from a serialized payload: `AppErrors.fromJSON(payload)`.

- The result is `CatalogError<typeof AppErrors> | undefined`. It is an error of the catalog only when the payload fits the catalog. Otherwise the result is `undefined`, and the caller decides, for example with `AppErrors.fromJSON(payload) ?? StructuredError.fromJSON(payload)`.
- A payload fits when its `code` is a code of the catalog and its `details` pass the schema of that key.
- The catalog creates the error through the factory of the key:
  - `category`, `retryable` and the redaction floor come from the local definition, not from the payload.
  - `message`, the stack, the `timestamp`, the cause chain and the members of an aggregate come from the payload, through the bounded reconstruction of `StructuredError.fromJSON`.
- The restored error passes `AppErrors.is`, and `AppErrors.is(error, key)` for its key.
- The `details` of a definition take a validator that implements Standard Schema v1, such as a Zod, Valibot or ArkType schema, in place of `detailsType<T>()`. The details type of the key is the output type of the schema.
  - For a key with a schema, `fromJSON` keeps the output of the schema as the `details`. If the schema rejects the `details` of the payload, the result is `undefined`.
  - For a key with `detailsType<T>()` or without `details`, `fromJSON` drops the `details` of the payload. The type allows that, because `details` is optional on a `StructuredError`.
  - The factories of `create` do not run the schema. The compiler checks their `details`.
- `fromJSON` never throws for a payload. A schema that throws is consumer code with a bug, so its exception propagates. A schema that returns a promise also throws, because `fromJSON` is synchronous.

## Problem

`StructuredError.fromJSON` returns a base `StructuredError`. After a queue, a worker boundary or durable storage, an error of a catalog comes back without its catalog type:

- `AppErrors.is(revived)` is `false`. So an error middleware that classifies with `AppErrors.is` answers a restored 404 with a generic 500.
- The type is `StructuredError<string, string>`. `matchErrorCode` needs a `_` handler, the `details` are untyped, and `AppErrors.match` does not accept the value without a cast.
- `category` and `retryable` come from the payload, so a producer with an old definition can change the decision fields.

## Why these rules

- **The catalog creates the error.** The code must be in the catalog, the decision fields and the floor come from the definition, and the `details` pass the schema or drop. Only `message`, the stack and the causes come from outside, as for any error. So the restored error is an error of the catalog, and it passes `is`. This is how Effect Schema, modern-errors `parse` and serialize-error revive an error: as a real instance that passes its identity check. A restored error that failed its own guard would contradict its type.
- **The floor applies.** Without it, a restored error would log `details.email` that the original masked.
- **The schema lives in the definition.** The definition is the one source of the shape. A marker type next to a schema at the call site would be two copies of one fact.
- **`undefined`, not a result type.** The caller reacts to an unknown code and to invalid `details` in the same way: it falls back. A result type earns its place only for outcomes that a caller acts on differently. `undefined` reads like `Map.get` or `Array.find`.
- **Loud consumer bugs.** A schema returns issues for invalid data and does not throw. A throw or a promise is a bug in the definition, and swallowing it would hide that bug.

## Alternatives

- A restored error fails `is`. Rejected: `is` then contradicts the type that `fromJSON` returns, and code that classifies with `is` misses a restored error. The trust decision is the call of `AppErrors.fromJSON`, not the guard.
- The schema as an option of each call. Rejected: two sources for one shape.
- No schema, the `details` copied and typed as `T`. Rejected: the type lies for a malformed payload.
- A fallback to a base `StructuredError`. Rejected: the result type becomes `CatalogError | StructuredError<string, string>`, and every match then needs `_`.
- A throw for a payload that does not fit. Rejected: `fromJSON` is total for an untrusted payload.

## Consequences

- `AppErrors.is` accepts an error that `AppErrors.fromJSON` restored. Call `AppErrors.fromJSON` only for a payload within your own trust boundary: a worker, a queue or storage of the same system. Across services, translate through an anti-corruption layer, as for `StructuredError.fromJSON`.
- `toJSON` writes the log object. A field that a policy masks arrives masked, and a schema can accept the mask.
- The library carries the type of Standard Schema v1, not a runtime dependency.
- A value that `StructuredError.fromJSON` rebuilt still fails `is`.
