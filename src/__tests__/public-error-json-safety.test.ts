import { describe, expect, it } from "vitest";

import { PublicErrorCatalog } from "../public-error/PublicErrorCatalog.js";
import { project } from "../public-error/project.js";
import { toProblem } from "../public-error/toProblem.js";
import type { FieldFault } from "../public-error/types.js";

/**
 * The wire boundary. `project` produces an in-process view that may legitimately
 * hold rich values (a `Date` in `details`); `toProblem` is where the body must
 * become JSON-safe, frozen, and prototype-clean, because it crosses an HTTP body
 * and then a second serializer (TanStack/Seroval) before the UI.
 */
function catalog(): PublicErrorCatalog {
  return new PublicErrorCatalog({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  }).registerByCode("ext.detail", {
    publicCode: "unprocessable",
    status: 422,
    projectDetails: (error: unknown): unknown =>
      (error as { details?: unknown }).details,
    projectFields: (error: unknown): readonly FieldFault[] =>
      (error as { fields?: readonly FieldFault[] }).fields ?? [],
  });
}

describe("toProblem: JSON-safe details", () => {
  it("clones JSON-safe details: deep-frozen and decoupled from the source", () => {
    const source = { orderId: "o-1", nested: { tries: 2 } };
    const view = project(catalog(), { code: "ext.detail", details: source });

    const result = toProblem(catalog(), view);

    expect(result.body.details).toEqual({
      orderId: "o-1",
      nested: { tries: 2 },
    });
    expect(Object.isFrozen(result.body.details)).toBe(true);
    expect(
      Object.isFrozen((result.body.details as { nested: unknown }).nested),
    ).toBe(true);
    expect(result.outcome.omitted).toEqual([]);

    // Mutating the source after mapping must not reach the wire object.
    source.nested.tries = 999;
    expect(
      (result.body.details as { nested: { tries: number } }).nested.tries,
    ).toBe(2);
  });

  it("omits a Date in details and reports the omission instead of leaking it", () => {
    const view = project(catalog(), {
      code: "ext.detail",
      details: { when: new Date(), orderId: "o-2" },
    });

    const result = toProblem(catalog(), view);

    expect("details" in result.body).toBe(false);
    expect(result.outcome.omitted).toEqual(["details"]);
    // The rest of the body stands.
    expect(result.body.code).toBe("unprocessable");
    expect(result.body.status).toBe(422);
  });

  it("omits non-JSON-safe details (circular, BigInt, NaN, function) without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    for (const bad of [
      circular,
      { big: 10n },
      { nan: Number.NaN },
      { fn: (): void => {} },
    ]) {
      const view = project(catalog(), { code: "ext.detail", details: bad });
      const result = toProblem(catalog(), view);
      expect("details" in result.body).toBe(false);
      expect(result.outcome.omitted).toContain("details");
    }
  });

  it("does not pollute the body prototype via a __proto__ data key", () => {
    const details = JSON.parse(
      '{"__proto__":{"polluted":true},"orderId":"o-3"}',
    ) as Record<string, unknown>;
    const view = project(catalog(), { code: "ext.detail", details });

    const body = toProblem(catalog(), view).body;

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const cloned = body.details as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(cloned, "__proto__")).toBe(
      true,
    );
    expect(Object.getPrototypeOf(cloned)).toBeNull();
  });
});

describe("toProblem: JSON-safe fields", () => {
  it("clones JSON-safe field faults and freezes them", () => {
    const view = project(catalog(), {
      code: "ext.detail",
      fields: [{ field: "email", code: "required" }],
    });

    const result = toProblem(catalog(), view);
    expect(result.body.fields).toEqual([{ field: "email", code: "required" }]);
    expect(Object.isFrozen(result.body.fields)).toBe(true);
    expect(result.outcome.omitted).toEqual([]);
  });

  it("omits fields when an entry is not JSON-safe", () => {
    const view = project(catalog(), {
      code: "ext.detail",
      fields: [{ field: "email", code: "required", at: new Date() }] as never,
    });

    const result = toProblem(catalog(), view);
    expect("fields" in result.body).toBe(false);
    expect(result.outcome.omitted).toContain("fields");
  });
});

describe("toProblem: frozen result", () => {
  it("freezes the result, headers, body, and outcome", () => {
    const view = project(catalog(), {
      code: "ext.detail",
      details: { orderId: "o-4" },
    });
    const result = toProblem(catalog(), view, { instance: "/x" });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.headers)).toBe(true);
    expect(Object.isFrozen(result.body)).toBe(true);
    expect(Object.isFrozen(result.outcome)).toBe(true);
    expect(Object.isFrozen(result.outcome.omitted)).toBe(true);
  });
});
