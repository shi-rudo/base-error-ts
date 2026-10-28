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

Copy this function into your application. The Sentry SDK stays a dependency of
your application, not of this library.

```ts
import type { ErrorEvent, EventHint, Exception } from "@sentry/node";
import { logObjectOf } from "@shirudo/base-error";

type LogNode = Record<string, unknown>;

function isLogNode(value: unknown): value is LogNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function logNodeOf(
  exception: Exception,
  exceptions: readonly Exception[],
  logObject: unknown,
): unknown {
  const mechanism = exception.mechanism;
  if (mechanism?.parent_id === undefined) return logObject;
  const parent = exceptions.find(
    (candidate) => candidate.mechanism?.exception_id === mechanism.parent_id,
  );
  const parentNode =
    parent === undefined ? undefined : logNodeOf(parent, exceptions, logObject);
  if (!isLogNode(parentNode)) return undefined;
  if (mechanism.source === "cause") return parentNode.cause;
  const member = /^errors\[(\d+)\]$/.exec(mechanism.source ?? "");
  if (member === null || !Array.isArray(parentNode.errors)) return undefined;
  return parentNode.errors[Number(member[1])];
}

export function beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const exceptions = event.exception?.values;
  if (exceptions === undefined) return event;
  const logObject = logObjectOf(hint.originalException);
  for (const exception of exceptions) {
    const node = logNodeOf(exception, exceptions, logObject);
    exception.type = isLogNode(node) ? textOf(node.name) : undefined;
    exception.value = isLogNode(node) ? textOf(node.message) : textOf(node);
  }
  if (isLogNode(logObject))
    event.contexts = { ...event.contexts, error: logObject };
  return event;
}
```

Then pass the function to `Sentry.init`:

```ts
import * as Sentry from "@sentry/node";

Sentry.init({ dsn: process.env.SENTRY_DSN, beforeSend });

Sentry.captureException(error);
```

If you have a `beforeSend` of your own, call this function in it first. The
repository has the module in
[`examples/sentry-reporter.ts`](https://github.com/shi-rudo/base-error-ts/blob/main/examples/sentry-reporter.ts).

## What the setup does

Sentry calls `beforeSend` last, after its integrations. For an event with
exceptions, the function does four things:

1. It writes the log object of the error with
   [`logObjectOf()`](./observability#any-thrown-value-logobjectof).
2. It finds the node of the log object for each exception. Sentry marks a
   linked exception with its parent (`parent_id`) and its link (`source`, which
   is `cause` or `errors[i]`).
3. It replaces the name and the message of each exception with the ones of its
   node. A masked message stays masked. A marker of the log object, such as
   `[Circular cause chain]`, becomes the message. An exception without a node
   keeps no name and no message.
4. It writes the log object into the `error` context of the event.

The function does not change the stack frames that Sentry parsed. So Sentry
groups the events as before.

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
- If your dependency tree holds two copies of this package, an error from the
  other copy reaches Sentry without its policy. `logObjectOf` writes it like a
  foreign error. Deduplicate the package.
- A test of this repository runs the setup against the event builder of
  `@sentry/core` 11. `@sentry/node` builds its events with the same code.
