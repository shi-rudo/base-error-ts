# Changelog

## 7.2.0 - 2026-06-25

### Added

- New `@shirudo/base-error/public-error` subpath: a public-error pipeline of three independent stages over one descriptor per public code, `project` (curation, total over `unknown`, message-free), `localize` (optional localization, keyed on the public code), and `toProblem` (RFC 9457 transport with a JSON-safe, frozen wire body). Serves three consumption modes from one registration: client-localizing (SPA/Edge), backend-localizing (SSR/email), and a consumable third-party API. Includes a typed public-code union for exhaustive client branching (`PublicCodeOf`), an `onProject` observability hook, catalog-free entry points (`projectWithDescriptor`, explicit transports), registration-time validation, and conflict checks for the wire identity (status/type/title/category/userMessages). See proposal 0011 and the runnable `examples/public-error-e2e.ts`.

### Changed

- Extracted shared internal helpers reused by the problem-details adapter, the presentation registry, and the new public-error module: a JSON-safe clone-and-freeze, the RFC 9457 status/type field validation (and the `application/problem+json` media type), and the code-then-predicate error resolution. Removes duplication; runtime behavior is unchanged.

## 7.1.1 - 2026-06-23

### Fixed

- `matchError` now looks up handlers by own property only, so an error `code` that collides with an `Object.prototype` member (`toString`, `valueOf`, `hasOwnProperty`, `constructor`, …) routes to its explicit case or the `_` catch-all instead of an inherited method. Such codes are already valid in `defineErrors`, so a catalog union could previously mis-dispatch (or throw a confusing error) on match.
- `BaseError` cause serialization (`toLogObject`/`toJSON`) caps the cause chain at depth 100, matching `StructuredError.fromJSON` and the traversal helpers, so a pathologically deep but acyclic chain no longer risks a stack overflow while logging. Beyond the cap the chain ends in `"[Max cause depth exceeded]"`.
- Log redaction (`redact`/`redactAllow`/`redactWith`) now clones into null-prototype objects, so an own `__proto__` (or `constructor`) key in untrusted `details` (e.g. from `JSON.parse`/`fromJSON`) is masked as ordinary data instead of routing through a prototype setter. Closes a local prototype-reassignment footgun on the redacted log clone; global prototypes were never affected. (OWASP Prototype Pollution Prevention.)
- Log redaction caps its walk depth at 100: a pathologically deep `details` tree degrades to a `"[Max redaction depth exceeded]"` marker at the deep end (shallow fields survive) instead of overflowing the stack and tripping the fail-closed path. The bound is host-stack independent, so redaction behaves identically on small isolate stacks (edge runtimes).

### Documentation

- Documented on `toLogObject`/`toJSON` that the output is a log shape carrying the technical message, stack, cause chain and raw `details`, must never be returned to a client, and that the `presentation` subpath is the client-safe path. The `toJSON`/`toLogObject` equality is intentional: it is the shape `StructuredError.fromJSON` reconstructs.

## 7.1.0 - 2026-06-22

### Added

- Added the optional `@shirudo/base-error/problem-details` subpath with a framework-neutral RFC 9457 adapter for safe `PublicErrorView` values.
- Added finite public-code mappings, an explicit fallback, consistent HTTP/body status output, localized titles, occurrence details and instances, JSON-safe extensions, immutable snapshots, mapping diagnostics, and compile-time collision protection.
- Added literal public-code typing to `PublicErrorView<TDetails, TCode>` while preserving the existing default `string` code type.

## 7.0.0 - 2026-06-22

### Breaking Changes

- Catalog factories now live under `catalog.create`: migrate `AppErrors.CODE(message, options)` to `AppErrors.create.CODE(message, options)`.
- Catalog definitions declare transport-neutral `metadata` instead of the fixed top-level `httpStatus`; read it through `AppErrors.meta(code).metadata`.
- Catalog detail shapes use `detailsType<T>()` instead of consumer-side type assertions.
- Catalog definitions must be non-empty finite plain objects with non-empty string codes and are snapshotted and frozen at creation.

### Added

- Added catalog-local provenance guards: `AppErrors.is(value)` narrows to the catalog union and `AppErrors.is(value, code)` narrows to one generated error type. Forged, reconstructed, mutated, and foreign-catalog errors fail closed.
- Added `CatalogErrorOf<Catalog, Code>`, immutable `codes`, JSON-safe generic catalog metadata, and catalog-level deny/allow log-redaction policies.
- Error codes no longer collide with catalog operations, so codes such as `meta`, `create`, and `is` are valid.

## 6.3.0 - 2026-06-21

### Added

- Added `defineErrorClassSet` for reusable exhaustive matching over a finite set of local Error classes. Definitions preserve literal string keys, reject empty or duplicate constructor sets, snapshot their input, and require an exact handler table with precise inputs and result unions.

