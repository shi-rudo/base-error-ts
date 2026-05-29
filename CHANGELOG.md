# Changelog

## 5.0.0 - 2026-05-29

### Breaking Changes

- `StructuredError.toProblemDetails()` and `StructuredError.toErrorResponse()` are safe by default. They no longer expose technical messages, internal codes, categories, or details unless public fields or explicit exposure options are used.
- `typescript` is no longer a peer dependency. The package still ships TypeScript declarations.

### Added

- Added `toLogObject()` for explicit logging serialization with stack and cause chains.
- Added `toPublicJSON()` for client-safe serialization.
- Added `publicCode`, `publicMessage`, and `expose` options to map internal domain/infrastructure errors to stable public API errors.
- Added package metadata for `sideEffects`, `engines`, `packageManager`, homepage, and npm provenance.

### Fixed

- `StructuredError` now captures stack headers with the configured error code instead of rewriting `name` after stack capture.
- Build no longer runs `lint:fix`; it verifies lint deterministically.
- CI now runs `pnpm test:run` explicitly.
