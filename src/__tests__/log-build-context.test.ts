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
