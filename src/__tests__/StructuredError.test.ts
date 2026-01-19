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
    it("should allow subclassing StructuredError with automatic _tag", () => {
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
      // _tag is now automatically inherited from constructor.name (like BaseError)
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
      expect((error as unknown as Record<string, unknown>).cause).toBe(dbError);
    });
  });

  describe("toProblemDetails", () => {
    it("should convert to minimal ProblemDetails", () => {
      const error = new StructuredError({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        message: "User with id 123 not found",
      });

      const problem = error.toProblemDetails();

      expect(problem.code).toBe("USER_NOT_FOUND");
      expect(problem.category).toBe("NOT_FOUND");
      expect(problem.retryable).toBe(false);
      expect(problem.detail).toBe("User with id 123 not found");
      expect(problem.status).toBeUndefined();
      expect(problem.type).toBeUndefined();
      expect(problem.title).toBeUndefined();
      expect(problem.instance).toBeUndefined();
      expect(problem.traceId).toBeUndefined();
    });

    it("should include status when provided", () => {
      const error = new StructuredError({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        message: "User not found",
      });

      const problem = error.toProblemDetails({ status: 404 });

      expect(problem.status).toBe(404);
    });

    it("should include all RFC 9457 fields when provided", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Email format is invalid",
      });

      const problem = error.toProblemDetails({
        status: 400,
        type: "https://api.example.com/errors/validation-failed",
        title: "Validation Failed",
        instance: "/users/123/email",
        traceId: "trace-abc-123",
      });

      expect(problem.status).toBe(400);
      expect(problem.type).toBe(
        "https://api.example.com/errors/validation-failed",
      );
      expect(problem.title).toBe("Validation Failed");
      expect(problem.instance).toBe("/users/123/email");
      expect(problem.traceId).toBe("trace-abc-123");
      expect(problem.detail).toBe("Email format is invalid");
      expect(problem.code).toBe("VALIDATION_FAILED");
      expect(problem.category).toBe("VALIDATION");
      expect(problem.retryable).toBe(false);
    });

    it("should spread details as extension members", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Validation failed",
        details: {
          field: "email",
          constraint: "format",
          value: "not-an-email",
        },
      });

      const problem = error.toProblemDetails({ status: 400 });

      expect(problem.field).toBe("email");
      expect(problem.constraint).toBe("format");
      expect(problem.value).toBe("not-an-email");
    });

    it("should preserve type safety for codes and categories", () => {
      type MyCode = "ERROR_A" | "ERROR_B";
      type MyCategory = "CAT_1" | "CAT_2";

      const error = new StructuredError<MyCode, MyCategory>({
        code: "ERROR_A",
        category: "CAT_1",
        retryable: true,
        message: "Test",
      });

      const problem = error.toProblemDetails();

      // TypeScript compile-time check
      const code: MyCode = problem.code;
      const category: MyCategory = problem.category;

      expect(code).toBe("ERROR_A");
      expect(category).toBe("CAT_1");
    });

    it("should preserve type safety for details extensions", () => {
      interface MyDetails {
        userId: string;
        attemptCount: number;
      }

      const error = new StructuredError<string, string, MyDetails>({
        code: "AUTH_FAILED",
        category: "AUTH",
        retryable: false,
        message: "Authentication failed",
        details: { userId: "user-123", attemptCount: 3 },
      });

      const problem = error.toProblemDetails({ status: 401 });

      // TypeScript compile-time check - details are spread as extensions
      expect(problem.userId).toBe("user-123");
      expect(problem.attemptCount).toBe(3);
    });

    it("should work with empty options object", () => {
      const error = new StructuredError({
        code: "TEST",
        category: "TEST",
        retryable: false,
        message: "Test message",
      });

      const problem = error.toProblemDetails({});

      expect(problem.code).toBe("TEST");
      expect(problem.detail).toBe("Test message");
    });

    it("should be serializable to JSON", () => {
      const error = new StructuredError({
        code: "API_ERROR",
        category: "EXTERNAL",
        retryable: true,
        message: "External API failed",
        details: { endpoint: "/api/users", statusCode: 503 },
      });

      const problem = error.toProblemDetails({
        status: 502,
        type: "https://example.com/errors/api-error",
        traceId: "req-xyz",
      });

      const json = JSON.stringify(problem);
      const parsed = JSON.parse(json);

      expect(parsed.status).toBe(502);
      expect(parsed.code).toBe("API_ERROR");
      expect(parsed.endpoint).toBe("/api/users");
      expect(parsed.traceId).toBe("req-xyz");
    });
  });
});
