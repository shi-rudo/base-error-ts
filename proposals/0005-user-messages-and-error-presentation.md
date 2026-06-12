# Proposal 0005: user messages out of the core, technology-agnostic error presentation

**Status:** Accepted. Decision locked (see _Decision_). Not yet implemented.
This proposal **supersedes** the localized-message design shipped in PR #58
(`ctx.message` + `ctx.messageLocalized` on the response envelope). That work is
replaced, not extended.

**Audience:** DDD, application, and infrastructure users who need a clean
separation between what failed (domain), what to do next (application), and how
a channel renders it (presentation).

**Context:** the core error currently carries user-facing localization
(`withUserMessage`, `addLocalizedMessage`, locale resolution, and an `expose`
flag that lets the public serializer fall back to the technical message). That
conflates three independent concerns on one base class and produces real
defects: a base-locale fallback invariant that the API does not guarantee,
asymmetric exposure between the default user message and localized entries, a
locale resolver too weak for real BCP 47 tags, and an `expose` switch that can
leak technical text. The conclusion is not to patch the invariants. It is that
localization does not belong on a general-purpose error base at all.

---

## Two central decisions

**Presentation is composed, not inherited.** The error you **throw** is always
the technical error: a `StructuredError`, or any `unknown` a `catch` receives.
There is no `class PublicError extends StructuredError`. A single instance must
never carry both internal and public responsibility. The public representation
is a separate value, produced at the boundary by a presenter from an explicitly
registered `PublicErrorDefinition`.

**The normative model is technology-agnostic.** The library solves exactly one
problem: turn an unknown technical error into a safe, localized public
representation. It knows nothing about HTTP, gRPC, CLI, GraphQL, messaging, SMS,
or email. The presenter produces a neutral `PublicErrorView`. How that view is
transported, and what status or exit code it maps to, is a consumer decision
made in a transport adapter that lives outside this package.

## Decision

1. `StructuredError` stays a **technical** core error. It carries, at minimum,
   `code`, the technical `message`, structured `details`, and `cause`.
   Additional technical classification fields (`category`, `retryable`) remain.
   It carries **no** user-facing, locale, or presentation field.
2. User messages and locales are **removed** from the core. `withUserMessage`,
   `addLocalizedMessage`, `updateLocalizedMessage`, and `getUserMessage` leave
   `BaseError`/`StructuredError`.
3. `expose` is **removed** entirely. No replacement flag.
4. `toPublicJSON` is **removed** from the core. The core has only a full
   fidelity internal serializer, explicitly defined as not safe for public
   responses.
5. Public presentation is **composition**: `PublicErrorDefinition` (a registered
   template) plus a boundary presenter. No thrown `PublicError` subtype.
6. Localized messages live in an immutable `LocalizedMessageSet` with
   **mandatory** `baseLocale`. No hidden default locale.
7. The presenter output is a **transport-neutral** `PublicErrorView`. No status,
   header, exit code, or other channel concept appears in the normative model.
8. The view's `code`, `message`, and `locale` derive from a single resolver
   result and the definition's `publicCode` (distinct from
   `StructuredError.code`); never from separate or implicit sources.
9. PR #58 is replaced (see _Consequence for #58_).

This is the normative architecture. "Keep it on the base class", "A only with no
localization anywhere", "a thrown `PublicError` subtype", "a channel presenter in
the package", and "a universal transport status field" are recorded under
_Alternatives considered_; they are not open options.

## Module structure

```text
errors/core            (mandatory)
  StructuredError       code + technical message + details + cause (+ category, retryable)
  InternalErrorSerializer  full-fidelity, internal only (today's toJSON/toLogObject role)
  fromJSON, redaction, matchError, cause utilities

errors/presentation    (optional, technology-agnostic)
  LocalizedMessageSet   immutable, canonicalized locale -> text, mandatory baseLocale
  LocaleResolver        BCP 47 / RFC 4647 lookup over a preference list
  ResolvedUserMessage   { locale, message, matchedPreferenceIndex?, match }
  PublicErrorDefinition { publicCode, userMessages, projectDetails? }  // no channel field
  PublicErrorRegistry   maps an error to its definition, deterministically
  PublicErrorPresenter  present(error: unknown, ctx?) -> PublicErrorView
  PublicErrorView       { code, message, locale, details? }            // transport-neutral
```

