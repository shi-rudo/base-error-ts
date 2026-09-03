import { describe, expect, it } from "vitest";

import { BaseError } from "../index.js";

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

    const started = performance.now();
    const rendered = error.toString();
    const elapsed = performance.now() - started;

    expect(rendered).toContain(DEPTH_MARKER);
    expect(reads).toBeLessThanOrEqual(101);
    expect(elapsed).toBeLessThan(200);
  });

  it("follows the cause links of a plain-object chain that the log object copies whole", () => {
    const error = new BaseError("root", plainChainOf(300));

    const lines = error.toString().split("\n");
    const spine = walkLogSpine(error.toLogObject().cause);

    expect(lines).toHaveLength(102);
    expect(lines[lines.length - 1]).toBe(`Caused by: ${DEPTH_MARKER}`);
    expect(spine.nodes).toBe(300);
    expect(spine.terminal).toBeUndefined();
    expect(JSON.stringify(error.toLogObject())).not.toContain(DEPTH_MARKER);
  });

  it("renders a short chain unchanged", () => {
    const error = new BaseError("root", chainOf(2));

    expect(error.toString()).toBe(
      "[BaseError] root\nCaused by: Error: level 1\nCaused by: Error: bottom",
    );
  });
});
