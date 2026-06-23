import { describe, it, expect } from "vitest";
import { matchError, StructuredError } from "../index.js";

// A closed union of distinct structured error types, each with a literal code
// and its own details shape (the shape a catalog produces).
type UserNotFound = StructuredError<
  "USER_NOT_FOUND",
  "NOT_FOUND",
  { userId: string }
>;
type RateLimited = StructuredError<
  "RATE_LIMITED",
  "RATE_LIMIT",
  { retryAfter: number }
>;
type AppError = UserNotFound | RateLimited;

function userNotFound(userId: string): UserNotFound {
  return new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: `User ${userId} not found`,
    details: { userId },
  });
}

function rateLimited(retryAfter: number): RateLimited {
  return new StructuredError({
    code: "RATE_LIMITED",
    category: "RATE_LIMIT",
    retryable: true,
    message: "Too many requests",
    details: { retryAfter },
  });
}

describe("matchError", () => {
  it("dispatches to the handler for the matching code", () => {
    const status = (err: AppError) =>
      matchError(err, {
        USER_NOT_FOUND: () => 404,
        RATE_LIMITED: () => 429,
      });

    expect(status(userNotFound("123"))).toBe(404);
    expect(status(rateLimited(30))).toBe(429);
  });

  it("infers the result type from the handler return types", () => {
    // Typed bindings: if matchError regressed to `unknown`, typecheck fails.
    const n: number = matchError(userNotFound("1") as AppError, {
      USER_NOT_FOUND: () => 404,
      RATE_LIMITED: () => 429,
    });
    const s: string = matchError(rateLimited(1) as AppError, {
      USER_NOT_FOUND: () => "a",
      _: (e) => e.code,
    });
    expect(n).toBe(404);
    expect(s).toBe("RATE_LIMITED");
  });

  it("narrows the error to its case so per-code details are typed", () => {
    const describeError = (err: AppError) =>
      matchError(err, {
        // e.details is { userId: string } | undefined here
        USER_NOT_FOUND: (e) => `missing:${e.details?.userId}`,
        // e.details is { retryAfter: number } | undefined here
        RATE_LIMITED: (e) => `retry:${e.details?.retryAfter}`,
      });

    expect(describeError(userNotFound("u1"))).toBe("missing:u1");
    expect(describeError(rateLimited(60))).toBe("retry:60");
  });

  it("uses the `_` catch-all for unhandled codes", () => {
    const result = (err: AppError) =>
      matchError(err, {
        USER_NOT_FOUND: () => "handled",
        _: (e) => `fallback:${e.code}`,
      });

    expect(result(userNotFound("x"))).toBe("handled");
    expect(result(rateLimited(5))).toBe("fallback:RATE_LIMITED");
  });

  it("throws when no case matches and no `_` catch-all is given", () => {
    // Force the runtime path by handing it a code outside the provided cases.
    const err = rateLimited(1);
    expect(() =>
      matchError(err as unknown as UserNotFound, {
        USER_NOT_FOUND: () => "only this",
      }),
    ).toThrow(/unhandled error code "RATE_LIMITED"/);
  });

  it("treats codes that collide with Object.prototype as ordinary codes", () => {
    // Codes like "toString"/"valueOf"/"hasOwnProperty" are valid catalog codes,
    // but a prototype-chain lookup would resolve them to inherited Object methods
    // instead of falling through to `_` (or throwing). Each must route normally.
    for (const code of [
      "toString",
      "valueOf",
      "hasOwnProperty",
      "constructor",
    ]) {
      const err = new StructuredError({
        code,
        category: "CAT",
        retryable: false,
        message: "x",
      });

      // Exact handler wins.
      const exact = matchError(
        err as StructuredError<typeof code, "CAT">,
        {
          [code]: (e) => `handled:${e.code}`,
        } as Record<string, (e: StructuredError<string, string>) => string>,
      );
      expect(exact).toBe(`handled:${code}`);

      // With only a catch-all, the `_` handler must be used (not an inherited method).
      const fallback = matchError(err, {
        _: (e) => `fallback:${e.code}`,
      });
      expect(fallback).toBe(`fallback:${code}`);

      // With no matching case and no `_`, it must throw the clear error.
      expect(() =>
        matchError(err as unknown as StructuredError<"OTHER", "CAT">, {
          OTHER: () => "nope",
        }),
      ).toThrow(/unhandled error code/);
    }
  });

  it("works on a single StructuredError with a code union (narrows code only)", () => {
    const err = new StructuredError<"A" | "B", "CAT">({
      code: "A",
      category: "CAT",
      retryable: false,
      message: "x",
    });

    const out = matchError(err, {
      A: (e) => e.code,
      B: (e) => e.code,
    });

    expect(out).toBe("A");
  });
});
