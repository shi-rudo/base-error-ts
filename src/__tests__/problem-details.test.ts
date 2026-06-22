import { describe, expect, it } from "vitest";
import type { PublicErrorView } from "../presentation/index.js";
import {
  defineProblemDetailsAdapter,
  PROBLEM_DETAILS_JSON,
} from "../problem-details/index.js";

const adapter = defineProblemDetailsAdapter({
  definitions: {
    ACCOUNT_NOT_FOUND: {
      type: "https://api.example.com/problems/account-not-found",
      status: 404,
    },
  },
  fallback: { type: "about:blank", status: 500 },
});
const defineProblemDetailsAdapterUnsafe = defineProblemDetailsAdapter as (
  config: unknown,
) => unknown;

describe("defineProblemDetailsAdapter", () => {
  it("rejects an empty definition map", () => {
    expect(() =>
      defineProblemDetailsAdapterUnsafe({
        definitions: {},
        fallback: { type: "about:blank", status: 500 },
      }),
    ).toThrow(/definitions must not be empty/);
  });

  it("rejects malformed adapter definitions at runtime", () => {
    const symbolField = Symbol("field");
    const invalidConfigs: unknown[] = [
      null,
      { definitions: null, fallback: { type: "about:blank", status: 500 } },
      { definitions: [], fallback: { type: "about:blank", status: 500 } },
      {
        definitions: { [Symbol("CODE")]: { type: "/problem", status: 400 } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { "": { type: "/problem", status: 400 } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { BROKEN: null },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { BROKEN: { type: "", status: 400 } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { BROKEN: { type: "/problem", status: 99 } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { BROKEN: { type: "/problem", status: 600 } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { BROKEN: { type: "/problem", status: 400.5 } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { BROKEN: { type: "/problem", status: 400, extra: true } },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: {
          BROKEN: { type: "/problem", status: 400, [symbolField]: true },
        },
        fallback: { type: "about:blank", status: 500 },
      },
      {
        definitions: { VALID: { type: "/problem", status: 400 } },
        fallback: { type: "about:blank", status: Number.NaN },
      },
      {
        definitions: { VALID: { type: "/problem", status: 400 } },
        fallback: { type: "about:blank", status: 500 },
        extra: true,
      },
    ];

    for (const config of invalidConfigs) {
      expect(() => defineProblemDetailsAdapterUnsafe(config)).toThrow(
        /defineProblemDetailsAdapter/,
      );
    }
  });

  it("rejects non-enumerable definition codes", () => {
    const definitions = {
      VALID: { type: "/problems/valid", status: 400 },
    };
    Object.defineProperty(definitions, "HIDDEN", {
      value: { type: "/problems/hidden", status: 401 },
      enumerable: false,
    });

    expect(() =>
      defineProblemDetailsAdapterUnsafe({
        definitions,
        fallback: { type: "about:blank", status: 500 },
      }),
    ).toThrow(/definition codes must be enumerable/);
  });

  it("snapshots and freezes the complete adapter configuration", () => {
    const config = {
      definitions: {
        FAILURE: { type: "/problems/failure", status: 400 },
      },
      fallback: { type: "about:blank", status: 500 },
    };
    const isolated = defineProblemDetailsAdapter(config);

    config.definitions.FAILURE.type = "/mutated";
    config.definitions.FAILURE.status = 418;
    config.fallback.type = "/mutated-fallback";
    config.fallback.status = 599;

    expect(
      isolated.map({ code: "FAILURE", message: "Failure", locale: "en" }),
    ).toMatchObject({
      status: 400,
      body: { type: "/problems/failure", status: 400 },
    });
    expect(
      isolated.map({ code: "UNKNOWN", message: "Failure", locale: "en" }),
    ).toMatchObject({
      status: 500,
      body: { type: "about:blank", status: 500 },
    });
    expect(Object.isFrozen(isolated)).toBe(true);
    expect(Object.isFrozen(isolated.definitions)).toBe(true);
    expect(Object.isFrozen(isolated.definitions.FAILURE)).toBe(true);
    expect(Object.isFrozen(isolated.fallback)).toBe(true);
  });

  it("maps a public view to a framework-neutral RFC 9457 result", () => {
    const view: PublicErrorView<{ accountId: string }> = {
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found",
      locale: "en",
      details: { accountId: "a-123" },
    };

    const result = adapter.map(view, {
      instance: "https://api.example.com/problems/occurrences/p-123",
      detail: "The requested account no longer exists.",
      extensions: { retry_after: 30 },
    });

    expect(result).toEqual({
      status: 404,
      headers: {
        "content-type": PROBLEM_DETAILS_JSON,
        "content-language": "en",
      },
      body: {
        type: "https://api.example.com/problems/account-not-found",
        title: "Account not found",
        status: 404,
        detail: "The requested account no longer exists.",
        instance: "https://api.example.com/problems/occurrences/p-123",
        details: { accountId: "a-123" },
        retry_after: 30,
      },
      outcome: {
        mapping: "definition",
        publicCode: "ACCOUNT_NOT_FOUND",
        omitted: [],
      },
    });
  });

  it("uses the explicit fallback for an unknown public code", () => {
    const result = adapter.map({
      code: "UNMAPPED",
      message: "Something went wrong",
      locale: "de",
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      type: "about:blank",
      title: "Something went wrong",
      status: 500,
    });
    expect(result.outcome).toEqual({
      mapping: "fallback",
      publicCode: "UNMAPPED",
      omitted: [],
    });
  });

  it("omits non-JSON-safe projected details and reports the omission", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 1;
    const symbolProperty = { valid: true } as Record<PropertyKey, unknown>;
    symbolProperty[Symbol("hidden")] = true;
    const invalidDetails: unknown[] = [
      1n,
      Symbol("value"),
      () => "value",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      cyclic,
      sparse,
      symbolProperty,
    ];

    for (const details of invalidDetails) {
      const result = adapter.map({
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
        locale: "en",
        details,
      });

      expect(result.body).not.toHaveProperty("details");
      expect(result.outcome.omitted).toEqual(["details"]);
      expect(() => JSON.stringify(result.body)).not.toThrow();
    }
  });

  it("prevents extensions from overriding reserved problem fields", () => {
    const reserved = [
      "type",
      "title",
      "status",
      "detail",
      "instance",
      "details",
    ] as const;

    for (const key of reserved) {
      const result = adapter.map(
        {
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found",
          locale: "en",
          details: { accountId: "a-123" },
        },
        {
          detail: "Safe detail",
          instance: "/problems/p-123",
          extensions: { [key]: "OVERRIDE" } as never,
        },
      );

      expect(result.body).toMatchObject({
        type: "https://api.example.com/problems/account-not-found",
        title: "Account not found",
        status: 404,
        detail: "Safe detail",
        instance: "/problems/p-123",
        details: { accountId: "a-123" },
      });
      expect(result.outcome.omitted).toEqual(["extensions"]);
    }
  });

  it("rejects reserved extension fields introduced while snapshotting", () => {
    let ownKeysCalls = 0;
    const extensions = new Proxy(
      { safe: "value", status: 418 },
      {
        ownKeys: () => (ownKeysCalls++ === 0 ? ["safe"] : ["safe", "status"]),
        getOwnPropertyDescriptor: (target, key) => ({
          ...Object.getOwnPropertyDescriptor(target, key),
          configurable: true,
        }),
      },
    );

    const result = adapter.map(
      {
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
        locale: "en",
      },
      { extensions: extensions as unknown as { safe: string } },
    );

    expect(result.status).toBe(404);
    expect(result.body.status).toBe(404);
    expect(result.body).not.toHaveProperty("safe");
    expect(result.outcome.omitted).toEqual(["extensions"]);
  });

  it("snapshots and freezes every returned result surface", () => {
    const details = { accountId: "a-123", nested: { visible: true } };
    const extensions = { retry_after: 30, meta: { source: "quota" } };
    const result = adapter.map(
      {
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
        locale: "en",
        details,
      },
      { extensions },
    );

    details.accountId = "mutated";
    details.nested.visible = false;
    extensions.retry_after = 99;
    extensions.meta.source = "mutated";

    expect(result.body.details).toEqual({
      accountId: "a-123",
      nested: { visible: true },
    });
    expect(result.body.retry_after).toBe(30);
    expect(result.body.meta).toEqual({ source: "quota" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.headers)).toBe(true);
    expect(Object.isFrozen(result.body)).toBe(true);
    expect(Object.isFrozen(result.body.details)).toBe(true);
    expect(Object.isFrozen(result.body.details?.nested)).toBe(true);
    expect(Object.isFrozen(result.body.meta)).toBe(true);
    expect(Object.isFrozen(result.outcome)).toBe(true);
    expect(Object.isFrozen(result.outcome.omitted)).toBe(true);
  });

  it("rejects malformed public views and occurrence contexts clearly", () => {
    const mapUnsafe = adapter.map as (
      view: unknown,
      context?: unknown,
    ) => unknown;
    const invalidViews: unknown[] = [
      null,
      {},
      { code: 1, message: "Failure", locale: "en" },
      { code: "FAILURE", message: 1, locale: "en" },
      { code: "FAILURE", message: "Failure", locale: 1 },
    ];

    for (const view of invalidViews) {
      expect(() => mapUnsafe(view)).toThrow(
        /ProblemDetailsAdapter\.map: invalid public view/,
      );
    }

    const view = { code: "FAILURE", message: "Failure", locale: "en" };
    for (const context of [null, "invalid", 1]) {
      expect(() => mapUnsafe(view, context)).toThrow(
        /ProblemDetailsAdapter\.map: invalid context/,
      );
    }
    expect(() => mapUnsafe(view, { detail: 1 })).toThrow(
      /ProblemDetailsAdapter\.map: invalid detail/,
    );
    expect(() => mapUnsafe(view, { instance: 1 })).toThrow(
      /ProblemDetailsAdapter\.map: invalid instance/,
    );
    expect(() => mapUnsafe(view, { unexpected: true })).toThrow(
      /ProblemDetailsAdapter\.map: unknown context field/,
    );
  });

  it("accepts RFC status boundaries and absolute, relative, and opaque URIs", () => {
    const variants = defineProblemDetailsAdapter({
      definitions: {
        MINIMUM: { type: "/problems/minimum", status: 100 },
        MAXIMUM: {
          type: "tag:example.com,2026:maximum",
          status: 599,
        },
      },
      fallback: { type: "about:blank", status: 500 },
    });

    expect(
      variants.map(
        { code: "MINIMUM", message: "Minimum", locale: "en" },
        { instance: "relative-occurrence" },
      ),
    ).toMatchObject({
      status: 100,
      body: {
        type: "/problems/minimum",
        status: 100,
        instance: "relative-occurrence",
      },
    });
    expect(
      variants.map(
        { code: "MAXIMUM", message: "Maximum", locale: "en" },
        { instance: "urn:uuid:12345678-1234-1234-1234-123456789abc" },
      ),
    ).toMatchObject({
      status: 599,
      body: {
        type: "tag:example.com,2026:maximum",
        status: 599,
        instance: "urn:uuid:12345678-1234-1234-1234-123456789abc",
      },
    });
  });

  it("preserves every JSON value and prototype-named extension safely", () => {
    const extensions = JSON.parse(
      '{"null_value":null,"boolean_value":true,"number_value":42,"string_value":"ok","array_value":[false,1,{"nested":"yes"}],"__proto__":{"polluted":true},"constructor":"safe"}',
    ) as Record<string, never>;
    const result = adapter.map(
      {
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
        locale: "en",
        details: [null, false, 1, "value"],
      },
      { extensions },
    );

    expect(result.body.details).toEqual([null, false, 1, "value"]);
    expect(result.body.array_value).toEqual([false, 1, { nested: "yes" }]);
    expect(Object.prototype.hasOwnProperty.call(result.body, "__proto__")).toBe(
      true,
    );
    expect(result.body.__proto__).toEqual({ polluted: true });
    expect(result.body.constructor).toBe("safe");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("omits malformed extensions as one atomic unit", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 1;
    const symbolProperty = { valid: true } as Record<PropertyKey, unknown>;
    symbolProperty[Symbol("hidden")] = true;
    const invalidExtensions: unknown[] = [
      null,
      [],
      { value: undefined },
      { value: 1n },
      { value: Symbol("value") },
      { value: () => "value" },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date() },
      { value: sparse },
      cyclic,
      symbolProperty,
    ];

    for (const extensions of invalidExtensions) {
      const result = adapter.map(
        {
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found",
          locale: "en",
        },
        { extensions: extensions as never },
      );

      expect(result.body).toEqual({
        type: "https://api.example.com/problems/account-not-found",
        title: "Account not found",
        status: 404,
      });
      expect(result.outcome.omitted).toEqual(["extensions"]);
      expect(() => JSON.stringify(result.body)).not.toThrow();
    }
  });

  it("maps operation-like and prototype-named public codes safely", () => {
    const collisions = defineProblemDetailsAdapter({
      definitions: {
        map: { type: "/problems/map", status: 400 },
        definitions: { type: "/problems/definitions", status: 401 },
        fallback: { type: "/problems/fallback", status: 402 },
        ["__proto__"]: { type: "/problems/prototype", status: 403 },
      },
      fallback: { type: "about:blank", status: 500 },
    });

    expect(
      collisions.map({ code: "map", message: "Map", locale: "en" }).status,
    ).toBe(400);
    expect(
      collisions.map({ code: "definitions", message: "D", locale: "en" })
        .status,
    ).toBe(401);
    expect(
      collisions.map({ code: "fallback", message: "F", locale: "en" }).status,
    ).toBe(402);
    expect(
      collisions.map({ code: "__proto__", message: "P", locale: "en" }).status,
    ).toBe(403);
  });

  it("rejects inherited required definition and public-view fields", () => {
    Object.defineProperties(Object.prototype, {
      type: { value: "/polluted", configurable: true },
      status: { value: 418, configurable: true },
    });
    try {
      expect(() =>
        defineProblemDetailsAdapterUnsafe({
          definitions: { BROKEN: {} },
          fallback: {},
        }),
      ).toThrow(/invalid definition/);
    } finally {
      delete (Object.prototype as { type?: unknown }).type;
      delete (Object.prototype as { status?: unknown }).status;
    }

    const inheritedView = Object.create({
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found",
      locale: "en",
    }) as unknown;
    const mapUnsafe = adapter.map as (view: unknown) => unknown;
    expect(() => mapUnsafe(inheritedView)).toThrow(/invalid public view/);
  });

  it("rejects inherited adapter configuration fields", () => {
    Object.defineProperties(Object.prototype, {
      definitions: {
        value: { POLLUTED: { type: "/polluted", status: 418 } },
        configurable: true,
      },
      fallback: {
        value: { type: "about:blank", status: 500 },
        configurable: true,
      },
    });
    try {
      expect(() => defineProblemDetailsAdapterUnsafe({})).toThrow(
        /invalid config/,
      );
    } finally {
      delete (Object.prototype as { definitions?: unknown }).definitions;
      delete (Object.prototype as { fallback?: unknown }).fallback;
    }
  });

  it("never serializes inherited public-view details", () => {
    Object.defineProperty(Object.prototype, "details", {
      value: { secret: "inherited" },
      configurable: true,
    });
    try {
      const result = adapter.map({
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
        locale: "en",
      });
      expect(result.body).not.toHaveProperty("details");
    } finally {
      delete (Object.prototype as { details?: unknown }).details;
    }
  });
});
