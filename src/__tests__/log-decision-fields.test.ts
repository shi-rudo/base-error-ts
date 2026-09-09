import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

function exhaustedCause(): StructuredError<"DO_NOT_RETRY", "VALIDATION"> {
  const cause = new StructuredError({
    code: "DO_NOT_RETRY",
    category: "VALIDATION",
    retryable: false,
    message: "failed",
  });
  Object.defineProperty(cause, "name", { value: Array(100_001).fill(1) });
  return cause;
}

describe("decision fields after a size cut", () => {
  it.each(["toLogObject", "toJSON"] as const)(
    "%s preserves code and false retryability",
    (method) => {
      const log = new BaseError("outer", exhaustedCause())[method]();
      expect(log.cause).toMatchObject({
        code: "DO_NOT_RETRY",
        category: "VALIDATION",
        retryable: false,
      });
    },
  );
  it("preserves false through wire reconstruction", () => {
    const log = new BaseError("outer", exhaustedCause()).toLogObject();
    const restored = StructuredError.fromJSON(log);
    expect(Reflect.get(restored, "cause")).toMatchObject({
      code: "DO_NOT_RETRY",
      retryable: false,
    });
  });
  it("preserves numeric code zero in an aggregate member", () => {
    const cause = Object.assign(new Error("failed"), {
      code: 0,
      retryable: false,
    });
    Object.defineProperty(cause, "stack", { value: Array(100_001).fill(1) });
    const log = new BaseError(
      "outer",
      new AggregateError([cause], "aggregate"),
    ).toLogObject();
    expect(log.cause).toMatchObject({
      errors: [{ code: 0, retryable: false }],
    });
  });
  it("omits exhausted non-scalar decisions without reading their properties", () => {
    let reads = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          reads++;
          throw new Error("foreign");
        },
        ownKeys() {
          reads++;
          throw new Error("foreign");
        },
      },
    );
    const cause = Object.assign(new Error("native"), {
      code: hostile,
      category: hostile,
      retryable: hostile,
    });
    Object.defineProperty(cause, "stack", { value: Array(100_001).fill(1) });

    const log = new BaseError("outer", cause).toLogObject();

    expect(log.cause).not.toHaveProperty("code");
    expect(log.cause).not.toHaveProperty("category");
    expect(log.cause).not.toHaveProperty("retryable");
    expect(reads).toBe(0);
  });
  it("preserves decisions in the fallback after an override exhausts its continuation", () => {
    class Broken extends BaseError<"Broken"> {
      readonly code = "PERMANENT";
      readonly category = "VALIDATION";
      readonly retryable = false;
      protected override buildLogObject(
        buildBase?: () => Record<string, unknown>,
      ): Record<string, unknown> {
        buildBase?.();
        throw new Error("override failed");
      }
    }
    const cause = Object.assign(new Error("native"), {
      details: Array(100_001).fill(1),
    });

    const log = new Broken("outer", cause).toLogObject();

    expect(log).toMatchObject({
      code: "PERMANENT",
      category: "VALIDATION",
      retryable: false,
    });
  });
});
