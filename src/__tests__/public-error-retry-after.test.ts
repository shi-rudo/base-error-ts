import { describe, expect, it } from "vitest";

import {
  definePublicErrors,
  project,
  toProblem,
} from "../public-error/index.js";
import type { PublicError } from "../public-error/types.js";

const rateLimited = (): ReturnType<typeof build> => build();
function build() {
  return definePublicErrors({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  }).registerByCode("rate.limited", {
    publicCode: "rate_limited",
    status: 429,
    category: "rate_limit",
    retryable: true,
    projectRetryAfter: (error: unknown): number | undefined =>
      (error as { retryAfterSeconds?: number }).retryAfterSeconds,
  });
}

describe("project: retryAfter rides on the view as a neutral hint", () => {
  it("projects retryAfter from the error", () => {
    const view = project(rateLimited(), {
      code: "rate.limited",
      retryAfterSeconds: 30,
    });
    expect(view.retryAfter).toBe(30);
    expect(view.retryable).toBe(true);
  });

  it("guards a non-integer/negative/throwing projector to no hint, no throw", () => {
    const catalog = rateLimited();
    expect(
      project(catalog, { code: "rate.limited", retryAfterSeconds: -5 }),
    ).not.toHaveProperty("retryAfter");
    expect(
      project(catalog, { code: "rate.limited", retryAfterSeconds: 1.5 }),
    ).not.toHaveProperty("retryAfter");
    expect(project(catalog, { code: "rate.limited" })).not.toHaveProperty(
      "retryAfter",
    );

    const throwing = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("rate.limited", {
      publicCode: "rate_limited",
      status: 429,
      projectRetryAfter: (): number => {
        throw new Error("clock unavailable");
      },
    });
    expect(() => project(throwing, { code: "rate.limited" })).not.toThrow();
    expect(project(throwing, { code: "rate.limited" })).not.toHaveProperty(
      "retryAfter",
    );
  });
});

describe("toProblem: materializes retryAfter into header and body", () => {
  it("emits the Retry-After header and a retryAfter body member", () => {
    const catalog = rateLimited();
    const view = project(catalog, {
      code: "rate.limited",
      retryAfterSeconds: 30,
    });

    const result = toProblem(catalog, view);
    expect(result.headers["retry-after"]).toBe("30");
    expect(result.body.retryAfter).toBe(30);
    expect(result.status).toBe(429);
  });

  it("lets the boundary override via context (rate-limiter knows best)", () => {
    const catalog = rateLimited();
    const view = project(catalog, {
      code: "rate.limited",
      retryAfterSeconds: 30,
    });

    const result = toProblem(catalog, view, { retryAfter: 5 });
    expect(result.headers["retry-after"]).toBe("5");
    expect(result.body.retryAfter).toBe(5);
  });

  it("omits both when there is no retryAfter", () => {
    const catalog = rateLimited();
    const view = project(catalog, { code: "rate.limited" });
    const result = toProblem(catalog, view);
    expect("retry-after" in result.headers).toBe(false);
    expect("retryAfter" in result.body).toBe(false);
  });

  it("works catalog-free via an explicit transport plus context", () => {
    const view: PublicError = { code: "rate_limited", retryable: true };
    const result = toProblem({ status: 429 }, view, { retryAfter: 12 });
    expect(result.headers["retry-after"]).toBe("12");
    expect(result.body.retryAfter).toBe(12);
  });

  it("ignores an invalid context retryAfter", () => {
    const view: PublicError = { code: "rate_limited" };
    const result = toProblem({ status: 429 }, view, { retryAfter: -1 });
    expect("retry-after" in result.headers).toBe(false);
  });
});
