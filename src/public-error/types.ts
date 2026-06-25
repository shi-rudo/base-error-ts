import type { LocalizedMessageSet } from "./LocalizedMessageSet.js";

/**
 * A single, vetted field-level fault. The common validation case made
 * first-class so it need not be smuggled through ad-hoc extensions. `field` is a
 * client-meaningful path, `code` a stable, localizable reason (never a raw
 * message). RFC 9457 does not define this member; it is a documented extension
 * (`fields`) the transport adapter writes by default.
 */
export type FieldFault = {
  readonly field: string;
  readonly code: string;
};

/**
 * The single source of truth for one public error code. One registration feeds
 * all three stages: curation ({@link project}), localization ({@link localize}),
 * and transport ({@link toProblem}). There is no second adapter map.
 *
 * Curation is a security boundary: nothing of the internal error reaches a view
 * automatically. `category`/`retryable` here are the *public* values, declared
 * by the registrant, deliberately distinct from the technical
 * `StructuredError.category`/`retryable` (which may reveal infrastructure, e.g.
 * a `DEADLOCK`). The internal taxonomy is never the wire taxonomy, exactly as
 * `publicCode` is distinct from the internal `code`.
 *
 * `userMessages` is optional: an app that localizes entirely on the client omits
 * it and still gets a machine-complete view and problem body.
 */
export type PublicErrorDescriptor<
  TError = unknown,
  TDetails = never,
  TPublicCode extends string = string,
> = {
  /** Stable public code for the wire. */
  readonly publicCode: TPublicCode;
  /** Transport status (HTTP / RFC 9457). Read only by {@link toProblem}. */
  readonly status: number;
  /** Optional RFC 9457 problem type URI (ideally dereferences to docs). */
  readonly type?: string;
  /**
   * Optional static, developer-facing summary of the problem type (RFC 9457
   * `title`). Audience is the API consumer reading the JSON, not the end user;
   * stable per code, not localized. Distinct from {@link userMessages}, which is
   * the localized end-user text. `toProblem` emits a localized message as the
   * title when present, otherwise this static one.
   */
  readonly title?: string;
  /**
   * Curated public category. Never the internal `StructuredError.category`. An
   * advisory coarse grouping for telemetry and soft UX, NOT an exhaustive branch
   * key: branch on `publicCode`, which is the typed contract. Declare
   * `categories` on the catalog to enforce a closed vocabulary and catch drift.
   */
  readonly category?: string;
  /** Declared retryability hint; overridable per occurrence by {@link projectRetryable}. */
  readonly retryable?: boolean;
  /** Optional client-safe localized messages. Omit for client-side i18n. */
  readonly userMessages?: LocalizedMessageSet;
  /** Explicit projection of a vetted, typed subset onto `details`. Never spreads the error. */
  readonly projectDetails?: (error: TError) => TDetails;
  /** Optional per-occurrence retryability, falling back to {@link retryable} if it throws. */
  readonly projectRetryable?: (error: TError) => boolean;
  /**
   * Optional per-occurrence retry delay in whole seconds, read from the error
   * (e.g. a rate limiter's window). Surfaced as the view's `retryAfter` and, by
   * `toProblem`, as the HTTP `Retry-After` header. A non-integer/negative result
   * or a throw is ignored.
   */
  readonly projectRetryAfter?: (error: TError) => number | undefined;
  /** Optional projection of vetted field faults. Validation's common path. */
  readonly projectFields?: (error: TError) => readonly FieldFault[];
};

/**
 * The curated, transport-neutral, message-free machine view. Carries public
 * meaning only: a `publicCode`, optional curated `category`/`retryable`, and
 * explicitly projected `details`/`fields`. No status (transport's job), no
 * message (localization's job). The output of {@link project}, total over
 * `unknown`.
 */
export type PublicError<TDetails = unknown, TCode extends string = string> = {
  readonly code: TCode;
  /** Advisory coarse grouping (see the descriptor). Branch on `code`, not this. */
  readonly category?: string;
  readonly retryable?: boolean;
  /** Neutral retry-delay hint in whole seconds (e.g. for a 429/503 occurrence). */
  readonly retryAfter?: number;
  readonly details?: TDetails;
  readonly fields?: readonly FieldFault[];
};

/** A {@link PublicError} after the optional {@link localize} stage attached human text. */
export type LocalizedPublicError<
  TDetails = unknown,
  TCode extends string = string,
> = PublicError<TDetails, TCode> & {
  readonly message: string;
  readonly locale: string;
};

/**
 * How the `details`/`fields` projection went: `none` when the descriptor has no
 * projector, `succeeded` when one ran cleanly, `failed` when one threw (the view
 * still stands without that member). Surfaced for debugging a silently missing
 * `details`.
 */
export type ProjectionStatus = "none" | "succeeded" | "failed";

/**
 * What a `project` did, for fire-and-forget observability: whether the error
 * matched a descriptor (and how) or fell back, plus the projection status. A
 * fallback caused by a throwing matcher is `matcher_failed`, distinct from a
 * genuine `no_match`.
 */
export type ProjectionOutcome =
  | {
      readonly kind: "matched";
      readonly via: "code" | "predicate";
      readonly projection: ProjectionStatus;
    }
  | {
      readonly kind: "fallback";
      readonly reason: "no_match" | "matcher_failed";
      readonly projection: ProjectionStatus;
    };

/**
 * Fire-and-forget observer invoked once per {@link project}. The central place
 * to log the technical error alongside the emitted public code and outcome. If
 * it throws, the projector swallows it: telemetry must never break totality.
 */
export type OnProject = (
  error: unknown,
  view: PublicError,
  outcome: ProjectionOutcome,
) => void;
