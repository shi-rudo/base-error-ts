import { describe, expect, it } from "vitest";
import { hasErrorCode, isStructuredError, StructuredError } from "../index.js";

/** The serialized shape of one node in a logged cause chain. */
type SerializedCause = Record<string, unknown>;

function causeOf(error: StructuredError<string, string>): SerializedCause {
  return error.toLogObject().cause as SerializedCause;
}

function aggregatedOf(error: StructuredError<string, string>): unknown[] {
  return causeOf(error).errors as unknown[];
}

function wrap(cause: unknown): StructuredError<string, string> {
  return new StructuredError({
    code: "OUTER",
    category: "INTERNAL",
    retryable: false,
    message: "outer failed",
    cause,
  });
}

describe("AggregateError as a cause", () => {
  describe("log serialization", () => {
    it("serializes the aggregated errors, which JSON.stringify drops", () => {
      const branch = new StructuredError({
        code: "DB_TIMEOUT",
        category: "TIMEOUT",
        retryable: true,
        message: "replica timed out",
        details: { host: "replica-1" },
      });
      const aggregate = new AggregateError(
        [branch, new Error("connection refused")],
        "all replicas failed",
      );

      const cause = causeOf(wrap(aggregate));

      expect(cause.name).toBe("AggregateError");
      expect(cause.message).toBe("all replicas failed");
      expect(cause.errors).toHaveLength(2);
      expect((cause.errors as SerializedCause[])[0]).toMatchObject({
        name: "DB_TIMEOUT",
        message: "replica timed out",
        code: "DB_TIMEOUT",
        category: "TIMEOUT",
        retryable: true,
        details: { host: "replica-1" },
      });
      expect((cause.errors as SerializedCause[])[1]).toMatchObject({
        name: "Error",
        message: "connection refused",
      });
    });

    it("keeps each aggregated error's own cause chain", () => {
      const branch = new StructuredError({
        code: "REQUEST_FAILED",
        category: "NETWORK",
        retryable: true,
        message: "request failed",
        cause: new Error("socket closed"),
      });

      const aggregated = aggregatedOf(
        wrap(new AggregateError([branch], "fan-out failed")),
      ) as SerializedCause[];

      expect(aggregated[0]?.cause).toMatchObject({ message: "socket closed" });
    });

    it("recurses into nested aggregates", () => {
      const inner = new AggregateError([new Error("deep")], "inner");
      const outer = new AggregateError([inner], "outer");

      const aggregated = aggregatedOf(wrap(outer)) as SerializedCause[];
      const nested = aggregated[0]?.errors as SerializedCause[];

      expect(nested[0]).toMatchObject({ message: "deep" });
    });

    it("reads `errors` by shape, not by AggregateError identity", () => {
      class FanOutError extends Error {
        public readonly errors: readonly unknown[];
        public constructor(errors: readonly unknown[]) {
          super("fan-out failed");
          this.name = "FanOutError";
          this.errors = errors;
        }
      }

      const aggregated = aggregatedOf(
        wrap(new FanOutError([new Error("branch")])),
      ) as SerializedCause[];

      expect(aggregated[0]).toMatchObject({ message: "branch" });
    });

    it("ignores a non-array `errors` property", () => {
      const error = new Error("not an aggregate");
      (error as unknown as Record<string, unknown>).errors = "nope";

      expect(causeOf(wrap(error))).not.toHaveProperty("errors");
    });

    it("caps the number of aggregated errors and marks the remainder", () => {
      const branches = Array.from(
        { length: 130 },
        (_, index) => new Error(`branch ${index}`),
      );

      const aggregated = aggregatedOf(
        wrap(new AggregateError(branches, "wide")),
      );

      expect(aggregated).toHaveLength(101);
      expect(aggregated[100]).toBe("[30 more aggregated errors]");
    });

    it("marks an already-serialized error instead of recursing forever", () => {
      const aggregate = new AggregateError([], "self-referencing");
      aggregate.errors.push(aggregate);

      expect(aggregatedOf(wrap(aggregate))[0]).toBe("[Circular cause chain]");
    });

    it("bounds aggregate nesting with the cause-depth budget", () => {
      let deepest: unknown = new Error("bottom");
      for (let level = 0; level < 130; level++) {
        deepest = new AggregateError([deepest], `level ${level}`);
      }

      const serialized = JSON.stringify(wrap(deepest).toLogObject());

      expect(serialized).toContain("[Max cause depth exceeded]");
    });
  });

  describe("redaction", () => {
    it("masks denied keys inside aggregated errors", () => {
      const branch = new StructuredError({
        code: "AUTH_FAILED",
        category: "AUTH",
        retryable: false,
        message: "bad credentials",
        details: { user: "ada", password: "s3cret" },
      });

      const aggregated = aggregatedOf(
        wrap(new AggregateError([branch], "login failed")).redact(["password"]),
      ) as SerializedCause[];

      expect(aggregated[0]?.details).toEqual({
        user: "ada",
        password: "[REDACTED]",
      });
    });

    it("keeps the structural envelope of aggregated errors under an allow-list", () => {
      const branch = new StructuredError({
        code: "DB_TIMEOUT",
        category: "TIMEOUT",
        retryable: true,
        message: "replica timed out",
        details: { host: "replica-1", token: "s3cret" },
      });

      const aggregated = aggregatedOf(
        wrap(new AggregateError([branch], "all replicas failed")).redactAllow([
          "host",
        ]),
      ) as SerializedCause[];

      expect(aggregated[0]).toMatchObject({
        name: "DB_TIMEOUT",
        message: "replica timed out",
        code: "DB_TIMEOUT",
        category: "TIMEOUT",
        retryable: true,
        details: { host: "replica-1", token: "[REDACTED]" },
      });
    });

    it("keeps the width marker readable under an allow-list", () => {
      const branches = Array.from(
        { length: 130 },
        (_, index) => new Error(`branch ${index}`),
      );

      const aggregated = aggregatedOf(
        wrap(new AggregateError(branches, "wide")).redactAllow([]),
      );

      expect(aggregated[100]).toBe("[30 more aggregated errors]");
    });

    it("treats a non-error aggregate member as data", () => {
      const aggregated = aggregatedOf(
        wrap(
          new AggregateError(
            [{ name: "Rejected", message: "no", apiKey: "s3cret" }],
            "fan-out failed",
          ),
        ).redactAllow([]),
      ) as SerializedCause[];

      // Envelope keys survive by name (the same trust model `cause` uses);
      // anything else a member carries is data and must be masked.
      expect(aggregated[0]).toEqual({
        name: "Rejected",
        message: "no",
        apiKey: "[REDACTED]",
      });
    });
  });
});

