import { describe, expect, it } from "vitest";
import vm from "node:vm";

import { BaseError, toStructuredError } from "../index.js";

/**
 * An Error built by another realm: a real native error whose prototype chain
 * ends in that realm's `Error.prototype`, so `instanceof Error` is false here.
 * The same shape crosses worker boundaries and a second copy of this package.
 */
function foreignError(message: string): Error {
  return vm.runInNewContext(`new Error(${JSON.stringify(message)})`) as Error;
}

describe("a cause from another realm", () => {
  it("is serialized with name, message and stack, like a local Error", () => {
    const error = new BaseError("outer", foreignError("foreign msg"));

    const cause = error.toLogObject().cause as Record<string, unknown>;

    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("foreign msg");
    expect(typeof cause.stack).toBe("string");
  });

  it("follows the foreign error's own cause chain", () => {
    const foreign = foreignError("foreign msg");
    Object.defineProperty(foreign, "cause", { value: new Error("root") });
    const error = new BaseError("outer", foreign);

    const cause = error.toLogObject().cause as Record<string, unknown>;

    expect((cause.cause as Record<string, unknown>).message).toBe("root");
  });

  it("renders as `name: message` in toString()", () => {
    const error = new BaseError("outer", foreignError("foreign msg"));

    expect(error.toString()).toContain("Caused by: Error: foreign msg");
  });

  it("is recognized when it carries a Symbol.toStringTag, with and without Error.isError", () => {
    const ErrorCtor = Error as { isError?: (value: unknown) => boolean };
    const original = ErrorCtor.isError;
    const tagged = (): Error => {
      const foreign = foreignError("foreign msg");
      Object.defineProperty(foreign, Symbol.toStringTag, { value: "Error" });
      return foreign;
    };
    try {
      // The Error.isError branch (where the runtime has it).
      let cause = new BaseError("outer", tagged()).toLogObject()
        .cause as Record<string, unknown>;
      expect(cause.message).toBe("foreign msg");

      // The toString fallback branch (Node 20 and 22 have no Error.isError).
      delete ErrorCtor.isError;
      cause = new BaseError("outer", tagged()).toLogObject().cause as Record<
        string,
        unknown
      >;
      expect(cause.message).toBe("foreign msg");
    } finally {
      if (original !== undefined) ErrorCtor.isError = original;
    }
  });

  it("is still serialized when a patched Error.isError throws", () => {
    const ErrorCtor = Error as { isError?: (value: unknown) => boolean };
    const original = ErrorCtor.isError;
    try {
      ErrorCtor.isError = () => {
        throw new Error("broken polyfill");
      };

      const cause = new BaseError(
        "outer",
        foreignError("foreign msg"),
      ).toLogObject().cause as Record<string, unknown>;

      expect(cause.message).toBe("foreign msg");
    } finally {
      if (original !== undefined) ErrorCtor.isError = original;
      else delete ErrorCtor.isError;
    }
  });

  it("keeps its message when coerced with toStructuredError", () => {
    const foreign = foreignError("foreign msg");

    const error = toStructuredError(foreign);

    expect(error.message).toBe("foreign msg");
    expect((error as unknown as { cause: unknown }).cause).toBe(foreign);
  });
});
