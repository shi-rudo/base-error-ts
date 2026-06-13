import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseError, StructuredError } from "../index.js";

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

    it("should use the code consistently for the name and stack header", () => {
      const error = new StructuredError({
        code: "PAYMENT_DECLINED",
        category: "BUSINESS_RULE",
        retryable: false,
        message: "Payment was declined by the provider",
      });

      expect(error.name).toBe("PAYMENT_DECLINED");
      expect(error.stack).toBeDefined();
      expect(error.stack?.split("\n")[0]).toBe(
        "PAYMENT_DECLINED: Payment was declined by the provider",
      );
      expect(error.stack?.split("\n")[0]).not.toContain("StructuredError");
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
      type TestDetails = {
        userId: string;
        timestamp: number;
        [key: string]: unknown;
      };

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

    it("should expose structured fields through toLogObject", () => {
      const error = new StructuredError({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: true,
        message: "Test message",
        details: { key: "value" },
      });

      const logObject = error.toLogObject();

      expect(logObject).toMatchObject({
        name: "TEST_ERROR",
        message: "Test message",
        code: "TEST_ERROR",
        category: "TEST",
        retryable: true,
        details: { key: "value" },
      });
      expect(error.toJSON()).toEqual(logObject);
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

    it("should preserve StructuredError fields when serializing cause", () => {
      const innerError = new StructuredError({
        code: "INNER_ERROR",
        category: "INNER_CAT",
        retryable: true,
        message: "Inner error message",
        details: { innerKey: "innerValue" },
      });

      const outerError = new StructuredError({
        code: "OUTER_ERROR",
        category: "OUTER_CAT",
        retryable: false,
        message: "Outer error message",
        cause: innerError,
      });

      const json = outerError.toJSON();
      const causeSerialized = json.cause as Record<string, unknown>;

      expect(causeSerialized).toBeDefined();
      expect(causeSerialized.name).toBe("INNER_ERROR");
      expect(causeSerialized.message).toBe("Inner error message");
      expect(causeSerialized.code).toBe("INNER_ERROR");
      expect(causeSerialized.category).toBe("INNER_CAT");
      expect(causeSerialized.retryable).toBe(true);
      expect(causeSerialized.details).toEqual({ innerKey: "innerValue" });
    });

    it("should preserve StructuredError fields in deeply nested causes", () => {
      const level3 = new StructuredError({
        code: "LEVEL_3",
        category: "CAT_3",
        retryable: false,
        message: "Level 3",
        details: { level: 3 },
      });

      const level2 = new StructuredError({
        code: "LEVEL_2",
        category: "CAT_2",
        retryable: true,
        message: "Level 2",
        cause: level3,
      });

      const level1 = new StructuredError({
        code: "LEVEL_1",
        category: "CAT_1",
        retryable: false,
        message: "Level 1",
        cause: level2,
      });

      const json = level1.toJSON();
      const cause1 = json.cause as Record<string, unknown>;
      const cause2 = cause1.cause as Record<string, unknown>;

      // Level 2
      expect(cause1.code).toBe("LEVEL_2");
      expect(cause1.category).toBe("CAT_2");
      expect(cause1.retryable).toBe(true);

      // Level 3
      expect(cause2.code).toBe("LEVEL_3");
      expect(cause2.category).toBe("CAT_3");
      expect(cause2.retryable).toBe(false);
      expect(cause2.details).toEqual({ level: 3 });
    });
  });

  describe("Error Hierarchies", () => {
    it("should keep a stable _tag and use code as the discriminant for subclasses", () => {
      class DatabaseError extends StructuredError<"DB_ERROR", "DATABASE"> {
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
      // _tag is the stable family literal (minification-safe). Narrow on `code`
      // to distinguish individual structured errors, not on `_tag`.
      expect(error._tag).toBe("StructuredError");
      expect(error.code).toBe("DB_ERROR");
    });

    it("should let a subclass override _tag with its own stable literal", () => {
      class DatabaseError extends StructuredError<"DB_ERROR", "DATABASE"> {
        public override readonly _tag = "DatabaseError" as const;

        constructor(message: string) {
          super({
            code: "DB_ERROR",
            category: "DATABASE",
            retryable: true,
            message,
          });
        }
      }

      expect(new DatabaseError("boom")._tag).toBe("DatabaseError");
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
      expect(error.stack!.split("\n")[0]).toBe("TEST: Test");
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

      const json = error.toJSON();
      expect(json.code).toBe("VALIDATION_FAILED");
      expect(json.retryable).toBe(false);
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
      expect((error as unknown as Record<string, unknown>).cause).toBe(dbError);
    });
  });
});
