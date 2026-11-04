import {
  StructuredError,
  defineErrors,
  detailsType,
  matchErrorCode,
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
matchErrorCode(userError, { USER_NOT_FUND: () => 1, _: () => 2 });

declare const maybeHandler: (() => number) | undefined;
const undefinedHandlers = {
  USER_NOT_FOUND: undefined,
  RATE_LIMITED: undefined,
};

// @ts-expect-error a handler with the value undefined does not count as a handler
matchErrorCode(userError, undefinedHandlers);

// @ts-expect-error a handler with the value undefined does not route to the catch-all
matchErrorCode(userError, { USER_NOT_FOUND: undefined, _: () => 1 });

// @ts-expect-error a handler that can be undefined does not route to the catch-all
matchErrorCode(userError, { USER_NOT_FOUND: maybeHandler, _: () => 1 });

// @ts-expect-error a catch-all that can be undefined leaves a code without a handler
matchErrorCode(userError, { USER_NOT_FOUND: () => 1, _: maybeHandler });

const completeTableWithUndefinedCatchAll = {
  USER_NOT_FOUND: () => 1,
  RATE_LIMITED: () => 2,
  _: undefined,
};

// @ts-expect-error a catch-all with the value undefined is rejected in a complete table too
matchErrorCode(userError, completeTableWithUndefinedCatchAll);

matchErrorCode(userError, {
  USER_NOT_FOUND: maybeHandler ?? (() => 1),
  _: () => 2,
});

matchErrorCode(userError, {
  USER_NOT_FOUND: () => 1,
  RATE_LIMITED: () => 2,
  // @ts-expect-error a code that the union does not contain is rejected in a complete table
  USER_NOT_FUND: () => 3,
});

const withCatchAll: string | undefined = matchErrorCode(userError, {
  USER_NOT_FOUND: (error) => error.details?.userId,
  _: (error) => error.code,
});

const restCode: "RATE_LIMITED" = matchErrorCode(userError, {
  USER_NOT_FOUND: () => "RATE_LIMITED" as const,
  _: (error) => error.code,
});

matchErrorCode(userError, {
  USER_NOT_FOUND: () => false,
  // @ts-expect-error the catch-all never receives a code that has a handler
  _: (error) => error.code === "USER_NOT_FOUND",
});

const restOfCompleteTable: number = matchErrorCode(userError, {
  USER_NOT_FOUND: () => 404,
  RATE_LIMITED: () => 429,
  _: () => 500,
});

const complete: number = matchErrorCode(userError, {
  USER_NOT_FOUND: () => 404,
  RATE_LIMITED: () => 429,
});

// @ts-expect-error without a catch-all, every code of the union needs a handler
matchErrorCode(userError, { USER_NOT_FOUND: () => 404 });

declare const wideError: StructuredError<string, string>;

const anyCode: number = matchErrorCode(wideError, {
  ANY_CODE: () => 1,
  _: () => 2,
});

const restOfWideCode: string = matchErrorCode(wideError, {
  ANY_CODE: () => "any",
  _: (error) => error.code,
});

const CatchAllCodeErrors = defineErrors({
  _: { category: "INTERNAL", retryable: false },
  RATE_LIMITED: { category: "RATE_LIMIT", retryable: true },
});
declare const catchAllCodeError: CatalogError<typeof CatchAllCodeErrors>;

// @ts-expect-error a union with the code _ cannot name a handler next to _, because _ is the catch-all
matchErrorCode(catchAllCodeError, { RATE_LIMITED: () => 1, _: () => 2 });

// @ts-expect-error a union with the code _ cannot name a handler without _ either
matchErrorCode(catchAllCodeError, { RATE_LIMITED: () => 1 });

const catchAllOnly: number = matchErrorCode(catchAllCodeError, { _: () => 1 });

declare const underscorePrefixed: StructuredError<`_${string}`, string>;

const underscorePrefixedCode: number = matchErrorCode(underscorePrefixed, {
  _internal: () => 1,
  _: () => 2,
});

function statusWithCatchAll<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  return matchErrorCode(error, { USER_NOT_FOUND: () => 404, _: () => 500 });
}

function statusOfEveryCode<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  return matchErrorCode(error, {
    USER_NOT_FOUND: () => 404,
    RATE_LIMITED: () => 429,
  });
}

function statusOfCatchAllOnly<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  return matchErrorCode(error, { _: () => 500 });
}

