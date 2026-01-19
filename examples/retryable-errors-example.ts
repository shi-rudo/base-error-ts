/**
 * Example: Retryable Errors with Response Mapping
 *
 * Shows how to define domain errors with retryable logic
 * and map them to ErrorResponse for API responses.
 */

import {
  StructuredError,
  createErrorResponse,
  successResponse,
  type ErrorResponse,
  type SuccessResponse,
} from "../src/index.js";

// ─────────────────────────────────────────────────────────────
// 1. Define Error Codes and Categories
// ─────────────────────────────────────────────────────────────

const ErrorCodes = {
  // Retryable errors
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  DATABASE_TIMEOUT: "DATABASE_TIMEOUT",

  // Non-retryable errors
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",
} as const;

type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

type ErrorCategory =
  | "AUTH"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMIT"
  | "INFRASTRUCTURE";

// ─────────────────────────────────────────────────────────────
// 2. Define which errors are retryable
// ─────────────────────────────────────────────────────────────

const RETRYABLE_CODES: Set<ErrorCode> = new Set([
  ErrorCodes.RATE_LIMITED,
  ErrorCodes.SERVICE_UNAVAILABLE,
  ErrorCodes.NETWORK_TIMEOUT,
  ErrorCodes.DATABASE_TIMEOUT,
]);

