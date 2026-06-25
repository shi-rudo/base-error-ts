# Public error pipeline

The core of `@shirudo/base-error` is purely technical: a `StructuredError`
carries a `code`, `category`, `retryable`, a technical `message`, `details` and a
`cause`, none of it meant for an end user. Turning an error into safe,
client-facing output is a **boundary concern**, and the public error pipeline
does it in three stages over a single descriptor per public code: you register
once and produce a curated view, an optional localized variant, and an RFC 9457
response from the same source.

```ts
import {
  definePublicErrors,
  project,
  localize,
  toProblem,
  LocalizedMessageSet,
} from "@shirudo/base-error/public-error";
import type {
  PublicError,
  LocalizedPublicError,
  ProblemDetails,
  PublicCodeOf,
} from "@shirudo/base-error/public-error";
```

## Three stages over one descriptor

The pipeline is three independent functions. They compose, but none depends on
the next, so you stop wherever your stack stops:

1. **`project`** turns an unknown error into a curated, transport-neutral,
   **message-free** `PublicError`. This is the security boundary.
2. **`localize`** (optional) attaches a `message` and `locale`, keyed on the
   public code. A client-localizing app skips it.
3. **`toProblem`** maps the view to an RFC 9457 `ProblemDetails` body and HTTP
   headers.

```
throw  StructuredError
          │  project()
          ▼
       PublicError            curated, message-free machine view
          │  localize()       (optional, only when the backend localizes)
          ▼
       LocalizedPublicError   PublicError + message + locale
          │  toProblem()
          ▼
       ProblemDetailsResult   { status, headers, body: ProblemDetails }
```

## The descriptor and `definePublicErrors`

One descriptor describes everything about one public error: its wire identity,
its messages, and how it projects a vetted subset of the error.

```ts
const errors = definePublicErrors({
  fallback: {
    publicCode: "internal_error",
    status: 500,
    title: "An unexpected error occurred.",
    category: "internal",
    retryable: false,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "Something went wrong." },
    }),
  },
})
  .registerByCode("db.deadlock", {
    publicCode: "temporarily_unavailable",
    status: 503,
    type: "https://errors.example/temporarily-unavailable",
    title: "The service is briefly unavailable.",
    category: "temporary",
    retryable: true,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "We are a little busy. Please retry in a moment." },
    }),
  })
  .registerByCode("payment.declined", {
    publicCode: "payment_declined",
    status: 402,
    category: "payment",
    retryable: false,
    // The only data that crosses the boundary, vetted and typed. Never the raw error.
    projectDetails: (e: StructuredError) => ({
      reason: String((e.details as { reason?: unknown }).reason),
    }),
  });
```

Descriptor fields fall into three groups:

- **Wire identity** (static per code): `publicCode`, `status`, `type`, `title`.
  `category` and `retryable` are the **public**, declared values, never the
  internal `StructuredError.category`/`retryable`.
- **Messages**: `userMessages`, a `LocalizedMessageSet` of end-user text. Omit it
  if you localize entirely on the client.
- **Projectors** (per occurrence): `projectDetails`, `projectFields`,
  `projectRetryable`, `projectRetryAfter`. Each reads a vetted, typed subset from
  the error; the raw error is never spread.

`registerByCode` keys on the technical `code`; `register({ match, descriptor })`
keys on a type-guard predicate, tried after code matches. Registration validates
the RFC 9457 fields (`status` an integer in `[100, 599]`, non-empty `type`) and
rejects two internal codes that map one public code to a conflicting wire
identity (`status`/`type`/`title`/`category`/`userMessages`).

## Stage 1: `project` (curation)

```ts
const view = project(errors, error);
// { code: "payment_declined", category: "payment", retryable: false, details: { reason: "insufficient_funds" } }
```

`project` is **total over `unknown`**: every input yields a view, an unmatched
error degrading to the fallback, never throwing and never leaking. Nothing of the
error reaches the view automatically. The internal `category` (which may reveal
infrastructure, such as a `DEADLOCK`) never becomes the wire `category`; only the
curated public one does. A throwing projector is contained: the view stands
without that member, and the failure is reported to `onProject`.

The view is **message-free** and **frozen**. It is exactly what a TanStack server
function returns to the client: a plain object that serializes cleanly and that
the UI localizes itself.

## Stage 2: `localize` (optional)

```ts
const localized = localize(view, errors.messagesFor(view.code)!, {
  locales: ["de", "en"],
});
// { ...view, message: "Bitte versuche es gleich erneut.", locale: "de" }
```

