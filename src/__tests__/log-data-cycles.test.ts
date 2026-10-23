import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

type Log = Record<string, unknown>;

class DataError extends BaseError<"DataError"> {
  constructor(private readonly fields: Log) {
    super("diagnosis");
  }

  protected override buildOwnLogFields(): Log {
    return this.fields;
  }
}

function selfReferencingObject(): Log {
  const graph: Log = { leaf: 1 };
  graph.self = graph;
  return graph;
}

describe("log data replaces only repeated ancestor references", () => {
  it("preserves healthy fields surrounding a cyclic child", () => {
    const graph = selfReferencingObject();
    const error = new DataError({
      payload: { keep: "KEEP-ME", graph, after: "ALSO-KEEP" },
    });

    const log = error.toLogObject();

    expect(log.payload).toEqual({
      keep: "KEEP-ME",
      graph: {
        leaf: 1,
        self: "[Circular Object with keys: [leaf, self]]",
      },
      after: "ALSO-KEEP",
    });
  });

  it("describes the repeated ancestor in a mutually cyclic plain cause", () => {
    const parent: Log = { label: "parent" };
    parent.child = { label: "child", parent, after: "child sibling" };
    parent.after = "parent sibling";
    const error = new BaseError("outer", parent);

    const log = error.toJSON();

    expect(log.cause).toEqual({
      label: "parent",
      child: {
        label: "child",
        parent: "[Circular Object with keys: [label, child, after]]",
        after: "child sibling",
      },
      after: "parent sibling",
    });
  });

  it("preserves native cause details containing a cyclic child", () => {
    const cause = Object.assign(new Error("inner"), {
      details: {
        keep: "KEEP-ME",
        graph: selfReferencingObject(),
        after: "ALSO-KEEP",
      },
    });
    const error = new BaseError("outer", cause);

    const log = JSON.parse(JSON.stringify(error)) as Log;

    expect(log.cause).toMatchObject({
      message: "inner",
      details: {
        keep: "KEEP-ME",
        graph: {
          leaf: 1,
          self: "[Circular Object with keys: [leaf, self]]",
        },
        after: "ALSO-KEEP",
      },
    });
  });

  it("preserves array positions around a repeated array reference", () => {
    const values: unknown[] = ["before"];
    values.push(values, "after");
    const error = new DataError({ payload: { values, sibling: 2 } });

    const log = error.toJSON();

    expect(log.payload).toEqual({
      values: ["before", "[Circular Array with keys: [0, 1, 2]]", "after"],
      sibling: 2,
    });
  });

  it("bounds a repeated ancestor description without dropping its data", () => {
    const graph: Log = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    graph.self = graph;
    const error = new DataError({ graph });

    const log = error.toLogObject();

    expect(log.graph).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
      self: "[Circular Object with keys: [a, b, c, d, e]...]",
    });
  });

  it("redacts cycle descriptions and healthy data under an empty allow-list", () => {
    const values: unknown[] = ["before"];
    values.push(values, "after");
    const error = new DataError({
      payload: {
        keep: "KEEP-ME",
        graph: selfReferencingObject(),
        values,
        after: "ALSO-KEEP",
      },
    }).redactAllow([]);

    const log = error.toLogObject();

    expect(log.payload).toEqual({
      keep: "[REDACTED]",
      graph: { leaf: "[REDACTED]", self: "[REDACTED]" },
      values: ["[REDACTED]", "[REDACTED]", "[REDACTED]"],
      after: "[REDACTED]",
    });
  });

  it("copies repeated DAG references without calling them cycles", () => {
    const shared = { leaf: 1 };
    const error = new DataError({
      payload: { first: shared, second: shared, values: [shared, shared] },
    });

    const log = error.toLogObject();

    expect(log.payload).toEqual({
      first: { leaf: 1 },
      second: { leaf: 1 },
      values: [{ leaf: 1 }, { leaf: 1 }],
    });
  });

  it("terminates when toJSON returns an ancestor while preserving siblings", () => {
    const parent: Log = { before: 1 };
    parent.child = { toJSON: () => parent };
    parent.after = 2;
    const error = new DataError({ payload: parent });

    const log = error.toJSON();

    expect(log.payload).toEqual({
      before: 1,
      child: "[Circular Object with keys: [before, child, after]]",
      after: 2,
    });
  });

  it("charges repeated cycles to the shared visit budget", () => {
    let laterReads = 0;
    const graph = selfReferencingObject();
    const error = new DataError({
      payload: {
        cycles: Array(100_001).fill(graph),
        get later() {
          laterReads++;
          return "must not be read";
        },
      },
      next: { small: 1 },
    });

    const log = error.toLogObject();

    expect(log.payload).toBe("[Max log size exceeded]");
    expect(log.next).toBe("[Max log size exceeded]");
    expect(laterReads).toBe(0);
  });

  it("still aborts oversized data after recovering from a cycle", () => {
    let laterReads = 0;
    const error = new DataError({
      payload: {
        graph: selfReferencingObject(),
        wide: Array(200_000).fill(1),
        get later() {
          laterReads++;
          return "must not be read";
        },
      },
      next: { small: 1 },
    });

    const log = error.toLogObject();

    expect(log.payload).toBe("[Max log size exceeded]");
    expect(log.next).toBe("[Max log size exceeded]");
    expect(laterReads).toBe(0);
  });
});

