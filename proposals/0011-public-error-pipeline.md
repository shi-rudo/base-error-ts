# Proposal 0011: public error pipeline (projection, localization, and transport over one descriptor)

**Status:** Accepted. Implemented under `src/public-error/` and exported at the
`@shirudo/base-error/public-error` subpath in 8.0.0. **Supersedes** 0005
(presentation) and 0010 (RFC 9457 adapter), both removed in 8.0.0; it unifies and
refines two coupling defects those left open.

**Target release:** 8.0.0.

**Audience:** consumers who serve errors to more than one kind of client at once
(a first-party SPA/Edge app that localizes in the browser, a server-rendered or
email path that localizes on the backend, and a consumable API used by third
parties) from a single error model.

**Context:** 0005 produced a transport-neutral `PublicErrorView`, and 0010 mapped
it to RFC 9457. In practice two couplings forced consumers to bypass the
presentation layer and adopt the core only:

1. **Transport was coupled to i18n.** The adapter set `title = view.message`, and
   `PublicErrorView.message` was required and localized. There was no path to
   render the machine structure (`type`/`status`/`code`/`instance`) without first
   producing a localized message. A client-localizing app (the common SPA/Edge
   shape) had to thread a base-locale message it never shows, or skip the
   adapter. RFC 9457 makes `title` optional precisely because the machine
   identity is independent of i18n.
2. **The view was too thin and conflated audiences.** `{ code, message, locale,
   details }` dropped `category`/`retryable`, and treated the single `message` as
   serving both the end user (localized UI text) and the API integrator
   (developer-facing summary). Those are different audiences with different
   lifecycles.

The fix is not to widen the view or to decorate the descriptor with the full RFC
vocabulary. It is to split the one fused step into three independent stages over
one source of truth, and to name the two message audiences.

---

## Two central decisions

**One descriptor, three independent stages.** A single registration per public
code feeds three pure functions that compose but do not depend on each other:

```ts
const view      = project(catalog, error);                 // 1. curation (security)
const localized = localize(view, messages, { locales });   // 2. localization (optional)
const result    = toProblem(catalog, localized, context);  // 3. transport (RFC 9457)
```

Localization is a removable middle stage. A client-localizing app stops after
`project` and renders from `view.code`. A backend-localizing app inserts
`localize`. The machine structure never requires a message.

**Two message audiences, separated.** The localized **end-user** message
(`userMessages` + `localize`, shown in a UI, varies by `Accept-Language`) and the
static **developer-facing** summary (`title` on the descriptor, the RFC 9457
`title`, stable per problem type, read by an integrator debugging against the
JSON) are distinct. They are stored separately and resolved independently.
Conflating them was the root of coupling (1).

## Decision

1. The unit of registration is a `PublicErrorDescriptor`: one per public code,
   the single source of truth. It feeds curation, localization, and transport,
   replacing the separate registry (0005) plus adapter definition map (0010) so
   the two cannot drift.
2. `project(catalog, error)` is stage 1: a curated, transport-neutral,
   **message-free** `PublicError`. Total over `unknown`; an unmatched error
   degrades to the catalog fallback. Nothing of the error reaches the view
   automatically.
3. `localize(view, messages, { locales })` is stage 2: catalog-free, keyed on the
   public code, attaches `message` + `locale`. Optional and orthogonal.
4. `toProblem(source, view, context)` is stage 3: an RFC 9457 result. `source` is
   a `PublicErrorCatalog` **or** an explicit `Transport` (`{ status, type?,
   title? }`) for catalog-free use.
5. `category` and `retryable` on the wire are **curated public** values declared
   on the descriptor, never the internal `StructuredError.category`/`retryable`.
   The internal taxonomy is never the wire taxonomy, exactly as `publicCode` is
   distinct from the internal `code`.
6. The descriptor carries the **static** RFC members (`type`, `status`,
   `title`) and excludes the **localized** (`title` may be overridden by a
   message) and **per-occurrence** ones (`detail`, `instance`, `retryAfter`),
   which enter through `toProblem`'s context.
