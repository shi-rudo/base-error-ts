import { isRetryAfterSeconds } from "../utils/problem-validation.js";
import type { PublicErrorCatalog } from "./PublicErrorCatalog.js";
import type {
  FieldFault,
  ProjectionOutcome,
  ProjectionStatus,
  PublicError,
  PublicErrorDescriptor,
} from "./types.js";

/**
 * Stage 1: curation as a security boundary. Turns an unknown technical error
 * into a curated, transport-neutral, message-free {@link PublicError}. Total
 * over `unknown`: an unmatched error degrades to the catalog's fallback rather
 * than leaking or throwing. Nothing of the error reaches the view automatically;
 * only declared (`category`/`retryable`) or explicitly projected
 * (`details`/`fields`) values appear, and a throwing projector is contained.
 *
 * Invokes the catalog's {@link OnProject} observer once, so a single place can
 * log the technical error alongside the emitted code and outcome.
 */
export function project<TPublicCode extends string>(
  catalog: PublicErrorCatalog<TPublicCode>,
  error: unknown,
): PublicError<unknown, TPublicCode> {
  const resolution = catalog.resolve(error);
  const descriptor = resolution.found
    ? resolution.descriptor
    : catalog.fallback;
  const { view, projection } = projectCore(descriptor, error);

  const outcome: ProjectionOutcome = resolution.found
    ? { kind: "matched", via: resolution.via, projection }
    : {
        kind: "fallback",
        reason: resolution.matcherThrew ? "matcher_failed" : "no_match",
        projection,
      };
  catalog.observeProjection(error, view, outcome);

  return view as PublicError<unknown, TPublicCode>;
}

/**
 * Catalog-free projection against a single descriptor the caller already chose.
 * The same curation rules as {@link project}, without resolution or the
 * observer: use this when you bring your own matching, or have no catalog.
 */
export function projectWithDescriptor<TCode extends string>(
  descriptor: PublicErrorDescriptor<never, unknown, TCode>,
  error: unknown,
): PublicError<unknown, TCode> {
  return projectCore(descriptor, error).view as PublicError<unknown, TCode>;
}

function projectCore(
  descriptor: PublicErrorDescriptor<never, unknown, string>,
  error: unknown,
): { view: PublicError; projection: ProjectionStatus } {
  const retryable = resolveRetryable(descriptor, error);
  const retryAfter = resolveRetryAfter(descriptor, error);

  let failed = false;
  const onThrow = (): void => {
    failed = true;
  };
  const details =
    descriptor.projectDetails === undefined
      ? undefined
      : safeCall(descriptor.projectDetails, error, onThrow);
  const fields =
    descriptor.projectFields === undefined
      ? undefined
      : safeFields(descriptor.projectFields, error, onThrow);

  const hasProjector =
    descriptor.projectDetails !== undefined ||
    descriptor.projectFields !== undefined;
  const projection: ProjectionStatus = !hasProjector
    ? "none"
    : failed
      ? "failed"
      : "succeeded";

  const view: PublicError = Object.freeze({
    code: descriptor.publicCode,
    ...(descriptor.category !== undefined && { category: descriptor.category }),
    ...(retryable !== undefined && { retryable }),
    ...(retryAfter !== undefined && { retryAfter }),
    ...(details !== undefined && { details }),
    ...(fields !== undefined && fields.length > 0 && { fields }),
  });
  return { view, projection };
}

function resolveRetryable(
  descriptor: PublicErrorDescriptor<never, unknown, string>,
  error: unknown,
): boolean | undefined {
  if (descriptor.projectRetryable !== undefined) {
    try {
      const projected = descriptor.projectRetryable(error as never);
      if (typeof projected === "boolean") return projected;
    } catch {
      // Fall through to the declared default; totality must hold.
    }
  }
  return descriptor.retryable;
}

function resolveRetryAfter(
  descriptor: PublicErrorDescriptor<never, unknown, string>,
  error: unknown,
): number | undefined {
  if (descriptor.projectRetryAfter === undefined) return undefined;
  try {
    const seconds = descriptor.projectRetryAfter(error as never);
    return isRetryAfterSeconds(seconds) ? seconds : undefined;
  } catch {
    // A retry hint must never break projection totality.
    return undefined;
  }
}

function safeCall(
  fn: (error: never) => unknown,
  error: unknown,
  onThrow: () => void,
): unknown {
  try {
    return fn(error as never);
  } catch {
    onThrow();
    return undefined;
  }
}

function safeFields(
  fn: (error: never) => readonly FieldFault[],
  error: unknown,
  onThrow: () => void,
): readonly FieldFault[] | undefined {
  try {
    const fields = fn(error as never);
    // A non-array or a malformed entry is a projector bug, not "no faults":
    // drop the member and mark the projection failed for telemetry.
    if (!Array.isArray(fields) || !fields.every(isFieldFault)) {
      onThrow();
      return undefined;
    }
    return fields;
  } catch {
    onThrow();
    return undefined;
  }
}

function isFieldFault(value: unknown): value is FieldFault {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FieldFault).field === "string" &&
    typeof (value as FieldFault).code === "string"
  );
}
