---
name: base-error
description: >
  Use @shirudo/base-error to model errors as typed values, log them with
  redaction, and turn them into safe client output. Covers BaseError,
  StructuredError, defineErrors (with a prefix for dotted codes), detailsType,
  CatalogError, Catalog.match, matchError, matchThrown, defineErrorClassSet,
  guard, the type guards, toStructuredError, ValidationError,
  StructuredAggregateError, toLogObject, logObjectOf, redact, redactAllow,
  redactWith, the public-error subpath (definePublicErrors, project, localize, toProblem,
  LocalizedMessageSet, PublicCodeOf), the pino subpath (pinoErrorOptions) and
  the Sentry subpath (beforeSend, logObjectContextIntegration). Activate when
  defining error classes or catalogs (also with dotted codes such as
  context.area.reason), handling a caught value, logging or redacting errors,
  reporting to pino or Sentry, mapping errors to an HTTP response, a server
  function result or an RFC 9457 problem body, localizing error messages, or
  upgrading from an older major version.
metadata:
  type: "core"
  library: "base-error"
  library_version: "10.0.1"
  repository: "shi-rudo/base-error-ts"
  sources: "src/index.ts, src/public-error/index.ts, src/errors/catalog.ts, src/errors/StructuredError.ts, src/errors/BaseError.ts, src/public-error/PublicErrorCatalog.ts, src/public-error/types.ts, src/pino/index.ts, src/sentry/index.ts, docs/guide, MIGRATION.md"
---

# base-error: typed errors and safe client output

`@shirudo/base-error` models a failure as a technical error with a stable
`code`, a `category`, a `retryable` flag, `details` and a `cause` chain. The
core has no client serializer. Anything a client sees goes through the
separate public-error pipeline at `@shirudo/base-error/public-error`.

It needs Node.js 24 or later (or an edge runtime or browser). It ships one ES
module build, and `require()` loads it on Node.js 24. An ES module project
needs TypeScript 5.0 or later. A TypeScript project that compiles to CommonJS
needs `module: nodenext` with TypeScript 5.8 or later, `module: node20` with
TypeScript 5.9 or later, or `module: commonjs` with TypeScript 5 or 6;
TypeScript 7 removed its resolution `node10`. `module: node16` fails with
TS1479. It has no runtime dependencies.

## Two output paths

| Path | API | Carries |
| --- | --- | --- |
| Logs, Sentry, APM | `toLogObject()`, `toJSON()` (an alias), `logObjectOf(value)` | everything: technical message, stack, cause chain, full `details`, after redaction |
| Client | `project` → optional `localize` → `toProblem` | only what a registered descriptor allows: public code, public category, vetted details, optional localized text |

Keep them apart. `res.json(error)`, `Response.json(error)`, `JSON.stringify(error)`
and returning the error from a handler all reach `toJSON()` and leak the full
log object. The default error handler of a framework reads the error itself:
Fastify 5 without `setErrorHandler` sends `code` and `message`, and Express 5
sends the stack when `NODE_ENV` is not `production`.

## Core workflow

1. **Define** the errors a component owns in a catalog with `defineErrors`:
   per key a `category`, `retryable`, a compile-time `details` type
   (`detailsType<T>()`), optional `metadata` and an optional log redaction
   policy. Keep one catalog per ownership boundary. A flat code such as
   `ORDER_NOT_FOUND` is the key itself. For a dotted code such as
   `restaurant.authz.not_a_member`, pass `{ prefix: "restaurant.authz" }` and
   use the last segment as the key; the catalog derives `${prefix}.${key}`.
2. **Create** an error through the catalog's factory,
   `Errors.create.KEY(message, { details, cause })`. The message is technical,
   for logs only.
3. **Handle** a caught value: narrow it with `Errors.is(e)` or
   `Errors.is(e, "KEY")`, then dispatch with `Errors.match(e, { KEY: … })` or
   `matchError`, which fail to compile when a case is missing. For values the
   application does not own, use `matchThrown(e)…otherwise(…)`.
4. **Log** through the setup of the sink: `pinoErrorOptions` from
   `@shirudo/base-error/pino`, `beforeSend` and
   `logObjectContextIntegration()` from `@shirudo/base-error/sentry`, and
   `logObjectOf(e)` for any other logger or reporter. Redaction set with
   `redact`, `redactAllow` or the catalog's policy applies there. A sink that
   reads the error object itself bypasses it.