Dependency direction:

```text
presentation  ->  core
```

There is no `errors/http` (or any channel module) in this package. The core
knows nothing about locale or presentation. Presentation knows nothing about any
channel. The package has **zero runtime dependencies**, and the
`presentation -> core` direction is enforced by an ESLint boundary rule, since
TypeScript does not enforce it.

```text
StructuredError / unknown
        |
        v
PublicErrorRegistry      (which definition applies)
        |
        v
PublicErrorPresenter     (resolve locale, project details, or generic fallback)
        |
        v
PublicErrorView          (code, message, locale, details?)
        |
        +--> HTTP adapter      (status + body)        |
        +--> gRPC adapter      (grpc status + meta)   |  all outside this package
        +--> CLI adapter       (exit code + stderr)   |
        +--> GraphQL adapter   (errors[] extension)   |
        +--> messaging adapter (retry / dead-letter)  |
```

## A: the core (mandatory)

`StructuredError` changes only by **subtraction**. It describes a failure, not
its presentation:

```ts
const err = new StructuredError({
  code: "payment.declined", // internal classification, not assumed client-safe
  category: "PAYMENT",
  retryable: false,
  message: `Payment ${paymentId} declined: ${reason}`, // technical, for logs
  details: { paymentId, reason }, // structured, internal
  cause,
});
```

Removed from the core: `withUserMessage`, `addLocalizedMessage`,
`updateLocalizedMessage`, `getUserMessage`, `expose`, `toPublicJSON`, and any
notion of a user-facing string or locale. The only serializer on the core is
internal and full fidelity (today's `toJSON`/`toLogObject`, still subject to
Proposal 0004 redaction), explicitly **not** safe for public responses.

## B: presentation (optional, technology-agnostic)

```ts
import {
  LocalizedMessageSet,
  PublicErrorRegistry,
  PublicErrorPresenter,
} from "@shirudo/base-error/presentation";
```

### `LocalizedMessageSet`

Immutable, constructed once, `baseLocale` mandatory and explicit, with a small
read-only API for tests, registries, and debugging:

```ts
const messages = new LocalizedMessageSet({
  baseLocale: "en", // mandatory: the guaranteed-fallback language, made visible
  messages: {
    en: "Your payment could not be processed.",
    de: "Ihre Zahlung konnte nicht verarbeitet werden.",
  },
});

messages.baseLocale; // "en"
messages.has("de"); // true
messages.get("de"); // "Ihre Zahlung konnte nicht verarbeitet werden."
messages.entries(); // readonly [locale, text][] over canonical keys
```

Construction validates the locale and content invariants (below) and throws on
violation. A set without an entry for its `baseLocale` is rejected. The generic
fallback set the presenter is built with is an ordinary `LocalizedMessageSet`
and is held to exactly these invariants.

### `LocaleResolver`

One ordered preference list, not an asymmetric `locale` + `fallbackLocales`
split. `Accept-Language` already yields a list; the resolver consumes it
directly. `baseLocale` is appended internally and need not be supplied again:

```ts
type ResolvedUserMessage = {
  locale: string; // canonical key that actually matched
  message: string;
  matchedPreferenceIndex?: number; // index into `locales`; undefined => matched via the appended baseLocale
  match: "exact" | "parent" | "base";
};

resolve(
  set: LocalizedMessageSet,
  options?: { locales?: readonly string[] },
): ResolvedUserMessage; // never undefined: the base entry is guaranteed
```

