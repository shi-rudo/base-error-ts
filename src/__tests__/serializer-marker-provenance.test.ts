import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

const markerStrings = [
  "[Circular cause chain]",
  "[Max cause depth exceeded]",
  "[Unserializable cause]",
  "[4111111111111111 more aggregated errors]",
];

describe("serializer marker provenance", () => {
  it.each(markerStrings)("masks consumer cause value %s", (marker) => {
    const log = new BaseError("outer", { cause: marker, secret: "S" })
      .redactAllow([])
      .toLogObject();

    expect(log.cause).toEqual({ cause: "[REDACTED]", secret: "[REDACTED]" });
  });

  it.each(markerStrings)("masks consumer errors item %s", (marker) => {
    const log = new BaseError("outer", { errors: [marker], secret: "S" })
      .redactAllow([])
      .toJSON();

    expect(log.cause).toEqual({ errors: ["[REDACTED]"], secret: "[REDACTED]" });
  });

  it("masks marker strings on a native error's cause", () => {
    const inner = new BaseError("inner", "[Unserializable cause]").redactAllow(
      [],
    );
    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect((log.cause as Log).cause).toBe("[REDACTED]");
  });

  it("masks a consumer marker beside an identical emitted aggregate tail", () => {
    const members: unknown[] = Array.from({ length: 101 }, () => "failure");
    members[0] = "[1 more aggregated errors]";
    const log = new BaseError("outer", new AggregateError(members, "batch"))
      .redactAllow([])
      .toLogObject();

    const errors = (log.cause as Log).errors as unknown[];
    expect(errors[0]).toBe("[REDACTED]");
    expect(errors[100]).toBe("[1 more aggregated errors]");
  });

  it("applies deny-list masks to consumer markers on the cause spine", () => {
    const log = new BaseError("outer", {
      cause: "[Unserializable cause]",
      errors: ["[4111111111111111 more aggregated errors]"],
    })
      .redact(["errors"])
      .toLogObject();

    expect((log.cause as Log).errors).toBe("[REDACTED]");
  });

  it("retains an emitted cycle marker through two sticky policies", () => {
    const inner = new BaseError("inner").redactAllow([]);
    Object.defineProperty(inner, "cause", { value: inner });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect((log.cause as Log).cause).toBe("[Circular cause chain]");
  });

  it("retains an emitted tail through two sticky policies", () => {
    const inner = new BaseError("inner").redactAllow([]);
    Object.defineProperty(inner, "errors", {
      value: Array.from({ length: 101 }, () => "failure"),
    });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).errors as unknown[])[100]).toBe(
      "[1 more aggregated errors]",
    );
  });

  it("does not trust a generated slot whose value a custom redactor changed", () => {
    const inner = new BaseError("inner").redactWith((log) => {
      (log.errors as unknown[])[100] =
        "[4111111111111111 more aggregated errors]";
      return log;
    });
    Object.defineProperty(inner, "errors", {
      value: Array.from({ length: 101 }, () => "failure"),
    });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).errors as unknown[])[100]).toBe("[REDACTED]");
  });

  it("does not transfer provenance through a consumer's array copy", () => {
    const inner = new BaseError("inner").redactWith((log) => ({
      ...log,
      errors: [...(log.errors as unknown[])],
    }));
    Object.defineProperty(inner, "errors", {
      value: Array.from({ length: 101 }, () => "failure"),
    });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).errors as unknown[])[100]).toBe("[REDACTED]");
  });

  it("does not trust an emitted marker moved to another array index", () => {
    const inner = new BaseError("inner").redactWith((log) => {
      const errors = log.errors as unknown[];
      errors[0] = errors.pop();
      return log;
    });
    Object.defineProperty(inner, "errors", {
      value: Array.from({ length: 101 }, () => "failure"),
    });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).errors as unknown[])[0]).toBe("[REDACTED]");
  });

  it("masks an emitted marker reused in details while retaining it on the spine", () => {
    const inner = new BaseError("inner").redactWith((log) => ({
      ...log,
      details: log.errors,
    }));
    Object.defineProperty(inner, "errors", {
      value: Array.from({ length: 101 }, () => "failure"),
    });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).details as unknown[])[100]).toBe("[REDACTED]");
    expect(((log.cause as Log).errors as unknown[])[100]).toBe(
      "[1 more aggregated errors]",
    );
  });

  it("does not grant provenance to strings reconstructed by fromJSON", () => {
    const restored = StructuredError.fromJSON({
      code: "FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "outer",
      cause: { cause: "[Unserializable cause]", secret: "S" },
      errors: ["[4111111111111111 more aggregated errors]"],
    });

    const log = restored.redactAllow([]).toLogObject();

    expect(log.cause).toEqual({ cause: "[REDACTED]", secret: "[REDACTED]" });
    expect(log.errors).toEqual(["[REDACTED]"]);
  });
});
