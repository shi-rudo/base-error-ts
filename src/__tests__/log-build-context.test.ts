import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

class Fields extends BaseError<"Fields"> {
  constructor(
    private readonly fields: Record<string, unknown>,
    cause?: unknown,
  ) {
    super("fields", cause);
  }
  protected override buildOwnLogFields(): Record<string, unknown> {
    return this.fields;
  }
}

describe("independent public log builds", () => {
  it("keeps the full public log when called inside a data callback", () => {
    const nested = new Fields({ requestId: "R" }, new Error("inner"));
    const expected = nested.toLogObject();
    let actual: unknown;
    new Fields({
      payload: {
        toJSON() {
          actual = nested.toLogObject();
          return "converted";
        },
      },
    }).toLogObject();
    expect(actual).toEqual(expected);
  });

  it("does not spend the enclosing build's budget on an explicit nested build", () => {
    const nested = new Fields({
      huge: Array.from({ length: 100_001 }, () => 1),
    });
    const log = new Fields({
      payload: {
        toJSON() {
          nested.toLogObject();
          return "converted";
        },
      },
      requestId: "R",
    }).toLogObject();
    expect(log).toMatchObject({ payload: "converted", requestId: "R" });
  });

  it("keeps a data error shallow without calling its overridden toJSON", () => {
    class Nested extends BaseError<"Nested"> {
      override toJSON(): Record<string, unknown> {
        return { forged: "callback" };
      }
    }
    const log = new Fields({
      payload: { nested: new Nested("diagnosis") },
    }).toLogObject();
    expect(log.payload).toMatchObject({ nested: { message: "diagnosis" } });
  });
});

describe("legacy build continuation", () => {
  function fullCause(): Error {
    const cause = new Error("inner");
    Object.defineProperty(cause, "details", {
      value: Array.from({ length: 100_001 }, () => 1),
    });
    return cause;
  }

  it("shares the allowance when an override forwards the continuation", () => {
    class Forwarding extends Fields {
      protected override buildLogObject(
        buildBase?: () => Record<string, unknown>,
      ): Record<string, unknown> {
        return { ...super.buildLogObject(buildBase), legacy: "L" };
      }
    }
    const log = new Forwarding({ requestId: "R" }, fullCause()).toLogObject();
    expect(log).toMatchObject({
      legacy: "L",
      requestId: "[Max log size exceeded]",
      cause: { details: "[Max log size exceeded]" },
    });
  });

  it("keeps contextless super calls compatible with a separately bounded build", () => {
    class Legacy extends Fields {
      protected override buildLogObject(): Record<string, unknown> {
        return { ...super.buildLogObject(), legacy: "L" };
      }
    }
    const log = new Legacy({ requestId: "R" }, fullCause()).toLogObject();
    expect(log).toMatchObject({
      legacy: "L",
      requestId: "R",
      cause: { details: "[Max log size exceeded]" },
    });
  });
});

it("does not traverse consumer prototype chains to recognize a nested data error", () => {
  let reads = 0;
  let prototype: object | null = null;
  for (let index = 0; index < 100; index++) {
    const next: object | null = prototype;
    prototype = new Proxy(
      {},
      {
        getPrototypeOf(): object | null {
          reads++;
          return next;
        },
      },
    );
  }
  const value = new Proxy(
    { id: "R" },
    {
      getPrototypeOf(): object | null {
        reads++;
        return prototype;
      },
    },
  );
  class Fields extends BaseError<"Fields"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return { payload: Array.from({ length: 100 }, () => value) };
    }
  }
  const result = new Fields("root").toLogObject();
  expect(result.payload).toHaveLength(100);
  expect(reads).toBe(0);
});