`matchedPreferenceIndex` plus `match` are unambiguous where a single `source`
enum was not. For `locales: ["fr-CA", "de-CH"]` matching `de`, the result is
`{ locale: "de", matchedPreferenceIndex: 1, match: "parent" }`: the second
preference, via its parent tag.

`baseLocale` is appended **only after** the supplied locales are processed and
deduped. So if the supplied list already contains the base locale, that is an
ordinary `exact`/`parent` match with a defined `matchedPreferenceIndex`. Only a
match against the appended base uses `match: "base"` with
`matchedPreferenceIndex: undefined`. `locales: ["en"]` with `baseLocale: "en"`
resolves as `{ match: "exact", matchedPreferenceIndex: 0 }`, not `"base"`.

Resolution builds a deduplicated candidate list: for each entry in `locales`
(then the appended `baseLocale`), expand its RFC 4647 truncation chain,
canonicalize, drop invalid, dedupe preserving order, then take the first
candidate present in the set.

```text
locales=[fr-CA, de-CH], baseLocale=en
candidates: fr-CA, fr, de-CH, de, en
```

The resolver consumes an already-ordered preference list. Parsing and q-value
sorting of `Accept-Language` is the transport adapter's job, outside this
package. A tiny parser may appear in an HTTP adapter _example_, never shipped in
the package, consistent with transport neutrality.

Dedupe is preference-order-first, and this is a pinned design decision, not
implementation freedom:

```text
locales=[de-CH, fr, de], set={de, fr}, baseLocale=en
candidates after expansion + dedupe: de-CH, de, fr, en
result: { locale: "de", matchedPreferenceIndex: 0, match: "parent" }
```

The duplicate `de` at input position 2 does **not** win as `exact`: the
truncation chain of the first entry (`de-CH`) already consumed `de`. Preference
order dominates exactness, consistent with RFC 4647 lookup semantics.

### `PublicErrorDefinition`, typed per error

The registered, static description of how one class of error renders publicly.
`publicCode` is the wire contract, a different field from `StructuredError.code`.
The definition is **generic over the error type** so `projectDetails` never
receives a raw `unknown`:

```ts
type PublicErrorDefinition<TError = unknown, TDetails = never> = {
  publicCode: string; // stable public contract
  userMessages: LocalizedMessageSet;
  projectDetails?: (error: TError) => TDetails; // typed, explicit, opt-in
};
```

No channel field. There is no `httpStatus` here: a status is HTTP-specific and
HTTP is not part of this package.

Public messages are **static** (no parameter interpolation). Weaving instance
data (a decline reason, an id) into localized text is a catalog concern deferred
to a follow-up; see _Out of scope_.

### `PublicErrorRegistry`, deterministic resolution

The dangerous narrowing lives in a registered type-guard matcher, so the
projection stays typed:

```ts
registry.registerByCode<StructuredError<PaymentDetails>, { reason: string }>(
  "payment.declined",
  {
    publicCode: "payment.declined",
    userMessages,
    projectDetails: (error) => ({ reason: error.details.reason }),
  },
);

registry.register({
  match: (error): error is RateLimitError => error instanceof RateLimitError,
  definition: {
    publicCode: "rate_limited",
    userMessages: rateLimitedMessages,
  },
});
```

Resolution is deterministic and documented:

```text
1. exact StructuredError.code match (registerByCode)
2. predicate matchers (register) in registration order
3. generic fallback
```

Exact code first is the stable rule: a broad predicate matcher can never shadow
a precise code mapping. Registering the same internal code twice **throws** at
registration time. Among predicate matchers, registration order is the
tie-breaker and is part of the contract. A predicate matcher that **throws** is
treated as a miss and resolution continues with the next matcher (Invariant 14).

