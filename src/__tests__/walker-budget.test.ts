import { describe, expect, it } from "vitest";

import {
  BaseError,
  StructuredError,
  defineErrors,
  getRootCause,
} from "../index.js";
import { MAX_CAUSE_DEPTH } from "../errors/walker-bounds.js";
import { cloneJsonSafe } from "../errors/json-safe.js";
import { PublicErrorCatalog } from "../public-error/PublicErrorCatalog.js";
import { project } from "../public-error/project.js";
import { toProblem } from "../public-error/toProblem.js";

/**
 * A small object graph with shared (non-circular) references that expands
 * exponentially when cloned per reference: `levels` doublings ≈ 2^(levels+1)
 * node visits. 18 levels ≈ 500k visits — far past any sane payload, cheap to
 * build, and guaranteed to cross a 100k-node budget.
 */
const makeDag = (levels: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { leaf: "x" };
  for (let i = 0; i < levels; i++) {
    node = { a: node, b: node };
  }
  return node;
};

describe("walker node budgets (shared-reference blowup)", () => {
  it("cloneJsonSafe rejects a DAG that would expand past the node budget", () => {
    expect(() => cloneJsonSafe(makeDag(18))).toThrow(/not JSON-safe/);
  });

  it("cloneJsonSafe still clones ordinary large-but-sane values", () => {
    const wide = { items: Array.from({ length: 10_000 }, (_, i) => i) };
    expect(() => cloneJsonSafe(wide)).not.toThrow();
  });

  it("toProblem omits DAG details instead of expanding them onto the wire", () => {
    const catalog = new PublicErrorCatalog({
      fallback: { publicCode: "internal_error", status: 500 },
    }).registerByCode("dag", {
      publicCode: "dag_pub",
      status: 400,
      projectDetails: (error: unknown): unknown =>
        (error as { details?: unknown }).details,
    });
    const view = project(catalog, { code: "dag", details: makeDag(18) });

    const result = toProblem(catalog, view);
    expect("details" in result.body).toBe(false);
    expect(result.outcome.omitted).toContain("details");
  });

  it("defineErrors rejects DAG metadata instead of snapshotting it", () => {
    // The DAG is structurally JSON-safe per node (plain objects/strings); only
    // its shared references make it explode. Cast just the value: the type
    // system cannot see reference sharing.
    const dag = makeDag(18) as never;
    expect(() =>
      defineErrors({
        X: { category: "C", retryable: false, metadata: { dag } },
      }),
    ).toThrow(/metadata must be JSON-safe/);
  });

  it("log redaction degrades a DAG details subtree to a size marker instead of expanding it", () => {
    const err = new StructuredError({
      code: "DAG",
      category: "C",
      retryable: false,
      message: "dag details",
      details: { nested: makeDag(18), ssn: "secret" },
    }).redact(["ssn"]);

    const log = err.toLogObject();

    // Not fail-closed: the envelope and the shallow masking still stand.
    expect(log.code).toBe("DAG");
    expect((log.details as Record<string, unknown>).ssn).toBe("[REDACTED]");
    // The blowup is cut off by a marker rather than walked to completion.
    expect(JSON.stringify(log)).toContain("[Max redaction size exceeded]");
  });
});

/** `levels` containers nested one inside the other, built without recursion. */
const nestArrays = (levels: number): unknown => {
  let node: unknown = 1;
  for (let i = 0; i < levels; i++) node = [node];
  return node;
};

const nestObjects = (levels: number): unknown => {
  let node: unknown = 1;
  for (let i = 0; i < levels; i++) node = { deeper: node };
  return node;
};

describe("walker depth cap (deep nesting)", () => {
  it("names the depth as the reason when it rejects a nested value", () => {
    const deep = nestObjects(101) as never;
    expect(() =>
      defineErrors({
        X: { category: "C", retryable: false, metadata: { deep } },
      }),
    ).toThrow(
      "defineErrors: metadata must be JSON-safe (nested deeper than 100 levels)",
    );
  });

  it("cloneJsonSafe rejects a 2000-deep array with the JSON-safe error, not a RangeError", () => {
    expect(() => cloneJsonSafe(nestArrays(2000))).toThrow(/not JSON-safe/);
  });

  it("cloneJsonSafe rejects a 100000-deep object without touching the host stack", () => {
    expect(() => cloneJsonSafe(nestObjects(100_000))).toThrow(/not JSON-safe/);
  });

  it("cloneJsonSafe clones 100 nested levels in full and freezes every level", () => {
    const clone = cloneJsonSafe(nestArrays(100));

    let node: unknown = clone;
    let levels = 0;
    while (Array.isArray(node)) {
      expect(Object.isFrozen(node)).toBe(true);
      node = node[0];
      levels++;
    }
    expect(levels).toBe(100);
    expect(node).toBe(1);
  });

  it("cloneJsonSafe rejects the 101st nested level", () => {
    expect(() => cloneJsonSafe(nestArrays(101))).toThrow(/not JSON-safe/);
  });

  it("defineErrors rejects 2000-deep array metadata with its own JSON-safe message", () => {
    const deep = nestArrays(2000) as never;
    expect(() =>
      defineErrors({
        X: { category: "C", retryable: false, metadata: { deep } },
      }),
    ).toThrow(/metadata must be JSON-safe/);
  });

  it("defineErrors rejects 2000-deep object metadata with its own JSON-safe message", () => {
    const deep = nestObjects(2000) as never;
    expect(() =>
      defineErrors({
        X: { category: "C", retryable: false, metadata: { deep } },
      }),
    ).toThrow(/metadata must be JSON-safe/);
  });

  it("toProblem omits 2000-deep details instead of failing the response", () => {
    const catalog = new PublicErrorCatalog({
      fallback: { publicCode: "internal_error", status: 500 },
    }).registerByCode("deep", {
      publicCode: "deep_pub",
      status: 400,
      projectDetails: (error: unknown): unknown =>
        (error as { details?: unknown }).details,
    });
    const view = project(catalog, {
      code: "deep",
      details: { deep: nestObjects(2000) },
    });

    const result = toProblem(catalog, view);
    expect("details" in result.body).toBe(false);
    expect(result.outcome.omitted).toContain("details");
  });
});

describe("walker bounds agree across surfaces", () => {
  /** A linear chain of `length` errors; index 0 is the outermost. */
  const chainOf = (length: number): Error[] => {
    const chain: Error[] = [];
    let cause: Error | undefined;
    for (let index = length - 1; index >= 0; index--) {
      const error = new Error(`hop-${index}`);
      if (cause !== undefined) {
        Object.defineProperty(error, "cause", { value: cause });
      }
      chain.unshift(error);
      cause = error;
    }
    return chain;
  };

  it("getRootCause by default stops at the hop where the log object cuts the chain", () => {
    const chain = chainOf(MAX_CAUSE_DEPTH + 50);
    const root = new BaseError("root", chain[0]);

    const deepestTraversed = getRootCause(root);
    let deepestLogged: Record<string, unknown> | undefined;
    let node = root.toLogObject().cause as Record<string, unknown> | string;
    let logged = 0;
    while (typeof node === "object") {
      deepestLogged = node;
      logged++;
      node = node.cause as Record<string, unknown> | string;
    }

    expect(logged).toBe(MAX_CAUSE_DEPTH);
    expect(deepestTraversed).toBe(chain[MAX_CAUSE_DEPTH - 1]);
    expect(deepestLogged?.message).toBe(`hop-${MAX_CAUSE_DEPTH - 1}`);
  });
});