7. `toProblem` emits `title` from the localized message when the view was
   localized, otherwise from the descriptor's static `title`, otherwise nothing.
   `content-language` is set only when the view was localized.
8. `toProblem` is the wire boundary: `details` and `fields` are deep-cloned into
   a frozen, JSON-safe structure; a non-serializable value drops that member and
   records it in `outcome.omitted` rather than throwing or leaking.
9. The catalog is generic over the registered public-code union; `project` and
   `toProblem` carry it to `code`, so a client can switch exhaustively at compile
   time. `PublicCodeOf<typeof catalog>` extracts the union.
10. `project` invokes an optional `onProject(error, view, outcome)` observer once,
    the central place to log the technical error with the emitted code and
    outcome (matched/fallback, via/reason, projection status).
11. The catalog is convenience, not a requirement. Each stage has a catalog-free
    entry point: `projectWithDescriptor`, `localize`, `toProblem(transport, …)`.
12. `status` (integer in `[100, 599]`) and `type` (non-empty if present) are
    validated at registration, reusing the same predicates as the 0010 adapter.
13. Public `category` is an **advisory** grouping for graceful degradation, not a
    typed exhaustive contract. `publicCode` is the typed branch key; `category`
    is derivable from it. An optional `categories` allowlist is validated at
    registration to prevent drift, and when declared, the fallback must carry a
    category (the unknown-code bucket). Clients branch exhaustively on
    `publicCode`, never `category`.

## The descriptor (single source of truth)

```ts
type PublicErrorDescriptor<TError, TDetails, TPublicCode extends string> = {
  publicCode: TPublicCode;          // stable wire contract
  status: number;                   // RFC 9457 / HTTP, validated [100,599]
  type?: string;                    // RFC 9457 type URI (ideally docs)
  title?: string;                   // static, developer-facing summary
  category?: string;                // curated PUBLIC category (not the internal one)
  retryable?: boolean;              // declared hint
  userMessages?: LocalizedMessageSet;          // localized END-USER text
  projectDetails?: (e: TError) => TDetails;    // vetted subset, never spreads
  projectRetryable?: (e: TError) => boolean;   // per-occurrence override
  projectRetryAfter?: (e: TError) => number | undefined; // seconds, occurrence
  projectFields?: (e: TError) => readonly FieldFault[];  // validation faults
};
```

What it deliberately carries vs excludes follows the lifecycle of each value:

| Value | Nature | Home |
| --- | --- | --- |
| `type`, `status` | static per type | descriptor |
| `title` (developer) | static per type | descriptor `title` |
| `title` (end user) | localized | `userMessages` → `localize`, overrides static |
| `category`, `retryable` | curated public, declared | descriptor |
| `detail`, `instance` | per-occurrence | `toProblem` context |
| `retryAfter` | per-occurrence | projector or `toProblem` context |
| `details`, `fields` | vetted projection of the error | `projectDetails`/`projectFields` |

## Stage 1: projection is a security boundary

`project` is curation, not serialization. Nothing of the error reaches the view
automatically: only declared (`category`, `retryable`) or explicitly projected
(`details`, `fields`, `retryAfter`) values appear. The internal
`StructuredError.category` (for example `DEADLOCK`, `CONNECTION`) is never read;
the wire `category` is the curated `publicCategory` the registrant declared. This
preserves 0005's positive-allowlist rule while letting the view carry the safe
machine hints the thin view dropped.

`category` is finer than the HTTP status and can reveal infrastructure
(`DEADLOCK` and `CONNECTION` both map to 500), so exposing the internal value
would leak more than the status does. `publicCode` is already the client-safe
branching key; a coarser public grouping is the curated `category`, never the
internal one.