`registerByCode` is **nominally typed, not proven**: the type parameter is the
registrant's claim that only errors of this shape are thrown under this code. A
string key cannot prove it, so at runtime `projectDetails` receives whatever was
thrown under that code. Where that cannot be guaranteed, use `register` with a
type guard. Forcing a guard onto `registerByCode` is deliberately avoided: it
would kill the one-liner ergonomics and breed copy-paste `(e): e is X => true`
guards, which are worse than honest unsoundness. The real protection is the
controlled degradation of a throwing projection (Invariant 14), not a fake
guard.

An opt-in completeness check belongs in the consumer's composition root, not in
library initialization (the library does not know the universe of known codes):

```ts
registry.assertCoverage(knownCodes: readonly string[]): void;
// throws with the list of codes that have no definition
```

## The presenter: a total, transport-neutral contract over `unknown`

A real handler catches `unknown`, not a typed error. The presenter is **total**:
every input yields a safe view, including native `Error`, strings, rejected
promises, and programmer errors.

```ts
type PublicErrorView<TDetails = never> = {
  code: string; // publicCode
  message: string; // resolved.message
  locale: string; // resolved.locale
  details?: TDetails; // only via projectDetails, never `...error.details`
};

type PresentationOutcome =
  | { kind: "matched"; via: "code" | "predicate"; publicCode: string }
  | {
      kind: "fallback";
      reason: "no_definition" | "projection_failed" | "matcher_failed";
    };

interface PublicErrorPresenterOptions {
  registry: PublicErrorRegistry;
  fallback: { publicCode: string; userMessages: LocalizedMessageSet };
  // fire-and-forget telemetry; see "observability" below
  onPresent?: (
    error: unknown,
    view: PublicErrorView,
    outcome: PresentationOutcome,
  ) => void;
}

interface PublicErrorPresenter {
  present(
    error: unknown,
    context?: { locales?: readonly string[] },
  ): PublicErrorView;
}
```

`present` returns `PublicErrorView` (that is, `PublicErrorView<unknown>`): the
presenter cannot know at compile time which definition will match, so it does
not carry a `TDetails` parameter. The `TDetails` parameter on the view type
serves consumers who narrow the result themselves.

Resolution order:

```text
1. registry finds a definition for this error
   -> publicCode, resolve its userMessages, project allowed details

2. no definition matches
   -> generic fallback: publicCode "internal_error", the presenter's generic
      localized message set, no details
```

The generic fallback message is itself localized, so even an unmapped error
answers in the requested language:

```ts
const presenter = new PublicErrorPresenter({
  registry,
  fallback: {
    publicCode: "internal_error",
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "An unexpected error occurred.",
        de: "Ein unerwarteter Fehler ist aufgetreten.",
      },
    }),
  },
});

presenter.present(someUnknownError, { locales: ["de"] });
// { code: "internal_error", message: "Ein unerwarteter Fehler ist aufgetreten.", locale: "de" }
```

This is the safe replacement for the removed `expose` fallback: the public path
never reaches for the technical `message`, and an unmapped error degrades to a
generic localized view rather than leaking or throwing.

`code`, `message`, and `locale` come from the **same** resolver result and the
definition's `publicCode`, never from separate sources. Public `details` is a
distinct type from `StructuredError.details`, populated only by `projectDetails`.

### Totality requires defined exception semantics

Totality (Invariant 11) is only real if user code on the resolution path cannot
break it. Predicate matchers and `projectDetails` are user code. Two rules:

- A **predicate matcher throws** -> that matcher counts as a miss; resolution
  continues with the next matcher. The outcome reports `matcher_failed`.
- **`projectDetails` throws** -> the definition still counts as matched; the
  view is delivered **without** `details` (`code`, `message`, `locale` come from
  the definition as usual). The outcome reports `projection_failed`.

A full fallback to `internal_error` on a broken projection would be
overcautious: `publicCode` and the static message are safe, only the projection
failed. The user gets the correct error class; the operator gets the telemetry
event. This is the same "as much correct information as is safely possible"
philosophy as a locale miss. No exception from registered user code escapes
`present()`.

### Observability of degradation

