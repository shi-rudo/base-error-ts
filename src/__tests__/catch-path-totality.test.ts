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
  isRetryableStructuredError,
  isStructuredError,
  someChainRetryable,
  toStructuredError,
} from "../index.js";

import {
  errorWithThrowingGetter,
  hostileProxy,
  wideArrayLike,
} from "./hostile-values.fixture.js";
import { MAX_LOG_NODES } from "../errors/walker-bounds.js";

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

describe("totality in catch paths: an error whose name or message is an object", () => {
  for (const field of ["name", "message"]) {
    it(`omits the stack of a native cause whose \`${field}\` is an array-like, within the log budget`, () => {
      const wide = wideArrayLike();
      const cause = new Error("failed");
      Object.defineProperty(cause, field, { value: wide.value });

      const log = wrap(cause).toLogObject();

      expect((log.cause as Record<string, unknown>).stack).toBeUndefined();
      expect(wide.reads()).toBeLessThanOrEqual(MAX_LOG_NODES);
    });
  }

  it("reads a logged BaseError whose name is an array-like within the log budget", () => {
    const wide = wideArrayLike();
    const error = new BaseError<"Root">("root");
    Object.defineProperty(error, "name", { value: wide.value });

    error.toLogObject();

    expect(wide.reads()).toBeLessThanOrEqual(MAX_LOG_NODES);
  });

  it("reads a BaseError in details whose message is an array-like within the log budget", () => {
    const wide = wideArrayLike();
    const inner = new BaseError<"Inner">("inner");
    Object.defineProperty(inner, "message", { value: wide.value });
    const error = new StructuredError({
      code: "OUTER",
      category: "INTERNAL",
      retryable: false,
      message: "outer",
      details: { inner },
    });

    error.toLogObject();

    expect(wide.reads()).toBeLessThanOrEqual(MAX_LOG_NODES);
  });

  it("keeps the stack of a BaseError cause whose message is an array-like, within the log budget", () => {
    const wide = wideArrayLike();
    const inner = new BaseError<"Inner">("inner");
    Object.defineProperty(inner, "message", { value: wide.value });

    const log = wrap(inner).toLogObject();

    expect((log.cause as Record<string, unknown>).stack).toMatch(
      /^BaseError: \[object Array\]\n/,
    );
    expect(wide.reads()).toBeLessThanOrEqual(MAX_LOG_NODES);
  });

  it("reads the stack and renders a BaseError whose message is a revoked Proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const error = new BaseError<"Root">("root", undefined, { name: "Root" });
    Object.defineProperty(error, "message", { value: proxy });

    const read = () => error.stack;

    expect(read).not.toThrow();
    expect(read()).toMatch(/^Root: \n/);
    expect(error.toString()).toBe("[Root] ");
  });

  it("keeps the stack of a native cause whose name and message are strings", () => {
    const cause = new Error("failed");

    const log = wrap(cause).toLogObject();

    expect((log.cause as Record<string, unknown>).stack).toBe(cause.stack);
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

describe("totality in catch paths: toString of a cause that is not an error", () => {
  it("renders a null-prototype object cause by its tag instead of throwing", () => {
    const error = wrap(Object.create(null) as object);

    expect(() => error.toString()).not.toThrow();
    expect(error.toString()).toContain("Caused by: [object Object]");
  });

  it("renders an object cause by its tag without calling its own conversion", () => {
    let conversions = 0;
    const error = wrap({
      [Symbol.toPrimitive]() {
        conversions++;
        throw new Error("toPrimitive");
      },
      toString() {
        conversions++;
        return "own text";
      },
    });

    const rendered = error.toString();

    expect(rendered).toContain("Caused by: [object Object]");
    expect(conversions).toBe(0);
  });

  it("renders an array cause by its tag, whatever its length", () => {
    const sparse: unknown[] = [];
    sparse.length = 100_000_000;

    const rendered = wrap(sparse).toString();

    expect(rendered).toBe("[Outer] outer failed\nCaused by: [object Array]");
  });

  it("reads no element of an array-like Proxy cause", () => {
    const wide = wideArrayLike(1e9);

    const rendered = wrap(wide.value).toString();

    expect(rendered).toContain("Caused by: [object Array]");
    expect(wide.reads()).toBe(0);
  });

  it("renders an object whose conversion is a generic array method by its tag", () => {
    const arrayLike = Object.create(Array.prototype, {
      length: { value: 1e9 },
    }) as object;

    const rendered = wrap(arrayLike).toString();

    expect(rendered).toContain("Caused by: [object Object]");
  });

  it("renders a native error whose name or message is an array by their tags", () => {
    const sparse: unknown[] = [];
    sparse.length = 100_000_000;
    const cause = new Error("readable");
    Object.defineProperty(cause, "name", { value: sparse });

    const rendered = wrap(cause).toString();

    expect(rendered).toContain("Caused by: [object Array]: readable");
  });

  it("renders a BaseError cause whose name or message is an array-like by their tags", () => {
    const wide = wideArrayLike();
    const named = new BaseError<"Inner">("readable");
    Object.defineProperty(named, "name", { value: wide.value });
    const messaged = new BaseError<"Inner">("readable", undefined, {
      name: "Inner",
    });
    Object.defineProperty(messaged, "message", { value: wide.value });

    const renderedName = wrap(named).toString();
    const renderedMessage = wrap(messaged).toString();

    expect(renderedName).toContain("Caused by: [[object Array]] readable");
    expect(renderedMessage).toContain("Caused by: [Inner] [object Array]");
    expect(wide.reads()).toBe(0);
  });

  it("renders the unrenderable marker for a cause whose tag cannot be read", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const throwingTag = {
      get [Symbol.toStringTag](): string {
        throw new Error("tag");
      },
    };

    expect(wrap(proxy).toString()).toContain("Caused by: [Unrenderable cause]");
    expect(wrap(throwingTag).toString()).toContain(
      "Caused by: [Unrenderable cause]",
    );
  });
});

describe("totality in catch paths: a throwing getter behind a passing guard", () => {
  it("wraps a structured shape whose toLogObject getter throws", () => {
    // Error-shaped on purpose: `isError` and `isStructuredError` must pass,
    // so the flow reaches the guarded `toLogObject` read this test pins.
    const hostile = {
      name: "E",
      message: "m",
      code: "C",
      category: "X",
      retryable: false,
      get toLogObject(): () => Record<string, unknown> {
        throw new Error("gotcha");
      },
    };

    const error = toStructuredError(hostile);

    expect(error).toBeInstanceOf(StructuredError);
    expect((error as unknown as { cause: unknown }).cause).toBe(hostile);
  });

  it("wraps an error-like value whose message getter throws on a later read", () => {
    let reads = 0;
    const hostile = {
      name: "E",
      get message(): string {
        reads++;
        if (reads > 2) throw new Error("third read");
        return "m";
      },
    };

    const error = toStructuredError(hostile);

    expect(error).toBeInstanceOf(StructuredError);
    expect(error.message).toBe("Unknown error");
    expect((error as unknown as { cause: unknown }).cause).toBe(hostile);
  });

  it("fails closed when retryable throws on its second read", () => {
    let reads = 0;
    const hostile = {
      code: "C",
      category: "X",
      get retryable(): boolean {
        reads++;
        if (reads > 1) throw new Error("second read");
        return true;
      },
    };

    expect(isRetryableStructuredError(hostile)).toBe(false);
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
