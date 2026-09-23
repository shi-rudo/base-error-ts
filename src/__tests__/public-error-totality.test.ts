import { describe, expect, it } from "vitest";
import { hostileProxy } from "./hostile-values.fixture.js";

import {
  PublicErrorCatalog,
  definePublicErrors,
} from "../public-error/PublicErrorCatalog.js";
import { project } from "../public-error/project.js";
import {
  PROBLEM_DETAILS_JSON,
  toProblem,
  type ToProblemContext,
} from "../public-error/toProblem.js";
import type {
  FieldFault,
  LocalizedPublicError,
  PublicError,
} from "../public-error/types.js";
import { MAX_DATA_NODES } from "../errors/walker-bounds.js";

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

  it("copies the field and code values that passed the check", () => {
    let fieldReads = 0;
    const fault = {
      get field(): unknown {
        fieldReads++;
        return fieldReads === 1 ? "email" : 42;
      },
      code: "required",
    } as unknown as FieldFault;

    const view = project(faultsCatalog(), {
      code: "form.invalid",
      faults: [fault],
    });

    expect(view.fields).toEqual([{ field: "email", code: "required" }]);
    expect(fieldReads).toBe(1);
  });

  it("drops fields when the returned list reports a length that is not a count", () => {
    const lyingList = new Proxy([{ field: "email", code: "required" }], {
      get: (target, key, receiver): unknown =>
        key === "length" ? -1 : Reflect.get(target, key, receiver),
    });

    const view = project(faultsCatalog(), {
      code: "form.invalid",
      faults: lyingList,
    });

    expect(view.fields).toBeUndefined();
  });

  it("drops fields when the returned list is longer than the data-node budget", () => {
    const longList = new Proxy([], {
      get: (target, key, receiver): unknown => {
        if (key === "length") return MAX_DATA_NODES + 1;
        if (typeof key === "string" && /^\d+$/.test(key)) {
          return { field: "email", code: "required" };
        }
        return Reflect.get(target, key, receiver);
      },
    });

    const view = project(faultsCatalog(), {
      code: "form.invalid",
      faults: longList,
    });

    expect(view.fields).toBeUndefined();
  });

  it("keeps each copied fault a plain object", () => {
    const view = project(faultsCatalog(), {
      code: "form.invalid",
      faults: [{ field: "email", code: "required" }],
    });

    expect(Object.getPrototypeOf(view.fields?.[0])).toBe(Object.prototype);
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

/** A getter that returns `first` on its first read and `later` afterwards. */
function flipping(first: unknown, later: unknown): PropertyDescriptor {
  let reads = 0;
  return { get: () => (++reads === 1 ? first : later), enumerable: true };
}

function throwingGetter(): PropertyDescriptor {
  return {
    get: (): never => {
      throw new Error("hostile getter");
    },
    enumerable: true,
  };
}

describe("toProblem: a hand-built view with getters", () => {
  it("drops a details member whose getter throws and records it", () => {
    const view = Object.defineProperties(
      { code: "x" },
      { details: throwingGetter() },
    ) as PublicError;

    const result = toProblem({ status: 400 }, view);

    expect("details" in result.body).toBe(false);
    expect(result.outcome.omitted).toEqual(["details"]);
  });

  it("drops a fields member whose getter throws and records it", () => {
    const view = Object.defineProperties(
      { code: "x" },
      { fields: throwingGetter() },
    ) as PublicError;

    const result = toProblem({ status: 400 }, view);

    expect("fields" in result.body).toBe(false);
    expect(result.outcome.omitted).toEqual(["fields"]);
  });

  it("treats the other members as absent when their getters throw", () => {
    const view = Object.defineProperties(
      { code: "x" },
      {
        category: throwingGetter(),
        retryable: throwingGetter(),
        retryAfter: throwingGetter(),
        message: throwingGetter(),
        locale: throwingGetter(),
      },
    ) as LocalizedPublicError;

    const result = toProblem({ status: 400, title: "Static." }, view);

    expect(result.body).toEqual({ title: "Static.", status: 400, code: "x" });
    expect(result.headers).toEqual({ "content-type": PROBLEM_DETAILS_JSON });
  });

  it("throws the documented error when the code getter throws", () => {
    const view = Object.defineProperties({}, { code: throwingGetter() });

    expect(() => toProblem({ status: 400 }, view as PublicError)).toThrow(
      "toProblem: view.code must be a non-empty string.",
    );
  });

  it("writes the view values that it validated", () => {
    const view = Object.defineProperties(
      {},
      {
        code: flipping("x", { forged: true }),
        category: flipping("temporary", { forged: true }),
        retryable: flipping(true, "yes"),
        retryAfter: flipping(5, "5\r\nSet-Cookie: session=1"),
        message: flipping("Try again later.", 42),
        locale: flipping("en", "en\r\nX-Injected: 1"),
      },
    ) as LocalizedPublicError;

    const result = toProblem({ status: 429 }, view);

    expect(result.body).toEqual({
      title: "Try again later.",
      status: 429,
      code: "x",
      category: "temporary",
      retryable: true,
      retryAfter: 5,
    });
    expect(result.headers).toEqual({
      "content-type": PROBLEM_DETAILS_JSON,
      "content-language": "en",
      "retry-after": "5",
    });
  });

  it("drops context members whose getters throw and records extensions", () => {
    const context = Object.defineProperties(
      {},
      {
        extensions: throwingGetter(),
        detail: throwingGetter(),
        instance: throwingGetter(),
      },
    ) as ToProblemContext;

    const result = toProblem({ status: 400 }, { code: "x" }, context);

    expect(result.body).toEqual({ status: 400, code: "x" });
    expect(result.outcome.omitted).toEqual(["extensions"]);
  });

  it("reads the members of a callable view and context", () => {
    const view = Object.assign(() => undefined, { code: "x" });
    const context = Object.assign(() => undefined, {
      detail: "The lock clears soon.",
      extensions: { traceId: "t-1" },
    });

    const result = toProblem(
      { status: 400 },
      view as unknown as PublicError,
      context as unknown as ToProblemContext,
    );

    expect(result.body).toEqual({
      status: 400,
      detail: "The lock clears soon.",
      code: "x",
      traceId: "t-1",
    });
  });

  it("writes the context values that it validated", () => {
    const context = Object.defineProperties(
      {},
      {
        detail: flipping("The lock clears soon.", { forged: true }),
        instance: flipping("urn:trace:1", { forged: true }),
        retryAfter: flipping(5, "5\r\nSet-Cookie: session=1"),
      },
    ) as ToProblemContext;

    const result = toProblem({ status: 429 }, { code: "x" }, context);

    expect(result.body).toEqual({
      status: 429,
      detail: "The lock clears soon.",
      instance: "urn:trace:1",
      code: "x",
      retryAfter: 5,
    });
    expect(result.headers["retry-after"]).toBe("5");
  });
});

describe("toProblem: a hand-built transport and extensions", () => {
  it("writes the transport status and type that it validated", () => {
    const transport = Object.defineProperties(
      {},
      {
        status: flipping(400, "oops"),
        type: flipping("https://errors.example/bad-input", { forged: true }),
      },
    ) as { status: number; type: string };

    const result = toProblem(transport, { code: "x" });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      type: "https://errors.example/bad-input",
      status: 400,
      code: "x",
    });
  });

  it("throws the documented error when the transport status getter throws", () => {
    const transport = Object.defineProperties({}, { status: throwingGetter() });

    expect(() =>
      toProblem(transport as { status: number }, { code: "x" }),
    ).toThrow(/invalid transport status/);
  });

  it("throws the documented error when the transport type getter throws", () => {
    const transport = Object.defineProperties(
      { status: 400 },
      { type: throwingGetter() },
    );

    expect(() =>
      toProblem(transport as { status: number }, { code: "x" }),
    ).toThrow(/invalid transport type/);
  });

  it("validates the transport that a catalog returns", () => {
    const lookalike = { transportFor: () => ({ status: "oops", type: 7 }) };

    expect(() =>
      toProblem(lookalike as unknown as PublicErrorCatalog, { code: "x" }),
    ).toThrow(/invalid transport status/);
  });

  it("reads the transportFor member of a catalog once", () => {
    const lookalike = Object.defineProperties(
      {},
      {
        transportFor: flipping(
          () => ({ status: 404, type: "https://errors.example/missing" }),
          undefined,
        ),
      },
    );

    const result = toProblem(lookalike as PublicErrorCatalog, { code: "x" });

    expect(result.status).toBe(404);
    expect(result.body.type).toBe("https://errors.example/missing");
  });

  it("copies only the extension keys that it checked", () => {
    const target = JSON.parse(
      '{"traceId":"t-1","type":"https://evil.example","__proto__":"https://evil.example"}',
    ) as object;
    let listings = 0;
    const extensions = new Proxy(target, {
      ownKeys: (inner) =>
        ++listings === 1 ? ["traceId"] : Reflect.ownKeys(inner),
    });

    const result = toProblem({ status: 400 }, { code: "x" }, {
      extensions,
    } as ToProblemContext);

    expect(Reflect.ownKeys(result.body).sort()).toEqual([
      "code",
      "status",
      "traceId",
    ]);
    expect(result.outcome.omitted).toEqual([]);
  });
});
