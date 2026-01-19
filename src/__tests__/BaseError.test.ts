import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BaseError } from "../index.js";

// Add the same local interface here for tests
interface V8ErrorConstructor {
  stackTraceLimit?: number;
}
const V8Error = Error as V8ErrorConstructor;

// Ensure consistent behavior in tests
beforeEach(() => {
  // Reset any mocks
  vi.restoreAllMocks();

  // Ensure stack traces are consistent in tests
  vi.spyOn(Error, "captureStackTrace");
});

// Test error class that extends BaseError
class TestError extends BaseError<"TestError"> {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }

  toJSON() {
    // Call parent toJSON to include user messages, then add custom logic
    const baseJson = super.toJSON();
    return {
      ...baseJson,
      // Override cause formatting for test consistency
      cause: (() => {
        const causeValue = (this as unknown as Record<string, unknown>).cause;
        return causeValue instanceof Error ? causeValue.toString() : causeValue;
      })(),
    };
  }
}

// Test error class using automatic name inference
class AutoNamedError extends BaseError<"AutoNamedError"> {
  constructor(message: string, cause?: unknown) {
    super(message, cause); // Automatic name inference
  }
}

// Another test error class for automatic name inference
class ValidationError extends BaseError<"ValidationError"> {
  constructor(field: string, message: string) {
    super(`${field}: ${message}`); // Automatic name inference without cause
  }
}

