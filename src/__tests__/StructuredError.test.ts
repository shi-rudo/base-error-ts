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

  describe("localized public messages", () => {
    const makeError = () =>
      new StructuredError({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        message: "User 123 not found in primary db",
        publicMessage: "The requested resource was not found.",
      })
        .addLocalizedMessage("en", "We couldn't find that user.")
        .addLocalizedMessage("de", "Wir konnten diesen Benutzer nicht finden.");

    it("uses the localized message in toPublicJSON without expose", () => {
      expect(makeError().toPublicJSON({ locale: "de" }).message).toBe(
        "Wir konnten diesen Benutzer nicht finden.",
      );
    });

    it("surfaces the localized message as the ProblemDetails detail", () => {
      const problem = makeError().toProblemDetails({
        status: 404,
        locale: "en",
      });
      expect(problem.detail).toBe("We couldn't find that user.");
      // still safe: code/category are not leaked
      expect(problem.code).toBe("INTERNAL_ERROR");
      expect(problem.category).toBeUndefined();
    });

    it("falls back to fallbackLocale, then to publicMessage", () => {
      // 'fr' is missing -> fallback 'en'
      expect(
        makeError().toProblemDetails({ locale: "fr", fallbackLocale: "en" })
          .detail,
      ).toBe("We couldn't find that user.");
      // neither present -> configured publicMessage (no default-message leak)
      expect(makeError().toProblemDetails({ locale: "fr" }).detail).toBe(
        "The requested resource was not found.",
      );
    });

    it("lets an explicit detail/message win over the locale", () => {
      expect(
        makeError().toProblemDetails({ locale: "de", detail: "Override" })
          .detail,
      ).toBe("Override");
    });

    it("threads locale through toErrorResponse", () => {
      const res = makeError().toErrorResponse({ locale: "de" });
      expect(res.error.ctx.message).toBe(
        "Wir konnten diesen Benutzer nicht finden.",
      );
    });
  });

  describe("toProblemDetails", () => {
    it("should convert to minimal safe ProblemDetails", () => {
      const error = new StructuredError({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        message: "User with id 123 not found",
      });

      const problem = error.toProblemDetails();

      expect(problem.code).toBe("INTERNAL_ERROR");
      expect(problem.retryable).toBe(false);
      expect(problem.detail).toBe("An unexpected error occurred.");
      expect(problem.category).toBeUndefined();
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
      expect(problem.detail).toBe("An unexpected error occurred.");
      expect(problem.code).toBe("INTERNAL_ERROR");
      expect(problem.category).toBeUndefined();
      expect(problem.retryable).toBe(false);
    });

    it("should not expose raw details as extension members by default", () => {
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

      expect(problem).not.toHaveProperty("field");
      expect(problem).not.toHaveProperty("constraint");
      expect(problem).not.toHaveProperty("value");
    });

    it("should surface details only through an explicit mapDetails projection", () => {
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

      const problem = error.toProblemDetails({
        status: 400,
        mapDetails: (details) => ({
          field: details?.field,
          constraint: details?.constraint,
        }),
      });

      expect(problem.field).toBe("email");
      expect(problem.constraint).toBe("format");
      // Fields not named in the projection never cross the boundary.
      expect(problem).not.toHaveProperty("value");
    });

    it("should not invoke mapDetails when the error has no details", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Validation failed",
        // no details
      });

      // A naive mapper that dereferences its argument must not be called, so
      // serialization in an error handler never throws a second error.
      const mapDetails = vi.fn((details: Record<string, unknown>) => ({
        field: details.field,
      }));

      expect(() =>
        error.toProblemDetails({ status: 400, mapDetails }),
      ).not.toThrow();
      expect(mapDetails).not.toHaveBeenCalled();
    });

    it("should map raw details to public extension members", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Validation failed",
        details: {
          internalField: "users.email",
          publicField: "email",
          value: "not-an-email",
        },
      });

      const problem = error.toProblemDetails({
        status: 400,
        mapDetails: (details) => ({
          field: details?.publicField,
        }),
      });

      expect(problem.field).toBe("email");
      expect(problem).not.toHaveProperty("internalField");
      expect(problem).not.toHaveProperty("value");
    });

    it("should include explicit public extensions", () => {
      const error = new StructuredError({
        code: "RATE_LIMITED",
        category: "RATE_LIMIT",
        retryable: true,
        message: "Rate limit exceeded",
      });

      const problem = error.toProblemDetails({
        status: 429,
        extensions: { retryAfterSeconds: 60 },
      });

      expect(problem.retryAfterSeconds).toBe(60);
    });

    it("should keep standard members stable when extensions collide", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Technical validation message",
        details: {
          status: 200,
          detail: "Unsafe detail",
          code: "OVERRIDE",
        },
      });

      const problem = error.toProblemDetails({
        status: 400,
        detail: "Public validation message",
        mapDetails: (details) => ({
          status: details?.status,
          detail: details?.detail,
          code: details?.code,
        }),
      });

      // Standard/library members always win over colliding extensions, and the
      // code stays the safe public default unless explicitly exposed.
      expect(problem.status).toBe(400);
      expect(problem.detail).toBe("Public validation message");
      expect(problem.code).toBe("INTERNAL_ERROR");
    });

    it("should never let extensions override standard or library members", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Technical validation message",
      });

      // There is no escape hatch: safe-by-default is invariant.
      const problem = error.toProblemDetails({
        status: 400,
        detail: "Public boundary detail",
        extensions: {
          status: 422,
          detail: "Unsafe override",
          code: "OVERRIDE",
          retryable: true,
        },
      });

      expect(problem.status).toBe(400);
      expect(problem.detail).toBe("Public boundary detail");
      expect(problem.code).toBe("INTERNAL_ERROR");
      expect(problem.retryable).toBe(false);
    });

    it("should project a deliberate public category", () => {
      const error = new StructuredError({
        code: "DB_UNIQUE_VIOLATION",
        category: "INFRASTRUCTURE",
        retryable: false,
        message: "duplicate key value violates unique constraint",
      });

      const problem = error.toProblemDetails({
        status: 409,
        publicCategory: "CONFLICT",
      });

      // Internal category stays hidden; the deliberate public one is emitted.
      expect(problem.category).toBe("CONFLICT");
    });

    it("should map internal structured errors to configured public codes and messages", () => {
      const error = new StructuredError({
        code: "DB_UNIQUE_VIOLATION",
        category: "INFRASTRUCTURE",
        retryable: false,
        message:
          "duplicate key value violates unique constraint users_email_key",
        publicCode: "EMAIL_ALREADY_REGISTERED",
        publicMessage: "This email address is already registered.",
      });

      expect(error.toPublicJSON()).toEqual({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "This email address is already registered.",
        retryable: false,
      });

      expect(error.toProblemDetails({ status: 409 })).toEqual({
        status: 409,
        detail: "This email address is already registered.",
        code: "EMAIL_ALREADY_REGISTERED",
        retryable: false,
      });
    });

    it("should expose internal structured fields only when explicitly requested", () => {
      const error = new StructuredError({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        message: "Email format is invalid",
        expose: true,
        details: {
          field: "email",
          constraint: "format",
        },
      });

      expect(error.toPublicJSON()).toEqual({
        code: "VALIDATION_FAILED",
        message: "Email format is invalid",
        retryable: false,
      });

      expect(
        error.toProblemDetails({
          status: 400,
          mapDetails: (details) => ({
            field: details?.field,
            constraint: details?.constraint,
          }),
        }),
      ).toEqual({
        status: 400,
        detail: "Email format is invalid",
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        field: "email",
        constraint: "format",
      });
    });

    it("should keep ErrorResponse client output safe by default", () => {
      const error = new StructuredError({
        code: "DB_CONNECTION_STRING_REJECTED",
        category: "INFRASTRUCTURE",
        retryable: true,
        message: "postgres://user:secret@db.internal was rejected",
        details: { host: "db.internal" },
        publicCode: "SERVICE_TEMPORARILY_UNAVAILABLE",
        publicMessage: "The service is temporarily unavailable.",
      });

      expect(error.toErrorResponse({ httpStatusCode: 503 })).toEqual({
        isSuccess: false,
        error: {
          code: "SERVICE_TEMPORARILY_UNAVAILABLE",
          category: "INTERNAL",
          retryable: true,
          ctx: {
            httpStatusCode: 503,
            message: "The service is temporarily unavailable.",
          },
          details: {},
        },
      });
    });

    it("should preserve type safety for codes and categories when exposed", () => {
      type MyCode = "ERROR_A" | "ERROR_B";
      type MyCategory = "CAT_1" | "CAT_2";

      const error = new StructuredError<MyCode, MyCategory>({
        code: "ERROR_A",
        category: "CAT_1",
        retryable: true,
        message: "Test",
      });

      const problem = error.toProblemDetails({ expose: true });

      // TypeScript compile-time check
      const code: string = problem.code;
      const category: MyCategory | undefined = problem.category;

      expect(code).toBe("ERROR_A");
      expect(category).toBe("CAT_1");
    });

    it("should preserve type safety for details extensions", () => {
      type MyDetails = {
        userId: string;
        attemptCount: number;
        [key: string]: unknown;
      };

      const error = new StructuredError<string, string, MyDetails>({
        code: "AUTH_FAILED",
        category: "AUTH",
        retryable: false,
        message: "Authentication failed",
        details: { userId: "user-123", attemptCount: 3 },
      });

      const problem = error.toProblemDetails({
        status: 401,
        mapDetails: (details) => ({
          userId: details?.userId,
          attemptCount: details?.attemptCount,
        }),
      });

      // TypeScript compile-time check - mapped details are typed extensions
      const userId = problem.userId;
      const attemptCount = problem.attemptCount;

      expect(userId).toBe("user-123");
      expect(attemptCount).toBe(3);
    });

    it("should work with empty options object", () => {
      const error = new StructuredError({
        code: "TEST",
        category: "TEST",
        retryable: false,
        message: "Test message",
      });

      const problem = error.toProblemDetails({});

      expect(problem.code).toBe("INTERNAL_ERROR");
      expect(problem.detail).toBe("An unexpected error occurred.");
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
      expect(parsed.code).toBe("INTERNAL_ERROR");
      expect(parsed).not.toHaveProperty("endpoint");
      expect(parsed).not.toHaveProperty("statusCode");
      expect(parsed.traceId).toBe("req-xyz");
    });
  });
});
