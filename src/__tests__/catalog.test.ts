import { describe, it, expect } from "vitest";
import {
  defineErrors,
  matchError,
  StructuredError,
  isStructuredError,
} from "../index.js";
import type { CatalogError } from "../index.js";

const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    httpStatus: 404,
    publicMessage: "The requested user was not found.",
    details: {} as { userId: string },
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
    httpStatus: 429,
  },
});

type AppError = CatalogError<typeof AppErrors>;

describe("defineErrors", () => {
  it("builds a StructuredError with catalog metadata baked in", () => {
    const err = AppErrors.USER_NOT_FOUND("user 123 missing in primary db", {
      details: { userId: "123" },
    });

    expect(err).toBeInstanceOf(StructuredError);
    expect(isStructuredError(err)).toBe(true);
    expect(err.code).toBe("USER_NOT_FOUND");
    expect(err.category).toBe("NOT_FOUND");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("user 123 missing in primary db");
    expect(err.details).toEqual({ userId: "123" });
  });

  it("applies the catalog publicMessage to the safe projection", () => {
    const err = AppErrors.USER_NOT_FOUND("technical detail", {
      details: { userId: "1" },
    });
    expect(err.toProblemDetails({ status: 404 }).detail).toBe(
      "The requested user was not found.",
    );
  });

  it("lets a per-call publicMessage override the catalog default", () => {
    const err = AppErrors.USER_NOT_FOUND("technical", {
      details: { userId: "1" },
      publicMessage: "No such account.",
    });
    expect(err.toPublicJSON().message).toBe("No such account.");
  });

  it("preserves a provided cause", () => {
    const cause = new Error("db down");
    const err = AppErrors.RATE_LIMITED("slow down", { cause });
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("exposes static metadata via meta()", () => {
    expect(AppErrors.meta("USER_NOT_FOUND").httpStatus).toBe(404);
    expect(AppErrors.meta("RATE_LIMITED").retryable).toBe(true);
  });

  it("resolves the boundary status from the catalog", () => {
    const err = AppErrors.USER_NOT_FOUND("x", { details: { userId: "1" } });
    const problem = err.toProblemDetails({
      status: AppErrors.meta(err.code).httpStatus,
    });
    expect(problem.status).toBe(404);
  });

  it("produces a union that matchError handles exhaustively with narrowing", () => {
    const toStatus = (err: AppError) =>
      matchError(err, {
        USER_NOT_FOUND: (e) => ({ status: 404, user: e.details?.userId }),
        RATE_LIMITED: () => ({ status: 429, user: undefined }),
      });

    expect(
      toStatus(AppErrors.USER_NOT_FOUND("x", { details: { userId: "42" } })),
    ).toEqual({ status: 404, user: "42" });
    expect(toStatus(AppErrors.RATE_LIMITED("y"))).toEqual({
      status: 429,
      user: undefined,
    });
  });
});
