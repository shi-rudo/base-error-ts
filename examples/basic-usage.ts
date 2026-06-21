/**
 * Basic Usage Example
 *
 * This example demonstrates how to create and use custom error classes
 * that extend BaseError.
 */
import { BaseError } from "../src/index.js";

// Define a custom error for validation failures
class ValidationError extends BaseError<"ValidationError"> {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

// Define a custom error for not found resources
class NotFoundError extends BaseError<"NotFoundError"> {
  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} with id ${resourceId} was not found`);
  }
}

// Define a custom error with cause
class DatabaseError extends BaseError<"DatabaseError"> {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

// Example usage
function main() {
  try {
    // Simulate some validation error
    validateUser({ name: "", email: "invalid-email" });
  } catch (error) {
    console.log("Caught error:");
    console.log(error.toString());
    console.log("\nJSON representation:");
    console.log(JSON.stringify(error, null, 2));
  }

  console.log("\n---\n");

  try {
    // Simulate a not found error
    findUser("user-123");
  } catch (error) {
    console.log("Caught error:");
    console.log(error.toString());
  }

  console.log("\n---\n");

  try {
    // Simulate a database error with cause
    saveUser({ name: "John", email: "john@example.com" });
  } catch (error) {
    console.log("Caught error with cause:");
    console.log(error.toString());
  }
}

// Example functions that throw custom errors
function validateUser(user: { name: string; email: string }) {
  if (!user.name) {
    throw new ValidationError("Name is required", "name");
  }

  if (!user.email.includes("@")) {
    throw new ValidationError("Invalid email format", "email");
  }
}

function findUser(userId: string) {
  // Simulate user not found
  throw new NotFoundError("User", userId);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function saveUser(user: { name: string; email: string }) {
  try {
    // Simulate a low-level error
    throw new Error("Connection refused: database is down");
  } catch (cause) {
    // Wrap the low-level error with our custom error
    throw new DatabaseError("Failed to save user to database", cause);
  }
}

// Run the example
main();
