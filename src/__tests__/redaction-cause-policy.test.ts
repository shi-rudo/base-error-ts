import { describe, expect, it } from "vitest";

import {
  BaseError,
  StructuredAggregateError,
  StructuredError,
  defineErrors,
  detailsType,
} from "../index.js";

type LogNode = Record<string, unknown>;

const causeOf = (log: LogNode): LogNode => log.cause as LogNode;
const detailsOf = (node: LogNode): LogNode => node.details as LogNode;

// The message and the details carry distinct secrets. The stack header
// repeats the raw message, and that field has its own contract, so the
// assertions on the whole JSON body match the details secret only.
const leakingInner = () =>
  new StructuredError({
    code: "INNER",
    category: "AUTH",
    retryable: false,
    message: "login rejected for message-secret",
    details: { password: "hunter2", userId: "u-1" },
  });

const wrap = (cause: unknown) =>
  new StructuredError({
    code: "OUTER",
    category: "AUTH",
    retryable: false,
    message: "outer",
    cause,
  });

describe("a cause's own redaction policy holds when another error logs it", () => {
  it("applies the deny-list of a cause to its node in the outer log object", () => {
    const inner = leakingInner().redact(["message", "password"]);
    const outer = wrap(inner);

    const cause = causeOf(outer.toLogObject());

    expect(cause.message).toBe("[REDACTED]");
    expect(detailsOf(cause).password).toBe("[REDACTED]");
    expect(detailsOf(cause).userId).toBe("u-1");
    expect(JSON.stringify(outer)).not.toContain("hunter2");
  });

  it("applies the allow-list of a cause and keeps its envelope", () => {
    const inner = leakingInner().redactAllow(["userId"]);
    const outer = wrap(inner);

    const cause = causeOf(outer.toLogObject());

    expect(cause.name).toBe("INNER");
    expect(cause.message).toBe("login rejected for message-secret");
    expect(cause.code).toBe("INNER");
    expect(detailsOf(cause).userId).toBe("u-1");
    expect(detailsOf(cause).password).toBe("[REDACTED]");
  });

  it("applies the catalog redaction policy of a cause", () => {
    const SecurityErrors = defineErrors({
      LOGIN_FAILED: {
        category: "AUTH",
        retryable: false,
        details: detailsType<{ userId: string; password: string }>(),
        redaction: { mode: "deny", keys: ["password"] },
      },
    });
    const inner = SecurityErrors.create.LOGIN_FAILED("login failed", {
      details: { userId: "u-1", password: "hunter2" },
    });
    const outer = new BaseError("request failed", inner);

    const cause = causeOf(outer.toLogObject());

    expect(detailsOf(cause).password).toBe("[REDACTED]");
    expect(JSON.stringify(outer)).not.toContain("hunter2");
  });

  it("covers the descendants of a cause with the cause's policy", () => {
    const leaf = new Error("db");
    Object.assign(leaf, { details: { password: "hunter2" } });
    const inner = new StructuredError({
      code: "INNER",
      category: "AUTH",
      retryable: false,
      message: "inner",
      cause: leaf,
    }).redact(["password"]);
    const outer = wrap(inner);

    const leafNode = causeOf(causeOf(outer.toLogObject()));

    expect(detailsOf(leafNode).password).toBe("[REDACTED]");
    expect(JSON.stringify(outer)).not.toContain("hunter2");
  });

  it("collapses only the cause node when the cause's redactor throws", () => {
    const inner = leakingInner().redactWith(() => {
      throw new Error("broken redactor");
    });
    const outer = wrap(inner);

    const log = outer.toLogObject();
    const cause = causeOf(log);

    expect(log.message).toBe("outer");
    expect(log.code).toBe("OUTER");
    expect(cause.message).toBe("[log redaction failed]");
    expect(cause.name).toBe("INNER");
    expect(cause.code).toBe("INNER");
    expect(cause.details).toBeUndefined();
    expect(JSON.stringify(outer)).not.toContain("hunter2");
  });

  it("composes an outer allow-list over a cause with a deny-list", () => {
    const inner = new StructuredError({
      code: "INNER",
      category: "AUTH",
      retryable: false,
      message: "inner",
      details: { userId: "u-1", ssn: "123-45-6789", email: "a@b.com" },
    }).redact(["ssn"]);
    const outer = wrap(inner).redactAllow(["userId"]);

    const cause = causeOf(outer.toLogObject());

    expect(cause.message).toBe("inner");
    expect(detailsOf(cause).userId).toBe("u-1");
    expect(detailsOf(cause).ssn).toBe("[REDACTED]");
    expect(detailsOf(cause).email).toBe("[REDACTED]");
  });

  it("applies the policy of an aggregate member", () => {
    const member = leakingInner().redact(["password"]);
    const aggregate = new AggregateError([member, new Error("other")], "many");
    const outer = wrap(aggregate);

    const members = causeOf(outer.toLogObject()).errors as LogNode[];

    expect(detailsOf(members[0] as LogNode).password).toBe("[REDACTED]");
    expect((members[1] as LogNode).message).toBe("other");
    expect(JSON.stringify(outer)).not.toContain("hunter2");
  });

  it("applies the policy of a member carried by the error's own errors field", () => {
    const member = leakingInner().redact(["password"]);
    const aggregate = new StructuredAggregateError({
      code: "FAN_OUT",
      category: "BATCH",
      retryable: false,
      message: "two branches failed",
      errors: [member],
    });

    const members = aggregate.toLogObject().errors as LogNode[];

    expect(detailsOf(members[0] as LogNode).password).toBe("[REDACTED]");
    expect(JSON.stringify(aggregate)).not.toContain("hunter2");
  });

  it("applies every policy on a long chain, bottom-up", () => {
    let err: StructuredError<string, string> = new StructuredError({
      code: "LEAF",
      category: "C",
      retryable: false,
      message: "leaf",
      details: { secret: "leaf-secret" },
    }).redact(["secret"]);
    for (let level = 0; level < 50; level++) {
      err = new StructuredError({
        code: `WRAP_${level}`,
        category: "C",
        retryable: false,
        message: "wrap",
        details: { secret: `secret-${level}` },
        cause: err,
      }).redact(["secret"]);
    }
    const outer = wrap(err);

    let node = causeOf(outer.toLogObject());
    let visited = 0;
    while (typeof node === "object" && node !== null) {
      expect(detailsOf(node).secret).toBe("[REDACTED]");
      visited++;
      node = node.cause as LogNode;
    }

    expect(visited).toBe(51);
    expect(JSON.stringify(outer)).not.toContain("secret-");
    expect(JSON.stringify(outer)).not.toContain("leaf-secret");
  });

  it("keeps toString() as it was: a denied message is masked, details never render", () => {
    const inner = leakingInner().redact(["message", "password"]);
    const outer = wrap(inner);

    const text = String(outer);

    expect(text).toContain("outer");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("hunter2");
  });

  it("stays total for a Proxy around a redacting cause", () => {
    const inner = leakingInner().redact(["password"]);
    const proxied = new Proxy(inner, {});
    const outer = wrap(proxied);

    const cause = causeOf(outer.toLogObject());

    expect(cause.name).toBe("INNER");
    expect(cause.message).toBe("login rejected for message-secret");
  });
});
