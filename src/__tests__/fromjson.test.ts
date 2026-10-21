import { afterEach, describe, it, expect, vi } from "vitest";
import { StructuredError, matchError } from "../index.js";

afterEach(() => {
  vi.useRealTimers();
});

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

    it("decouples details from the input payload (top level)", () => {
      const payload = {
        code: "X",
        category: "Y",
        retryable: false,
        message: "m",
        details: { userId: "123" },
      };

      const restored = StructuredError.fromJSON(payload);
      payload.details.userId = "mutated-after-reconstruction";
      (payload.details as Record<string, unknown>).added = "later";

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

    it("derives both times from the ISO string when the timestamp is masked", () => {
      const original = new StructuredError({
        code: "X",
        category: "Y",
        retryable: true,
        message: "m",
      });
      const payload = { ...original.toJSON(), timestamp: "[REDACTED]" };
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(original.timestamp + 60_000);

      const restored = StructuredError.fromJSON(payload);

      expect(restored.timestamp).toBe(original.timestamp);
      expect(restored.timestampIso).toBe(original.timestampIso);
    });

    it("derives the ISO string from the numeric timestamp", () => {
      const payload = {
        code: "X",
        category: "Y",
        retryable: true,
        message: "m",
        timestamp: 0,
        timestampIso: "2026-09-27T00:00:00.000Z",
      };

      const restored = StructuredError.fromJSON(payload);

      expect(restored.timestamp).toBe(0);
      expect(restored.timestampIso).toBe("1970-01-01T00:00:00.000Z");
    });

    it("ignores an ISO string that is not the canonical form of its instant", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.UTC(2026, 8, 27, 12));

      for (const timestampIso of ["2026-09-27T00:00:00", "Sep 27 2026"]) {
        const restored = StructuredError.fromJSON({
          code: "X",
          category: "Y",
          retryable: true,
          message: "m",
          timestamp: "[REDACTED]",
          timestampIso,
        });

        expect(restored.timestamp).toBe(Date.UTC(2026, 8, 27, 12));
      }
    });

    it("restores a fractional numeric timestamp unchanged", () => {
      const restored = StructuredError.fromJSON({
        code: "X",
        category: "Y",
        retryable: true,
        message: "m",
        timestamp: 1748505600000.7,
      });

      expect(restored.timestamp).toBe(1748505600000.7);
      expect(restored.timestampIso).toBe(
        new Date(1748505600000.7).toISOString(),
      );
    });

    it("keeps a matching reconstruction time for a timestamp outside the date range", () => {
      for (const timestamp of [Infinity, 1e300, Number.NaN]) {
        const restored = StructuredError.fromJSON({
          code: "X",
          category: "Y",
          retryable: true,
          message: "m",
          timestamp,
        });

        expect(Number.isFinite(restored.timestamp)).toBe(true);
        expect(restored.timestampIso).toBe(
          new Date(restored.timestamp).toISOString(),
        );
      }
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
        StructuredError<string, string> | undefined;
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

    for (const field of [
      "code",
      "category",
      "retryable",
      "message",
      "details",
      "cause",
      "stack",
      "timestamp",
      "timestampIso",
      "errors",
    ]) {
      it(`does not throw when the \`${field}\` getter of an in-process payload throws`, () => {
        const payload: Record<string, unknown> = {
          code: "C",
          category: "X",
          retryable: false,
          message: "m",
        };
        delete payload[field];
        Object.defineProperty(payload, field, {
          get() {
            throw new Error(`${field} getter`);
          },
          enumerable: true,
        });

        const restored = StructuredError.fromJSON(payload);

        expect(restored).toBeInstanceOf(StructuredError);
      });
    }

    it("does not throw when a cause field's getter throws", () => {
      const restored = StructuredError.fromJSON({
        code: "C",
        category: "X",
        retryable: false,
        message: "m",
        cause: {
          name: "Error",
          get message(): string {
            throw new Error("nested message getter");
          },
        },
      });

      expect(restored).toBeInstanceOf(StructuredError);
    });

    it("drops details whose own property getter throws during the copy", () => {
      const restored = StructuredError.fromJSON({
        code: "C",
        category: "X",
        retryable: false,
        message: "m",
        details: {
          get secret(): string {
            throw new Error("secret getter");
          },
        },
      });

      expect(restored.code).toBe("C");
      expect(restored.details).toBeUndefined();
    });
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
  });
});
