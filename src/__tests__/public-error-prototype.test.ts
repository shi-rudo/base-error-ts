import { describe, expect, it } from "vitest";

import { StructuredError } from "../errors/StructuredError.js";
import { LocalizedMessageSet } from "../public-error/LocalizedMessageSet.js";
import { PublicErrorCatalog } from "../public-error/PublicErrorCatalog.js";
import { project } from "../public-error/project.js";
import { localize } from "../public-error/localize.js";
import { toProblem, PROBLEM_DETAILS_JSON } from "../public-error/toProblem.js";
import type { FieldFault } from "../public-error/types.js";

/**
 * One registration site per public code feeds all three stages. This is the
 * single source of truth the redesign unifies (no separate registry + adapter
 * map). `category` here is the *public* category, deliberately distinct from the
 * internal `StructuredError.category` ("DEADLOCK"); curation, not passthrough.
 */
function buildCatalog(): PublicErrorCatalog {
  return new PublicErrorCatalog({
    fallback: {
      publicCode: "internal_error",
      status: 500,
      type: "https://errors.example/internal",
      retryable: false,
      userMessages: new LocalizedMessageSet({
        baseLocale: "en",
        messages: { en: "Something went wrong." },
      }),
    },
  })
    .registerByCode("db.deadlock", {
      publicCode: "temporarily_unavailable",
      status: 503,
      type: "https://errors.example/temporarily-unavailable",
      category: "temporary",
      retryable: true,
      userMessages: new LocalizedMessageSet({
        baseLocale: "en",
        messages: {
          en: "Please retry in a moment.",
          de: "Bitte versuche es gleich erneut.",
        },
      }),
    })
    .registerByCode("input.invalid", {
      publicCode: "validation_failed",
      status: 400,
      category: "invalid_input",
      retryable: false,
      userMessages: new LocalizedMessageSet({
        baseLocale: "en",
        messages: { en: "Some fields are invalid." },
      }),
      projectFields: (error: unknown): readonly FieldFault[] => {
        const details = (
          error as { details?: { fields?: readonly FieldFault[] } }
        ).details;
        return details?.fields ?? [];
      },
    });
}

const deadlock = (): StructuredError<string, string> =>
  new StructuredError({
    code: "db.deadlock",
    category: "DEADLOCK",
    retryable: true,
    message: "deadlock on row 42 in table accounts (txn 0xdeadbeef)",
  });

describe("stage 1: project (curation = security, message-free, total)", () => {
  it("emits a curated, message-free machine view", () => {
    const view = project(buildCatalog(), deadlock());

    expect(view.code).toBe("temporarily_unavailable");
    expect(view.category).toBe("temporary");
    expect(view.retryable).toBe(true);
    // Message-free: localization is a later, optional stage.
    expect("message" in view).toBe(false);
    expect("locale" in view).toBe(false);
  });

  it("never leaks the internal category or technical message", () => {
    const view = project(buildCatalog(), deadlock());
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("DEADLOCK");
    expect(serialized).not.toContain("accounts");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("row 42");
  });

  it("is total over unknown: any input yields the fallback view, never throws", () => {
    const catalog = buildCatalog();

    for (const input of [new Error("boom"), 42, null, undefined, "nope", {}]) {
      const view = project(catalog, input);
      expect(view.code).toBe("internal_error");
      expect(view.retryable).toBe(false);
    }
  });
});

describe("stage 2: localize (optional, orthogonal, keyed on publicCode)", () => {
  it("backend localization: resolves the descriptor's messages by preference", () => {
    const catalog = buildCatalog();
    const view = project(catalog, deadlock());
    const messages = catalog.messagesFor(view.code);
    expect(messages).toBeDefined();

    const localized = localize(view, messages!, { locales: ["de"] });
    expect(localized.message).toBe("Bitte versuche es gleich erneut.");
    expect(localized.locale).toBe("de");
    // The machine fields ride along unchanged.
    expect(localized.code).toBe("temporarily_unavailable");
    expect(localized.retryable).toBe(true);
  });

  it("client localization: same view, a foreign catalog keyed on the same publicCode", () => {
    const view = project(buildCatalog(), deadlock());

    // A client (SPA/Edge) ships its OWN catalog keyed on the public code. It
    // never touches the backend registry; the view is all it needs.
    const clientCatalog = new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "We are a little busy. Try again shortly." },
    });

    const localized = localize(view, clientCatalog, { locales: ["en"] });
    expect(localized.message).toBe("We are a little busy. Try again shortly.");
  });
});

