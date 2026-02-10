import { randomUUID } from "node:crypto";

/**
 * Error Response Builder Example
 *
 * This example demonstrates how to use the ErrorResponseBuilder for
 * type-safe error responses. It shows:
 * - Creating errors with the errorResponse() factory
 * - Builder pattern for fluent API
 * - Multiple localized messages (English + Japanese)
 * - Additional context with .withCtx()
 * - RPC caller pattern with error handling
 * - Error type narrowing in catch blocks
 */
import { errorResponse, successResponse } from "../src/response/factories.js";
import { BaseError, StructuredError } from "../src/index.js";

type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "DATABASE_ERROR";

type ApiErrorCategory =
  | "VALIDATION"
  | "AUTH"
  | "PERMISSION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INFRASTRUCTURE"
  | "DATABASE";

interface ApiErrorDetails extends Record<string, unknown> {
  cause?: string;
  requestId?: string;
  resource?: string;
  field?: string;
}

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  DATABASE_ERROR: 503,
};

function getJapaneseMessage(code: ApiErrorCode): string {
  const messages: Record<ApiErrorCode, string> = {
    BAD_REQUEST: "リクエストが無効です",
    UNAUTHORIZED: "認証が必要です",
    FORBIDDEN: "アクセスが拒否されました",
    NOT_FOUND: "リソースが見つかりません",
    CONFLICT: "競合が発生しました",
    INTERNAL_ERROR: "サーバーエラーが発生しました",
    DATABASE_ERROR: "データベースエラーが発生しました",
  };
  return messages[code];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DatabaseError extends BaseError<"DatabaseError"> {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function rpcCaller<T>(_endpoint: string, _request: unknown): Promise<T> {
  throw new DatabaseError("Connection timeout to user-service", true);
}

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (error instanceof StructuredError && !error.retryable) {
        throw error;
      }

      if (attempt < maxRetries) {
        console.log(`Retry attempt ${attempt + 1}/${maxRetries}...`);
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

function mapErrorToErrorResponse(error: unknown, method: string, path: string) {
  const traceId = randomUUID();
  const timestamp = new Date().toISOString();

  if (
    error instanceof StructuredError &&
    "code" in error &&
    "category" in error
  ) {
    return errorResponse({
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    })
      .httpStatus(HTTP_STATUS[error.code] || 500)
      .message(error.message)
      .localized("en", error.message)
      .localized("ja", getJapaneseMessage(error.code))
      .traceId(traceId)
      .withCtx({
        method,
        path,
        timestamp,
        requestId: `req-${traceId}`,
      })
      .details(error.details ?? {})
      .build();
  }

  if (error instanceof DatabaseError) {
    return errorResponse({
      code: "DATABASE_ERROR",
      category: "DATABASE",
      retryable: error.retryable,
    })
      .httpStatus(503)
      .message(error.message)
      .localized("en", "Database service temporarily unavailable")
      .localized("ja", "データベースサービスが一時的に利用できません")
      .traceId(traceId)
      .withCtx({
        method,
        path,
        timestamp,
        requestId: `req-${traceId}`,
      })
      .build();
  }

  const message = error instanceof Error ? error.message : String(error);

  return errorResponse({
    code: "INTERNAL_ERROR",
    category: "INFRASTRUCTURE",
    retryable: false,
  })
    .httpStatus(500)
    .message(message)
    .localized("en", "An unexpected error occurred")
    .localized("ja", "予期しないエラーが発生しました")
    .traceId(traceId)
    .withCtx({
      method,
      path,
      timestamp,
      requestId: `req-${traceId}`,
    })
    .build();
}

async function handleRpcCall<T>(
  method: string,
  endpoint: string,
  request: unknown,
): Promise<
  | { status: number; body: ReturnType<typeof mapErrorToErrorResponse> }
  | { data: T }
> {
  try {
    const result = await rpcCaller<T>(endpoint, request);
    return { data: result };
  } catch (error) {
    const response = mapErrorToErrorResponse(error, method, endpoint);
    return { status: response.error.ctx.httpStatusCode || 500, body: response };
  }
}

async function main() {
  console.log("Error Response Builder Example\n");
  console.log("=".repeat(60));
  console.log("Example 1: Basic RPC call with error mapping");
  console.log("=".repeat(60));

  const response1 = await handleRpcCall("POST", "/api/users", { name: "John" });
  if ("body" in response1) {
    console.log(`Status: ${response1.status}`);
    console.log("Response Body:");
    console.log(JSON.stringify(response1.body, null, 2));
  }

  const isCi = process.env.CI === "true" || process.env.TEST === "true";

  if (!isCi) {
    console.log("\n" + "=".repeat(60));
    console.log("Example 2: Retry logic with retryable error");
    console.log("=".repeat(60));

    try {
      const result = await withRetry(() => rpcCaller("users", {}), 3);
      console.log("Result:", result);
    } catch (error) {
      if (error instanceof StructuredError) {
        console.log(`Failed after retries: ${error.code} - ${error.message}`);
        console.log(`Retryable: ${error.retryable}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Example 3: Builder pattern with all options");
  console.log("=".repeat(60));

  const builtError = errorResponse({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
  })
    .httpStatus(404)
    .message("User with id 123 not found")
    .localized("en", "User not found")
    .localized("ja", "ユーザーが見つかりません")
    .traceId("trace-abc-123")
    .withCtx({
      method: "GET",
      path: "/api/users/123",
      timestamp: new Date().toISOString(),
      requestId: "req-xyz-789",
    })
    .details({ userId: "123", resource: "users" })
    .build();

  console.log("Built Error Response:");
  console.log(JSON.stringify(builtError, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("Example 4: Type-safe error codes and categories");
  console.log("=".repeat(60));

  const errorExamples: Array<{
    code: ApiErrorCode;
    category: ApiErrorCategory;
    retryable: boolean;
    message: string;
    details?: ApiErrorDetails;
  }> = [
    {
      code: "BAD_REQUEST",
      category: "VALIDATION",
      retryable: false,
      message: "Invalid email format",
      details: { field: "email" },
    },
    {
      code: "UNAUTHORIZED",
      category: "AUTH",
      retryable: false,
      message: "Authentication required",
    },
    {
      code: "FORBIDDEN",
      category: "PERMISSION",
      retryable: false,
      message: "Access denied to resource",
    },
    {
      code: "NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "Resource not found",
      details: { resource: "users", cause: "id-123" },
    },
    {
      code: "CONFLICT",
      category: "CONFLICT",
      retryable: false,
      message: "Resource already exists",
    },
  ];

  for (const errorConfig of errorExamples) {
    const error = errorResponse({
      code: errorConfig.code,
      category: errorConfig.category,
      retryable: errorConfig.retryable,
    })
      .httpStatus(HTTP_STATUS[errorConfig.code])
      .message(errorConfig.message)
      .localized("en", errorConfig.message)
      .localized("ja", getJapaneseMessage(errorConfig.code))
      .traceId(randomUUID())
      .withCtx({
        method: "POST",
        path: "/api/resource",
        timestamp: new Date().toISOString(),
      })
      .details(errorConfig.details ?? {})
      .build();

    console.log(`\n${errorConfig.code}:`);
    console.log(JSON.stringify(error, null, 2));
  }

  console.log("\n" + "=".repeat(60));
  console.log("Example 5: Success response for comparison");
  console.log("=".repeat(60));

  const success = successResponse({
    id: "123",
    name: "John",
    email: "john@example.com",
  });
  console.log("Success Response:");
  console.log(JSON.stringify(success, null, 2));
}

main().catch(console.error);
