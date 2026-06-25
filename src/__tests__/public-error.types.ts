import {
  definePublicErrors,
  localize,
  project,
  toProblem,
  type PublicCodeOf,
} from "../public-error/index.js";
import { LocalizedMessageSet } from "../presentation/index.js";

// One registration site per public code; the union is inferred and grows with
// each `registerByCode`, so the UI can switch exhaustively at compile time.
const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500, retryable: false },
})
  .registerByCode("db.deadlock", {
    publicCode: "temporarily_unavailable",
    status: 503,
    category: "temporary",
    retryable: true,
  })
  .registerByCode("input.invalid", {
    publicCode: "validation_failed",
    status: 400,
  });

type AppCode = PublicCodeOf<typeof catalog>;

// The union is exactly the three registered public codes.
const _a: AppCode = "internal_error";
const _b: AppCode = "temporarily_unavailable";
const _c: AppCode = "validation_failed";
// @ts-expect-error "nope" is not a registered public code
const _bad: AppCode = "nope";
void _a;
void _b;
void _c;
void _bad;

// `project` returns the narrow union on `code`, not the open `string`.
const view = project(catalog, new Error("boom"));
const _viewCode: AppCode = view.code;
void _viewCode;

// The headline: an exhaustive switch compiles only because `code` is the closed
// union. If `project` returned `string`, `code` would not narrow to `never`.
function statusFor(code: AppCode): number {
  switch (code) {
    case "internal_error":
      return 500;
    case "temporarily_unavailable":
      return 503;
    case "validation_failed":
      return 400;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
void statusFor(view.code);

// A non-exhaustive switch must fail: "validation_failed" still reaches default.
function incomplete(code: AppCode): number {
  switch (code) {
    case "internal_error":
      return 500;
    case "temporarily_unavailable":
      return 503;
    default: {
      // @ts-expect-error not exhaustive: "validation_failed" is unhandled
      const exhaustive: never = code;
      return exhaustive ? 0 : 1;
    }
  }
}
void incomplete;

// `localize` preserves the union across the optional stage.
declare const messages: LocalizedMessageSet;
const localized = localize(view, messages, { locales: ["en"] });
const _locCode: AppCode = localized.code;
void _locCode;

// `toProblem` carries the union to `body.code`.
const problem = toProblem(catalog, view);
const _bodyCode: AppCode = problem.body.code;
void _bodyCode;
