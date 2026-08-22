import { describe, expect, it } from "vitest";
import { hostileProxy } from "./hostile-values.fixture.js";

import {
  PublicErrorCatalog,
  definePublicErrors,
} from "../public-error/PublicErrorCatalog.js";
import { project } from "../public-error/project.js";
import { toProblem } from "../public-error/toProblem.js";
import type { FieldFault, PublicError } from "../public-error/types.js";

type TimeoutLike = { kind: "timeout" };
const isTimeout = (error: unknown): error is TimeoutLike =>
  typeof error === "object" &&
  error !== null &&
  (error as TimeoutLike).kind === "timeout";

const fallbackOnly = (): PublicErrorCatalog =>
  new PublicErrorCatalog({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  });

describe("resolve: a hostile error value", () => {
  it("projects the fallback for a Proxy whose traps throw", () => {
    const view = project(fallbackOnly(), hostileProxy());

    expect(view.code).toBe("internal_error");
  });
});

describe("resolve: predicate matching after code", () => {
  it("matches by predicate when no code matches", () => {
    const catalog = fallbackOnly().register({
      match: isTimeout,
      descriptor: {
        publicCode: "upstream_timeout",
        status: 504,
        retryable: true,
      },
    });

    const resolution = catalog.resolve({ kind: "timeout" });
    expect(resolution).toMatchObject({ found: true, via: "predicate" });

    const view = project(catalog, { kind: "timeout" });
    expect(view.code).toBe("upstream_timeout");
    expect(view.retryable).toBe(true);
  });

  it("skips a throwing matcher, records matcherThrew, and tries the next", () => {
    const catalog = fallbackOnly()
      .register({
        match: (_e: unknown): _e is never => {
          throw new Error("matcher blew up");
        },
        descriptor: { publicCode: "never", status: 500 },
      })
      .register({
        match: isTimeout,
        descriptor: { publicCode: "upstream_timeout", status: 504 },
      });

    const resolution = catalog.resolve({ kind: "timeout" });
    expect(resolution).toMatchObject({
      found: true,
      via: "predicate",
      matcherThrew: true,
    });
  });

  it("falls back when only a throwing matcher is registered", () => {
    const catalog = fallbackOnly().register({
      match: (_e: unknown): _e is never => {
        throw new Error("boom");
      },
      descriptor: { publicCode: "never", status: 500 },
    });

    expect(catalog.resolve({ any: true })).toEqual({
      found: false,
      matcherThrew: true,
    });
    expect(project(catalog, { any: true }).code).toBe("internal_error");
  });

  it("treats a throwing `code` getter as no code (stays total)", () => {
    const hostile = {
      get code(): string {
        throw new Error("hostile getter");
      },
    };

    expect(() => project(fallbackOnly(), hostile)).not.toThrow();
    expect(project(fallbackOnly(), hostile).code).toBe("internal_error");
  });
});

describe("project: a throwing projector is contained", () => {
  it("drops details when projectDetails throws, view still stands", () => {
    const catalog = fallbackOnly().registerByCode("x", {
      publicCode: "x_pub",
      status: 400,
      projectDetails: (): unknown => {
        throw new Error("projector blew up");
      },
    });

    const view = project(catalog, { code: "x" });
    expect(view.code).toBe("x_pub");
    expect("details" in view).toBe(false);
  });

  it("drops fields when projectFields throws", () => {
    const catalog = fallbackOnly().registerByCode("y", {
      publicCode: "y_pub",
      status: 400,
      projectFields: (): readonly FieldFault[] => {
        throw new Error("fields projector blew up");
      },
    });

    const view = project(catalog, { code: "y" });
    expect("fields" in view).toBe(false);
  });
});

describe("toProblem: an unknown catalog code is a foreign view, not a fallback", () => {
  it("throws rather than pairing the view's code with the fallback status", () => {
    const view: PublicError = { code: "never_registered" };
    expect(() => toProblem(fallbackOnly(), view)).toThrow(/not registered/);
  });

  it("accepts the foreign code via an explicit transport instead", () => {
    const view: PublicError = { code: "never_registered" };
    const result = toProblem({ status: 500 }, view);
    expect(result.status).toBe(500);
    expect(result.body.code).toBe("never_registered");
  });
});

describe("definePublicErrors: typed factory builds a working catalog", () => {
  it("projects and maps through a factory-built catalog at runtime", () => {
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("db.deadlock", {
      publicCode: "temporarily_unavailable",
      status: 503,
      category: "temporary",
      retryable: true,
    });

    const view = project(catalog, { code: "db.deadlock" });
    expect(view.code).toBe("temporarily_unavailable");

    const result = toProblem(catalog, view);
    expect(result.status).toBe(503);
    expect(result.body.category).toBe("temporary");

    // The fallback path still works through the factory-built catalog.
    expect(project(catalog, new Error("x")).code).toBe("internal_error");
  });
});

describe("projected fields are curated copies", () => {
  const faultsCatalog = (): PublicErrorCatalog =>
    fallbackOnly().registerByCode("form.invalid", {
      publicCode: "invalid_input",
      status: 422,
      projectFields: (error: unknown): readonly FieldFault[] =>
        (error as { faults: readonly FieldFault[] }).faults,
    });

  it("strips foreign extra properties from field faults (whitelist, not passthrough)", () => {
    const fault = {
      field: "email",
      code: "required",
      internalTrace: "smtp-550 relay denied for a@b.com",
    } as FieldFault;
    const view = project(faultsCatalog(), {
      code: "form.invalid",
      faults: [fault],
    });

    expect(view.fields).toEqual([{ field: "email", code: "required" }]);
    expect(JSON.stringify(view.fields)).not.toContain("internalTrace");
  });

  it("decouples fields from the projector's returned objects and freezes them", () => {
    const fault = { field: "email", code: "required" };
    const view = project(faultsCatalog(), {
      code: "form.invalid",
      faults: [fault],
    });

    fault.code = "mutated-after-projection";
    expect(view.fields?.[0]?.code).toBe("required");
    expect(Object.isFrozen(view.fields)).toBe(true);
    expect(Object.isFrozen(view.fields?.[0])).toBe(true);
  });

  it("keeps details by reference: the in-process view may hold rich values (documented contract)", () => {
    // details are deliberately NOT cloned at this stage: the view is an
    // in-process value and may carry e.g. a Date; toProblem is the wire
    // boundary. The projector contract is to return fresh, vetted data.
    const source = { when: new Date(0), orderId: "o-1" };
    const catalog = fallbackOnly().registerByCode("ext.detail", {
      publicCode: "unprocessable",
      status: 422,
      projectDetails: (): unknown => source,
    });

    const view = project(catalog, { code: "ext.detail" });
    expect(view.details).toBe(source);
  });
});