/**
 * The reconstructed `cause`. Read through a cast, the way the library itself
 * does: `Error.cause` is ES2022 and this package deliberately targets an
 * ES2021 lib.
 */
function roundTrip(error: StructuredError<string, string>): unknown {
  const restored = StructuredError.fromJSON(
    JSON.parse(JSON.stringify(error)) as unknown,
  );
  return (restored as unknown as { cause?: unknown }).cause;
}

describe("AggregateError round-trip through fromJSON", () => {
  it("reconstructs an aggregate cause as a real AggregateError", () => {
    const aggregate = new AggregateError(
      [
        new StructuredError({
          code: "DB_TIMEOUT",
          category: "TIMEOUT",
          retryable: true,
          message: "replica timed out",
        }),
        new Error("connection refused"),
      ],
      "all replicas failed",
    );

    const cause = roundTrip(wrap(aggregate)) as AggregateError;

    expect(cause).toBeInstanceOf(AggregateError);
    expect(cause.message).toBe("all replicas failed");
    expect(cause.errors).toHaveLength(2);
    expect(cause.errors[0]).toBeInstanceOf(StructuredError);
    expect(cause.errors[0]).toMatchObject({
      code: "DB_TIMEOUT",
      category: "TIMEOUT",
      retryable: true,
    });
    expect(cause.errors[1]).toBeInstanceOf(Error);
    expect((cause.errors[1] as Error).message).toBe("connection refused");
  });

  it("restores the aggregate's own stack and nested cause", () => {
    const aggregate = new AggregateError([new Error("branch")], "fan-out");
    const outer = wrap(aggregate);
    const originalStack = (outer.toLogObject().cause as Record<string, unknown>)
      .stack;

    const cause = roundTrip(outer) as AggregateError;

    expect(cause.stack).toBe(originalStack);
  });

  it("survives the width marker left by a capped aggregate", () => {
    const branches = Array.from(
      { length: 130 },
      (_, index) => new Error(`branch ${index}`),
    );

    const cause = roundTrip(
      wrap(new AggregateError(branches, "wide")),
    ) as AggregateError;

    expect(cause.errors).toHaveLength(101);
    expect(cause.errors[100]).toBe("[30 more aggregated errors]");
  });

  it("leaves a non-aggregate cause a plain Error", () => {
    const cause = roundTrip(wrap(new Error("plain")));

    expect(cause).toBeInstanceOf(Error);
    expect(cause).not.toBeInstanceOf(AggregateError);
  });
});

