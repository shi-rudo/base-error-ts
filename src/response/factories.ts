/**
 * Factory functions for creating API responses.
 */

import type { ErrorResponse, SuccessResponse } from "./types.js";
import { ErrorResponseBuilder } from "./builder.js";

/** Input type for errorResponse */
type ErrorResponseInput<TCode extends string, TCategory extends string> = {
  code: TCode;
  category: TCategory;
  /** Whether the operation can be retried. Defaults to false. */
  retryable?: boolean;
};

/**
 * Create a type-safe error response builder.
 *
 * @param options - Error configuration object (retryable defaults to false)
 * @returns Builder instance for chaining
 *
 * @example
 * ```ts
 * // Minimal
 * const simpleError = errorResponse({
 *   code: "UNAUTHORIZED",
 *   category: "AUTH",
 * }).build();
 *
 * // With builder methods
 * const error = errorResponse({
 *   code: "USER_NOT_FOUND",
 *   category: "NOT_FOUND",
 * })
 *   .httpStatus(404)
 *   .message("User with id 123 not found")
 *   .details({ userId: "123" })
 *   .build();
 *
 * // Retryable error
 * const retryableError = errorResponse({
 *   code: "RATE_LIMITED",
 *   category: "RATE_LIMIT",
 *   retryable: true,
 * }).build();
 * ```
 */
export function errorResponse<TCode extends string, TCategory extends string>(
  options: ErrorResponseInput<TCode, TCategory>,
): ErrorResponseBuilder<
  TCode,
  TCategory,
  Record<string, never>,
  Record<string, never>
> {
  return new ErrorResponseBuilder({
    code: options.code,
    category: options.category,
    retryable: options.retryable ?? false,
    ctx: {} as Record<string, never>,
    details: {} as Record<string, never>,
  });
}

/**
 * Create a success response.
 *
 * @param data - The response data (optional for void responses)
 * @returns SuccessResponse with the provided data
 *
 * @example
 * ```ts
 * // With data
 * const response = successResponse({ id: "123", name: "John" });
 * // { isSuccess: true, data: { id: "123", name: "John" } }
 *
 * // Without data (void response)
 * const voidResponse = successResponse();
 * // { isSuccess: true, data: undefined }
 * ```
 */
export function successResponse(): SuccessResponse<void>;
export function successResponse<TData>(data: TData): SuccessResponse<TData>;
export function successResponse<TData>(
  data?: TData,
): SuccessResponse<TData | void> {
  return {
    isSuccess: true,
    data: data as TData,
  };
}

/** Input type for createErrorResponse - only code and category are required */
type CreateErrorResponseInput<
  TCode extends string,
  TCategory extends string,
  TCtx extends Record<string, unknown> | undefined = undefined,
  TDetails extends Record<string, unknown> | undefined = undefined,
> = {
  code: TCode;
  category: TCategory;
  /** Whether the operation can be retried. Defaults to false. */
  retryable?: boolean;
  traceId?: string;
  ctx?: TCtx;
  details?: TDetails;
};

/**
 * Create an error response directly from an object.
 *
 * Use this when you want to create an ErrorResponse in one go without
 * the builder pattern. TypeScript will infer the exact type from your input.
 *
 * Only `code` and `category` are required. Other fields have sensible defaults:
 * - `retryable` defaults to `false`
 * - `ctx` defaults to `{}`
 * - `details` defaults to `{}`
 *
 * @param input - Error response configuration
 * @returns ErrorResponse with exact type based on input
 *
 * @example
 * ```ts
 * // Minimal - just code and category
 * const simpleError = createErrorResponse({
 *   code: "UNAUTHORIZED",
 *   category: "AUTH",
 * });
 *
 * // With context
 * const errorWithCtx = createErrorResponse({
 *   code: "USER_NOT_FOUND",
 *   category: "NOT_FOUND",
 *   ctx: { message: "User 123 not found", httpStatusCode: 404 }
 * });
 *
 * // Full options
 * const fullError = createErrorResponse({
 *   code: "RATE_LIMITED",
 *   category: "RATE_LIMIT",
 *   retryable: true,
 *   ctx: { message: "Too many requests" },
 *   details: { retryAfter: 60 }
 * });
 * ```
 */
export function createErrorResponse<
  TCode extends string,
  TCategory extends string,
  TCtx extends Record<string, unknown> | undefined = undefined,
  TDetails extends Record<string, unknown> | undefined = undefined,
>(
  input: CreateErrorResponseInput<TCode, TCategory, TCtx, TDetails>,
): ErrorResponse<
  TCode,
  TCategory,
  TCtx extends undefined ? Record<string, never> : TCtx,
  TDetails extends undefined ? Record<string, never> : TDetails
> {
  return {
    isSuccess: false,
    error: {
      code: input.code,
      category: input.category,
      retryable: input.retryable ?? false,
      ...(input.traceId !== undefined && { traceId: input.traceId }),
      ctx: (input.ctx ?? {}) as TCtx extends undefined
        ? Record<string, never>
        : TCtx,
      details: (input.details ?? {}) as TDetails extends undefined
        ? Record<string, never>
        : TDetails,
    },
  };
}

/**
 * Create a success response directly from an object.
 *
 * Alternative to successResponse() when you prefer explicit object syntax.
 *
 * @param input - Success response configuration
 * @returns SuccessResponse with the provided data
 *
 * @example
 * ```ts
 * const response = createSuccessResponse({
 *   data: { id: "123", name: "John" }
 * });
 * ```
 */
export function createSuccessResponse<TData>(input: {
  data: TData;
}): SuccessResponse<TData> {
  return {
    isSuccess: true,
    data: input.data,
  };
}
