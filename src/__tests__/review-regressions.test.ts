import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;
class Fields extends BaseError<"Fields"> {
  constructor(
    private readonly fields: Log,
    cause?: unknown,
  ) {
    super("fields", cause);
  }
  protected override buildOwnLogFields(): Log {
    return this.fields;
  }
}

describe("review regressions", () => {
  it("retains the diagnosis of an error in a cause's details", () => {
    const inner = new StructuredError({
      code: "X",
      category: "C",
      retryable: false,
      message: "m",
      details: { inner: new BaseError("inner message") },
    });
    const log = new BaseError("root", inner).toLogObject();
    expect(log.cause).toMatchObject({
      details: {
        inner: {
          name: "BaseError",
          message: "inner message",
          stack: expect.any(String),
        },
      },
    });
  });
  it("applies the nested data error's sticky policy", () => {
    const nested = new BaseError("private").redact(["message", "stack"]);
    const log = new Fields({ payload: { nested } }).toLogObject();
    expect(log.payload).toMatchObject({
      nested: { message: "[REDACTED]", stack: "[REDACTED]" },
    });
  });
  it.each([{}, { foo: undefined }])(
    "uses the base envelope for an empty override %j",
    (fields) => {
      class Empty extends BaseError<"Empty"> {
        protected override buildLogObject(): Log {
          return fields;
        }
      }
      const error = new Empty("original", new Error("cause"));
      const log = error.toLogObject();
      expect(log).toMatchObject({
        message: "original",
        stack: error.stack,
        cause: { message: "cause" },
      });
    },
  );
  it("preserves root envelope order and the absent cause slot", () => {
    const error = new StructuredError({
      code: "X",
      category: "C",
      retryable: false,
      message: "m",
    });
    expect(Object.keys(error.toLogObject())).toEqual([
      "name",
      "message",
      "timestamp",
      "timestampIso",
      "stack",
      "cause",
      "code",
      "category",
      "retryable",
    ]);
  });
  it("shares the data budget across own fields and cause nodes", () => {
    let reads = 0;
    const wide = Array.from({ length: 20_000 }, () => ({
      get value() {
        reads++;
        return 1;
      },
    }));
    const fields = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`f${i}`, wide]),
    );
    const log = new Fields(fields, new Fields(fields)).toLogObject();
    expect(reads).toBeLessThanOrEqual(100_000);
    expect(JSON.stringify(log)).toContain("[Max log size exceeded]");
    expect(JSON.stringify(log)).not.toContain("[Circular");
  });
  it("distinguishes an oversized field from a cycle in later fields", () => {
    const log = new Fields({
      large: Array(100_001).fill(1),
      small: "innocent",
    }).toLogObject();
    expect(log.large).toBe("[Max log size exceeded]");
    expect(log.small).toBe("[Max log size exceeded]");
  });
  it("bounds repeated aggregate graphs by one build budget", () => {
    let reads = 0;
    let error: Error = new Error("leaf");
    for (let depth = 0; depth < 6; depth++) {
      const previous = error;
      error = new AggregateError(
        Array.from({ length: 10 }, () =>
          Object.assign(new Error("branch"), { cause: previous }),
        ),
        "fanout",
      );
      Object.defineProperty(error, "details", {
        get() {
          reads++;
          return Array(20_000).fill(1);
        },
      });
    }
    const log = new BaseError("root", error).toLogObject();
    expect(reads).toBeLessThanOrEqual(6);
    expect(JSON.stringify(log)).toContain("[Max log size exceeded]");
  });
  it("enumerates a custom prototype log only once", () => {
    let enumerations = 0;
    const record = new Proxy(
      Object.assign(Object.create({}) as Log, { message: "custom" }),
      {
        ownKeys(value) {
          enumerations++;
          return Reflect.ownKeys(value);
        },
      },
    );
    class Custom extends BaseError<"Custom"> {
      protected override buildLogObject(): Log {
        return record;
      }
    }
    expect(new Custom("original").toLogObject().message).toBe("custom");
    expect(enumerations).toBe(1);
  });
});

