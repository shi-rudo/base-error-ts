import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

import { hostileProxy, revokedProxy } from "./hostile-values.fixture.js";

type Log = Record<string, unknown>;

function paymentFailure(details: unknown, cause?: unknown) {
  return new StructuredError({
    code: "PAYMENT_FAILED",
    category: "PAYMENT",
    retryable: false,
    message: "payment failed",
    details: details as Record<string, unknown>,
    ...(cause !== undefined && { cause }),
  });
}

function detailsAtRootAndAsCause(details: unknown): [unknown, unknown] {
  const atRoot = paymentFailure(details).toLogObject().details;
  const asCause = (
    new BaseError("outer", paymentFailure(details)).toLogObject().cause as Log
  ).details;
  return [atRoot, asCause];
}

/** A chain whose cause details alone spend the whole log budget. */
function causeChainBeyondTheLogBudget(): unknown {
  let cause: unknown;
  for (let i = 0; i < 60; i++) {
    cause = paymentFailure(
      { samples: Array.from({ length: 2_000 }, () => i) },
      cause,
    );
  }
  return cause;
}

describe("root details are copied as log data, as on a cause", () => {
  it("converts bigint, Date, Set, NaN and -0 like a cause does", () => {
    const details = {
      orderId: 10n,
      at: new Date(0),
      tags: new Set(["vip"]),
      ratio: NaN,
      zero: -0,
      nested: { amounts: [1n, 2] },
    };

    const [atRoot, asCause] = detailsAtRootAndAsCause(details);

    expect(atRoot).toEqual({
      orderId: "10",
      at: "1970-01-01T00:00:00.000Z",
      tags: {},
      ratio: null,
      zero: 0,
      nested: { amounts: ["1", 2] },
    });
    expect(atRoot).toEqual(asCause);
  });

  it("lets JSON.stringify serialize an error with a bigint in its root details", () => {
    const error = paymentFailure({ orderId: 10n });

    expect(JSON.stringify(error)).toContain('"orderId":"10"');
  });

  it("writes a cycle in the root details as the circular marker of a cause", () => {
    const cyclic: Log = { name: "cyc" };
    cyclic.self = cyclic;

    const [atRoot, asCause] = detailsAtRootAndAsCause(cyclic);

    expect(atRoot).toEqual({
      name: "cyc",
      self: "[Circular Object with keys: [name, self]]",
    });
    expect(atRoot).toEqual(asCause);
  });

  it("writes an error inside the root details as its diagnostic envelope", () => {
    const details = { upstream: new BaseError("db down") };

    const [atRoot, asCause] = detailsAtRootAndAsCause(details);

    expect((atRoot as Log).upstream).toMatchObject({ message: "db down" });
    expect((atRoot as Log).upstream).not.toBeInstanceOf(Error);
    expect(atRoot).toEqual(asCause);
  });

  it("replaces an unreadable value in the root details with the unserializable marker", () => {
    const details = { ok: 1, broken: hostileProxy(), revoked: revokedProxy() };

    const [atRoot, asCause] = detailsAtRootAndAsCause(details);

    expect(atRoot).toEqual({
      ok: 1,
      broken: "[Unserializable value]",
      revoked: "[Unserializable value]",
    });
    expect(atRoot).toEqual(asCause);
  });

  it("keeps the log of the root details unchanged when the details change after logging", () => {
    const details: Log = { status: "declined" };
    const error = paymentFailure(details);

    const log = error.toLogObject();
    details.status = "approved";

    expect(log.details).not.toBe(details);
    expect(log.details).toEqual({ status: "declined" });
    expect(error.details).toBe(details);
  });
});

describe("root details within the log budget", () => {
  it("writes the cause chain before oversized root details", () => {
    const details = { samples: Array.from({ length: 150_000 }, (_, i) => i) };
    const error = paymentFailure(details, new Error("db down"));

    const log = error.toLogObject();

    expect(log.cause).toMatchObject({ message: "db down" });
    expect(log.details).toBe("[Max log size exceeded]");
    expect(log.code).toBe("PAYMENT_FAILED");
  });

  it("keeps the scalar envelope when a cause tree spends the budget before the root details", () => {
    const error = paymentFailure(
      { orderId: "o-1" },
      causeChainBeyondTheLogBudget(),
    );

    const log = error.toLogObject();

    expect(log.details).toBe("[Max log size exceeded]");
    expect(log.code).toBe("PAYMENT_FAILED");
    expect(log.category).toBe("PAYMENT");
    expect(log.retryable).toBe(false);
  });

  it("writes root details beyond the budget as the size marker of a cause", () => {
    const details = { samples: Array.from({ length: 150_000 }, (_, i) => i) };

    const [atRoot, asCause] = detailsAtRootAndAsCause(details);

    expect(atRoot).toBe("[Max log size exceeded]");
    expect(atRoot).toEqual(asCause);
  });

  it("reads a wide root details object only within the log budget", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 150_000 }, (_, i) => [`k${i}`, i]),
    );
    let reads = 0;
    const counted = new Proxy(wide, {
      get(target, key, receiver) {
        reads++;
        return Reflect.get(target, key, receiver);
      },
    });

    const log = paymentFailure(counted).toLogObject();

    expect(log.details).toBe("[Max log size exceeded]");
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(100_000);
  });
});
