import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

class OwnFieldsError extends BaseError<"OwnFieldsError"> {
  constructor(private readonly fields: Record<string, unknown>) {
    super("original message");
  }

  protected override buildOwnLogFields(): Record<string, unknown> {
    return this.fields;
  }
}

function acceptedFields(count: number): Record<string, unknown> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`field${index}`, index]),
  );
}

describe("own-field read and retention limits of the log", () => {
  it("drops a reserved key after index 100 when earlier undefined fields are skipped", () => {
    const fields = {
      skipped: undefined,
      ...acceptedFields(99),
      message: "override",
    };
    const log = new OwnFieldsError(fields).toLogObject();

    expect(log).toMatchObject(acceptedFields(99));
    expect(log.message).toBe("original message");
    expect(log).not.toHaveProperty("skipped");
  });

  it.each([99, 100])(
    "retains %i fields after hidden, symbol, and skipped keys",
    (count) => {
      const symbol = Symbol("hidden symbol");
      const target = Object.defineProperty(
        { [symbol]: "symbol", skipped: undefined, ...acceptedFields(count) },
        "hidden",
        { value: "hidden", configurable: true },
      );
      const fields = new Proxy(target, {
        ownKeys() {
          return [
            "hidden",
            symbol,
            "skipped",
            ...Object.keys(acceptedFields(count)),
          ];
        },
      });
      const log = new OwnFieldsError(fields).toLogObject();

      expect(log).toMatchObject(acceptedFields(count));
      expect(log).not.toHaveProperty("hidden");
      expect(log).not.toHaveProperty("skipped");
      expect(Object.getOwnPropertySymbols(log)).toEqual([]);
    },
  );

  it.each([100, 101])("retains at most 100 of %i accepted fields", (count) => {
    const fields = acceptedFields(count);
    const log = new OwnFieldsError(fields).toLogObject();

    expect(log).toMatchObject(acceptedFields(100));
    expect(log).not.toHaveProperty("field100");
  });

  it("drops the reserved key at index 999 within the 1000-key read limit", () => {
    const fields = { ...acceptedFields(999), message: "override" };
    const log = new OwnFieldsError(fields).toLogObject();

    expect(log).toMatchObject(acceptedFields(100));
    expect(log).not.toHaveProperty("field100");
    expect(log.message).toBe("original message");
  });

  it("does not read the key at index 1000 beyond the read limit", () => {
    let forbiddenReads = 0;
    const fields = new Proxy(
      { ...acceptedFields(1000), message: "override" },
      {
        getOwnPropertyDescriptor(target, key) {
          if (key === "message") forbiddenReads++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const log = new OwnFieldsError(fields).toLogObject();

    expect(log).toMatchObject(acceptedFields(100));
    expect(log.message).toBe("original message");
    expect(forbiddenReads).toBe(0);
  });
});