function detailsFromHandlerParameter<E extends CatalogError<typeof UserErrors>>(
  error: E,
): string | undefined {
  return matchErrorCode(error, {
    USER_NOT_FOUND: (e) => e.details?.userId,
    RATE_LIMITED: (e) => (e.retryable ? "retry" : undefined),
  });
}

function codeFromParametersNextToCatchAll<
  E extends CatalogError<typeof UserErrors>,
>(error: E): string {
  return matchErrorCode(error, {
    USER_NOT_FOUND: (e) => e.code,
    _: (e) => e.code,
  });
}

const DetailsOfEachCode = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
    details: detailsType<{ retryAfter: number }>(),
  },
});
type DetailsOfEachCodeError = CatalogError<typeof DetailsOfEachCode>;

function detailsOfEachCaseInGeneric<E extends DetailsOfEachCodeError>(
  error: E,
): string | number | undefined {
  return matchErrorCode(error, {
    USER_NOT_FOUND: (e) => e.details?.userId,
    RATE_LIMITED: (e) => e.details?.retryAfter,
  });
}

function memberOfCaseInGeneric<E extends DetailsOfEachCodeError>(
  error: E,
): string | undefined {
  const userIdOf = (
    notFound: Extract<DetailsOfEachCodeError, { code: "USER_NOT_FOUND" }>,
  ): string | undefined => notFound.details?.userId;
  return matchErrorCode(error, {
    USER_NOT_FOUND: userIdOf,
    _: () => undefined,
  });
}

function codeOfOtherCaseInGeneric<E extends DetailsOfEachCodeError>(
  error: E,
): boolean {
  return matchErrorCode(error, {
    USER_NOT_FOUND: () => false,
    // @ts-expect-error a handler in a generic caller never receives the code of another case
    RATE_LIMITED: (e) => e.code === "USER_NOT_FOUND",
  });
}

function completeTableOfClosedBareCodeVariable<Code extends "A" | "B">(
  error: StructuredError<Code, string>,
): number {
  const known: StructuredError<"A" | "B", string> = error;
  return matchErrorCode(known, { A: () => 1, B: () => 2 });
}

function catchAllParameterOfBareCode<Code extends string>(
  error: StructuredError<Code, string>,
): void {
  // @ts-expect-error a catch-all that reads its parameter does not compile for a code typed by a bare type parameter
  matchErrorCode(error, { _: (e) => e.code });
}

function missingCodeInGeneric<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  // @ts-expect-error a missing code is rejected in a generic caller
  return matchErrorCode(error, { USER_NOT_FOUND: () => 404 });
}

function wrongParameterInGeneric<E extends CatalogError<typeof UserErrors>>(
  error: E,
): void {
  matchErrorCode(error, {
    // @ts-expect-error a handler with a wrong parameter type is rejected in a generic caller
    USER_NOT_FOUND: (e: number) => e,
    _: () => 500,
  });
}

function catchAllParameterOfAnyError<E extends StructuredError<string, string>>(
  error: E,
): void {
  // @ts-expect-error a catch-all that reads its parameter does not compile for a constraint that names every string
  matchErrorCode(error, { _: (e) => e.code });
}

function catchAllParameterOfWideVariable<
  E extends StructuredError<string, string>,
>(error: E): string {
  const wide: StructuredError<string, string> = error;
  return matchErrorCode(wide, { _: (e) => e.code });
}

function statusOfAnyError<E extends StructuredError<string, string>>(
  error: E,
): number {
  return matchErrorCode(error, { _: () => 500 });
}

function misspelledInGeneric<E extends CatalogError<typeof UserErrors>>(
  error: E,
): number {
  // @ts-expect-error a code that the union does not contain is rejected in a generic caller
  return matchErrorCode(error, { USER_NOT_FUND: () => 404, _: () => 500 });
}

function statusOfBareCode<Code extends string>(
  error: StructuredError<Code, string>,
): number {
  return matchErrorCode(error, { _: () => 500 });
}

function namedHandlerOfBareCode<Code extends string>(
  error: StructuredError<Code, string>,
): number {
  // @ts-expect-error a code typed by a bare type parameter names no code, so a named handler cannot be checked
  return matchErrorCode(error, { USER_NOT_FOUND: () => 404, _: () => 500 });
}

