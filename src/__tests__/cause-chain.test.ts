import { describe, it, expect } from "vitest";
import {
  getRootCause,
  findInCauseChain,
  filterCauseChain,
  someCauseChain,
  everyCauseChain,
} from "../index.js";
import { StructuredError } from "../index.js";

interface ErrorWithCause extends Error {
  cause?: unknown;
}

describe("getRootCause", () => {
  it("returns error itself if no cause", () => {
    const error = new Error("test");
    expect(getRootCause(error)).toBe(error);
  });

  it("traverses linear chain", () => {
    const rootCause = new Error("root") as ErrorWithCause;
    const middleCause = new Error("middle") as ErrorWithCause;
    middleCause.cause = rootCause;
    const topError = new Error("top") as ErrorWithCause;
    topError.cause = middleCause;

    expect(getRootCause(topError)).toBe(rootCause);
  });

  it("traverses StructuredError chain", () => {
    const rootCause = new StructuredError({
      code: "ROOT",
      category: "ROOT_CAT",
      retryable: true,
      message: "root error",
    });
    const middleError = new StructuredError({
      code: "MIDDLE",
      category: "MIDDLE_CAT",
      retryable: false,
      message: "middle error",
      cause: rootCause,
    });

    expect(getRootCause(middleError)).toBe(rootCause);
  });

  it("throws on circular reference", () => {
    const errorA = new Error("a") as ErrorWithCause;
    const errorB = new Error("b") as ErrorWithCause;
    errorB.cause = errorA;
    errorA.cause = errorB;

    expect(() => getRootCause(errorB)).toThrow("Circular cause chain detected");
  });

  it("respects maxDepth", () => {
    const errors: ErrorWithCause[] = [];
    let current: ErrorWithCause | undefined = undefined;

    for (let i = 0; i < 10; i++) {
      const error = new Error(`level-${i}`) as ErrorWithCause;
      error.cause = current;
      errors.unshift(error);
      current = error;
    }

    const result = getRootCause(errors[0], 3);
    expect(result).toBe(errors[3]);
  });

  it("handles primitives as cause", () => {
    const error = new Error("test") as ErrorWithCause;
    error.cause = "plain string cause";
    expect(getRootCause(error)).toBe("plain string cause");
  });

  it("handles null cause", () => {
    const error = new Error("test") as ErrorWithCause;
    error.cause = null;
    expect(getRootCause(error)).toBe(null);
  });

  it("handles undefined cause", () => {
    const error = new Error("test") as ErrorWithCause;
    error.cause = undefined;
    expect(getRootCause(error)).toBe(undefined);
  });

  it("handles object cause without cause property", () => {
    const error = new Error("test") as ErrorWithCause;
    error.cause = { foo: "bar" };
    expect(getRootCause(error)).toEqual({ foo: "bar" });
  });
});

describe("findInCauseChain", () => {
  it("returns undefined if no match", () => {
    const error = new Error("test");
    expect(findInCauseChain(error, (e) => e instanceof String)).toBe(undefined);
  });

  it("finds first matching error", () => {
    const target = new Error("target");
    const error = new Error("level-0") as ErrorWithCause;
    error.cause = target;
    const chain = new Error("level-1") as ErrorWithCause;
    chain.cause = error;

    const result = findInCauseChain(
      chain,
      (e): e is Error => e instanceof Error && e.message === "target",
    );
    expect(result).toBe(target);
  });

  it("stops at maxDepth", () => {
    const errors: ErrorWithCause[] = [];
    let current: ErrorWithCause | undefined = undefined;

    for (let i = 0; i < 10; i++) {
      const error = new Error(`level-${i}`) as ErrorWithCause;
      error.cause = current;
      errors.unshift(error);
      current = error;
    }

    const result = findInCauseChain(errors[0], () => true, 3);
    expect(result).toBe(errors[0]);
  });

  it("finds first match even with circular reference", () => {
    const errorA = new Error("a") as ErrorWithCause;
    const errorB = new Error("b") as ErrorWithCause;
    errorB.cause = errorA;
    errorA.cause = errorB;

    expect(findInCauseChain(errorB, () => true)).toBe(errorB);
  });

  it("finds StructuredError by code", () => {
    const target = new StructuredError({
      code: "NETWORK_ERROR",
      category: "NETWORK",
      retryable: true,
      message: "network error",
    });
    const error = new StructuredError({
      code: "INTERNAL_ERROR",
      category: "INTERNAL",
      retryable: false,
      message: "internal error",
      cause: target,
    });

    const result = findInCauseChain(
      error,
      (e): e is { code: string } & Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "NETWORK_ERROR",
    );
    expect(result).toBe(target);
  });
});

describe("filterCauseChain", () => {
  it("returns empty array if no matches", () => {
    const error = new Error("test");
    expect(filterCauseChain(error, (e) => e instanceof String)).toEqual([]);
  });

  it("collects all matching errors", () => {
    const match1 = new Error("match-1");
    const match2 = new Error("match-2") as ErrorWithCause;
    match2.cause = match1;
    const error = new Error("no-match") as ErrorWithCause;
    error.cause = match2;
    const chain = new Error("no-match-2") as ErrorWithCause;
    chain.cause = error;

    const result = filterCauseChain(
      chain,
      (e): e is Error => e instanceof Error && e.message.startsWith("match"),
    );
    expect(result).toEqual([match2, match1]);
  });

  it("respects maxDepth", () => {
    const errors: ErrorWithCause[] = [];
    let current: ErrorWithCause | undefined = undefined;

    for (let i = 0; i < 10; i++) {
      const error = new Error(`level-${i}`) as ErrorWithCause;
      error.cause = current;
      errors.unshift(error);
      current = error;
    }

    const result = filterCauseChain(errors[0], () => true, 3);
    expect(result).toHaveLength(3);
  });
});

describe("someCauseChain", () => {
  it("returns false if no match", () => {
    const error = new Error("test");
    expect(someCauseChain(error, (e) => e instanceof String)).toBe(false);
  });

  it("returns true if any match", () => {
    const target = new Error("target");
    const error = new Error("test") as ErrorWithCause;
    error.cause = target;

    expect(
      someCauseChain(
        error,
        (e): e is Error => e instanceof Error && e.message === "target",
      ),
    ).toBe(true);
  });
});

describe("everyCauseChain", () => {
  it("returns true for empty chain", () => {
    const error = new Error("test");
    expect(everyCauseChain(error, (e) => e instanceof Error)).toBe(true);
  });

  it("returns true if all match", () => {
    const error1 = new Error("e1");
    const error2 = new Error("e2") as ErrorWithCause;
    error2.cause = error1;
    const error3 = new Error("e3") as ErrorWithCause;
    error3.cause = error2;

    expect(everyCauseChain(error3, (e) => e instanceof Error)).toBe(true);
  });

  it("returns false if any does not match", () => {
    const error1 = new Error("e1");
    const error2 = new Error("e2") as ErrorWithCause;
    error2.cause = error1;

    expect(everyCauseChain(error2, (e) => e instanceof String)).toBe(false);
  });
});
