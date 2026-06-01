# Changelog

## 5.0.0 - 2026-05-29

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
