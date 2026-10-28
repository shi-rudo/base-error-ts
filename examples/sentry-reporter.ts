/**
 * A Sentry setup that writes the error of every event through
 * `logObjectOf()`, so the redaction policy of an error holds in the event.
 *
 * Without it, Sentry reads the error itself: it writes the raw name and the
 * raw message of the error, of each cause and of each member of an aggregate
 * into the event.
 */
import type { ErrorEvent, EventHint, Exception } from "@sentry/core";

import { logObjectOf } from "../src/index.js";

type LogNode = Record<string, unknown>;

function isLogNode(value: unknown): value is LogNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The node of the log object at the position of one exception of the event.
 * Sentry links a cause and a member of an aggregate as an exception whose
 * `mechanism` names its parent (`parent_id`) and its link (`source`, `cause`
 * or `errors[i]`). The error itself has no parent.
 */
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

/**
 * Replaces the name and the message of each exception with the ones of its
 * log node, and attaches the log object as the `error` context. An exception
 * without a log node keeps no name and no message. A marker of the log
 * object, such as `[Shared cause]`, becomes the message. Pass this function
 * to `Sentry.init` as the `beforeSend` option.
 */
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
