/**
 * Type-safe builder for error responses.
 */

import type { ErrorResponse, LocalizedMessage } from "./types.js";

/** Internal state tracking for the builder */
type BuilderState<
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
 * Type-safe builder for error responses.
 *
 * Each method returns a new builder with an updated type that reflects
 * the fields that have been set. The final `build()` call returns an
 * ErrorResponse with the exact shape you've configured.
 */
export class ErrorResponseBuilder<
  TCode extends string,
  TCategory extends string,
  TCtx extends Record<string, unknown>,
  TDetails extends Record<string, unknown>,
> {
  private readonly state: BuilderState<TCode, TCategory, TCtx, TDetails>;

  /** @internal Use errorResponse() factory function instead */
  constructor(state: BuilderState<TCode, TCategory, TCtx, TDetails>) {
    this.state = state;
  }

  /**
   * Set the HTTP status code.
   * @param code - HTTP status code (e.g., 404, 500)
   */
  httpStatus(
    code: number,
  ): ErrorResponseBuilder<
    TCode,
    TCategory,
    TCtx & { httpStatusCode: number },
    TDetails
  > {
    return new ErrorResponseBuilder({
      ...this.state,
      ctx: { ...this.state.ctx, httpStatusCode: code },
    });
  }

  /**
   * Set the technical error message.
   * @param msg - Technical message for logs/debugging
   */
  message(
    msg: string,
  ): ErrorResponseBuilder<
    TCode,
    TCategory,
    TCtx & { message: string },
    TDetails
  > {
    return new ErrorResponseBuilder({
      ...this.state,
      ctx: { ...this.state.ctx, message: msg },
    });
  }

  /**
   * Set the localized message for client display.
   * @param locale - BCP 47 locale code (e.g., "en", "de")
   * @param msg - Localized message text
   */
  localized(
    locale: string,
    msg: string,
  ): ErrorResponseBuilder<
    TCode,
    TCategory,
    TCtx & { messageLocalized: LocalizedMessage },
    TDetails
  > {
    return new ErrorResponseBuilder({
      ...this.state,
      ctx: { ...this.state.ctx, messageLocalized: { locale, message: msg } },
    });
  }

  /**
   * Set the trace ID for distributed tracing.
   * @param id - Trace ID
   */
  traceId(id: string): ErrorResponseBuilder<TCode, TCategory, TCtx, TDetails> {
    return new ErrorResponseBuilder({
      ...this.state,
      traceId: id,
    });
  }

  /**
   * Set additional error details.
   * @param details - Structured details object
   */
  details<TNewDetails extends Record<string, unknown>>(
    details: TNewDetails,
  ): ErrorResponseBuilder<TCode, TCategory, TCtx, TNewDetails> {
    return new ErrorResponseBuilder({
      ...this.state,
      details,
    });
  }

  /**
   * Add custom context fields.
   * @param ctx - Additional context fields to merge
   */
  withCtx<TExtra extends Record<string, unknown>>(
    ctx: TExtra,
  ): ErrorResponseBuilder<TCode, TCategory, TCtx & TExtra, TDetails> {
    return new ErrorResponseBuilder({
      ...this.state,
      ctx: { ...this.state.ctx, ...ctx },
    });
  }

  /**
   * Build the final error response.
   * @returns ErrorResponse with exact type based on configured fields
   */
  build(): ErrorResponse<TCode, TCategory, TCtx, TDetails> {
    return {
      isSuccess: false,
      error: {
        code: this.state.code,
        category: this.state.category,
        retryable: this.state.retryable,
        ...(this.state.traceId !== undefined && {
          traceId: this.state.traceId,
        }),
        ctx: this.state.ctx,
        details: this.state.details,
      },
    };
  }
}
