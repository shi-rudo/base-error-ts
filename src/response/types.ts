/**
 * Core types for API responses with discriminated unions.
 */

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
 * Error response type with configurable context shape.
 */
export type ErrorResponse<
  TCode extends string = string,
  TCategory extends string = string,
  TCtx extends Record<string, unknown> = Record<string, unknown>,
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> = {
  isSuccess: false;
  code: TCode;
  category: TCategory;
  retryable: boolean;
  traceId?: string;
  ctx: TCtx;
  details: TDetails;
};

/**
 * Unified API response as discriminated union.
 */
export type ApiResponse<
  TData,
  TCode extends string = string,
  TCategory extends string = string,
  TCtx extends Record<string, unknown> = Record<string, unknown>,
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> = SuccessResponse<TData> | ErrorResponse<TCode, TCategory, TCtx, TDetails>;
