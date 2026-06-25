import { describe, expect, it } from "vitest";

import { LocalizedMessageSet } from "../presentation/index.js";
import {
  definePublicErrors,
  localize,
  project,
  toProblem,
} from "../public-error/index.js";
import type {
  LocalizedPublicError,
  PublicError,
} from "../public-error/types.js";

/**
 * A consumable (third-party) API. The integrator reads the JSON and needs a
 * stable, human-readable `title` to debug against, plus a `type` URI pointing at
 * docs. That developer-facing title is static metadata of the problem type,
 * distinct from any localized end-user message.
 */
function apiCatalog(): ReturnType<typeof buildApiCatalog> {
  return buildApiCatalog();
}
function buildApiCatalog() {
  return definePublicErrors({
    fallback: {
      publicCode: "internal_error",
      status: 500,
      type: "https://api.example.com/errors/internal",
      title: "An unexpected error occurred.",
      retryable: false,
    },
  }).registerByCode("payment.declined", {
    publicCode: "payment_declined",
    status: 402,
    type: "https://api.example.com/errors/payment-declined",
    title: "The payment was declined by the processor.",
    category: "payment",
    retryable: false,
    // Localized END-USER text, a different audience from the static title.
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Your payment didn't go through.",
        de: "Deine Zahlung ist nicht durchgegangen.",
      },
    }),
  });
}

describe("consumable API: a stable developer-facing title is always present", () => {
  it("emits the static title and type without any localization", () => {
    const catalog = apiCatalog();
    const view = project(catalog, { code: "payment.declined" });

    const result = toProblem(catalog, view, {
      detail: "Card ending 4242 was declined: insufficient_funds.",
    });

    expect(result.body).toMatchObject({
      type: "https://api.example.com/errors/payment-declined",
      title: "The payment was declined by the processor.",
      status: 402,
      code: "payment_declined",
      detail: "Card ending 4242 was declined: insufficient_funds.",
    });
    // A static title is not a localized response, so no content-language.
    expect("content-language" in result.headers).toBe(false);
  });

  it("falls back to the fallback descriptor's static title for unmapped errors", () => {
    const catalog = apiCatalog();
    const view = project(catalog, new Error("boom"));
    const result = toProblem(catalog, view);

    expect(result.body.title).toBe("An unexpected error occurred.");
    expect(result.body.code).toBe("internal_error");
  });
});

describe("first-party backend: a localized message overrides the static title", () => {
  it("uses the localized end-user message as the title plus content-language", () => {
    const catalog = apiCatalog();
    const view = project(catalog, { code: "payment.declined" });
    const localized = localize(view, catalog.messagesFor(view.code)!, {
      locales: ["de"],
    });

    const result = toProblem(catalog, localized);
    expect(result.body.title).toBe("Deine Zahlung ist nicht durchgegangen.");
    expect(result.headers["content-language"]).toBe("de");
  });
});

describe("client-localizing SPA: no static title means no title (unchanged)", () => {
  it("omits the title when the descriptor has none and the view is not localized", () => {
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
    }).registerByCode("db.deadlock", {
      publicCode: "temporarily_unavailable",
      status: 503,
    });

    const result = toProblem(
      catalog,
      project(catalog, { code: "db.deadlock" }),
    );
    expect("title" in result.body).toBe(false);
  });
});

describe("catalog-free: the transport can carry a static title", () => {
  it("emits a title passed through an explicit transport", () => {
    const view: PublicError = { code: "im_a_teapot" };
    const result = toProblem(
      {
        status: 418,
        type: "https://api.example.com/errors/teapot",
        title: "I refuse to brew coffee.",
      },
      view,
    );
    expect(result.body.title).toBe("I refuse to brew coffee.");
    expect(result.body.type).toBe("https://api.example.com/errors/teapot");
  });

  it("still prefers a localized message over the transport title", () => {
    const view: LocalizedPublicError = {
      code: "im_a_teapot",
      message: "Ich verweigere Kaffee.",
      locale: "de",
    };
    const result = toProblem({ status: 418, title: "I refuse coffee." }, view);
    expect(result.body.title).toBe("Ich verweigere Kaffee.");
    expect(result.headers["content-language"]).toBe("de");
  });
});