A renamed `code` or a missing definition breaks the mapping **silently**: no
compile error, no runtime error, the error just degrades to the generic
fallback. Functionally safe, operationally blind, since a mapping regression is
then indistinguishable from a genuinely unknown error. The optional `onPresent`
observer makes every presentation visible:

```ts
const presenter = new PublicErrorPresenter({
  registry,
  fallback,
  onPresent: (error, view, outcome) => {
    if (outcome.kind === "fallback")
      metrics.increment(`error.fallback.${outcome.reason}`);
  },
});
```

The observer is fire-and-forget: invoked synchronously, exactly once per
`present()` call, and **if it throws, the presenter swallows the exception**.
Telemetry must never be able to break totality. What the consumer does with the
event (log now, hand to a `waitUntil`-style background channel) is outside this
package.

## Transport is a downstream concern, outside this package

The view carries public **meaning**, not transport. A status, header, exit code,
or gRPC code is mapped by an adapter that the consumer owns. Examples (all
outside this package):

```ts
// HTTP
const view = presenter.present(error, { locales: acceptedLocales });
return { status: httpStatusByPublicCode[view.code] ?? 500, body: view };

// CLI
const view = presenter.present(error, { locales: configuredLocales });
process.stderr.write(`${view.code}: ${view.message}\n`);
process.exit(exitCodeByPublicCode[view.code] ?? 1);

// gRPC
const view = presenter.present(error, context);
return {
  status: grpcStatusByPublicCode[view.code] ?? Status.UNKNOWN,
  message: view.message,
  metadata: { code: view.code, locale: view.locale },
};
```

No universal "transport status" field is introduced. A `status:
"client_error" | "server_error"` looks neutral but is a leaky abstraction: HTTP
codes, gRPC statuses, CLI exit codes, GraphQL's `200`-plus-errors convention,
and a message queue's retry/dead-letter/ack decision do not collapse into one
field. Each adapter maps `publicCode` to its own model, next to the adapter.

A correlation id (trace id) is likewise request context the adapter holds, not
part of the error's public meaning, so it is attached by the adapter rather than
by the view.

## Public presentation: explicit allowlist, no automatic passthrough

The security rule is positive, not a blocklist:

> A public view contains **no** property of the error automatically. It contains
> only fields the presenter assembles by an explicit rule.

This covers `message`, `details`, `cause`, `stack`, and the internal `code`.
`details` is as dangerous as `message` (emails, SQL, provider responses, file
paths, internal ids), so it is never spread; only `projectDetails` surfaces a
vetted, typed subset. The technical `message` is never an implicit public
fallback.

## Locale policy (one rule per side, consistent)

**On write** (`LocalizedMessageSet` construction):

- Canonicalize every key with `Intl.getCanonicalLocales`.
- Reject invalid tags (construction throws).
- Detect post-canonicalization collisions: `{ "de-de": ..., "de-DE": ... }` both
  canonicalize to `de-DE` and are a conflict, not silent last-write-wins.
- Reject empty or whitespace-only text: every message must contain at least one
  non-whitespace character. Contents are otherwise preserved and not trimmed.

**On read** (resolution):

- Canonicalize candidates; an invalid requested locale is treated as a **miss**
  and the resolver moves on. The resolver never returns an invalid tag.

Invalid tags are rejected at write time (trusted author input) and tolerated as
misses at read time (untrusted `Accept-Language`). One behavior per side.

### RFC 4647 lookup, stated precisely

Build the fallback chain by truncating from the right one subtag at a time.
Whenever truncation would leave a single-character **singleton** subtag (a `u`
extension, an `x` private-use marker, etc.) as the trailing subtag, remove that
singleton as well before continuing. The implementation must cover these with
dedicated test vectors, not only plain language-region tags:

```text
zh-Hant-TW          -> zh-Hant -> zh
de-DE-u-co-phonebk  -> de-DE   -> de
en-US-x-private     -> en-US   -> en
```