The public `category` is **advisory**, not a typed exhaustive contract. Its
purpose is **graceful degradation for codes a client does not recognize**: a
client that knows a `publicCode` branches on it exhaustively, and a client that
receives a code the API added after the client shipped still gets a sensible
coarse bucket from `category`. This is also why typing it is not merely redundant
but pointless: a compile-time category union would by definition cover only the
codes already handled by `code`; for the unknown codes, the one case where
`category` adds value, a type contributes nothing. `category` is a function of
`publicCode` (each code has one), so clients must not switch exhaustively on it;
for stable buckets, derive them from `publicCode`.

To prevent vocabulary drift (`"conflict"` vs `"CONFLICT"`), a catalog may declare
a closed `categories` allowlist, validated at registration; without it, any
non-empty category string is accepted. Because the value lives in the
unknown-code case, when an allowlist is declared the **fallback** descriptor must
carry a `category` (the bucket for codes a client does not recognize);
per-descriptor `category` is otherwise optional.

A throwing projector is contained: the view stands without that member, and the
projection status (`none` / `succeeded` / `failed`) is reported to `onProject`
for debugging a silently missing `details`.

## Stage 2: localization is optional and keyed on the public code

`localize(view, messages, { locales })` takes only a view and a
`LocalizedMessageSet`; it needs no catalog. A backend passes
`catalog.messagesFor(view.code)`; a client passes its own catalog for the same
public code. A client-localizing app never calls this stage and renders from
`view.code` against its own message catalog. This is what makes the
client-localizing path first-class rather than a workaround.

## Stage 3: transport maps to RFC 9457

`toProblem` reads `status`/`type`/`title` from the catalog by public code (or
from an explicit `Transport`) and rides the machine members from the view. The
RFC 9457 mapping:

| RFC 9457 member | Source |
| --- | --- |
| `type` | descriptor `type` |
| `title` | localized `message`, else descriptor `title`, else omitted |
| `status` | descriptor `status` (also the HTTP status) |
| `detail` | `context.detail` (per occurrence) |
| `instance` | `context.instance` (per occurrence) |
| `code`, `category`, `retryable`, `retryAfter`, `fields`, `details` | extension members from the view/context |
| `Retry-After` header | `context.retryAfter ?? view.retryAfter`, validated |
| `Content-Language` header | the localized `locale`, only when localized |

`code`/`category`/`retryable`/`retryAfter`/`fields`/`details` are extension
members the adapter writes by default; RFC 9457 reserves only
`type`/`title`/`status`/`detail`/`instance`. The body has a null prototype and is
deeply frozen.

In the localized mode the user message shadows the static developer `title`
(decision 7): an integrator debugging a server-rendered response sees the
localized title, not the stable developer summary. This is intended (one response
serves one audience), but it means `code` and `type` are the stable anchors for
an integrator in that mode, not `title`. A consumable third-party API therefore
serves the unlocalized mode, where the static `title` is present and stable.

### The wire boundary is JSON-safe

`details` and `fields` are deep-cloned and frozen through the shared
`cloneJsonSafe` (the same implementation the 0010 adapter uses). A `Date`,
`BigInt`, circular reference, non-finite number, function, or symbol-keyed object
drops that member and records it in `outcome.omitted`, rather than producing a
body the HTTP serializer or a downstream RPC serializer (for example
TanStack/Seroval) would choke on. Prototype pollution via a `__proto__` data key
is contained by the null-prototype clone.

## Typed public-code union

The catalog accumulates the registered public codes into a union as you chain
registrations. `definePublicErrors` seeds it from the fallback with literal
inference; `project`/`toProblem` carry it to `code`. A shared
`PublicCodeOf<typeof catalog>` lets the client exhaust the union:

```ts
switch (error.code) {
  case "temporarily_unavailable": return retry();
  case "payment_declined":        return paymentHelp(error.details?.reason);
  case "validation_failed":       return fieldErrors(error.fields);
  case "internal_error":          return generic();
  // a missing case is a compile error
}
```

`new PublicErrorCatalog(...)` leaves the union as the open `string`;
`definePublicErrors(...)` is the typed entry point.

