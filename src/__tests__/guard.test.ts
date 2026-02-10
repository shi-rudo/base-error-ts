import { describe, expect, it } from "vitest";

import {
  BaseError,
  StructuredError,
  guard,
  isBaseError,
  isStructuredError,
  isRetryable,
} from "../index.js";

// Test error class for invariant tests
class TestInvariantError extends BaseError<"TestInvariantError"> {
  constructor(message: string) {
    super(message);
  }
}

class ValidationError extends BaseError<"ValidationError"> {
  constructor(field: string) {
    super(`Field '${field}' is required`);
  }
}

describe("invariant", () => {
  it("should not throw when condition is true", () => {
    const error = new TestInvariantError("This should not be thrown");

    expect(() => {
      guard(true, error);
    }).not.toThrow();
  });

  it("should throw the provided error when condition is false", () => {
    const error = new TestInvariantError("Condition was false");

    expect(() => {
      guard(false, error);
    }).toThrow(error);
  });

  it("should throw the exact error instance provided", () => {
    const error = new TestInvariantError("Custom error message");

    try {
      guard(false, error);
      // Should never reach this line
      expect.fail("Expected invariant to throw");
    } catch (thrownError) {
      expect(thrownError).toBe(error); // Same instance
      expect(thrownError).toBeInstanceOf(TestInvariantError);
      expect((thrownError as TestInvariantError).message).toBe(
        "Custom error message",
      );
    }
  });

  it("should work with different BaseError subclasses", () => {
    const validationError = new ValidationError("email");

    expect(() => {
      guard(false, validationError);
    }).toThrow(validationError);

    try {
      guard(false, validationError);
    } catch (thrownError) {
      expect(thrownError).toBeInstanceOf(ValidationError);
      expect((thrownError as ValidationError).message).toBe(
        "Field 'email' is required",
      );
      expect((thrownError as ValidationError).name).toBe("ValidationError");
    }
  });

  it("should provide TypeScript type narrowing when condition is true", () => {
    // This test verifies the TypeScript assertion signature works correctly
    let value: string | null = Math.random() > 0.5 ? "test" : null;
    const error = new TestInvariantError("Value must not be null");

    // Before invariant, TypeScript knows value could be null
    expect(typeof value).toBe(typeof value); // Just to use the variable

    // Set value to ensure the test is deterministic
    value = "test";

    // After invariant, TypeScript should know value is not null
    guard(value !== null, error);

    // At this point, TypeScript should know value is string, not string | null
    expect(value.length).toBe(4); // This wouldn't compile if TypeScript still thought value could be null
  });

  it("should work with truthy/falsy conditions", () => {
    const error = new TestInvariantError("Value is falsy");

    // Truthy values should not throw
    expect(() => guard(1, error)).not.toThrow();
    expect(() => guard("test", error)).not.toThrow();
    expect(() => guard([], error)).not.toThrow();
    expect(() => guard({}, error)).not.toThrow();

    // Falsy values should throw
    expect(() => guard(0, error)).toThrow(error);
    expect(() => guard("", error)).toThrow(error);
    expect(() => guard(null, error)).toThrow(error);
    expect(() => guard(undefined, error)).toThrow(error);
  });
});

describe("isBaseError", () => {
  it("returns true for BaseError instances", () => {
    const error = new TestInvariantError("test");
    expect(isBaseError(error)).toBe(true);
  });

  it("returns true for BaseError subclasses", () => {
    const error = new ValidationError("email");
    expect(isBaseError(error)).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isBaseError(new Error("test"))).toBe(false);
  });

  it("returns false for non-errors", () => {
    expect(isBaseError(null)).toBe(false);
    expect(isBaseError(undefined)).toBe(false);
    expect(isBaseError("string")).toBe(false);
    expect(isBaseError(42)).toBe(false);
    expect(isBaseError({ message: "fake" })).toBe(false);
  });
});

describe("isStructuredError", () => {
  it("returns true for StructuredError instances", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST_CAT",
      retryable: false,
      message: "test",
    });
    expect(isStructuredError(error)).toBe(true);
  });

  it("returns true for duck-typed objects with matching shape", () => {
    const duckTyped = { code: "ERR", category: "CAT", retryable: true };
    expect(isStructuredError(duckTyped)).toBe(true);
  });

  it("returns false for incomplete duck-typed objects", () => {
    expect(isStructuredError({ code: "ERR" })).toBe(false);
    expect(isStructuredError({ code: "ERR", category: "CAT" })).toBe(false);
    expect(isStructuredError({ code: 123, category: "CAT", retryable: true })).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isStructuredError(null)).toBe(false);
    expect(isStructuredError(undefined)).toBe(false);
    expect(isStructuredError("string")).toBe(false);
    expect(isStructuredError(42)).toBe(false);
  });
});

describe("isRetryable", () => {
  it("returns true when retryable is true", () => {
    const error = new StructuredError({
      code: "NET",
      category: "NETWORK",
      retryable: true,
      message: "timeout",
    });
    expect(isRetryable(error)).toBe(true);
  });

  it("returns false when retryable is false", () => {
    const error = new StructuredError({
      code: "AUTH",
      category: "AUTH",
      retryable: false,
      message: "unauthorized",
    });
    expect(isRetryable(error)).toBe(false);
  });

  it("returns true for plain objects with retryable: true", () => {
    expect(isRetryable({ retryable: true })).toBe(true);
  });

  it("returns false for plain objects with retryable: false", () => {
    expect(isRetryable({ retryable: false })).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable("retryable")).toBe(false);
    expect(isRetryable(42)).toBe(false);
  });
});