## Removal of `expose`, two separate operations

`expose` is removed with no `audience`-style replacement inside one serializer.
An `audience: "internal"` flag that lets the same path emit sensitive fields is
`expose` renamed. Instead there are two operations with two contracts:

```ts
presenter.present(error, { locales }); // public, allowlist only, transport-neutral
internalErrorSerializer.serialize(error); // full fidelity, internal only
```

## Consequence for #58

PR #58 placed the user-facing message on the response envelope under `ctx`. That
is replaced:

```text
Removed from the public response:
  error.ctx.message
  error.ctx.messageLocalized
  error.ctx               (the free-form context bag is removed from the public model)

New public representation (presenter-produced PublicErrorView):
  code     (publicCode)
  message  (resolved.message)
  locale   (resolved.locale)
  details? (explicit, typed projection only)
```

A free-form `ctx` bag on a public contract invites leaks, so it is gone. HTTP
status, trace id, and the envelope shape are now adapter concerns, outside this
package, not fields baked into a normative response type. `toProblemDetails` is
removed from the core; if a project wants RFC 9457, it is one transport adapter
over `PublicErrorView` (its `detail` is `view.message`, never technical text).
The standalone `errorResponse(...).localized(...)` builder is removed.

## Migration (replacing #58)

Removing `error.ctx.message` / `error.ctx.messageLocalized` from the public
response is a breaking change to the wire contract that frontends consume.

1. **Semver.** This is a **major** release. Public response fields are removed
   and core API is deleted: `withUserMessage`, `addLocalizedMessage`,
   `updateLocalizedMessage`, `getUserMessage`, `expose`, `toPublicJSON`,
   `toProblemDetails`, and `errorResponse(...).localized(...)`.
2. **Cutover.** Consumers are internal and under the same control; migration is
   atomic with the adapter update. There is no dual-shape transition window in
   which an adapter emits both `ctx.message` and the new view fields. (If
   external consumers ever exist, this clause must be revisited.)
3. **Migration checklist** (grepped off during implementation):
   - [ ] `withUserMessage` call sites
   - [ ] `addLocalizedMessage` / `updateLocalizedMessage` call sites
   - [ ] `getUserMessage` call sites
   - [ ] `expose` flag usages
   - [ ] `toPublicJSON` call sites
   - [ ] `toProblemDetails` call sites
   - [ ] `errorResponse(...).localized(...)` builder usages
   - [ ] Frontend reads of `error.ctx.message` / `error.ctx.messageLocalized`
   - [ ] Frontend reads of any other `error.ctx.*` field

## Invariants

1. The thrown error is always technical (`StructuredError` or `unknown`). No
   thrown public error subtype.
2. The core exposes no public serializer. `toPublicJSON` and `expose` are gone.
3. `baseLocale` is mandatory and explicit on every `LocalizedMessageSet`,
   including the presenter's generic fallback set. No hidden default.
4. A `LocalizedMessageSet` must contain an entry for its `baseLocale`;
   construction fails otherwise. Resolution therefore never returns `undefined`.
5. Every message contains at least one non-whitespace character; contents are
   otherwise unmodified.
6. Locale tags are canonicalized on both write and read; invalid tags are
   rejected on write and treated as misses on read.
7. `baseLocale` is appended to the preference list only after supplied locales
   are deduped; `match: "base"` applies only to that appended entry.
8. Registry resolution is deterministic: exact code match, then predicate
   matchers in registration order, then generic fallback. Registering the same
   internal code twice throws.
9. The view's `code`, `message`, and `locale` derive from one resolver result
   and the definition's `publicCode`; never from separate or implicit sources.
10. No core field crosses a public boundary automatically; only an explicit,
    typed allowlist (`publicCode`, resolved message, projected details) does.
11. The presenter is total over `unknown`: an unmapped input yields a safe
    generic localized view.
