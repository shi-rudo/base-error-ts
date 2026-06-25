import { describe, expect, it } from "vitest";

import {
  definePublicErrors,
  project,
  toProblem,
} from "../public-error/index.js";
import type { ToProblemContext } from "../public-error/index.js";

const catalog = (): ReturnType<typeof mk> => mk();
function mk() {
  return definePublicErrors({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  }).registerByCode("x", { publicCode: "x_pub", status: 400 });
}

describe("toProblem: typed extensions", () => {
  it("merges JSON-safe extensions into the body", () => {
    const view = project(catalog(), { code: "x" });
    const result = toProblem(catalog(), view, {
      extensions: { traceId: "t-1", attempt: 2, nested: { ok: true } },
    });

    expect(result.body.traceId).toBe("t-1");
    expect(result.body.attempt).toBe(2);
    expect(result.body.nested).toEqual({ ok: true });
    expect(result.outcome.omitted).toEqual([]);
    // The cloned extension is frozen, like the rest of the body.
    expect(Object.isFrozen(result.body.nested)).toBe(true);
  });

  it("never lets an extension override a reserved member", () => {
    const view = project(catalog(), { code: "x" });
    // Reserved keys are forbidden at compile time; cast for the runtime check.
    const result = toProblem(catalog(), view, {
      extensions: { code: "HACKED", status: 200 },
    } as unknown as ToProblemContext);

    expect(result.body.code).toBe("x_pub");
    expect(result.body.status).toBe(400);
    expect(result.outcome.omitted).toContain("extensions");
  });

  it("omits the whole extension set when a value is not JSON-safe", () => {
    const view = project(catalog(), { code: "x" });
    const result = toProblem(catalog(), view, {
      extensions: { when: new Date(), keep: "x" },
    } as unknown as ToProblemContext);

    expect("when" in result.body).toBe(false);
    expect("keep" in result.body).toBe(false);
    expect(result.outcome.omitted).toContain("extensions");
  });

  it("works on the catalog-free transport path too", () => {
    const result = toProblem(
      { status: 429 },
      { code: "rate_limited" },
      { extensions: { retryToken: "abc" } },
    );
    expect(result.body.retryToken).toBe("abc");
  });
});
