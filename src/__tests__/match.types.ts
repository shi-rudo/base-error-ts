import {
  StructuredError,
  defineErrors,
  detailsType,
  matchError,
  type CatalogError,
} from "../index.js";

const UserErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
  },
  RATE_LIMITED: { category: "RATE_LIMIT", retryable: true },
});
declare const userError: CatalogError<typeof UserErrors>;

// @ts-expect-error a code that the union does not contain is rejected next to a catch-all
matchError(userError, { USER_NOT_FUND: () => 1, _: () => 2 });

matchError(userError, {
  USER_NOT_FOUND: () => 1,
  RATE_LIMITED: () => 2,
  // @ts-expect-error a code that the union does not contain is rejected in a complete table
  USER_NOT_FUND: () => 3,
});

const withCatchAll: string | undefined = matchError(userError, {
  USER_NOT_FOUND: (error) => error.details?.userId,
  _: (error) => error.code,
});

const complete: number = matchError(userError, {
  USER_NOT_FOUND: () => 404,
  RATE_LIMITED: () => 429,
});

// @ts-expect-error without a catch-all, every code of the union needs a handler
matchError(userError, { USER_NOT_FOUND: () => 404 });

declare const wideError: StructuredError<string, string>;

const anyCode: number = matchError(wideError, {
  ANY_CODE: () => 1,
  _: () => 2,
});

const CatchAllCodeErrors = defineErrors({
  _: { category: "INTERNAL", retryable: false },
  RATE_LIMITED: { category: "RATE_LIMIT", retryable: true },
});
declare const catchAllCodeError: CatalogError<typeof CatchAllCodeErrors>;

// @ts-expect-error a union with the code _ cannot use matchError, because _ is the catch-all
matchError(catchAllCodeError, { _: () => 1 });

declare const underscorePrefixed: StructuredError<`_${string}`, string>;

const underscorePrefixedCode: number = matchError(underscorePrefixed, {
  _internal: () => 1,
  _: () => 2,
});

function statusWithCatchAll<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  return matchError(error, { USER_NOT_FOUND: () => 404, _: () => 500 });
}

function statusOfEveryCode<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  return matchError(error, {
    USER_NOT_FOUND: () => 404,
    RATE_LIMITED: () => 429,
  });
}

function statusOfAnyError<E extends StructuredError<string, string>>(
  error: E,
): number {
  return matchError(error, { _: () => 500 });
}

function misspelledInGeneric<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  // @ts-expect-error a code that the union does not contain is rejected in a generic caller
  return matchError(error, { USER_NOT_FUND: () => 404, _: () => 500 });
}

const HttpErrors = defineErrors({
  "404": { category: "NOT_FOUND", retryable: false },
  "500": { category: "INTERNAL", retryable: false },
});
declare const httpError: CatalogError<typeof HttpErrors>;

const numericKeyWithCatchAll: number = matchError(httpError, {
  404: () => 1,
  _: () => 2,
});

const numericKeysComplete: number = matchError(httpError, {
  404: () => 1,
  500: () => 2,
});

// @ts-expect-error a numeric key that names no code of the union is rejected
matchError(httpError, { 403: () => 1, _: () => 2 });

declare const dynamicTable: Record<string, () => number>;

// @ts-expect-error a table typed Record<string, …> names no code, so the compiler cannot check it against a closed union
matchError(userError, dynamicTable);

void UserErrors;
void HttpErrors;
void statusWithCatchAll;
void statusOfEveryCode;
void statusOfAnyError;
void misspelledInGeneric;
void underscorePrefixedCode;
void numericKeyWithCatchAll;
void numericKeysComplete;
void CatchAllCodeErrors;
void withCatchAll;
void complete;
void anyCode;
