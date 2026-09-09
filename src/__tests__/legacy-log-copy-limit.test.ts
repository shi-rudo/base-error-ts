import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

function legacy(record: Record<string, unknown>): BaseError<"Legacy"> {
  class Legacy extends BaseError<"Legacy"> {
    protected override buildLogObject(): Record<string, unknown> {
      return record;
    }
  }
  return new Legacy("original");
}
function fields(count: number): Record<string, unknown> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`field${index}`, index]),
  );
}

describe("legacy record inspection limit", () => {
  it("appends a diagnostic without changing fixed decisions", () => {
    const log = legacy({
      message: "original",
      ...fields(1_100),
      code: 0,
      category: "VALIDATION",
      retryable: false,
    }).toLogObject();
    expect(log).toMatchObject({
      message: "original [Max log size exceeded]",
      code: 0,
      category: "VALIDATION",
      retryable: false,
    });
    expect(log).not.toHaveProperty("field1099");
  });
  it("reports an inspection cut even if all inspected values are undefined", () => {
    const log = legacy(
      Object.fromEntries(
        Array.from({ length: 1_100 }, (_, i) => [`field${i}`, undefined]),
      ),
    ).toLogObject();
    expect(log.message).toBe("original [Max log size exceeded]");
  });
  it("does not invent a cut at the exact custom inspection limit", () => {
    const log = legacy({ message: "original", ...fields(988) }).toLogObject();
    expect(log.message).toBe("original");
    expect(log.field987).toBe(987);
  });
  it("does not invent a cut when only recovered envelope keys follow the limit", () => {
    const log = legacy({
      ...fields(989),
      message: "original",
      code: 0,
      retryable: false,
    }).toLogObject();
    expect(log).toMatchObject({
      message: "original",
      code: 0,
      retryable: false,
      field988: 988,
    });
  });
  it("does not coerce a foreign message when reporting an inspection cut", () => {
    let conversions = 0;
    const message = {
      toString() {
        conversions++;
        throw new Error("foreign");
      },
    };
    const log = legacy({ message, ...fields(1_100) }).toLogObject();
    expect(log.message).toBe("[Max log size exceeded]");
    expect(conversions).toBe(0);
  });
});

it("keeps the base diagnosis when a cut legacy record has no defined fields", () => {
  class Empty extends BaseError<"Empty"> {
    readonly code = "PERMANENT";
    readonly retryable = false;
    protected override buildLogObject(): Record<string, unknown> {
      return Object.fromEntries(
        Array.from({ length: 1_100 }, (_, i) => [`field${i}`, undefined]),
      );
    }
  }
  const log = new Empty("original", new Error("inner")).toLogObject();
  expect(log).toMatchObject({
    message: "original [Max log size exceeded]",
    code: "PERMANENT",
    retryable: false,
    cause: { message: "inner" },
  });
  expect(typeof log.stack).toBe("string");
});