## 6.2.0 - 2026-06-21

### Added

- Added `matchThrown` and `ThrownMatcher` for immutable, first-match-wins handling of arbitrary caught values with constructor cases, constructor groups, type guards, boolean predicates, an explicit fallback, precise result unions, and native promise inference.

## 6.1.0 - 2026-06-21

### Added

- Added general-purpose guards for caught `unknown` values: `isError`, `hasErrorCode`, `isErrorOf`, `isAnyErrorOf`, and `isAllOf`, plus the `ErrorLike`, `ErrorClass`, and `TypeGuard` types. Structural guards fail closed on hostile property access; constructor guards retain precise class unions, and guard composition narrows to intersections.

## 6.0.0 - 2026-06-13

### Breaking Changes

- The core is now purely technical. Localization, the `expose` flag, and every public serializer were removed from `BaseError` and `StructuredError`. Removed: `toPublicJSON()`, `toProblemDetails()`, `toErrorResponse()`, `withUserMessage()`, `addLocalizedMessage()`, `updateLocalizedMessage()`, `getUserMessage()`, `withPublicCode()`, `withPublicMessage()`, `exposeToClients()`, the `expose` flag, and `publicCode`/`publicMessage` on `ErrorOptions` and the catalog `ErrorSpec`. The `TPublicCode` generic parameter is gone.
- Removed the entire response layer: `errorResponse`, `successResponse`, `createErrorResponse`, `createSuccessResponse`, `ErrorResponseBuilder`, `ApiResponse`, `SuccessResponse`, `ErrorResponse`, `LocalizedMessage`, and the `ProblemDetails` / `ProblemDetailsOptions` types.
- `StructuredError.fromJSON` no longer restores user or localized messages.
- `defineErrors` keeps `httpStatus` and `meta(code)` but no longer accepts `publicCode` / `publicMessage`.
- Requires Node.js `>=20`.

See the [migration guide](./MIGRATION.md) for the removed-API to replacement mapping.

### Added

- New optional subpath export `@shirudo/base-error/presentation` for safe, localized, transport-neutral public output: `LocalizedMessageSet`, `resolveUserMessage`, `PublicErrorDefinition`, `PublicErrorRegistry` (with `assertCoverage`), and a total `PublicErrorPresenter` that produces a `PublicErrorView`. Transport (HTTP status, gRPC, CLI exit code) is a consumer adapter concern.

### Changed

