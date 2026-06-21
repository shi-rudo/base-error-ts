/**
 * Domain Errors Example
 *
 * This example demonstrates a best-practice approach for modeling re-usable
 * domain errors using BaseError. It shows how to create an error hierarchy
 * and handle specific error types gracefully using `instanceof`.
 */
import { BaseError } from "../src/index.js";

// 1. Define a base error for a specific application domain (e.g., User Service).
// This allows for catching all user-related errors with `instanceof UserServiceError`.
class UserServiceError extends BaseError<"UserServiceError"> {
  constructor(
    message: string,
    public readonly userId?: string,
    cause?: unknown,
  ) {
    // The `message` here is for technical logs and debugging.
    super(`User service failure: ${message}`, cause);
  }

  // Override toJSON to add domain-specific context to structured logs.
  toJSON() {
    return {
      ...super.toJSON(),
      userId: this.userId,
      service: "UserService",
    };
  }
}

// 2. Define specific, re-usable error classes for different failure cases.

/**
 * Thrown when a user cannot be found in the system.
 */
class UserNotFoundError extends UserServiceError {
  constructor(userId: string) {
    // Technical message with specific details.
    super(`User with ID '${userId}' not found.`, userId);
  }
}

/**
 * Thrown when user input fails validation.
 */
class UserValidationError extends UserServiceError {
  constructor(
    public readonly field: string,
    public readonly reason: string,
    userId?: string,
  ) {
    // Technical message for developers and logs.
    super(`Validation failed for field '${field}': ${reason}`, userId);
  }

  // Add the specific fields to the JSON output for better structured logging.
  toJSON() {
    return {
      ...super.toJSON(),
      field: this.field,
      reason: this.reason,
    };
  }
}

/**
 * Thrown when attempting to create a user that already exists.
 * This error also demonstrates how to wrap a `cause` from a lower-level system.
 */
class DuplicateUserError extends UserServiceError {
  constructor(email: string, cause?: unknown) {
    // Technical message for logs.
    super(`A user with the email '${email}' already exists.`, undefined, cause);
  }
}

// 3. Simulate application logic that can throw these domain errors.

function findAndRegisterUser(data: {
  id: string;
  email: string;
  name: string;
}) {
  // Simulate finding a user
  if (data.id === "missing-id") {
    throw new UserNotFoundError(data.id);
  }

  if (!data.name) {
    throw new UserValidationError("name", "Name cannot be empty", data.id);
  }

  if (!data.email.includes("@")) {
    throw new UserValidationError("email", "Invalid email format", data.id);
  }

  // Simulate a database check that finds a duplicate user.
  if (data.email === "existing@example.com") {
    // This could be a real error from a database driver.
    const dbError = new Error("DB_UNIQUE_CONSTRAINT_VIOLATION on users.email");
    throw new DuplicateUserError(data.email, dbError);
  }

  return { success: true, userId: data.id };
}

// 4. Implement a handler to demonstrate type-safe error catching.

function handleUserRequest(userData: {
  id: string;
  email: string;
  name: string;
}) {
  console.log(
    `\n--- Attempting to process user with email: ${userData.email} ---`,
  );
  try {
    const result = findAndRegisterUser(userData);
    console.log("✅ Request successful:", result);
  } catch (error) {
    console.error("🔴 Request failed!");

    // Use `instanceof` to perform type-safe error handling.
    // Check for the most specific error types first.
    if (error instanceof DuplicateUserError) {
      console.log("Caught Specific Error: DuplicateUserError");
      console.log(`  -> Message: "${error.message}"`);
    } else if (error instanceof UserValidationError) {
      console.log("Caught Specific Error: UserValidationError");
      // `error` is now typed as UserValidationError.
      // We can safely access its specific properties like `field`.
      console.log(`  -> Validation failed on field: ${error.field}`);
      console.log(`  -> Message: "${error.message}"`);
    } else if (error instanceof UserNotFoundError) {
      console.log("Caught Specific Error: UserNotFoundError");
      // `error` is typed as UserNotFoundError here.
      console.log(`  -> Message: "${error.message}"`);
    } else if (error instanceof UserServiceError) {
      // This acts as a catch-all for any other user service errors.
      console.log("Caught Generic Error: UserServiceError");
      console.log(`  -> Message: "${error.message}"`);
    } else {
      // Handle unexpected, non-domain errors.
      console.log("Caught Unknown Error");
      console.error("  -> An unexpected error occurred:", error);
    }

    // For all caught domain errors, we can log the rich, structured JSON.
    if (error instanceof BaseError) {
      console.log("--- Structured Log for Debugging ---");
      console.log(JSON.stringify(error, null, 2));
    }
  }
}

// 5. Run different scenarios to see the error handling in action.

function main() {
  console.log("Domain Errors Example\n");

  // Scenario 1: Validation error (missing name)
  handleUserRequest({ id: "user-1", email: "new@example.com", name: "" });

  // Scenario 2: Duplicate user error (with a cause)
  handleUserRequest({
    id: "user-2",
    email: "existing@example.com",
    name: "John Smith",
  });

  // Scenario 3: User not found
  handleUserRequest({
    id: "missing-id",
    email: "any@email.com",
    name: "Nobody",
  });

  // Scenario 4: Successful request
  handleUserRequest({
    id: "user-4",
    email: "success@example.com",
    name: "Alex Ray",
  });
}

main();
