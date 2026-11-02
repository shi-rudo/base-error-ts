# Size caps for the log object

Status: accepted; release: 10.0.0.
Tracking: `base-error-ts-ci1` (container width), `base-error-ts-s0v` (string length).

## Decision

The log object caps the width of a data container and the length of a string, and it summarizes binary data. A cut leaves a marker that says how much it dropped.

| Cap | Value | Marker |
| --- | --- | --- |
| Entries of one array in log data | 1000 | the last element is `[199000 more items]` |
| Keys of one object in log data | 1000 | the key `[more keys]` holds the number of dropped keys |
| Typed array, `Buffer`, `DataView`, `ArrayBuffer` | no entries | `[Uint8Array(1000000)]`, with the constructor name and the length in elements or bytes |
| Characters of one string | 10 000 | the string ends with `[990000 more characters]` |
| Characters of one log object | 1 000 000 | a string past the budget is `[Max log size exceeded]` |

- The caps sit in `src/errors/walker-bounds.ts`, and the marker texts in `src/errors/serializer-markers.ts`.
- The width cap and the binary summary apply where the log-data copier walks: `details`, the own fields of a subclass, a plain-object cause, and the output of a custom policy that the log copies.
- The string cap applies to every string that the log object writes: the envelope (`name`, `message`, `code`, `category`) and log data. The `stack` gets its own rule.
- The `stack` repeats `name: message` in its header. The log writes the header with the cut message and keeps the frames. The frames get their own allowance of 10 000 characters. So a long message costs the stack no frame, and the redaction recognizes the header as before.
- The output of `redactWith` at the root of an error without a catalog floor stays as the callback returns it. The consumer owns it, and the log does not copy it (proposal 0021). Everywhere else, the log copies custom output, so the caps apply.

## Problem

The walkers cap nodes, not characters and not the width of one container.

- One oversized value replaced all of `details` with the size marker. `Buffer.alloc(1_000_000)` or an array of 200 000 elements spent the node budget of the whole build, and a sibling such as `orderId: 42` was lost with it.
- A small `Uint8Array` logged as an object keyed by index.
- A 1 MB message and a 1 MB detail gave a log object of 3 000 700 characters, because the stack header repeats the message. Log pipelines and Sentry cut such a record somewhere, and not where the information is.

## Why these values

- 1000 entries: an array of 1000 identifiers still says what the error is about, and the node budget of 100 000 then fits a hundred such arrays. Sentry's `normalizeMaxBreadth` is 1000 by default.
- 10 000 characters per string: `util.inspect` cuts a string at the same length by default (`maxStringLength`). A message or a detail longer than that is a payload, not a diagnosis.
- 1 000 000 characters per log object: without a total, 100 000 nodes times 10 000 characters still pass. One million characters is far above a sane log line and above the size to which Sentry shrinks an event.

## Alternatives

- Cut the final log object in one pass at the end. Rejected: the redaction recognizes the stack header by the raw message, and the pass would have to copy and change custom output that the consumer owns.
- Count characters against the node budget. Rejected: the node budget then bounds neither the characters nor the nodes well.
- Cut an object without a marker, as the own-fields reader does. Rejected: a silent cut hides that data is missing.

## Consequences

- The log contract changes: a long string ends with a marker, an array ends with a count marker, an object with more than 1000 keys gets the key `[more keys]`, and binary data is a summary.
- A marker in log data is data. A policy masks it like any value, and an allow-list masks the count under `[more keys]`.
- `toString()` and `err.stack` are not log output, and the caps do not apply to them.
