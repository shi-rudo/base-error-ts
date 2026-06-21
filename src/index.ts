// ────────────────────────────────────────────────────────────────
// Error Classes
// ────────────────────────────────────────────────────────────────
export { BaseError } from "./errors/BaseError.js";
export type { BaseErrorOptions, RedactMask } from "./errors/BaseError.js";
export { StructuredError } from "./errors/StructuredError.js";
export type { ErrorOptions } from "./errors/ErrorOptions.js";
export { matchError } from "./errors/match.js";
export { matchThrown } from "./errors/match-thrown.js";
export type { ThrownMatcher } from "./errors/match-thrown.js";
export { defineErrorClassSet } from "./errors/error-class-set.js";
export type { ErrorClassMap, ErrorClassSet } from "./errors/error-class-set.js";
export { defineErrors } from "./errors/catalog.js";
export type { ErrorSpec, Catalog, CatalogError } from "./errors/catalog.js";
export { toStructuredError } from "./errors/coerce.js";
export type { CoerceOptions } from "./errors/coerce.js";
export { ValidationError } from "./errors/validation.js";
export type {
  ValidationIssue,
  PublicIssue,
  ValidationErrorOptions,
  PublicIssuesOptions,
} from "./errors/validation.js";

// ────────────────────────────────────────────────────────────────
// Utilities & Type Guards
// ────────────────────────────────────────────────────────────────
export { guard } from "./utils/guard.js";
export { partialMask } from "./utils/redact.js";
export {
  isError,
  hasErrorCode,
  isErrorOf,
  isAnyErrorOf,
  isAllOf,
  isBaseError,
  isStructuredError,
  isRetryable,
} from "./errors/guards.js";
export type { ErrorClass, ErrorLike, TypeGuard } from "./errors/guards.js";

// ────────────────────────────────────────────────────────────────
// Cause Chain Traversal
// ────────────────────────────────────────────────────────────────
export * from "./traversal/index.js";
