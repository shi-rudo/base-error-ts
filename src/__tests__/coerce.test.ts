import { describe, it, expect } from "vitest";
import { toStructuredError, StructuredError } from "../index.js";

describe("toStructuredError", () => {
  it("returns an existing StructuredError unchanged", () => {
    const original = new StructuredError({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "nope",
    });
    expect(toStructuredError(original)).toBe(original);
  });

  it("ignores options when passing a StructuredError through", () => {
    const original = new StructuredError({
      code: "A",
      category: "B",
      retryable: false,
      message: "m",
    });
    const out = toStructuredError(original, { code: "OVERRIDE" });
    expect(out).toBe(original);
    expect(out.code).toBe("A");
  });

  it("wraps an Error: message kept, original preserved as cause, safe defaults", () => {
    const cause = new Error("boom");
    const err = toStructuredError(cause);
    expect(err).toBeInstanceOf(StructuredError);
    expect(err.message).toBe("boom");
    expect(err.code).toBe("UNKNOWN_ERROR");
    expect(err.category).toBe("INTERNAL");
    expect(err.retryable).toBe(false);
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("wraps a plain BaseError-like Error preserving it as cause", () => {
    const cause = new TypeError("bad type");
    const err = toStructuredError(cause);
    expect(err.message).toBe("bad type");
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("uses a string value as the message, with no cause", () => {
    const err = toStructuredError("just a string");
    expect(err.message).toBe("just a string");
    expect((err as unknown as { cause: unknown }).cause).toBeUndefined();
  });

  it("preserves a non-Error object as cause with a fallback message", () => {
    const value = { weird: true };
    const err = toStructuredError(value);
    expect(err.message).toBe("Unknown error");
    expect((err as unknown as { cause: unknown }).cause).toBe(value);
  });

  it("handles undefined with a fallback message and no cause", () => {
    const err = toStructuredError(undefined);
    expect(err.message).toBe("Unknown error");
    expect((err as unknown as { cause: unknown }).cause).toBeUndefined();
  });

  it("applies option overrides for code/category/retryable/message", () => {
    const err = toStructuredError(new Error("low-level"), {
      code: "DB_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
      message: "Database is unavailable",
    });
    expect(err.code).toBe("DB_ERROR");
    expect(err.category).toBe("INFRASTRUCTURE");
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("Database is unavailable");
  });

  it("applies the public mapping from options", () => {
    const err = toStructuredError(new Error("pg: secret connstring rejected"), {
      publicCode: "SERVICE_UNAVAILABLE",
      publicMessage: "The service is temporarily unavailable.",
    });
    expect(err.toPublicJSON()).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "The service is temporarily unavailable.",
      retryable: false,
    });
  });

  it("produces a safe public projection by default (no leak of the raw value)", () => {
    const err = toStructuredError(
      new Error("connect ECONNREFUSED 10.0.0.5:5432"),
    );
    const problem = err.toProblemDetails({ status: 500 });
    expect(problem.code).toBe("INTERNAL_ERROR");
    expect(problem.detail).toBe("An unexpected error occurred.");
    expect(problem.detail).not.toContain("ECONNREFUSED");
  });
});
