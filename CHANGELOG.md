# Changelog

## 5.0.0 - 2026-06-01

### Breaking Changes

- `StructuredError.toProblemDetails()` and `StructuredError.toErrorResponse()` are safe by default. They no longer expose technical messages, internal codes, categories, or raw `details` unless public fields or explicit exposure options are used.
- Safe-by-default is invariant: standard Problem Details members (`type`, `title`, `status`, `detail`, `instance`) and library members (`code`, `category`, `retryable`, `traceId`) always win over colliding extension keys. There is no override switch.
- Raw `details` never cross into client responses. Surfacing details is always an explicit `mapDetails` projection on both `toProblemDetails()` and `toErrorResponse()`; full-fidelity details remain available for observability via `toLogObject()`.
- The `_tag` discriminant and inferred `name` derive from a single resolved name (an explicit `name` option, otherwise the constructor name), so they never diverge and an explicit `name` stabilizes both. `StructuredError` fixes `_tag` to the stable literal `"StructuredError"`, making the discriminant minification-safe out of the box; subclasses inherit it (override with a literal for a distinct tag). Narrow on `code` to distinguish individual structured errors.
- `typescript` is no longer a peer dependency. The package still ships TypeScript declarations.
- Updated the package version from `4.7.0` to `5.0.0`.

### Added