describe("a structured error that is itself an aggregate", () => {
  class BatchError extends StructuredError<"BATCH_FAILED", "INTERNAL"> {
    public readonly errors: readonly unknown[];
    public constructor(errors: readonly unknown[]) {
      super({
        code: "BATCH_FAILED",
        category: "INTERNAL",
        retryable: false,
        message: "batch failed",
      });
      this.errors = errors;
    }
  }

  it("round-trips its members alongside the structured fields", () => {
    const outer = wrap(new BatchError([new Error("item 3 failed")]));

    const cause = roundTrip(outer) as StructuredError<string, string> & {
      errors?: unknown[];
    };

    expect(cause.code).toBe("BATCH_FAILED");
    expect(cause.errors).toHaveLength(1);
    expect((cause.errors?.[0] as Error).message).toBe("item 3 failed");
  });

  it("keeps the members non-enumerable, as a native aggregate does", () => {
    const outer = wrap(new BatchError([new Error("item 3 failed")]));

    const cause = roundTrip(outer) as object;

    expect(Object.keys(cause)).not.toContain("errors");
    expect(Object.getOwnPropertyDescriptor(cause, "errors")).toMatchObject({
      enumerable: false,
      writable: true,
      configurable: true,
    });
  });
});

describe("fromJSON hardening", () => {
  it("caps aggregate width on the way in, not just on the way out", () => {
    // A foreign or hostile payload is not bound by the serializer's own cap,
    // and every reconstructed Error captures a stack.
    const payload = {
      code: "OUTER",
      category: "INTERNAL",
      retryable: false,
      message: "outer failed",
      cause: {
        name: "AggregateError",
        message: "wide",
        errors: Array.from({ length: 500 }, (_, index) => ({
          name: "Error",
          message: `branch ${index}`,
        })),
      },
    };

    const cause = (
      StructuredError.fromJSON(payload) as unknown as { cause: AggregateError }
    ).cause;

    expect(cause.errors).toHaveLength(101);
    expect(cause.errors[100]).toBe("[400 more aggregated errors]");
  });

  it("bounds the total number of reconstructed errors, not just depth and width", () => {
    // Depth and width caps alone allow 100^depth reconstructions, each an
    // Error with a stack capture. A shared reference makes the payload tiny.
    let node: Record<string, unknown> = { name: "Error", message: "leaf" };
    for (let level = 0; level < 3; level++) {
      node = {
        name: "AggregateError",
        message: `level ${level}`,
        errors: Array.from({ length: 100 }, () => node),
      };
    }
    const payload = {
      code: "OUTER",
      category: "INTERNAL",
      retryable: false,
      message: "outer failed",
      cause: node,
    };

    const restored = StructuredError.fromJSON(payload);

    // The root error itself is not a cause node; the budget bounds the rest.
    expect(countErrors(restored) - 1).toBeLessThanOrEqual(10_000);
    const outerAggregate = (restored as unknown as { cause: AggregateError })
      .cause;
    expect(outerAggregate.errors[outerAggregate.errors.length - 1]).toMatch(
      /^\[\d+ more aggregated errors\]$/,
    );
  });

  it("round-trips the serializer's own maximum aggregate output losslessly", () => {
    // Width 100 with 15-deep branch chains is inside every serializer cap and
    // writes ~1500 nodes; the reconstruction budget must not truncate what
    // the serializer legitimately produced.
    const members = Array.from({ length: 100 }, (_, index) => {
      let chain = new Error(`leaf ${index}`);
      for (let level = 0; level < 14; level++) {
        const next = new Error(`branch ${index} level ${level}`);
        Object.defineProperty(next, "cause", { value: chain });
        chain = next;
      }
      return chain;
    });
    const source = wrap(new AggregateError(members, "wide and deep"));

    const restored = StructuredError.fromJSON(
      JSON.parse(JSON.stringify(source)),
    );

    const cause = (restored as unknown as { cause: AggregateError }).cause;
    expect(cause.errors).toHaveLength(100);
    expect(countErrors(restored)).toBe(1 + 1 + 100 * 15);
  });

  it("reconstructs a payload within the budget in full", () => {
    const payload = {
      code: "OUTER",
      category: "INTERNAL",
      retryable: false,
      message: "outer failed",
      cause: {
        name: "AggregateError",
        message: "wide",
        errors: Array.from({ length: 100 }, (_, index) => ({
          name: "Error",
          message: `branch ${index}`,
          cause: { name: "Error", message: `root ${index}` },
        })),
      },
    };

    const restored = StructuredError.fromJSON(payload);

    expect(countErrors(restored)).toBe(202);
  });
});

/** Every Error reachable through `cause` and `errors`, each counted once. */
function countErrors(node: unknown, seen = new Set<unknown>()): number {
  if (!(node instanceof Error) || seen.has(node)) return 0;
  seen.add(node);
  let count = 1;
  count += countErrors((node as { cause?: unknown }).cause, seen);
  for (const member of (node as { errors?: unknown[] }).errors ?? []) {
    count += countErrors(member, seen);
  }
  return count;
}

