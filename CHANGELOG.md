# Changelog

## 5.0.0

### Breaking Changes

- Changed `StructuredError.toProblemDetails()` to stop exposing raw `details` as top-level Problem Details extension members by default.
- Standard Problem Details members (`type`, `title`, `status`, `detail`, `instance`) and library members (`code`, `category`, `retryable`, `traceId`) now win over extension key collisions by default.
- Updated the package version from `4.7.0` to `5.0.0`.

### Added

- Added `BaseErrorOptions` and exported it from the package root.
- Added an explicit `BaseError` construction name option so subclasses such as `StructuredError` can set their stable observability identity before stack capture.
- Added `ProblemDetailsOptions` and exported it from the package root.
- Added `detail` to `toProblemDetails()` options so boundary layers can provide a public, client-safe message separately from the technical error message.
- Added `extensions` for explicit public Problem Details extension members.
- Added `mapDetails` for DDD-friendly boundary mapping from raw domain/application details to public extension members.
- Added `includeDetails` as an explicit opt-in for exposing raw `StructuredError.details`.
- Added `allowExtensionOverrides` as an explicit power-user escape hatch for overriding standard/library Problem Details members.

### Fixed

- Fixed `StructuredError` stack headers so they consistently use the structured error `code` instead of briefly capturing the concrete class name before mutating `name`.

### Migration

See [`MIGRATION.md`](./MIGRATION.md) for v4-to-v5 migration examples.
