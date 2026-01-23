// ────────────────────────────────────────────────────────────────
// Error Classes
// ────────────────────────────────────────────────────────────────
export { BaseError } from "./errors/BaseError.js";
export { StructuredError } from "./errors/StructuredError.js";
export type { ErrorOptions } from "./errors/ErrorOptions.js";

// ────────────────────────────────────────────────────────────────
// API Response Types
// ────────────────────────────────────────────────────────────────
export type {
  LocalizedMessage,
  SuccessResponse,
  ErrorDetails,
  ErrorResponse,
  ApiResponse,
} from "./response/types.js";
export type { ProblemDetails } from "./response/ProblemDetails.js";

// ────────────────────────────────────────────────────────────────
// API Response Builder & Factories
// ────────────────────────────────────────────────────────────────
export { ErrorResponseBuilder } from "./response/builder.js";
export {
  errorResponse,
  successResponse,
  createErrorResponse,
  createSuccessResponse,
} from "./response/factories.js";

// ────────────────────────────────────────────────────────────────
// Utilities & Type Guards
// ────────────────────────────────────────────────────────────────
export { guard } from "./utils/guard.js";
export {
  isBaseError,
  isStructuredError,
  isRetryable,
} from "./errors/guards.js";

// ────────────────────────────────────────────────────────────────
// Cause Chain Traversal
// ────────────────────────────────────────────────────────────────
export * from "./traversal/index.js";
