import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

class RequestFailure extends StructuredError<"REQUEST_FAILED", "UPSTREAM"> {
  constructor() {
    super({
      code: "REQUEST_FAILED",
      category: "UPSTREAM",
      retryable: true,
      message: "request failed",
      details: { upstream: "payments" },
      cause: new Error("connection lost"),
    });
    Object.defineProperties(this, {
      stack: { configurable: true, value: "REQUEST_FAILED: request failed" },
      timestamp: { configurable: true, value: 0 },
      timestampIso: {
        configurable: true,
        value: "1970-01-01T00:00:00.000Z",
      },
    });
  }

  protected override buildOwnLogFields(): Log {
    return { requestId: "req-123" };
  }
}

const expectedEnvelope: Log = {
  name: "REQUEST_FAILED",
  message: "request failed",
  stack: "REQUEST_FAILED: request failed",
  code: "REQUEST_FAILED",
  category: "UPSTREAM",
  retryable: true,
  details: { upstream: "payments" },
  timestamp: 0,
  timestampIso: "1970-01-01T00:00:00.000Z",
  cause: { name: "Error", message: "connection lost" },
  requestId: "req-123",
};

const logPaths: [string, (error: BaseError<string>) => Log][] = [
  ["toLogObject", (error) => error.toLogObject()],
  ["toJSON", (error) => error.toJSON()],
  ["JSON.stringify", (error) => JSON.parse(JSON.stringify(error)) as Log],
];

describe("the library owns the root log envelope", () => {
  it.each(logPaths)(
    "ignores a former hook method through %s",
    (_, logError) => {
      class FormerHookError extends RequestFailure {}
      let calls = 0;
      Object.defineProperty(FormerHookError.prototype, "buildLogObject", {
        value() {
          calls++;
          return { message: "forged", injected: "legacy contribution" };
        },
      });

      const log = logError(new FormerHookError());

      expect(log).toMatchObject(expectedEnvelope);
      expect(log).not.toHaveProperty("injected");
      expect(calls).toBe(0);
    },
  );

  it.each(logPaths)(
    "does not read a throwing former hook getter through %s",
    (_, logError) => {
      class FormerHookGetterError extends RequestFailure {}
      let reads = 0;
      Object.defineProperty(FormerHookGetterError.prototype, "buildLogObject", {
        get() {
          reads++;
          throw new Error("former hook getter");
        },
      });

      const log = logError(new FormerHookGetterError());

      expect(log).toMatchObject(expectedEnvelope);
      expect(reads).toBe(0);
    },
  );

  it("retains structured decisions when own fields try to replace the envelope", () => {
    class CollidingOwnFields extends RequestFailure {
      protected override buildOwnLogFields(): Log {
        return {
          name: "forged",
          message: "forged",
          stack: "forged",
          code: "FORGED",
          category: "FORGED",
          retryable: false,
          details: { forged: true },
          timestamp: 999,
          timestampIso: "forged",
          cause: { message: "forged" },
          errors: [{ message: "forged" }],
          requestId: "req-123",
        };
      }
    }

    const log = new CollidingOwnFields().toLogObject();

    expect(log).toMatchObject(expectedEnvelope);
    expect(log).not.toHaveProperty("errors");
  });

  it.each([
    "name",
    "message",
    "stack",
    "code",
    "category",
    "retryable",
    "details",
    "timestamp",
    "timestampIso",
    "cause",
  ])("preserves unrelated root fields when %s is unreadable", (key) => {
    const error = new RequestFailure();
    Object.defineProperty(error, key, {
      configurable: true,
      get() {
        throw new Error("unreadable root property");
      },
    });
    const expected = { ...expectedEnvelope };
    delete expected[key];

    const log = error.toLogObject();

    expect(log).toMatchObject(expected);
    expect(() => JSON.stringify(log)).not.toThrow();
  });
});