5. **Publish** at the boundary: register technical codes in a
   `definePublicErrors` catalog, call `project(catalog, error)` for a
   message-free view, `localize` it if the backend renders text, and
   `toProblem` it for an HTTP response.

## Choose the tool

| Need | Use |
| --- | --- |
| A closed set of errors a component owns | `defineErrors` catalog, `CatalogError<typeof Errors>` for the union |
| Dotted codes such as `restaurant.authz.not_a_member` | `defineErrors({ not_a_member: … }, { prefix: "restaurant.authz" })`; `Errors.code.not_a_member` for the full code |
| One bespoke error with its own fields | a `StructuredError` subclass, own log fields via `buildOwnLogFields()` |
| Several field-level input failures | `ValidationError` with `addIssue`, `publicIssues()` for the client |
| Several branch failures at once | `StructuredAggregateError({ …, errors })` |
| An unknown caught value that must become loggable | `toStructuredError(e, { code, category, retryable })`, at a boundary only |
| A closed group of local Error classes | `defineErrorClassSet({ … }).match(e, { … })` |
| Retry decisions deeper in the chain | `someChainRetryable`, `isChainRetryable`, `getRootCause` |
| An invariant | `guard(condition, error)`, which narrows on the true path |

## Rules

- Never send `toLogObject()`, `toJSON()` or the error object to a client.
  Produce client output with `project`, and `toProblem` for HTTP.
- Install an error handler of your own in every HTTP framework, and send only
  the `toProblem` result from it. Do not rely on a default error handler.
  Register the errors that the framework raises for a bad request, or the
  fallback answers them with `500`: in Fastify by `code`, such as
  `FST_ERR_VALIDATION` and `FST_ERR_CTP_INVALID_JSON_BODY`, and for
  `express.json()` by `type`, such as `entity.parse.failed`, with `register`.
- `project` never throws: a value that matches no descriptor becomes the
  catalog's `fallback`. Register every code that should reach a client, and
  report `kind: "fallback"` outcomes from `onProject` so a missing
  registration is visible.
- `details` never cross on their own. Only `projectDetails` and
  `projectFields` put vetted data into the view.
- The public code, category and retryable flag are declared per descriptor.
  They are not the internal `code`, `category` or `retryable`.
- `catalog.messagesFor(code)` returns `undefined` for a code without
  `userMessages`; guard it before `localize`, which throws on a missing set.
- A `StructuredError`'s `name` is its `code`. Check with `instanceof`,
  `isStructuredError` or the code, never `name === "StructuredError"`.
- Structural guards (`isError`, `hasErrorCode`, `isStructuredError`,
  `isRetryable`) can be forged. Use `Errors.is(…)` when behavior depends on
  membership in your own catalog.
- `detailsType<T>()` checks nothing at runtime. Validate untrusted data before
  it reaches a factory.
- In a catalog with a prefix, `create`, `code`, `match`, `is` and
  `CatalogErrorOf` take the key; `meta` takes the code (`Errors.meta(e.code)`).
  Never write a separate object of code constants next to the catalog.
- A key rename changes the code, which logs and dashboards read. Pin the codes
  of each catalog in a test: `expect(Errors.codes).toEqual([…])`.
- Redaction rewrites the log object. `err.stack` and `console.log(err)` still
  show the raw message; log through a structured logger.
- `publicIssues({ messages: true })` passes validator messages through
  unchanged. Use it only for messages you wrote.
- Use `toStructuredError` at a boundary, for observability. Rethrow
  programmer bugs (`TypeError`, `RangeError`, failed assertions) instead of
  wrapping them.

## Find the details

| Reference | Read when |
| --- | --- |
| `references/catalogs-and-classes.md` | defining catalogs, dotted codes with a prefix, composing catalogs, subclassing `StructuredError`, `ValidationError`, aggregates |
| `references/handling-caught-errors.md` | guards, `Catalog.match`, `matchError`, `matchThrown`, class sets, `toStructuredError`, cause chains, retryability |
| `references/logging-and-redaction.md` | `toLogObject`, `logObjectOf`, the pino and Sentry setups, redaction, own log fields, `fromJSON` |
| `references/public-error.md` | `definePublicErrors`, descriptors, `project`, `localize`, `toProblem`, typed public codes, server functions |
| `references/migration.md` | code written against an older major, or an API this skill does not name |

The guide in `docs/guide/` and `MIGRATION.md` of the repository
(https://github.com/shi-rudo/base-error-ts) are the source of truth. When this
skill and the library disagree, the library wins; compile against the installed
package.
