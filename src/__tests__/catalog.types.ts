import {
  detailsType,
  defineErrors,
  type Catalog,
  type CatalogError,
  type CatalogErrorOf,
  type ErrorCatalogDefinition,
} from "../index.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Assert<T extends true> = T;

// @ts-expect-error catalogs must not be empty
defineErrors({});

// @ts-expect-error keys must not be empty
defineErrors({ "": { category: "INTERNAL", retryable: false } });

const symbolCode = Symbol("BROKEN");
// @ts-expect-error keys must be strings
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

const AuthzErrors = defineErrors(
  {
    not_a_member: { category: "FORBIDDEN", retryable: false },
    missing_role: {
      category: "FORBIDDEN",
      retryable: false,
      details: detailsType<{ role: string }>(),
      metadata: { httpStatus: 403 },
    },
  },
  { prefix: "restaurant.authz" },
);

type AuthzError = CatalogError<typeof AuthzErrors>;
type NotAMember = CatalogErrorOf<typeof AuthzErrors, "not_a_member">;
type MissingRole = CatalogErrorOf<typeof AuthzErrors, "missing_role">;

const notAMember = AuthzErrors.create.not_a_member("actor 42 is not a member");
const prefixedCode: "restaurant.authz.not_a_member" = notAMember.code;
const namedCode: "restaurant.authz.missing_role" =
  AuthzErrors.code.missing_role;
const prefixedCodes: readonly (
  "restaurant.authz.not_a_member" | "restaurant.authz.missing_role"
)[] = AuthzErrors.codes;
const authzErrorCode: AuthzError["code"] = "restaurant.authz.missing_role";
const notAMemberCode: NotAMember["code"] = "restaurant.authz.not_a_member";
const prefixedStatus: 403 = AuthzErrors.meta("restaurant.authz.missing_role")
  .metadata.httpStatus;
const metaOfCaught: "FORBIDDEN" = AuthzErrors.meta(notAMember.code).category;
type AuthzErrorIsNotAny = Assert<
  IsAny<AuthzError> extends false ? true : false
>;

void prefixedCode;
void namedCode;
void prefixedCodes;
void authzErrorCode;
void notAMemberCode;
void prefixedStatus;
void metaOfCaught;
void (null as unknown as AuthzErrorIsNotAny);

AuthzErrors.create.missing_role("actor 42 lacks a role", {
  details: { role: "owner" },
});

// @ts-expect-error details remain required for a prefixed definition that declares them
AuthzErrors.create.missing_role("actor 42 lacks a role");

// @ts-expect-error the full code is no key of create
void AuthzErrors.create["restaurant.authz.not_a_member"];

// @ts-expect-error meta takes the code, not the key
AuthzErrors.meta("not_a_member");

type ByCode = CatalogErrorOf<
  typeof AuthzErrors,
  // @ts-expect-error CatalogErrorOf takes the key, not the code
  "restaurant.authz.not_a_member"
>;
void (null as unknown as ByCode);

// @ts-expect-error the code namespace is immutable
AuthzErrors.code.not_a_member = "restaurant.authz.renamed";

if (AuthzErrors.is(caught, "missing_role")) {
  const narrowed: MissingRole = caught;
  const narrowedCode: "restaurant.authz.missing_role" = caught.code;
  const narrowedRole: string | undefined = caught.details?.role;
  void narrowed;
  void narrowedCode;
  void narrowedRole;
}

// @ts-expect-error is takes the key, not the code
AuthzErrors.is(caught, "restaurant.authz.missing_role");

declare const authzError: AuthzError;

const exhaustiveResult: string = AuthzErrors.match(authzError, {
  not_a_member: (error) => error.code,
  missing_role: (error) => error.details?.role ?? "unknown",
});
const catchAllResult: string | number = AuthzErrors.match(authzError, {
  missing_role: (error) => error.details?.role ?? "unknown",
  _: (error) => error.code.length,
});
const literalResult: 401 | 403 = AuthzErrors.match(authzError, {
  not_a_member: () => 401 as const,
  missing_role: () => 403 as const,
});
void exhaustiveResult;
void catchAllResult;
void literalResult;

declare const onlyMissingRole: MissingRole;
const partOfUnion: string | undefined = AuthzErrors.match(onlyMissingRole, {
  missing_role: (error) => error.details?.role,
});
void partOfUnion;

// @ts-expect-error every key needs a handler without a catch-all
AuthzErrors.match(authzError, { not_a_member: () => 1 });

// @ts-expect-error a key that the catalog does not define is rejected
AuthzErrors.match(authzError, { not_a_membr: () => 1, _: () => 2 });

