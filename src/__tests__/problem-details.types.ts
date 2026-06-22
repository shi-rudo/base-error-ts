import {
  defineProblemDetailsAdapter,
  type ProblemDetailsDefinitionMap,
  type ProblemDetailsResult,
} from "../problem-details/index.js";
import type { PublicErrorView } from "../presentation/index.js";

const adapter = defineProblemDetailsAdapter({
  definitions: {
    ACCOUNT_NOT_FOUND: {
      type: "https://api.example.com/problems/account-not-found",
      status: 404,
    },
    RATE_LIMITED: {
      type: "https://api.example.com/problems/rate-limited",
      status: 429,
    },
  },
  fallback: { type: "about:blank", status: 500 },
});

const knownView: PublicErrorView<{ accountId: string }, "ACCOUNT_NOT_FOUND"> = {
  code: "ACCOUNT_NOT_FOUND",
  message: "Account not found",
  locale: "en",
  details: { accountId: "a-123" },
};

const knownResult = adapter.map(knownView, {
  extensions: { retry_after: 30 as const },
});
const knownStatus: 404 = knownResult.status;
const knownType: "https://api.example.com/problems/account-not-found" =
  knownResult.body.type;
const accountId: string | undefined = knownResult.body.details?.accountId;
const retryAfter: 30 | undefined = knownResult.body.retry_after;
// @ts-expect-error extensions can be omitted after runtime JSON validation
const guaranteedRetryAfter: 30 = knownResult.body.retry_after;
const contentType: "application/problem+json" =
  knownResult.headers["content-type"];

declare const broadExtensions: Readonly<
  Record<string, null | boolean | number | string>
>;
adapter.map(knownView, { extensions: broadExtensions });

interface RetryExtensions {
  readonly retry_after: number;
}
declare const namedExtensions: RetryExtensions;
adapter.map(knownView, { extensions: namedExtensions });

interface OptionalRetryExtensions {
  readonly retry_after?: number;
}
declare const optionalNamedExtensions: OptionalRetryExtensions;
adapter.map(knownView, { extensions: optionalNamedExtensions });

interface RequiredUndefinedExtension {
  readonly invalid: undefined;
}
declare const requiredUndefinedExtension: RequiredUndefinedExtension;
// @ts-expect-error required undefined fields are not JSON-safe
adapter.map(knownView, { extensions: requiredUndefinedExtension });

declare const openView: PublicErrorView<unknown>;
const openResult: ProblemDetailsResult<
  unknown,
  Record<never, never>,
  404 | 429 | 500
> = adapter.map(openView);

const unknownView: PublicErrorView<never, "UNMAPPED"> = {
  code: "UNMAPPED",
  message: "Something went wrong",
  locale: "en",
};
const fallbackStatus: 500 = adapter.map(unknownView).status;

// @ts-expect-error adapter definitions must not be empty
defineProblemDetailsAdapter({
  definitions: {},
  fallback: { type: "about:blank", status: 500 },
});

declare const widenedDefinitions: ProblemDetailsDefinitionMap;
// @ts-expect-error widened maps lose the finite public-code set
defineProblemDetailsAdapter({
  definitions: widenedDefinitions,
  fallback: { type: "about:blank", status: 500 },
});

// @ts-expect-error public codes must not be empty
defineProblemDetailsAdapter({
  definitions: { "": { type: "/problems/invalid", status: 400 } },
  fallback: { type: "about:blank", status: 500 },
});

// @ts-expect-error public codes must be string keys
defineProblemDetailsAdapter({
  definitions: { 1: { type: "/problems/invalid", status: 400 } },
  fallback: { type: "about:blank", status: 500 },
});

// @ts-expect-error definitions reject unknown fields
defineProblemDetailsAdapter({
  definitions: {
    INVALID: { type: "/problems/invalid", status: 400, extra: true },
  },
  fallback: { type: "about:blank", status: 500 },
});

// @ts-expect-error status must be numeric
defineProblemDetailsAdapter({
  definitions: { INVALID: { type: "/problems/invalid", status: "400" } },
  fallback: { type: "about:blank", status: 500 },
});

// @ts-expect-error fallback definitions reject unknown fields
defineProblemDetailsAdapter({
  definitions: { VALID: { type: "/problems/valid", status: 400 } },
  fallback: { type: "about:blank", status: 500, extra: true },
});

defineProblemDetailsAdapter({
  definitions: { VALID: { type: "/problems/valid", status: 400 } },
  fallback: { type: "about:blank", status: 500 },
  // @ts-expect-error adapter configuration rejects unknown fields
  extra: true,
});

// @ts-expect-error extensions cannot override reserved RFC fields
adapter.map(knownView, { extensions: { status: 418 } });

// @ts-expect-error extensions must be JSON-safe
adapter.map(knownView, { extensions: { callback: () => "invalid" } });

declare const extensionSymbol: unique symbol;
// @ts-expect-error extensions must have string keys
adapter.map(knownView, { extensions: { [extensionSymbol]: "invalid" } });

// @ts-expect-error adapter snapshots are immutable
adapter.definitions.ACCOUNT_NOT_FOUND.status = 500;

void knownStatus;
void knownType;
void accountId;
void retryAfter;
void guaranteedRetryAfter;
void contentType;
void openResult;
void fallbackStatus;
