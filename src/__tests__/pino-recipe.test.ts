import pino from "pino";
import { describe, expect, it } from "vitest";

import { StructuredError } from "../index.js";
import { pinoErrorOptions } from "../../examples/pino-logger.js";

type Line = Record<string, unknown>;

const SECRET_MESSAGE = "lookup for ada@example.com failed";
const SECRET_EMAIL = "ada@example.com";
const SECRET_CAUSE = "db password=hunter2 rejected";

/** A pino logger with the recipe, and the lines that it wrote. */
function recordingLogger() {
  const lines: string[] = [];
  const logger = pino(pinoErrorOptions, { write: (line) => lines.push(line) });
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

describe("the pino recipe", () => {
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

  it("writes a native error through the library, with its cause chain", () => {
    const { logger, parsed } = recordingLogger();
    const native = new Error("upstream failed");
    Object.defineProperty(native, "cause", { value: new Error("timeout") });

    logger.error(native);

    expect(parsed()[0]!.err).toMatchObject({
      code: "UNKNOWN_ERROR",
      cause: { message: "upstream failed", cause: { message: "timeout" } },
    });
  });

  it("writes an error under another key through toJSON, without the recipe", () => {
    const { logger, lines } = recordingLogger();

    logger.error({ failure: redactedLookupError() }, "lookup");

    expect(lines[0]).not.toContain(SECRET_EMAIL);
    expect(lines[0]).toContain('"code":"USER_NOT_FOUND"');
  });
});
