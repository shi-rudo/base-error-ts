/**
 * Factory functions for creating API responses.
 */

import type { ErrorResponse, SuccessResponse } from "./types.js";
import { ErrorResponseBuilder } from "./builder.js";

/**
 * Create a type-safe error response builder.
 *
 * @param code - Machine-readable error code
 * @param category - Error category for grouping
 * @param retryable - Whether the operation can be retried
 * @returns Builder instance for chaining
 *
 * @example
 * ```ts
 * const error = errorResponse("USER_NOT_FOUND", "NOT_FOUND", false)
 *   .httpStatus(404)
 *   .message("User with id 123 not found")
 *   .localized("en", "User not found")
 *   .details({ userId: "123" })
 *   .build();
 *
 * // Type is exact - no optionals for fields you set
 * error.ctx.httpStatusCode;           // number
 * error.ctx.message;                  // string
 * error.ctx.messageLocalized.locale;  // string
 * error.details.userId;               // string
 * ```
 */
export function errorResponse<TCode extends string, TCategory extends string>(
  code: TCode,
  category: TCategory,
  retryable: boolean,
): ErrorResponseBuilder<
  TCode,
  TCategory,
  Record<string, never>,
  Record<string, never>
> {
  return new ErrorResponseBuilder({
    code,
    category,
    retryable,
    ctx: {} as Record<string, never>,
    details: {} as Record<string, never>,
  });
}

/**
 * Create a success response.
 *
 * @param data - The response data
 * @returns SuccessResponse with the provided data
 *
 * @example
 * ```ts
 * const response = successResponse({ id: "123", name: "John" });
 * // { isSuccess: true, data: { id: "123", name: "John" } }
 * ```
 */
export function successResponse<TData>(data: TData): SuccessResponse<TData> {
  return {
    isSuccess: true,
    data,
  };
}

/** Input type for createErrorResponse - traceId is optional */
type CreateErrorResponseInput<
  TCode extends string,
  TCategory extends string,
  TCtx extends Record<string, unknown>,
  TDetails extends Record<string, unknown>,
> = {
  code: TCode;
  category: TCategory;
  retryable: boolean;
  traceId?: string;
  ctx: TCtx;
  details: TDetails;
};

/**
 * Create an error response directly from an object.
 *
 * Use this when you want to create an ErrorResponse in one go without
 * the builder pattern. TypeScript will infer the exact type from your input.
 *
 * @param input - Error response configuration
 * @returns ErrorResponse with exact type based on input
 *
 * @example
 * ```ts
 * const error = createErrorResponse({
 *   code: "USER_NOT_FOUND",
 *   category: "NOT_FOUND",
 *   retryable: false,
 *   ctx: {
 *     httpStatusCode: 404,
 *     message: "User 123 not found",
 *     messageLocalized: { locale: "en", message: "User not found" }
 *   },
 *   details: { userId: "123" }
 * });
 * ```
 */
export function createErrorResponse<
  TCode extends string,
  TCategory extends string,
  TCtx extends Record<string, unknown>,
  TDetails extends Record<string, unknown>,
>(
  input: CreateErrorResponseInput<TCode, TCategory, TCtx, TDetails>,
): ErrorResponse<TCode, TCategory, TCtx, TDetails> {
  return {
    isSuccess: false,
    code: input.code,
    category: input.category,
    retryable: input.retryable,
    ...(input.traceId !== undefined && { traceId: input.traceId }),
    ctx: input.ctx,
    details: input.details,
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