describe("errno codes on reconstructed plain errors", () => {
  it("restores a Node-style `code` so hasErrorCode still matches", () => {
    const branch = new Error("connect ECONNREFUSED ::1:443");
    (branch as unknown as Record<string, unknown>).code = "ECONNREFUSED";

    const cause = roundTrip(
      wrap(new AggregateError([branch], "")),
    ) as AggregateError;

    expect(hasErrorCode("ECONNREFUSED")(cause.errors[0])).toBe(true);
  });

  it("does not make a plain error look structured", () => {
    const branch = new Error("nope");
    (branch as unknown as Record<string, unknown>).code = "ECONNREFUSED";

    const cause = roundTrip(
      wrap(new AggregateError([branch], "")),
    ) as AggregateError;

    expect(isStructuredError(cause.errors[0])).toBe(false);
  });
});

describe("toString() with an aggregate", () => {
  it("counts the members on the aggregate line", () => {
    const aggregate = new AggregateError(
      [new Error("branch a"), new Error("branch b")],
      "all branches failed",
    );

    const lines = wrap(aggregate).toString().split("\n");

    expect(lines[0]).toBe("[OUTER] outer failed");
    expect(lines[1]).toBe(
      "Caused by: AggregateError: all branches failed (+2 aggregated)",
    );
  });

  it("renders each member on its own indented line", () => {
    const aggregate = new AggregateError(
      [new Error("branch a"), new Error("branch b")],
      "wide",
    );

    const lines = wrap(aggregate).toString().split("\n");

    expect(lines.slice(2)).toEqual([
      "  - Error: branch a",
      "  - Error: branch b",
    ]);
  });

  it("follows a member's own cause chain, indented", () => {
    const branch = new StructuredError({
      code: "BRANCH",
      category: "TEST",
      retryable: false,
      message: "branch failed",
      cause: new Error("socket closed"),
    });

    const lines = wrap(new AggregateError([branch], "one")).toString();

    expect(lines).toContain("  - [BRANCH] branch failed");
    expect(lines).toContain("    Caused by: Error: socket closed");
  });

  it("marks a member that repeats instead of recursing", () => {
    const aggregate = new AggregateError([], "self-referencing");
    aggregate.errors.push(aggregate);

    expect(wrap(aggregate).toString()).toContain("[Circular cause chain]");
  });

  it("caps the rendered members", () => {
    const branches = Array.from(
      { length: 130 },
      (_, index) => new Error(`branch ${index}`),
    );

    const lines = wrap(new AggregateError(branches, "wide"))
      .toString()
      .split("\n");

    expect(lines[1]).toBe("Caused by: AggregateError: wide (+130 aggregated)");
    expect(lines).toHaveLength(103);
    expect(lines[102]).toBe("  [30 more aggregated errors]");
  });

  it("leaves a plain chain unchanged", () => {
    const error = wrap(new Error("plain"));

    expect(error.toString()).toBe(
      "[OUTER] outer failed\nCaused by: Error: plain",
    );
  });
});

describe("toString() stays total", () => {
  it("bounds deep aggregate nesting instead of overflowing the stack", () => {
    let deepest: unknown = new Error("bottom");
    for (let level = 0; level < 20_000; level++) {
      deepest = new AggregateError([deepest], `level ${level}`);
    }

    const rendered = wrap(deepest).toString();

    expect(rendered).toContain("[Max cause depth exceeded]");
  });

  it("renders a member with a very long cause chain", () => {
    let chain: unknown = new Error("bottom");
    for (let level = 0; level < 200_000; level++) {
      const next = new Error(`level ${level}`);
      Object.defineProperty(next, "cause", { value: chain, writable: true });
      chain = next;
    }

    expect(() =>
      wrap(new AggregateError([chain], "one")).toString(),
    ).not.toThrow();
  });
});

describe("a throwing `errors` getter", () => {
  const withThrowingMembers = (): Error => {
    const error = new Error("hostile");
    Object.defineProperty(error, "errors", {
      get() {
        throw new Error("getter");
      },
      configurable: true,
    });
    return error;
  };

  it("does not break the log path", () => {
    const error = wrap(withThrowingMembers());

    expect(() => error.toLogObject()).not.toThrow();
    expect((error.toLogObject().cause as Record<string, unknown>).message).toBe(
      "hostile",
    );
  });

  it("does not break an aggregating error's own log path", () => {
    class Hostile extends StructuredError<"H", "C"> {
      public constructor() {
        super({ code: "H", category: "C", retryable: false, message: "m" });
        Object.defineProperty(this, "errors", {
          get() {
            throw new Error("getter");
          },
          configurable: true,
        });
      }
    }

    expect(() => new Hostile().toLogObject()).not.toThrow();
  });
});