function isRetryableCode(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

// ─────────────────────────────────────────────────────────────
// 3. Create Domain Error Class
// ─────────────────────────────────────────────────────────────

type AppErrorDetails = {
  field?: string;
  resource?: string;
  retryAfter?: number;
  attemptCount?: number;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
};

class AppError extends StructuredError<
  ErrorCode,
  ErrorCategory,
  AppErrorDetails
> {
  constructor(
    code: ErrorCode,
    category: ErrorCategory,
    message: string,
    details?: AppErrorDetails,
    cause?: unknown,
  ) {
    super({
      code,
      category,
      retryable: isRetryableCode(code), // Auto-set based on code
      message,
      details,
      cause,
    });
  }

  // Factory methods for common errors
  static unauthorized(message = "Authentication required") {
    return new AppError("UNAUTHORIZED", "AUTH", message);
  }

  static notFound(resource: string, id: string) {
    return new AppError(
      "NOT_FOUND",
      "NOT_FOUND",
      `${resource} with id ${id} not found`,
      { resource },
    );
  }

  static rateLimited(retryAfter: number) {
    return new AppError(
      "RATE_LIMITED",
      "RATE_LIMIT",
      `Rate limit exceeded. Retry after ${retryAfter}s`,
      { retryAfter },
    );
  }

  static serviceUnavailable(service: string, cause?: unknown) {
    return new AppError(
      "SERVICE_UNAVAILABLE",
      "INFRASTRUCTURE",
      `${service} is temporarily unavailable`,
      {},
      cause,
    );
  }

  static validationFailed(field: string, reason: string) {
    return new AppError(
      "VALIDATION_FAILED",
      "VALIDATION",
      `Validation failed for ${field}: ${reason}`,
      { field },
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Map to ErrorResponse
// ─────────────────────────────────────────────────────────────

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  NETWORK_TIMEOUT: 504,
  DATABASE_TIMEOUT: 504,
};

function toResponse(error: AppError) {
  return createErrorResponse({
    code: error.code,
    category: error.category,
    retryable: error.retryable,
    ctx: {
      httpStatusCode: HTTP_STATUS[error.code],
      message: error.message,
    },
    details: error.details,
  });
}

// Or use the built-in toErrorResponse method
function toResponseAlt(error: AppError) {
  return error.toErrorResponse({
    httpStatusCode: HTTP_STATUS[error.code],
  });
}

// ─────────────────────────────────────────────────────────────
// 5. Define Response Types for your API
// ─────────────────────────────────────────────────────────────

type AppErrorResponse = ErrorResponse<
  ErrorCode,
  ErrorCategory,
  { httpStatusCode: number; message: string },
  AppErrorDetails
>;

type ApiResponse<T> = SuccessResponse<T> | AppErrorResponse;

// ─────────────────────────────────────────────────────────────
// 6. Usage in Service/Handler
// ─────────────────────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
}

// Simulated database
const users = new Map<string, User>([
  ["1", { id: "1", name: "Alice", email: "alice@example.com" }],
]);

async function getUser(id: string): Promise<ApiResponse<User>> {
  // Simulate rate limiting
  if (Math.random() < 0.1) {
    const error = AppError.rateLimited(60);
    return toResponse(error);
  }

  const user = users.get(id);
  if (!user) {
    const error = AppError.notFound("User", id);
    return toResponse(error);
  }

  return successResponse(user);
}

// ─────────────────────────────────────────────────────────────
// 7. Client-side handling with retry logic
// ─────────────────────────────────────────────────────────────

async function fetchWithRetry<T>(
  fn: () => Promise<ApiResponse<T>>,
  maxRetries = 3,
): Promise<ApiResponse<T>> {
  let lastResponse: ApiResponse<T>;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResponse = await fn();

    if (lastResponse.isSuccess) {
      return lastResponse;
    }

    // After checking isSuccess is false, we have AppErrorResponse
    // Use assertion since TS doesn't narrow across variable assignments
    const errorResponse = lastResponse as AppErrorResponse;

    // Check if retryable
    if (!errorResponse.error.retryable || attempt === maxRetries) {
      return errorResponse;
    }

    // Type-safe access to retryAfter - no cast needed!
    const retryAfter = errorResponse.error.details.retryAfter ?? attempt;
    console.log(
      `Attempt ${attempt} failed (${errorResponse.error.code}), retrying in ${retryAfter}s...`,
    );

    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }

  return lastResponse!;
}

// ─────────────────────────────────────────────────────────────
// Demo
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Retryable Errors Example\n");
  console.log("=".repeat(60));

  // Example 1: Successful request
  console.log("\n1. Fetching existing user:");
  const response1 = await getUser("1");
  if (response1.isSuccess) {
    console.log("Success:", response1.data);
  }

  // Example 2: Not found (non-retryable)
  console.log("\n2. Fetching non-existent user:");
  const response2 = await getUser("999");
  if (!response2.isSuccess) {
    // Type-safe access - the discriminated union narrows to AppErrorResponse
    console.log("Error:", response2.error.code);
    console.log("Retryable:", response2.error.retryable); // false
    console.log("HTTP Status:", response2.error.ctx.httpStatusCode); // 404
  }

  // Example 3: Create retryable errors
  console.log("\n3. Retryable error examples:");

  const rateLimitError = AppError.rateLimited(30);
  console.log(
    `- ${rateLimitError.code}: retryable=${rateLimitError.retryable}`,
  );

  const serviceError = AppError.serviceUnavailable("Payment Gateway");
  console.log(`- ${serviceError.code}: retryable=${serviceError.retryable}`);

  const authError = AppError.unauthorized();
  console.log(`- ${authError.code}: retryable=${authError.retryable}`);

  // Example 4: Response structure
  console.log("\n4. ErrorResponse structure:");
  const errorResponse = toResponse(rateLimitError);
  console.log(JSON.stringify(errorResponse, null, 2));

  // Example 5: Using toErrorResponse method
  console.log("\n5. Using toErrorResponse() method:");
  const altResponse = toResponseAlt(serviceError);
  console.log(JSON.stringify(altResponse, null, 2));

  // Example 6: Using fetchWithRetry for automatic retry handling
  console.log("\n6. Using fetchWithRetry (type-safe retry logic):");
  const result = await fetchWithRetry(() => getUser("1"), 2);
  if (result.isSuccess) {
    console.log("Fetched user with retry support:", result.data.name);
  } else {
    console.log("Failed after retries:", result.error.code);
  }
}

main().catch(console.error);
