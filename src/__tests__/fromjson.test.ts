import { afterEach, describe, it, expect, vi } from "vitest";
import {
  StructuredAggregateError,
  StructuredError,
  matchError,
} from "../index.js";
import { MAX_CAUSE_DEPTH } from "../errors/walker-bounds.js";
import { wideArrayLike } from "./hostile-values.fixture.js";

afterEach(() => {
  vi.useRealTimers();
});

/** A chain of native errors; the deepest one has the message `hop-0`. */
function nativeChain(length: number): Error {
  let head = new Error("hop-0");
  for (let hop = 1; hop < length; hop++) {
    const next = new Error(`hop-${hop}`);
    Object.defineProperty(next, "cause", {
      value: head,
      configurable: true,
      writable: true,
    });
    head = next;
  }
  return head;
}

function structured(
  message: string,
  cause?: unknown,
): StructuredError<string, string> {
  return new StructuredError({
    code: "C",
    category: "INTERNAL",
    retryable: false,
    message,
    cause,
  });
}

/**
 * The end of a logged cause spine. The walk follows the first member of an
 * aggregate, else the cause, and reports the slot after the last node.
 */
function spineEnd(log: unknown) {
  let node = log as Record<string, unknown>;
  let hops = 0;
  for (;;) {
    const members = node.errors;
    const next =
      Array.isArray(members) && members.length > 0 ? members[0] : node.cause;
    if (typeof next !== "object" || next === null) {
      return { hops, last: node.message, after: next };
    }
    node = next as Record<string, unknown>;
    hops++;
  }
}

function logOf(error: Error): unknown {
  return JSON.parse(JSON.stringify(error));
}

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
      expect(restored.toLogObject().timestampIso).toBe(
        original.toLogObject().timestampIso,
      );
    });

    it("restores the time from the ISO string when the timestamp is masked", () => {
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
      expect(restored.toLogObject().timestampIso).toBe(
        original.toLogObject().timestampIso,
      );
    });

    it("takes the numeric timestamp over a disagreeing ISO string", () => {
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
      expect(restored.toLogObject().timestampIso).toBe(
        "1970-01-01T00:00:00.000Z",
      );
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
      expect(restored.toLogObject().timestampIso).toBe(
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
        expect(restored.toLogObject().timestampIso).toBe(
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

  describe("the cause-depth cap after a round trip", () => {
    it("restores a chain through a structured aggregate as deep as the log wrote it", () => {
      const fanOut = new StructuredAggregateError({
        code: "FAN_OUT",
        category: "INTERNAL",
        retryable: false,
        message: "fan-out",
        errors: [structured("member", nativeChain(MAX_CAUSE_DEPTH - 2))],
      });
      const log = logOf(structured("root", fanOut));

      const relog = logOf(StructuredError.fromJSON(log));

      expect(spineEnd(log)).toEqual({
        hops: MAX_CAUSE_DEPTH,
        last: "hop-0",
        after: undefined,
      });
      expect(spineEnd(relog)).toEqual(spineEnd(log));
    });

    it("cuts and restores a chain under a member of the root at the same hop as under its cause", () => {
      const viaMember = logOf(
        new StructuredAggregateError({
          code: "FAN_OUT",
          category: "INTERNAL",
          retryable: false,
          message: "root",
          errors: [nativeChain(MAX_CAUSE_DEPTH)],
        }),
      );
      const viaCause = logOf(structured("root", nativeChain(MAX_CAUSE_DEPTH)));

      const relog = logOf(StructuredError.fromJSON(viaMember));

      expect(spineEnd(viaMember)).toEqual(spineEnd(viaCause));
      expect(spineEnd(relog)).toEqual(spineEnd(viaMember));
    });

    it("keeps the depth marker of a chain that the log cut", () => {
      const log = logOf(structured("root", nativeChain(MAX_CAUSE_DEPTH + 50)));

      const restored = StructuredError.fromJSON(log);

      expect(spineEnd(log).after).toBe("[Max cause depth exceeded]");
      expect(spineEnd(logOf(restored))).toEqual(spineEnd(log));
      expect(restored.toString()).toMatch(/\[Max cause depth exceeded\]$/);
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

    it("reads no stack of a payload error whose name or message is an object", () => {
      const wide = wideArrayLike();
      const cause = new Error("cause");
      Object.defineProperty(cause, "message", { value: wide.value });
      const root = new Error("root");
      Object.defineProperty(root, "name", { value: wide.value });
      Object.defineProperty(root, "cause", { value: cause });

      const restored = StructuredError.fromJSON(root);

      expect(restored).toBeInstanceOf(StructuredError);
      expect(wide.reads()).toBe(0);
    });

    it("drops details that is a revoked Proxy, at the root and on a cause", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      const envelope = { code: "C", category: "X", retryable: false };

      const restored = StructuredError.fromJSON({
        ...envelope,
        message: "root",
        details: proxy,
        cause: { name: "Error", message: "cause", code: "D", details: proxy },
      });

      const { cause } = restored as unknown as { cause: unknown };
      expect(restored.code).toBe("C");
      expect(restored.details).toBeUndefined();
      expect(cause).toMatchObject({ message: "cause", code: "D" });
      expect(cause).not.toHaveProperty("details");
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
