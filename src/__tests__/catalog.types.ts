import {
  detailsType,
  defineErrors,
  type CatalogError,
  type CatalogErrorOf,
  type ErrorCatalogDefinition,
} from "../index.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Assert<T extends true> = T;

// @ts-expect-error catalogs must not be empty
defineErrors({});

// @ts-expect-error error codes must not be empty
defineErrors({ "": { category: "INTERNAL", retryable: false } });

const symbolCode = Symbol("BROKEN");
// @ts-expect-error catalog codes must be strings
defineErrors({
  [symbolCode]: { category: "INTERNAL", retryable: false },
});

declare const widenedDefinition: ErrorCatalogDefinition;
// @ts-expect-error widened definitions lose the finite code set
defineErrors(widenedDefinition);

const reusableDefinition = {
  FAILURE: { category: "INTERNAL", retryable: false },
} satisfies ErrorCatalogDefinition;
defineErrors(reusableDefinition);

declare const caught: unknown;

const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
    metadata: { httpStatus: 404, transport: "http" },
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
  },
});

type AppError = CatalogError<typeof AppErrors>;
type UserNotFound = CatalogErrorOf<typeof AppErrors, "USER_NOT_FOUND">;

const userNotFound = AppErrors.create.USER_NOT_FOUND("missing", {
  details: { userId: "123" },
});
const appError: AppError = userNotFound;
const specificError: UserNotFound = userNotFound;
const code: "USER_NOT_FOUND" = specificError.code;
const category: "NOT_FOUND" = specificError.category;
const userId: string | undefined = specificError.details?.userId;
const httpStatus: 404 = AppErrors.meta("USER_NOT_FOUND").metadata.httpStatus;
const codes: readonly ("USER_NOT_FOUND" | "RATE_LIMITED")[] = AppErrors.codes;
type AppErrorIsNotAny = Assert<IsAny<AppError> extends false ? true : false>;

void appError;
void code;
void category;
void userId;
void httpStatus;
void codes;
void (null as unknown as AppErrorIsNotAny);

AppErrors.create.RATE_LIMITED("limited", { cause: new Error("network") });

// @ts-expect-error codes is immutable
AppErrors.codes.push("RATE_LIMITED");

// @ts-expect-error metadata is absent when the definition declares none
void AppErrors.meta("RATE_LIMITED").metadata;

// @ts-expect-error details are not accepted when the definition declares none
AppErrors.create.RATE_LIMITED("limited", { details: {} });

// @ts-expect-error factories live exclusively under create in v7
AppErrors.USER_NOT_FOUND("missing", { details: { userId: "123" } });

// @ts-expect-error unknown codes cannot be extracted
type UnknownError = CatalogErrorOf<typeof AppErrors, "UNKNOWN">;
void (null as unknown as UnknownError);

// @ts-expect-error details remain required for definitions that declare them
AppErrors.create.USER_NOT_FOUND("missing");

// @ts-expect-error details retain their per-code shape
AppErrors.create.USER_NOT_FOUND("missing", { details: { id: "123" } });

if (AppErrors.is(caught)) {
  const narrowed: AppError = caught;
  void narrowed;
}

if (AppErrors.is(caught, "USER_NOT_FOUND")) {
  const narrowed: UserNotFound = caught;
  const narrowedUserId: string | undefined = caught.details?.userId;
  void narrowed;
  void narrowedUserId;
}

// @ts-expect-error only declared catalog codes are accepted
AppErrors.is(caught, "UNKNOWN");

// @ts-expect-error metadata must be JSON-safe
defineErrors({
  INVALID_METADATA: {
    category: "INTERNAL",
    retryable: false,
    metadata: { callback: () => "invalid" },
  },
});

// @ts-expect-error redaction policies reject unknown fields
defineErrors({
  INVALID_REDACTION: {
    category: "INTERNAL",
    retryable: false,
    redaction: { mode: "deny", keys: ["secret"], unexpected: true },
  },
});

// @ts-expect-error v7 moves transport metadata under metadata
defineErrors({
  OLD_METADATA: { category: "INTERNAL", retryable: false, httpStatus: 500 },
});

// @ts-expect-error v7 details declarations use detailsType<T>()
defineErrors({
  OLD_DETAILS: {
    category: "INTERNAL",
    retryable: false,
    details: {} as { value: string },
  },
});