- Added `toLogObject()` for explicit logging serialization with stack and cause chains.
- Added `toPublicJSON()` for client-safe serialization.
- Added `publicCode`, `publicMessage`, and `expose` options to map internal domain/infrastructure errors to stable public API errors.
- Added `BaseErrorOptions` and exported it from the package root.
- Added `ProblemDetailsOptions` and exported it from the package root.
- Added `detail` to `toProblemDetails()` options so boundary layers can provide a public, client-safe message separately from the technical error message.
- Added `extensions` for explicit public Problem Details extension members.
- Added `mapDetails` to `toProblemDetails()` and `toErrorResponse()` for DDD-friendly boundary mapping from raw domain/application details to public members — the only path for surfacing details to clients. It is invoked only when the error carries `details` and receives a defined `TDetails`, so callbacks never have to guard against `undefined`.
- Added `publicCategory` to `toProblemDetails()` for projecting a deliberate, client-safe category (symmetric with `toErrorResponse()`).
- `guard()` now also accepts an error factory (`() => BaseError`) so the error is constructed only when the assertion fails.
- Added `matchError(error, cases)` — exhaustive, type-narrowing dispatch on a structured error's `code`. Omitting a case is a compile error unless a `_` catch-all is given; each handler receives the error narrowed to its case, and the result type is the union of the handler return types.
- Added `redact(keys, { mask? })`, `redactAllow(keys, { mask? })` and `redactWith(fn)` — sticky, opt-in PII redaction on the **log** path (`toLogObject`/`toJSON`), so even a logger's `JSON.stringify(error)` is masked. `redact` deep-masks matching keys (deny-list, default mask `"[REDACTED]"`, configurable); `redactAllow` is an allow-list that masks every `details` leaf except the listed ones (higher assurance — new fields leak nothing); `redactWith` transforms the whole log object (e.g. scrubbing free text in `message`, or delegating to a dedicated redaction library). The mask may be a string or a function `(value, key) => unknown` for partial masking (`****6789`) or type preservation.
- `StructuredError.fromJSON` now restores author-provided `userMessage` and localized messages on round-trip (previously dropped). Documented that it always returns a base `StructuredError` — subclass identity (e.g. `ValidationError`) and `publicCode`/`publicMessage` (not in the log shape) are not reconstructed.
- `defineErrors` now rejects `"meta"` as an error code (it is the metadata accessor), and `meta(code)` throws a clear "unknown error code" error for codes absent from the catalog (instead of returning `undefined` and crashing the `.httpStatus` access) and returns a copy of the spec row so callers can't mutate the catalog.
- `toStructuredError` now returns `StructuredError<string, string>` instead of the option's literal code/category. A pre-existing `StructuredError` passes through unchanged, so promising the option literal in the return type was unsound (downstream `code === '…'` / matchError would compile but never match).
- Hardened redaction. `redactAllow` masks every non-allowed leaf across **any** data region — a `details` subtree (at any depth) and a cause's data fields — while leaving the top-level envelope and a cause's structural envelope keys (`name`/`message`/`stack`/`code`/`category`/`retryable`) intact; any _other_ field on a cause is data, so an object that merely resembles a structured error can't smuggle siblings past the allow-list (the classification is by position, not by a spoofable shape check). The deny-list (`redact`) masks matching keys at any depth, **including inside class instances**. The shared walker treats `Date`/`Map`/`Set` (and other own-key-less objects) as preserved leaves instead of collapsing them to `{}`, and descends into objects that carry own enumerable keys. The fail-closed marker keeps non-sensitive triage fields (`name`/`code`/`category`/`retryable`/timestamps).
- Added `partialMask({ keepStart?, keepEnd?, fill? })` — a `RedactMask` builder that reveals a prefix/suffix and masks the middle (`sk_live…AbCd`), useful to show _which_ secret it was. Fully masks values too short to reveal safely (`length <= keepStart + keepEnd`) and non-strings. A throwing redactor is **fail-closed**: it neither crashes the logging path nor leaks the payload. The client serializers are unaffected (already safe). Defense-in-depth, not a replacement for logger-level redaction.
- Added `StructuredError.fromJSON(json)` — the inverse of `toJSON`: reconstructs a typed `StructuredError` (with `code`/`category`/`retryable`/`details`, the original `stack`/`timestamp`, and the cause chain) from the serialized shape. For reconstruction within one trust/bounded-context boundary (worker/`postMessage`, queues/storage, log replay); lenient (malformed input → a safe envelope, never throws) and prototype-pollution-safe (whitelisted fields only). Across services, translate through an ACL rather than trusting reconstructed fields.
- Added `ValidationError` — an aggregate that collects N field-level issues into one `StructuredError`. Issues match the Standard Schema `Issue` shape (so Zod/Valibot/ArkType/TanStack Form output pipes in), are kept in full for logs, and cross to a client only via the explicit `publicIssues()` whitelist (`message`/`path`/`code?`/`pointer?` — never raw validator extras). `mapIssue` emits any wire shape (e.g. RFC-7807 `{ name, reason }`). Exposes `ValidationIssue`/`PublicIssue` types.
- Added `toStructuredError(value, options?)` — coerces any caught value into a `StructuredError` (a consistent boundary envelope; a `StructuredError` passes through, other `Error`s are preserved as `cause`). Honest defaults (`UNKNOWN_ERROR`/`INTERNAL`/non-retryable) and an optional second parameter so it fits the `errorMapper` slot of `@shirudo/result`.
- Added `defineErrors(catalog)` — a declarative error catalog that generates a typed factory per `code` (with `category`, `retryable` and the public mapping baked in) plus a `meta(code)` accessor for boundary metadata such as `httpStatus`. Exposes the `ErrorSpec`, `Catalog` and `CatalogError` types; `CatalogError<typeof catalog>` is the closed union to pass to `matchError`.
- The public serializers (`toPublicJSON`, `toProblemDetails`, `toErrorResponse`) accept `locale` / `fallbackLocale`. When a matching author-provided localized message exists it becomes the public message — surfaced without `expose`, since these strings are client-safe by design. An explicit `message`/`detail` still wins, and missing locales fall back to `publicMessage` without leaking the default user message.
- Added package metadata for `sideEffects`, `engines`, `packageManager`, homepage, and npm provenance.

### Fixed

- `StructuredError` now captures stack headers with the configured error code instead of rewriting `name` after stack capture.
- Cause-chain traversal (`getRootCause`, `findInCauseChain`, `filterCauseChain`, `someCauseChain`, `everyCauseChain`, and the retryability helpers) no longer steps onto a spurious `undefined` when an error carries an explicit `cause: undefined` (e.g. `new Error(msg, { cause: undefined })`).
- `toProblemDetails()` return type no longer falsely includes the raw `details` shape; it reflects only the mapped/explicit extensions actually present at runtime, so the type can no longer invite reading internal fields that are absent.
- `mapDetails` is invoked only when the error carries `details`, so a naive mapper can no longer throw while serializing an error inside an error handler.
- Build no longer runs `lint:fix`; it verifies lint deterministically.
- CI now runs `pnpm test:run` explicitly.

### Migration

See [`MIGRATION.md`](./MIGRATION.md) for v4-to-v5 migration examples.
