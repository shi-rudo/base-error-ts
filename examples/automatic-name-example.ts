import { BaseError } from "../src/index.js";

/**
 * Automatic Name Inference Example
 *
 * This example demonstrates the new automatic name inference feature
 * that eliminates the need to specify the error name twice.
 */
// Using automatic name inference (new feature)
class UserNotFoundError extends BaseError<"UserNotFoundError"> {
  constructor(userId: string) {
    super(`User ${userId} not found`);
  }
}

class ValidationError extends BaseError<"ValidationError"> {
  constructor(field: string, message: string) {
    super(`Validation failed for ${field}: ${message}`);
  }
}

class DatabaseError extends BaseError<"DatabaseError"> {
  constructor(operation: string, cause?: unknown) {
    super(`Database operation failed: ${operation}`, cause);
  }
}

// Note: Legacy explicit name approach has been removed for API clarity

// Example usage
function main() {
  console.log("Automatic Name Inference Example\n");

  // Test automatic name inference
  try {
    throw new UserNotFoundError("user-123");
  } catch (error) {
    console.log("UserNotFoundError (automatic name):");
    console.log(`Name: ${error.name}`);
    console.log(`Message: ${error.message}`);
    console.log(`Type check: ${error instanceof UserNotFoundError}`);
    console.log();
  }

  try {
    throw new ValidationError("email", "must be a valid email address");
  } catch (error) {
    console.log("ValidationError (automatic name):");
    console.log(`Name: ${error.name}`);
    console.log(`Message: ${error.message}`);
    console.log();
  }

  try {
    const dbError = new Error("Connection timeout");
    throw new DatabaseError("user creation", dbError);
  } catch (error) {
    console.log("DatabaseError with cause (automatic name):");
    console.log(`Name: ${error.name}`);
    console.log(`Message: ${error.message}`);
    console.log(
      `Has cause: ${!!(error as unknown as Record<string, unknown>).cause}`,
    );
    console.log();
  }

  // Note: Legacy explicit name test removed - only automatic name inference is supported

  console.log("All tests completed successfully!");
}

// Run the example
main();
