import {
  Scope,
  createStackParser,
  createTransport,
  linkedErrorsIntegration,
  type ErrorEvent,
  type Exception,
  type Integration,
} from "@sentry/core";
import { ServerRuntimeClient, nodeStackLineParser } from "@sentry/core/server";
import { describe, expect, it } from "vitest";

import { StructuredError } from "../index.js";
import { CIRCULAR_CAUSE_CHAIN_MARKER } from "../errors/serializer-markers.js";
import {
  beforeSend,
  logObjectContextIntegration,
} from "../../examples/sentry-reporter.js";

const SECRET_MESSAGE = "lookup for ada@example.com failed";
const SECRET_EMAIL = "ada@example.com";
const SECRET_CAUSE = "db password=hunter2 rejected";

type Capture = { readonly body: string; readonly event: ErrorEvent };

type Setup = {
  readonly beforeSend?: typeof beforeSend;
  readonly integrations: Integration[];
};

const SENTRY_SETUP: Setup = {
  beforeSend,
  integrations: [logObjectContextIntegration()],
};

const NO_SETUP: Setup = { integrations: [] };

/**
 * Sends one capture through a Sentry client with the default linked errors
 * integration and a transport that records the envelope instead of sending it.
 * The capture goes through a scope, as `Sentry.captureException` does, so the
 * hint carries the original exception.
 */
async function sentCapture(
  capture: (scope: Scope) => void,
  setup: Setup = SENTRY_SETUP,
): Promise<Capture> {
  const bodies: string[] = [];
  const client = new ServerRuntimeClient({
    dsn: "https://public@sentry.example/1",
    integrations: [linkedErrorsIntegration(), ...setup.integrations],
    beforeSend: setup.beforeSend,
    stackParser: createStackParser(nodeStackLineParser()),
    sendClientReports: false,
    transport: (transportOptions) =>
      createTransport(transportOptions, (request) => {
        const body = request.body;
        bodies.push(
          typeof body === "string" ? body : new TextDecoder().decode(body),
        );
        return Promise.resolve({ statusCode: 200 });
      }),
  });
  client.init();
  const scope = new Scope();
  scope.setClient(client);

  capture(scope);
  await client.close(2000);

  const body = bodies.join("\n");
  const payload = body.split("\n")[2] ?? "{}";
  return { body, event: JSON.parse(payload) as ErrorEvent };
}

function exceptionsOf(event: ErrorEvent): Exception[] {
  return event.exception?.values ?? [];
}

function withCause(error: Error, cause: unknown): Error {
  Object.defineProperty(error, "cause", { value: cause, configurable: true });
  return error;
}

function redactedLookupError(): StructuredError<"USER_NOT_FOUND", "NOT_FOUND"> {
  return new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: SECRET_MESSAGE,
    details: { email: SECRET_EMAIL, userId: "123" },
    cause: new Error(SECRET_CAUSE),
  }).redact(["message", "email"]);
}

