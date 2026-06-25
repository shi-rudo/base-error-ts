import { describe, expect, it } from "vitest";

import {
  definePublicErrors,
  localize,
  project,
  toProblem,
} from "../public-error/index.js";
import type {
  LocalizedMessageSet,
  ToProblemContext,
  Transport,
} from "../public-error/index.js";

function baseCatalog() {
  return definePublicErrors({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  });
}

describe("public-error review3 hardening", () => {
  // Finding 0: localize() must not crash cryptically when the message set is
  // absent (a code with no userMessages -> messagesFor() returns undefined).
  it("localize throws a clear error when the message set is missing", () => {
    const catalog = baseCatalog().registerByCode("x", {
      publicCode: "x_pub",
      status: 400,
    });
    const view = project(catalog, { code: "x" });
    const set = catalog.messagesFor(view.code);

    expect(set).toBeUndefined();
    expect(() =>
      localize(view, set as unknown as LocalizedMessageSet, {
        locales: ["en"],
      }),
    ).toThrow(/LocalizedMessageSet is required/);
  });

  // Finding 1: a non-string title (cast / JSON-revived) must not reach the body,
  // on either the catalog-free or the catalog path.
  it("drops a non-string transport title (catalog-free path)", () => {
    const result = toProblem(
      { status: 418, title: 42 } as unknown as Transport,
      {
        code: "teapot",
      },
    );
    expect("title" in result.body).toBe(false);
  });

  it("drops a non-string descriptor title (catalog path)", () => {
    const catalog = baseCatalog().registerByCode("x", {
      publicCode: "x_pub",
      status: 400,
      title: 99 as unknown as string,
    });
    const view = project(catalog, { code: "x" });
    const result = toProblem(catalog, view);
    expect("title" in result.body).toBe(false);
  });

  it("keeps a valid string title", () => {
    const catalog = baseCatalog().registerByCode("x", {
      publicCode: "x_pub",
      status: 400,
      title: "A teapot.",
    });
    const result = toProblem(catalog, project(catalog, { code: "x" }));
    expect(result.body.title).toBe("A teapot.");
  });

  // Finding 5: lost coverage for the duplicate-internal-code guard.
  it("registerByCode throws when the same internal code is registered twice", () => {
    const builder = baseCatalog().registerByCode("dup", {
      publicCode: "a",
      status: 400,
    });
    expect(() =>
      builder.registerByCode("dup", { publicCode: "b", status: 401 }),
    ).toThrow(/already registered/);
  });

  // Finding 7: lockstep guard. Every reserved body member name must be rejected
  // as an extension key, so the reserved set cannot silently drift out of sync.
  it("rejects every reserved body member name as an extension key", () => {
    const catalog = baseCatalog().registerByCode("x", {
      publicCode: "x_pub",
      status: 400,
    });
    const view = project(catalog, { code: "x" });
    const reserved = [
      "type",
      "title",
      "status",
      "detail",
      "instance",
      "code",
      "category",
      "retryable",
      "retryAfter",
      "fields",
      "details",
    ];

    for (const key of reserved) {
      const result = toProblem(catalog, view, {
        extensions: { [key]: "x" },
      } as unknown as ToProblemContext);
      expect(result.outcome.omitted).toContain("extensions");
    }
  });
});