describe("stage 3: toProblem (transport; title only when localized)", () => {
  it("structure-only path: machine-complete body, no title, no content-language", () => {
    const catalog = buildCatalog();
    const view = project(catalog, deadlock());

    const result = toProblem(catalog, view);

    expect(result.status).toBe(503);
    expect(result.headers["content-type"]).toBe(PROBLEM_DETAILS_JSON);
    expect("content-language" in result.headers).toBe(false);

    expect(result.body).toMatchObject({
      type: "https://errors.example/temporarily-unavailable",
      status: 503,
      code: "temporarily_unavailable",
      category: "temporary",
      retryable: true,
    });
    // RFC 9457 title is optional; the structure stands without i18n.
    expect("title" in result.body).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain("DEADLOCK");
  });

  it("backend path: title from the localized message, content-language header", () => {
    const catalog = buildCatalog();
    const view = project(catalog, deadlock());
    const localized = localize(view, catalog.messagesFor(view.code)!, {
      locales: ["de"],
    });

    const result = toProblem(catalog, localized);

    expect(result.body.title).toBe("Bitte versuche es gleich erneut.");
    expect(result.headers["content-language"]).toBe("de");
    expect(result.body.status).toBe(503);
    expect(result.body.code).toBe("temporarily_unavailable");
  });

  it("carries an occurrence instance/detail without touching the title", () => {
    const catalog = buildCatalog();
    const view = project(catalog, deadlock());

    const result = toProblem(catalog, view, {
      instance: "/requests/abc",
      detail: "Retry after the lock clears.",
    });

    expect(result.body.instance).toBe("/requests/abc");
    expect(result.body.detail).toBe("Retry after the lock clears.");
    expect("title" in result.body).toBe(false);
  });
});

describe("retryable: declared default, optional occurrence override, total", () => {
  it("an occurrence projector overrides the declared default", () => {
    const catalog = new PublicErrorCatalog({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("io.timeout", {
      publicCode: "upstream_timeout",
      status: 504,
      retryable: true,
      projectRetryable: (error: unknown): boolean =>
        (error as { attempt?: number }).attempt !== 3,
    });

    const exhausted = project(catalog, { code: "io.timeout", attempt: 3 });
    expect(exhausted.retryable).toBe(false);

    const transient = project(catalog, { code: "io.timeout", attempt: 1 });
    expect(transient.retryable).toBe(true);
  });

  it("a throwing occurrence projector falls back to the declared default", () => {
    const catalog = new PublicErrorCatalog({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("io.timeout", {
      publicCode: "upstream_timeout",
      status: 504,
      retryable: true,
      projectRetryable: (): boolean => {
        throw new Error("projector blew up");
      },
    });

    const view = project(catalog, { code: "io.timeout" });
    expect(view.retryable).toBe(true);
  });
});

describe("fields: first-class validation projection (curated, never spread)", () => {
  it("projects vetted field faults onto view and problem body", () => {
    const catalog = buildCatalog();
    const error = {
      code: "input.invalid",
      category: "VALIDATION",
      retryable: false,
      message: "validation failed for user@example.com",
      details: {
        fields: [
          { field: "email", code: "required" },
          { field: "age", code: "out_of_range" },
        ],
        rawSqlState: "23505",
      },
    };

    const view = project(catalog, error);
    expect(view.fields).toEqual([
      { field: "email", code: "required" },
      { field: "age", code: "out_of_range" },
    ]);

    const body = toProblem(catalog, view).body;
    expect(body.fields).toEqual(view.fields);
    // The curated projection never spreads the raw error.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("23505");
    expect(serialized).not.toContain("user@example.com");
  });
});

describe("single source of truth", () => {
  it("assertCoverage reports internal codes lacking a descriptor", () => {
    const catalog = buildCatalog();
    expect(() =>
      catalog.assertCoverage(["db.deadlock", "input.invalid"]),
    ).not.toThrow();
    expect(() =>
      catalog.assertCoverage(["db.deadlock", "missing.code"]),
    ).toThrow(/missing\.code/);
  });

  it("rejects one public code mapped to conflicting transport", () => {
    const catalog = new PublicErrorCatalog({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("a", { publicCode: "shared", status: 409 });

    expect(() =>
      catalog.registerByCode("b", { publicCode: "shared", status: 422 }),
    ).toThrow(/conflicting transport/);
  });
});
