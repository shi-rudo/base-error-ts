import { describe, expect, it } from "vitest";

import { BaseError } from "../index.js";

const DATA_DEPTH_MARKER = "[Max data depth exceeded]";
const CAUSE_DEPTH_MARKER = "[Max cause depth exceeded]";

type Log = Record<string, unknown>;

/** Objects nested `depth` deep under the key `child`, with `leaf` at the bottom. */
function nestedObjects(depth: number, leaf: unknown = { leaf: "x" }): unknown {
  let node = leaf;
  for (let index = 0; index < depth; index++) node = { child: node };
  return node;
}

/** Arrays nested `depth` deep: `[[[...]]]`. */
function nestedArrays(depth: number): unknown[] {
  let node: unknown[] = [];
  for (let index = 0; index < depth; index++) node = [node];
  return node;
}

/** A chain of `length` plain objects shaped like errors, linked by `cause`. */
function plainChainOf(length: number): Log {
  let chain: Log = { name: "Error", message: "bottom" };
  for (let level = 1; level < length; level++) {
    chain = { name: "Error", message: `level ${level}`, cause: chain };
  }
  return chain;
}

/** A linear chain of `length` native errors, the deepest one built first. */
function errorChainOf(length: number): Error {
  let chain = new Error("bottom");
  for (let level = 1; level < length; level++) {
    const next = new Error(`level ${level}`);
    Object.defineProperty(next, "cause", { value: chain, writable: true });
    chain = next;
  }
  return chain;
}

/** A native error whose `code` holds `code`, as the cause of a `BaseError`. */
function errorWithCauseCode(code: unknown): BaseError<string> {
  const cause = new Error("db") as Error & { code?: unknown };
  cause.code = code;
  return new BaseError("outer", cause);
}

/** Follows `link` from `start` `hops` times. */
function follow(start: unknown, link: string | number, hops: number): unknown {
  let node = start;
  for (let hop = 0; hop < hops; hop++) {
    node = (node as Record<string | number, unknown>)[link];
  }
  return node;
}

describe("a depth cut in log data writes a marker", () => {
  it("ends an object nested past the data depth with the data depth marker", () => {
    const log = errorWithCauseCode(nestedObjects(150)).toLogObject();

    const code = (log.cause as Log).code;

    expect(follow(code, "child", 99)).toEqual({ child: DATA_DEPTH_MARKER });
  });

  it("ends an array nested past the data depth with the data depth marker", () => {
    const log = errorWithCauseCode(nestedArrays(150)).toLogObject();

    const code = (log.cause as Log).code;

    expect(follow(code, 0, 99)).toEqual([DATA_DEPTH_MARKER]);
  });

  it("ends an error at the data depth with the data depth marker", () => {
    const log = errorWithCauseCode(
      nestedObjects(100, new BaseError("deep")),
    ).toLogObject();

    const code = (log.cause as Log).code;

    expect(follow(code, "child", 99)).toEqual({ child: DATA_DEPTH_MARKER });
  });

  it("masks the data depth marker under an allow-list, as it masks any data value", () => {
    const log = errorWithCauseCode(nestedObjects(150))
      .redactAllow([])
      .toLogObject();

    const code = (log.cause as Log).code;

    expect(follow(code, "child", 99)).toEqual({ child: "[REDACTED]" });
  });
});

describe("a cut of the cause spine writes the cause depth marker", () => {
  it("ends a plain-object cause chain at the hop and with the marker of an error chain", () => {
    const plain = new BaseError("root", plainChainOf(300)).toLogObject();
    const errors = new BaseError("root", errorChainOf(300)).toLogObject();

    expect(follow(errors.cause, "cause", 100)).toBe(CAUSE_DEPTH_MARKER);
    expect(follow(plain.cause, "cause", 99)).toMatchObject({
      message: "level 200",
      cause: CAUSE_DEPTH_MARKER,
    });
  });

  it("keeps the cause depth marker of a plain-object chain readable under an allow-list", () => {
    const log = new BaseError("root", plainChainOf(300))
      .redactAllow([])
      .toLogObject();

    expect(follow(log.cause, "cause", 100)).toBe(CAUSE_DEPTH_MARKER);
  });
});
