import { describe, expect, it } from "vitest";
import { inspectOwnLogFields } from "../errors/own-log-fields-contract.js";

describe("inspectOwnLogFields", () => {
  it("accepts finite JSON data and shared references", () => {
    const shared = { id: "x" };
    expect(
      inspectOwnLogFields({ values: [null, true, 2, shared, shared] }),
    ).toEqual([]);
  });

  it.each([null, undefined, 1, "x", [], new Date()])(
    "reports an invalid root %s",
    (value) => {
      expect(inspectOwnLogFields(value)).toEqual([
        { path: [], reason: "invalid-root" },
      ]);
    },
  );

  it.each(["details", "cause", "errors", "name", "__proto__"])(
    "reports reserved root key %s",
    (key) => {
      expect(inspectOwnLogFields({ [key]: "x" })).toEqual([
        { path: [key], reason: "reserved-key" },
      ]);
    },
  );

  it("allows envelope names inside consumer data", () => {
    expect(
      inspectOwnLogFields({ context: { details: "x", cause: "y" } }),
    ).toEqual([]);
  });

  it.each([undefined, 1n, Symbol("x"), () => 1])(
    "reports values outside the JSON contract",
    (value) => {
      expect(inspectOwnLogFields({ context: [value] })).toEqual([
        { path: ["context", 0], reason: "unsupported-value" },
      ]);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "reports nonfinite numbers %s",
    (value) => {
      expect(inspectOwnLogFields({ value })).toEqual([
        { path: ["value"], reason: "non-finite-number" },
      ]);
    },
  );

  it.each([new Date(), new Map(), new Set(), new Number(1)])(
    "reports nonplain instances",
    (value) => {
      expect(inspectOwnLogFields({ value })).toEqual([
        { path: ["value"], reason: "non-plain-object" },
      ]);
    },
  );

  it("rejects a class instance whose prototype has no parent", () => {
    class Data {}
    Object.setPrototypeOf(Data.prototype, null);
    expect(inspectOwnLogFields({ value: new Data() })).toEqual([
      { path: ["value"], reason: "non-plain-object" },
    ]);
  });

  it("rejects a custom prototype that borrows Object as constructor", () => {
    const value: unknown = Object.create({
      constructor: Object,
      toJSON() {
        return {};
      },
    });
    expect(inspectOwnLogFields(value)).toEqual([
      { path: [], reason: "invalid-root" },
    ]);
  });

  it("rejects an array subclass without invoking inherited toJSON", () => {
    let calls = 0;
    class Values extends Array {
      toJSON() {
        calls++;
        return "changed";
      }
    }
    const nested = new Values();
    nested.push(1, 2);
    expect(inspectOwnLogFields({ nested })).toEqual([
      { path: ["nested"], reason: "non-plain-object" },
    ]);
    expect(calls).toBe(0);
  });

  it("rejects a forged root prototype without invoking inherited toJSON", () => {
    let calls = 0;
    const prototype = Object.assign(Object.create(null), {
      constructor: Object,
      toJSON() {
        calls++;
        return "changed";
      },
    });
    const nested: unknown = Object.assign(Object.create(prototype), {
      kept: 1,
    });
    expect(inspectOwnLogFields({ nested })).toEqual([
      { path: ["nested"], reason: "non-plain-object" },
    ]);
    expect(calls).toBe(0);
  });

  it("reports an accessor without executing it", () => {
    let reads = 0;
    const value = {
      get secret() {
        reads++;
        throw new Error("getter");
      },
    };
    expect(inspectOwnLogFields(value)).toEqual([
      { path: ["secret"], reason: "accessor" },
    ]);
    expect(reads).toBe(0);
  });

  it("reports callbacks without calling toJSON", () => {
    let calls = 0;
    const value = {
      nested: {
        toJSON() {
          calls++;
          return {};
        },
      },
    };
    expect(inspectOwnLogFields(value)).toEqual([
      { path: ["nested", "toJSON"], reason: "unsupported-value" },
    ]);
    expect(calls).toBe(0);
  });

  it("reports non-enumerable fields", () => {
    const value = Object.defineProperty({}, "hidden", { value: "x" });
    expect(inspectOwnLogFields(value)).toEqual([
      { path: ["hidden"], reason: "non-enumerable" },
    ]);
  });

  it("reports symbol keys without converting them", () => {
    expect(inspectOwnLogFields({ [Symbol("x")]: 1 })).toEqual([
      { path: [], reason: "unsupported-key" },
    ]);
  });

  it("reports extra array properties", () => {
    const value = Object.assign([1], { extra: 2 });
    expect(inspectOwnLogFields({ value })).toEqual([
      { path: ["value", "extra"], reason: "unsupported-key" },
    ]);
  });

  it("reports sparse arrays", () => {
    expect(inspectOwnLogFields({ value: Array(2) })).toEqual([
      { path: ["value"], reason: "sparse-array" },
    ]);
  });

  it("does not mistake an array accessor for a missing index", () => {
    const value = Object.defineProperty([1], "0", {
      get() {
        throw new Error("getter");
      },
    });
    expect(inspectOwnLogFields({ value })).toEqual([
      { path: ["value", 0], reason: "accessor" },
    ]);
  });

  it("does not coerce a forged array length descriptor", () => {
    let coercions = 0;
    const value = new Proxy([], {
      getOwnPropertyDescriptor(target, key) {
        return key === "length"
          ? {
              ...Reflect.getOwnPropertyDescriptor(target, key),
              value: {
                valueOf() {
                  coercions++;
                  return 0;
                },
              },
            }
          : Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(inspectOwnLogFields({ value })).toEqual([
      { path: ["value", "length"], reason: "unreadable" },
    ]);
    expect(coercions).toBe(0);
  });

  it("reports cycles at the repeated path", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(inspectOwnLogFields(value)).toEqual([
      { path: ["self"], reason: "circular-reference" },
    ]);
  });

  it("reports unreadable proxies", () => {
    const value = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("keys");
        },
      },
    );
    expect(inspectOwnLogFields(value)).toEqual([
      { path: [], reason: "unreadable" },
    ]);
  });

  it("reports revoked proxies", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(inspectOwnLogFields(proxy)).toEqual([
      { path: [], reason: "unreadable" },
    ]);
  });

  it("reports unreadable descriptors at their path", () => {
    const value = new Proxy(
      { x: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor");
        },
      },
    );
    expect(inspectOwnLogFields(value)).toEqual([
      { path: ["x"], reason: "unreadable" },
    ]);
  });

  it("caps depth before reaching unvisited descendants", () => {
    let value: unknown = { end: true };
    for (let index = 0; index < 110; index++) value = { next: value };
    const issues = inspectOwnLogFields(value);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe("depth-limit");
    expect(issues[0]?.path).toHaveLength(100);
  });

  it("reports the root width cut before inspecting additional fields", () => {
    let descriptors = 0;
    const value = new Proxy(
      Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [`k${index}`, index]),
      ),
      {
        getOwnPropertyDescriptor(target, key) {
          descriptors++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(inspectOwnLogFields(value)).toContainEqual({
      path: [],
      reason: "width-limit",
    });
    expect(descriptors).toBeLessThanOrEqual(100);
  });

  it("caps issue output for many invalid values", () => {
    const value = { items: Array(1000).fill(undefined) };
    const issues = inspectOwnLogFields(value);
    expect(issues).toHaveLength(100);
    expect(issues.every((issue) => issue.reason === "unsupported-value")).toBe(
      true,
    );
  });

  it("bounds descriptor work across shared data", () => {
    let descriptors = 0;
    const shared = new Proxy(
      Object.fromEntries(
        Array.from({ length: 500 }, (_, index) => [`k${index}`, index]),
      ),
      {
        getOwnPropertyDescriptor(target, key) {
          descriptors++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const issues = inspectOwnLogFields({ values: Array(500).fill(shared) });
    expect(issues.some((issue) => issue.reason === "node-limit")).toBe(true);
    expect(descriptors).toBeLessThanOrEqual(100_000);
  });
});
