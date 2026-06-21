import { describe, expect, it } from "vitest";

import {
  hasErrorCode,
  isAnyErrorOf,
  isAllOf,
  isError,
  isErrorOf,
  type TypeGuard,
} from "../index.js";

describe("isError", () => {
  it("accepts native errors and subclasses", () => {
    class CustomError extends Error {}

    expect(isError(new Error("native"))).toBe(true);
    expect(isError(new CustomError("custom"))).toBe(true);
  });

  it("rejects native errors with malformed portable fields", () => {
    const invalidName = Object.assign(new Error("failed"), { name: 42 });
    const invalidMessage = Object.assign(new Error("failed"), { message: 42 });
    const invalidStack = Object.assign(new Error("failed"), { stack: 42 });

    expect(isError(invalidName)).toBe(false);
    expect(isError(invalidMessage)).toBe(false);
    expect(isError(invalidStack)).toBe(false);
  });

  it("accepts structural error-like objects", () => {
    expect(isError({ name: "RemoteError", message: "failed" })).toBe(true);
    expect(
      isError({ name: "RemoteError", message: "failed", stack: "stack" }),
    ).toBe(true);
  });

  it("rejects malformed structural values", () => {
    expect(isError({ name: "Error" })).toBe(false);
    expect(isError({ message: "failed" })).toBe(false);
    expect(isError({ name: "Error", message: "failed", stack: 42 })).toBe(
      false,
    );
    expect(
      isError(Object.assign([], { name: "Error", message: "failed" })),
    ).toBe(false);
    expect(isError(null)).toBe(false);
    expect(isError("failed")).toBe(false);
  });

  it("fails closed for throwing property access", () => {
    const value = new Proxy(
      {},
      {
        get() {
          throw new Error("blocked");
        },
      },
    );

    expect(isError(value)).toBe(false);
  });

  it("fails closed when prototype inspection throws", () => {
    const value = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("blocked");
        },
      },
    );

    expect(isError(value)).toBe(false);
  });
});

describe("hasErrorCode", () => {
  it("matches string and numeric error codes exactly", () => {
    const fileError = Object.assign(new Error("missing"), { code: "ENOENT" });
    const numericError = Object.assign(new Error("protocol"), { code: 451 });

    expect(hasErrorCode("ENOENT")(fileError)).toBe(true);
    expect(hasErrorCode("EACCES")(fileError)).toBe(false);
    expect(hasErrorCode(451)(numericError)).toBe(true);
    expect(hasErrorCode("451")(numericError)).toBe(false);
  });

  it("accepts inherited codes on structural errors", () => {
    const prototype = { code: "EINHERITED" };
    const value = Object.assign(Object.create(prototype), {
      name: "RemoteError",
      message: "failed",
    });

    expect(hasErrorCode("EINHERITED")(value)).toBe(true);
  });

  it("rejects code-bearing values that are not error-like", () => {
    expect(hasErrorCode("ENOENT")({ code: "ENOENT" })).toBe(false);
    expect(
      hasErrorCode("ENOENT")({
        name: "Error",
        message: "missing",
        code: 2,
      }),
    ).toBe(false);
  });

  it("fails closed for throwing code access", () => {
    const value = {
      name: "RemoteError",
      message: "failed",
      get code(): never {
        throw new Error("blocked");
      },
    };

    expect(hasErrorCode("ENOENT")(value)).toBe(false);
  });
});

describe("isErrorOf", () => {
  class NetworkError extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }

  class TimeoutError extends NetworkError {}

  it("matches a constructor and its subclasses", () => {
    const isNetworkError = isErrorOf(NetworkError);

    expect(isNetworkError(new NetworkError(500))).toBe(true);
    expect(isNetworkError(new TimeoutError(504))).toBe(true);
    expect(isNetworkError(new Error("other"))).toBe(false);
    expect(isNetworkError({ name: "NetworkError", message: "fake" })).toBe(
      false,
    );
  });

  it("applies the predicate only after constructor matching", () => {
    let calls = 0;
    const isServerError = isErrorOf(NetworkError, (error) => {
      calls++;
      return error.status >= 500;
    });

    expect(isServerError(new Error("other"))).toBe(false);
    expect(calls).toBe(0);
    expect(isServerError(new NetworkError(404))).toBe(false);
    expect(isServerError(new NetworkError(503))).toBe(true);
    expect(calls).toBe(2);
  });

  it("propagates predicate errors", () => {
    const guard = isErrorOf(NetworkError, () => {
      throw new Error("predicate failed");
    });

    expect(() => guard(new NetworkError(500))).toThrow("predicate failed");
  });
});

describe("isAnyErrorOf", () => {
  class NetworkError extends Error {}
  class TimeoutError extends NetworkError {}
  class ParseError extends Error {}

  it("matches any listed constructor including subclasses", () => {
    expect(
      isAnyErrorOf(new NetworkError("network"), [NetworkError, ParseError]),
    ).toBe(true);
    expect(
      isAnyErrorOf(new TimeoutError("timeout"), [NetworkError, ParseError]),
    ).toBe(true);
    expect(
      isAnyErrorOf(new ParseError("parse"), [NetworkError, ParseError]),
    ).toBe(true);
  });

  it("rejects unrelated and non-error values", () => {
    expect(
      isAnyErrorOf(new TypeError("type"), [NetworkError, ParseError]),
    ).toBe(false);
    expect(isAnyErrorOf({ name: "NetworkError" }, [NetworkError])).toBe(false);
  });

  it("returns false for an empty constructor list", () => {
    expect(isAnyErrorOf(new Error("error"), [])).toBe(false);
  });
});

describe("isAllOf", () => {
  const hasMessage: TypeGuard<{ message: string }> = (
    value: unknown,
  ): value is { message: string } =>
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string";

  const hasStatus: TypeGuard<{ status: number }> = (
    value: unknown,
  ): value is { status: number } =>
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "number";

  it("requires every guard to match", () => {
    expect(
      isAllOf({ message: "failed", status: 503 }, [hasMessage, hasStatus]),
    ).toBe(true);
    expect(isAllOf({ message: "failed" }, [hasMessage, hasStatus])).toBe(false);
  });

  it("short-circuits after the first failed guard", () => {
    let laterCalls = 0;
    const neverRuns: TypeGuard<unknown> = (
      _value: unknown,
    ): _value is unknown => {
      laterCalls++;
      return true;
    };

    expect(isAllOf({}, [hasMessage, neverRuns])).toBe(false);
    expect(laterCalls).toBe(0);
  });

  it("propagates user guard errors", () => {
    const throwingGuard: TypeGuard<unknown> = (
      _value: unknown,
    ): _value is unknown => {
      throw new Error("guard failed");
    };

    expect(() => isAllOf({}, [hasMessage, throwingGuard])).not.toThrow();
    expect(() =>
      isAllOf({ message: "failed" }, [hasMessage, throwingGuard]),
    ).toThrow("guard failed");
  });
});
