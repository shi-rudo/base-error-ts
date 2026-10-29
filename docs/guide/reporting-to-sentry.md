# Reporting to Sentry

[Sentry](https://sentry.io) collects the errors of your application. Sentry
reads the error object itself, and without a setup this bypasses the redaction
of this library. This page shows the setup that keeps the policy of each error
in the Sentry event.

## The problem

`Sentry.captureException(error)` builds the event from the error object. It
writes the raw `name` and the raw `message` of the error as the exception of
the event. The `LinkedErrors` integration, which Sentry enables by default,
adds each cause and each member of an aggregate with its raw name and message.

An option such as `extra: error.toLogObject()` adds the masked log object to
the event. It does not change the exceptions. So a message that a policy denies
still reaches Sentry, and Sentry is a third party that stores the event.

## The setup

The subpath `@shirudo/base-error/sentry` holds the setup. It imports nothing
from Sentry, so it adds no dependency. The Sentry SDK stays a dependency of
your application. Pass both parts to `Sentry.init`:

```ts
import * as Sentry from "@sentry/node";
import {
  beforeSend,
  logObjectContextIntegration,
} from "@shirudo/base-error/sentry";
```

<<< @/../examples/sentry-reporter.ts#usage{ts}

Sentry adds the integration to its default integrations. If you have a
`beforeSend` of your own, call this function in it first. The repository
compiles and runs this code against `@sentry/node` in
[`examples/sentry-reporter.ts`](https://github.com/shi-rudo/base-error-ts/blob/main/examples/sentry-reporter.ts).

## What the setup does

The setup has two parts:

- **The `beforeSend` hook.** Sentry calls it last, after its integrations. It
  writes the log object of the error with
  [`logObjectOf()`](./observability#any-thrown-value-logobjectof). Then it
  gives each exception the name and the message of its node in the log object.
  Sentry marks a linked exception with its parent (`parent_id`) and its link
  (`source`, which is `cause` or `errors[i]`), so the hook finds the node. A
  masked message stays masked. A marker of the log object, such as
  `[Circular cause chain]`, becomes the message. An exception without a node
  keeps no name and no message. An event without an original error, for
  example from `captureEvent`, has no policy to keep and stays as it is.
- **The `LogObjectContext` integration.** It adds the log object of the error
  as the `error` context, with `code`, `category`, `retryable` and `details`.
  Sentry runs it before it normalizes the event, so `normalizeDepth` (3 by
  default) bounds the context. An `error` context that your application sets
  wins.

The hook does not change the stack frames that Sentry parsed. Where Sentry
groups by the type and the message, events whose messages differ only in
masked text share one issue. A masked `name` also changes the type.

For an error that denies `message` and `email`, the event holds this (shortened):

```json
{
  "exception": {
    "values": [
      {
        "type": "Error",
        "value": "[REDACTED]",
        "stacktrace": { "frames": ["…"] },
        "mechanism": {
          "type": "chained",
          "source": "cause",
          "exception_id": 1,
          "parent_id": 0
        }
      },
      {
        "type": "USER_NOT_FOUND",
        "value": "[REDACTED]",
        "stacktrace": { "frames": ["…"] },
        "mechanism": { "type": "generic", "exception_id": 0 }
      }
    ]
  },
  "contexts": {
    "error": {
      "name": "USER_NOT_FOUND",
      "message": "[REDACTED]",
      "cause": { "name": "Error", "message": "[REDACTED]", "stack": "…" },
      "code": "USER_NOT_FOUND",
      "category": "NOT_FOUND",
      "retryable": false,
      "details": { "email": "[REDACTED]", "userId": "123" }
    }
  }
}
```

## Limits

- The setup covers the exceptions of the event and its `error` context. Other
  parts of the event are outside the policy, for example breadcrumbs, request
  data and the local variables of `includeLocalVariables`.
- `extraErrorDataIntegration` copies the own fields of the error into the event
  as they are. A field that the log object does not hold reaches Sentry
  without the policy. Do not add this integration. The `error` context holds
  the fields of the log object.
- Sentry cuts a message to `maxValueLength` before the hook runs. The hook
  writes the message of the log object, so it does not apply that limit.
- The hook knows the links `cause` and `errors[i]`. If you pass another `key`
  to `linkedErrorsIntegration`, the exceptions that Sentry links through that
  key keep no name and no message.
- The context keeps the log object to `normalizeDepth`. Deeper values become
  `[Object]`. If you need them, set a higher `normalizeDepth`.
- If your dependency tree holds two copies of this package, an error from the
  other copy reaches Sentry without its policy. `logObjectOf` writes it like a
  foreign error. Deduplicate the package.
- The tests of this repository run the setup against the event builder of
  `@sentry/core` 11, which `@sentry/node` uses. The example of this page
  compiles and runs against `@sentry/node` 11.