/** An object with `width` keys whose values all return to the object. */
function wideSelfReference(width: number): {
  value: Log;
  ownKeysCalls: () => number;
} {
  let calls = 0;
  const target: Log = {};
  const value = new Proxy(target, {
    ownKeys(inner) {
      calls++;
      return Reflect.ownKeys(inner);
    },
  });
  for (let index = 0; index < width; index++) target[`k${index}`] = value;
  return { value, ownKeysCalls: () => calls };
}

describe("the circular-object marker", () => {
  it("lists the keys of a repeated ancestor once, however often it repeats", () => {
    const wide = wideSelfReference(200);

    const log = new DataError({ root: wide.value }).toLogObject();

    const root = log.root as Log;
    expect(root.k0).toBe(
      "[Circular Object with keys: [k0, k1, k2, k3, k4]...]",
    );
    expect(root.k199).toBe(root.k0);
    expect(wide.ownKeysCalls()).toBeLessThanOrEqual(2);
  });

  it("adds the ellipsis when a hidden key precedes the named keys", () => {
    const graph: Log = {};
    Object.defineProperty(graph, "hidden", { value: 1, enumerable: false });
    for (const key of ["a", "b", "c", "d", "e", "f"]) graph[key] = 1;
    graph.self = graph;

    const log = new DataError({ graph }).toLogObject();

    expect((log.graph as Log).self).toBe(
      "[Circular Object with keys: [a, b, c, d, e]...]",
    );
  });

  it("names only the type of a repeated ancestor whose keys cannot be read", () => {
    class Registry {}
    let reads = 0;
    const target = new Registry() as unknown as Log;
    const registry = new Proxy(target, {
      ownKeys(inner) {
        reads++;
        if (reads > 1) throw new Error("keys unavailable");
        return Reflect.ownKeys(inner);
      },
    });
    target.self = registry;

    const log = new DataError({ registry }).toLogObject();

    expect((log.registry as Log).self).toBe("[Circular Registry]");
  });

  it("takes the type from a constructor function only, never from data under a constructor key", () => {
    const data: Log = { constructor: { name: "hunter2" } };
    data.self = data;

    const log = new DataError({ data }).redact(["name"]).toLogObject();

    expect((log.data as Log).self).toBe(
      "[Circular Object with keys: [constructor, self]]",
    );
    expect(JSON.stringify(log)).not.toContain("hunter2");
  });
});
