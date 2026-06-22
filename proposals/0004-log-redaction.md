# Proposal 0004: redaction hook on the log path

**Status:** Accepted. Decisions locked (see _Decisions_). Built test-first.
**Context:** `toLogObject()`/`toJSON()` are the full-fidelity observability
payload (technical message, stack, cause chain, raw `details`). In regulated
contexts the **logs themselves** must scrub PII (a `details.ssn` shouldn't hit
the log sink in plaintext). This adds an opt-in redaction transform on the log
path. The client path is unaffected, as it is already safe by default.

Defense-in-depth at the source; **not** a replacement for logger-level
redaction (see _Positioning_). Zero-dependency.

---

## The design driver: redaction must be sticky on the instance

Logs are usually produced by a logger **auto-serializing** the error:
`JSON.stringify(error)` → `toJSON()` with **no arguments**. A per-call option on
`toLogObject({...})` would miss that path entirely. So redaction is configured
**on the instance** (chainable), and the zero-arg `toLogObject()`/`toJSON()`
applies it.

## API

```ts
// Level 1: declarative key redaction (deny-list, deep), chainable & sticky
const err = new StructuredError({
  code: "USER_UPDATE_FAILED",
  category: "PERSISTENCE",
  retryable: false,
  message: "update failed",
  details: { userId: "1", email: "a@b.com", ssn: "123-45-6789" },
}).redact(["email", "ssn"]);

err.toLogObject().details; // { userId: "1", email: "[REDACTED]", ssn: "[REDACTED]" }
JSON.stringify(err); // also masked: covers the logger path

// configurable mask, default "[REDACTED]"
err.redact(["ssn"], { mask: "******" });
```

```ts
// Level 2: function redactor, full control (allow-list, message scrubbing)
err.redactWith((log) => ({
  ...log,
  message: scrub(log.message as string),
  details: pick(log.details, ALLOWLIST),
}));
```

Signatures (chainable, return `this`):

```ts
redact(keys: string[], options?: { mask?: string }): this;   // mask defaults to "[REDACTED]"
redactWith(redactor: (log: Record<string, unknown>) => Record<string, unknown>): this;
```

`redact` deep-walks the assembled log object and replaces the value of any
matching key (at any depth, so nested `details` and serialized cause details
are covered) with the mask. `redactWith` receives the whole log object and
returns the redacted version (use it for allow-lists or scrubbing the `message`,
which key-redaction can't do to a string). The last call wins (one redactor per
instance).

## Implementation note: the `buildLogObject` seam

Redaction must apply to the **complete** assembled object (including
`code`/`category`/`details`). To avoid double-redaction or missing the
subclass fields, split assembly from redaction:

- `BaseError`: `protected buildLogObject()` assembles the raw object;
  `toLogObject()` = apply the instance redactor (if any) to `buildLogObject()`;
  `toJSON()` stays `= toLogObject()`.
- `StructuredError`: override `buildLogObject()` to add `code`/`category`/
  `retryable`/`details`, and **inherit** the redacting `toLogObject()`.

Same output as today when no redactor is set (behavior-preserving refactor).

## Positioning

- **Log path only.** The client serializers (`toPublicJSON`/`toProblemDetails`/
  `toErrorResponse`) are already safe by default; redaction does not touch them.
- **Defense-in-depth, not the policy engine.** App-wide PII policy is often
  better at the logger layer (pino `redact`, winston formatters). This feature
  makes per-error/per-family redaction ergonomic and travels with the error to
  any sink, but it is best-effort and not a substitute for logger-level
  redaction. The docs will say so.
- **Best-effort.** A deny-list can't know every PII field; for high sensitivity
  use `redactWith` with an allow-list.

## Decisions (locked)

1. **Sticky on the instance** (chainable `redact`/`redactWith`), so the
   auto-serialize (`JSON.stringify`) path is covered. Not a per-call option.
2. **Mask configurable**, default `"[REDACTED]"`.
3. **Declarative form is a deny-list** (`redact(keys)`); allow-list and message
   scrubbing via the `redactWith` function form.
4. **Deep** key matching over the whole assembled log object (covers nested
   `details` and cause details).
5. **No global mutable redactor** (`BaseError.setRedactor`): global state is a
   testability/SSR smell. Per-instance only in v1.

## Open question

- **Catalog policy (Level 3).** `defineErrors({ X: { …, redact: ["ssn"] } })` so
  a redaction policy is set once per error family instead of on every throw.
  Additive; **deferred** to a follow-up to keep this PR focused.

Resolved by Proposal 0009: Catalog v2 supports declarative deny- and allow-list
policies applied by every generated factory.

## Test plan

- `redact(keys)` masks matching keys in `details`, deep/nested, and in
  serialized cause details; non-matching fields untouched.
- Default mask `"[REDACTED]"`; custom mask honored.
- **Sticky:** `JSON.stringify(err)` / `err.toJSON()` (zero-arg) apply redaction.
- `redactWith(fn)` transforms the whole log object (allow-list; message scrub).
- Last redactor wins; chainable returns `this`.
- No redactor set → `toLogObject()` output unchanged (refactor is
  behavior-preserving).
- Client path (`toProblemDetails`) is unaffected by a configured redactor.

## Non-goals

- No global/static redactor.
- Not a PII detector; the caller names the keys (or supplies a function).
- No new runtime dependencies.
