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

function isLogNode(value: unknown): value is LogNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The node under the key that `source` names on its parent: `cause`, or a
 * member `errors[i]` of an aggregate. Any other key finds no node.
 */
function childOf(node: unknown, source: string | undefined): unknown {
  if (!isLogNode(node)) return undefined;
  if (source === "cause") return node.cause;
  const member = /^errors\[(\d+)\]$/.exec(source ?? "");
  if (member === null || !Array.isArray(node.errors)) return undefined;
  return node.errors[Number(member[1])];
}

/**
 * The log node of each linked exception, by its `exception_id`. Sentry links
 * a cause and a member of an aggregate as an exception whose `mechanism`
 * names its parent (`parent_id`) and its link (`source`, `cause` or
 * `errors[i]`). A parent has a lower id than its children, so one pass in id
 * order meets each parent first. A link to a missing or later id finds no
 * node.
 */
function logNodesById(
  exceptions: readonly SentryException[],
  logObject: LogNode,
): Map<number, unknown> {
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
  const nodes = new Map<number, unknown>();
  for (const { id, parentId, source } of links) {
    const node =
      parentId === undefined ? logObject : childOf(nodes.get(parentId), source);
    nodes.set(id, node);
  }
  return nodes;
}

/**
 * Replaces the name and the message of each exception with the ones of its
 * log node. An exception without a log node keeps no name and no message. A
 * marker of the log object, such as `[Shared cause]`, becomes the message.
 * An event without an original error has no policy to keep and stays as it
 * is. Sentry calls `beforeSend` after all its integrations, so no integration
 * can add a raw message afterwards. Pass this function to `Sentry.init` as
 * the `beforeSend` option.
 */
export function beforeSend<E extends SentryEvent>(
  event: E,
  hint: SentryHint,
): E {
  const exceptions = event.exception?.values;
  if (exceptions === undefined) return event;
  const logObject = logObjectOf(hint.originalException);
  if (!isLogNode(logObject)) return event;
  const nodes = logNodesById(exceptions, logObject);
  for (const exception of exceptions) {
    const id = exception.mechanism?.exception_id;
    const node = id === undefined ? logObject : nodes.get(id);
    exception.type = isLogNode(node) ? textOf(node.name) : undefined;
    exception.value = isLogNode(node) ? textOf(node.message) : textOf(node);
  }
  return event;
}

/**
 * Adds the log object of the error as the `error` context of the event.
 * Sentry runs `processEvent` before it normalizes the event, so
 * `normalizeDepth` bounds the context. An `error` context that the
 * application sets wins. Add it to the `integrations` of `Sentry.init`.
 */
export function logObjectContextIntegration(): {
  name: string;
  processEvent<E extends SentryEvent>(event: E, hint: SentryHint): E;
} {
  return {
    name: "LogObjectContext",
    processEvent(event, hint) {
      const logObject = logObjectOf(hint.originalException);
      if (!isLogNode(logObject)) return event;
      const target: SentryEvent = event;
      target.contexts = { error: logObject, ...target.contexts };
      return event;
    },
  };
}
