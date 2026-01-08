import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseError } from "../BaseError.js";
import { StructuredError } from "../StructuredError.js";

describe("StructuredError", () => {
  const mockDate = new Date("2025-01-01T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Basic Functionality", () => {
    it("should create a StructuredError with all required fields", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
        message: "Test error message",
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BaseError);
      expect(error).toBeInstanceOf(StructuredError);
      expect(error.name).toBe("TEST_ERROR");
      expect(error.message).toBe("Test error message");
      expect(error.code).toBe("TEST_ERROR");
      expect(error.category).toBe("TEST");
      expect(error.retryable).toBe(false);
      expect(error.details).toBeUndefined();
    });

    it("should create a StructuredError with details", () => {
      const details = { userId: "123", field: "email" };
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "CLIENT_ERROR",
        retryable: false,
        message: "Validation failed",
        details,
      });

      expect(error.details).toEqual(details);
      expect(error.details?.userId).toBe("123");
      expect(error.details?.field).toBe("email");
    });

    it("should create a StructuredError with cause", () => {
      const cause = new Error("Root cause");
      const error = new StructuredError({
        code: "WRAPPER_ERROR",
        category: "SYSTEM",
        retryable: true,
        message: "Wrapper error",
        cause,
      });

      expect((error as unknown as Record<string, unknown>).cause).toBe(cause);
    });

    it("should include timestamps from BaseError", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
        message: "Test",
      });

      expect(error.timestamp).toBe(mockDate.getTime());
      expect(error.timestampIso).toBe(mockDate.toISOString());
    });

    it("should have _tag discriminant", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
        message: "Test",
      });

      expect(error._tag).toBe("StructuredError");
    });
  });

  describe("Type Safety", () => {
    it("should enforce code type", () => {
      type TestCode = "ERROR_A" | "ERROR_B";
      type TestCategory = "CAT_1" | "CAT_2";

      const error = new StructuredError<TestCode, TestCategory>({
        code: "ERROR_A",
        category: "CAT_1",
        retryable: false,
        message: "Test",
      });

      expect(error.code).toBe("ERROR_A");

      // TypeScript compile-time check
      const code: TestCode = error.code;
      expect(code).toBe("ERROR_A");
    });

    it("should enforce details type", () => {
      interface TestDetails {
        userId: string;
        timestamp: number;
      }

      const error = new StructuredError<string, string, TestDetails>({
        code: "TEST",
        category: "TEST",
        retryable: false,
        message: "Test",
        details: { userId: "123", timestamp: 1000 },
      });

      expect(error.details?.userId).toBe("123");
      expect(error.details?.timestamp).toBe(1000);
    });
  });

  describe("JSON Serialization", () => {
    it("should serialize to JSON with all fields", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: true,
        message: "Test message",
        details: { key: "value" },
      });

      const json = error.toJSON();

      expect(json).toMatchObject({
        name: "TEST_ERROR",
        message: "Test message",
        code: "TEST_ERROR",
        category: "TEST",
        retryable: true,
        details: { key: "value" },
        timestamp: mockDate.getTime(),
        timestampIso: mockDate.toISOString(),
      });
    });

    it("should not include details if undefined", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
        message: "Test",
      });

      const json = error.toJSON();

      expect(json).not.toHaveProperty("details");
    });

    it("should include cause in JSON", () => {
      const cause = new Error("Root cause");
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
        message: "Test",
        cause,
      });

      const json = error.toJSON();

      expect(json.cause).toBeDefined();
    });
  });

  describe("User Messages Integration", () => {
    it("should work with withUserMessage", () => {
      const error = new StructuredError({
        code: "USER_ERROR",
        category: "CLIENT",
        retryable: false,
        message: "Technical error message",
      });

      error.withUserMessage("User-friendly message");

      expect(error.getUserMessage()).toBe("User-friendly message");
    });

    it("should work with localized messages", () => {
      const error = new StructuredError({
        code: "USER_ERROR",
        category: "CLIENT",
        retryable: false,
        message: "Technical error",
      });

      error
        .addLocalizedMessage("en", "English message")
        .addLocalizedMessage("es", "Spanish message");

      expect(error.getUserMessage({ preferredLang: "en" })).toBe(
        "English message",
      );
      expect(error.getUserMessage({ preferredLang: "es" })).toBe(
        "Spanish message",
      );
    });

    it("should include user messages in JSON", () => {
      const error = new StructuredError({
        code: "USER_ERROR",
        category: "CLIENT",
        retryable: false,
        message: "Technical error",
      });

      error
        .withUserMessage("Default message")
        .addLocalizedMessage("en", "English message");

      const json = error.toJSON();

      expect(json.userMessage).toBe("Default message");
      expect(json.localizedMessages).toEqual({ en: "English message" });
    });
  });

  describe("Error Hierarchies", () => {
    it("should allow subclassing StructuredError", () => {
      class DatabaseError extends StructuredError<"DB_ERROR", "DATABASE"> {
        public readonly _tag = "DatabaseError" as const;

        constructor(message: string, cause?: unknown) {
          super({
            code: "DB_ERROR",
            category: "DATABASE",
            retryable: true,
            message,
            cause,
          });
        }
      }

      const error = new DatabaseError("Connection failed");

      expect(error).toBeInstanceOf(StructuredError);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.code).toBe("DB_ERROR");
      expect(error.category).toBe("DATABASE");
      expect(error.retryable).toBe(true);
      expect(error._tag).toBe("DatabaseError");
    });
  });

  describe("Integration with BaseError", () => {
    it("should maintain prototype chain", () => {
      const error = new StructuredError({
        code: "TEST",
        category: "TEST",
        retryable: false,
        message: "Test",
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BaseError);
      expect(error).toBeInstanceOf(StructuredError);
    });

    it("should include stack trace", () => {
      const error = new StructuredError({
        code: "TEST",
        category: "TEST",
        retryable: false,
        message: "Test",
      });

      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");
      // Stack trace may show "StructuredError" since that's the actual constructor name
      expect(error.stack).toContain("Test");
    });

    it("should handle toString correctly", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
        message: "Test message",
      });

      const str = error.toString();
      expect(str).toContain("TEST_ERROR");
      expect(str).toContain("Test message");
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle API error pattern", () => {
      type ApiErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMIT";
      type ApiCategory = "AUTH" | "RESOURCE" | "RATE_LIMIT";

      const error = new StructuredError<ApiErrorCode, ApiCategory>({
        code: "RATE_LIMIT",
        category: "RATE_LIMIT",
        retryable: true,
        message: "Too many requests",
        details: { retryAfter: 60, limit: 100, used: 100 },
      });

      expect(error.code).toBe("RATE_LIMIT");
      expect(error.retryable).toBe(true);
      expect(error.details?.retryAfter).toBe(60);
    });

    it("should handle validation error pattern", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "CLIENT_ERROR",
        retryable: false,
        message: "Email is invalid",
        details: { field: "email", constraint: "format" },
      });

      error.withUserMessage("Please enter a valid email address");

      const json = error.toJSON();
      expect(json.code).toBe("VALIDATION_FAILED");
      expect(json.retryable).toBe(false);
      expect(json.userMessage).toBe("Please enter a valid email address");
    });

    it("should handle infrastructure error pattern", () => {
      const dbError = new Error("Connection timeout");
      const error = new StructuredError({
        code: "DATABASE_UNAVAILABLE",
        category: "INFRASTRUCTURE",
        retryable: true,
        message: "Failed to connect to database",
        details: { host: "localhost", port: 5432, timeout: 5000 },
        cause: dbError,
      });

      expect(error.retryable).toBe(true);
      expect((error as unknown as Record<string, unknown>).cause).toBe(
        dbError,
      );
    });
  });
});