describe("BaseError", () => {
  // Mock Date for consistent timestamps in tests
  const mockDate = new Date("2025-01-01T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create an error with the correct name and message", () => {
    const error = new TestError("Something went wrong");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BaseError);
    expect(error.name).toBe("TestError");
    expect(error.message).toBe("Something went wrong");
  });

  it("should include timestamps", () => {
    const error = new TestError("Test");

    expect(error.timestamp).toBe(mockDate.getTime());
    expect(error.timestampIso).toBe(mockDate.toISOString());
  });

  it("should include a stack trace", () => {
    const error = new TestError("Test");

    // Just verify that a stack trace exists and is a string
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe("string");
  });

  it("should handle error causes", () => {
    const cause = new Error("Root cause");
    const error = new TestError("Wrapper error", cause);

    // Access the cause property which is not in the standard Error type
    expect((error as unknown as Record<string, unknown>).cause).toBe(cause);
    expect(error.toString()).toContain("Caused by: Error: Root cause");
  });

  it("should serialize to JSON correctly", () => {
    const cause = new Error("Root cause");
    const error = new TestError("Test error", cause);

    const json = error.toJSON();

    // Check the basic structure of the JSON output
    expect(json).toMatchObject({
      name: "TestError",
      message: "Test error",
      timestamp: mockDate.getTime(),
      timestampIso: mockDate.toISOString(),
      cause: "Error: Root cause",
    });

    // Verify stack is a string if it exists
    if ("stack" in json) {
      expect(typeof json.stack).toBe("string");
    }
  });

  it("should handle undefined cause", () => {
    const error = new TestError("Test");

    // Access the cause property which is not in the standard Error type
    expect((error as unknown as Record<string, unknown>).cause).toBeUndefined();
    expect(error.toString()).not.toContain("Caused by");
  });

  it("should maintain prototype chain", () => {
    const error = new TestError("Test");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).toBeInstanceOf(TestError);
  });

  describe("Automatic Name Inference (v2.0+)", () => {
    it("should automatically infer error name from class name", () => {
      const error = new AutoNamedError("Something went wrong");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BaseError);
      expect(error).toBeInstanceOf(AutoNamedError);
      expect(error.name).toBe("AutoNamedError");
      expect(error.message).toBe("Something went wrong");
    });

    it("should automatically infer error name with cause", () => {
      const cause = new Error("Root cause");
      const error = new AutoNamedError("Wrapper error", cause);

      expect(error.name).toBe("AutoNamedError");
      expect(error.message).toBe("Wrapper error");
      expect((error as unknown as Record<string, unknown>).cause).toBe(cause);
      expect(error.toString()).toContain("Caused by: Error: Root cause");
    });

    it("should work with different error class names", () => {
      const error = new ValidationError("email", "must be a valid email");

      expect(error.name).toBe("ValidationError");
      expect(error.message).toBe("email: must be a valid email");
      expect(error).toBeInstanceOf(ValidationError);
    });

    it("should include timestamps with automatic name inference", () => {
      const error = new AutoNamedError("Test");

      expect(error.timestamp).toBe(mockDate.getTime());
      expect(error.timestampIso).toBe(mockDate.toISOString());
    });

    it("should include stack trace with automatic name inference", () => {
      const error = new AutoNamedError("Test");

      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");
      // Just verify that a stack trace exists (content varies by environment)
      expect(error.stack!.length).toBeGreaterThan(0);
    });

    it("should serialize to JSON correctly with automatic name", () => {
      const cause = new Error("Root cause");
      const error = new AutoNamedError("Test error", cause);

      const json = error.toJSON();

      expect(json).toMatchObject({
        name: "AutoNamedError",
        message: "Test error",
        timestamp: mockDate.getTime(),
        timestampIso: mockDate.toISOString(),
        cause: {
          name: "Error",
          message: "Root cause",
          stack: expect.any(String),
          cause: undefined,
        },
      });

      if ("stack" in json) {
        expect(typeof json.stack).toBe("string");
      }
    });

    it("should handle undefined cause with automatic name inference", () => {
      const error = new AutoNamedError("Test");

      expect(
        (error as unknown as Record<string, unknown>).cause,
      ).toBeUndefined();
      expect(error.toString()).not.toContain("Caused by");
      expect(error.toString()).toBe("[AutoNamedError] Test");
    });
  });

  describe("User Message Functionality", () => {
    it("should set and retrieve default user message", () => {
      const error = new TestError("Technical error message");

      error.withUserMessage("Something went wrong. Please try again.");

      expect(error.getUserMessage()).toBe(
        "Something went wrong. Please try again.",
      );
    });

    it("should return undefined when no user message is set", () => {
      const error = new TestError("Technical error message");

      expect(error.getUserMessage()).toBeUndefined();
    });

    it("should allow method chaining with withUserMessage", () => {
      const error = new TestError("Technical error message");

      const result = error.withUserMessage("User friendly message");

      expect(result).toBe(error); // Should return the same instance for chaining
      expect(error.getUserMessage()).toBe("User friendly message");
    });

    it("should add and retrieve localized messages", () => {
      const error = new TestError("Technical error message");

      error.addLocalizedMessage("en", "Something went wrong.");
      error.addLocalizedMessage("es", "Algo salió mal.");
      error.addLocalizedMessage("de", "Etwas ist schief gelaufen.");

      expect(error.getUserMessage({ preferredLang: "en" })).toBe(
        "Something went wrong.",
      );
      expect(error.getUserMessage({ preferredLang: "es" })).toBe(
        "Algo salió mal.",
      );
      expect(error.getUserMessage({ preferredLang: "de" })).toBe(
        "Etwas ist schief gelaufen.",
      );
    });

    it("should allow method chaining with addLocalizedMessage", () => {
      const error = new TestError("Technical error message");

      const result = error
        .addLocalizedMessage("en", "English message")
        .addLocalizedMessage("es", "Spanish message");

      expect(result).toBe(error); // Should return the same instance for chaining
      expect(error.getUserMessage({ preferredLang: "en" })).toBe(
        "English message",
      );
      expect(error.getUserMessage({ preferredLang: "es" })).toBe(
        "Spanish message",
      );
    });

    it("should fall back to fallback language when preferred language is not available", () => {
      const error = new TestError("Technical error message");

      error.addLocalizedMessage("en", "English message");
      error.addLocalizedMessage("es", "Spanish message");

      // Request French (not available), fallback to English
      expect(
        error.getUserMessage({
          preferredLang: "fr",
          fallbackLang: "en",
        }),
      ).toBe("English message");
    });

    it("should fall back to default user message when neither preferred nor fallback language is available", () => {
      const error = new TestError("Technical error message");

      error.withUserMessage("Default user message");
      error.addLocalizedMessage("es", "Spanish message");

      // Request French (not available), fallback to German (not available), use default
      expect(
        error.getUserMessage({
          preferredLang: "fr",
          fallbackLang: "de",
        }),
      ).toBe("Default user message");
    });

    it("should return undefined when no messages are available", () => {
      const error = new TestError("Technical error message");

      expect(
        error.getUserMessage({
          preferredLang: "fr",
          fallbackLang: "de",
        }),
      ).toBeUndefined();
    });

    it("should work with automatic name inference", () => {
      const error = new AutoNamedError("Technical error message");

      error
        .withUserMessage("User friendly message")
        .addLocalizedMessage("es", "Mensaje en español");

      expect(error.getUserMessage()).toBe("User friendly message");
      expect(error.getUserMessage({ preferredLang: "es" })).toBe(
        "Mensaje en español",
      );
    });

    it("should include user messages in JSON serialization", () => {
      const error = new TestError("Technical error message");

      error
        .withUserMessage("Default user message")
        .addLocalizedMessage("en", "English message")
        .addLocalizedMessage("es", "Spanish message");

      const json = error.toJSON();

      expect(json).toHaveProperty("userMessage", "Default user message");
      expect(json).toHaveProperty("localizedMessages", {
        en: "English message",
        es: "Spanish message",
      });
    });

    it("should not include user messages in JSON when none are set", () => {
      const error = new TestError("Technical error message");

      const json = error.toJSON();

      expect(json).not.toHaveProperty("userMessage");
      expect(json).not.toHaveProperty("localizedMessages");
    });

    it("should handle empty localized messages object in JSON", () => {
      const error = new TestError("Technical error message");

      error.withUserMessage("Default message only");

      const json = error.toJSON();

      expect(json).toHaveProperty("userMessage", "Default message only");
      expect(json).not.toHaveProperty("localizedMessages"); // Empty object should not be included
    });

    it("should include empty default user message in JSON", () => {
      const error = new TestError("Technical error message");

      error.withUserMessage("");

      const json = error.toJSON();

      expect(json).toHaveProperty("userMessage", "");
    });

    it("should support complex language codes", () => {
      const error = new TestError("Technical error message");

      error
        .addLocalizedMessage("en-US", "American English message")
        .addLocalizedMessage("en-GB", "British English message")
        .addLocalizedMessage("fr-CA", "Canadian French message");

      expect(error.getUserMessage({ preferredLang: "en-US" })).toBe(
        "American English message",
      );
      expect(error.getUserMessage({ preferredLang: "en-GB" })).toBe(
        "British English message",
      );
      expect(error.getUserMessage({ preferredLang: "fr-CA" })).toBe(
        "Canadian French message",
      );
    });

    it("should preserve message priority order: preferred -> fallback -> default", () => {
      const error = new TestError("Technical error message");

      error
        .withUserMessage("Default message")
        .addLocalizedMessage("en", "English message")
        .addLocalizedMessage("es", "Spanish message")
        .addLocalizedMessage("fr", "French message");

      // Test all combinations
      expect(error.getUserMessage({ preferredLang: "fr" })).toBe(
        "French message",
      );
      expect(
        error.getUserMessage({ preferredLang: "de", fallbackLang: "en" }),
      ).toBe("English message");
      expect(
        error.getUserMessage({ preferredLang: "de", fallbackLang: "it" }),
      ).toBe("Default message");
      expect(error.getUserMessage()).toBe("Default message");
    });

    it("should prevent duplicate language codes", () => {
      const error = new TestError("Technical error message");

      error.addLocalizedMessage("en", "First English message");

      // Attempting to add the same language again should throw
      expect(() => {
        error.addLocalizedMessage("en", "Second English message");
      }).toThrow(
        "Localized message for language 'en' already exists. Use updateLocalizedMessage() to modify existing messages.",
      );
    });

    it("should allow updating existing language messages with updateLocalizedMessage", () => {
      const error = new TestError("Technical error message");

      error.addLocalizedMessage("en", "Original English message");

      // This should work without throwing
      error.updateLocalizedMessage("en", "Updated English message");

      expect(error.getUserMessage({ preferredLang: "en" })).toBe(
        "Updated English message",
      );
    });

    it("should allow updateLocalizedMessage for new languages", () => {
      const error = new TestError("Technical error message");

      // updateLocalizedMessage should work for new languages too
      error.updateLocalizedMessage("es", "Spanish message");

      expect(error.getUserMessage({ preferredLang: "es" })).toBe(
        "Spanish message",
      );
    });

    it("should allow method chaining with updateLocalizedMessage", () => {
      const error = new TestError("Technical error message");

      const result = error
        .addLocalizedMessage("en", "English message")
        .updateLocalizedMessage("en", "Updated English message")
        .updateLocalizedMessage("es", "Spanish message");

      expect(result).toBe(error); // Should return the same instance for chaining
      expect(error.getUserMessage({ preferredLang: "en" })).toBe(
        "Updated English message",
      );
      expect(error.getUserMessage({ preferredLang: "es" })).toBe(
        "Spanish message",
      );
    });
  });

  describe("Stack Trace Filtering", () => {
    it("should not include internal BaseError frames in stack trace", () => {
      function createError() {
        return new TestError("Test error message");
      }

      function callCreateError() {
        return createError();
      }

      const error = callCreateError();

      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");

      if (error.stack) {
        // Should not contain internal method names
        expect(error.stack).not.toContain("#captureStack");
        expect(error.stack).not.toContain("#filterInternalFrames");
        expect(error.stack).not.toContain("BaseError.constructor");

        // Should contain the proper error header
        expect(error.stack).toContain("TestError: Test error message");

        // Should contain user code frames
        expect(error.stack).toContain("createError");
        expect(error.stack).toContain("callCreateError");
      }
    });

    it("should handle stack trace gracefully when Error.captureStackTrace is not available", () => {
      // Temporarily disable Error.captureStackTrace to test fallback
      const originalCaptureStackTrace = Error.captureStackTrace;
      delete (Error as unknown as Record<string, unknown>).captureStackTrace;

      try {
        const error = new TestError("Fallback test");

        expect(error.stack).toBeDefined();
        expect(typeof error.stack).toBe("string");

        if (error.stack) {
          expect(error.stack).toContain("TestError: Fallback test");
          expect(error.stack).not.toContain("#captureStack");
          expect(error.stack).not.toContain("#filterInternalFrames");
        }
      } finally {
        // Restore the original function
        if (originalCaptureStackTrace) {
          Error.captureStackTrace = originalCaptureStackTrace;
        }
      }
    });

    it("should handle automatic name inference errors with clean stack traces", () => {
      const error = new AutoNamedError("Auto named test");

      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");

      if (error.stack) {
        expect(error.stack).toContain("AutoNamedError: Auto named test");
        expect(error.stack).not.toContain("#captureStack");
        expect(error.stack).not.toContain("#filterInternalFrames");
      }
    });
  });

  describe("Enhanced Cause Handling", () => {
    it("should handle Error causes with preserved stack traces in JSON", () => {
      const rootCause = new Error("Database connection failed");
      const error = new AutoNamedError("Service unavailable", rootCause);

      const json = error.toJSON();

      expect(json.cause).toMatchObject({
        name: "Error",
        message: "Database connection failed",
        stack: expect.any(String),
        cause: undefined,
      });

      // Verify the stack trace is preserved
      expect((json.cause as Record<string, unknown>).stack).toContain(
        "Database connection failed",
      );
    });

    it("should handle nested Error causes recursively", () => {
      const rootCause = new Error("Network timeout");
      const middleCause = new AutoNamedError("Database error", rootCause);
      const topError = new AutoNamedError("Service error", middleCause);

      const json = topError.toJSON();

      // Check the nested structure
      expect(json.cause).toMatchObject({
        name: "AutoNamedError",
        message: "Database error",
        stack: expect.any(String),
        cause: {
          name: "Error",
          message: "Network timeout",
          stack: expect.any(String),
          cause: undefined,
        },
      });
    });

    it("should handle non-Error object causes", () => {
      const objectCause = {
        code: "ECONNREFUSED",
        port: 5432,
        host: "localhost",
        details: { retry: true, timeout: 5000 },
      };

      const error = new AutoNamedError("Connection failed", objectCause);
      const json = error.toJSON();

      expect(json.cause).toEqual(objectCause);
    });

    it("should handle primitive causes", () => {
      const stringCause = "Simple error message";
      const numberCause = 404;
      const booleanCause = false;

      const stringError = new AutoNamedError("String cause test", stringCause);
      const numberError = new AutoNamedError("Number cause test", numberCause);
      const booleanError = new AutoNamedError(
        "Boolean cause test",
        booleanCause,
      );

      expect(stringError.toJSON().cause).toBe(stringCause);
      expect(numberError.toJSON().cause).toBe(numberCause);
      expect(booleanError.toJSON().cause).toBe(booleanCause);
    });

    it("should handle circular reference causes gracefully", () => {
      const circularCause: Record<string, unknown> = { name: "CircularObject" };
      circularCause.self = circularCause; // Create circular reference

      const error = new AutoNamedError("Circular cause test", circularCause);
      const json = error.toJSON();

      // Should provide a useful representation for circular references
      expect(typeof json.cause).toBe("string");
      expect(json.cause).toBe("[Circular Object with keys: [name, self]]");
    });

    it("should handle null and undefined causes", () => {
      const nullError = new AutoNamedError("Null cause test", null);
      const undefinedError = new AutoNamedError(
        "Undefined cause test",
        undefined,
      );
      const noError = new AutoNamedError("No cause test");

      expect(nullError.toJSON().cause).toBeNull();
      expect(undefinedError.toJSON().cause).toBeUndefined();
      expect(noError.toJSON().cause).toBeUndefined();
    });

    it("should maintain cause property accessibility", () => {
      const cause = new Error("Original error");
      const error = new AutoNamedError("Wrapper error", cause);

      // Should be able to access cause property
      expect((error as unknown as Record<string, unknown>).cause).toBe(cause);
      expect(
        ((error as unknown as Record<string, unknown>).cause as Error).message,
      ).toBe("Original error");
    });

    it("should work with automatic name inference and causes", () => {
      const cause = { code: "VALIDATION_ERROR", field: "email" };
      const error = new AutoNamedError("Validation failed", cause);

      expect(error.name).toBe("AutoNamedError");
      expect((error as unknown as Record<string, unknown>).cause).toEqual(
        cause,
      );
      expect(error.toJSON().cause).toEqual(cause);
    });

    it("should detect native cause support correctly", () => {
      // This test verifies our runtime detection works
      // We can't easily test both paths in the same environment,
      // but we can verify the detection runs without errors
      const error = new AutoNamedError("Detection test", "test cause");

      expect(error.toJSON()).toHaveProperty("cause");
      expect((error as unknown as Record<string, unknown>).cause).toBe(
        "test cause",
      );
    });
  });

  describe("Nominal Typing", () => {
    // Two structurally identical error classes
    class UserNotFoundError extends BaseError<"UserNotFoundError"> {
      constructor(userId: string) {
        super(`User ${userId} not found`);
      }
    }

    class ProductNotFoundError extends BaseError<"ProductNotFoundError"> {
      constructor(productId: string) {
        super(`Product ${productId} not found`);
      }
    }

    it("should prevent assignment between structurally identical error types", () => {
      const userError = new UserNotFoundError("123");
      const productError = new ProductNotFoundError("456");

      // Runtime: Both errors work correctly with their own types
      expect(userError).toBeInstanceOf(UserNotFoundError);
      expect(productError).toBeInstanceOf(ProductNotFoundError);
      expect(userError.name).toBe("UserNotFoundError");
      expect(productError.name).toBe("ProductNotFoundError");

      // Compile-time: TypeScript should reject cross-assignments
      // @ts-expect-error - UserNotFoundError cannot be assigned to ProductNotFoundError (nominal typing)
      const shouldFail1: UserNotFoundError = productError;

      // @ts-expect-error - ProductNotFoundError cannot be assigned to UserNotFoundError (nominal typing)
      const shouldFail2: ProductNotFoundError = userError;

      // Verify variables exist at runtime (they will be assigned despite type errors in dev)
      expect(shouldFail1).toBeDefined();
      expect(shouldFail2).toBeDefined();
    });

    it("should allow correct type assignments", () => {
      const userError1 = new UserNotFoundError("123");
      const userError2 = new UserNotFoundError("456");

      // Same type assignments should work fine
      const assigned1: UserNotFoundError = userError1;
      const assigned2: UserNotFoundError = userError2;

      expect(assigned1).toBe(userError1);
      expect(assigned2).toBe(userError2);
    });

    it("should work with BaseError base type", () => {
      const userError = new UserNotFoundError("123");
      const productError = new ProductNotFoundError("456");

      // Both can be assigned to BaseError (base type)
      const base1: BaseError<"UserNotFoundError"> = userError;
      const base2: BaseError<"ProductNotFoundError"> = productError;

      expect(base1).toBe(userError);
      expect(base2).toBe(productError);
    });

    it("should verify runtime instanceof checks still work correctly", () => {
      const userError = new UserNotFoundError("123");
      const productError = new ProductNotFoundError("456");

      // Runtime instanceof should work correctly
      expect(userError).toBeInstanceOf(BaseError);
      expect(userError).toBeInstanceOf(UserNotFoundError);
      expect(userError).not.toBeInstanceOf(ProductNotFoundError);

      expect(productError).toBeInstanceOf(BaseError);
      expect(productError).toBeInstanceOf(ProductNotFoundError);
      expect(productError).not.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe("Edge Cases and Implementation Details", () => {
    it("should ensure cause property is non-enumerable", () => {
      const cause = new Error("Test cause");
      const error = new AutoNamedError("Test error", cause);

      // Cause should exist but not be enumerable
      expect((error as unknown as Record<string, unknown>).cause).toBe(cause);
      expect(Object.keys(error)).not.toContain("cause");

      // Should not appear in for...in loop
      const enumerableProps: string[] = [];
      for (const prop in error) {
        enumerableProps.push(prop);
      }
      expect(enumerableProps).not.toContain("cause");
    });

    it("should preserve original Error.stackTraceLimit after construction", () => {
      // Use the locally-typed V8Error object
      const originalLimit = V8Error.stackTraceLimit;

      // Set a custom limit
      V8Error.stackTraceLimit = 5;

      // Create error (this should not permanently change the limit)
      const error = new AutoNamedError("Stack limit test");

      // Verify the limit is restored
      expect(V8Error.stackTraceLimit).toBe(5);

      // Restore original for other tests
      V8Error.stackTraceLimit = originalLimit;

      expect(error.name).toBe("AutoNamedError");
    });

    it("should test both native and non-native cause support branches", () => {
      // Test the non-native branch by mocking the detection
      const originalVersions = process.versions;

      // Mock older Node.js version to force non-native path
      Object.defineProperty(process, "versions", {
        value: { ...originalVersions, node: "14.0.0" },
        configurable: true,
      });

      try {
        const error = new AutoNamedError("Non-native test", "test cause");

        expect((error as unknown as Record<string, unknown>).cause).toBe(
          "test cause",
        );
        expect(error.toJSON().cause).toBe("test cause");
      } finally {
        // Restore original process.versions
        Object.defineProperty(process, "versions", {
          value: originalVersions,
          configurable: true,
        });
      }
    });

    it("should test browser environment detection branch", () => {
      // Test browser environment detection by mocking process and window
      const originalProcess = global.process;
      const originalWindow = (global as unknown as Record<string, unknown>)
        .window;

      // Mock browser environment
      delete (global as unknown as Record<string, unknown>).process;
      (global as unknown as Record<string, unknown>).window = {};

      try {
        // This should use the browser detection branch
        const error = new AutoNamedError("Browser test", "browser cause");

        expect((error as unknown as Record<string, unknown>).cause).toBe(
          "browser cause",
        );
        expect(error.toJSON().cause).toBe("browser cause");
      } finally {
        // Restore original environment
        global.process = originalProcess;
        if (originalWindow !== undefined) {
          (global as unknown as Record<string, unknown>).window =
            originalWindow;
        } else {
          delete (global as unknown as Record<string, unknown>).window;
        }
      }
    });

    it("should maintain Map type for localized messages internally", () => {
      const error = new AutoNamedError("Map test");

      error
        .addLocalizedMessage("en", "English message")
        .addLocalizedMessage("es", "Spanish message");

      // Access the private field to verify it's still a Map
      const localizedMessages = (error as unknown as Record<string, unknown>)
        ._localizedMessages as Map<string, string>;

      expect(localizedMessages).toBeInstanceOf(Map);
      expect(localizedMessages.size).toBe(2);
      expect(localizedMessages.get("en")).toBe("English message");
      expect(localizedMessages.get("es")).toBe("Spanish message");

      // But toJSON should convert to plain object
      const json = error.toJSON();
      expect(json.localizedMessages).toEqual({
        en: "English message",
        es: "Spanish message",
      });
      expect(json.localizedMessages).not.toBeInstanceOf(Map);
    });

    it("should properly rewrite stack trace header", () => {
      const error = new AutoNamedError("Header test message");

      expect(error.stack).toBeDefined();

      if (error.stack) {
        const lines = error.stack.split("\n");
        const headerLine = lines[0];

        // First line should be exactly the expected format
        expect(headerLine).toBe("AutoNamedError: Header test message");

        // Should start with the correct error name, not generic "Error:"
        expect(headerLine.startsWith("AutoNamedError:")).toBe(true);
        expect(headerLine.startsWith("Error:")).toBe(false);
      }
    });

    it("should handle stack trace header rewriting with special characters", () => {
      const specialMessage = 'Test with: colons, [brackets], and "quotes"';
      const error = new AutoNamedError(specialMessage);

      if (error.stack) {
        const headerLine = error.stack.split("\n")[0];
        expect(headerLine).toBe(`AutoNamedError: ${specialMessage}`);
      }
    });

    it("should handle defineProperty failures gracefully", () => {
      // Mock Object.defineProperty to fail only for cause property
      const originalDefineProperty = Object.defineProperty;

      Object.defineProperty = vi
        .fn()
        .mockImplementation(
          (obj: object, prop: PropertyKey, descriptor: PropertyDescriptor) => {
            // Only fail when setting the 'cause' property
            if (prop === "cause") {
              throw new Error("defineProperty failed for cause");
            }
            // Allow other properties to succeed normally
            return originalDefineProperty.call(Object, obj, prop, descriptor);
          },
        );

      try {
        const error = new AutoNamedError("DefineProperty test", "test cause");

        // Should still have cause via fallback mechanism (direct assignment)
        expect((error as unknown as Record<string, unknown>).cause).toBe(
          "test cause",
        );
        expect(error.toJSON().cause).toBe("test cause");
      } finally {
        // Restore original defineProperty
        Object.defineProperty = originalDefineProperty;
      }
    });

    it("should handle missing stack gracefully", () => {
      // Mock Error.captureStackTrace to not set stack
      const originalCaptureStackTrace = Error.captureStackTrace;

      Error.captureStackTrace = vi.fn().mockImplementation(() => {
        // Don't set stack property
      });

      try {
        const error = new AutoNamedError("No stack test");

        // Should handle missing stack gracefully
        expect(error.name).toBe("AutoNamedError");
        expect(error.message).toBe("No stack test");
        // Stack might be undefined, but error should still be functional
      } finally {
        // Restore original function
        if (originalCaptureStackTrace) {
          Error.captureStackTrace = originalCaptureStackTrace;
        }
      }
    });
  });
});
