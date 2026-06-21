/**
 * Error Handling Example
 *
 * This example demonstrates different error handling patterns
 * with BaseError and how to properly catch, process, and rethrow errors.
 */
import { BaseError } from "../src/index.js";

// Define a hierarchy of custom errors
class AppError extends BaseError<"AppError"> {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

class NetworkError extends AppError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    super(message, cause);
    // Override the name to match the class name
    Object.defineProperty(this, "name", { value: "NetworkError" });
  }
}

class TimeoutError extends NetworkError {
  constructor(resource: string, timeoutMs: number, cause?: unknown) {
    super(
      `Request to ${resource} timed out after ${timeoutMs}ms`,
      undefined,
      cause,
    );
    // Override the name to match the class name
    Object.defineProperty(this, "name", { value: "TimeoutError" });
  }
}

// Example of error handling patterns
async function main() {
  console.log("Error Handling Patterns Example\n");

  // Pattern 1: Basic try/catch
  try {
    await fetchData("https://api.example.com/data");
  } catch (error) {
    console.log("Pattern 1 - Basic try/catch:");
    console.log(error.toString());
    console.log();
  }

  // Pattern 2: Type checking with instanceof
  try {
    await processUserData("user-123");
  } catch (error) {
    console.log("Pattern 2 - Type checking with instanceof:");

    if (error instanceof NetworkError) {
      console.log(`Network error occurred with status: ${error.statusCode}`);
    } else if (error instanceof AppError) {
      console.log(`Application error: ${error.message}`);
    } else {
      console.log(`Unknown error: ${error}`);
    }
    console.log();
  }

  // Pattern 3: Error transformation and rethrowing
  try {
    await processPayment("order-456", 99.99);
  } catch (error) {
    console.log("Pattern 3 - Error transformation and rethrowing:");
    console.log(error.toString());
    console.log();
  }

  // Pattern 4: Async error handling with Promise.catch
  console.log("Pattern 4 - Async error handling with Promise.catch:");
  await fetchUserProfile("user-789").catch((error) => {
    if (error instanceof TimeoutError) {
      console.log(`Request timed out: ${error.message}`);
    } else {
      console.log(`Error fetching profile: ${error.message}`);
    }
  });
}

// Example functions that throw errors
async function fetchData(url: string): Promise<unknown> {
  // Simulate network error
  throw new NetworkError(`Failed to fetch data from ${url}`, 500);
}

async function processUserData(userId: string): Promise<void> {
  // Simulate timeout error
  throw new TimeoutError(`/users/${userId}`, 5000);
}

async function processPayment(orderId: string, amount: number): Promise<void> {
  try {
    // Simulate a third-party error
    throw new Error("Payment gateway unavailable");
  } catch (cause) {
    // Transform the error and rethrow
    throw new AppError(
      `Failed to process payment for order ${orderId} (${amount})`,
      cause,
    );
  }
}

async function fetchUserProfile(userId: string): Promise<unknown> {
  // Simulate timeout error
  throw new TimeoutError(`/profiles/${userId}`, 3000);
}

// Run the example
main().catch((error) => {
  console.error("Unhandled error in main:", error);
});