The exhaustive switch depends on the client holding the code union, and the whole
compile-time DX rests on this. In a monorepo it is the shared package (the same
word on both sides, front and back); for a third-party consumer it is a published
`.d.ts` shipped with the API contract. Without the union the client still
branches at runtime, just not exhaustively at compile time.

That published `.d.ts` is a compile-time **type re-export**, produced and shipped
by the API author, not by this library: `export type AppPublicCode =
PublicCodeOf<typeof catalog>`. No runtime enumeration of the catalog's codes is
needed for it, and none is provided. The library knows the API author's
vocabulary only at the type level; turning it into a runtime artifact (an OpenAPI
or JSON-Schema error catalog) is the author's job with their own tooling.

## Observability

`project` calls an optional `onProject(error, view, outcome)` once, the single
place to log the technical error (its `message`/`cause`/`stack` via
`toLogObject`, redacted) alongside the emitted `view.code`. The outcome carries
the debug signals 0005's presenter had:

```ts
type ProjectionOutcome =
  | { kind: "matched";  via: "code" | "predicate";          projection: ProjectionStatus }
  | { kind: "fallback"; reason: "no_match" | "matcher_failed"; projection: ProjectionStatus };
```

`matcher_failed` distinguishes a fallback caused by a throwing matcher from a
genuine miss; `projection: "failed"` explains a silently missing `details`. The
hook is fire-and-forget: a throwing observer is swallowed so telemetry never
breaks totality. The technical message itself never crosses the wire; it is
bridged to the client-visible response by a correlation id placed in both the log
and `context.instance`.

## The catalog is optional

The catalog does two things: resolution (error to descriptor, by code then
predicate) and static-metadata lookup (public code to `status`/`type`/`title`).
A consumer who wants neither is not stuck:

```ts
const view      = projectWithDescriptor(descriptor, error);   // bring your own match
const localized = localize(view, myMessageSet, { locales });  // already catalog-free
const result    = toProblem({ status: 429, title: "…" }, view); // explicit transport
```

## Validation at registration

`status` and `type` are validated when a descriptor is registered, via the shared
`isHttpStatusCode` and `isNonEmptyString` predicates also used by the 0010
adapter, so the two layers cannot drift on what they accept. `publicCode` must be
a non-empty string. This is the RFC-compatibility-as-enforcement point; the
descriptor stays transport-neutral otherwise.

Registration also enforces that one public code is one wire identity. Several
internal codes may map to one public code, but they must agree: differing
`status`/`type` is a transport conflict, and differing `userMessages` (by content,
not reference) is a message conflict. Both throw rather than silently
last-write-win; disagreeing codes should be different public codes. A declared
`categories` allowlist is enforced here too: a `category` outside it is a
registration error, an empty `category` is rejected, and the fallback must carry
a category (the unknown-code bucket).

## Three consumption modes from one registration

**Client-localizing SPA/Edge** (no static `title`, no `localize`): a
machine-complete, message-free body. The UI localizes from `code`.

```json
{ "status": 503, "code": "temporarily_unavailable", "category": "temporary", "retryable": true }
```

**Backend-localizing** (SSR, email): `localize` before `toProblem`; the localized
end-user message becomes the `title`, with `Content-Language`.

```json
{ "title": "Bitte versuche es gleich erneut.", "status": 503, "code": "temporarily_unavailable", … }
```

