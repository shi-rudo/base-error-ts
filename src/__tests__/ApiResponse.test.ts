import { describe, expect, it } from "vitest";
import {
  errorResponse,
  successResponse,
  createErrorResponse,
  createSuccessResponse,
  type ApiResponse,
} from "../index.js";

describe("ApiResponse", () => {
  describe("successResponse", () => {
    it("should create a success response with data", () => {
      const response = successResponse({ id: "123", name: "John" });

      expect(response.isSuccess).toBe(true);
      expect(response.data).toEqual({ id: "123", name: "John" });
    });

    it("should work with primitive data", () => {
      const response = successResponse("hello");

      expect(response.isSuccess).toBe(true);
      expect(response.data).toBe("hello");
    });

    it("should work with null data", () => {
      const response = successResponse(null);

      expect(response.isSuccess).toBe(true);
      expect(response.data).toBeNull();
    });
  });

  describe("errorResponse builder", () => {
    it("should create minimal error response", () => {
      const response = errorResponse({
        code: "TEST_ERROR",
        category: "TEST",
        retryable: false,
      }).build();

      expect(response.isSuccess).toBe(false);
      expect(response.error.code).toBe("TEST_ERROR");
      expect(response.error.category).toBe("TEST");
      expect(response.error.retryable).toBe(false);
      expect(response.error.ctx).toEqual({});
      expect(response.error.details).toEqual({});
    });

    it("should set httpStatus", () => {
      const response = errorResponse({
        code: "NOT_FOUND",
        category: "CLIENT",
        retryable: false,
      })
        .httpStatus(404)
        .build();

      expect(response.error.ctx.httpStatusCode).toBe(404);
    });

    it("should set message", () => {
      const response = errorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: false,
      })
        .message("Something went wrong")
        .build();

      expect(response.error.ctx.message).toBe("Something went wrong");
    });

    it("should set localized message", () => {
      const response = errorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: false,
      })
        .localized("de", "Etwas ist schiefgelaufen")
        .build();

      expect(response.error.ctx.messageLocalized).toEqual({
        locale: "de",
        message: "Etwas ist schiefgelaufen",
      });
    });

    it("should set traceId", () => {
      const response = errorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: false,
      })
        .traceId("trace-123")
        .build();

      expect(response.error.traceId).toBe("trace-123");
    });

    it("should set details", () => {
      const response = errorResponse({
        code: "VALIDATION",
        category: "CLIENT",
        retryable: false,
      })
        .details({ field: "email", reason: "invalid format" })
        .build();

      expect(response.error.details).toEqual({
        field: "email",
        reason: "invalid format",
      });
    });

    it("should add custom context with withCtx", () => {
      const response = errorResponse({
        code: "RATE_LIMITED",
        category: "RATE_LIMIT",
        retryable: true,
      })
        .httpStatus(429)
        .withCtx({ retryAfter: 60, limit: 100 })
        .build();

      expect(response.error.ctx.httpStatusCode).toBe(429);
      expect(response.error.ctx.retryAfter).toBe(60);
      expect(response.error.ctx.limit).toBe(100);
    });

    it("should chain all methods", () => {
      const response = errorResponse({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
      })
        .httpStatus(404)
        .message("User with id 123 not found")
        .localized("en", "User not found")
        .traceId("req-abc-123")
        .details({ userId: "123" })
        .build();

      expect(response).toEqual({
        isSuccess: false,
        error: {
          code: "USER_NOT_FOUND",
          category: "NOT_FOUND",
          retryable: false,
          traceId: "req-abc-123",
          ctx: {
            httpStatusCode: 404,
            message: "User with id 123 not found",
            messageLocalized: {
              locale: "en",
              message: "User not found",
            },
          },
          details: { userId: "123" },
        },
      });
    });

    it("should be immutable - each call returns new builder", () => {
      const builder1 = errorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: false,
      });
      const builder2 = builder1.httpStatus(400);
      const builder3 = builder2.message("error");

      const result1 = builder1.build();
      const result2 = builder2.build();
      const result3 = builder3.build();

      expect(result1.error.ctx).toEqual({});
      expect(result2.error.ctx).toEqual({ httpStatusCode: 400 });
      expect(result3.error.ctx).toEqual({
        httpStatusCode: 400,
        message: "error",
      });
    });
  });

  describe("Type safety", () => {
    it("should preserve code and category types", () => {
      type MyCode = "ERROR_A" | "ERROR_B";
      type MyCategory = "CAT_1" | "CAT_2";

      const response = errorResponse<MyCode, MyCategory>({
        code: "ERROR_A",
        category: "CAT_1",
        retryable: false,
      }).build();

      // TypeScript compile-time check
      const code: MyCode = response.error.code;
      const category: MyCategory = response.error.category;

      expect(code).toBe("ERROR_A");
      expect(category).toBe("CAT_1");
    });

    it("should narrow types in ApiResponse union", () => {
      type UserCode = "USER_NOT_FOUND" | "USER_DISABLED";
      type UserCategory = "NOT_FOUND" | "FORBIDDEN";

      interface User {
        id: string;
        name: string;
      }

      function getUser(
        id: string,
      ): ApiResponse<User, UserCode, UserCategory, { httpStatusCode: number }> {
        if (id === "404") {
          return errorResponse<UserCode, UserCategory>({
            code: "USER_NOT_FOUND",
            category: "NOT_FOUND",
            retryable: false,
          })
            .httpStatus(404)
            .build();
        }
        return successResponse({ id, name: "John" });
      }

      const success = getUser("123");
      const failure = getUser("404");

      if (success.isSuccess) {
        expect(success.data.name).toBe("John");
      }

      if (!failure.isSuccess) {
        expect(failure.error.code).toBe("USER_NOT_FOUND");
        expect(failure.error.ctx.httpStatusCode).toBe(404);
      }
    });
  });

  describe("Serialization", () => {
    it("should be JSON serializable", () => {
      const response = errorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: true,
      })
        .httpStatus(500)
        .message("Internal error")
        .localized("en", "Something went wrong")
        .details({ requestId: "req-123" })
        .build();

      const json = JSON.stringify(response);
      const parsed = JSON.parse(json);

      expect(parsed.isSuccess).toBe(false);
      expect(parsed.error.code).toBe("ERROR");
      expect(parsed.error.ctx.httpStatusCode).toBe(500);
      expect(parsed.error.ctx.messageLocalized.locale).toBe("en");
    });

    it("should not include traceId when not set", () => {
      const response = errorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: false,
      }).build();

      expect(response.error).not.toHaveProperty("traceId");
    });
  });

  describe("createErrorResponse", () => {
    it("should create error response from object", () => {
      const response = createErrorResponse({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        ctx: {
          httpStatusCode: 404,
          message: "User 123 not found",
        },
        details: { userId: "123" },
      });

      expect(response.isSuccess).toBe(false);
      expect(response.error.code).toBe("USER_NOT_FOUND");
      expect(response.error.category).toBe("NOT_FOUND");
      expect(response.error.retryable).toBe(false);
      expect(response.error.ctx.httpStatusCode).toBe(404);
      expect(response.error.ctx.message).toBe("User 123 not found");
      expect(response.error.details.userId).toBe("123");
    });

    it("should include traceId when provided", () => {
      const response = createErrorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: true,
        traceId: "trace-abc-123",
        ctx: {},
        details: {},
      });

      expect(response.error.traceId).toBe("trace-abc-123");
    });

    it("should not include traceId when not provided", () => {
      const response = createErrorResponse({
        code: "ERROR",
        category: "TEST",
        retryable: false,
        ctx: {},
        details: {},
      });

      expect(response.error).not.toHaveProperty("traceId");
    });

    it("should create full error response with all fields", () => {
      const response = createErrorResponse({
        code: "VALIDATION_FAILED",
        category: "VALIDATION",
        retryable: false,
        traceId: "req-xyz",
        ctx: {
          httpStatusCode: 400,
          message: "Email format is invalid",
          messageLocalized: {
            locale: "de",
            message: "E-Mail-Format ist ungültig",
          },
        },
        details: {
          field: "email",
          value: "not-an-email",
          constraint: "format",
        },
      });

      expect(response).toEqual({
        isSuccess: false,
        error: {
          code: "VALIDATION_FAILED",
          category: "VALIDATION",
          retryable: false,
          traceId: "req-xyz",
          ctx: {
            httpStatusCode: 400,
            message: "Email format is invalid",
            messageLocalized: {
              locale: "de",
              message: "E-Mail-Format ist ungültig",
            },
          },
          details: {
            field: "email",
            value: "not-an-email",
            constraint: "format",
          },
        },
      });
    });

    it("should preserve type inference", () => {
      type MyCode = "ERROR_A" | "ERROR_B";
      type MyCategory = "CAT_1" | "CAT_2";

      const response = createErrorResponse({
        code: "ERROR_A" as MyCode,
        category: "CAT_1" as MyCategory,
        retryable: false,
        ctx: { httpStatusCode: 500 },
        details: { foo: "bar" },
      });

      // TypeScript compile-time checks
      const code: MyCode = response.error.code;
      const category: MyCategory = response.error.category;
      const status: number = response.error.ctx.httpStatusCode;
      const foo: string = response.error.details.foo;

      expect(code).toBe("ERROR_A");
      expect(category).toBe("CAT_1");
      expect(status).toBe(500);
      expect(foo).toBe("bar");
    });
  });

  describe("createSuccessResponse", () => {
    it("should create success response from object", () => {
      const response = createSuccessResponse({
        data: { id: "123", name: "John" },
      });

      expect(response.isSuccess).toBe(true);
      expect(response.data).toEqual({ id: "123", name: "John" });
    });

    it("should work with primitive data", () => {
      const response = createSuccessResponse({ data: 42 });

      expect(response.isSuccess).toBe(true);
      expect(response.data).toBe(42);
    });

    it("should preserve type inference", () => {
      interface User {
        id: string;
        name: string;
      }

      const response = createSuccessResponse({
        data: { id: "123", name: "John" } as User,
      });

      // TypeScript compile-time check
      const user: User = response.data;

      expect(user.id).toBe("123");
      expect(user.name).toBe("John");
    });
  });
});
