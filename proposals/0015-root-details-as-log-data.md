# Root details as log data

Status: implemented; release: 9.0.0.
Tracking: `base-error-ts-9ho`.

## Decision

The log object copies the root `details` with the bounded data copier.
The copier already copies the `details` of every cause.
The log object is therefore a snapshot at every position.
`error.details` keeps its original value in the process.
The root writes its cause chain and its aggregate members before its own `details`.

## Problem

The log object held the root `details` by reference.
The same data took two contracts, one at the root and one on a cause.

| Input in `details` | At the root | On a cause |
| --- | --- | --- |
| `10n` | `JSON.stringify(err)` throws | `"10"` |
| A cycle | `JSON.stringify(err)` throws | `[Circular …]` marker |
| A mutation after logging | Changes the log object | No effect |
| `NaN`, `-0` | Kept | `null`, `0` |

`toJSON` is an alias of `toLogObject`.
`logger.error({ err })` and `res.json(err)` can therefore throw inside a `catch`.
That new exception replaces the error that the code wanted to log.
An ORM entity with a relation cycle or a `bigint` key in `details` is enough.

## Alternatives

| Option | Consequence | Decision |
| --- | --- | --- |
| Keep the reference and document the gap | `JSON.stringify(err)` keeps throwing on ordinary data. | Rejected. |
| Copy only when no policy is active | The contract depends on the policy. A `Date` stays a `Date` under `redact`, and becomes a string without it. | Rejected. |
| Copy before the cause walk, as a cause node orders its own fields | Oversized root `details` spend the budget, and the cause chain loses its diagnosis. | Rejected. The diagnosis and the cause links come before the data expansion. |
| Copy after the cause walk | A cause tree beyond the budget cuts the root `details`. The scalar envelope survives. | Selected. |

## Contract

The root `details` follow the rules of `serializeLogData`, as on a cause.

- A `Date` becomes its ISO string. A `bigint` becomes its decimal string.
- `NaN` and positive or negative `Infinity` become `null`. `-0` becomes `0`.
- A `Map`, a `Set` and a native `Error` become `{}`, as in `JSON.stringify`.
- A `BaseError` of the same realm becomes its diagnostic envelope.
- A cycle becomes a `[Circular …]` marker at its first repeat.
- An unreadable value or a throwing `toJSON` becomes `[Unserializable value]`.
- The copy shares the budget of 100,000 nodes with the rest of the log build. If the budget runs out, the whole field becomes `[Max log size exceeded]`.

A built-in policy walks the copy.

- A denied key masks the copied value, and the mask receives the copy.
- The copier reads data under a denied key before the mask runs. Getters and Proxy traps in that data therefore run.
- Under `redactAllow`, a cycle in the root `details` reads as `[REDACTED]`, as on a cause.

`redactWith` receives the copy. A mutation in the callback does not reach `error.details`.
The record that a cause's own redactor returned still reaches the callback as it is.
Proposal 0017 copies that record too.

## Costs

- A logger that does not serialize to JSON sees the JSON forms instead of the rich values.
- The root `details` count against the log budget.
- A log call with a four-field `details` record costs about 1.4 microseconds more. `docs/guide/log-serialization-performance.md` records the measurement.
- Raw data now reaches the redaction walker only in the custom redactor output of a cause. The walker tests use that path through `src/__tests__/raw-log-data.fixture.ts`. Proposal 0017 closes that path as well.

## Compatibility

This is a breaking change of 9.0.0.
Code that compared `log.details` with `error.details` by identity, or that read a `Date` or a `bigint` from the root `details` of a log object, must change.
`MIGRATION.md` shows the recipes.

## Verification

- `src/__tests__/root-details-log-data.test.ts` compares the same `details` at the root and on a cause: conversions, cycles, nested errors, unreadable values, mutation after logging and budget exhaustion.
- `src/__tests__/log-data-depth-redaction.test.ts` runs the depth contract of copied data over the root `details` too.
- The redaction walker tests that used the raw root `details` run on the raw cause path with unchanged assertions.