12. The presenter output is transport-neutral. No status, header, exit code, or
    channel concept appears in `PublicErrorView` or `PublicErrorDefinition`.
13. Every degradation to the generic fallback is observable via the presenter's
    `onPresent` observer; the observer is fire-and-forget and cannot influence
    or break presentation (a throwing observer is swallowed).
14. A throwing predicate matcher is a miss; a throwing `projectDetails` yields
    the matched view without `details`. Both are reported through the observer.
    No exception from registered user code escapes `present()`.
15. Registry type safety holds at the registration boundary only; stored
    definitions are type-erased; runtime resilience at projection time
    (Invariant 14) covers the gap. `registerByCode` is a nominal claim, not a
    proof.

## Runtime compatibility (normative)

The package must run in edge runtimes (workerd / Cloudflare Workers, Vercel
Edge, Bun, Deno), not only Node. The design is already edge-clean (no I/O, no
transport, no dependencies), but three guarantees are made explicit or they
erode:

1. **Target platform.** The package uses only ECMAScript language features
   (<= ES2022, including `Error.cause`) plus `Intl.getCanonicalLocales`. No
   Node, DOM, or runtime-specific API. `Intl.getCanonicalLocales` is ECMA-402
   core, available in all target runtimes, with no ICU data dependency. The
   package must **never** widen to `Intl.Locale`, `Intl.DisplayNames`, or other
   data-dependent Intl APIs.
2. **V8 comfort APIs are feature-detected.** If the core constructor trims its
   own frame:

   ```ts
   if (typeof Error.captureStackTrace === "function") {
     Error.captureStackTrace(this, new.target);
   }
   ```

   `stack` is treated as an **opaque string** everywhere (V8 and JSC/SM formats
   differ); the internal serializer passes it through and never parses it, and
   it traverses the `cause` chain itself rather than relying on runtime
   formatting.

3. **Forbidden in package code, enforced by lint** (`no-restricted-globals` /
   `no-restricted-imports`): `process.*` (including `process.env.NODE_ENV`; any
   dev mode is an explicit constructor option), `Buffer`, `util.inspect`, and
   any `node:` import including `node:util` / `node:assert`.
4. **Runtime test matrix in CI.** "Edge-compatible" is a test matrix, not a
   README claim. Because the library has no I/O, the _same_ suite (RFC 4647
   vectors, totality cases, registry determinism) runs unmodified on Node LTS
   (vitest), workerd via `@cloudflare/vitest-pool-workers` (the real Workers
   runtime catches what Node cannot: `captureStackTrace` assumptions, accidental
   globals), Bun, and optionally Deno. Spec semantics relied upon (for example
   `getCanonicalLocales` throwing `RangeError` on structurally invalid tags,
   which is exactly the write-reject / read-miss split) are engine-independent;
   one legacy-tag vector (`iw`) documents observed canonicalization behavior.

## Implementation notes (informative)

To save the implementer days against the type checker:

- **Registry storage is type-erased by design.** A heterogeneous collection of
  `PublicErrorDefinition<TError, TDetails>` with varying parameters cannot
  preserve those types in TypeScript (existential-type erasure). The honest
  pattern: full type checking at the **registration boundary**
  (`registerByCode<TError, TDetails>` and `register` with a guard validate that
  `projectDetails` matches the claimed or proven type), internal storage as
  `PublicErrorDefinition<unknown, unknown>` with exactly one documented cast at
  the storage boundary, and runtime resilience at projection time (Invariant
  14). Do **not** attempt a mapped-type schema registry
  (`Registry<{ "payment.declined": PaymentError }>`); it breaks incremental
  registration and predicate matchers and is the wrong ergonomics for a library.
- **`onPresent` plumbing:** synchronous, wrapped in try/catch so it is
  non-throwing from the presenter's perspective; edge consumers typically bridge
  it to `waitUntil`-style telemetry, which is their concern, not the package's.

## Why localized text is not in the core (channels are output, not domain)

