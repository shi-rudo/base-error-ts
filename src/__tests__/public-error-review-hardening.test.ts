import { describe, expect, it } from "vitest";

import {
  definePublicErrors,
  project,
  toProblem,
} from "../public-error/index.js";
import type {
  LocalizedPublicError,
  ProjectionOutcome,
  PublicError,
} from "../public-error/types.js";

// ── A1: invalid context.retryAfter must fall back to the view's valid hint ──
describe("A1: retryAfter override falls back instead of dropping a valid hint", () => {
  const rateLimited = (): ReturnType<typeof buildRl> => buildRl();
  function buildRl() {
    return definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("rl", {
      publicCode: "rate_limited",
      status: 429,
      projectRetryAfter: (error: unknown): number | undefined =>
        (error as { ra?: number }).ra,
    });
  }

  it("keeps the valid view retryAfter when the context override is invalid", () => {
    const view = project(rateLimited(), { code: "rl", ra: 30 });
    const result = toProblem(rateLimited(), view, { retryAfter: -1 });
    expect(result.body.retryAfter).toBe(30);
    expect(result.headers["retry-after"]).toBe("30");
  });

  it("uses a valid context override over the view", () => {
    const view = project(rateLimited(), { code: "rl", ra: 30 });
    expect(
      toProblem(rateLimited(), view, { retryAfter: 5 }).body.retryAfter,
    ).toBe(5);
  });

  it("emits nothing when neither value is valid", () => {
    const view = project(rateLimited(), { code: "rl" });
    const result = toProblem(rateLimited(), view, { retryAfter: -1 });
    expect("retry-after" in result.headers).toBe(false);
  });
});

// ── A3: the catalog-free transport path validates status/type ──
describe("A3: an explicit transport is validated like a registration", () => {
  const view: PublicError = { code: "x" };

  it("rejects an out-of-range or non-integer status", () => {
    expect(() => toProblem({ status: 999 }, view)).toThrow(/status/);
    expect(() => toProblem({ status: 200.5 }, view)).toThrow(/status/);
  });

  it("rejects an empty type", () => {
    expect(() => toProblem({ status: 418, type: "" }, view)).toThrow(/type/);
  });

  it("accepts a valid explicit transport", () => {
    expect(() =>
      toProblem({ status: 418, type: "https://x/teapot" }, view),
    ).not.toThrow();
  });
});

// ── A5: hasMessage requires a locale, never emits content-language: undefined ──
describe("A5: a message-only view is not treated as localized", () => {
  it("falls back to the static title and omits content-language", () => {
    const view = { code: "x", message: "hi" } as LocalizedPublicError;
    const result = toProblem({ status: 400, title: "Static summary." }, view);
    expect("content-language" in result.headers).toBe(false);
    expect(result.body.title).toBe("Static summary.");
  });

  it("a full localized view still sets title and content-language", () => {
    const view: LocalizedPublicError = {
      code: "x",
      message: "hi",
      locale: "en",
    };
    const result = toProblem({ status: 400 }, view);
    expect(result.body.title).toBe("hi");
    expect(result.headers["content-language"]).toBe("en");
  });
});

// ── A7: toProblem omits an empty fields array, matching project ──
describe("A7: an empty fields array is omitted from the body", () => {
  it("does not emit fields: []", () => {
    const view: PublicError = { code: "x", fields: [] };
    expect("fields" in toProblem({ status: 400 }, view).body).toBe(false);
  });

  it("emits non-empty fields", () => {
    const view: PublicError = {
      code: "x",
      fields: [{ field: "a", code: "b" }],
    };
    expect(toProblem({ status: 400 }, view).body.fields).toEqual([
      { field: "a", code: "b" },
    ]);
  });
});

// ── A4: safeFields validates element shape and reports failure ──
describe("A4: a malformed projectFields drops fields and reports failed", () => {
  const seen: ProjectionOutcome[] = [];
  const build = (fn: (error: unknown) => unknown): ReturnType<typeof make> =>
    make(fn);
  function make(fn: (error: unknown) => unknown) {
    seen.length = 0;
    return definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, _view, outcome) => seen.push(outcome),
    }).registerByCode("v", {
      publicCode: "v_pub",
      status: 400,
      projectFields: fn as () => never,
    });
  }

  it("a non-array result drops fields and reports failed", () => {
    const view = project(
      build(() => ({ not: "an array" })),
      { code: "v" },
    );
    expect("fields" in view).toBe(false);
    expect(seen[0]).toMatchObject({ projection: "failed" });
  });

  it("a malformed entry drops fields and reports failed", () => {
    const view = project(
      build(() => [{ field: "email", code: "required" }, { field: "x" }]),
      { code: "v" },
    );
    expect("fields" in view).toBe(false);
    expect(seen[0]).toMatchObject({ projection: "failed" });
  });

  it("valid field faults are kept and reported succeeded", () => {
    const view = project(
      build(() => [{ field: "email", code: "required" }]),
      {
        code: "v",
      },
    );
    expect(view.fields).toEqual([{ field: "email", code: "required" }]);
    expect(seen[0]).toMatchObject({ projection: "succeeded" });
  });
});

// ── A6: the projected view is frozen ──
describe("A6: the projected view is immutable", () => {
  it("freezes the returned view", () => {
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    });
    expect(Object.isFrozen(project(catalog, new Error("x")))).toBe(true);
  });

  it("an onProject observer cannot mutate the returned view", () => {
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, view) => {
        (view as Record<string, unknown>).injected = true;
      },
    });
    expect("injected" in project(catalog, new Error("x"))).toBe(false);
  });
});

// ── A2 + A8: title and category join the wire-identity conflict ──
describe("A2/A8: title and category are part of the one-public-code identity", () => {
  const base = (): ReturnType<typeof mk> => mk();
  function mk() {
    return definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    });
  }

  it("rejects two internal codes with the same publicCode but different title", () => {
    expect(() =>
      base()
        .registerByCode("a", { publicCode: "p", status: 400, title: "A" })
        .registerByCode("b", { publicCode: "p", status: 400, title: "B" }),
    ).toThrow(/conflicting transport/);
  });

  it("rejects two internal codes with the same publicCode but different category", () => {
    expect(() =>
      base()
        .registerByCode("a", { publicCode: "p", status: 400, category: "x" })
        .registerByCode("b", { publicCode: "p", status: 400, category: "y" }),
    ).toThrow(/conflicting transport/);
  });

  it("allows identical title and category across internal codes", () => {
    expect(() =>
      base()
        .registerByCode("a", {
          publicCode: "p",
          status: 400,
          title: "T",
          category: "x",
        })
        .registerByCode("b", {
          publicCode: "p",
          status: 400,
          title: "T",
          category: "x",
        }),
    ).not.toThrow();
  });
});
