/**
 * End-to-end: Hono API error to TanStack server function to React UI.
 *
 * This file is runnable (`npx tsx examples/public-error-e2e.ts`) and self-
 * checking. The three framework hops are real but stubbed with plain functions
 * and a real JSON round-trip, because this library has no Hono/React/TanStack
 * dependency. The exact framework glue for each hop is shown in the comment
 * directly above its stub, so it can be copied verbatim into an app.
 *
 * Two stacks are demonstrated from one registration site:
 *   A. client-localizing (SPA/Edge): server sends a machine-complete, message-
 *      free problem; the React UI localizes from `code`.
 *   B. backend-localizing (SSR/email): server localizes and sends a `title`.
 */

import { StructuredError } from "../src/index.js";
import { LocalizedMessageSet } from "../src/public-error/index.js";
import {
  definePublicErrors,
  localize,
  project,
  toProblem,
  type PublicCodeOf,
  type PublicError,
} from "../src/public-error/index.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// ───────────────────────────────────────────────────────────────────────────
// SHARED (server + client). In a monorepo this lives in a package both import.
// One registration site per public code feeds projection, localization, and
// transport. `category` is the public category, never the internal one.
// ───────────────────────────────────────────────────────────────────────────
const catalog = definePublicErrors({
  fallback: {
    publicCode: "internal_error",
    status: 500,
    category: "internal",
    retryable: false,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Something went wrong.",
        de: "Etwas ist schiefgelaufen.",
      },
    }),
  },
})
  .registerByCode("db.deadlock", {
    publicCode: "temporarily_unavailable",
    status: 503,
    category: "temporary",
    retryable: true,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "We are a little busy. Please retry in a moment.",
        de: "Gerade viel los. Bitte gleich erneut versuchen.",
      },
    }),
  })
  .registerByCode("rate.limited", {
    publicCode: "rate_limited",
    status: 429,
    category: "temporary",
    retryable: true,
    projectRetryAfter: (error: StructuredError): number | undefined =>
      (error.details as { retryAfterSeconds?: number }).retryAfterSeconds,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Too many requests. Please slow down.",
        de: "Zu viele Anfragen. Bitte etwas langsamer.",
      },
    }),
  })
  .registerByCode("payment.declined", {
    publicCode: "payment_declined",
    status: 402,
    category: "payment",
    retryable: false,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Your payment was declined.",
        de: "Deine Zahlung wurde abgelehnt.",
      },
    }),
    // Curated projection: only the safe reason leaves the boundary, never the
    // provider response, request id, or technical message. A missing reason is
    // omitted rather than stringified to the literal "undefined".
    projectDetails: (
      error: StructuredError,
    ): { reason: string } | undefined => {
      const reason = (error.details as { reason?: unknown }).reason;
      return typeof reason === "string" ? { reason } : undefined;
    },
  })
  .registerByCode("input.invalid", {
    publicCode: "validation_failed",
    status: 400,
    category: "invalid_input",
    retryable: false,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Some fields need attention.",
        de: "Einige Felder brauchen Aufmerksamkeit.",
      },
    }),
    projectFields: (error: StructuredError) =>
      (error.details as { fields?: readonly { field: string; code: string }[] })
        .fields ?? [],
  });

/** The closed public-code union, shared with the client for exhaustive UI logic. */
type AppCode = PublicCodeOf<typeof catalog>;
/** What the client receives and renders. */
type AppPublicError = PublicError<unknown, AppCode>;

// ───────────────────────────────────────────────────────────────────────────
// HOP 1: Hono API boundary (HTTP). project, then optional localize, then toProblem.
//
//   // Client-localizing API (the common SPA/Edge case):
//   app.onError((err, c) => {
//     const view = project(catalog, err);
//     const { status, headers, body } = toProblem(catalog, view);
//     return c.json(body, status as ContentfulStatusCode, headers);
//   });
//
//   // Backend-localizing API (SSR/email): add one localize() before toProblem.
//   // Guard messagesFor (undefined for codes without userMessages):
//   const view = project(catalog, err);
//   const set = catalog.messagesFor(view.code);
//   const loc = set ? localize(view, set, { locales }) : view;
//   const { status, headers, body } = toProblem(catalog, loc);
// ───────────────────────────────────────────────────────────────────────────
type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  wireBody: string; // the actual bytes that cross the network
};

