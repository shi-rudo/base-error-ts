import { describe, expect, it } from "vitest";

import { StructuredError } from "../errors/StructuredError.js";

/**
 * The cause chain is its own bounded spine (capped by #serializeCause). It must
 * not consume the redaction walker's data-depth budget, or a deep-but-acyclic
 * chain would marker-truncate a shallow `details` subtree on a deep cause,
 * silently dropping diagnostic data even though the data itself is shallow.
 */
describe("redaction: cause-chain depth does not consume the data-depth budget", () => {
  it("preserves a shallow details subtree hanging off a deep (but in-range) cause", () => {
    // A deep, acyclic chain still within #MAX_CAUSE_DEPTH (so #serializeCause
    // keeps it), with a shallow `details` on the innermost cause.
    let err: StructuredError<string, string> = new StructuredError({
      code: "LEAF",
      category: "C",
      retryable: false,
      message: "leaf",
      details: { tag: { secret: "SECRET_VALUE", keep: "KEEP_VALUE" } },
    });
    for (let i = 0; i < 100; i++) {
      err = new StructuredError({
        code: "WRAP",
        category: "C",
        retryable: false,
        message: "wrap",
        cause: err,
      });
    }

    const json = JSON.stringify(err.redact(["secret"]).toLogObject());

    // The deep cause's shallow details survive (not the depth marker).
    expect(json).toContain("KEEP_VALUE");
    // The sensitive sibling is still masked, never leaked.
    expect(json).not.toContain("SECRET_VALUE");
    expect(json).toContain("[REDACTED]");
  });

  it("still caps a genuinely deep data tree (DoS bound intact)", () => {
    let deep: Record<string, unknown> = { bottom: "x" };
    for (let i = 0; i < 5000; i++) deep = { child: deep };
    const err = new StructuredError({
      code: "DEEP",
      category: "C",
      retryable: false,
      message: "deep details",
      details: { nested: deep },
    });

    const json = JSON.stringify(err.redact([]).toLogObject());
    expect(json).toContain("[Max redaction depth exceeded]");
  });
});
