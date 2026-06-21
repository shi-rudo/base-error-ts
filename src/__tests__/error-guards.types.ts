import {
  hasErrorCode,
  isAnyErrorOf,
  isAllOf,
  isError,
  isErrorOf,
  type ErrorClass,
  type ErrorLike,
  type TypeGuard,
} from "../index.js";

declare const caught: unknown;

if (isError(caught)) {
  const narrowed: ErrorLike = caught;
  const name: string = caught.name;
  const message: string = caught.message;
  const stack: string | undefined = caught.stack;

  void narrowed;
  void name;
  void message;
  void stack;
}

const isMissing: TypeGuard<ErrorLike & { readonly code: "ENOENT" }> =
  hasErrorCode("ENOENT");

if (isMissing(caught)) {
  const code: "ENOENT" = caught.code;
  const message: string = caught.message;

  void code;
  void message;
}

hasErrorCode(404);
// @ts-expect-error boolean error codes are unsupported
hasErrorCode(true);

class NetworkError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const NetworkErrorClass: ErrorClass<NetworkError> = NetworkError;
const isNetworkError = isErrorOf(NetworkErrorClass, (error) => {
  const status: number = error.status;
  void status;
  return error.status >= 500;
});

if (isNetworkError(caught)) {
  const networkError: NetworkError = caught;
  void networkError;
}

class NotAnError {}
// @ts-expect-error constructors must produce Error instances
isErrorOf(NotAnError);

class ParseError extends Error {
  readonly offset = 1;
}

if (isAnyErrorOf(caught, [NetworkError, ParseError] as const)) {
  const matched: NetworkError | ParseError = caught;
  void matched;
}

// @ts-expect-error every constructor must produce an Error
isAnyErrorOf(caught, [NetworkError, NotAnError] as const);

const hasMessage: TypeGuard<{ message: string }> = (
  value: unknown,
): value is { message: string } =>
  typeof value === "object" && value !== null && "message" in value;
const hasStatus: TypeGuard<{ status: number }> = (
  value: unknown,
): value is { status: number } =>
  typeof value === "object" && value !== null && "status" in value;

if (isAllOf(caught, [hasMessage, hasStatus] as const)) {
  const message: string = caught.message;
  const status: number = caught.status;

  void message;
  void status;
}

// @ts-expect-error an empty guard list cannot establish a narrowing
isAllOf(caught, [] as const);
