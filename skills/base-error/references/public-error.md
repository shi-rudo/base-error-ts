# The public-error pipeline

Import from the subpath:

```ts
import {
  definePublicErrors,
  LocalizedMessageSet,
  project,
  localize,
  toProblem,
  type PublicCodeOf,
  type PublicError,
} from "@shirudo/base-error/public-error";
```

Three independent stages over one descriptor per public code:

1. `project(catalog, error)` → a message-free, frozen `PublicError` view. This
   is the security boundary.
2. `localize(view, messages, { locales })` → adds `message` and `locale`.
   Optional; skip it when the client localizes.
3. `toProblem(catalogOrTransport, view, context?)` → `{ status, headers, body,
   outcome }`, an RFC 9457 problem body.

## The catalog

```ts
export const publicErrors = definePublicErrors({
  fallback: {
    publicCode: "internal_error",
    status: 500,
    category: "internal",
    retryable: false,
  },
  onProject: (error, view, outcome) => {
    if (outcome.kind === "fallback") logger.warn({ publicCode: view.code, outcome }, "unmapped error");
  },
})
  .registerByCode("ORDER_NOT_FOUND", {
    publicCode: "order_not_found",
    status: 404,
    category: "not_found",
    retryable: false,
    projectDetails: (e: OrderNotFound) => ({ orderId: e.details?.orderId }),
  })
  .registerByCode("STOCK_RESERVATION_FAILED", {
    publicCode: "temporarily_unavailable",
    status: 503,
    category: "temporary",
    retryable: true,
  })
  .register({
    match: (e): e is ValidationError => e instanceof ValidationError,
    descriptor: {
      publicCode: "validation_failed",
      status: 422,
      category: "validation",
      retryable: false,
      projectFields: (e) =>
        e.publicIssues().map((i) => ({ field: i.pointer ?? "", code: i.code ?? "invalid" })),
    },
  });
```

- `registerByCode` keys on the technical `code`; `register({ match, descriptor })`
  keys on a type guard and is tried after the code matches.
- Several technical codes may map to one public code, but they must agree on
  its transport (`status`, `type`, `title`, `category`); registration rejects a
  conflict. Two descriptors that both declare `userMessages` must declare the
  same messages. `retryable` is not compared.
- `definePublicErrors({ fallback, categories })` declares the public
  categories. The catalog then rejects any other category, and the fallback
  must declare one: it is the bucket a client uses for a code it does not
  know. Without `categories`, nothing checks a category.
- `assertCoverage(codes)` throws at startup when a listed technical code has no
  descriptor, for example `publicErrors.assertCoverage(OrderErrors.codes)`.
- `new PublicErrorCatalog(…)` works too, but leaves the public-code union as
  plain `string`; prefer `definePublicErrors`.

### Descriptor fields

| Field | Kind | Meaning |
| --- | --- | --- |
| `publicCode` | wire identity | the code the client sees; not the technical code |
| `status` | wire identity | HTTP status, an integer from 100 to 599 |
| `type`, `title` | wire identity | RFC 9457 type URI and static title |
| `category` | wire identity | the public category; the internal one never crosses |
| `retryable` | public value | the public flag; the internal one never crosses |
| `userMessages` | messages | a `LocalizedMessageSet` of end-user text |
| `projectDetails` | projector | vetted `details` for the view |
| `projectFields` | projector | field faults, `{ field, code }[]` |
| `projectRetryable`, `projectRetryAfter` | projectors | per-occurrence overrides |

A projector reads a typed subset of the error. The raw error is never spread
into the view. A throwing projector costs only its own member and is reported
to `onProject`.

## The stages

```ts
// Client localizes (SPA, edge): stop after project.
const view = project(publicErrors, error);

// Backend localizes (SSR, email): guard the message set.
const set = publicErrors.messagesFor(view.code);
const localized = set ? localize(view, set, { locales: ["de", "en"] }) : view;

// HTTP response.
const { status, headers, body } = toProblem(publicErrors, localized, { instance: traceId });
return Response.json(body, { status, headers });
```

- `project` takes `unknown` and never throws. An unregistered value becomes
  the fallback.
- `localize` throws when the message set is missing, so guard `messagesFor`.
- `toProblem` deep-copies `details`, `fields` and `extensions` into JSON-safe
  data. If any part of one member is not JSON-safe, such as a `Date`, it drops
  that whole member and lists it in `outcome.omitted`. Return only JSON-safe
  data from a projector. `title` is the localized message when there is one,
  otherwise the descriptor's static `title`.
- The first argument of `toProblem` may be an explicit transport,
  `{ status, type?, title? }`, instead of the catalog.
- Every stage has a catalog-free form: `projectWithDescriptor(descriptor,
  error)`, `localize` itself, `toProblem(transport, view)`.

## Server functions and RPC

A server function returns the view, a plain message-free object that
serializes as it is. Catch at the function's edge and project there, so that a
rethrown infrastructure error never reaches the client with its message:

```ts
try {
  return { ok: true, value: await placeOrder(input) } as const;
} catch (e) {
  logger.error({ err: e }, "placeOrder failed"); // a pino logger with pinoErrorOptions
  return { ok: false, error: project(publicErrors, e) } as const;
}
```

## Typed public codes

`PublicCodeOf<typeof publicErrors>` is the union of registered public codes.
Share it with the client and switch on `view.code` exhaustively. A client that
reads a code from the wire should check it against the known codes and fall
back to the fallback code for anything else.
