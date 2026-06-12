# BaseError

`BaseError<T, TPublicCode>` is the foundation. Extend it for bespoke errors, or
reach for [`StructuredError`](./structured-error) when you want typed codes and
categories out of the box.

```ts
import { BaseError } from "@shirudo/base-error";

class PaymentDeclinedError extends BaseError<"PaymentDeclinedError"> {
  constructor(reason: string, cause?: unknown) {
    super(`Payment declined: ${reason}`, cause);
  }
}
```

The generic parameter `T` is the error's `name`. It is inferred from the
constructor by default and narrows the discriminant `_tag` for exhaustive
`switch` handling.

## Constructor

```ts
new BaseError(
  message: string,
  cause?: unknown,
  options?: {
    name?: string;        // override the runtime name (defaults to constructor name)
    publicCode?: string;  // stable, client-safe code
    publicMessage?: string; // client-safe message
    expose?: boolean;     // allow technical fallback in public serializers
  },
);
```

## Properties

| Property | Description |
| --- | --- |
| `name` | Error type name (`T`) |
| `_tag` | Discriminant for narrowing, defaults to the constructor name |
| `message` | Technical message (for logs) |
| `cause` | Native cause where supported, preserved cross-runtime |
| `stack` | Richest stack the host can provide |
| `timestamp` | Epoch-ms number |
| `timestampIso` | ISO-8601 string |

## User-facing & public messages

A fluent, chainable API configures what the error may show to humans and
clients:

```ts
const err = new PaymentDeclinedError("insufficient funds")
  .withUserMessage("Your card was declined.")
  .addLocalizedMessage("de", "Ihre Karte wurde abgelehnt.")
  .withPublicCode("PAYMENT_DECLINED")
  .withPublicMessage("Your payment could not be processed.");
```

| Method | Purpose |
| --- | --- |
| `withUserMessage(msg)` | Default user-friendly message |
| `addLocalizedMessage(lang, msg)` | Add a localized message |
| `updateLocalizedMessage(lang, msg)` | Update an existing localized message |
| `withPublicCode(code)` | Stable client-safe code |
| `withPublicMessage(msg)` | Client-safe message |
| `exposeToClients(expose?)` | Opt in to exposing technical fields |
| `getUserMessage(options?)` | Resolve the user message (with locale) |

### When server-side localization makes sense

Localization is usually a presentation concern: the client maps the stable
`code` to its own translations, so most apps never need a localized message on
the error at all. The `code` is the real contract — `addLocalizedMessage` is an
**opt-in escape hatch** for the paths where the server renders the final text
and no UI sits in between:

- **No UI in between** — emails, push notifications, SMS: the server produces
  the text the human reads.
- **Clients that can't localize** — third-party integrations, a CLI, a simple
  public API that returns plain text.
- **Data only the server has** — interpolation with values the UI doesn't know.

For everything else, prefer the `code` and let the client localize. When you do
add localized messages, [`toErrorResponse()`](./error-responses#localized-messages)
and [`toProblemDetails()`](./problem-details) resolve them by `locale` for you.

## Serialization

| Method | Path | Contents |
| --- | --- | --- |
| `toLogObject()` | Observability | name, message, stack, full cause chain, timestamps, user messages |
| `toJSON()` | Observability | alias of `toLogObject()` |
| `toPublicJSON(options?)` | Client | safe `{ code, message, traceId? }` |
| `toString()` | — | one-liner plus the full nested cause chain |

See [Observability & logging](./observability) and
[Why safe by default](./safe-by-default) for the two-path model.
