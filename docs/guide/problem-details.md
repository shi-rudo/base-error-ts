# RFC 9457 Problem Details

The optional `@shirudo/base-error/problem-details` subpath maps a safe,
localized `PublicErrorView` to framework-neutral HTTP Problem Details. It does
not accept technical errors and does not construct a framework-specific
response. The wire model follows
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).

```ts
import { defineProblemDetailsAdapter } from "@shirudo/base-error/problem-details";

const problems = defineProblemDetailsAdapter({
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
  fallback: {
    type: "https://api.example.com/problems/internal-error",
    status: 500,
  },
});
```

Definitions are finite, non-empty and snapshotted when the adapter is created.
Statuses must be integers from 100 through 599. Type URI references remain
application-owned; absolute documentation URIs are recommended for custom
problem types.

`about:blank` remains valid, but RFC 9457 recommends that its `title` equal the
HTTP status phrase. Because the adapter derives `title` from `view.message`, use
`about:blank` only when that public message follows this rule.

## Mapping a public view

```ts
const view = presenter.present(error, { locales: ["en"] });
const result = problems.map(view, {
  instance: `https://api.example.com/problem-occurrences/${occurrenceId}`,
  detail: "The requested account no longer exists.",
  extensions: { retry_after: 30 },
});
```

The result contains everything a framework adapter needs:

```ts
{
  status: 404,
  headers: {
    "content-type": "application/problem+json",
    "content-language": "en"
  },
  body: {
    type: "https://api.example.com/problems/account-not-found",
    title: "Account not found",
    status: 404,
    detail: "The requested account no longer exists.",
    instance: "https://api.example.com/problem-occurrences/p-123",
    details: { accountId: "a-123" },
    retry_after: 30
  },
  outcome: {
    mapping: "definition",
    publicCode: "ACCOUNT_NOT_FOUND",
    omitted: []
  }
}
```

`view.message` becomes the localized `title`: presentation messages are stable
per public code and vary only by locale. `detail` is optional and explicit
because it describes this occurrence. Never pass a technical error message as
the public detail.

## Fetch and Workers

```ts
const mapped = problems.map(view, {
  instance: new URL(`/problem-occurrences/${id}`, request.url).href,
});

return new Response(JSON.stringify(mapped.body), {
  status: mapped.status,
  headers: mapped.headers,
});
```

The adapter does not depend on `Response`, Node.js globals or framework APIs,
so the same mapping works in browsers and isolate runtimes.

## Express and Node.js frameworks

```ts
const mapped = problems.map(view, { instance: occurrenceUri });

res.status(mapped.status).set(mapped.headers).json(mapped.body);
```

The wrapper keeps the actual response status and the advisory body status tied
to the same immutable definition.

## Details and extensions

Explicitly projected `PublicErrorView.details` is copied into the reserved
top-level `details` extension. Additional extensions must be JSON-safe and
cannot replace `type`, `title`, `status`, `detail`, `instance`, or `details`.

Extension validation is atomic. If an extension object contains a cycle,
function, symbol, `BigInt`, non-finite number, sparse array, non-plain object or
reserved field, the whole extension object is omitted. Invalid projected
details are omitted independently. Inspect `outcome.omitted` for telemetry.

Every returned object and every copied nested value is frozen. Mutating a
source definition, details object or extension object after mapping cannot
change a previous result.

## Fallback behavior

An unmapped public code uses the mandatory fallback definition:

```ts
const result = problems.map(unmappedView);
result.outcome.mapping; // "fallback"
```

This keeps the adapter total over valid `PublicErrorView` values while making a
missing mapping observable.

## `instance` and privacy

`instance` is a URI reference identifying one concrete occurrence. RFC 9457
allows absolute, relative, dereferenceable and opaque values, so its TypeScript
type is intentionally `string`. Absolute URIs are recommended when possible.

Treat occurrence identifiers as public data. Do not embed database keys,
credentials, stack information or internal tracing data unless disclosure is
explicitly intended. The adapter does not generate, dereference or authorize
access to occurrence URIs.

## Deliberate boundaries

- no direct `Response` or framework integration
- no Accept-header negotiation or XML output
- no URI dereferencing or occurrence-ID generation
- no technical-error input or automatic logging
- no runtime schema validation beyond JSON-safe public details and extensions
