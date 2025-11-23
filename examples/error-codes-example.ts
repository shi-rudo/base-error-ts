/**
 * Error Codes Example
 *
 * This example demonstrates how to use BaseError with predefined error codes
 * as TypeScript union types for better type safety and consistency.
 */
import { BaseError } from "../src/index.js";

// Define your error codes as a union type
type ErrorCode =
  | "USER_NOT_FOUND"
  | "USER_NOT_AUTHORIZED"
  | "USER_NOT_AUTHENTICATED"
  | "USER_QUOTA_LIMIT_REACHED";

// Base class for all user-related errors with automatic name inference
class UserError<T extends ErrorCode> extends BaseError<T> {
  /** Discriminant for type safety - ensures this error is distinct from other error types */
  public readonly _tag = "UserError" as const;

  constructor(
    public readonly code: T,
    message: string,
    public readonly userId?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.code = code;
  }

  // Override toJSON to include the error code
  toJSON() {
    return {
      ...super.toJSON(),
      code: this.code,
      userId: this.userId,
    };
  }
}

// Specific error classes using automatic name inference
class UserNotFoundError extends UserError<"USER_NOT_FOUND"> {
  constructor(userId: string) {
    super("USER_NOT_FOUND", `User with ID ${userId} was not found`, userId);
  }
}

class UserNotAuthorizedError extends UserError<"USER_NOT_AUTHORIZED"> {
  constructor(userId: string, resource: string) {
    super(
      "USER_NOT_AUTHORIZED",
      `User ${userId} is not authorized to access ${resource}`,
      userId,
    );
  }
}

class UserNotAuthenticatedError extends UserError<"USER_NOT_AUTHENTICATED"> {
  constructor(message: string = "User authentication required") {
    super("USER_NOT_AUTHENTICATED", message);
  }
}

class UserQuotaLimitReachedError extends UserError<"USER_QUOTA_LIMIT_REACHED"> {
  constructor(userId: string, currentQuota: number, limitQuota: number) {
    super(
      "USER_QUOTA_LIMIT_REACHED",
      `User ${userId} has exceeded quota limit (${currentQuota}/${limitQuota})`,
      userId,
    );
  }
}

// Alternative approach: Generic error factory function
function createUserError<T extends ErrorCode>(
  code: T,
  message: string,
  userId?: string,
  cause?: unknown,
): UserError<T> {
  return new UserError(code, message, userId, cause);
}

// Error handler that provides type-safe error handling
function handleUserError(error: unknown): void {
  if (error instanceof UserError) {
    console.log(`Error Code: ${error.code}`);
    console.log(`Error Name: ${error.name}`);
    console.log(`Message: ${error.message}`);
    console.log(`User ID: ${error.userId || "N/A"}`);
    console.log(`Timestamp: ${error.timestampIso}`);

    // Type-safe error handling based on code
    switch (error.code) {
      case "USER_NOT_FOUND":
        console.log("→ Redirecting to user registration page");
        break;
      case "USER_NOT_AUTHORIZED":
        console.log("→ Redirecting to access denied page");
        break;
      case "USER_NOT_AUTHENTICATED":
        console.log("→ Redirecting to login page");
        break;
      case "USER_QUOTA_LIMIT_REACHED":
        console.log("→ Showing upgrade options");
        break;
    }
  } else {
    console.log("Unknown error:", error);
  }
}

// Example usage
function main() {
  console.log("Error Codes Example\n");

  // Example 1: User not found
  try {
    throw new UserNotFoundError("user-123");
  } catch (error) {
    console.log("=== User Not Found ===");
    handleUserError(error);
    console.log();
  }

  // Example 2: User not authorized
  try {
    throw new UserNotAuthorizedError("user-456", "/admin/dashboard");
  } catch (error) {
    console.log("=== User Not Authorized ===");
    handleUserError(error);
    console.log();
  }

  // Example 3: User not authenticated
  try {
    throw new UserNotAuthenticatedError();
  } catch (error) {
    console.log("=== User Not Authenticated ===");
    handleUserError(error);
    console.log();
  }

  // Example 4: User quota limit reached
  try {
    throw new UserQuotaLimitReachedError("user-789", 1000, 500);
  } catch (error) {
    console.log("=== User Quota Limit Reached ===");
    handleUserError(error);
    console.log();
  }

  // Example 5: Using the factory function
  try {
    const factoryError = createUserError(
      "USER_NOT_FOUND",
      "Custom user not found message",
      "factory-user-001",
    );
    throw factoryError;
  } catch (error) {
    console.log("=== Factory Function Example ===");
    handleUserError(error);
    console.log();
  }

  // Example 6: JSON serialization
  console.log("=== JSON Serialization Example ===");
  const quotaError = new UserQuotaLimitReachedError("json-user", 150, 100);
  console.log("JSON output:");
  console.log(JSON.stringify(quotaError, null, 2));
  console.log();

  // Example 7: Type checking and instanceof
  console.log("=== Type Checking Example ===");
  const authError = new UserNotAuthenticatedError();

  console.log("Type checks:");
  console.log(`instanceof Error: ${authError instanceof Error}`);
  console.log(`instanceof BaseError: ${authError instanceof BaseError}`);
  console.log(`instanceof UserError: ${authError instanceof UserError}`);
  console.log(
    `instanceof UserNotAuthenticatedError: ${authError instanceof UserNotAuthenticatedError}`,
  );
  console.log(`Error code: ${authError.code}`);
  console.log(`Error name: ${authError.name}`);
}

// Run the example
main();
