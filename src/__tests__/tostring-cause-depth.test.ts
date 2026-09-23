import { describe, expect, it } from "vitest";

import { BaseError } from "../index.js";
import { MAX_LOG_SIZE_MARKER } from "../errors/serializer-markers.js";
import { MAX_LOG_NODES } from "../errors/walker-bounds.js";

const DEPTH_MARKER = "[Max cause depth exceeded]";

/** A linear chain of `length` native errors, the deepest one built first. */
function chainOf(length: number): Error {
  let chain = new Error("bottom");
  for (let level = 1; level < length; level++) {
    const next = new Error(`level ${level}`);
    Object.defineProperty(next, "cause", { value: chain, writable: true });
    chain = next;
  }
  return chain;
}

/** Counts the object nodes on a log object's `cause` spine and returns the terminal. */
function walkLogSpine(start: unknown): { nodes: number; terminal: unknown } {
  let node = start;
  let nodes = 0;
  while (typeof node === "object" && node !== null) {
    nodes++;
    node = (node as Record<string, unknown>).cause;
  }
  return { nodes, terminal: node };
}

/** A chain of `length` plain objects shaped like errors, linked by `cause`. */
function plainChainOf(length: number): Record<string, unknown> {
  let chain: Record<string, unknown> = { name: "Error", message: "bottom" };
  for (let level = 1; level < length; level++) {
    chain = { name: "Error", message: `level ${level}`, cause: chain };
  }
  return chain;
}

function causeLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trimStart().startsWith("Caused by: "));
}

describe("toString() bounds the linear cause chain like toLogObject()", () => {
  it("renders at most 100 cause nodes of a long chain and then the depth marker", () => {
    const error = new BaseError("root", chainOf(20_000));

    const lines = error.toString().split("\n");
    const rendered = causeLines(lines).filter(
      (line) => !line.includes(DEPTH_MARKER),
    );
    const spine = walkLogSpine(error.toLogObject().cause);

    expect(lines).toHaveLength(102);
    expect(lines[lines.length - 1]).toBe(`Caused by: ${DEPTH_MARKER}`);
    expect(rendered).toHaveLength(spine.nodes);
    expect(spine.nodes).toBe(100);
    expect(spine.terminal).toBe(DEPTH_MARKER);
  });

  it("fits exactly 100 causes on both surfaces without a marker", () => {
    const error = new BaseError("root", chainOf(100));

    const lines = error.toString().split("\n");
    const spine = walkLogSpine(error.toLogObject().cause);

    expect(lines).toHaveLength(101);
    expect(error.toString()).not.toContain(DEPTH_MARKER);
    expect(spine.nodes).toBe(100);
    expect(spine.terminal).toBeUndefined();
  });

  it("marks the 101st cause on both surfaces", () => {
    const error = new BaseError("root", chainOf(101));

    const lines = error.toString().split("\n");
    const spine = walkLogSpine(error.toLogObject().cause);

    expect(lines).toHaveLength(102);
    expect(lines[lines.length - 1]).toBe(`Caused by: ${DEPTH_MARKER}`);
    expect(spine.nodes).toBe(100);
    expect(spine.terminal).toBe(DEPTH_MARKER);
  });

  it("places the marker of a member's chain where the log object places it", () => {
    const aggregate = new AggregateError([chainOf(300)], "fan-out");
    const error = new BaseError("root", aggregate);

    const lines = error.toString().split("\n");
    const memberLines = lines.filter((line) => line.startsWith("    "));
    const memberCauses = causeLines(memberLines).filter(
      (line) => !line.includes(DEPTH_MARKER),
    );
    const log = error.toLogObject();
    const members = (log.cause as Record<string, unknown>).errors as unknown[];
    const spine = walkLogSpine(members[0]);

    expect(memberLines[memberLines.length - 1]).toBe(
      `    Caused by: ${DEPTH_MARKER}`,
    );
    // The member itself is one node of the spine; its causes are the rest.
    expect(memberCauses).toHaveLength(spine.nodes - 1);
    expect(spine.terminal).toBe(DEPTH_MARKER);
  });

  it("renders a cycle shorter than the cap as the circular marker, never the depth marker", () => {
    const a = new Error("a");
    const b = new Error("b");
    Object.defineProperty(a, "cause", { value: b, writable: true });
    Object.defineProperty(b, "cause", { value: a, writable: true });

    const rendered = new BaseError("root", a).toString();

    expect(rendered).toContain("[Circular cause chain]");
    expect(rendered).not.toContain(DEPTH_MARKER);
  });

  it("touches only the first hops of a chain that is a million long", () => {
    let reads = 0;
    const lazyChain = (remaining: number): Record<string, unknown> => ({
      name: "Error",
      message: `level ${remaining}`,
      get cause(): unknown {
        reads++;
        return remaining > 0 ? lazyChain(remaining - 1) : undefined;
      },
    });
    const error = new BaseError("root", lazyChain(1_000_000));

    const rendered = error.toString();

    expect(rendered).toContain(DEPTH_MARKER);
    expect(reads).toBeLessThanOrEqual(101);
  });

  it("caps a plain-object log chain with an empty container while rendering its depth marker", () => {
    const error = new BaseError("root", plainChainOf(300));

    const lines = error.toString().split("\n");
    const log = error.toLogObject();
    const spine = walkLogSpine(log.cause);

    expect(lines).toHaveLength(102);
    expect(lines[lines.length - 1]).toBe(`Caused by: ${DEPTH_MARKER}`);
    expect(spine.nodes).toBe(101);
    expect(spine.terminal).toBeUndefined();
    let terminal = log.cause;
    for (let index = 0; index < 100; index++) {
      terminal = (terminal as Record<string, unknown>).cause;
    }
    expect(terminal).toEqual({});
    expect(JSON.stringify(log)).not.toContain(DEPTH_MARKER);
  });

  it("renders an error-shaped plain object by its name and message", () => {
    const error = new BaseError("root", plainChainOf(2));

    expect(error.toString()).toBe(
      "[BaseError] root\nCaused by: Error: level 1\nCaused by: Error: bottom",
    );
  });

  it("renders a short chain unchanged", () => {
    const error = new BaseError("root", chainOf(2));

    expect(error.toString()).toBe(
      "[BaseError] root\nCaused by: Error: level 1\nCaused by: Error: bottom",
    );
  });
});

