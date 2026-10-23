# The time of an error in one field

Status: implemented; release: 9.0.0.
Tracking: `base-error-ts-2le`.

## Decision

An error stores its time once, in `timestamp` (epoch milliseconds).
The error has no `timestampIso` property.
Each log build writes the log key `timestampIso` from the `timestamp` that it reads.
`fromJSON` restores `timestamp` only.

## Problem

`BaseError` stored the time twice, as `timestamp` and as `timestampIso`.
The constructor wrote both from one clock read.
Both are writable own properties, so every other writer had to keep them in step:

- a subclass that sets the time of an imported failure,
- a reconstructor such as `fromJSON`,
- a consumer that assigns `timestamp` at runtime.

If one writer forgot the second field, the log stated two different instants.
Nothing in the log showed which one was correct.
`fromJSON` had this defect until PR #31.

The JSDoc of `timestampIso` said that it exists for log aggregators that prefer text.
A log aggregator reads the log object, not the error.

## Alternatives

| Option | Consequence | Decision |
| --- | --- | --- |
| Keep two stored fields | Each writer keeps them in step by hand, and nothing detects a writer that forgets. | Rejected. |
| A getter on the prototype | `err.timestampIso` stays readable. `Object.keys`, spread and `for…in` lose it, because it is no own property. For a `timestamp` outside the date range, the getter throws or invents a value. | Rejected. |
| An own accessor per instance | `Object.keys` and spread keep it. Each construction pays for a `defineProperty`. The getter has the same throw problem. | Rejected. |
| Derive the key in the log object only | `err.timestampIso` goes away. The log contract stays. The error holds one value. | Selected. |

## Contract

- `BaseError` has `timestamp: number`. It has no `timestampIso`, and neither has a subclass.
- The log object writes `timestampIso` at the same position as before, after `timestamp`.
- The root reads `timestamp` once. Both time keys come from that read, so a getter that changes between reads cannot split them.
- If `timestamp` is not a number in the date range of `Date`, the log omits `timestampIso`. `timestamp` keeps the rules of the envelope: `NaN` becomes `null`.
- If `timestamp` is unreadable, the log omits both time keys.
- The log ignores an own `timestampIso` property on an error.
- A `BaseError` inside data gets its diagnostic envelope with the same derivation.
- If a `redactWith` callback throws, the recovery record keeps the derived `timestampIso` of the log.
- `fromJSON` takes the time from the numeric `timestamp`, else from `timestampIso` in the exact form that the log writes. It writes `timestamp` only.
- A deny-list still masks each key alone. To hide the time, deny `timestamp` and `timestampIso`.

`toTimestampIso` in `src/errors/timestamp-iso.ts` owns the derivation.
The log build and the `fromJSON` check use it, so the form that the log writes and the form that `fromJSON` accepts cannot drift apart.

## Cost

- `err.timestampIso` is gone. TypeScript reports each read, and JavaScript gets `undefined`.
  The migration is `new Date(err.timestamp).toISOString()`.
- `Object.keys(err)`, `{ ...err }` and `for…in` no longer carry the ISO string.
  A logger that copies the own properties of an error, such as the default `err` serializer of pino, writes `timestamp` only.
  The documented log path, `logger.error(err.toLogObject())`, keeps both keys.
- A `timestamp` outside the date range loses its ISO key in the log. Before, the log wrote the stored string from the construction.
- The cost of `toISOString` moves from the construction to each log build.
  On Node 24.21, macOS arm64, it is about 0.4 microseconds.
  An error that the code never logs gets cheaper. An error that the code logs twice pays twice.
  `docs/guide/log-serialization-performance.md` records the measurement.

## Migration

`MIGRATION.md` has the section "`timestampIso` is a log key only" under "v8 to v9".
