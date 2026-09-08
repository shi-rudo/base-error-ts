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

  class WideHook extends BaseError<"WideHook"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      const fields: Record<string, unknown> = {};
      for (let index = 0; index < 150; index++) {
        fields[`f${index}`] = index;
      }
      return fields;
    }
  }

  it("counts a hook's fields against a width cap and marks the remainder", () => {
    const cause = causeOf(new BaseError("outer", new WideHook("inner")));

    expect(cause.f0).toBe(0);
    expect(cause.f99).toBe(99);
    expect(cause.f100).toBeUndefined();
    expect(cause.ownLogFields).toBe("[50 more log fields]");
  });

  it("applies the same width cap at the root", () => {
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

describe("the hook against the fields the library owns", () => {
  class SubclassOfStructured extends StructuredError<
    "CONFLICT",
    "CONFLICT",
    Record<string, unknown>
  > {
    constructor() {
      super({
        code: "CONFLICT",
        category: "CONFLICT",
        retryable: true,
        message: "stale version",
      });
    }
    protected override buildOwnLogFields(): Record<string, unknown> {
      return { expectedVersion: 3 };
    }
  }

  class EnvelopeNamed extends BaseError<"EnvelopeNamed"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return {
        category: "SECRET-CATEGORY",
        retryable: "SECRET-RETRYABLE",
        details: "SECRET-DETAILS",
        timestamp: "SECRET-TIMESTAMP",
        ordinary: "ordinary value",
      };
    }
  }

  it("keeps the structural fields a StructuredError subclass did not declare", () => {
    const log = new SubclassOfStructured().toLogObject();

    expect(log.code).toBe("CONFLICT");
    expect(log.category).toBe("CONFLICT");
    expect(log.retryable).toBe(true);
    expect(log.expectedVersion).toBe(3);
  });

  it("reconstructs such a subclass by its code after a round trip", () => {
    const wire = JSON.parse(
      JSON.stringify(new SubclassOfStructured()),
    ) as Record<string, unknown>;

    expect(StructuredError.fromJSON(wire).code).toBe("CONFLICT");
  });

  it("masks a hook field that carries an envelope name under an allow list", () => {
    const json = JSON.stringify(
      new EnvelopeNamed("m").redactAllow([]).toLogObject(),
    );

    expect(json).not.toContain("SECRET-CATEGORY");
    expect(json).not.toContain("SECRET-RETRYABLE");
    expect(json).not.toContain("SECRET-DETAILS");
    expect(json).not.toContain("SECRET-TIMESTAMP");
  });

  it("drops a hook field that carries an envelope name, keeping the library's", () => {
    const log = new EnvelopeNamed("m").toLogObject();

    expect(log.category).toBeUndefined();
    expect(log.timestamp).toBeTypeOf("number");
    expect(log.ordinary).toBe("ordinary value");
  });

  it("keeps a plain StructuredError's root key order", () => {
    const log = new StructuredError({
      code: "X",
      category: "C",
      retryable: false,
      message: "m",
    }).toLogObject();

    expect(Object.keys(log)[0]).toBe("name");
  });

  it("keeps JSON.stringify total when a hook returns a bigint at the root", () => {
    class BigIntRoot extends BaseError<"BigIntRoot"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { size: 10n };
      }
    }

    expect(() => JSON.stringify(new BigIntRoot("m"))).not.toThrow();
    expect(new BigIntRoot("m").toLogObject().size).toBe("10");
  });

  it("keeps JSON.stringify total when a hook returns a cycle at the root", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    class CycleRoot extends BaseError<"CycleRoot"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { graph: cyclic };
      }
    }

    expect(() => JSON.stringify(new CycleRoot("m"))).not.toThrow();
  });

  it("marks the loss at the root when the hook throws", () => {
    class ThrowingRoot extends BaseError<"ThrowingRoot"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        throw new Error("hook threw");
      }
    }

    expect(new ThrowingRoot("m").toLogObject().ownLogFields).toBe(
      "[Own log fields unavailable]",
    );
  });

  it("marks no loss for a cause behind a Proxy, which has no hook to lose", () => {
    const inner = new ConcurrencyConflictError(3, 5);
    const outer = new BaseError("outer", new Proxy(inner, {}));

    expect(causeOf(outer).ownLogFields).toBeUndefined();
  });

  it("shares one node budget across a node's own fields", () => {
    const wide = (): Record<string, unknown> => {
      const graph: Record<string, unknown> = {};
      for (let index = 0; index < 60_000; index++) graph[`k${index}`] = index;
      return graph;
    };
    class TwoBigFields extends BaseError<"TwoBigFields"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { first: wide(), second: wide() };
      }
    }
    const log = new TwoBigFields("m").toLogObject();

    expect(typeof log.second).toBe("string");
    expect(log.second).toContain("Circular");
  });
});