- The module and edge boundaries are enforced by ESLint: the core may not import the presentation module, and library source may not use Node globals (`process`, `Buffer`) or `node:*` imports. The runtime-pure suite also runs on workerd (via `@cloudflare/vitest-pool-workers`) in CI.

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
- Added `mapDetails` to `toProblemDetails()` and `toErrorResponse()` for DDD-friendly boundary mapping from raw domain/application details to public members. This is the only path for surfacing details to clients. It is invoked only when the error carries `details` and receives a defined `TDetails`, so callbacks never have to guard against `undefined`.
- Added `publicCategory` to `toProblemDetails()` for projecting a deliberate, client-safe category (symmetric with `toErrorResponse()`).
- `guard()` now also accepts an error factory (`() => BaseError`) so the error is constructed only when the assertion fails.
- Added `matchError(error, cases)`: exhaustive, type-narrowing dispatch on a structured error's `code`. Omitting a case is a compile error unless a `_` catch-all is given; each handler receives the error narrowed to its case, and the result type is the union of the handler return types.
- Added `redact(keys, { mask? })`, `redactAllow(keys, { mask? })` and `redactWith(fn)`: sticky, opt-in PII redaction on the **log** path (`toLogObject`/`toJSON`), so even a logger's `JSON.stringify(error)` is masked. `redact` deep-masks matching keys (deny-list, default mask `"[REDACTED]"`, configurable); `redactAllow` is an allow-list that masks every `details` leaf except the listed ones (higher assurance, meaning new fields leak nothing); `redactWith` transforms the whole log object (e.g. scrubbing free text in `message`, or delegating to a dedicated redaction library). The mask may be a string or a function `(value, key) => unknown` for partial masking (`****6789`) or type preservation.
- `StructuredError.fromJSON` now restores author-provided `userMessage` and localized messages on round-trip (previously dropped). Documented that it always returns a base `StructuredError`: subclass identity (e.g. `ValidationError`) and `publicCode`/`publicMessage` (not in the log shape) are not reconstructed.
- `defineErrors` now rejects `"meta"` as an error code (it is the metadata accessor), and `meta(code)` throws a clear "unknown error code" error for codes absent from the catalog (instead of returning `undefined` and crashing the `.httpStatus` access) and returns a copy of the spec row so callers can't mutate the catalog.
- `toStructuredError` now returns `StructuredError<string, string>` instead of the option's literal code/category. A pre-existing `StructuredError` passes through unchanged, so promising the option literal in the return type was unsound (downstream `code === '…'` / matchError would compile but never match).
- Hardened redaction. `redactAllow` masks every non-allowed leaf across **any** data region (a `details` subtree at any depth and a cause's data fields) while leaving the top-level envelope and a cause's structural envelope keys (`name`/`message`/`stack`/`code`/`category`/`retryable`) intact; any _other_ field on a cause is data, so an object that merely resembles a structured error can't smuggle siblings past the allow-list (the classification is by position, not by a spoofable shape check). The deny-list (`redact`) masks matching keys at any depth, **including inside class instances**. The shared walker treats `Date`/`Map`/`Set` (and other own-key-less objects) as preserved leaves instead of collapsing them to `{}`, and descends into objects that carry own enumerable keys. The fail-closed marker keeps non-sensitive triage fields (`name`/`code`/`category`/`retryable`/timestamps).
- Added `partialMask({ keepStart?, keepEnd?, fill? })`: a `RedactMask` builder that reveals a prefix/suffix and masks the middle (`sk_live…AbCd`), useful to show _which_ secret it was. Fully masks values too short to reveal safely (`length <= keepStart + keepEnd`) and non-strings. A throwing redactor is **fail-closed**: it neither crashes the logging path nor leaks the payload. The client serializers are unaffected (already safe). Defense-in-depth, not a replacement for logger-level redaction.
- Added `StructuredError.fromJSON(json)`, the inverse of `toJSON`: reconstructs a typed `StructuredError` (with `code`/`category`/`retryable`/`details`, the original `stack`/`timestamp`, and the cause chain) from the serialized shape. For reconstruction within one trust/bounded-context boundary (worker/`postMessage`, queues/storage, log replay); lenient (malformed input → a safe envelope, never throws) and prototype-pollution-safe (whitelisted fields only). Across services, translate through an ACL rather than trusting reconstructed fields.
- Added `ValidationError`: an aggregate that collects N field-level issues into one `StructuredError`. Issues match the Standard Schema `Issue` shape (so Zod/Valibot/ArkType/TanStack Form output pipes in), are kept in full for logs, and cross to a client only via the explicit `publicIssues()` whitelist (`message`/`path`/`code?`/`pointer?`, never raw validator extras). `mapIssue` emits any wire shape (e.g. RFC-7807 `{ name, reason }`). Exposes `ValidationIssue`/`PublicIssue` types.
- Added `toStructuredError(value, options?)`: coerces any caught value into a `StructuredError` (a consistent boundary envelope; a `StructuredError` passes through, other `Error`s are preserved as `cause`). Honest defaults (`UNKNOWN_ERROR`/`INTERNAL`/non-retryable) and an optional second parameter so it fits the `errorMapper` slot of a `Result` type.
- Added `defineErrors(catalog)`: a declarative error catalog that generates a typed factory per `code` (with `category`, `retryable` and the public mapping baked in) plus a `meta(code)` accessor for boundary metadata such as `httpStatus`. Exposes the `ErrorSpec`, `Catalog` and `CatalogError` types; `CatalogError<typeof catalog>` is the closed union to pass to `matchError`.
- The public serializers (`toPublicJSON`, `toProblemDetails`, `toErrorResponse`) accept `locale` / `fallbackLocale`. When a matching author-provided localized message exists it becomes the public message, surfaced without `expose`, since these strings are client-safe by design. An explicit `message`/`detail` still wins, and missing locales fall back to `publicMessage` without leaking the default user message.
- Added package metadata for `sideEffects`, `engines`, `packageManager`, and homepage.

### Fixed

- `StructuredError` now captures stack headers with the configured error code instead of rewriting `name` after stack capture.
- Cause-chain traversal (`getRootCause`, `findInCauseChain`, `filterCauseChain`, `someCauseChain`, `everyCauseChain`, and the retryability helpers) no longer steps onto a spurious `undefined` when an error carries an explicit `cause: undefined` (e.g. `new Error(msg, { cause: undefined })`).
- `toProblemDetails()` return type no longer falsely includes the raw `details` shape; it reflects only the mapped/explicit extensions actually present at runtime, so the type can no longer invite reading internal fields that are absent.
- `mapDetails` is invoked only when the error carries `details`, so a naive mapper can no longer throw while serializing an error inside an error handler.
- Build no longer runs `lint:fix`; it verifies lint deterministically.
- CI now runs `pnpm test:run` explicitly.

### Migration

See [`MIGRATION.md`](./MIGRATION.md) for v4-to-v5 migration examples.
