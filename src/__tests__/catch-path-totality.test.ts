import { describe, expect, it } from "vitest";

import {
  BaseError,
  StructuredError,
  filterCauseChain,
  findInCauseChain,
  getRootCause,
  isChainRetryable,
  isErrorWithCause,
  isRetryable,
  isStructuredError,
  someChainRetryable,
  toStructuredError,
} from "../index.js";

/** An Error whose `key` getter throws on every read. */
function errorWithThrowingGetter(key: string): Error {
  const error = new Error("hostile");
  Object.defineProperty(error, key, {
    get() {
      throw new Error(`${key} getter`);
    },
    configurable: true,
  });
  return error;
}

/** A Proxy whose every trap throws, as a maximally hostile foreign value. */
function hostileProxy(): object {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("get trap");
      },
      has() {
        throw new Error("has trap");
      },
      getPrototypeOf() {
        throw new Error("getPrototypeOf trap");
      },
    },
  );
}

function wrap(cause: unknown): BaseError<"Outer"> {
  return new BaseError<"Outer">("outer failed", cause, { name: "Outer" });
}

describe("totality in catch paths: a throwing getter on a cause", () => {
  for (const key of ["stack", "message", "name", "code", "details", "cause"]) {
    it(`keeps toLogObject, toJSON and JSON.stringify total when \`${key}\` throws`, () => {
      const error = wrap(errorWithThrowingGetter(key));

      expect(() => error.toLogObject()).not.toThrow();
      expect(() => error.toJSON()).not.toThrow();
      expect(() => JSON.stringify(error)).not.toThrow();
    });
  }

  it("serializes the readable fields of a cause whose `stack` throws", () => {
    const error = wrap(errorWithThrowingGetter("stack"));

    const cause = error.toLogObject().cause as Record<string, unknown>;

    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("hostile");
    expect(cause.stack).toBeUndefined();
  });

  it("keeps toString total when `cause` throws on a nested node", () => {
    const error = wrap(errorWithThrowingGetter("cause"));

    expect(() => error.toString()).not.toThrow();
    expect(error.toString()).toContain("Caused by: Error: hostile");
  });

  it("keeps the traversal helpers total when `cause` throws", () => {
    const hostile = errorWithThrowingGetter("cause");
    const error = wrap(hostile);

    expect(getRootCause(error)).toBe(hostile);
    expect(() => findInCauseChain(error, () => false)).not.toThrow();
    expect(filterCauseChain(error, () => true)).toEqual([error, hostile]);
    expect(isChainRetryable(error)).toBe(false);
    expect(someChainRetryable(error)).toBe(false);
    expect(filterCauseChain(error, () => true, { aggregates: true })).toEqual([
      error,
      hostile,
    ]);
  });

  it("treats a throwing `cause` getter as no cause", () => {
    expect(isErrorWithCause(errorWithThrowingGetter("cause"))).toBe(false);
  });
});

describe("totality in catch paths: a hostile Proxy", () => {
  it("fails closed in the shape guards instead of throwing", () => {
    const proxy = hostileProxy();

    expect(isStructuredError(proxy)).toBe(false);
    expect(isRetryable(proxy)).toBe(false);
    expect(isErrorWithCause(proxy)).toBe(false);
  });

  it("renders and logs an error whose cause is a hostile Proxy", () => {
    const error = wrap(hostileProxy());

    expect(() => error.toString()).not.toThrow();
    expect(error.toLogObject().cause).toBe("[Unserializable cause]");
  });

  it("serializes the well-behaved nodes around a hostile Proxy", () => {
    const inner = new Error("inner");
    Object.defineProperty(inner, "cause", { value: hostileProxy() });
    const error = wrap(inner);

    const cause = error.toLogObject().cause as Record<string, unknown>;

    expect(cause.message).toBe("inner");
    expect(cause.cause).toBe("[Unserializable cause]");
  });
});

describe("totality in catch paths: toString of an unrenderable cause", () => {
  it("renders a null-prototype object cause instead of throwing", () => {
    const error = wrap(Object.create(null) as object);

    expect(() => error.toString()).not.toThrow();
    expect(error.toString()).toContain("Caused by: [Unrenderable cause]");
  });

  it("renders a cause whose Symbol.toPrimitive throws instead of throwing", () => {
    const error = wrap({
      [Symbol.toPrimitive]() {
        throw new Error("toPrimitive");
      },
    });

    expect(() => error.toString()).not.toThrow();
    expect(error.toString()).toContain("Caused by: [Unrenderable cause]");
  });
});

describe("totality in catch paths: a bigint cause", () => {
  it("serializes a bigint cause as its decimal string so JSON.stringify stays total", () => {
    const error = wrap(10n);

    expect(error.toLogObject().cause).toBe("10");
    expect(() => JSON.stringify(error)).not.toThrow();
  });

  it("keeps toStructuredError of a bigint JSON-serializable", () => {
    const error = toStructuredError(10n);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(error.toLogObject().cause).toBe("10");
  });

  it("still passes the other primitives through unchanged", () => {
    const error = new StructuredError({
      code: "C",
      category: "X",
      retryable: false,
      message: "m",
      cause: 42,
    });

    expect(error.toLogObject().cause).toBe(42);
  });
});
