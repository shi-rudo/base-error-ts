/**
 * Structured Errors Example
 *
 * This example demonstrates how to use StructuredError for comprehensive
 * error handling with codes, categories, retryability, and structured details.
 */
import { StructuredError } from "../src/index.js";

// Define error types for an e-commerce application
type OrderErrorCode =
  | "ITEM_OUT_OF_STOCK"
  | "PAYMENT_FAILED"
  | "PAYMENT_GATEWAY_TIMEOUT"
  | "INVALID_SHIPPING_ADDRESS"
  | "ORDER_NOT_FOUND";

type OrderErrorCategory = "INVENTORY" | "PAYMENT" | "VALIDATION" | "NOT_FOUND";

interface OrderErrorDetails {
  orderId?: string;
  itemId?: string;
  paymentMethod?: string;
  address?: Record<string, string>;
  [key: string]: unknown;
}

// Domain-specific error class
class OrderError extends StructuredError<
  OrderErrorCode,
  OrderErrorCategory,
  OrderErrorDetails
> {
  constructor(
    code: OrderErrorCode,
    message: string,
    details?: OrderErrorDetails,
    cause?: unknown,
  ) {
    const category =
      code === "ITEM_OUT_OF_STOCK"
        ? "INVENTORY"
        : code.startsWith("PAYMENT")
          ? "PAYMENT"
          : code === "INVALID_SHIPPING_ADDRESS"
            ? "VALIDATION"
            : "NOT_FOUND";

    const retryable = code === "PAYMENT_GATEWAY_TIMEOUT";

    super({ code, category, retryable, message, details, cause });
  }
}

// Simulate order processing
function processOrder(orderId: string) {
  // Simulate various error scenarios
  if (orderId === "out-of-stock") {
    throw new OrderError(
      "ITEM_OUT_OF_STOCK",
      "Product iPhone 15 Pro is currently out of stock",
      { orderId, itemId: "iphone-15-pro", stockLevel: 0 },
    )
      .withUserMessage("Sorry, this item is currently out of stock.")
      .addLocalizedMessage("es", "Lo sentimos, este artículo está agotado.");
  }

  if (orderId === "payment-failed") {
    throw new OrderError(
      "PAYMENT_FAILED",
      "Payment was declined by the card issuer",
      { orderId, paymentMethod: "visa-1234" },
    ).withUserMessage(
      "Your payment was declined. Please try another payment method.",
    );
  }

  if (orderId === "gateway-timeout") {
    const gatewayError = new Error("Connection timeout after 30s");
    throw new OrderError(
      "PAYMENT_GATEWAY_TIMEOUT",
      "Payment gateway did not respond in time",
      { orderId, paymentMethod: "stripe", timeout: 30000 },
      gatewayError,
    ).withUserMessage(
      "We're experiencing technical difficulties. Please try again.",
    );
  }

  if (orderId === "invalid-address") {
    throw new OrderError(
      "INVALID_SHIPPING_ADDRESS",
      "Shipping address is missing required field: postal code",
      { orderId, address: { street: "123 Main St", city: "Boston" } },
    ).withUserMessage("Please provide a complete shipping address.");
  }

  return { orderId, status: "success" };
}

// Error handler with retry logic
async function handleOrderWithRetry(
  orderId: string,
  maxRetries: number = 3,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return processOrder(orderId);
    } catch (error) {
      lastError = error;

      if (error instanceof OrderError) {
        console.log(`\nAttempt ${attempt} failed:`);
        console.log(`  Code: ${error.code}`);
        console.log(`  Category: ${error.category}`);
        console.log(`  Retryable: ${error.retryable}`);
        console.log(`  Message: ${error.message}`);
        console.log(`  User Message: ${error.getUserMessage()}`);

        // Only retry if error is retryable and we have attempts left
        if (error.retryable && attempt < maxRetries) {
          console.log(`  → Retrying in ${attempt} second(s)...`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          continue;
        }
      }

      // Not retryable or last attempt
      throw error;
    }
  }

  throw lastError;
}

// Main example
async function main() {
  console.log("Structured Errors Example\n");

  // Example 1: Out of stock error
  try {
    console.log("=== Example 1: Out of Stock ===");
    processOrder("out-of-stock");
  } catch (error) {
    if (error instanceof OrderError) {
      console.log(`Error Code: ${error.code}`);
      console.log(`Category: ${error.category}`);
      console.log(`Retryable: ${error.retryable}`);
      console.log(`Details:`, error.details);
      console.log(`User Message: ${error.getUserMessage()}`);
      console.log(
        `User Message (ES): ${error.getUserMessage({ preferredLang: "es" })}`,
      );
    }
  }

  console.log("\n");

  // Example 2: Payment failed (non-retryable)
  try {
    console.log("=== Example 2: Payment Failed (Non-Retryable) ===");
    await handleOrderWithRetry("payment-failed", 3);
  } catch (error) {
    if (error instanceof OrderError) {
      console.log("\nFinal error after attempts:");
      console.log(`  Code: ${error.code}`);
      console.log(`  Will not retry: retryable = ${error.retryable}`);
    }
  }

  console.log("\n");

  // Example 3: Gateway timeout (retryable)
  try {
    console.log("=== Example 3: Payment Gateway Timeout (Retryable) ===");
    await handleOrderWithRetry("gateway-timeout", 3);
  } catch (error) {
    if (error instanceof OrderError) {
      console.log("\nFinal error after 3 attempts:");
      console.log(`  Code: ${error.code}`);
      console.log(`  Retryable: ${error.retryable}`);
      console.log(
        `  Cause:`,
        (error as unknown as Record<string, unknown>).cause,
      );
    }
  }

  console.log("\n");

  // Example 4: JSON serialization
  console.log("=== Example 4: JSON Serialization ===");
  try {
    processOrder("invalid-address");
  } catch (error) {
    if (error instanceof OrderError) {
      console.log("JSON output:");
      console.log(JSON.stringify(error, null, 2));
    }
  }

  console.log("\n");

  // Example 5: Direct StructuredError usage
  console.log("=== Example 5: Direct Usage ===");
  const simpleError = new StructuredError({
    code: "VALIDATION_FAILED",
    category: "CLIENT_ERROR",
    retryable: false,
    message: "Email format is invalid",
    details: { field: "email", value: "not-an-email" },
  });

  console.log(`Code: ${simpleError.code}`);
  console.log(`Category: ${simpleError.category}`);
  console.log(`Retryable: ${simpleError.retryable}`);
  console.log(`Details:`, simpleError.details);
}

// Run the example
main().catch(console.error);
