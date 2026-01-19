/**
 * Problem Details Example
 *
 * This example demonstrates how to use StructuredError with RFC 9457
 * Problem Details for HTTP APIs. It shows:
 * - Creating typed API errors with StructuredError
 * - Converting errors to RFC 9457 compliant Problem Details
 * - RPC caller pattern with error handling middleware
 * - Retry logic based on error retryability
 * - Error wrapping pattern for layered architectures
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
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
  id?: string;
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

class ApiError extends StructuredError<
  ApiErrorCode,
  ApiErrorCategory,
  ApiErrorDetails
> {
  constructor(options: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    category: ApiErrorCategory;
    details?: ApiErrorDetails;
    cause?: unknown;
  }) {
    super(options);
  }

  toHttpResponse(traceId?: string): ReturnType<typeof this.toProblemDetails> {
    return this.toProblemDetails({
      status: HTTP_STATUS[this.code],
      type: `https://api.example.com/errors/${this.code.toLowerCase().replace(/_/g, "-")}`,
      title: this.code.replace(/_/g, " ").toLowerCase(),
      instance: traceId ? `/api/requests/${traceId}` : undefined,
      traceId,
    });
  }
}

class BadRequestError extends ApiError {
  constructor(message: string, field?: string, cause?: unknown) {
    super({
      code: "BAD_REQUEST",
      message,
      retryable: false,
      category: "VALIDATION",
      details: field ? { field } : undefined,
      cause,
    });
  }
}

class UnauthorizedError extends ApiError {
  constructor(message: string = "Unauthorized", cause?: unknown) {
    super({
      code: "UNAUTHORIZED",
      message,
      retryable: false,
      category: "AUTH",
      cause,
    });
  }
}

class ForbiddenError extends ApiError {
  constructor(message: string = "Forbidden", cause?: unknown) {
    super({
      code: "FORBIDDEN",
      message,
      retryable: false,
      category: "PERMISSION",
      cause,
    });
  }
}

class NotFoundError extends ApiError {
  constructor(resource: string, id?: string, cause?: unknown) {
    const message = id
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    super({
      code: "NOT_FOUND",
      message,
      retryable: false,
      category: "NOT_FOUND",
      details: { resource, id },
      cause,
    });
  }
}

class ConflictError extends ApiError {
  constructor(message: string, cause?: unknown) {
    super({
      code: "CONFLICT",
      message,
      retryable: false,
      category: "CONFLICT",
      cause,
    });
  }
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

function getJapaneseTitle(code: ApiErrorCode): string {
  const titles: Record<ApiErrorCode, string> = {
    BAD_REQUEST: "不正なリクエスト",
    UNAUTHORIZED: "認証が必要です",
    FORBIDDEN: "アクセス拒否",
    NOT_FOUND: "リソースが見つかりません",
    CONFLICT: "競合が発生しました",
    INTERNAL_ERROR: "サーバーエラー",
    DATABASE_ERROR: "データベースエラー",
  };
  return titles[code];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function mapErrorToProblemDetails(
  error: unknown,
  method: string,
  path: string,
): ReturnType<
  StructuredError<
    ApiErrorCode,
    ApiErrorCategory,
    ApiErrorDetails
  >["toProblemDetails"]
> {
  const traceId = crypto.randomUUID();

  if (error instanceof StructuredError) {
    return error.toProblemDetails({
      status: HTTP_STATUS[error.code as ApiErrorCode] || 500,
      type: `https://api.example.com/errors/${error.code.toLowerCase().replace(/_/g, "-")}`,
      title: getJapaneseTitle(error.code as ApiErrorCode),
      instance: `${method} ${path}`,
      traceId,
    });
  }

  if (error instanceof DatabaseError) {
    return {
      type: "https://api.example.com/errors/database-error",
      title: getJapaneseTitle("DATABASE_ERROR"),
      status: 503,
      detail: error.message,
      instance: `${method} ${path}`,
      traceId,
      code: "DATABASE_ERROR",
      category: "DATABASE" as ApiErrorCategory,
      retryable: error.retryable,
    };
  }

  if (error instanceof BaseError) {
    return {
      type: "https://api.example.com/errors/internal-error",
      title: getJapaneseTitle("INTERNAL_ERROR"),
      status: 500,
      detail: error.message,
      instance: `${method} ${path}`,
      traceId,
      code: "INTERNAL_ERROR" as ApiErrorCode,
      category: "INFRASTRUCTURE" as ApiErrorCategory,
      retryable: false,
    };
  }

  return {
    type: "https://api.example.com/errors/unknown-error",
    title: "Unknown Error",
    status: 500,
    detail: String(error),
    instance: `${method} ${path}`,
    traceId,
    code: "INTERNAL_ERROR" as ApiErrorCode,
    category: "INFRASTRUCTURE" as ApiErrorCategory,
    retryable: false,
  };
}

async function handleRpcCall<T>(
  method: string,
  endpoint: string,
  request: unknown,
): Promise<
  | { status: number; body: ReturnType<typeof mapErrorToProblemDetails> }
  | { data: T }
> {
  try {
    const result = await rpcCaller<T>(endpoint, request);
    return { data: result };
  } catch (error) {
    const problem = mapErrorToProblemDetails(error, method, endpoint);
    return { status: problem.status || 500, body: problem };
  }
}

async function wrappedRpcCall<T>(
  method: string,
  endpoint: string,
  request: unknown,
): Promise<
  { status: number; body: ReturnType<ApiError["toHttpResponse"]> } | { data: T }
> {
  try {
    const result = await rpcCaller<T>(endpoint, request);
    return { data: result };
  } catch (error) {
    if (error instanceof DatabaseError) {
      const wrapped = new ApiError({
        code: "DATABASE_ERROR",
        message: "User service temporarily unavailable",
        retryable: true,
        category: "DATABASE",
        details: { cause: error.message },
        cause: error,
      });
      return { status: 503, body: wrapped.toHttpResponse() };
    }
    throw error;
  }
}

async function main() {
  console.log("Problem Details Example\n");
  console.log("=".repeat(60));
  console.log("Example 1: Basic RPC call with error mapping");
  console.log("=".repeat(60));

  const response1 = await handleRpcCall("POST", "/api/users", { name: "John" });
  if ("body" in response1) {
    console.log(`Status: ${response1.status}`);
    console.log("Response Body:");
    console.log(JSON.stringify(response1.body, null, 2));
  }

  console.log("\n" + "=".repeat(60));
  console.log("Example 2: RPC call with error wrapping");
  console.log("=".repeat(60));

  const response2 = await wrappedRpcCall("GET", "/api/users/123", {});
  if ("body" in response2) {
    console.log(`Status: ${response2.status}`);
    console.log("Response Body:");
    console.log(JSON.stringify(response2.body, null, 2));
  }

  const isCi = process.env.CI === "true" || process.env.TEST === "true";

  if (!isCi) {
    console.log("\n" + "=".repeat(60));
    console.log("Example 3: Retry logic with retryable error");
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
  console.log("Example 4: Different error types");
  console.log("=".repeat(60));

  const errorExamples = [
    new BadRequestError("Invalid email format", "email"),
    new UnauthorizedError(),
    new ForbiddenError("You don't have permission to access this resource"),
    new NotFoundError("User", "123"),
    new ConflictError("User with this email already exists"),
  ];

  for (const error of errorExamples) {
    const problem = error.toHttpResponse();
    console.log(`\n${error.code}:`);
    console.log(JSON.stringify(problem, null, 2));
  }
}

main().catch(console.error);