Email, SMS, CLI, gRPC, and HTTP are output channels, not reasons to embed text
in the error. They argue for an adapter per channel over a neutral view, not for
a text field on the error instance. The same `payment.declined` renders
differently per channel: an HTTP body, a 160-character SMS, a developer-facing
CLI line. The adapter owns those differences; the error owns only what failed.

The genuine exception is when localized text is itself domain data (notification
templates, legally mandated wording, user-authored multilingual templates). That
belongs in a domain text/template model, not as presentation text on a domain
error. Even there, an error such as `MissingTranslationError` carries
`{ locale, templateId }`, not the rendered text.

## Packaging (decision)

`/presentation` is a **subpath export** of one package, not a separate package.
`exports` maps work cleanly in Node >= 12.20, all bundlers, and TypeScript
(`moduleResolution: "bundler"` / `"nodenext"`); tree-shaking keeps core-only
consumers free of presentation bytes; a second package would impose
version-lockstep maintenance for nothing. `"sideEffects": false`, pure ESM, one
build with no per-runtime export conditions: the package ships **one** artifact
that runs everywhere, which is the stronger position. The `presentation -> core`
direction is enforced by an ESLint boundary rule.

## Alternatives considered

- **Keep localization on `BaseError`/`StructuredError`, fix the invariants.**
  Rejected. A library cannot enforce layering; the honest defense is to not offer
  the feature on the shared base.
- **A thrown `class PublicError extends StructuredError`.** Rejected. The same
  instance would carry both technical and public data.
- **An instance-level `PublicError` value object.** Folded into
  `PublicErrorDefinition` plus `PublicErrorView`; a third runtime carrier added
  nothing.
- **A channel presenter in the package (`errors/http`, `PublicHttpErrorPresenter`,
  `{ status, body }`, `httpStatus` on the definition).** Rejected. HTTP is one
  adapter among many; baking it in makes the core architecture channel-specific.
  The presenter produces a neutral `PublicErrorView`; adapters live with the
  consumer.
- **A universal transport status field** (`status: "client_error" |
"server_error"`, or a numeric status on the view). Rejected as a leaky
  abstraction; transport status models do not unify.
- **A: no localization anywhere in the package.** Purest, but drops a useful
  batteries-included path; presentation (B) serves it without contaminating the
  core.
- **Keep a minimal `toPublicJSON` on the core.** Rejected; even a generic-message
  public method is public-presentation logic in the core.
- **`expose` / `audience` flag.** Rejected; the original footgun renamed.
- **`getUserMessage({ locale, fallbackLocales })`.** Rejected for an asymmetric
  split; unified to `resolve(set, { locales })`.
- **Flat `source: "exact" | "parent" | "fallback" | "base"`.** Rejected as
  ambiguous; replaced by `matchedPreferenceIndex` plus `match`.
- **`projectDetails: (error: unknown) => TDetails`.** Rejected for forcing casts;
  the definition is generic over `TError` and narrowing lives in the matcher.

## Out of scope / open

- **Transport adapters** (HTTP, gRPC, CLI, GraphQL, messaging) and their
  `publicCode`-to-status mapping. Optional adapters may map `PublicErrorView` to
  channel-specific representations; transport metadata is not part of
  `PublicErrorDefinition` or `PublicErrorView`.
- **Parameter interpolation** in public messages. Messages are static here; a
  catalog with params keyed by `code` is the recommended path and its own
  proposal. Until that exists, the intended path for dynamic data in user-facing
  messages is structured data via `projectDetails` plus client-side i18n keyed on
  `publicCode`. Naming this prevents every consumer from inventing a different
  workaround (worst case: smuggling raw strings through `details` and de-facto
  moving localization to the client unplanned).
- **Per-request or per-tenant overrides** of definitions (white-label wordings)
  are not part of this proposal. The foreseen extension point is a decorated
  registry, not a widened presenter context, so `present()`'s context does not
  become a dumping ground later.