function statusOfAnnotatedCode<Code extends string>(
  error: StructuredError<Code, string>,
): number {
  const wide: StructuredError<string, string> = error;
  return matchErrorCode(wide, { USER_NOT_FOUND: () => 404, _: () => 500 });
}

declare const brandedCodeError: StructuredError<
  string & { readonly __brand: "ErrorCode" },
  string
>;

const brandedCodeWithCatchAll: number = matchErrorCode(brandedCodeError, {
  SOME_CODE: () => 1,
  _: () => 2,
});

type CodeBrand = { readonly __brand: "ErrorCode" };
declare const brandedLiteralsError:
  | StructuredError<"A" & CodeBrand, string>
  | StructuredError<"B" & CodeBrand, string>;

const brandedLiteralsComplete: number = matchErrorCode(brandedLiteralsError, {
  A: () => 1,
  B: () => 2,
});

const brandedLiteralsCatchAll: number = matchErrorCode(brandedLiteralsError, {
  _: () => 2,
});

declare const brandedCodeB: "B" & CodeBrand;

const restOfBrandedLiterals: "B" & CodeBrand = matchErrorCode(
  brandedLiteralsError,
  { A: () => brandedCodeB, _: (error) => error.code },
);

enum CardCode {
  Declined = "DECLINED",
}
enum BankCode {
  Refused = "REFUSED",
}
declare const paymentFailure:
  StructuredError<CardCode, string> | StructuredError<BankCode, string>;

const codeOfEachEnum: CardCode | BankCode = matchErrorCode(paymentFailure, {
  DECLINED: (error): CardCode => error.code,
  REFUSED: (error): BankCode => error.code,
});

const restOfTwoEnums: CardCode = matchErrorCode(paymentFailure, {
  REFUSED: (): CardCode => CardCode.Declined,
  _: (error) => error.code,
});

// @ts-expect-error a union of two enums needs a handler for the code of the second enum
matchErrorCode(paymentFailure, { DECLINED: () => 1 });

// @ts-expect-error a union of two enums needs a handler for the code of the first enum
matchErrorCode(paymentFailure, { REFUSED: () => 1 });

declare const brandedAndTwoLiterals:
  | StructuredError<"A" & CodeBrand, string>
  | StructuredError<"B", string>
  | StructuredError<"C", string>;

// @ts-expect-error a literal code stays required next to a branded code
matchErrorCode(brandedAndTwoLiterals, { A: () => 1, B: () => 2 });

matchErrorCode(brandedAndTwoLiterals, { B: () => 1, C: () => 2 });

declare const literalAndBrandedError:
  | StructuredError<"KNOWN", string>
  | StructuredError<string & CodeBrand, string>;

const literalAndBrandedWithCatchAll: number = matchErrorCode(
  literalAndBrandedError,
  { KNOWN: () => 1, _: () => 2 },
);

declare const codeNamedLikeAnInheritedMethod:
  StructuredError<"toString", string> | StructuredError<"OTHER", string>;

// @ts-expect-error the inherited toString does not count as a handler for the code toString
matchErrorCode(codeNamedLikeAnInheritedMethod, { OTHER: () => 1 });

const ownHandlerOfToString: string = matchErrorCode(
  codeNamedLikeAnInheritedMethod,
  { toString: () => "handled", OTHER: () => "other" },
);

const inheritedMethodCodeInCatchAll: number = matchErrorCode(
  codeNamedLikeAnInheritedMethod,
  { OTHER: () => 1, _: () => 2 },
);

class EmailTakenError extends StructuredError<"EMAIL_TAKEN", "CONFLICT"> {
  constructor() {
    super({
      code: "EMAIL_TAKEN",
      category: "CONFLICT",
      retryable: false,
      message: "email taken",
    });
  }
}

class RateLimitedError extends StructuredError<"RATE_LIMITED", "LIMIT"> {
  constructor() {
    super({
      code: "RATE_LIMITED",
      category: "LIMIT",
      retryable: true,
      message: "rate limited",
    });
  }
}

function codeOfClassUnionInGeneric<
  E extends EmailTakenError | RateLimitedError,
>(error: E): void {
  matchErrorCode(error, {
    // @ts-expect-error a handler in a generic caller of a class union receives only the base type
    EMAIL_TAKEN: (e): "EMAIL_TAKEN" => e.code,
    _: () => undefined,
  });
}

