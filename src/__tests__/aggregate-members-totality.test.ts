import { describe, expect, it } from "vitest";
import {
  BaseError,
  filterCauseChain,
  someCauseChain,
  StructuredError,
} from "../index.js";

type LogNode = Record<string, unknown>;

/** An AggregateError whose `errors` holds the given value instead of an array. */
function aggregateWith(members: unknown): AggregateError {
  const aggregate = new AggregateError([], "fan-out");
  Object.defineProperty(aggregate, "errors", {
    value: members,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  return aggregate;
}

function wrap(cause: unknown): BaseError<string> {
  return new BaseError("outer", cause);
}

/** A BaseError whose own `errors` getter hands out the given value. */
function fanOutOf(members: unknown): BaseError<string> {
  class FanOut extends BaseError<"FanOut"> {
    public get errors(): unknown {
      return members;
    }
  }
  return new FanOut("fan-out");
}

function revokedProxy(): unknown {
  const { proxy, revoke } = Proxy.revocable([new Error("member")], {});
  revoke();
  return proxy;
}

class ThrowingSpeciesArray extends Array<unknown> {
  static override get [Symbol.species](): never {
    throw new Error("species trap");
  }
}

function throwingSpeciesArray(): unknown {
  const members = new ThrowingSpeciesArray();
  members.push(new Error("member"));
  return members;
}

function throwingIndexArray(): unknown {
  const members: unknown[] = [new Error("first"), new Error("second")];
  Object.defineProperty(members, 0, {
    get() {
      throw new Error("index getter");
    },
    configurable: true,
  });
  return members;
}

function throwingLengthProxy(): unknown {
  return new Proxy([new Error("member")], {
    get(target, key, receiver) {
      if (key === "length") throw new Error("length trap");
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

function arrayWithLength(length: unknown): unknown {
  return new Proxy([new Error("member")], {
    get(target, key, receiver) {
      return key === "length"
        ? length
        : (Reflect.get(target, key, receiver) as unknown);
    },
  });
}

const hostileMembers: ReadonlyArray<[string, () => unknown]> = [
  ["a revoked Proxy", revokedProxy],
  ["an Array subclass whose Symbol.species throws", throwingSpeciesArray],
  ["an array whose index getter throws", throwingIndexArray],
  ["a Proxy whose length trap throws", throwingLengthProxy],
  ["an array that reports its length as a string", () => arrayWithLength("3")],
  ["an array that reports a negative length", () => arrayWithLength(-1)],
  ["an array that reports a NaN length", () => arrayWithLength(Number.NaN)],
  [
    "an array that reports a length past the safe-integer range",
    () => arrayWithLength(2 ** 53),
  ],
];

describe.each(hostileMembers)(
  "aggregate members held in %s",
  (_label, members) => {
    it("do not break toString() of an error that wraps the aggregate", () => {
      const outer = wrap(aggregateWith(members()));

      let rendered = "";
      expect(() => {
        rendered = outer.toString();
      }).not.toThrow();

      expect(rendered).toContain("outer");
      expect(rendered).toContain("fan-out");
    });

    it("do not break the log object of an error that wraps the aggregate", () => {
      const outer = wrap(aggregateWith(members()));

      expect(() => JSON.stringify(outer)).not.toThrow();
      expect((outer.toLogObject().cause as LogNode).message).toBe("fan-out");
    });

    it("do not break the log object of an error that carries them itself", () => {
      const error = fanOutOf(members());

      expect(() => JSON.stringify(error)).not.toThrow();
      expect(error.toLogObject().message).toBe("fan-out");
    });

    it("do not break StructuredError.fromJSON", () => {
      const payload = {
        code: "X",
        category: "C",
        retryable: false,
        message: "m",
        errors: members(),
        cause: { message: "agg", errors: members() },
      };

      let restored: StructuredError<string, string> | undefined;
      expect(() => {
        restored = StructuredError.fromJSON(payload);
      }).not.toThrow();

      expect(restored?.code).toBe("X");
      const cause = (restored as { cause?: unknown }).cause;
      expect((cause as Error).message).toBe("agg");
    });

    it("do not break the tree traversal", () => {
      const aggregate = aggregateWith(members());

      expect(() =>
        filterCauseChain(aggregate, () => true, { aggregates: true }),
      ).not.toThrow();
      expect(
        someCauseChain(aggregate, (node) => node === aggregate, {
          aggregates: true,
        }),
      ).toBe(true);
    });
  },
);

describe("aggregate members that are partly readable", () => {
  it("log and render the readable members and count them all", () => {
    const outer = wrap(aggregateWith(throwingIndexArray()));

    const errors = (outer.toLogObject().cause as LogNode).errors as unknown[];
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeUndefined();
    expect((errors[1] as LogNode).message).toBe("second");

    const rendered = outer.toString();
    expect(rendered).toContain("(+2 aggregated)");
    expect(rendered).toContain("second");
  });
});

describe("well-formed aggregate members", () => {
  function wideAggregate(count: number): AggregateError {
    return new AggregateError(
      Array.from({ length: count }, (_, index) => new Error(`member ${index}`)),
      "wide",
    );
  }

  it("serialize 100 members and mark the remaining 50 of 150", () => {
    const errors = (wrap(wideAggregate(150)).toLogObject().cause as LogNode)
      .errors as unknown[];

    expect(errors).toHaveLength(101);
    expect((errors[0] as LogNode).message).toBe("member 0");
    expect((errors[99] as LogNode).message).toBe("member 99");
    expect(errors[100]).toBe("[50 more aggregated errors]");
  });

  it("count all 150 members on the toString() line and mark the tail", () => {
    const rendered = wrap(wideAggregate(150)).toString();

    expect(rendered).toContain("(+150 aggregated)");
    expect(rendered).toContain("member 99");
    expect(rendered).not.toContain("member 100");
    expect(rendered).toContain("[50 more aggregated errors]");
  });

  it("round-trip a capped aggregate through fromJSON unchanged", () => {
    const outer = new StructuredError({
      code: "X",
      category: "C",
      retryable: false,
      message: "m",
      cause: wideAggregate(150),
    });

    const restored = StructuredError.fromJSON(
      JSON.parse(JSON.stringify(outer)),
    );

    const cause = (restored as { cause?: unknown }).cause as AggregateError;
    expect(cause).toBeInstanceOf(AggregateError);
    expect(cause.errors).toHaveLength(101);
    expect((cause.errors[99] as Error).message).toBe("member 99");
    expect(cause.errors[100]).toBe("[50 more aggregated errors]");
  });

  it("visit every member of a wide aggregate within the node budget", () => {
    const visited = filterCauseChain(wideAggregate(150), () => true, {
      aggregates: true,
    });

    expect(visited).toHaveLength(151);
  });

  it("read at most the node budget of members from a sparse 20-million-length array", () => {
    let indexReads = 0;
    const wide = new Proxy(new Array<unknown>(20_000_000), {
      get(target, key, receiver) {
        if (typeof key === "string" && key !== "length") indexReads++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });

    const visited = filterCauseChain(aggregateWith(wide), () => true, {
      aggregates: true,
    });

    expect(visited).toHaveLength(2);
    expect(indexReads).toBeLessThanOrEqual(1000);
  });
});
