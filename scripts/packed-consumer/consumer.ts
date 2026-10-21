// A consumer of the packed package. verify-packed-consumer.mjs compiles it
// once per TypeScript version and module-resolution mode, as an ES module and
// as a CommonJS module. It imports the package by name only.
import {
  BaseError,
  StructuredError,
  ValidationError,
  isStructuredError,
  matchError,
  toStructuredError,
  type ErrorOptions,
} from "@shirudo/base-error";
import {
  LocalizedMessageSet,
  definePublicErrors,
  project,
  toProblem,
  type ProblemDetails,
} from "@shirudo/base-error/public-error";
// @ts-expect-error the public-error subpath does not export the core classes
import { BaseError as NotPublic } from "@shirudo/base-error/public-error";

class EmailTaken extends StructuredError<"EMAIL_TAKEN", "CONFLICT"> {
  constructor(cause?: unknown) {
    super({
      code: "EMAIL_TAKEN",
      category: "CONFLICT",
      retryable: false,
      message: "email taken",
      cause,
    });
  }
}

class RateLimited extends StructuredError<"RATE_LIMITED", "LIMIT"> {
  constructor() {
    super({
      code: "RATE_LIMITED",
      category: "LIMIT",
      retryable: true,
      message: "rate limited",
    });
  }
}

declare const failure: EmailTaken | RateLimited;

export const status: number = matchError(failure, {
  EMAIL_TAKEN: () => 409,
  RATE_LIMITED: (error) => (error.retryable ? 429 : 503),
});

// @ts-expect-error matchError needs a case for every code of the union
matchError(failure, { EMAIL_TAKEN: () => 409 });

const options: ErrorOptions<"X", "Y"> = {
  code: "X",
  category: "Y",
  retryable: false,
  message: "m",
};
export const fromOptions: StructuredError<"X", "Y"> = new StructuredError(
  options,
);

// @ts-expect-error a structured error needs retryable
new StructuredError({ code: "X", category: "Y", message: "m" });

export const coerced: StructuredError<string, string> = toStructuredError(
  new BaseError("boom"),
);
export const log: Record<string, unknown> = new EmailTaken(
  new Error("unique violation"),
).toLogObject();
export const invalid = new ValidationError("invalid").addIssue({
  message: "Required",
  path: ["email"],
});

export function codeOf(value: unknown): string | undefined {
  return isStructuredError(value) ? value.code : undefined;
}

const catalog = definePublicErrors({
  fallback: {
    publicCode: "internal_error",
    status: 500,
    category: "internal",
    retryable: false,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "Something went wrong." },
    }),
  },
}).registerByCode("EMAIL_TAKEN", {
  publicCode: "email_taken",
  status: 409,
  category: "conflict",
  retryable: false,
});

export const body: ProblemDetails = toProblem(
  catalog,
  project(catalog, new EmailTaken()),
).body;

void NotPublic;
