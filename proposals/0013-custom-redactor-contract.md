# Custom redactors and failure recovery

Status: implemented on PR #23; release: unreleased.
Tracking: `base-error-ts-vpo`.

## Decision

`redactWith` remains a trusted, synchronous transformation of a complete log record.
Its signature remains `(log: Record<string, unknown>) => Record<string, unknown>`.
The consumer owns the returned record, including its shape and sensitive content.
The library owns callback invocation and failure recovery.

Before invocation, the library captures six own, correctly typed diagnostic fields.
If the callback throws, recovery uses that snapshot instead of the mutated input.
This applies at the root, on the cause spine, and to errors inside copied data.
The built-in policies use the same recovery path.

## Problem

Recovery previously read the input after the callback threw.
A callback could copy its input message into `code`, then throw.
The failure record then exposed that message under a structural key.
A callback could also replace `retryable: false` with `true` before throwing.
The failure record retained the changed decision.

Both inputs use the public callback contract and reproduce on `75fd20f`.
The original decision fields must survive a failed transformation.
Type checks after invocation cannot establish their original values.

## Alternatives

| Option | Consequence | Decision |
| --- | --- | --- |
| Remove `redactWith` | Consumers lose sticky custom policies when their error becomes a cause. | Rejected. External adapters remain useful, but do not preserve this behavior automatically. |
| Replace it with a leaf callback | The library gains another traversal contract for paths, containers, omission, and stack headers. | Rejected. A callback can still return sensitive text or perform arbitrary work. |
| Validate and copy every returned record | The library adds another guarded traversal after each callback. | Rejected. JSON validity cannot establish secrecy or correct decision values. |
| Retain the trusted callback with a private failure snapshot | Successful transformations remain compatible. Recovery uses original diagnostic fields. | Selected. The snapshot adds fixed work without another walker. |

The narrow `buildOwnLogFields` hook still serves data contributions.
`redactWith` serves an explicit policy supplied by the consumer.
Neither interface restores the removed `buildLogObject` override.

## Contract

### Successful transformation

- The callback receives a mutable record assembled by the library.
- It can mutate that record or return another record, including an empty record.
- Its immediate return value passes through unchanged, with the same identity.
- The callback owns omission, replacement, and the types of all returned fields.
- The library does not validate, freeze, clone, or apply another implicit policy to that return value.
- An enclosing built-in policy can still process a cause's returned record.
- The data copier still processes custom output from an error encountered inside copied data.

The consumer must return synchronously and own the JSON safety of the returned graph.
The TypeScript signature rejects promises, primitives, and absent returns.
It cannot exclude cycles, bigint values, getters, or serialization callbacks inside the record.
At runtime, an out-of-contract return receives no shape check.
`JSON.stringify(error)` can therefore throw on custom output even after `toLogObject()` returns successfully.

The input is not a detached snapshot of every reachable value.
Root `details` retains its original reference.
Custom outputs from earlier cause policies can also retain consumer references.
Mutation can affect those references even if the callback subsequently throws.
Failure recovery does not roll back consumer state.

### Policy and secrecy

Policy registration is last-wins, including transitions between built-in and custom policies.
An earlier `redactAllow([])` does not constrain a later `redactWith` callback.
Same-realm cause and aggregate policies run before the enclosing policy.
The existing limits for foreign realms and proxies remain unchanged.

A successful callback can reintroduce sensitive data or change `code` and `retryable`.
The library cannot distinguish that behavior from an intentional transformation.
Consumers must test the final emitted event and keep secrets out of structural metadata.
Custom message changes do not automatically scrub `stack`, `toString()`, or runtime inspection.
Consumer copies do not transfer private serializer-marker provenance.

### Failure recovery

The snapshot contains only readable own fields with these types:

| Fields | Accepted value |
| --- | --- |
| `name`, `category`, `timestampIso` | String |
| `code` | String or finite number |
| `retryable` | Boolean |
| `timestamp` | Finite number |

The snapshot represents the assembled log immediately before the policy runs.
It does not read the source error again.
The callback cannot access the snapshot.
Mutation, deletion, getters, and prototype changes on the input cannot change recovery fields.
Recovery omits absent, unreadable, and incorrectly typed fields.
It adds `message: "[log redaction failed]"` and drops payload, stack, and links.
Built-in read exhaustion retains its distinct `[Max redaction size exceeded]` message.
The library never substitutes a size-marker string for a captured boolean decision.

The snapshot does not certify that original structural strings contain no secrets.
It prevents a failed callback from moving payload into those fields.
Only synchronous exceptions during invocation reach this recovery path.
Later exceptions from custom getters or serialization callbacks do not.

### Work and recursion

The snapshot reads six fixed keys through the guarded reader.
It traverses no containers and enumerates no consumer keys.
This fixed work is separate from the built-in redaction walk's read allowance.
No snapshot is needed when the error has no redaction policy.

Explicit public logging calls inside a callback start independent builds.
The consumer must bound such calls and terminate the callback.
No ambient recursion guard or callback CPU limit is added.
A synchronous library cannot interrupt arbitrary consumer code.

## Verification

`src/__tests__/redactor-contract.test.ts` covers successful transformations and failure snapshots through public entry points.
Its `.types.ts` sibling checks the synchronous mutable-record signature.
The existing redaction tests cover bounded walks, fail-closed masking, and serializer provenance.
The Node and workerd suites verify the same contracts on both stack sizes.

### Snapshot cost

The comparison uses equally bundled `75fd20f` and snapshot implementations.
The harness is `scripts/benchmark-log-serialization.mjs`, with its ES2020 neutral ESM bundles and explicit repository TypeScript configuration.
Node 24.11.1 ran on macOS arm64 with 100 warmups, nine samples, and 200 calls per sample.
The additional fixture applies `redactWith((log) => log)` to every structured cause created by the harness.
The outer error optionally applies `redact(["secret"])`, as in the original harness.

| Shape with custom cause policies | Outer policy | Before median (µs) | Snapshot median (µs) |
| --- | --- | ---: | ---: |
| Shallow | None | 3.04 | 3.18 |
| Shallow | Deny `secret` | 8.37 | 9.05 |
| Fan-out, 100 members | None | 210.21 | 224.44 |
| Fan-out, 100 members | Deny `secret` | 522.51 | 540.44 |
| Chain, 100 nodes | None | 205.36 | 220.57 |
| Chain, 100 nodes | Deny `secret` | 519.63 | 536.92 |

The original harness applies at most one policy per call.
Its larger scenarios changed by at most 2.3% in this run, with overlapping sample ranges.
Its shallow redacted median changed from 8.08 to 9.40 µs, also with overlapping ranges.
These observations describe this host, not a statistical significance claim or a Workers CPU guarantee.
The fixed snapshot work buys recovery that does not trust partially transformed metadata.

## Compatibility

Successful transformations require no migration.
Recovery now preserves original readable metadata after a callback deletes or corrupts its input.
Code that relied on partially transformed failure metadata must change.
The migration guide describes that change for the next major release.
