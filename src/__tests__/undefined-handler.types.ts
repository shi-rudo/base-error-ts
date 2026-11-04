import { defineErrors, matchErrorCode, type CatalogError } from "../index.js";

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
declare const userError: UserError;

type OneUndefinedHandler = {
  USER_NOT_FOUND: () => number;
  RATE_LIMITED: undefined;
};
declare const oneUndefinedHandler: OneUndefinedHandler;

type OneMaybeHandler = {
  USER_NOT_FOUND: () => number;
  RATE_LIMITED: (() => number) | undefined;
};
declare const oneMaybeHandler: OneMaybeHandler;

type OptionalHandlers = {
  USER_NOT_FOUND?: () => number;
  RATE_LIMITED?: () => number;
};
declare const optionalHandlers: OptionalHandlers;

type UndefinedCatchAll = {
  USER_NOT_FOUND: () => number;
  _: undefined;
};
declare const undefinedCatchAll: UndefinedCatchAll;

type CasesWithUndefinedHandler = Parameters<
  typeof matchErrorCode<
    UserError,
    OneUndefinedHandler,
    UserError["code"],
    keyof OneUndefinedHandler
  >
>[1];

type UndefinedHandlerNamesReason = Assert<
  NamesReason<
    CasesWithUndefinedHandler["RATE_LIMITED"],
    "matchErrorCode: the handler of RATE_LIMITED can be undefined"
  >
>;

type ValidHandlerNextToUndefinedNamesNoReason = Assert<
  NamesReason<CasesWithUndefinedHandler["USER_NOT_FOUND"], string> extends false
    ? true
    : false
>;

type CasesWithMaybeHandler = Parameters<
  typeof matchErrorCode<
    UserError,
    OneMaybeHandler,
    UserError["code"],
    keyof OneMaybeHandler
  >
>[1];

type MaybeHandlerNamesReason = Assert<
  NamesReason<
    CasesWithMaybeHandler["RATE_LIMITED"],
    "matchErrorCode: the handler of RATE_LIMITED can be undefined"
  >
>;

type CatalogCasesWithUndefinedHandler = Parameters<
  typeof UserErrors.match<
    UserError,
    OneUndefinedHandler,
    keyof OneUndefinedHandler
  >
>[1];

type UndefinedCatalogHandlerNamesReason = Assert<
  NamesReason<
    CatalogCasesWithUndefinedHandler["RATE_LIMITED"],
    "match: the handler of RATE_LIMITED can be undefined"
  >
>;

type ValidCatalogHandlerNextToUndefinedNamesNoReason = Assert<
  NamesReason<
    CatalogCasesWithUndefinedHandler["USER_NOT_FOUND"],
    string
  > extends false
    ? true
    : false
>;

matchErrorCode<UserError, OneUndefinedHandler>(
  userError,
  // @ts-expect-error explicit type arguments do not pass a handler with the value undefined
  oneUndefinedHandler,
);

matchErrorCode<UserError, OneMaybeHandler>(
  userError,
  // @ts-expect-error explicit type arguments do not pass a handler that can be undefined
  oneMaybeHandler,
);

matchErrorCode<UserError, OptionalHandlers>(
  userError,
  // @ts-expect-error explicit type arguments do not pass an optional handler
  optionalHandlers,
);

matchErrorCode<UserError, UndefinedCatchAll>(
  userError,
  // @ts-expect-error explicit type arguments do not pass a catch-all with the value undefined
  undefinedCatchAll,
);

UserErrors.match<UserError, OneUndefinedHandler>(
  userError,
  // @ts-expect-error explicit type arguments do not pass a handler with the value undefined
  oneUndefinedHandler,
);

UserErrors.match<UserError, OneMaybeHandler>(
  userError,
  // @ts-expect-error explicit type arguments do not pass a handler that can be undefined
  oneMaybeHandler,
);

UserErrors.match<UserError, OptionalHandlers>(
  userError,
  // @ts-expect-error explicit type arguments do not pass an optional handler
  optionalHandlers,
);

UserErrors.match<UserError, UndefinedCatchAll>(
  userError,
  // @ts-expect-error explicit type arguments do not pass a catch-all with the value undefined
  undefinedCatchAll,
);

void (null as unknown as UndefinedHandlerNamesReason);
void (null as unknown as ValidHandlerNextToUndefinedNamesNoReason);
void (null as unknown as MaybeHandlerNamesReason);
void (null as unknown as UndefinedCatalogHandlerNamesReason);
void (null as unknown as ValidCatalogHandlerNextToUndefinedNamesNoReason);