describe("the log object when a subclass hook or override fails", () => {
  class StructuredWideThrows extends StructuredError<
    "CONFLICT",
    "C",
    Record<string, unknown>
  > {
    constructor() {
      super({ code: "CONFLICT", category: "C", retryable: true, message: "m" });
    }
    protected override buildLogObject(): Record<string, unknown> {
      throw new Error("wide override threw");
    }
  }

  class WideThrowsHookWorks extends BaseError<"WideThrowsHookWorks"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return { jobId: "J-1" };
    }
    protected override buildLogObject(): Record<string, unknown> {
      throw new Error("wide override threw");
    }
  }

  class HookThrows extends BaseError<"HookThrows"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      throw new Error("hook threw");
    }
  }

  class Wide extends BaseError<"Wide"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      const f: Record<string, unknown> = {};
      for (let i = 0; i < 150; i++) f[`f${i}`] = i;
      return f;
    }
  }

  class ProtoHook extends BaseError<"ProtoHook"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      const f = Object.create(null) as Record<string, unknown>;
      f["__proto__"] = { polluted: "YES" };
      f.ok = 1;
      return f;
    }
  }

  it("keeps the machine-readable code when a subclass log-object override throws", () => {
    expect(new StructuredWideThrows().toLogObject().code).toBe("CONFLICT");
  });

  it("does not claim own fields are gone when the hook produced them", () => {
    const log = new WideThrowsHookWorks("m").toLogObject();
    expect(log.jobId).toBe("J-1");
    expect(log.ownLogFields).not.toBe("[Own log fields unavailable]");
  });

  it("keeps the unavailable marker readable on a cause under an allow list", () => {
    const outer = new BaseError("outer", new HookThrows("inner")).redactAllow(
      [],
    );
    const cause = outer.toLogObject().cause as Record<string, unknown>;
    expect(cause.ownLogFields).toBe("[Own log fields unavailable]");
  });

  it("masks the width marker at the root and keeps it readable on a cause", () => {
    expect(new Wide("w").redactAllow([]).toLogObject().ownLogFields).toBe(
      "[REDACTED]",
    );

    const outer = new BaseError("outer", new Wide("inner")).redactAllow([]);
    const cause = outer.toLogObject().cause as Record<string, unknown>;
    expect(cause.ownLogFields).toBe("[50 more log fields]");
  });

  it("keeps a __proto__ key from a hook away from a prototype setter", () => {
    const log = new ProtoHook("m").toLogObject();
    expect(Object.getPrototypeOf(log)).toBe(Object.prototype);
    expect(log.ok).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("the log object against a hostile or malformed hook record", () => {
  class HostileRecord extends BaseError<"HostileRecord"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return {
        ok: 1,
        get boom(): never {
          throw new Error("getter threw");
        },
      };
    }
  }

  class MarkerLookalike extends BaseError<"MarkerLookalike"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return { token: "[Unserializable cause]", plain: "SECRET" };
    }
  }

  class WideAndOverrideThrows extends BaseError<"WideAndOverrideThrows"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      const f: Record<string, unknown> = {};
      for (let i = 0; i < 150; i++) f[`f${i}`] = i;
      return f;
    }
    protected override buildLogObject(): Record<string, unknown> {
      throw new Error("override threw");
    }
  }

  class FunctionFields extends BaseError<"FunctionFields"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      const f: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) f[`fn${i}`] = () => i;
      f.real = "KEEP-ME";
      return f;
    }
  }

  class NotARecord extends BaseError<"NotARecord"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return ["a", "b"] as unknown as Record<string, unknown>;
    }
  }

  class Ordered extends BaseError<"Ordered"> {
    protected override buildOwnLogFields(): Record<string, unknown> {
      return { jobId: "J" };
    }
  }

  it("costs the fields, not the log, when a getter in the record throws", () => {
    const log = new HostileRecord("m").toLogObject();
    expect(log.message).toBe("m");
    expect(typeof log.stack).toBe("string");
  });

  it("costs the fields, not the node, when a cause record getter throws", () => {
    const outer = new BaseError("outer", new HostileRecord("inner"));
    const cause = outer.toLogObject().cause as Record<string, unknown>;
    expect(cause.message).toBe("inner");
  });

  it("masks a hook value that merely looks like a serializer marker", () => {
    const json = JSON.stringify(
      new MarkerLookalike("m").redactAllow([]).toLogObject(),
    );
    expect(json).not.toContain("[Unserializable cause]");
  });

  it("names a failed override even when the hook already made a statement", () => {
    const log = new WideAndOverrideThrows("m").toLogObject();
    expect(log.ownLogFields).toBe("[50 more log fields]");
    expect(log.logObjectOverride).toBe("[Log object override failed]");
  });

  it("spends the width cap only on fields that reach the log object", () => {
    const log = new FunctionFields("m").toLogObject();
    expect(log.real).toBe("KEEP-ME");
    expect(log.ownLogFields).toBeUndefined();
  });

  it("names the loss when a hook returns something that is not a record", () => {
    expect(new NotARecord("m").toLogObject().ownLogFields).toBe(
      "[Own log fields unavailable]",
    );
  });

  it("keeps name first in the root log object of a subclass with a hook", () => {
    expect(Object.keys(new Ordered("m").toLogObject())[0]).toBe("name");
  });
});
