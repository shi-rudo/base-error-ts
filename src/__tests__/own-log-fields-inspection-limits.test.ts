import { describe, expect, it } from "vitest";
import { BaseError, inspectOwnLogFields } from "../index.js";

class InspectedFieldsError extends BaseError<"InspectedFieldsError"> {
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

describe("own-field inspection and retained-field budgets", () => {
  it("reports a reserved key after index 100 when earlier undefined fields are skipped", () => {
    const fields = {
      skipped: undefined,
      ...acceptedFields(99),
      message: "override",
    };
    const log = new InspectedFieldsError(fields).toLogObject();

    expect(log).toMatchObject(acceptedFields(99));
    expect(log.message).toBe("original message");
    expect(log).not.toHaveProperty("skipped");
    expect(inspectOwnLogFields(fields)).toContainEqual({
      path: ["message"],
      reason: "reserved-key",
    });
  });

  it.each([99, 100])(
    "does not report a width cut with %i retained fields after hidden, symbol, and skipped keys",
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
      const log = new InspectedFieldsError(fields).toLogObject();

      expect(log).toMatchObject(acceptedFields(count));
      expect(log).not.toHaveProperty("hidden");
      expect(log).not.toHaveProperty("skipped");
      expect(Object.getOwnPropertySymbols(log)).toEqual([]);
      expect(inspectOwnLogFields(fields)).toEqual([
        { path: ["hidden"], reason: "non-enumerable" },
        { path: [], reason: "unsupported-key" },
        { path: ["skipped"], reason: "unsupported-value" },
      ]);
    },
  );

  it.each([100, 101])(
    "compares the retained limit at %i accepted fields",
    (count) => {
      const fields = acceptedFields(count);
      const log = new InspectedFieldsError(fields).toLogObject();

      expect(log).toMatchObject(acceptedFields(100));
      expect(log).not.toHaveProperty("field100");
      expect(inspectOwnLogFields(fields)).toEqual(
        count === 100 ? [] : [{ path: [], reason: "width-limit" }],
      );
    },
  );

  it("inspects the reserved key at index 999 within the 1000-key allowance", () => {
    const fields = { ...acceptedFields(999), message: "override" };
    const log = new InspectedFieldsError(fields).toLogObject();

    expect(log).toMatchObject(acceptedFields(100));
    expect(log).not.toHaveProperty("field100");
    expect(log.message).toBe("original message");
    expect(inspectOwnLogFields(fields)).toContainEqual({
      path: ["message"],
      reason: "reserved-key",
    });
  });

  it("does not inspect the reserved key at index 1000 beyond the read allowance", () => {
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
    const log = new InspectedFieldsError(fields).toLogObject();
    const issues = inspectOwnLogFields(fields);

    expect(log).toMatchObject(acceptedFields(100));
    expect(log.message).toBe("original message");
    expect(forbiddenReads).toBe(0);
    expect(issues).toEqual([{ path: [], reason: "width-limit" }]);
  });
});