/**
 * An error-shaped node whose members are built on each read, 100, 100 and 11
 * wide per level: 120,101 nodes, more than one log build may visit.
 */
function growingTree(level = 0): object {
  const widths = [100, 100, 11];
  return {
    name: "Node",
    message: `level ${level}`,
    get errors(): unknown[] {
      const width = widths[level] ?? 0;
      return Array.from({ length: width }, () => growingTree(level + 1));
    },
  };
}

/** Like `growingTree`, but each node on the last level holds 10 holes: 100,000 in total. */
function holeyTree(level = 0): object {
  return {
    name: "Node",
    message: `level ${level}`,
    get errors(): unknown[] {
      return level < 2
        ? Array.from({ length: 100 }, () => holeyTree(level + 1))
        : new Array<unknown>(10);
    },
  };
}

/** A `cause` spine of `length` error-shaped plain objects that ends in `tail`. */
function spineEndingIn(length: number, tail: object): object {
  let chain = tail;
  for (let hop = 1; hop < length; hop++) {
    chain = { name: "Error", message: `hop ${hop}`, cause: chain };
  }
  return chain;
}

function sizeMarkerLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.endsWith(MAX_LOG_SIZE_MARKER));
}

describe("toString() node budget", () => {
  it("stops a tree that outgrows the log node budget with the size marker", () => {
    const error = new BaseError("root", growingTree());

    const lines = error.toString().split("\n");

    expect(lines.length).toBeLessThan(MAX_LOG_NODES + 10);
    expect(lines.some((line) => line.endsWith(MAX_LOG_SIZE_MARKER))).toBe(true);
    expect(JSON.stringify(error.toLogObject())).toContain(MAX_LOG_SIZE_MARKER);
  });

  it("writes the size marker once, as the last line", () => {
    const tree = Object.assign(growingTree(), {
      cause: new Error("after the members"),
    });

    const lines = new BaseError("root", tree).toString().split("\n");

    expect(sizeMarkerLines(lines)).toHaveLength(1);
    expect(lines[lines.length - 1]).toMatch(/- \[Max log size exceeded\]$/);
  });

  it("charges a depth marker, so members at the depth cap cannot outgrow the budget", () => {
    const error = new BaseError("root", spineEndingIn(98, growingTree()));

    const lines = error.toString().split("\n");

    expect(lines.length).toBeLessThanOrEqual(MAX_LOG_NODES + 1);
    expect(sizeMarkerLines(lines)).toHaveLength(1);
  });

  it("charges a hole, so holes cannot outgrow the budget", () => {
    const lines = new BaseError("root", holeyTree()).toString().split("\n");

    expect(lines.length).toBeLessThanOrEqual(MAX_LOG_NODES + 1);
    expect(sizeMarkerLines(lines)).toHaveLength(1);
  });

  it("writes no count of further members after the budget ran out", () => {
    const members = [
      growingTree(),
      ...Array.from(
        { length: 149 },
        (_, index) => new Error(`member ${index}`),
      ),
    ];

    const lines = new BaseError("root", new AggregateError(members, "wide"))
      .toString()
      .split("\n");

    expect(lines.some((line) => line.includes("more aggregated errors"))).toBe(
      false,
    );
  });
});
