import { describe, expect, it } from "vitest";
import { serializeLogData } from "../errors/log-data.js";
import { createLogBuildContext } from "../errors/log-build-context.js";

function serialize(value: unknown): unknown {
  return serializeLogData(
    value,
    createLogBuildContext(() => undefined),
  );
}

const cases: [string, () => unknown][] = [
  [
    "nested JSON values",
    () => ({ x: [null, true, 4, "text"], y: { z: false } }),
  ],
  ["date", () => ({ date: new Date("2020-02-03T04:05:06.000Z") })],
  ["invalid date", () => ({ date: new Date(NaN) })],
  ["number wrapper", () => ({ number: Object(8) })],
  ["string wrapper", () => ({ string: Object("hello") })],
  ["boolean wrapper", () => ({ boolean: Object(false) })],
  [
    "number wrapper conversion",
    () => ({ number: Object.assign(Object(8), { valueOf: () => 9 }) }),
  ],
  [
    "string wrapper conversion",
    () => ({
      string: Object.assign(Object("hello"), { toString: () => "converted" }),
    }),
  ],
  ["non-finite numbers", () => ({ values: [NaN, Infinity, -Infinity] })],
  [
    "absent object values",
    () => ({
      missing: undefined,
      callable: () => 1,
      symbol: Symbol("x"),
      kept: 1,
    }),
  ],
  [
    "array holes",
    () => {
      const value: unknown[] = [
        1,
        undefined,
        undefined,
        () => 1,
        Symbol("x"),
        6,
      ];
      delete value[1];
      return value;
    },
  ],
  [
    "escaping and unusual keys",
    () =>
      JSON.parse(
        String.raw`{"__proto__":{"safe":true},"\u0000":"\n\t\"\\","10":10,"2":2,"é":"😀"}`,
      ),
  ],
  ["collections", () => ({ map: new Map([["x", 1]]), set: new Set([1]) })],
  [
    "repeated references",
    () => {
      const shared = { x: 1 };
      return { a: shared, b: shared };
    },
  ],
  [
    "toJSON key and receiver",
    () => ({
      item: {
        value: "owned",
        toJSON(key: string) {
          return `${key}:${this.value}`;
        },
      },
    }),
  ],
  [
    "array toJSON key",
    () => [
      {
        toJSON(key: string) {
          return key;
        },
      },
    ],
  ],
  [
    "root toJSON key",
    () => ({
      toJSON(key: string) {
        return { key };
      },
    }),
  ],
  [
    "toJSON returning undefined",
    () => ({
      item: {
        toJSON() {
          return undefined;
        },
      },
    }),
  ],
  [
    "toJSON returning a function",
    () => ({
      item: {
        toJSON() {
          return () => 1;
        },
      },
    }),
  ],
  [
    "function with toJSON",
    () => ({ item: Object.assign(() => 1, { toJSON: () => "callback" }) }),
  ],
];

describe("log data serialization", () => {
  it.each(cases)("matches native JSON for %s", (_name, create) => {
    const expected = JSON.parse(JSON.stringify(create()));

    expect(serialize(create())).toEqual(expected);
  });

  it("copies repeated references independently", () => {
    const shared = { leaf: 1 };

    const copied = serialize({ a: shared, b: shared }) as {
      a: object;
      b: object;
    };

    expect(copied.a).not.toBe(shared);
    expect(copied.a).not.toBe(copied.b);
  });

  it("converts bigints at every depth", () => {
    expect(
      serialize({ value: 123n, nested: [456n], boxed: Object(789n) }),
    ).toEqual({
      value: "123",
      nested: ["456"],
      boxed: "789",
    });
  });

  it("preserves negative zero in the copied object", () => {
    expect(serialize({ value: -0 })).toEqual({ value: -0 });
  });

  it("preserves a top-level non-finite primitive", () => {
    expect(serialize(NaN)).toBeNaN();
  });

  it("uses a bounded description for a cycle", () => {
    const value: Record<string, unknown> = { secret: "value" };
    value.self = value;

    expect(serialize(value)).toBe(
      "[Circular Object with keys: [secret, self]]",
    );
  });

  it("uses the legacy fallback when toJSON throws", () => {
    const value = {
      toJSON() {
        throw new Error("consumer");
      },
    };

    expect(serialize(value)).toBe("[Circular Object with keys: [toJSON]]");
  });

  it("uses the legacy fallback when a toJSON read throws", () => {
    const value = Object.defineProperty({}, "toJSON", {
      get() {
        throw new Error("consumer");
      },
    });

    expect(serialize(value)).toBe("[Circular Object]");
  });

  it("guards a throwing data getter", () => {
    const value = {
      good: 1,
      get bad() {
        throw new Error("consumer");
      },
    };

    expect(serialize(value)).toEqual({ good: 1 });
  });

  it("cuts deep data before reading its children", () => {
    let reads = 0;
    let value: unknown = {
      get leaf() {
        reads++;
        return "secret";
      },
    };
    for (let depth = 0; depth < 100; depth++) value = { next: value };

    const copied = serialize(value);

    expect(reads).toBe(0);
    expect(JSON.stringify(copied)).not.toContain("secret");
  });
  it("shares one allowance across independent data fields", () => {
    const context = {
      budget: { nodes: 0, limit: 12 },
      dataError: () => undefined,
    };
    let reads = 0;
    const wide = Array.from({ length: 50 }, () => ({
      get value() {
        reads++;
        return 1;
      },
    }));

    expect(serializeLogData(wide, context)).toBe("[Max log size exceeded]");
    expect(serializeLogData("small sibling", context)).toBe(
      "[Max log size exceeded]",
    );
    expect(reads).toBe(3);
    expect(context.budget.nodes).toBe(12);
  });

  it("bounds non-enumerable descriptor inspections", () => {
    const context = {
      budget: { nodes: 0, limit: 12 },
      dataError: () => undefined,
    };
    const target = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [String(index), index]),
    );
    let inspections = 0;
    const value = new Proxy(target, {
      getOwnPropertyDescriptor(target, key) {
        inspections++;
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return descriptor ? { ...descriptor, enumerable: false } : undefined;
      },
    });

    expect(serializeLogData(value, context)).toBe("[Max log size exceeded]");
    expect(inspections).toBe(12);
  });

  it("projects recognized errors before reading their toJSON property", () => {
    const error = Object.defineProperty({}, "toJSON", {
      get() {
        throw new Error("must not run");
      },
    });
    const context = createLogBuildContext((value) =>
      value === error ? { message: "diagnosis" } : undefined,
    );

    expect(serializeLogData({ nested: error }, context)).toEqual({
      nested: { message: "diagnosis" },
    });
  });

  it("retains the cause spine without treating its envelopes as data depth", () => {
    let value: unknown = { message: "end" };
    for (let hop = 0; hop < 100; hop++) value = { cause: value };
    const context = createLogBuildContext(() => undefined);

    const copied = serializeLogData(value, context, "cause");

    expect(JSON.stringify(copied)).not.toContain("end");
    expect(JSON.stringify(copied)).toBe(
      '{"cause":'.repeat(100) + "{}" + "}".repeat(100),
    );
  });

  it("makes data regions absorbing for envelope-named descendants", () => {
    let reads = 0;
    let value: unknown = {
      get message() {
        reads++;
        return "secret";
      },
    };
    for (let hop = 0; hop < 100; hop++) value = { cause: value };
    const context = createLogBuildContext(() => undefined);

    serializeLogData({ details: value }, context, "cause");

    expect(reads).toBe(0);
  });
});
