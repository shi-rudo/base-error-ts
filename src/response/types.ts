/**
 * Core types for API responses with discriminated unions.
 */

/* eslint-disable @typescript-eslint/no-empty-object-type */
// Using Record<string, {}> as default instead of Record<string, unknown>
// for better compatibility with strict frameworks like TanStack Start.
// {} excludes null/undefined which is intentional for type inference.

/**
 * Localized message with locale information for client-side i18n.
 */
export type LocalizedMessage = {
  /** BCP 47 locale code (e.g., "en", "de", "en-US") */
  locale: string;
  /** The localized message text */
  message: string;
};

/**
 * Success response type for API responses.
 */
export type SuccessResponse<TData> = {
  isSuccess: true;
  data: TData;
};

/**
 * Error details contained within an error response.
 */
export type ErrorDetails<
  TCode extends string = string,
  TCategory extends string = string,
  TCtx extends Record<string, unknown> = Record<string, {}>,
  TDetails extends Record<string, unknown> = Record<string, {}>,
> = {
  code: TCode;
  category: TCategory;
  retryable: boolean;
  traceId?: string;
  ctx: TCtx;
  details: TDetails;
};

/**
 * Error response type with nested error object.
 * Symmetric with SuccessResponse: { isSuccess: true, data } vs { isSuccess: false, error }
 */
export type ErrorResponse<
  TCode extends string = string,
  TCategory extends string = string,
  TCtx extends Record<string, unknown> = Record<string, {}>,
  TDetails extends Record<string, unknown> = Record<string, {}>,
> = {
  isSuccess: false;
  error: ErrorDetails<TCode, TCategory, TCtx, TDetails>;
};

/**
 * Unified API response as discriminated union.
 */
export type ApiResponse<
  TData,
  TCode extends string = string,
  TCategory extends string = string,
  TCtx extends Record<string, unknown> = Record<string, {}>,
  TDetails extends Record<string, unknown> = Record<string, {}>,
> = SuccessResponse<TData> | ErrorResponse<TCode, TCategory, TCtx, TDetails>;
