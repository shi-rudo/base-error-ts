import { describe, expect, it } from "vitest";
import { StructuredError } from "../index.js";

type Mode = "allow" | "deny";
type Reads = {
  descriptors: number;
  values: number;
  hidden: number;
  tail: number;
};
const secret = "private-prefix-tail-value";
const sizeMarker = "[Max redaction size exceeded]";

function hiddenRecord(reads: Reads, customPrototype = false) {
  const target = Object.create(
    customPrototype ? { kind: "foreign record" } : Object.prototype,
  ) as Record<string, unknown>;
  for (let index = 0; index < 100_010; index++) {
    Object.defineProperty(target, `hidden${index}`, {
      enumerable: false,
      get() {
        reads.values++;
        reads.hidden++;
        return secret;
      },
    });
  }
  return new Proxy(target, {
    getOwnPropertyDescriptor(inner, key) {
      reads.descriptors++;
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
  });
}

function redactDetails(details: Record<string, unknown>, mode: Mode) {
  const error = new StructuredError({
    code: "PREFIX",
    category: "TEST",
    retryable: false,
    message: "diagnosis",
    details,
  });
  return (
    mode === "allow"
      ? error.redactAllow(["first"])
      : error.redact(["masked", "secret"])
  ).toLogObject();
}

function expectBoundedReads(reads: Reads) {
  expect.soft(reads.descriptors + reads.values).toBeGreaterThan(0);
  expect.soft(reads.descriptors + reads.values).toBeLessThanOrEqual(100_000);
  expect.soft(reads.hidden).toBe(0);
  expect.soft(reads.tail).toBe(0);
}

describe.each<Mode>(["allow", "deny"])("%s redaction data prefix", (mode) => {
  it.each([false, true])(
    "retains redacted fields before a size cut with custom prototype %s",
    (customPrototype) => {
      const reads: Reads = { descriptors: 0, values: 0, hidden: 0, tail: 0 };
      const big = hiddenRecord(reads, customPrototype);
      const details = {
        get first() {
          reads.values++;
          return "kept-scalar";
        },
        get masked() {
          reads.values++;
          return secret;
        },
        get big() {
          reads.values++;
          return big;
        },
        get secret() {
          reads.values++;
          reads.tail++;
          return secret;
        },
      };

      const log = redactDetails(details, mode);

      expectBoundedReads({ ...reads });
      expect.soft(log.details).toEqual({
        first: "kept-scalar",
        masked: "[REDACTED]",
        big: sizeMarker,
      });
      expect(JSON.stringify(log)).not.toContain(secret);
    },
  );

  it("retains an array prefix before its existing terminal size marker", () => {
    const reads: Reads = { descriptors: 0, values: 0, hidden: 0, tail: 0 };
    const items = new Proxy(
      [{ first: "kept-scalar", masked: secret }, ...Array(100_010).fill(null)],
      {
        get(inner, key) {
          if (typeof key === "string" && /^\d+$/.test(key)) reads.values++;
          return Reflect.get(inner, key);
        },
      },
    );

    const log = redactDetails({ items }, mode);

    expectBoundedReads({ ...reads });
    const retained = (log.details as { items: unknown[] }).items;
    expect(retained[0]).toEqual({ first: "kept-scalar", masked: "[REDACTED]" });
    expect(retained[retained.length - 1]).toBe(sizeMarker);
    expect(retained.length).toBeLessThan(items.length);
    expect(JSON.stringify(log)).not.toContain(secret);
  });

  it("retains its copied fields when its own hidden keys exhaust inspection", () => {
    const reads: Reads = { descriptors: 0, values: 0, hidden: 0, tail: 0 };
    const target: Record<string, unknown> = {
      first: "kept-scalar",
      masked: secret,
    };
    for (let index = 0; index < 100_010; index++) {
      Object.defineProperty(target, `hidden${index}`, {
        enumerable: false,
        get() {
          reads.values++;
          reads.hidden++;
          return secret;
        },
      });
    }
    const details = new Proxy(target, {
      getOwnPropertyDescriptor(inner, key) {
        reads.descriptors++;
        return Reflect.getOwnPropertyDescriptor(inner, key);
      },
    });

    const log = redactDetails(details, mode);

    expectBoundedReads({ ...reads });
    expect(log.details).toEqual({ first: "kept-scalar", masked: "[REDACTED]" });
    expect(JSON.stringify(log)).not.toContain(secret);
  });
});

describe.each<Mode>(["allow", "deny"])(
  "%s redaction data prefix controls",
  (mode) => {
    it("retains redacted fields when the size cut is the last field", () => {
      const reads: Reads = { descriptors: 0, values: 0, hidden: 0, tail: 0 };
      const details = {
        first: "kept-scalar",
        masked: secret,
        big: hiddenRecord(reads),
      };

      const log = redactDetails(details, mode);

      expectBoundedReads({ ...reads });
      expect(log.details).toEqual({
        first: "kept-scalar",
        masked: "[REDACTED]",
        big: sizeMarker,
      });
      expect(JSON.stringify(log)).not.toContain(secret);
    });

    it("uses the whole size marker when hidden-only details have no retained prefix", () => {
      const reads: Reads = { descriptors: 0, values: 0, hidden: 0, tail: 0 };
      const details = hiddenRecord(reads);

      const log = redactDetails(details, mode);

      expectBoundedReads({ ...reads });
      expect(log.details).toBe(sizeMarker);
      expect(JSON.stringify(log)).not.toContain(secret);
    });
  },
);