const FALLBACK_SET = new LocalizedMessageSet({
  baseLocale: "en",
  messages: { en: "Something went wrong." },
});

function honoOnError(
  error: unknown,
  mode: "client-localizes" | "backend-localizes",
  locales: readonly string[] = [],
): HttpResponse {
  const view = project(catalog, error);
  const result =
    mode === "backend-localizes"
      ? toProblem(
          catalog,
          localize(view, catalog.messagesFor(view.code) ?? FALLBACK_SET, {
            locales,
          }),
        )
      : toProblem(catalog, view);

  if (result.outcome.omitted.length > 0) {
    console.log(
      `   [server] dropped non-JSON-safe members: ${result.outcome.omitted.join(", ")}`,
    );
  }
  // c.json(body, status, headers): the body must survive JSON.stringify.
  return {
    status: result.status,
    headers: { ...result.headers },
    wireBody: JSON.stringify(result.body),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HOP 2: TanStack server function. It already has the API response (one fetch),
// parses problem+json, and returns the plain machine view to the client.
//
//   export const getCheckout = createServerFn().handler(async () => {
//     const res = await fetch("/api/checkout");
//     if (!res.ok) throw toAppError(await res.json()); // a plain object survives
//     return res.json();
//   });
// ───────────────────────────────────────────────────────────────────────────
const KNOWN_CODES: ReadonlySet<string> = new Set<AppCode>([
  "internal_error",
  "temporarily_unavailable",
  "rate_limited",
  "payment_declined",
  "validation_failed",
]);

function tanstackServerFn(http: HttpResponse): AppPublicError {
  const body = JSON.parse(http.wireBody) as Record<string, unknown>;
  // Runtime allowlist on the untrusted wire code: an unrecognized code degrades
  // to the generic bucket rather than being trusted as a member of the union.
  const code =
    typeof body.code === "string" && KNOWN_CODES.has(body.code)
      ? (body.code as AppCode)
      : "internal_error";
  return {
    code,
    ...(body.category !== undefined && { category: body.category as string }),
    ...(body.retryable !== undefined && {
      retryable: body.retryable as boolean,
    }),
    ...(typeof body.retryAfter === "number" && { retryAfter: body.retryAfter }),
    ...(body.details !== undefined && { details: body.details }),
    ...(body.fields !== undefined && {
      fields: body.fields as readonly { field: string; code: string }[],
    }),
  };
}

/** Convenience: the client view a single API round-trip produces. */
function clientView(error: unknown): AppPublicError {
  return tanstackServerFn(honoOnError(error, "client-localizes"));
}

// ───────────────────────────────────────────────────────────────────────────
// HOP 3: React UI (TanStack Query). Exhaustive switch on `code`, retry UX from
// `retryable`, field errors from `fields`, and i18n keyed on `code` against the
// client's OWN catalog (the server sent no message).
//
//   const { error } = useQuery({ queryKey: ["checkout"], queryFn: getCheckout });
//   if (error) return <ErrorPanel error={error as AppPublicError} />;
// ───────────────────────────────────────────────────────────────────────────
const CLIENT_MESSAGES: Record<AppCode, LocalizedMessageSet> = {
  internal_error: new LocalizedMessageSet({
    baseLocale: "en",
    messages: {
      en: "Unexpected error. Please try again.",
      de: "Unerwarteter Fehler. Bitte erneut versuchen.",
    },
  }),
  temporarily_unavailable: new LocalizedMessageSet({
    baseLocale: "en",
    messages: {
      en: "Busy right now, give it a second.",
      de: "Gerade ausgelastet, einen Moment.",
    },
  }),
  rate_limited: new LocalizedMessageSet({
    baseLocale: "en",
    messages: {
      en: "Slow down a moment, then retry.",
      de: "Kurz langsamer, dann erneut.",
    },
  }),
  payment_declined: new LocalizedMessageSet({
    baseLocale: "en",
    messages: {
      en: "Card declined. Try another payment method.",
      de: "Karte abgelehnt. Andere Zahlungsart versuchen.",
    },
  }),
  validation_failed: new LocalizedMessageSet({
    baseLocale: "en",
    messages: {
      en: "Please fix the highlighted fields.",
      de: "Bitte markierte Felder korrigieren.",
    },
  }),
};

type RenderedError = {
  headline: string;
  text: string;
  showRetry: boolean;
  retryAfter: number | undefined;
  fieldErrors: readonly { field: string; code: string }[];
};

function renderError(
  error: AppPublicError,
  locales: readonly string[],
): RenderedError {
  // Client-side localization keyed on the public code. A code the client does
  // not recognize (a code the API added after this client shipped) falls back
  // to the generic set rather than crashing the render. The own-property guard
  // keeps a code that collides with an Object.prototype member (e.g. "toString")
  // from resolving to the inherited member and defeating the fallback.
  const messages = Object.prototype.hasOwnProperty.call(
    CLIENT_MESSAGES,
    error.code,
  )
    ? CLIENT_MESSAGES[error.code]
    : CLIENT_MESSAGES.internal_error;
  const text = localize(error, messages, { locales }).message;

  // Exhaustive: the compiler forces a case for every registered public code.
  let headline: string;
  switch (error.code) {
    case "internal_error":
      headline = "Oops";
      break;
    case "temporarily_unavailable":
      headline = "One moment";
      break;
    case "rate_limited":
      headline = "Slow down";
      break;
    case "payment_declined":
      headline = "Payment problem";
      break;
    case "validation_failed":
      headline = "Check your input";
      break;
    default: {
      const exhaustive: never = error.code;
      headline = exhaustive;
    }
  }

  return {
    headline,
    text,
    showRetry: error.retryable === true,
    retryAfter: error.retryAfter,
    fieldErrors: error.fields ?? [],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// RUN: exercise both stacks and self-check the invariants that matter.
// ───────────────────────────────────────────────────────────────────────────
const deadlock = new StructuredError({
  code: "db.deadlock",
  category: "DEADLOCK", // internal taxonomy, must never reach the wire
  retryable: true,
  message: "deadlock on row 42 in table accounts (txn 0xdeadbeef)",
});
const limited = new StructuredError({
  code: "rate.limited",
  category: "RATE_LIMIT",
  retryable: true,
  message: "bucket exhausted for key user_42",
  details: { retryAfterSeconds: 30, bucketKey: "user_42" },
});
const declined = new StructuredError({
  code: "payment.declined",
  category: "PAYMENT",
  retryable: false,
  message: "Stripe declined card: insufficient_funds (req_secretABC123)",
  details: {
    reason: "insufficient_funds",
    stripeRequestId: "req_secretABC123",
  },
});
const invalid = new StructuredError({
  code: "input.invalid",
  category: "VALIDATION",
  retryable: false,
  message: "validation failed for buyer@example.com",
  details: {
    sqlState: "23505",
    fields: [
      { field: "email", code: "required" },
      { field: "card", code: "invalid" },
    ],
  },
});
const surprise = new TypeError("cannot read properties of undefined");

console.log("\n=== Stack A: client-localizing (structure-only problem) ===\n");
for (const [label, error, locales] of [
  ["deadlock", deadlock, ["de"]],
  ["rate limited", limited, ["en"]],
  ["payment declined", declined, ["en"]],
  ["validation", invalid, ["de"]],
  ["unmapped surprise", surprise, ["en"]],
] as const) {
  // One server round-trip per request; the UI is derived from it.
  const http = honoOnError(error, "client-localizes");
  const onWire = tanstackServerFn(http);
  const ui = renderError(onWire, locales);

  console.log(
    `• ${label}: HTTP ${http.status}  code=${onWire.code}  retry=${ui.showRetry}` +
      (ui.retryAfter !== undefined ? `  retryAfter=${ui.retryAfter}` : ""),
  );
  console.log(`   wire body: ${http.wireBody}`);
  console.log(`   UI [${locales.join(",")}]: ${ui.headline}: ${ui.text}`);
  if (ui.fieldErrors.length > 0) {
    console.log(
      `   fields: ${ui.fieldErrors.map((f) => `${f.field}:${f.code}`).join(", ")}`,
    );
  }

  // No internal taxonomy or technical text ever crosses the wire.
  assert(
    !http.wireBody.includes("DEADLOCK"),
    `${label}: internal category leaked`,
  );
  assert(
    !http.wireBody.includes("row 42"),
    `${label}: technical message leaked`,
  );
  assert(
    !http.wireBody.includes("req_secretABC123"),
    `${label}: provider id leaked`,
  );
  assert(!http.wireBody.includes("Stripe"), `${label}: provider name leaked`);
  assert(!http.wireBody.includes("23505"), `${label}: sql state leaked`);
  // Structure-only: machine-complete, no title.
  assert(
    !http.wireBody.includes('"title"'),
    `${label}: title present on structure-only path`,
  );
}

assert(
  clientView(deadlock).code === "temporarily_unavailable",
  "deadlock public code",
);
assert(clientView(deadlock).retryable === true, "deadlock retryable hint");
assert(
  honoOnError(limited, "client-localizes").status === 429,
  "rate limited -> 429",
);
assert(
  clientView(limited).retryAfter === 30,
  "retryAfter survives to the client",
);
assert(
  honoOnError(declined, "client-localizes").status === 402,
  "payment -> 402",
);
assert(
  (clientView(declined).details as { reason: string }).reason ===
    "insufficient_funds",
  "payment reason projected",
);
assert(clientView(invalid).fields?.length === 2, "validation fields projected");
assert(clientView(surprise).code === "internal_error", "unknown -> fallback");

// A code the client does not recognize must degrade, not crash the render.
const futureCode = renderError(
  { code: "quota_exceeded" as AppCode, category: "temporary", retryable: true },
  ["en"],
);
assert(futureCode.text.length > 0, "unknown code still renders text");
assert(
  futureCode.showRetry,
  "unknown code keeps its retry hint via category bucket",
);

// A code colliding with an Object.prototype member must degrade, not crash.
const collidingCode = renderError(
  { code: "toString" as AppCode, retryable: false },
  ["en"],
);
assert(collidingCode.text.length > 0, "prototype-colliding code still renders");

console.log(
  "\n=== Stack B: backend-localizing (SSR/email, problem carries title) ===\n",
);
const backend = honoOnError(deadlock, "backend-localizes", ["de"]);
const backendBody = JSON.parse(backend.wireBody) as { title?: string };
console.log(
  `• deadlock [de]: HTTP ${backend.status}  content-language=${backend.headers["content-language"]}`,
);
console.log(`   wire body: ${backend.wireBody}`);
assert(
  backendBody.title === "Gerade viel los. Bitte gleich erneut versuchen.",
  "backend title localized",
);
assert(
  backend.headers["content-language"] === "de",
  "backend content-language header",
);

console.log(
  "\n=== Wire safety: a Date in a projection is dropped, not leaked ===\n",
);
const guarded = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500, retryable: false },
}).registerByCode("report.ready", {
  publicCode: "report_ready",
  status: 200,
  // A plausible mistake: putting a Date on the wire. The transport guard omits
  // it instead of producing a body the next serializer would choke on.
  projectDetails: (): { generatedAt: Date } => ({ generatedAt: new Date() }),
});
const guardedView = project(guarded, { code: "report.ready" });
const guardedResult = toProblem(guarded, guardedView);
console.log(
  `   omitted: [${guardedResult.outcome.omitted.join(", ")}]  body: ${JSON.stringify(guardedResult.body)}`,
);
assert(
  guardedResult.outcome.omitted.includes("details"),
  "Date projection omitted",
);
assert(!("details" in guardedResult.body), "no details member on wire");
assert(guardedResult.body.code === "report_ready", "body still well-formed");

console.log(
  "\nAll three hops checked. The prototype carries a real error end to end.\n",
);
