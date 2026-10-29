# Migrating from an older major

`MIGRATION.md` in the repository is the full guide. This table maps the APIs
that older code, older docs and older skills still name onto version 10.

| Found in old code | Since | Use instead |
| --- | --- | --- |
| `toProblemDetails()`, `toErrorResponse()`, `toPublicJSON()` | removed in 6 | `project` + `toProblem` from `@shirudo/base-error/public-error` |
| `errorResponse`, `createErrorResponse`, `ErrorResponse`, `ApiResponse`, `ErrorResponseBuilder` | removed in 6 | build the wire shape from a `PublicError` view, or use `toProblem` |
| `withUserMessage()`, `addLocalizedMessage()`, `getUserMessage()`, `LocalizedMessage`, `.localized()` | removed in 6 | `userMessages: new LocalizedMessageSet(…)` on a descriptor, `localize(view, set, { locales })` |
| `expose`, `exposeToClients()` | removed in 6 | nothing; the core has no public serializer |
| `AppErrors.CODE(…)` | changed in 7 | `AppErrors.create.CODE(…)` |
| HTTP status as a top-level definition field | changed in 7 | `metadata: { httpStatus }`, read with `meta(code)` |
| `@shirudo/base-error/presentation`, `PublicErrorPresenter`, `PublicErrorRegistry`, `present()` | removed in 8 | `definePublicErrors` + `project` (+ `localize`) |
| `PublicErrorDefinition` | renamed in 8 | `PublicErrorDescriptor`, which also carries `status`, `type`, `title` |
| `@shirudo/base-error/problem-details`, `defineProblemDetailsAdapter(…).map(…)` | removed in 8 | `toProblem(catalog, view, { extensions })` |
| `LocalizedMessageSet` from `/presentation` | moved in 8 | import it from `/public-error` |
| `buildLogObject()` overrides | removed in 9 | `buildOwnLogFields()`, returning only the own fields |
| Node.js 20 or 22 | dropped in 9 | Node.js 24 or later; browsers and edge runtimes are unaffected |
| `publicIssues()` including messages | changed in 9 | `publicIssues({ messages: true })`, only for messages you wrote |
| a `null` cause walked as a link | changed in 9 | a nullish cause ends the chain |
| `[Circular cause chain]` for a shared cause | changed in 9 | `[Shared cause]` |
| the CommonJS build of the package | removed in 10 | the one ES module build; `require()` loads it on Node.js 24, and `import` and `require` load the same classes |
| TypeScript CommonJS output with `module: node16`, or `module: nodenext` before TypeScript 5.8 (TS1479) | changed in 10 | `module: nodenext` with TypeScript 5.8 or later, `module: node20` with 5.9 or later, or ES module output; `module: commonjs` keeps compiling |
| a hand-written pino `err` serializer or `logMethod` hook around `logObjectOf` | replaced in 10 | `pinoErrorOptions` from `@shirudo/base-error/pino` |
| `Sentry.captureException(error, { extra: error.toLogObject() })` | a leak; replaced in 10 | `beforeSend` and `logObjectContextIntegration()` from `@shirudo/base-error/sentry` |
| a catalog keyed by a dotted code, with a separate object of code constants | new in 10 | `defineErrors({ key: … }, { prefix })`, see `catalogs-and-classes.md` |

When code names an API that is in neither this skill nor the table, check
`src/index.ts`, `src/public-error/index.ts`, `src/pino/index.ts` and
`src/sentry/index.ts` before using it.
