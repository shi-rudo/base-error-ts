import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

const markerStrings = [
  "[Circular cause chain]",
  "[Shared cause]",
  "[Max cause depth exceeded]",
  "[Unserializable cause]",
  "[Max log size exceeded]",
  "[3 more aggregated errors]",
];

/** An inner error with 101 members, so the log writes a tail marker at 100. */
function innerWithTail(): BaseError<string> {
  const inner = new BaseError("inner");
  Object.defineProperty(inner, "errors", {
    value: Array.from({ length: 101 }, () => "failure"),
  });
  return inner;
}

describe("serializer markers on the cause spine", () => {
  it.each(markerStrings)(
    "keeps %s in the cause slot of a cause under redactAllow",
    (marker) => {
      const log = new BaseError("outer", { cause: marker, secret: "S" })
        .redactAllow([])
        .toLogObject();

      expect(log.cause).toEqual({ cause: marker, secret: "[REDACTED]" });
    },
  );

  it.each(markerStrings)(
    "keeps %s as a member of an aggregate under redactAllow",
    (marker) => {
      const log = new BaseError("outer", { errors: [marker], secret: "S" })
        .redactAllow([])
        .toLogObject();

      expect(log.cause).toEqual({ errors: [marker], secret: "[REDACTED]" });
    },
  );

  it("masks a marker string under another key of a cause", () => {
    const log = new BaseError("outer", { note: "[Shared cause]" })
      .redactAllow([])
      .toLogObject();

    expect(log.cause).toEqual({ note: "[REDACTED]" });
  });

  it("masks a marker string under a denied key (deny-list)", () => {
    const log = new BaseError("outer", {
      cause: "[Unserializable cause]",
      errors: ["[2 more aggregated errors]"],
    })
      .redact(["errors"])
      .toLogObject();

    expect((log.cause as Log).errors).toBe("[REDACTED]");
  });

  it("keeps a crafted aggregate tail with its number", () => {
    const log = new BaseError("outer", {
      errors: ["[4111111111111111 more aggregated errors]"],
    })
      .redactAllow([])
      .toLogObject();

    expect((log.cause as Log).errors).toEqual([
      "[4111111111111111 more aggregated errors]",
    ]);
  });

  it("keeps an emitted cycle marker through two sticky policies", () => {
    const inner = new BaseError("inner").redactAllow([]);
    Object.defineProperty(inner, "cause", { value: inner });

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect((log.cause as Log).cause).toBe("[Circular cause chain]");
  });

  it("keeps an emitted tail through two sticky policies", () => {
    const inner = innerWithTail().redactAllow([]);

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).errors as unknown[])[100]).toBe(
      "[1 more aggregated errors]",
    );
  });

  it("keeps an emitted tail that a custom redactor of a cause copies", () => {
    const inner = innerWithTail().redactWith((log) => ({
      ...log,
      errors: [...(log.errors as unknown[])],
    }));

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).errors as unknown[])[100]).toBe(
      "[1 more aggregated errors]",
    );
  });

  it("masks an emitted tail that a custom redactor moves into details", () => {
    const inner = innerWithTail().redactWith((log) => ({
      ...log,
      details: log.errors,
    }));

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(((log.cause as Log).details as unknown[])[100]).toBe("[REDACTED]");
    expect(((log.cause as Log).errors as unknown[])[100]).toBe(
      "[1 more aggregated errors]",
    );
  });

  it("keeps the markers of a log after fromJSON", () => {
    const restored = StructuredError.fromJSON({
      code: "FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "outer",
      cause: { cause: "[Unserializable cause]", secret: "S" },
      errors: ["[2 more aggregated errors]"],
    });

    const log = restored.redactAllow([]).toLogObject();

    expect(log.cause).toEqual({
      cause: "[Unserializable cause]",
      secret: "[REDACTED]",
    });
    expect(log.errors).toEqual(["[2 more aggregated errors]"]);
  });
});
