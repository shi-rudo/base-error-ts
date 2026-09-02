import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

import {
  errorWithThrowingGetter,
  hostileProxy,
} from "./hostile-values.fixture.js";

/** A shared-reference graph that expands past the node budget per reference. */
const makeDag = (levels: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { leaf: "x" };
  for (let i = 0; i < levels; i++) {
    node = { a: node, b: node };
  }
  return node;
};

function wrap(cause: unknown): BaseError<"Outer"> {
  return new BaseError<"Outer">("outer failed", cause, { name: "Outer" });
}

function causeNode(error: BaseError<string>): Record<string, unknown> {
  return error.toLogObject().cause as Record<string, unknown>;
}

type Extended = Error & Record<string, unknown>;

describe("a native cause with a non-JSON extension field", () => {
  it("writes a nested bigint in details as its decimal string instead of making JSON.stringify throw", () => {
    const cause = new Error("db") as Extended;
    cause.details = { big: 10n, list: [1n, { deep: 2n }] };

    const error = wrap(cause);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(causeNode(error).details).toEqual({
      big: "10",
      list: ["1", { deep: "2" }],
    });
    expect(JSON.stringify(error)).toContain('"big":"10"');
  });

  it("writes a bigint code as its decimal string", () => {
    const cause = new Error("db") as Extended;
    cause.code = 10n;

    const error = wrap(cause);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(causeNode(error).code).toBe("10");
  });

  it("degrades a cyclic details object to the circular marker", () => {
    const cyclic: Record<string, unknown> = { name: "cyc" };
    cyclic.self = cyclic;
    const cause = new Error("db") as Extended;
    cause.details = cyclic;

    const error = wrap(cause);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(causeNode(error).details).toBe(
      "[Circular Object with keys: [name, self]]",
    );
  });

  it("degrades details whose toJSON throws to the circular marker", () => {
    const cause = new Error("db") as Extended;
    cause.details = {
      id: 7,
      toJSON() {
        throw new Error("toJSON");
      },
    };

    const error = wrap(cause);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(causeNode(error).details).toBe(
      "[Circular Object with keys: [id, toJSON]]",
    );
  });

  it("degrades a details graph past the node budget to the circular marker", () => {
    const cause = new Error("db") as Extended;
    cause.details = makeDag(18);

    const error = wrap(cause);

    expect(causeNode(error).details).toBe(
      "[Circular Object with keys: [a, b]]",
    );
  });

  it("keeps the node when details is a Proxy whose every trap throws", () => {
    const cause = new Error("db") as Extended;
    cause.details = hostileProxy();

    const error = wrap(cause);
    const node = causeNode(error);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(node.name).toBe("Error");
    expect(node.message).toBe("db");
    expect(typeof node.details).toBe("string");
  });

  it("reads details as absent when its getter throws", () => {
    const error = wrap(errorWithThrowingGetter("details"));

    expect(causeNode(error)).not.toHaveProperty("details");
  });

  it("omits a function-valued or symbol-valued extension field, as JSON.stringify does", () => {
    const cause = new Error("db") as Extended;
    cause.details = () => "secret";
    cause.category = Symbol("category");

    const node = causeNode(wrap(cause));

    expect(node).not.toHaveProperty("details");
    expect(node).not.toHaveProperty("category");
  });
});

describe("a native cause's extension fields are decoupled from the cause", () => {
  it("copies details instead of holding the reference", () => {
    const details: Record<string, unknown> = { host: "db.local" };
    const cause = new Error("db") as Extended;
    cause.details = details;

    const node = causeNode(wrap(cause));

    expect(node.details).not.toBe(details);
    expect(node.details).toEqual({ host: "db.local" });
  });

  it("does not change when the cause's details are mutated after logging", () => {
    const details: Record<string, unknown> = { host: "db.local" };
    const cause = new Error("db") as Extended;
    cause.details = details;
    const error = wrap(cause);

    const before = error.toLogObject();
    details.host = "changed";

    expect((before.cause as Record<string, unknown>).details).toEqual({
      host: "db.local",
    });
  });

  it("copies an object under name, message or stack instead of holding the reference", () => {
    const cause = new Error("db") as Extended;
    const stack = { message: "Bearer token" };
    cause.stack = stack as unknown as string;
    cause.name = { first: "n" } as unknown as string;

    const node = causeNode(wrap(cause));

    expect(node.stack).not.toBe(stack);
    expect(node.stack).toEqual({ message: "Bearer token" });
    expect(node.name).toEqual({ first: "n" });
    expect(() => JSON.stringify(node)).not.toThrow();
  });
});

describe("a well-formed cause serializes as before", () => {
  it("writes a Date in a StructuredError cause's details as its ISO string", () => {
    const inner = new StructuredError({
      code: "INNER",
      category: "DB",
      retryable: true,
      message: "inner",
      details: { a: 1, when: new Date(0) },
    });
    const error = wrap(inner);

    const node = causeNode(error);

    expect(node.details).toEqual({ a: 1, when: "1970-01-01T00:00:00.000Z" });
    expect(JSON.stringify(error)).toContain(
      '"details":{"a":1,"when":"1970-01-01T00:00:00.000Z"}',
    );
    expect(node.code).toBe("INNER");
    expect(node.category).toBe("DB");
    expect(node.retryable).toBe(true);
  });

  it("round-trips the cause's details through fromJSON", () => {
    const inner = new StructuredError({
      code: "INNER",
      category: "DB",
      retryable: true,
      message: "inner",
      details: { a: 1, nested: { b: [1, 2] } },
    });
    const outer = new StructuredError({
      code: "OUTER",
      category: "APP",
      retryable: false,
      message: "outer",
      cause: inner,
    });

    const restored = StructuredError.fromJSON(outer.toJSON());
    const cause = (restored as unknown as { cause: unknown }).cause as
      StructuredError<string, string> | undefined;

    expect(cause?.code).toBe("INNER");
    expect(cause?.details).toEqual({ a: 1, nested: { b: [1, 2] } });
  });

  it("serializes an aggregate member with a bigint code and a bigint in details", () => {
    const member = new Error("branch") as Extended;
    member.code = 1n;
    member.details = { big: 1n };
    const aggregate = new AggregateError([member], "fan-out");

    const error = wrap(aggregate);

    expect(() => JSON.stringify(error)).not.toThrow();
    const members = causeNode(error).errors as Record<string, unknown>[];
    expect(members[0]?.code).toBe("1");
    expect(members[0]?.details).toEqual({ big: "1" });
  });
});