`localize` is catalog-free: it takes only a view and a `LocalizedMessageSet`,
keyed on the public code. A backend passes `errors.messagesFor(view.code)`; a
client passes its own catalog for the same code. A client-localizing app never
calls this stage and renders from `view.code` against its own messages.

## Stage 3: `toProblem` (RFC 9457)

```ts
const { status, headers, body, outcome } = toProblem(errors, view, {
  instance: "urn:trace:7c1",
  detail: "Retry after the lock clears.",
});
```

`toProblem` reads `status`/`type`/`title` from the catalog by public code and
rides the machine members from the view into a `ProblemDetails` body. It is the
**wire boundary**: `details` and `fields` are deep-cloned into a frozen,
JSON-safe structure (a `Date`, `BigInt`, circular reference or other
non-serializable value drops that member and is recorded in `outcome.omitted`,
rather than throwing or producing a body the next serializer chokes on). A
non-string `category` or non-boolean `retryable` is dropped at this boundary too.

`title` is the localized `message` when the view was localized, otherwise the
static developer-facing `title` from the descriptor, otherwise omitted (RFC 9457
makes it optional). `content-language` is set only when the view was localized.
A `retryAfter` (from `projectRetryAfter` or the context) becomes both the
`Retry-After` header and a body member.

The first argument can also be an explicit `Transport` (`{ status, type?,
title? }`) instead of a catalog, for a view you already hold:

```ts
const result = toProblem({ status: 418, type: "https://errors.example/teapot" }, view);
```

## Three consumption modes from one registration

**Client-localizing (SPA/Edge):** stop after `project`, send the message-free
body, localize from `code` in the browser.

```json
{ "status": 503, "code": "temporarily_unavailable", "category": "temporary", "retryable": true }
```

**Backend-localizing (SSR/email):** insert `localize`; the end-user message
becomes the `title`, with `Content-Language`.

```json
{ "title": "Bitte versuche es gleich erneut.", "status": 503, "code": "temporarily_unavailable", "category": "temporary", "retryable": true }
```

**Consumable third-party API:** set a static `title` and a `type` docs URL, do
not localize. The integrator gets a stable, debuggable problem body.

```json
{
  "type": "https://api.example.com/errors/rate-limited",
  "title": "Rate limit exceeded.",
  "status": 429,
  "code": "rate_limited",
  "category": "rate_limit",
  "retryable": true,
  "retryAfter": 30
}
```

## Typed public codes

The catalog accumulates the registered public codes into a union. `PublicCodeOf`
extracts it, so a client switches exhaustively at compile time:

```ts
type AppCode = PublicCodeOf<typeof errors>;

function render(error: PublicError<unknown, AppCode>) {
  switch (error.code) {
    case "temporarily_unavailable":
      return retryLater();
    case "payment_declined":
      return paymentHelp(error.details);
    case "internal_error":
      return generic();
    // a missing case is a compile error
  }
}
```

`definePublicErrors` is the typed entry point; `new PublicErrorCatalog(...)`
leaves the union as the open `string`. In a monorepo the union is shared by the
same package front and back; for a third-party consumer it is a `.d.ts` re-export
(`export type AppCode = PublicCodeOf<typeof errors>`) the API author publishes.

## Observability

`project` calls an optional `onProject(error, view, outcome)` once, the single
place to log the technical error alongside the emitted public code:

```ts
definePublicErrors({
  fallback: { /* ... */ },
  onProject: (error, view, outcome) => {
    logger.error({
      publicCode: view.code,
      outcome, // { kind, via | reason, projection }
      ...(error instanceof StructuredError ? error.toLogObject() : {}),
    });
  },
});
```

The outcome distinguishes a `matched` result (`via: "code" | "predicate"`) from a
`fallback` (`reason: "no_match" | "matcher_failed"`), and reports the projection
status, so a silently missing `details` or a broken matcher is visible. The hook
is fire-and-forget: a throwing observer is swallowed. The technical message never
crosses the wire; bridge a client-visible response to your log with a correlation
id in `context.instance`.

## Without a catalog

Every stage has a catalog-free entry point, so the catalog is convenience, not a
requirement:

```ts
const view = projectWithDescriptor(descriptor, error); // bring your own match
const localized = localize(view, myMessageSet, { locales }); // already catalog-free
const result = toProblem({ status: 429 }, view); // explicit transport
```

## See also

- [Observability and logging](./observability) for the server-side log path
  (`toLogObject`, redaction), kept separate from this client-facing path.
- Proposal 0011 (`proposals/0011-public-error-pipeline.md`) for the full design
  rationale (it supersedes proposals 0005 and 0010).
- A runnable end-to-end example in `examples/public-error-e2e.ts` (Hono `onError`
  to a TanStack server function to a React `useQuery`).
