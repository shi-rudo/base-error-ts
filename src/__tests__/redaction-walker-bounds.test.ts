import { describe, expect, it } from "vitest";

import { BaseError } from "../errors/BaseError.js";
import { StructuredError } from "../errors/StructuredError.js";

const FAIL_CLOSED = "[log redaction failed]";
const DEPTH_MARKER = "[Max redaction depth exceeded]";
const CYCLE_MARKER = "[Circular reference]";

type Log = Record<string, unknown>;

/** A plain-object cause chain of `hops` nested `cause` links. */
function plainCauseChain(hops: number): Log {
  let node: Log = { name: "Leaf", message: "leaf" };
  for (let index = 0; index < hops; index++) {
    node = { name: "Wrap", message: `wrap-${index}`, cause: node };
  }
  return node;
}

/** Arrays nested `depth` deep: `[[[...]]]`. */
function nestedArrays(depth: number): unknown[] {
  let node: unknown[] = [];
  for (let index = 0; index < depth; index++) node = [node];
  return node;
}

/** Objects nested `depth` deep under the key `child`. */
function nestedObjects(depth: number): Log {
  let node: Log = { leaf: "x" };
  for (let index = 0; index < depth; index++) node = { child: node };
  return node;
}

/** Objects nested `depth` deep under the key `errors`: `{ errors: { errors: … } }`. */
function nestedErrorsObjects(depth: number): Log {
  let node: Log = { leaf: "x" };
  for (let index = 0; index < depth; index++) node = { errors: node };
  return node;
}

/** A cause chain whose every `cause` is a one-element list: `{ cause: [inner] }`. */
function listCauseChain(hops: number): Log {
  let node: Log = { name: "Leaf", message: "leaf" };
  for (let index = 0; index < hops; index++) {
    node = { name: "Wrap", message: `wrap-${index}`, cause: [node] };
  }
  return node;
}

/** Counts the objects reached from the root through `cause` links, a list counting as free. */
function listSpineHops(log: Log): number {
  let hops = 0;
  let node: unknown = log.cause;
  while (typeof node === "object" && node !== null) {
    if (Array.isArray(node)) {
      node = node[0];
      continue;
    }
    hops++;
    node = (node as Log).cause;
  }
  return hops;
}

/** Counts the `errors` links from a node while each holds an object. */
function errorsObjectDepth(node: unknown): number {
  let depth = 0;
  let current: unknown = node;
  while (
    typeof current === "object" &&
    current !== null &&
    !Array.isArray(current)
  ) {
    const next = (current as Log).errors;
    if (typeof next !== "object" || next === null) break;
    depth++;
    current = next;
  }
  return depth;
}

/** Counts the `cause` links from the root of a log object. */
function spineHops(log: Log): number {
  let hops = 0;
  let node: unknown = log.cause;
  while (typeof node === "object" && node !== null) {
    hops++;
    node = (node as Log).cause;
  }
  return hops;
}

/** Follows `cause` links to the innermost object and returns it. */
function innermost(log: Log): Log {
  let node: Log = log;
  while (typeof node.cause === "object" && node.cause !== null) {
    node = node.cause as Log;
  }
  return node;
}

class OuterError extends StructuredError<"OUTER", "TEST", Log> {
  constructor(cause: unknown, details?: Record<string, unknown>) {
    super({
      code: "OUTER",
      category: "TEST",
      retryable: false,
      message: "outer",
      cause,
      details,
    });
  }
}

/** Puts arbitrary objects on the spine and in a foreign field, past the serializer. */
class HandRolledLogError extends BaseError<"HandRolledLogError"> {
  constructor(private readonly extra: Log) {
    super("hand-rolled");
  }

  protected override buildLogObject(): Log {
    return { ...super.buildLogObject(), ...this.extra };
  }
}

