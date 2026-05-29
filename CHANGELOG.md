# Changelog

## 5.0.0 - 2026-05-29

### Breaking Changes

- `StructuredError.toProblemDetails()` and `StructuredError.toErrorResponse()` are safe by default. They no longer expose technical messages, internal codes, categories, or raw `details` unless public fields or explicit exposure options are used.
- Safe-by-default is invariant: standard Problem Details members (`type`, `title`, `status`, `detail`, `instance`) and library members (`code`, `category`, `retryable`, `traceId`) always win over colliding extension keys. There is no override switch.
- Raw `details` never cross into client responses. Surfacing details is always an explicit `mapDetails` projection on both `toProblemDetails()` and `toErrorResponse()`; full-fidelity details remain available for observability via `toLogObject()`.
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
- Added `mapDetails` to `toProblemDetails()` and `toErrorResponse()` for DDD-friendly boundary mapping from raw domain/application details to public members — the only path for surfacing details to clients.
- Added `publicCategory` to `toProblemDetails()` for projecting a deliberate, client-safe category (symmetric with `toErrorResponse()`).
- Added package metadata for `sideEffects`, `engines`, `packageManager`, homepage, and npm provenance.

### Fixed

- `StructuredError` now captures stack headers with the configured error code instead of rewriting `name` after stack capture.
- Build no longer runs `lint:fix`; it verifies lint deterministically.
- CI now runs `pnpm test:run` explicitly.

### Migration

See [`MIGRATION.md`](./MIGRATION.md) for v4-to-v5 migration examples.
