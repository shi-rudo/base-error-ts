import { describe, it, expect } from "vitest";
import { StructuredError, matchError } from "../index.js";

describe("StructuredError.fromJSON", () => {
  describe("round-trip", () => {
    it("reproduces an equivalent StructuredError from toJSON()", () => {
      const original = new StructuredError({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        message: "User 123 not found",
        details: { userId: "123" },
      });

      const restored = StructuredError.fromJSON(original.toJSON());

      expect(restored).toBeInstanceOf(StructuredError);
      expect(restored.code).toBe("USER_NOT_FOUND");
      expect(restored.category).toBe("NOT_FOUND");
      expect(restored.retryable).toBe(false);
      expect(restored.message).toBe("User 123 not found");
      expect(restored.details).toEqual({ userId: "123" });
    });

    it("preserves the original stack and timestamp", () => {
      const original = new StructuredError({
        code: "X",
        category: "Y",
        retryable: true,
        message: "m",
      });
      const restored = StructuredError.fromJSON(original.toJSON());
      expect(restored.stack).toBe(original.stack);
      expect(restored.timestamp).toBe(original.timestamp);
      expect(restored.timestampIso).toBe(original.timestampIso);
    });

    it("survives a JSON.parse(JSON.stringify(...)) trip", () => {
      const original = new StructuredError({
        code: "RATE_LIMITED",
        category: "RATE_LIMIT",
        retryable: true,
        message: "slow down",
        details: { retryAfter: 30 },
      });
      const restored = StructuredError.fromJSON(
        JSON.parse(JSON.stringify(original.toJSON())),
      );
      expect(restored.code).toBe("RATE_LIMITED");
      expect(restored.details).toEqual({ retryAfter: 30 });
    });

    it("reconstructs the nested cause chain with codes preserved", () => {
      const inner = new StructuredError({
        code: "DB_TIMEOUT",
        category: "INFRASTRUCTURE",
        retryable: true,
        message: "query timed out",
      });
      const outer = new StructuredError({
        code: "ORDER_FAILED",
        category: "ORDER",
        retryable: false,
        message: "could not place order",
        cause: inner,
      });

      const restored = StructuredError.fromJSON(outer.toJSON());
      const cause = (restored as unknown as { cause: unknown }).cause as
        | StructuredError<string, string>
        | undefined;
      expect(cause).toBeInstanceOf(StructuredError);
      expect(cause?.code).toBe("DB_TIMEOUT");
    });
  });

  describe("lenient reconstruction", () => {
    it("fills safe defaults for a plain-error payload", () => {
      const restored = StructuredError.fromJSON({
        name: "TypeError",
        message: "cannot read x",
      });
      expect(restored.code).toBe("UNKNOWN_ERROR");
      expect(restored.category).toBe("INTERNAL");
      expect(restored.retryable).toBe(false);
      expect(restored.message).toBe("cannot read x");
    });

    it.each([null, 42, "oops", undefined, {}, []])(
      "returns a safe envelope for garbage payload %p (no throw)",
      (payload) => {
        const restored = StructuredError.fromJSON(payload);
        expect(restored).toBeInstanceOf(StructuredError);
        expect(restored.code).toBe("UNKNOWN_ERROR");
      },
    );
  });

  describe("security", () => {
    it("does not pollute Object.prototype via __proto__ / constructor keys", () => {
      const malicious = JSON.parse(
        '{"code":"X","category":"Y","retryable":false,"message":"m","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
      );
      StructuredError.fromJSON(malicious);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("copies only whitelisted fields onto the instance", () => {
      const restored = StructuredError.fromJSON({
        code: "X",
        category: "Y",
        retryable: false,
        message: "m",
        evilExtra: "should not be copied",
      });
      expect(restored).not.toHaveProperty("evilExtra");
    });
  });

  describe("composition", () => {
    it("a reconstructed error composes with matchError", () => {
      const restored = StructuredError.fromJSON({
        code: "RATE_LIMITED",
        category: "RATE_LIMIT",
        retryable: true,
        message: "x",
      });
      const status = matchError(restored, {
        RATE_LIMITED: () => 429,
        _: () => 500,
      });
      expect(status).toBe(429);
    });

    it("a reconstructed error is still safe by default in toProblemDetails", () => {
      const restored = StructuredError.fromJSON({
        code: "DB_TIMEOUT",
        category: "INFRASTRUCTURE",
        retryable: true,
        message: "connect ECONNREFUSED 10.0.0.5:5432",
        details: { host: "10.0.0.5" },
      });
      const problem = restored.toProblemDetails({ status: 500 });
      expect(problem.code).toBe("INTERNAL_ERROR");
      expect(problem.detail).toBe("An unexpected error occurred.");
      expect(JSON.stringify(problem)).not.toContain("10.0.0.5");
    });
  });
});