describe("redaction walker: the cause spine is depth-capped", () => {
  it("caps a plain-object cause chain deeper than the cause depth instead of dropping the log", () => {
    const error = new OuterError(plainCauseChain(3000)).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("outer");
    expect(typeof log.stack).toBe("string");
    expect(spineHops(log)).toBeLessThanOrEqual(101);
    expect(innermost(log).cause).toBe(DEPTH_MARKER);
  });

  it("caps a deep cause object that a subclass puts on the spine itself", () => {
    const error = new HandRolledLogError({
      cause: plainCauseChain(3000),
    }).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("hand-rolled");
    expect(spineHops(log)).toBeLessThanOrEqual(101);
    expect(innermost(log).cause).toBe(DEPTH_MARKER);
  });

  it("caps a deep chain hanging off an aggregate member on the spine", () => {
    const error = new HandRolledLogError({
      errors: [plainCauseChain(3000), "flat member"],
    }).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("hand-rolled");
    const members = log.errors as unknown[];
    expect(members).toHaveLength(2);
    expect(spineHops(members[0] as Log)).toBeLessThanOrEqual(101);
    expect(innermost(members[0] as Log).cause).toBe(DEPTH_MARKER);
  });

  it("keeps a cause chain within the cause depth in full", () => {
    const error = new OuterError(plainCauseChain(99)).redact(["password"]);

    const log = error.toLogObject();

    expect(spineHops(log)).toBe(100);
    expect(innermost(log).message).toBe("leaf");
    expect(JSON.stringify(log)).not.toContain(DEPTH_MARKER);
  });

  it("keeps a cause chain at the cause depth in full under an allow-list", () => {
    const error = new OuterError(plainCauseChain(99)).redactAllow([]);

    const log = error.toLogObject();

    expect(spineHops(log)).toBe(100);
    expect(innermost(log).message).toBe("leaf");
    expect(JSON.stringify(log)).not.toContain(DEPTH_MARKER);
  });

  it("gives every cause node its own data-depth budget", () => {
    const leaf: Log = {
      name: "Leaf",
      message: "leaf",
      details: nestedObjects(90),
    };
    let node: Log = leaf;
    for (let index = 0; index < 90; index++) {
      node = { name: "Wrap", message: `wrap-${index}`, cause: node };
    }
    const error = new OuterError(node).redact(["password"]);

    const log = error.toLogObject();

    expect(JSON.stringify(innermost(log).details)).toContain('"leaf":"x"');
  });
});

describe("redaction walker: a cycle is a marker, not a hundred nested clones", () => {
  it("marks a back-reference in the error's own details at its first repeat", () => {
    const order: Log = { id: "o1", password: "hunter2", items: [] as Log[] };
    for (let index = 0; index < 10; index++) {
      (order.items as Log[]).push({ sku: `sku-${index}`, order });
    }
    const error = new OuterError(undefined, { order }).redact(["password"]);

    const log = error.toLogObject();

    const json = JSON.stringify(log);
    expect(json.length).toBeLessThan(10_000);
    const logged = (log.details as Log).order as Log;
    expect(logged.id).toBe("o1");
    expect(logged.password).toBe("[REDACTED]");
    const items = logged.items as Log[];
    expect(items).toHaveLength(10);
    expect(items[0]?.sku).toBe("sku-0");
    expect(items[0]?.order).toBe(CYCLE_MARKER);
    expect(items[9]?.order).toBe(CYCLE_MARKER);
  });

  it("marks a self-referencing array", () => {
    const list: unknown[] = ["a"];
    list.push(list);
    const error = new OuterError(undefined, { list }).redact(["password"]);

    const log = error.toLogObject();

    expect((log.details as Log).list).toEqual(["a", CYCLE_MARKER]);
  });

  it("clones a shared reference once per reference when there is no cycle", () => {
    const shared: Log = { keep: "v", password: "hunter2" };
    const error = new OuterError(undefined, { a: shared, b: shared }).redact([
      "password",
    ]);

    const log = error.toLogObject();

    const details = log.details as Log;
    expect(details.a).toEqual({ keep: "v", password: "[REDACTED]" });
    expect(details.b).toEqual({ keep: "v", password: "[REDACTED]" });
    expect(details.a).not.toBe(details.b);
  });

  it("keeps the cycle marker readable under an allow-list", () => {
    const node: Log = { keep: "v" };
    node.self = node;
    const error = new OuterError(undefined, { node }).redactAllow(["keep"]);

    const log = error.toLogObject();

    expect((log.details as Log).node).toEqual({
      keep: "v",
      self: CYCLE_MARKER,
    });
  });
});

