import { describe, expect, it } from "vitest";
import {
  BaseError,
  StructuredAggregateError,
  StructuredError,
} from "../index.js";

class SecretNameError extends BaseError<"SecretNameError"> {}

function nodeOf(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function withCustomCause(fields: Record<string, unknown>): BaseError<string> {
  return new BaseError(
    "outer",
    new BaseError("inner").redactWith(() => fields),
  );
}

describe("deny-listed names in log stack headers", () => {
  it("masks both components of the captured subclass header", () => {
    const err = new SecretNameError("msg").redact(["message", "name"]);

    const log = err.toLogObject();

    expect(log).toMatchObject({ name: "[REDACTED]", message: "[REDACTED]" });
    expect(log.stack).toMatch(/^\[REDACTED\]: \[REDACTED\]\n/);
  });

  it("keeps the message and frames when only name is denied", () => {
    const err = new SecretNameError("visible message");
    const sourceStack = err.stack as string;

    const log = err.redact(["name"]).toLogObject();

    expect(log.message).toBe("visible message");
    expect(log.stack).toBe(
      "[REDACTED]: visible message" +
        sourceStack.slice(sourceStack.indexOf("\n")),
    );
  });

  it("masks names at each level of a cause chain", () => {
    const native = new Error("native");
    native.stack = "Error: native\n    at native (file:1:1)";
    const middle = new SecretNameError("middle", native);
    Object.defineProperty(middle, "stack", {
      value: "SecretNameError: middle\n    at middle (file:2:1)",
    });
    const err = new SecretNameError("outer", middle).redact(["name"]);

    const log = err.toLogObject();

    const cause = nodeOf(log.cause);
    expect(cause.stack).toBe("[REDACTED]: middle\n    at middle (file:2:1)");
    expect(nodeOf(cause.cause).stack).toBe(
      "[REDACTED]: native\n    at native (file:1:1)",
    );
  });

  it("masks names in a native aggregate cause and its members", () => {
    const member = new Error("member");
    member.stack = "Error: member\n    at member (file:1:1)";
    const aggregate = new AggregateError([member], "aggregate");
    aggregate.stack = "AggregateError: aggregate\n    at aggregate (file:2:1)";
    const err = new SecretNameError("outer", aggregate).redact(["name"]);

    const log = err.toLogObject();

    const cause = nodeOf(log.cause);
    expect(cause.stack).toBe(
      "[REDACTED]: aggregate\n    at aggregate (file:2:1)",
    );
    expect(nodeOf((cause.errors as unknown[])[0]).stack).toBe(
      "[REDACTED]: member\n    at member (file:1:1)",
    );
  });

  it("masks names in a structured aggregate root and its members", () => {
    const member = new Error("member");
    member.stack = "Error: member\n    at member (file:1:1)";
    const err = new StructuredAggregateError({
      code: "FAN_OUT_FAILED",
      category: "UPSTREAM",
      retryable: false,
      message: "aggregate",
      errors: [member],
    }).redact(["name"]);
    Object.defineProperty(err, "stack", {
      value: "FAN_OUT_FAILED: aggregate\n    at aggregate (file:2:1)",
    });

    const log = err.toLogObject();

    expect(log.stack).toBe(
      "[REDACTED]: aggregate\n    at aggregate (file:2:1)",
    );
    expect(nodeOf((log.errors as unknown[])[0]).stack).toBe(
      "[REDACTED]: member\n    at member (file:1:1)",
    );
  });

  it("replaces an empty name in a recognized name-message header", () => {
    const err = withCustomCause({
      name: "",
      message: "visible",
      stack: ": visible\n    at operation (file:1:1)",
    }).redact(["name"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe(
      "[REDACTED]: visible\n    at operation (file:1:1)",
    );
  });

  it("removes a multiline name without removing the frames", () => {
    const err = withCustomCause({
      name: "Secret\nName",
      message: "visible",
      stack: "Secret\nName: visible\n    at operation (file:1:1)",
    }).redact(["name"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe(
      "[REDACTED]: visible\n    at operation (file:1:1)",
    );
  });

  it("keeps an empty message when replacing a name-only header", () => {
    const err = withCustomCause({
      name: "SecretNameError",
      message: "",
      stack: "SecretNameError\n    at operation (file:1:1)",
    }).redact(["name"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause)).toMatchObject({
      name: "[REDACTED]",
      message: "",
      stack: "[REDACTED]: \n    at operation (file:1:1)",
    });
  });

  it("reuses each field mask in the header without another callback", () => {
    const calls: Array<[string, unknown]> = [];
    const err = new SecretNameError("msg").redact(["name", "message"], {
      mask: (value, key) => {
        calls.push([key, value]);
        return `${key}#${calls.length}`;
      },
    });

    const log = err.toLogObject();

    expect(calls.filter(([key]) => key === "name")).toEqual([
      ["name", "SecretNameError"],
    ]);
    expect(calls.filter(([key]) => key === "message")).toEqual([
      ["message", "msg"],
    ]);
    expect(calls).toHaveLength(2);
    expect(log.stack).toMatch(
      new RegExp(`^${String(log.name)}: ${String(log.message)}\\n`),
    );
  });

  it("uses the captured custom cause name without reading its getter again", () => {
    let reads = 0;
    const err = withCustomCause({
      get name() {
        reads++;
        return reads === 1 ? "SecretNameError" : "ChangedNameError";
      },
      message: "visible",
      stack: "SecretNameError: visible\n    at operation (file:1:1)",
    }).redact(["name"]);

    const log = err.toLogObject();

    expect(reads).toBe(1);
    expect(nodeOf(log.cause).stack).toBe(
      "[REDACTED]: visible\n    at operation (file:1:1)",
    );
  });

  it.each([
    [
      "unrecognized header",
      { name: "SecretNameError", message: "msg", stack: "custom stack" },
    ],
    [
      "missing name",
      { message: "msg", stack: "SecretNameError: msg\n    at operation" },
    ],
    [
      "missing message",
      {
        name: "SecretNameError",
        stack: "SecretNameError: msg\n    at operation",
      },
    ],
    [
      "inconsistent name",
      {
        name: "ChangedNameError",
        message: "msg",
        stack: "SecretNameError: msg\n    at operation",
      },
    ],
    [
      "inconsistent message",
      {
        name: "SecretNameError",
        message: "changed",
        stack: "SecretNameError: msg\n    at operation",
      },
    ],
  ])("masks the whole stack under key stack for %s", (_label, cause) => {
    const err = withCustomCause(cause).redact(["name"], {
      mask: (_value, key) => `<${key}>`,
    });

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe("<stack>");
  });

  it("masks the whole stack when stack itself is denied", () => {
    const err = new SecretNameError("msg").redact(
      ["name", "message", "stack"],
      {
        mask: (_value, key) => `<${key}>`,
      },
    );

    const log = err.toLogObject();

    expect(log.stack).toBe("<stack>");
  });

  it("keeps the original stack and shared custom cause unchanged", () => {
    const shared = {
      name: "SecretNameError",
      message: "msg",
      stack: "SecretNameError: msg\n    at operation (file:1:1)",
    };
    const err = withCustomCause(shared).redact(["name"]);
    const originalStack = err.stack;

    err.toLogObject();

    expect(err.stack).toBe(originalStack);
    expect(shared).toEqual({
      name: "SecretNameError",
      message: "msg",
      stack: "SecretNameError: msg\n    at operation (file:1:1)",
    });
  });

  it("preserves name and stack under an empty allow-list", () => {
    const err = new SecretNameError("msg").redactAllow([]);
    const originalStack = err.stack;

    const log = err.toLogObject();

    expect(log).toMatchObject({
      name: "SecretNameError",
      message: "msg",
      stack: originalStack,
    });
  });

  it("applies a nested error's own name policy inside foreign cause details", () => {
    const nested = new SecretNameError("nested").redact(["name"]);
    Object.defineProperty(nested, "stack", {
      value: "SecretNameError: nested\n    at nested (file:1:1)",
    });
    const err = new BaseError("outer", {
      name: "ForeignError",
      message: "foreign",
      details: { nested },
    });

    const log = err.toLogObject();

    expect(nodeOf(nodeOf(nodeOf(log.cause).details).nested)).toMatchObject({
      name: "[REDACTED]",
      message: "nested",
      stack: "[REDACTED]: nested\n    at nested (file:1:1)",
    });
  });

  it("masks the stack safely when the name mask cannot convert to text", () => {
    const maskedName: unknown = Object.create(null);
    const err = new StructuredError({
      code: "SECRET_CODE",
      category: "UPSTREAM",
      retryable: false,
      message: "visible",
    }).redact(["name"], { mask: () => maskedName });

    const log = err.toLogObject();

    expect(log.name).toBe(maskedName);
    expect(log).toMatchObject({
      code: "SECRET_CODE",
      category: "UPSTREAM",
      retryable: false,
      message: "visible",
      stack: "[REDACTED]",
    });
  });
});
