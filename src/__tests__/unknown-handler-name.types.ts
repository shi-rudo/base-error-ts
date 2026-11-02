import {
  StructuredError,
  defineErrorClassSet,
  defineErrors,
  matchErrorCode,
  type CatalogError,
} from "../index.js";

type Assert<T extends true> = T;

/**
 * True when the compiler names `Reason` in its error for a handler of this
 * type. `never` holds every type, but the compiler prints only "never".
 */
type NamesReason<Handler, Reason extends string> = [Handler] extends [never]
  ? false
  : Handler extends Reason
    ? true
    : false;

const UserErrors = defineErrors({
  USER_NOT_FOUND: { category: "NOT_FOUND", retryable: false },
  RATE_LIMITED: { category: "RATE_LIMIT", retryable: true },
});
type UserError = CatalogError<typeof UserErrors>;

type CasesNextToCatchAll = Parameters<
  typeof matchErrorCode<
    UserError,
    {
      USER_NOT_FOUND: () => number;
      USER_NOT_FUND: () => number;
      _: () => number;
    }
  >
>[1];

type UnknownCodeNextToCatchAllNamesReason = Assert<
  NamesReason<
    CasesNextToCatchAll["USER_NOT_FUND"],
    "matchErrorCode: USER_NOT_FUND is not a code of this error"
  >
>;

type KnownCodeNamesNoReason = Assert<
  NamesReason<CasesNextToCatchAll["USER_NOT_FOUND"], string> extends false
    ? true
    : false
>;

type CasesOfCompleteTable = Parameters<
  typeof matchErrorCode<
    UserError,
    {
      USER_NOT_FOUND: () => number;
      RATE_LIMITED: () => number;
      USER_NOT_FUND: () => number;
    }
  >
>[1];

type UnknownCodeInCompleteTableNamesReason = Assert<
  NamesReason<
    CasesOfCompleteTable["USER_NOT_FUND"],
    "matchErrorCode: USER_NOT_FUND is not a code of this error"
  >
>;

type CasesOfDynamicTable = Parameters<
  typeof matchErrorCode<UserError, Record<string, () => number>>
>[1];

type DynamicTableNamesReason = Assert<
  NamesReason<
    CasesOfDynamicTable["ANY_NAME"],
    `matchErrorCode: ${string} is not a code of this error`
  >
>;

type CatalogCases = Parameters<
  typeof UserErrors.match<
    UserError,
    {
      USER_NOT_FOUND: () => number;
      USER_NOT_FUND: () => number;
      _: () => number;
    }
  >
>[1];

type UnknownCatalogKeyNamesReason = Assert<
  NamesReason<
    CatalogCases["USER_NOT_FUND"],
    "match: USER_NOT_FUND is not a key of this catalog"
  >
>;

class FileError extends Error {}
class DatabaseError extends Error {}
const StorageErrors = defineErrorClassSet({ FileError, DatabaseError });

type ClassSetHandlers = Parameters<
  typeof StorageErrors.match<{
    FileError: () => number;
    DatabaseError: () => number;
    NetworkError: () => number;
  }>
>[1];

type UnknownClassKeyNamesReason = Assert<
  NamesReason<
    ClassSetHandlers["NetworkError"],
    "match: NetworkError is not a key of this error class set"
  >
>;

declare const userError: UserError;
declare const thrown: unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- these tests pin how the types treat any
type AnyHandler = any;
declare const anyHandler: AnyHandler;
declare const anyHandlerByString: Record<string, AnyHandler>;
declare const anyHandlerByNumber: Record<number, AnyHandler>;

declare const singleCodeError: StructuredError<"ONLY_CODE", string>;
const tableOfOneUnknownName = { USER_NOT_FUND: () => 1 };

// @ts-expect-error a table with only an unknown code is rejected without a catch-all
matchErrorCode(userError, { USER_NOT_FUND: () => 1 });

// @ts-expect-error a table with only an unknown code is rejected for a single code too
matchErrorCode(singleCodeError, { ONLY_CODD: () => 1 });

// @ts-expect-error a table with only a numeric unknown code is rejected
matchErrorCode(userError, { 404: () => 1 });

// @ts-expect-error a table in a variable with only an unknown code is rejected
matchErrorCode(userError, tableOfOneUnknownName);

// @ts-expect-error a table with only an unknown code and a handler typed any is rejected
matchErrorCode(userError, { USER_NOT_FUND: anyHandler });

