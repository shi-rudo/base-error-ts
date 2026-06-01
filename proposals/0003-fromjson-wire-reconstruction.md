# Proposal 0003 — `fromJSON` wire reconstruction

**Status:** Draft / for discussion — no implementation yet.
**Context:** `toLogObject()` / `toJSON()` serialize a (structured) error,
including the full cause chain. There is no inverse: a service receiving that
payload over RPC can only duck-type it (`isStructuredError`). `fromJSON` closes
the round-trip so a *consumer service* can reconstruct a typed
`StructuredError` and then `matchError` on its `code` — the missing piece for
**distributed DDD / cross-service error propagation**.

Zero-dependency; no dependency on `@shirudo/result`.

---

## API

```ts
StructuredError.fromJSON(json: unknown): StructuredError<string, string>;
```

A single static entry on `StructuredError` (the workhorse superset). It is the
inverse of `toJSON()`:

```ts
// service B → wire → service A
const received = await rpc.call(); // unknown JSON
const err = StructuredError.fromJSON(received);

matchError(err, {
  USER_NOT_FOUND: () => 404,
  RATE_LIMITED: () => 429,
  _: () => 502, // upstream failure we don't model
});
```

Round-trip guarantee: `StructuredError.fromJSON(e.toJSON())` reproduces an
equivalent error — `code`, `category`, `retryable`, `details`, `message`,
`name`, the cause chain, and the **original** `stack`/`timestamp`.

## Behavior

- **Lenient.** Missing structured fields fall back to safe defaults
  (`code "UNKNOWN_ERROR"`, `category "INTERNAL"`, `retryable false`) — the same
  envelope philosophy as `toStructuredError`. A non-object/garbage payload
  yields that envelope with a generic message rather than throwing.
- **Original identity preserved.** `stack` and `timestamp`/`timestampIso` are
  taken from the payload (a reconstruction represents the original failure, not
  a new one), not regenerated.
- **Cause chain rebuilt recursively.** Each serialized cause becomes a
  reconstructed error: structured shape → nested `StructuredError`; plain
  error shape (`name`/`message`/`stack`) → a basic error; primitive → kept
  as-is. Depth/cycle guarded.

## Security (the part that matters for a base library)

Reconstruction runs on data that may come from another service — treat it as
**untrusted input**:

1. **Whitelist only.** Copy only known fields (`name`, `message`, `code`,
   `category`, `retryable`, `details`, `timestamp`, `timestampIso`, `stack`,
   `cause`). Never assign arbitrary payload keys onto the instance, and never
   touch `__proto__` / `constructor` / `prototype` — no prototype pollution.
2. **`details` is data, not code.** It is copied as an opaque value; we never
   `eval`/instantiate from it.
3. **Don't trust reconstructed fields for authorization.** An attacker who can
   forge the payload can claim any `code`/`retryable`. Document loudly: use
   `fromJSON` to reconstruct *shape* for handling/logging, not as an authority
   on identity or trust. For untrusted boundaries, validate against an expected
   `code` set.
4. **No leak amplification.** `fromJSON` reconstructs; it does not change the
   safe-by-default projection. A reconstructed error's `toProblemDetails()` is
   still safe by default.

## Open questions / decisions to confirm

1. **Single entry vs two.** Proposed: only `StructuredError.fromJSON` (returns a
   `StructuredError`, filling defaults for plain-error payloads). Add
   `BaseError.fromJSON` only if a non-structured reconstruction is wanted —
   reconstructing a pure `BaseError` payload as a `StructuredError` (with default
   code) is a slight type asymmetry but ergonomically simpler.
2. **Naming.** `fromJSON` (mirrors `toJSON`) vs a standalone `deserializeError`.
   Proposed `StructuredError.fromJSON`.
3. **Malformed input.** Lenient envelope (proposed) vs throwing. Lenient matches
   the library's boundary philosophy.
4. **Seeding readonly `stack`/`timestamp`.** Implementation detail: a private
   rehydration path (or `Object.defineProperty`) sets these from the payload
   after construction, since the public constructor generates fresh ones.

## Test plan

- Round-trip: `fromJSON(e.toJSON())` equals `e` on code/category/retryable/
  details/message/name; cause chain reconstructed (nested codes preserved);
  original stack/timestamp preserved.
- Plain-error payload (no structured fields) → `StructuredError` with defaults.
- Garbage payloads (`null`, `42`, `"x"`, `{}`) → safe envelope, no throw.
- **Security:** a payload with `__proto__`/`constructor` keys does not pollute
  the prototype; only whitelisted fields appear; arbitrary extra keys are not
  copied onto the instance.
- Reconstructed error composes with `matchError` and `toProblemDetails`
  (safe-by-default still holds).

## Sequencing

Single, self-contained PR (built test-first). Smaller than the validation
aggregate; no new public types beyond the static method.

## Non-goals

- Not a general-purpose deserializer/validator (it reconstructs *this* library's
  serialized shape).
- No trust/authenticity guarantees — that is the transport's job (signing/mTLS).
- No new runtime dependencies.