describe("redaction walker: hostile foreign fields degrade to a marker, not to the fail-closed envelope", () => {
  it("logs a native cause whose code is a 2000-deep array", () => {
    const cause = new Error("db") as Error & { code?: unknown };
    cause.code = nestedArrays(2000);
    const error = new BaseError("x", cause).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("x");
    expect(typeof log.stack).toBe("string");
    expect((log.cause as Log).message).toBe("db");
    expect(JSON.stringify(log.cause)).toContain(DEPTH_MARKER);
  });

  it("logs a native cause whose stack is a cyclic object under an allow-list", () => {
    const cyclic: Log = {};
    cyclic.stack = cyclic;
    const cause = new Error("db");
    Object.defineProperty(cause, "stack", {
      value: cyclic,
      writable: true,
      configurable: true,
    });
    const error = new BaseError("x", cause).redactAllow([]);

    const log = error.toLogObject();

    expect(log.message).not.toBe(FAIL_CLOSED);
    expect(log.message).toBe("x");
    expect((log.cause as Log).message).toBe("db");
    expect(JSON.stringify(log).length).toBeLessThan(5_000);
  });

  it("caps a deep foreign field that a subclass adds at the root in the data depth", () => {
    const error = new HandRolledLogError({
      trace: nestedObjects(3000),
    }).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("hand-rolled");
    expect(JSON.stringify(log.trace)).toContain(DEPTH_MARKER);
  });
});

describe("redaction walker: what counts as a hop on the cause spine", () => {
  it("treats an object chain under the key errors as data, capped by the data depth", () => {
    const error = new OuterError(nestedErrorsObjects(150)).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("outer");
    expect(errorsObjectDepth(log.cause)).toBeLessThanOrEqual(101);
    expect(JSON.stringify(log.cause)).toContain(DEPTH_MARKER);
  });

  it("does not drop the log for an errors object chain deeper than the host stack", () => {
    const error = new HandRolledLogError({
      errors: nestedErrorsObjects(5000),
    }).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("hand-rolled");
    expect(typeof log.stack).toBe("string");
    expect(errorsObjectDepth(log)).toBeLessThanOrEqual(101);
    expect(JSON.stringify(log.errors)).toContain(DEPTH_MARKER);
  });

  it("charges a cause that holds a list one hop per member, not two", () => {
    const error = new OuterError(listCauseChain(80)).redact(["password"]);

    const log = error.toLogObject();

    expect(listSpineHops(log)).toBe(81);
    expect(JSON.stringify(log)).not.toContain(DEPTH_MARKER);
  });

  it("cuts a list-linked cause chain at the same hop as an object-linked chain", () => {
    const listLinked = new OuterError(listCauseChain(150)).redact(["password"]);
    const objectLinked = new OuterError(plainCauseChain(150)).redact([
      "password",
    ]);

    const listLog = listLinked.toLogObject();
    const objectLog = objectLinked.toLogObject();

    expect(listSpineHops(listLog)).toBe(spineHops(objectLog));
    expect(listSpineHops(listLog)).toBe(100);
    expect(JSON.stringify(listLog)).toContain(DEPTH_MARKER);
  });

  it("charges every nesting level of a list under cause one hop", () => {
    const error = new HandRolledLogError({
      cause: nestedArrays(5000),
    }).redact(["password"]);

    const log = error.toLogObject();

    expect(log.message).toBe("hand-rolled");
    let depth = 0;
    let node: unknown = log.cause;
    while (Array.isArray(node)) {
      depth++;
      node = node[0];
    }
    expect(depth).toBeLessThanOrEqual(101);
    expect(node).toBe(DEPTH_MARKER);
  });

  it("charges an aggregate member one hop from the node that holds it", () => {
    const error = new HandRolledLogError({
      errors: [plainCauseChain(99)],
    }).redact(["password"]);

    const log = error.toLogObject();

    const member = (log.errors as Log[])[0] as Log;
    expect(spineHops(member)).toBe(99);
    expect(innermost(member).message).toBe("leaf");
    expect(JSON.stringify(log)).not.toContain(DEPTH_MARKER);
  });
});