function codeOfClassUnionVariable<E extends EmailTakenError | RateLimitedError>(
  error: E,
): "EMAIL_TAKEN" | undefined {
  const known: EmailTakenError | RateLimitedError = error;
  return matchErrorCode(known, {
    EMAIL_TAKEN: (e): "EMAIL_TAKEN" => e.code,
    _: () => undefined,
  });
}

function misspelledInGenericClassUnion<
  E extends EmailTakenError | RateLimitedError,
>(error: E): number {
  // @ts-expect-error a code that the union does not contain is rejected in a generic caller of a class union
  return matchErrorCode(error, { EMAIL_TAKN: () => 409, _: () => 500 });
}

declare const openCodeError: StructuredError<"KNOWN" | (string & {}), string>;

const openCodeWithCatchAll: number = matchErrorCode(openCodeError, {
  OTHER_CODE: () => 1,
  _: () => 2,
});

const HttpErrors = defineErrors({
  "404": { category: "NOT_FOUND", retryable: false },
  "500": { category: "INTERNAL", retryable: false },
});
declare const httpError: CatalogError<typeof HttpErrors>;

const numericKeyWithCatchAll: number = matchErrorCode(httpError, {
  404: () => 1,
  _: () => 2,
});

const numericKeysComplete: number = matchErrorCode(httpError, {
  404: () => 1,
  500: () => 2,
});

// @ts-expect-error a numeric key that names no code of the union is rejected
matchErrorCode(httpError, { 403: () => 1, _: () => 2 });

declare const dynamicTable: Record<string, () => number>;

// @ts-expect-error a table typed Record<string, …> names no code, so the compiler cannot check it against a closed union
matchErrorCode(userError, dynamicTable);

enum PaymentCode {
  Declined = "PAYMENT_DECLINED",
  Expired = "CARD_EXPIRED",
}
declare const paymentError: StructuredError<PaymentCode, "PAYMENT">;

const enumCodesComplete: number = matchErrorCode(paymentError, {
  PAYMENT_DECLINED: () => 1,
  CARD_EXPIRED: () => 2,
});

const enumCodeWithCatchAll: number = matchErrorCode(paymentError, {
  [PaymentCode.Declined]: () => 1,
  _: () => 2,
});

// @ts-expect-error a key that names no member of the enum is rejected
matchErrorCode(paymentError, { PAYMENT_DECLIND: () => 1, _: () => 2 });

type Untyped = ReturnType<typeof JSON.parse>;
declare const untypedError: Untyped;

const untypedWithCatchAll: number = matchErrorCode(untypedError, {
  ANY_CODE: () => 1,
  _: () => 2,
});

declare const anyCodeError: StructuredError<Untyped, Untyped>;

const anyCodeWithCatchAll: number = matchErrorCode(anyCodeError, {
  ANY_CODE: () => 1,
  _: () => 2,
});

void UserErrors;
void HttpErrors;
void statusWithCatchAll;
void statusOfEveryCode;
void statusOfCatchAllOnly;
void detailsFromHandlerParameter;
void codeFromParametersNextToCatchAll;
void DetailsOfEachCode;
void detailsOfEachCaseInGeneric;
void memberOfCaseInGeneric;
void codeOfOtherCaseInGeneric;
void completeTableOfClosedBareCodeVariable;
void catchAllParameterOfBareCode;
void missingCodeInGeneric;
void wrongParameterInGeneric;
void catchAllParameterOfAnyError;
void catchAllParameterOfWideVariable;
void statusOfAnyError;
void misspelledInGeneric;
void statusOfBareCode;
void namedHandlerOfBareCode;
void statusOfAnnotatedCode;
void ownHandlerOfToString;
void inheritedMethodCodeInCatchAll;
void brandedCodeWithCatchAll;
void openCodeWithCatchAll;
void codeOfEachEnum;
void restOfTwoEnums;
void brandedLiteralsComplete;
void brandedLiteralsCatchAll;
void literalAndBrandedWithCatchAll;
void codeOfClassUnionInGeneric;
void codeOfClassUnionVariable;
void misspelledInGenericClassUnion;
void underscorePrefixedCode;
void numericKeyWithCatchAll;
void numericKeysComplete;
void enumCodesComplete;
void enumCodeWithCatchAll;
void untypedWithCatchAll;
void anyCodeWithCatchAll;
void CatchAllCodeErrors;
void catchAllOnly;
void withCatchAll;
void restCode;
void restOfCompleteTable;
void complete;
void anyCode;
void restOfWideCode;
void restOfBrandedLiterals;
