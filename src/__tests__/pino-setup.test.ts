import { runInNewContext } from "node:vm";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { StructuredError } from "../index.js";
import { MAX_CAUSE_DEPTH_MARKER } from "../errors/serializer-markers.js";
import { pinoErrorOptions } from "../pino/index.js";
import { hostileProxy, revokedProxy } from "./hostile-values.fixture.js";

type Line = Record<string, unknown>;

const SECRET_MESSAGE = "lookup for ada@example.com failed";
const SECRET_EMAIL = "ada@example.com";
const SECRET_CAUSE = "db password=hunter2 rejected";

/** A pino logger with the given options, and the lines that it wrote. */
function recordingLogger(options: pino.LoggerOptions = pinoErrorOptions) {
  const lines: string[] = [];
  const logger = pino(options, { write: (line) => lines.push(line) });
  return {
    logger,
    lines,
    parsed: () => lines.map((line) => JSON.parse(line) as Line),
  };
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

function withCause(error: Error, cause: unknown): Error {
  Object.defineProperty(error, "cause", { value: cause, configurable: true });
  return error;
}

describe("the pino setup", () => {
  it.each([
    ["logger.error(err)", (log: pino.Logger, err: Error) => log.error(err)],
    [
      "logger.error(err, text)",
      (log: pino.Logger, err: Error) => log.error(err, "lookup"),
    ],
    [
      "logger.error({ err })",
      (log: pino.Logger, err: Error) => log.error({ err }),
    ],
    [
      "logger.error({ err }, text)",
      (log: pino.Logger, err: Error) => log.error({ err }, "lookup"),
    ],
    [
      "logger.error(err, format, arg)",
      (log: pino.Logger, err: Error) => log.error(err, "lookup %s", "123"),
    ],
  ])("keeps the redaction policy of the error for %s", (_form, write) => {
    const { logger, lines } = recordingLogger();

    write(logger, redactedLookupError());

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET_EMAIL);
    expect(lines[0]).not.toContain(SECRET_CAUSE);
  });

  it("writes the log object of the error under err, with its decision fields and its cause", () => {
    const { logger, parsed } = recordingLogger();

    logger.error({ err: redactedLookupError() }, "lookup");

    const err = parsed()[0]!.err as Line;
    expect(err).toMatchObject({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "[REDACTED]",
      details: { email: "[REDACTED]", userId: "123" },
      cause: { name: "Error", message: "[REDACTED]" },
    });
  });

  it("writes the masked message into msg when the call has no text", () => {
    const { logger, parsed } = recordingLogger();

    logger.error(redactedLookupError());

    expect(parsed()[0]!.msg).toBe("[REDACTED]");
  });

  it("keeps the redaction policy of an error in the bindings of a child logger", () => {
    const { logger, lines, parsed } = recordingLogger();

    logger.child({ err: redactedLookupError() }).info("request");

    expect(lines[0]).not.toContain(SECRET_EMAIL);
    expect(parsed()[0]!.err).toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("writes a native error with its own name and message, and its cause chain", () => {
    const { logger, parsed } = recordingLogger();
    const native = withCause(
      new Error("upstream failed"),
      new Error("timeout"),
    );

    logger.error(native);

    const err = parsed()[0]!.err as Line;
    expect(err).toMatchObject({
      name: "Error",
      message: "upstream failed",
      cause: { name: "Error", message: "timeout" },
    });
    expect(err).not.toHaveProperty("code");
  });

  it("writes a cause chain deeper than the data depth bound up to the cause depth bound", () => {
    const { logger, lines } = recordingLogger();
    let chain = new Error("hop 0");
    for (let hop = 1; hop < 150; hop++) {
      chain = withCause(new Error(`hop ${hop}`), chain);
    }

    logger.error(
      new StructuredError({
        code: "REQUEST_FAILED",
        category: "INTERNAL",
        retryable: false,
        message: "request failed",
        cause: chain,
      }),
    );

    expect(lines[0]).toContain(MAX_CAUSE_DEPTH_MARKER);
  });

  it("writes an error from another realm under err through the library", () => {
    const { logger, parsed } = recordingLogger();
    const foreign: unknown = runInNewContext('new Error("vm failure")');

    logger.error({ err: foreign }, "vm call");

    expect(parsed()[0]!.err).toMatchObject({
      name: "Error",
      message: "vm failure",
    });
  });

  it("keeps a merge object with a name and a message as a merge object", () => {
    const { logger, parsed } = recordingLogger();

    logger.info({ name: "nightly-import", message: "rows imported" });

    expect(parsed()[0]).toMatchObject({
      name: "nightly-import",
      message: "rows imported",
    });
    expect(parsed()[0]).not.toHaveProperty("err");
  });

  it.each([
    ["a Proxy whose traps throw", () => hostileProxy()],
    ["a revoked Proxy", () => revokedProxy()],
    [
      "a merge object whose err getter throws",
      () => ({
        get err(): never {
          throw new Error("err getter");
        },
      }),
    ],
  ])("passes %s on to pino without a throw of its own", (_kind, value) => {
    const calls: unknown[][] = [];
    const method = (...args: unknown[]): void => void calls.push(args);

    pinoErrorOptions.hooks.logMethod.call(undefined, [value()], method);

    expect(calls).toHaveLength(1);
  });

  it("keeps err when a merge object fails to copy", () => {
    const calls: unknown[][] = [];
    const method = (...args: unknown[]): void => void calls.push(args);
    const fields = new Proxy(
      { err: new Error("upstream failed"), requestId: "r-1" },
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
      },
    );

    pinoErrorOptions.hooks.logMethod.call(undefined, [fields], method);

    expect(calls[0]?.[0]).toEqual({
      err: expect.objectContaining({ message: "upstream failed" }) as unknown,
    });
  });

  it("writes a library error under another key through toJSON, also without the setup", () => {
    const { logger, lines } = recordingLogger({});

    logger.error({ failure: redactedLookupError() }, "lookup");

    expect(lines[0]).not.toContain(SECRET_EMAIL);
    expect(lines[0]).toContain('"code":"USER_NOT_FOUND"');
  });
});
