import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

/** A subclass that contributes its own fields through the narrow hook. */
class ConcurrencyConflictError extends StructuredError<
  "CONCURRENCY_CONFLICT",
  "CONFLICT",
  Record<string, unknown>
> {
  public readonly expectedVersion: number;
  public readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number, cause?: unknown) {
    super({
      code: "CONCURRENCY_CONFLICT",
      category: "CONFLICT",
      retryable: true,
      message: "stale version",
      cause,
    });
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }

  protected override buildOwnLogFields(): Record<string, unknown> {
    return {
      expectedVersion: this.expectedVersion,
      actualVersion: this.actualVersion,
    };
  }
}

/** A subclass still on the wide hook, which this change deprecates. */
class LegacyOverride extends BaseError<"LegacyOverride"> {
  protected override buildLogObject(): Record<string, unknown> {
    return { ...super.buildLogObject(), attempt: 3 };
  }
}

const causeOf = (error: BaseError<string>): Record<string, unknown> =>
  error.toLogObject().cause as Record<string, unknown>;

describe("a cause's own log fields", () => {
  it("carries the fields of a subclass at the root, as it always did", () => {
    const log = new ConcurrencyConflictError(3, 5).toLogObject();

    expect(log.expectedVersion).toBe(3);
    expect(log.actualVersion).toBe(5);
  });

  it("carries the fields of a subclass when another error logs it as its cause", () => {
    const inner = new ConcurrencyConflictError(3, 5);
    const outer = new BaseError("write failed", inner);

    expect(causeOf(outer).expectedVersion).toBe(3);
    expect(causeOf(outer).actualVersion).toBe(5);
  });

  it("carries the fields of a subclass nested two levels down", () => {
    const inner = new ConcurrencyConflictError(3, 5);
    const middle = new BaseError("adapter failed", inner);
    const outer = new BaseError("request failed", middle);

    const nested = causeOf(outer).cause as Record<string, unknown>;
    expect(nested.expectedVersion).toBe(3);
  });

  it("carries the fields of a subclass held as an aggregate member", () => {
    const member = new ConcurrencyConflictError(3, 5);
    const aggregate = new AggregateError([member], "fan-out");
    const outer = new BaseError("batch failed", aggregate);

    const members = causeOf(outer).errors as Record<string, unknown>[];
    expect(members[0]?.expectedVersion).toBe(3);
  });

  it("keeps the structured fields of a StructuredError cause unchanged", () => {
    const inner = new StructuredError({
      code: "DB_TIMEOUT",
      category: "DATABASE",
      retryable: true,
      message: "timed out",
      details: { query: "select 1" },
    });
    const cause = causeOf(new BaseError("outer", inner));

    expect(cause.code).toBe("DB_TIMEOUT");
    expect(cause.category).toBe("DATABASE");
    expect(cause.retryable).toBe(true);
    expect(cause.details).toEqual({ query: "select 1" });
  });

  it("leaves a subclass on the wide hook working at the root", () => {
    expect(new LegacyOverride("legacy").toLogObject().attempt).toBe(3);
  });

  it("does not carry the fields of a subclass that stays on the wide hook", () => {
    const outer = new BaseError("outer", new LegacyOverride("legacy"));

    expect(causeOf(outer).attempt).toBeUndefined();
  });

  it("reads no hook from a cause behind a Proxy, which has no reachable brand", () => {
    const inner = new ConcurrencyConflictError(3, 5);
    const proxied = new Proxy(inner, {});
    const outer = new BaseError("outer", proxied);

    expect(causeOf(outer).expectedVersion).toBeUndefined();
    expect(causeOf(outer).message).toBe("stale version");
  });

  it("keeps the library's own envelope when a hook returns a colliding key", () => {
    class Colliding extends BaseError<"Colliding"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return {
          name: "forged",
          message: "forged",
          stack: "forged",
          cause: { message: "SMUGGLED" },
          errors: [{ message: "SMUGGLED" }],
        };
      }
    }
    const outer = new BaseError("outer", new Colliding("real message"));
    const cause = causeOf(outer);

    expect(cause.message).toBe("real message");
    expect(cause.name).toBe("Colliding");
    expect(JSON.stringify(outer)).not.toContain("SMUGGLED");
  });

  it("costs a cause its own fields, not its envelope, when the hook throws", () => {
    class ThrowingHook extends BaseError<"ThrowingHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        throw new Error("hook threw");
      }
    }
    const outer = new BaseError("outer", new ThrowingHook("inner message"));

    expect(() => JSON.stringify(outer)).not.toThrow();
    expect(causeOf(outer).message).toBe("inner message");
  });

  it("keeps a consumer's JSON.stringify total when a hook returns a bigint", () => {
    class BigIntHook extends BaseError<"BigIntHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { size: 10n };
      }
    }
    const outer = new BaseError("outer", new BigIntHook("inner"));

    expect(() => JSON.stringify(outer)).not.toThrow();
    expect(causeOf(outer).size).toBe("10");
  });

  it("decouples a hook's value, so a later mutation cannot change the log", () => {
    const live: Record<string, unknown> = { host: "db.local" };
    class LiveHook extends BaseError<"LiveHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { target: live };
      }
    }
    const cause = causeOf(new BaseError("outer", new LiveHook("inner")));
    live.host = "changed";

    expect(cause.target).toEqual({ host: "db.local" });
  });

  it("masks a cause's own fields under the cause's own allow list", () => {
    class SecretHook extends BaseError<"SecretHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { token: "SECRET-TOKEN" };
      }
    }
    const inner = new SecretHook("inner").redactAllow([]);
    const outer = new BaseError("outer", inner);

    expect(JSON.stringify(outer)).not.toContain("SECRET-TOKEN");
  });

  it("counts a hook's fields against a width cap and marks the remainder", () => {
    class WideHook extends BaseError<"WideHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        const fields: Record<string, unknown> = {};
        for (let index = 0; index < 150; index++) {
          fields[`f${index}`] = index;
        }
        return fields;
      }
    }
    const cause = causeOf(new BaseError("outer", new WideHook("inner")));

    expect(cause.f0).toBe(0);
    expect(cause.f99).toBe(99);
    expect(cause.f100).toBeUndefined();
    expect(cause.ownLogFields).toBe("[50 more log fields]");
  });

  it("applies the same width cap at the root", () => {
    class WideHook extends BaseError<"WideHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        const fields: Record<string, unknown> = {};
        for (let index = 0; index < 150; index++) {
          fields[`f${index}`] = index;
        }
        return fields;
      }
    }
    const log = new WideHook("inner").toLogObject();

    expect(log.f99).toBe(99);
    expect(log.f100).toBeUndefined();
    expect(log.ownLogFields).toBe("[50 more log fields]");
  });

  it("keeps a hook that sits exactly at the width cap whole and unmarked", () => {
    class ExactHook extends BaseError<"ExactHook"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        const fields: Record<string, unknown> = {};
        for (let index = 0; index < 100; index++) {
          fields[`f${index}`] = index;
        }
        return fields;
      }
    }
    const log = new ExactHook("inner").toLogObject();

    expect(log.f99).toBe(99);
    expect(log.ownLogFields).toBeUndefined();
  });

  it("still cuts a long chain at the cause depth cap", () => {
    let chain: BaseError<string> = new ConcurrencyConflictError(3, 5);
    for (let index = 0; index < 3000; index++) {
      chain = new BaseError(`hop ${index}`, chain);
    }

    let depth = 0;
    let node: unknown = chain.toLogObject();
    while (node !== null && typeof node === "object") {
      const next = (node as Record<string, unknown>).cause;
      if (next === undefined) break;
      node = next;
      depth++;
    }

    expect(depth).toBe(101);
  });
});

describe("a cause's own log fields across a fromJSON round trip", () => {
  it("does not restore a subclass's own fields, which stays a documented loss", () => {
    const inner = new ConcurrencyConflictError(3, 5);
    const outer = new BaseError("write failed", inner);
    const wire = JSON.parse(JSON.stringify(outer)) as Record<string, unknown>;

    expect((wire.cause as Record<string, unknown>).expectedVersion).toBe(3);

    const restored = StructuredError.fromJSON(wire);
    const cause = (restored as unknown as { cause: Record<string, unknown> })
      .cause;

    expect(cause.expectedVersion).toBeUndefined();
    expect(cause.code).toBe("CONCURRENCY_CONFLICT");
  });
});
