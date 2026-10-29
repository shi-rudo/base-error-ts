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

void UserErrors;
void CatchAllCodeErrors;
void withCatchAll;
void complete;
void anyCode;
