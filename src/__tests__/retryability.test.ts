import { describe, it, expect } from "vitest";
import {
  StructuredError,
  isChainRetryable,
  getRootCauseRetryable,
  getFirstRetryableCause,
} from "../index.js";

interface ErrorWithCause extends Error {
  cause?: unknown;
}

describe("isChainRetryable", () => {
  it("returns false for error without retryable flag", () => {
    const error = new Error("test");
    expect(isChainRetryable(error)).toBe(false);
  });

  it("returns false for StructuredError with retryable: false", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: false,
      message: "test",
    });
    expect(isChainRetryable(error)).toBe(false);
  });

  it("returns true for StructuredError with retryable: true", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: true,
      message: "test",
    });
    expect(isChainRetryable(error)).toBe(true);
  });

  it("returns true when intermediate error is retryable", () => {
    const retryableError = new StructuredError({
      code: "NETWORK_ERROR",
      category: "NETWORK",
      retryable: true,
      message: "network error",
    });
    const nonRetryableError = new StructuredError({
      code: "APP_ERROR",
      category: "APP",
      retryable: false,
      message: "app error",
      cause: retryableError,
    });

    expect(isChainRetryable(nonRetryableError)).toBe(true);
  });

  it("returns true when root cause is retryable", () => {
    const rootRetryable = new StructuredError({
      code: "ROOT_ERROR",
      category: "ROOT",
      retryable: true,
      message: "root error",
    });
    const topError = new StructuredError({
      code: "TOP_ERROR",
      category: "TOP",
      retryable: false,
      message: "top error",
      cause: rootRetryable,
    });

    expect(isChainRetryable(topError)).toBe(true);
  });

  it("returns false when no error in chain is retryable", () => {
    const error1 = new StructuredError({
      code: "E1",
      category: "E1",
      retryable: false,
      message: "e1",
    });
    const error2 = new StructuredError({
      code: "E2",
      category: "E2",
      retryable: false,
      message: "e2",
      cause: error1,
    });

    expect(isChainRetryable(error2)).toBe(false);
  });

  it("returns false for plain object cause chain", () => {
    const error = new Error("test") as ErrorWithCause;
    error.cause = { retryable: true };
    expect(isChainRetryable(error)).toBe(false);
  });

  it("handles mixed chain with native Error and StructuredError", () => {
    const retryableStructured = new StructuredError({
      code: "RETRYABLE",
      category: "CAT",
      retryable: true,
      message: "retryable",
    });
    const nativeError = new Error("native") as ErrorWithCause;
    nativeError.cause = retryableStructured;

    expect(isChainRetryable(nativeError)).toBe(true);
  });
});

describe("getRootCauseRetryable", () => {
  it("returns false when root cause is not retryable", () => {
    const rootCause = new StructuredError({
      code: "ROOT",
      category: "ROOT",
      retryable: false,
      message: "root",
    });
    const topError = new StructuredError({
      code: "TOP",
      category: "TOP",
      retryable: true,
      message: "top",
      cause: rootCause,
    });

    expect(getRootCauseRetryable(topError)).toBe(false);
  });

  it("returns true when root cause is retryable", () => {
    const rootCause = new StructuredError({
      code: "ROOT",
      category: "ROOT",
      retryable: true,
      message: "root",
    });
    const topError = new StructuredError({
      code: "TOP",
      category: "TOP",
      retryable: false,
      message: "top",
      cause: rootCause,
    });

    expect(getRootCauseRetryable(topError)).toBe(true);
  });

  it("returns false for single non-retryable error", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: false,
      message: "test",
    });

    expect(getRootCauseRetryable(error)).toBe(false);
  });

  it("returns true for single retryable error", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: true,
      message: "test",
    });

    expect(getRootCauseRetryable(error)).toBe(true);
  });

  it("returns false for native Error without retryable property", () => {
    const error = new Error("test");
    expect(getRootCauseRetryable(error)).toBe(false);
  });

  it("returns false when root cause is plain object", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: true,
      message: "test",
      cause: { some: "data" },
    });

    expect(getRootCauseRetryable(error)).toBe(false);
  });
});

describe("getFirstRetryableCause", () => {
  it("returns undefined when no retryable error in chain", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: false,
      message: "test",
    });

    expect(getFirstRetryableCause(error)).toBe(undefined);
  });

  it("returns the error itself when it is retryable", () => {
    const error = new StructuredError({
      code: "TEST",
      category: "TEST",
      retryable: true,
      message: "test",
    });

    expect(getFirstRetryableCause(error)).toBe(error);
  });

  it("returns first retryable error in chain", () => {
    const firstRetryable = new StructuredError({
      code: "FIRST",
      category: "FIRST",
      retryable: true,
      message: "first",
    });
    const secondRetryable = new StructuredError({
      code: "SECOND",
      category: "SECOND",
      retryable: true,
      message: "second",
      cause: firstRetryable,
    });
    const topError = new StructuredError({
      code: "TOP",
      category: "TOP",
      retryable: false,
      message: "top",
      cause: secondRetryable,
    });

    expect(getFirstRetryableCause(topError)).toBe(secondRetryable);
  });

  it("returns first retryable even if deeper one exists", () => {
    const deeperRetryable = new StructuredError({
      code: "DEEPER",
      category: "DEEPER",
      retryable: true,
      message: "deeper",
    });
    const topRetryable = new StructuredError({
      code: "TOP",
      category: "TOP",
      retryable: true,
      message: "top",
      cause: deeperRetryable,
    });

    expect(getFirstRetryableCause(topRetryable)).toBe(topRetryable);
  });

  it("returns undefined for native Error chain", () => {
    const error = new Error("test") as ErrorWithCause;
    const inner = new Error("inner");
    error.cause = inner;
    expect(getFirstRetryableCause(error)).toBe(undefined);
  });
});
