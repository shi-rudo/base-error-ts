import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

/** A subclass whose own log fields cannot be produced. */
class ThrowingOverride extends BaseError<"ThrowingOverride"> {
  protected override buildLogObject(): Record<string, unknown> {
    throw new Error("own log fields threw");
  }
}

/** An instance whose own `name` is hostile, so the base envelope throws too. */
const withHostileName = <T extends string>(
  error: BaseError<T>,
): BaseError<T> => {
  Object.defineProperty(error, "name", {
    get(): string {
      throw new Error("name getter threw");
    },
    configurable: true,
  });
  return error;
};

/** A subclass that adds its fields the documented way. */
class WellBehaved extends BaseError<"WellBehaved"> {
  public readonly attempt = 3;
  protected override buildLogObject(): Record<string, unknown> {
    return { ...super.buildLogObject(), attempt: this.attempt };
  }
}

describe("toLogObject() against a throwing subclass override", () => {
  it("returns a log object instead of throwing out of the logging path", () => {
    const error = new ThrowingOverride("write failed");

    expect(() => error.toLogObject()).not.toThrow();
  });

  it("keeps the base envelope so a responder still gets name, message and stack", () => {
    const log = new ThrowingOverride("write failed").toLogObject();

    expect(log.name).toBe("ThrowingOverride");
    expect(log.message).toBe("write failed");
    expect(typeof log.stack).toBe("string");
  });

  it("keeps the cause chain, which is what the failure is diagnosed from", () => {
    const inner = new StructuredError({
      code: "CONFLICT",
      category: "WRITE",
      retryable: true,
      message: "stale version",
    });
    const log = new ThrowingOverride("write failed", inner).toLogObject();
    const cause = log.cause as Record<string, unknown>;

    expect(cause.code).toBe("CONFLICT");
    expect(cause.message).toBe("stale version");
  });

  it("names the failed override, apart from a failure of the narrow hook", () => {
    const log = new ThrowingOverride("write failed").toLogObject();

    expect(log.logObjectOverride).toBe("[Log object override failed]");
  });

  it("keeps JSON.stringify total, which is where a logger meets the error", () => {
    const error = new ThrowingOverride("write failed");

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(JSON.stringify(error)).toContain("write failed");
  });

  it("keeps toJSON total, because it is the alias the serializer reaches", () => {
    const error = new ThrowingOverride("write failed");

    expect(() => error.toJSON()).not.toThrow();
  });

  it("degrades to a triage envelope when the base envelope throws as well", () => {
    const error = withHostileName(new ThrowingOverride("write failed"));

    expect(() => error.toLogObject()).not.toThrow();
    expect(error.toLogObject().message).toBe("[log build failed]");
  });

  it("stays total when the error also carries a redactor", () => {
    const error = new ThrowingOverride("password=hunter2").redact(["message"]);

    expect(() => error.toLogObject()).not.toThrow();
    expect(JSON.stringify(error)).not.toContain("hunter2");
  });

  it("serializes a throwing override as another error's cause without losing it", () => {
    const outer = new BaseError("outer", new ThrowingOverride("inner failed"));

    expect(() => JSON.stringify(outer)).not.toThrow();
    const cause = outer.toLogObject().cause as Record<string, unknown>;
    expect(cause.message).toBe("inner failed");
  });

  it("leaves a well-behaved override untouched", () => {
    const log = new WellBehaved("ok").toLogObject();

    expect(log.attempt).toBe(3);
    expect(log.ownLogFields).toBeUndefined();
  });

  it("leaves toString() untouched, because it does not build a log object", () => {
    const rendered = new ThrowingOverride("write failed").toString();

    expect(rendered).toContain("write failed");
  });
});