describe("the Sentry setup", () => {
  it("is needed: without it, the event holds the raw message, details and cause", async () => {
    const { body } = await sentCapture(
      (scope) => scope.captureException(redactedLookupError()),
      NO_SETUP,
    );

    expect(body).toContain(SECRET_EMAIL);
    expect(body).toContain(SECRET_CAUSE);
  });

  it("keeps the redaction policy of the error in the event", async () => {
    const { body } = await sentCapture((scope) =>
      scope.captureException(redactedLookupError()),
    );

    expect(body).toContain('"USER_NOT_FOUND"');
    expect(body).not.toContain(SECRET_EMAIL);
    expect(body).not.toContain(SECRET_CAUSE);
  });

  it("writes the masked messages as the values of the error and its cause", async () => {
    const { event } = await sentCapture((scope) =>
      scope.captureException(redactedLookupError()),
    );

    expect(exceptionsOf(event)).toMatchObject([
      { type: "Error", value: "[REDACTED]" },
      { type: "USER_NOT_FOUND", value: "[REDACTED]" },
    ]);
  });

  it("keeps the stack frames of the error", async () => {
    const { event } = await sentCapture((scope) =>
      scope.captureException(redactedLookupError()),
    );

    const root = exceptionsOf(event).slice(-1)[0];
    expect(root?.stacktrace?.frames?.length).toBeGreaterThan(0);
  });

  it("writes the log object of the error into the error context", async () => {
    const { event } = await sentCapture((scope) =>
      scope.captureException(redactedLookupError()),
    );

    expect(event.contexts?.error).toMatchObject({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "[REDACTED]",
      details: { email: "[REDACTED]", userId: "123" },
    });
  });

  it("keeps an error context that the application sets", async () => {
    const { event } = await sentCapture((scope) => {
      scope.setContext("error", { requestId: "r-1" });
      scope.captureException(redactedLookupError());
    });

    expect(event.contexts?.error).toEqual({ requestId: "r-1" });
  });

  it("cuts the error context at the normalize depth of Sentry", async () => {
    const error = new StructuredError({
      code: "IMPORT_FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "import failed",
      details: { row: { cell: { value: "deep" } } },
    });

    const { event } = await sentCapture((scope) =>
      scope.captureException(error),
    );

    expect(event.contexts?.error).toMatchObject({
      details: { row: "[Object]" },
    });
  });

  it("keeps the messages of a native error and its cause chain", async () => {
    const native = withCause(
      new Error("upstream failed"),
      new Error("timeout"),
    );

    const { event } = await sentCapture((scope) =>
      scope.captureException(native),
    );

    expect(exceptionsOf(event)).toMatchObject([
      { type: "Error", value: "timeout" },
      { type: "Error", value: "upstream failed" },
    ]);
  });

  it("masks a member of an aggregate with the policy of the member", async () => {
    const batch = new AggregateError([redactedLookupError()], "batch failed");

    const { body, event } = await sentCapture((scope) =>
      scope.captureException(batch),
    );

    expect(body).not.toContain(SECRET_EMAIL);
    expect(exceptionsOf(event)).toContainEqual(
      expect.objectContaining({ type: "USER_NOT_FOUND", value: "[REDACTED]" }),
    );
  });

  it("writes the cycle marker where Sentry links the error a second time", async () => {
    const error = redactedLookupError();
    withCause(error, withCause(new Error(SECRET_CAUSE), error));

    const { body, event } = await sentCapture((scope) =>
      scope.captureException(error),
    );

    expect(body).not.toContain(SECRET_EMAIL);
    expect(exceptionsOf(event)).toContainEqual(
      expect.objectContaining({ value: CIRCULAR_CAUSE_CHAIN_MARKER }),
    );
  });

  it("writes no name and no message for an exception whose parent link is broken", async () => {
    const selfLinked: Exception = {
      type: "Error",
      value: SECRET_CAUSE,
      mechanism: { type: "chained", exception_id: 1, parent_id: 1 },
    };
    const root: Exception = {
      type: "USER_NOT_FOUND",
      value: SECRET_MESSAGE,
      mechanism: { type: "generic", exception_id: 0 },
    };

    const { body, event } = await sentCapture((scope) =>
      scope.captureEvent(
        { exception: { values: [selfLinked, root] } },
        {
          originalException: new StructuredError({
            code: "USER_NOT_FOUND",
            category: "NOT_FOUND",
            retryable: false,
            message: SECRET_MESSAGE,
          }).redact(["message"]),
        },
      ),
    );

    expect(body).not.toContain(SECRET_CAUSE);
    expect(body).not.toContain(SECRET_MESSAGE);
    expect(exceptionsOf(event)).toMatchObject([
      { mechanism: { exception_id: 1 } },
      { type: "USER_NOT_FOUND", value: "[REDACTED]" },
    ]);
    expect(exceptionsOf(event)[0]).not.toHaveProperty("value");
  });

  it("keeps an event whose exceptions do not come from an error unchanged", async () => {
    const { event } = await sentCapture((scope) =>
      scope.captureEvent({
        exception: {
          values: [{ type: "TypeError", value: "x is not a function" }],
        },
      }),
    );

    expect(exceptionsOf(event)).toMatchObject([
      { type: "TypeError", value: "x is not a function" },
    ]);
  });

  it("keeps a message event unchanged", async () => {
    const { event } = await sentCapture((scope) =>
      scope.captureMessage("nightly import finished"),
    );

    expect(event.message).toBe("nightly import finished");
  });
});
