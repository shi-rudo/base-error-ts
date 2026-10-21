import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

const ONE_DAY = 86_400_000;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const DAY_ONE_ISO = "1970-01-02T00:00:00.000Z";

function errorAt(timestamp: unknown): BaseError<"Timed"> {
  const error = new BaseError<"Timed">("timed", undefined, { name: "Timed" });
  Object.defineProperty(error, "timestamp", {
    configurable: true,
    value: timestamp,
  });
  return error;
}

function paymentFailure(details?: Record<string, unknown>) {
  return new StructuredError({
    code: "PAYMENT_FAILED",
    category: "PAYMENT",
    retryable: false,
    message: "payment failed",
    ...(details !== undefined && { details }),
  });
}

describe("the error stores its time once, in timestamp", () => {
  it("has no timestampIso property", () => {
    const error = new BaseError("probe");

    expect(Object.keys(error)).toContain("timestamp");
    expect(Object.keys(error)).not.toContain("timestampIso");
    expect("timestampIso" in error).toBe(false);
  });

  it("has no timestampIso property after fromJSON", () => {
    const restored = StructuredError.fromJSON(paymentFailure().toJSON());

    expect("timestampIso" in restored).toBe(false);
  });
});

describe("the log derives timestampIso from timestamp", () => {
  it("writes the ISO form of a timestamp that a subclass sets", () => {
    class ImportedFailure extends BaseError<"ImportedFailure"> {
      constructor(occurredAt: number) {
        super("import failed");
        Object.defineProperty(this, "timestamp", { value: occurredAt });
      }
    }

    const log = new ImportedFailure(ONE_DAY).toLogObject();

    expect(log).toMatchObject({
      timestamp: ONE_DAY,
      timestampIso: DAY_ONE_ISO,
    });
  });

  it("writes the ISO form of a timestamp assigned after construction", () => {
    const error = new BaseError("probe");
    Object.assign(error, { timestamp: ONE_DAY });

    const log = error.toLogObject();

    expect(log).toMatchObject({
      timestamp: ONE_DAY,
      timestampIso: DAY_ONE_ISO,
    });
  });

  it("states one instant when the timestamp getter changes between reads", () => {
    const error = new BaseError("probe");
    let reads = 0;
    Object.defineProperty(error, "timestamp", {
      get: () => (reads++ === 0 ? 0 : ONE_DAY),
    });

    const log = error.toLogObject();

    expect(log).toMatchObject({ timestamp: 0, timestampIso: EPOCH_ISO });
  });

  it.each<[string, unknown, unknown]>([
    ["NaN", NaN, null],
    ["Infinity", Infinity, null],
    ["beyond the date range", 8.64e15 + 1, 8.64e15 + 1],
    ["a numeric string", "0", "0"],
  ])(
    "omits timestampIso for a timestamp that is %s",
    (_label, timestamp, logged) => {
      const log = errorAt(timestamp).toLogObject();

      expect(log.timestamp).toBe(logged);
      expect(log).not.toHaveProperty("timestampIso");
    },
  );

  it.each<[string, PropertyDescriptor]>([
    ["a forged value", { value: "forged" }],
    ["a consumer container", { value: { token: "SECRET" } }],
    [
      "a throwing getter",
      {
        get() {
          throw new Error("unreadable timestampIso");
        },
      },
    ],
  ])("ignores an own timestampIso property with %s", (_label, descriptor) => {
    const error = errorAt(0);
    Object.defineProperty(error, "timestampIso", descriptor);

    const log = error.toLogObject();

    expect(log.timestampIso).toBe(EPOCH_ISO);
  });

  it("derives timestampIso for an error inside the details of a cause", () => {
    const cause = paymentFailure({ upstream: errorAt(0) });

    const log = new BaseError("outer", cause).toLogObject();

    const upstream = ((log.cause as Log).details as Log).upstream;
    expect(upstream).toMatchObject({ timestamp: 0, timestampIso: EPOCH_ISO });
  });

  it("keeps the derived timestampIso when a redactWith callback throws", () => {
    const error = errorAt(0).redactWith(() => {
      throw new Error("callback failed");
    });

    const log = error.toLogObject();

    expect(log).toMatchObject({
      message: "[log redaction failed]",
      timestamp: 0,
      timestampIso: EPOCH_ISO,
    });
  });

  it("writes the original instant after fromJSON", () => {
    const original = paymentFailure();
    Object.defineProperty(original, "timestamp", { value: ONE_DAY });

    const restored = StructuredError.fromJSON(original.toJSON());

    expect(restored.toLogObject()).toMatchObject({
      timestamp: ONE_DAY,
      timestampIso: DAY_ONE_ISO,
    });
  });
});