// @ts-expect-error a table with only an unknown key is rejected without a catch-all
UserErrors.match(userError, { USER_NOT_FUND: () => 1 });

// @ts-expect-error a table with only a numeric unknown key is rejected
UserErrors.match(userError, { 404: () => 1 });

// @ts-expect-error a table in a variable with only an unknown key is rejected
UserErrors.match(userError, tableOfOneUnknownName);

// @ts-expect-error a table with only an unknown key and a handler typed any is rejected
UserErrors.match(userError, { USER_NOT_FUND: anyHandler });

type CasesOfOnlyUnknownCode = Parameters<
  typeof matchErrorCode<
    UserError,
    Record<never, never>,
    UserError["code"],
    "USER_NOT_FUND"
  >
>[1];

type OnlyUnknownCodeNamesReason = Assert<
  NamesReason<
    CasesOfOnlyUnknownCode["USER_NOT_FUND"],
    "matchErrorCode: USER_NOT_FUND is not a code of this error"
  >
>;

type CasesOfOnlyUnknownKey = Parameters<
  typeof UserErrors.match<UserError, Record<never, never>, "USER_NOT_FUND">
>[1];

type OnlyUnknownKeyNamesReason = Assert<
  NamesReason<
    CasesOfOnlyUnknownKey["USER_NOT_FUND"],
    "match: USER_NOT_FUND is not a key of this catalog"
  >
>;

declare const wideError: StructuredError<string, string>;
matchErrorCode(wideError, { ANY_NAME: () => 1 });

matchErrorCode(userError, {
  USER_NOT_FOUND: () => 1,
  // @ts-expect-error a handler typed any under an unknown code does not stand in for a missing code
  RATE_LIMITTED: anyHandler,
});

matchErrorCode(userError, {
  // @ts-expect-error a handler typed any under an unknown code is rejected next to a catch-all
  USER_NOT_FUND: anyHandler,
  _: () => 1,
});

matchErrorCode(userError, {
  // @ts-expect-error a handler typed any under a numeric key is rejected next to a catch-all
  404: anyHandler,
  _: () => 1,
});

// @ts-expect-error a table of handlers typed any names every string, so it does not pass for a closed union
matchErrorCode(userError, anyHandlerByString);

// @ts-expect-error a table of handlers typed any names every number, so it does not pass for a closed union
matchErrorCode(userError, anyHandlerByNumber);

matchErrorCode(userError, {
  USER_NOT_FOUND: anyHandler,
  RATE_LIMITED: anyHandler,
});

UserErrors.match(userError, {
  USER_NOT_FOUND: () => 1,
  // @ts-expect-error a handler typed any under an unknown key does not stand in for a missing key
  RATE_LIMITTED: anyHandler,
});

UserErrors.match(userError, {
  // @ts-expect-error a handler typed any under an unknown key is rejected next to a catch-all
  USER_NOT_FUND: anyHandler,
  _: () => 1,
});

UserErrors.match(userError, {
  // @ts-expect-error a handler typed any under a numeric key is rejected next to a catch-all
  404: anyHandler,
  _: () => 1,
});

// @ts-expect-error a table of handlers typed any names every string, so it does not pass for a catalog
UserErrors.match(userError, anyHandlerByString);

// @ts-expect-error a table of handlers typed any names every number, so it does not pass for a catalog
UserErrors.match(userError, anyHandlerByNumber);

UserErrors.match(userError, {
  USER_NOT_FOUND: anyHandler,
  RATE_LIMITED: anyHandler,
});

StorageErrors.match(thrown, {
  FileError: () => 1,
  DatabaseError: () => 2,
  // @ts-expect-error a handler typed any under an unknown key is rejected
  NetworkError: anyHandler,
});

StorageErrors.match(thrown, {
  FileError: anyHandler,
  DatabaseError: anyHandler,
});

void (null as unknown as OnlyUnknownCodeNamesReason);
void (null as unknown as OnlyUnknownKeyNamesReason);
void (null as unknown as UnknownCodeNextToCatchAllNamesReason);
void (null as unknown as KnownCodeNamesNoReason);
void (null as unknown as UnknownCodeInCompleteTableNamesReason);
void (null as unknown as DynamicTableNamesReason);
void (null as unknown as UnknownCatalogKeyNamesReason);
void (null as unknown as UnknownClassKeyNamesReason);
