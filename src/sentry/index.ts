/**
 * The Sentry setup: it writes the exceptions of every event through
 * {@link logObjectOf}, so the redaction policy of an error holds in the
 * event. It also adds the log object of the error as the `error` context.
 *
 * Without it, Sentry reads the error itself: it writes the raw name and the
 * raw message of the error, of each cause and of each member of an aggregate
 * into the event.
 *
 * The module imports nothing from Sentry. Its types describe the parts of an
 * event that it reads and writes, so they fit the options of every Sentry SDK
 * that builds on `@sentry/core`.
 */
import { logObjectOf } from "../index.js";
import {
  isArrayValue,
  readOwnEnumerableKeys,
  readProperty,
} from "../errors/guarded-read.js";
import { isNativeError } from "../errors/native-error.js";
import { MAX_LOG_NODES } from "../errors/walker-bounds.js";

/** The parts of a Sentry exception that the setup reads and writes. */
type SentryException = {
  type?: string;
  value?: string;
  mechanism?: { exception_id?: number; parent_id?: number; source?: string };
};

/** The parts of a Sentry event that the setup reads and writes. */
type SentryEvent = {
  exception?: { values?: SentryException[] };
  contexts?: Record<string, Record<string, unknown> | undefined>;
};

/** The part of a Sentry event hint that the setup reads. */
type SentryHint = { originalException?: unknown };

type LogNode = Record<string, unknown>;

/**
 * One exception of the event: its node in the log object, and the error that
 * Sentry wrote the exception from.
 */
type Position = { readonly node: unknown; readonly error: unknown };

/** `isNativeError` reads the prototype first, and a Proxy can throw there. */
function isErrorValue(value: unknown): value is Error {
  try {
    return isNativeError(value);
  } catch {
    return false;
  }
}

/**
 * The error that Sentry builds the exception of an event from. For an error,
 * that is the error itself. For an object, Sentry takes its first own
 * enumerable property that holds an error. Any other value gets a synthetic
 * exception from Sentry, and the value carries no policy.
 */
function reportedError(original: unknown): Error | undefined {
  if (isErrorValue(original)) return original;
  if (typeof original !== "object" || original === null) return undefined;
  for (const key of readOwnEnumerableKeys(original, MAX_LOG_NODES)) {
    const value = readProperty(original, key);
    if (isErrorValue(value)) return value;
  }
  return undefined;
}

function isLogNode(value: unknown): value is LogNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The value under the key that `source` names on its parent: `cause`, or a
 * member `errors[i]` of an aggregate. Any other key finds nothing. The same
 * links lead through the log object and through the errors, and every read
 * is guarded, because an error is a foreign value.
 */
function childOf(parent: unknown, source: string | undefined): unknown {
  if (source === "cause") return readProperty(parent, "cause");
  const member = /^errors\[(\d+)\]$/.exec(source ?? "");
  if (member === null) return undefined;
  const errors = readProperty(parent, "errors");
  if (!isArrayValue(errors)) return undefined;
  return readProperty(errors, String(Number(member[1])));
}

/**
 * The position of each linked exception, by its `exception_id`. Sentry links
 * a cause and a member of an aggregate as an exception whose `mechanism`
 * names its parent (`parent_id`) and its link (`source`, `cause` or
 * `errors[i]`). A parent has a lower id than its children, so one pass in id
 * order meets each parent first. A link to a missing or later id finds no
 * node and no error.
 */
function positionsById(
  exceptions: readonly SentryException[],
  root: Position,
): Map<number, Position> {
  const links: { id: number; parentId?: number; source?: string }[] = [];
  for (const { mechanism } of exceptions) {
    if (mechanism?.exception_id === undefined) continue;
    links.push({
      id: mechanism.exception_id,
      parentId: mechanism.parent_id,
      source: mechanism.source,
    });
  }
  links.sort((first, second) => first.id - second.id);
  const positions = new Map<number, Position>();
  for (const { id, parentId, source } of links) {
    if (parentId === undefined) {
      positions.set(id, root);
      continue;
    }
    const parent = positions.get(parentId);
    positions.set(id, {
      node: childOf(parent?.node, source),
      error: childOf(parent?.error, source),
    });
  }
  return positions;
}

/**
 * Writes the name and the message of the log node into the exception where
 * they differ from the raw name and message of the error: there a policy
 * masked them, or the log object holds a marker. Elsewhere the exception
 * keeps what Sentry and the integrations wrote, such as a scrubbed or a cut
 * value. A marker that takes the place of a node, such as `[Shared cause]`,
 * becomes the message. An exception without a log node keeps no name and no
 * message.
 */
function writePolicyChanges(
  exception: SentryException,
  position: Position | undefined,
): void {
  const node = position?.node;
  if (!isLogNode(node)) {
    exception.type = undefined;
    exception.value = textOf(node);
    return;
  }
  const name = textOf(node.name);
  const message = textOf(node.message);
  if (name !== textOf(readProperty(position?.error, "name"))) {
    exception.type = name;
  }
  if (message !== textOf(readProperty(position?.error, "message"))) {
    exception.value = message;
  }
}

/**
 * Keeps the redaction policy of the reported error in the exceptions of the
 * event. Where a policy masked a name or a message, the exception gets the
 * masked text of the log object. Every other exception keeps what Sentry and
 * the integrations wrote, so the hook never sends more than Sentry alone. An
 * event without an error to report has no policy to keep and stays as it
 * is. Sentry calls `beforeSend` after all its integrations, so no integration
 * can add a raw message afterwards. Pass this function to `Sentry.init` as
 * the `beforeSend` option.
 */
export function beforeSend<E extends SentryEvent>(
  event: E,
  hint: SentryHint,
): E {
  const exceptions = event.exception?.values;
  const error = reportedError(hint.originalException);
  if (exceptions === undefined || error === undefined) return event;
  const logObject = logObjectOf(error);
  if (!isLogNode(logObject)) return event;
  const root: Position = { node: logObject, error };
  const positions = positionsById(exceptions, root);
  for (const exception of exceptions) {
    const id = exception.mechanism?.exception_id;
    writePolicyChanges(exception, id === undefined ? root : positions.get(id));
  }
  return event;
}

/**
 * Adds the log object of the reported error as the `error` context of the
 * event.
 * Sentry runs `processEvent` before it normalizes the event, so
 * `normalizeDepth` bounds the context. An `error` context that the
 * application sets wins. For an error without a policy, the context holds its
 * raw message and stack, and an integration that scrubs the exception values
 * does not reach it. Add it to the `integrations` of `Sentry.init`.
 */
export function logObjectContextIntegration(): {
  name: string;
  processEvent<E extends SentryEvent>(event: E, hint: SentryHint): E;
} {
  return {
    name: "LogObjectContext",
    processEvent(event, hint) {
      const error = reportedError(hint.originalException);
      if (error === undefined) return event;
      const logObject = logObjectOf(error);
      if (!isLogNode(logObject)) return event;
      const target: SentryEvent = event;
      target.contexts = { error: logObject, ...target.contexts };
      return event;
    },
  };
}