**Consumable third-party API** (static `title` + `type` docs URL, no localize):

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 30
```
```json
{
  "type": "https://api.example.com/errors/rate-limited",
  "title": "Rate limit exceeded.",
  "status": 429,
  "instance": "urn:trace:7c1",
  "code": "rate_limited",
  "category": "rate_limit",
  "retryable": true,
  "retryAfter": 30
}
```

## Relationship to 0005 and 0010

This proposal keeps 0005's thesis intact: presentation is composed not inherited,
the thrown error is always technical, the public path never reaches for the
technical message, and the output is transport-neutral. It **refines** two
points: the presenter is split into `project` (curation) plus `localize`
(localization) so localization is removable, and the curated view is permitted to
carry the safe machine hints (`category`, `retryable`, `retryAfter`, `fields`) it
previously dropped, by explicit allowlist rather than passthrough.

It keeps 0010's RFC 9457 output shape and JSON-safety guarantees, and reuses the
adapter's clone-and-freeze and status/type validation. It **refines** 0010 by
removing the requirement that a problem body carry a localized `title`, and by
unifying the adapter's separate definition map into the one descriptor.

The standalone `ProblemDetailsAdapter` (0010) remains for consumers who already
hold a `PublicErrorView` and want only the RFC mapping; `toProblem` is the
catalog-integrated path.

## Alternatives considered

- **Widen `PublicErrorView` to carry `category` + `retryable` and a structure-only
  adapter path.** Half right. Yes to a message-free structure path; no to putting
  the **internal** `category` on the view (it leaks finer-than-status
  infrastructure detail and would be automatic passthrough). The curated public
  `category` is the resolution.
- **Decorate the descriptor with the full RFC 9457 vocabulary
  (`title`/`detail`/`instance`).** Rejected. A localized `title` re-couples
  transport and i18n; `detail`/`instance` are per-occurrence and belong in the
  `toProblem` context. Only the static members (`type`, `status`, static `title`)
  are descriptor metadata. RFC compatibility lives at the **output**
  (`ProblemDetails`), not the input.
- **A static `retryAfter` on the descriptor.** Rejected. The retry delay varies by
  occurrence (rate-limit window, backoff); it is a projector or a `toProblem`
  context value, not static type metadata.
- **Type `category` as a union threaded through the view, like `publicCode`.**
  Rejected as redundant: `category` is a function of `publicCode`, so a second
  parallel typed taxonomy adds a fourth type parameter for grouping that
  `publicCode` already supports exhaustively, and across the wire the client casts
  it from JSON regardless. Kept advisory, with an optional registration-time
  `categories` allowlist for consistency.
- **`project` returns `{ view, transport }` so `toProblem` is catalog-free for the
  matched code.** Considered. Kept the catalog dependency to keep the view a pure
  neutral value; the explicit-`Transport` overload covers the catalog-free need.
- **A per-call `onProject` option instead of catalog-level.** Rejected for the
  primary path; centralized observability is the common case. The catalog-free
  entry points wire their own logging.

## Out of scope / open

- **Content-negotiated developer `title`.** The static `title` is a single
  canonical string. An API wanting a localized developer-facing title can use
  `userMessages` + `localize`; a negotiated static title is not modeled.
- **HTTP-date `Retry-After`.** Only the delay-seconds form is emitted; the
  HTTP-date form is not modeled.
- **Per-tenant descriptor overrides** (white-label wordings) remain a decorated
  catalog, not a widened stage signature, consistent with 0005.
- **Runtime enumeration of public codes** (a `catalog.publicCodes()` or a
  descriptor iterator for generating an OpenAPI / JSON-Schema error catalog). The
  union is type-level only (`PublicCodeOf`), and `assertCoverage` covers the
  completeness check; a runtime listing is YAGNI until a concrete generator needs
  it, and would be purely additive (a curated read-only view, never the projector
  functions or message sets).

## Implementation status

Implemented under `src/public-error/` (`types.ts`, `PublicErrorCatalog.ts`,
`project.ts`, `localize.ts`, `toProblem.ts`, `index.ts`), with the shared
`src/utils/json-safe.ts`, `src/utils/problem-validation.ts`, and
`src/utils/error-resolution.ts` reused by the 0010 adapter and the presentation
registry. Test-first across the `public-error-*` spec files plus a type-level
file and a runnable end-to-end example (`examples/public-error-e2e.ts`: Hono
`onError` → TanStack server function → React `useQuery`). Exported at the
`@shirudo/base-error/public-error` subpath in 7.2.0.
