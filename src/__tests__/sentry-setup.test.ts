import {
  Scope,
  createStackParser,
  createTransport,
  linkedErrorsIntegration,
  type ErrorEvent,
  type Exception,
} from "@sentry/core";
import {
  ServerRuntimeClient,
  nodeStackLineParser,
  type ServerRuntimeClientOptions,
} from "@sentry/core/server";
import { describe, expect, it } from "vitest";

import { StructuredError } from "../index.js";
import { CIRCULAR_CAUSE_CHAIN_MARKER } from "../errors/serializer-markers.js";
import { beforeSend } from "../../examples/sentry-reporter.js";

const SECRET_MESSAGE = "lookup for ada@example.com failed";
const SECRET_EMAIL = "ada@example.com";
const SECRET_CAUSE = "db password=hunter2 rejected";

type Capture = { readonly body: string; readonly event: ErrorEvent };

/**
 * Sends one capture through a Sentry client with the default linked errors
 * integration and a transport that records the envelope instead of sending it.
 * The capture goes through a scope, as `Sentry.captureException` does, so the
 * hint carries the original exception.
 */
async function sentCapture(
  capture: (scope: Scope) => void,
  options: Partial<ServerRuntimeClientOptions> = { beforeSend },
): Promise<Capture> {
  const bodies: string[] = [];
  const client = new ServerRuntimeClient({
    dsn: "https://public@sentry.example/1",
    integrations: [linkedErrorsIntegration()],
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
    ...options,
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
    const cause = withCause(new Error(SECRET_CAUSE), error);
    Object.defineProperty(error, "cause", { value: cause, configurable: true });

    const { body, event } = await sentCapture((scope) =>
      scope.captureException(error),
    );

    expect(body).not.toContain(SECRET_EMAIL);
    expect(exceptionsOf(event)).toContainEqual(
      expect.objectContaining({ value: CIRCULAR_CAUSE_CHAIN_MARKER }),
    );
  });

  it("keeps a message event unchanged", async () => {
    const { event } = await sentCapture((scope) =>
      scope.captureMessage("nightly import finished"),
    );

    expect(event.message).toBe("nightly import finished");
  });
});