it("retains non-enumerable own envelope fields from an override", () => {
  class Hidden extends BaseError<"Hidden"> {
    protected override buildLogObject(): Log {
      return Object.defineProperty({}, "message", {
        value: "custom diagnostic",
      });
    }
  }
  expect(new Hidden("original").toLogObject().message).toBe(
    "custom diagnostic",
  );
});

it("bounds fallback key inspections after a failed data callback", () => {
  let descriptors = 0;
  const target = Object.fromEntries(
    Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 1]),
  );
  Object.defineProperty(target, "toJSON", {
    value() {
      throw new Error("failed");
    },
  });
  const value = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      descriptors++;
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  const fields = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`f${i}`, value]),
  );
  new Fields(fields).toLogObject();
  expect(descriptors).toBeLessThanOrEqual(100_000);
});

it("charges non-enumerable hook key inspections across aggregate branches", () => {
  let inspections = 0;
  const target: Log = {};
  for (let index = 0; index < 1000; index++)
    Object.defineProperty(target, `k${index}`, { value: 1 });
  const fields = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      inspections++;
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  const branches = Array.from(
    { length: 2 },
    () =>
      new AggregateError(
        Array.from({ length: 100 }, () => new Fields(fields)),
        "branch",
      ),
  );
  new BaseError("root", new AggregateError(branches, "fanout")).toLogObject();
  expect(inspections).toBeLessThanOrEqual(100_001);
});

it("preserves only emitted aggregate size markers under a sticky allow-list", () => {
  const large = Object.assign(new Error("large"), {
    details: Array(100_001).fill(1),
  });
  const nested = new BaseError(
    "middle",
    new AggregateError(
      ["[Max log size exceeded]", large, new Error("tail")],
      "fanout",
    ),
  ).redactAllow([]);
  const log = new BaseError("root", nested).redactAllow([]).toLogObject();
  const cause = log.cause as Log;
  const aggregate = cause.cause as Log;
  const errors = aggregate.errors as unknown[];
  expect(errors[0]).toBe("[REDACTED]");
  expect(errors[2]).toBe("[Max log size exceeded]");
  expect(errors[1]).toMatchObject({ details: "[REDACTED]" });
});

it("bounds non-enumerable descriptor reads inside copied data", () => {
  let inspections = 0;
  const target: Log = {};
  for (let index = 0; index < 10_000; index++)
    Object.defineProperty(target, `k${index}`, { value: 1 });
  const value = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      inspections++;
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  const fields = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i}`, value]),
  );
  new Fields(fields).toLogObject();
  expect(inspections).toBeLessThanOrEqual(100_001);
});

it("marks a data cut hidden behind non-enumerable keys", () => {
  const data: Log = {};
  for (let i = 0; i < 100_001; i++)
    Object.defineProperty(data, `k${i}`, { value: 1 });
  data.visible = "diagnostic";
  expect(new Fields({ data }).toLogObject().data).toBe(
    "[Max log size exceeded]",
  );
});

it("honors a nested callable's JSON callback", () => {
  const callable = Object.assign(() => undefined, {
    toJSON: () => "diagnostic",
  });
  expect(new Fields({ data: { callable } }).toLogObject().data).toEqual({
    callable: "diagnostic",
  });
});

it("honors boxed number conversion hooks", () => {
  const value = Object.assign(new Number(1), { valueOf: () => 9 });
  expect(new Fields({ data: { value } }).toLogObject().data).toEqual({
    value: 9,
  });
});

it("does not let a wrapper's tag replace its JSON primitive value", () => {
  const value = Object.assign(new Number(1), {
    [Symbol.toStringTag]: "Custom",
  });
  expect(new Fields({ data: { value } }).toLogObject().data).toEqual({
    value: 1,
  });
});
