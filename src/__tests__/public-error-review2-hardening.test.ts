import { describe, expect, it } from "vitest";

import { LocalizedMessageSet } from "../presentation/index.js";
import {
  definePublicErrors,
  localize,
  project,
  toProblem,
} from "../public-error/index.js";
import type { PublicError } from "../public-error/types.js";

// ── R1: a catalog must not silently emit the fallback transport for a code it
//        does not know (that would pair the view's code with the wrong status) ──
describe("R1: toProblem rejects a view code unknown to the catalog", () => {
  const catalog = (): ReturnType<typeof mk> => mk();
  function mk() {
    return definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("x", { publicCode: "known", status: 418 });
  }

  it("throws on a foreign/stale public code rather than diverging code and status", () => {
    const foreign: PublicError = { code: "from_another_catalog" };
    expect(() => toProblem(catalog(), foreign)).toThrow(/not registered/);
  });

  it("still maps a registered fallback view", () => {
    const view = project(catalog(), new Error("boom"));
    expect(view.code).toBe("internal_error");
    expect(toProblem(catalog(), view).status).toBe(500);
  });

  it("still maps a registered matched view", () => {
    const view = project(catalog(), { code: "x" });
    expect(toProblem(catalog(), view).status).toBe(418);
  });

  it("a foreign code is fine on the explicit-transport path", () => {
    const foreign: PublicError = { code: "from_another_catalog" };
    expect(() => toProblem({ status: 200 }, foreign)).not.toThrow();
  });
});

// ── R2: the wire boundary validates the machine members consistently ──
describe("R2: toProblem validates code/category/retryable", () => {
  it("throws on an empty or non-string code", () => {
    expect(() =>
      toProblem({ status: 400 }, { code: "" } as PublicError),
    ).toThrow(/code/);
    expect(() =>
      toProblem({ status: 400 }, { code: 5 } as unknown as PublicError),
    ).toThrow(/code/);
  });

  it("drops a non-boolean retryable", () => {
    const view = { code: "x", retryable: "yes" } as unknown as PublicError;
    expect("retryable" in toProblem({ status: 400 }, view).body).toBe(false);
  });

  it("drops a non-string category", () => {
    const view = { code: "x", category: 123 } as unknown as PublicError;
    expect("category" in toProblem({ status: 400 }, view).body).toBe(false);
  });

  it("keeps valid machine members", () => {
    const view: PublicError = { code: "x", category: "c", retryable: true };
    const body = toProblem({ status: 400 }, view).body;
    expect(body.category).toBe("c");
    expect(body.retryable).toBe(true);
  });
});

// ── R3: localize freezes its result like project does ──
describe("R3: the localized view is immutable", () => {
  it("freezes the result of localize", () => {
    const view: PublicError = { code: "x" };
    const messages = new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "hi" },
    });
    expect(Object.isFrozen(localize(view, messages, { locales: ["en"] }))).toBe(
      true,
    );
  });
});
