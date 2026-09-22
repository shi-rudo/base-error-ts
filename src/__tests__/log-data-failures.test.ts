import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

type Log = Record<string, unknown>;

class DataError extends BaseError<"DataError"> {
  constructor(private readonly fields: Log) {
    super("diagnosis");
  }

  protected override buildOwnLogFields(): Log {
    return this.fields;
  }
}

function throwingToJSON(): object {
  return {
    toJSON() {
      throw new Error("private serializer failure");
    },
  };
}

const failures: [string, () => unknown][] = [
  ["toJSON call", throwingToJSON],
  [
    "toJSON getter",
    () =>
      Object.defineProperty({}, "toJSON", {
        get() {
          throw new Error("private serializer failure");
        },
      }),
  ],
  [
    "number coercion",
    () =>
      Object.assign(Object(4), {
        [Symbol.toPrimitive]() {
          throw new Error("private serializer failure");
        },
      }),
  ],
  [
    "string coercion",
    () =>
      Object.assign(Object("text"), {
        toString() {
          throw new Error("private serializer failure");
        },
      }),
  ],
  [
    "Proxy enumeration",
    () =>
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("private serializer failure");
          },
        },
      ),
  ],
  [
    "revoked Proxy classification",
    () => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      return proxy;
    },
  ],
];

describe("log data serialization failures stay local", () => {
  it.each(failures)(
    "keeps object siblings around a failing %s",
    (_name, create) => {
      const error = new DataError({
        payload: { before: 1, failed: create(), after: 2 },
      });

      const log = error.toLogObject();

      expect(log.payload).toEqual({
        before: 1,
        failed: "[Unserializable value]",
        after: 2,
      });
    },
  );

  it.each(failures)(
    "keeps array siblings around a failing %s",
    (_name, create) => {
      const error = new DataError({ payload: [1, create(), 2] });

      const log = error.toJSON();

      expect(log.payload).toEqual([1, "[Unserializable value]", 2]);
    },
  );

  it("marks a directly failing own field without discarding other fields", () => {
    const error = new DataError({
      before: 1,
      failed: throwingToJSON(),
      after: 2,
    });

    const log = error.toLogObject();

    expect(log).toMatchObject({
      before: 1,
      failed: "[Unserializable value]",
      after: 2,
      message: "diagnosis",
    });
  });

  it("marks a directly failing native cause details value", () => {
    const cause = Object.assign(new Error("inner"), {
      details: throwingToJSON(),
    });
    const error = new BaseError("outer", cause);

    const log = error.toLogObject();

    expect(log.cause).toMatchObject({
      message: "inner",
      details: "[Unserializable value]",
    });
  });

  it("marks a directly failing plain object cause", () => {
    const error = new BaseError("outer", throwingToJSON());

    const log = error.toJSON();

    expect(log.cause).toBe("[Unserializable value]");
  });

  it("masks emitted failure markers as ordinary data under an empty allow-list", () => {
    const error = new DataError({
      direct: throwingToJSON(),
      payload: { before: 1, failed: throwingToJSON(), after: 2 },
      array: [1, throwingToJSON(), 2],
      literal: "[Unserializable value]",
    }).redactAllow([]);

    const log = JSON.parse(JSON.stringify(error)) as Log;

    expect(log).toMatchObject({
      message: "diagnosis",
      direct: "[REDACTED]",
      payload: {
        before: "[REDACTED]",
        failed: "[REDACTED]",
        after: "[REDACTED]",
      },
      array: ["[REDACTED]", "[REDACTED]", "[REDACTED]"],
      literal: "[REDACTED]",
    });
    expect(JSON.stringify(log)).not.toContain("private serializer failure");
  });

  it("does not serialize the exception thrown by a value", () => {
    const error = new DataError({ payload: throwingToJSON() });

    const json = JSON.stringify(error);

    expect(JSON.parse(json).payload).toBe("[Unserializable value]");
    expect(json).not.toContain("private serializer failure");
  });

  it("keeps readable siblings around a real cycle", () => {
    const cycle: Log = { leaf: 1 };
    cycle.self = cycle;
    const error = new DataError({ payload: { before: 1, cycle, after: 2 } });

    const log = error.toLogObject();

    expect(log.payload).toEqual({
      before: 1,
      cycle: { leaf: 1, self: "[Circular Object with keys: [leaf, self]]" },
      after: 2,
    });
  });

  it("stops sibling reads after the shared size budget is exhausted", () => {
    let laterReads = 0;
    const payload = {
      failed: throwingToJSON(),
      wide: Array(200_000).fill(1),
      get later() {
        laterReads++;
        return "must not be read";
      },
    };
    const error = new DataError({ payload, next: { small: 1 } });

    const log = error.toLogObject();

    expect(log.payload).toBe("[Max log size exceeded]");
    expect(log.next).toBe("[Max log size exceeded]");
    expect(laterReads).toBe(0);
  });

  it("marks ordinary throwing object getters", () => {
    const error = new DataError({
      payload: {
        before: 1,
        get failed() {
          throw new Error("ordinary getter");
        },
        after: 2,
      },
    });

    const log = error.toLogObject();

    expect(log.payload).toEqual({
      before: 1,
      failed: "[Unserializable value]",
      after: 2,
    });
  });

  it("marks ordinary throwing array getters", () => {
    const payload = [1, 0, 2];
    Object.defineProperty(payload, "1", {
      get() {
        throw new Error("ordinary getter");
      },
    });
    const error = new DataError({ payload });

    const log = error.toJSON();

    expect(log.payload).toEqual([1, "[Unserializable value]", 2]);
  });

  it("keeps successful conversions beside a failing value", () => {
    const shared = { value: 3 };
    const error = new DataError({
      payload: {
        date: new Date("2020-01-02T00:00:00.000Z"),
        bigint: 4n,
        failed: throwingToJSON(),
        custom: { toJSON: () => ({ converted: true }) },
        first: shared,
        second: shared,
      },
    });

    const log = error.toLogObject();

    expect(log.payload).toEqual({
      date: "2020-01-02T00:00:00.000Z",
      bigint: "4",
      failed: "[Unserializable value]",
      custom: { converted: true },
      first: { value: 3 },
      second: { value: 3 },
    });
  });
});
