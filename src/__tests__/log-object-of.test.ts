import { describe, expect, it, vi } from "vitest";

import { BaseError, StructuredError, logObjectOf } from "../index.js";
import {
  CIRCULAR_CAUSE_CHAIN_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
} from "../errors/serializer-markers.js";
import {
  errorWithThrowingGetter,
  hostileProxy,
  revokedProxy,
} from "./hostile-values.fixture.js";

type Node = Record<string, unknown>;

const SECRET_EMAIL = "ada@example.com";

function withCause(error: Error, cause: unknown): Error {
  Object.defineProperty(error, "cause", { value: cause, configurable: true });
  return error;
}

function redactedLookupError(): StructuredError<"USER_NOT_FOUND", "NOT_FOUND"> {
  return new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: `lookup for ${SECRET_EMAIL} failed`,
    details: { email: SECRET_EMAIL, userId: "123" },
  }).redact(["message", "email"]);
}

describe("logObjectOf", () => {
  it("returns the log object of a library error, with its redaction policy", () => {
    const error = redactedLookupError();

    const node = logObjectOf(error);

    expect(node).toEqual(error.toLogObject());
    expect(node).toMatchObject({
      message: "[REDACTED]",
      details: { email: "[REDACTED]", userId: "123" },
    });
  });

  it("writes a native error with its own name, message and cause chain, without a wrapper", () => {
    const native = withCause(
      new Error("upstream failed"),
      new Error("timeout"),
    );

    const node = logObjectOf(native) as Node;

    expect(node).toMatchObject({
      name: "Error",
      message: "upstream failed",
      stack: expect.stringContaining("upstream failed") as unknown,
      cause: { name: "Error", message: "timeout" },
    });
    expect(node).not.toHaveProperty("code");
  });

  it("writes a native error as the cause node in the log object of a library error", () => {
    const native = withCause(
      new Error("upstream failed"),
      new Error("timeout"),
    );

    const node = logObjectOf(native);

    expect(node).toEqual(new BaseError("wrapper", native).toLogObject().cause);
  });

  it("keeps the structured fields of a foreign error", () => {
    const foreign = Object.assign(new Error("rate limited"), {
      code: "RATE_LIMITED",
      category: "RATE_LIMIT",
      retryable: true,
      details: { retryAfterMs: 500 },
    });

    expect(logObjectOf(foreign)).toMatchObject({
      code: "RATE_LIMITED",
      category: "RATE_LIMIT",
      retryable: true,
      details: { retryAfterMs: 500 },
    });
  });

  it("keeps the redaction policy of a library error in the cause chain of a native error", () => {
    const native = withCause(
      new Error("request failed"),
      redactedLookupError(),
    );

    const node = logObjectOf(native);

    expect(JSON.stringify(node)).not.toContain(SECRET_EMAIL);
    expect(node).toMatchObject({
      cause: {
        code: "USER_NOT_FOUND",
        message: "[REDACTED]",
        details: { email: "[REDACTED]", userId: "123" },
      },
    });
  });

  it("writes a foreign error from its fields, not through its own toLogObject or toJSON", () => {
    const toLogObject = vi.fn(() => ({ message: "forged" }));
    const foreign = Object.assign(new Error("real"), {
      toLogObject,
      toJSON: toLogObject,
    });

    const node = logObjectOf(foreign);

    expect(node).toMatchObject({ message: "real" });
    expect(toLogObject).not.toHaveBeenCalled();
  });

  it("returns a value that is not an error as a copy of log data", () => {
    const value = { userId: "123", attempts: [1, 2] };

    const node = logObjectOf(value);

    expect(node).toEqual(value);
    expect(node).not.toBe(value);
  });

  it.each([
    ["a string", "timeout"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("returns %s as it is", (_kind, value) => {
    expect(logObjectOf(value)).toBe(value);
  });

  it("marks a cyclic cause chain instead of following it", () => {
    const first = new Error("first");
    const second = withCause(new Error("second"), first);
    withCause(first, second);

    expect(logObjectOf(first)).toMatchObject({
      message: "first",
      cause: { message: "second", cause: CIRCULAR_CAUSE_CHAIN_MARKER },
    });
  });

  it("cuts a deep cause chain at the cause depth bound", () => {
    let root = new Error("hop 0");
    for (let hop = 1; hop < 1000; hop++) {
      root = withCause(new Error(`hop ${hop}`), root);
    }

    expect(JSON.stringify(logObjectOf(root))).toContain(MAX_CAUSE_DEPTH_MARKER);
  });

  it("writes an error whose message getter throws without its message", () => {
    const node = logObjectOf(errorWithThrowingGetter("message"));

    expect(node).toMatchObject({ name: "Error" });
    expect((node as Node).message).toBeUndefined();
  });

  it.each([
    ["a Proxy whose traps throw", hostileProxy()],
    ["a revoked Proxy", revokedProxy()],
  ])("writes %s as the unserializable cause marker", (_kind, value) => {
    expect(logObjectOf(value)).toBe(UNSERIALIZABLE_CAUSE_MARKER);
  });
});
