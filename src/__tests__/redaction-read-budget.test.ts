import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";
import { MAX_DATA_NODES } from "../errors/walker-bounds.js";

type Counts = {
  descriptors: number;
  values: number;
  ownKeys: number;
  prototypes: number;
};
type Mode = "allow" | "deny";
const secret = "private-redaction-probe-value";

function foreignRecord(
  count: number,
  enumerable: boolean,
  customPrototype = false,
) {
  const counts: Counts = {
    descriptors: 0,
    values: 0,
    ownKeys: 0,
    prototypes: 0,
  };
  const target = Object.create(
    customPrototype
      ? {
          toJSON() {
            return { secret };
          },
        }
      : Object.prototype,
  ) as Record<string, unknown>;
  const keys: string[] = [];
  for (let index = 0; index < count; index++) {
    const key = `field${index}`;
    keys.push(key);
    Object.defineProperty(target, key, {
      enumerable,
      get() {
        counts.values++;
        return secret;
      },
    });
  }
  if (!enumerable) {
    keys.push("secret");
    Object.defineProperty(target, "secret", {
      enumerable: true,
      get() {
        counts.values++;
        return secret;
      },
    });
  }
  const value = new Proxy(target, {
    ownKeys(inner) {
      counts.ownKeys++;
      return Reflect.ownKeys(inner);
    },
    getOwnPropertyDescriptor(inner, key) {
      counts.descriptors++;
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
    getPrototypeOf(inner) {
      counts.prototypes++;
      return Reflect.getPrototypeOf(inner);
    },
  });
  return { value, counts, keys };
}

function redactDetails(details: unknown, mode: Mode, denied: string[]) {
  class WithDetails extends BaseError<"WithDetails"> {
    readonly code = 0;
    readonly category = "PERMANENT";
    readonly retryable = false;
    readonly details = details;
  }
  const error = new WithDetails("original");
  return (
    mode === "allow" ? error.redactAllow([]) : error.redact(denied)
  ).toLogObject();
}

function checkBoundedAndMasked(
  log: Record<string, unknown>,
  raw: unknown,
  counts: Counts,
) {
  // Snapshot before assertion diagnostics can inspect either input object.
  const observedCounts = { ...counts };
  expect
    .soft(log)
    .toMatchObject({ code: 0, category: "PERMANENT", retryable: false });
  expect.soft(log.details === raw).toBe(false);
  expect.soft(JSON.stringify(log)).not.toContain(secret);
  const observed = JSON.stringify(observedCounts);
  expect
    .soft(observedCounts.values, observed)
    .toBeLessThanOrEqual(MAX_DATA_NODES);
  expect
    .soft(observedCounts.descriptors, observed)
    .toBeLessThanOrEqual(MAX_DATA_NODES);
  expect
    .soft(observedCounts.values + observedCounts.descriptors, observed)
    .toBeLessThanOrEqual(MAX_DATA_NODES);
}

describe.each<Mode>(["allow", "deny"])(
  "%s redaction read allowance",
  (mode) => {
    it("stops reading wide enumerable values at the shared allowance", () => {
      const foreign = foreignRecord(100_010, true);
      const log = redactDetails(foreign.value, mode, foreign.keys);
      checkBoundedAndMasked(log, foreign.value, foreign.counts);
    });

    it("charges non-enumerable descriptor work shared across sibling references", () => {
      const foreign = foreignRecord(60_000, false);
      const details = { first: foreign.value, second: foreign.value };
      const log = redactDetails(details, mode, ["secret"]);
      checkBoundedAndMasked(log, details, foreign.counts);
    });

    it("shares the allowance with custom-prototype walkability checks", () => {
      const foreign = foreignRecord(60_000, false, true);
      const details = { first: foreign.value, second: foreign.value };
      const log = redactDetails(details, mode, ["secret"]);
      checkBoundedAndMasked(log, details, foreign.counts);
    });

    it("does not retain a raw custom-prototype object when classification exhausts the allowance", () => {
      const foreign = foreignRecord(100_010, false, true);
      const log = redactDetails(foreign.value, mode, ["secret"]);
      checkBoundedAndMasked(log, foreign.value, foreign.counts);
    });
  },
);

describe.each<Mode>(["allow", "deny"])(
  "%s arrays returned by a cause policy",
  (mode) => {
    it("bounds index reads on the cause spine and preserves safe decisions", () => {
      let reads = 0;
      const errors = Array.from({ length: 100_010 }, (_, index) => index);
      for (let index = 0; index < errors.length; index++) {
        Object.defineProperty(errors, index, {
          get() {
            reads++;
            return null;
          },
        });
      }
      class WithDecisions extends BaseError<"WithDecisions"> {
        readonly code = 0;
        readonly category = "PERMANENT";
        readonly retryable = false;
      }
      const inner = new BaseError("inner").redactWith(() => ({ errors }));
      const error = new WithDecisions("outer", inner);

      const log = (
        mode === "allow" ? error.redactAllow([]) : error.redact([])
      ).toLogObject();

      expect(reads).toBeLessThanOrEqual(100_000);
      expect(log).toEqual({
        message: "[Max redaction size exceeded]",
        name: "WithDecisions",
        timestamp: error.timestamp,
        timestampIso: error.timestampIso,
        code: 0,
        category: "PERMANENT",
        retryable: false,
      });
    });
  },
);
