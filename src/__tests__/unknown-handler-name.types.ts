import {
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

void UserErrors;
void StorageErrors;
void (null as unknown as UnknownCodeNextToCatchAllNamesReason);
void (null as unknown as KnownCodeNamesNoReason);
void (null as unknown as UnknownCodeInCompleteTableNamesReason);
void (null as unknown as DynamicTableNamesReason);
void (null as unknown as UnknownCatalogKeyNamesReason);
void (null as unknown as UnknownClassKeyNamesReason);
