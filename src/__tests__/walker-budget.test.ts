import { describe, expect, it } from "vitest";

import { StructuredError, defineErrors } from "../index.js";
import { cloneJsonSafe } from "../utils/json-safe.js";
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