const HttpErrors = defineErrors({
  "404": { category: "NOT_FOUND", retryable: false },
  "500": { category: "INTERNAL", retryable: false },
});
declare const httpError: CatalogError<typeof HttpErrors>;

const numericKeyMatch: number = HttpErrors.match(httpError, {
  404: () => 1,
  _: () => 2,
});
void numericKeyMatch;

// @ts-expect-error a numeric key that the catalog does not define is rejected
HttpErrors.match(httpError, { 403: () => 1, _: () => 2 });

AuthzErrors.match(authzError, {
  // @ts-expect-error handlers are named by key, not by code
  "restaurant.authz.not_a_member": () => 1,
  _: () => 2,
});

AuthzErrors.match(authzError, {
  not_a_member: (error) => {
    const narrowed: NotAMember = error;
    // @ts-expect-error each handler receives the error type of its key
    const otherKey: MissingRole = error;
    return [narrowed, otherKey];
  },
  _: () => 2,
});

const handlerOutsideTheUnion: string | undefined = AuthzErrors.match(
  onlyMissingRole,
  {
    not_a_member: () => "unreachable",
    missing_role: (error) => error.details?.role,
  },
);
void handlerOutsideTheUnion;

// @ts-expect-error match takes an error of this catalog
AuthzErrors.match(userNotFound, { _: () => 1 });

declare const anyAppError: AppError;
const matchedByCode: number = AppErrors.match(anyAppError, {
  USER_NOT_FOUND: (error) => error.details?.userId.length ?? 0,
  RATE_LIMITED: () => 0,
});
const unprefixedCodeMap: "USER_NOT_FOUND" = AppErrors.code.USER_NOT_FOUND;
void matchedByCode;
void unprefixedCodeMap;

const emptyOptions = defineErrors(
  { FAILURE: { category: "INTERNAL", retryable: false } },
  {},
);
const emptyOptionsCode: "FAILURE" = emptyOptions.create.FAILURE("failed").code;
const undefinedPrefix = defineErrors(
  { FAILURE: { category: "INTERNAL", retryable: false } },
  { prefix: undefined },
);
const undefinedPrefixCode: "FAILURE" =
  undefinedPrefix.create.FAILURE("failed").code;
const BILLING_PREFIX = "billing";
const reusedPrefix = defineErrors(reusableDefinition, {
  prefix: BILLING_PREFIX,
});
const reusedPrefixCode: "billing.FAILURE" =
  reusedPrefix.create.FAILURE("failed").code;
const annotatedCatalog: Catalog<typeof reusableDefinition> =
  defineErrors(reusableDefinition);
const annotatedPrefixedCatalog: Catalog<typeof reusableDefinition, "billing"> =
  reusedPrefix;
void emptyOptionsCode;
void undefinedPrefixCode;
void reusedPrefixCode;
void annotatedCatalog;
void annotatedPrefixedCatalog;

// @ts-expect-error a prefix must not be empty
defineErrors(reusableDefinition, { prefix: "" });

// @ts-expect-error a prefix must not end with the separator
defineErrors(reusableDefinition, { prefix: "restaurant.authz." });

// @ts-expect-error a prefix must not start with the separator
defineErrors(reusableDefinition, { prefix: ".restaurant" });

// @ts-expect-error a prefix must not contain an empty segment
defineErrors(reusableDefinition, { prefix: "restaurant..authz" });

declare const widenedPrefix: string;
// @ts-expect-error a widened prefix loses the literal codes
defineErrors(reusableDefinition, { prefix: widenedPrefix });

// @ts-expect-error unknown options are rejected
defineErrors(reusableDefinition, { prefx: "restaurant" });

// @ts-expect-error an empty catalog stays invalid with options
defineErrors({}, { prefix: "restaurant" });

defineErrors(
  { "storage.not_found": { category: "NOT_FOUND", retryable: false } },
  // @ts-expect-error with a prefix, a key must not contain a dot
  { prefix: "restaurant" },
);

const dottedKeyWithoutPrefix: "db.deadlock" = defineErrors({
  "db.deadlock": { category: "DEADLOCK", retryable: true },
}).code["db.deadlock"];
void dottedKeyWithoutPrefix;

const UnderscoreErrors = defineErrors({
  _: { category: "C", retryable: false },
  z: { category: "D", retryable: false },
});
declare const underscoreError: CatalogError<typeof UnderscoreErrors>;
// @ts-expect-error match refuses a catalog whose key _ is also the catch-all
UnderscoreErrors.match(underscoreError, { _: () => 1 });
