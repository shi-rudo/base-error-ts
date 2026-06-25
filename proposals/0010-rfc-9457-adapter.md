# Proposal 0010: framework-neutral RFC 9457 adapter

**Status:** Superseded by 0011. The `problem-details` adapter
(`defineProblemDetailsAdapter`) was removed in 8.0.0; its RFC 9457 mapping and
typed extensions live in the `public-error` pipeline's `toProblem`. Kept for
design history.

## Decision

Add `@shirudo/base-error/problem-details`, an optional zero-dependency subpath
that maps `PublicErrorView` values to a framework-neutral result containing an
HTTP status, RFC 9457 headers, a Problem Details body and mapping diagnostics.

The adapter accepts only already-public views. Technical errors remain in the
core/logging path and never enter this serializer.

```ts
const adapter = defineProblemDetailsAdapter({
  definitions: {
    ACCOUNT_NOT_FOUND: {
      type: "https://api.example.com/problems/account-not-found",
      status: 404,
    },
  },
  fallback: {
    type: "https://api.example.com/problems/internal-error",
    status: 500,
  },
});

const result = adapter.map(view, {
  instance: "/problem-occurrences/p-123",
  detail: "The requested account no longer exists.",
  extensions: { retry_after: 30 },
});
```

## Semantics

- `view.message` maps to the localized `title`.
- `detail` and `instance` are explicit per-occurrence strings.
- `view.details` maps to the reserved `details` extension.
- additional extensions are top-level JSON-safe members.
- response status and body status always come from one immutable definition.
- unknown public codes use a mandatory explicit fallback.
- `outcome` exposes definition/fallback selection and omitted unsafe values.

Definitions, results, details and extensions are copied and frozen. Malformed
definitions fail when the adapter is created. Invalid projected details or
extensions are omitted rather than breaking the error-response path.

## Type model

The subpath exports `ProblemDetails`, `ProblemDetailsAdapter`,
`ProblemDetailsAdapterConfig`, `ProblemDetailsContext`,
`ProblemDetailsDefinition`, `ProblemDetailsDefinitionMap`,
`ProblemDetailsExtensions`, `ProblemDetailsJsonValue`,
`ProblemDetailsOutcome`, and `ProblemDetailsResult`.

`PublicErrorView` gains an additive second generic parameter for its public-code
literal. Known codes preserve exact type URI and status literals; open string
codes produce the union of mapped and fallback values.

## Security

Reserved core members cannot be overridden by extensions. JSON validation
rejects cycles, functions, symbols, `BigInt`, non-finite numbers, sparse arrays
and non-plain objects. Null-prototype snapshots prevent prototype pollution.

The adapter does not validate URI-reference grammar, generate occurrence IDs,
or decide whether an occurrence URI is safe to disclose. These are application
policy decisions.

## Non-goals

- direct Fetch, Express or framework response construction
- HTTP content negotiation or XML
- URI dereferencing
- logging, correlation or occurrence-ID generation
- direct conversion from technical errors
- compile-time synchronization with a separately constructed public registry

## Verification

- runtime and compile-only contract tests
- malformed configuration and unsafe JavaScript caller tests
- status-boundary, URI-variant and fallback tests
- JSON-safety, collision, mutation and prototype-pollution tests
- 100% statement, branch, function and line coverage for the subpath
- Node.js and Workers execution
- zero root-bundle delta and a measured subpath bundle below 3 KB gzip
- npm and JSR package dry-runs plus ESM and CommonJS consumer smoke tests

## Completion review

- Node.js: 389 tests passed.
- Workers: 373 tests passed on workerd.
- The problem-details subpath has 100% statement, branch, function and line
  coverage, enforced in configuration.
- The root ESM bundle remains exactly 36,891 bytes / 9,677 bytes gzip; the root
  CJS bundle remains exactly 37,640 bytes / 9,808 bytes gzip.
- The new subpath is 8,200 bytes / 1,968 bytes gzip for ESM and 8,275 bytes /
  1,989 bytes gzip for CJS.
- npm ESM/CommonJS consumer smoke tests and npm/JSR package dry-runs pass.
