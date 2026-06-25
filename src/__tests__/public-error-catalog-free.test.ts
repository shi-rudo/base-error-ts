import { describe, expect, it } from "vitest";

import { LocalizedMessageSet } from "../public-error/index.js";
import {
  localize,
  projectWithDescriptor,
  toProblem,
} from "../public-error/index.js";
import type {
  LocalizedPublicError,
  PublicError,
} from "../public-error/types.js";

/**
 * The catalog is convenience, not a requirement. Each stage has a catalog-free
 * entry point: project against a single descriptor, localize against a message
 * set, map to a problem against an explicit transport.
 */
describe("catalog-free: projectWithDescriptor", () => {
  it("projects against one descriptor, no catalog", () => {
    const view = projectWithDescriptor(
      {
        publicCode: "im_a_teapot",
        status: 418,
        category: "fun",
        retryable: false,
        projectDetails: (error: unknown): { brew: string } => ({
          brew: String((error as { brew?: unknown }).brew),
        }),
      },
      { brew: "earl grey" },
    );

    expect(view).toEqual({
      code: "im_a_teapot",
      category: "fun",
      retryable: false,
      details: { brew: "earl grey" },
    });
  });
});

describe("catalog-free: toProblem with an explicit transport", () => {
  it("maps a hand-built view to a problem with no catalog", () => {
    const view: PublicError = {
      code: "im_a_teapot",
      category: "fun",
      retryable: false,
    };

    const result = toProblem(
      { status: 418, type: "https://errors.example/teapot" },
      view,
    );

    expect(result.status).toBe(418);
    expect(result.body).toMatchObject({
      type: "https://errors.example/teapot",
      status: 418,
      code: "im_a_teapot",
      category: "fun",
      retryable: false,
    });
    expect("title" in result.body).toBe(false);
    expect("content-language" in result.headers).toBe(false);
  });

  it("still attaches title and content-language when the view is localized", () => {
    const view: LocalizedPublicError = {
      code: "im_a_teapot",
      message: "I'm a teapot.",
      locale: "en",
    };

    const result = toProblem({ status: 418 }, view);
    expect(result.body.title).toBe("I'm a teapot.");
    expect(result.headers["content-language"]).toBe("en");
  });
});

describe("catalog-free: localize was already free", () => {
  it("localizes a view against a standalone message set", () => {
    const view: PublicError = { code: "im_a_teapot" };
    const messages = new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "I'm a teapot.", de: "Ich bin eine Teekanne." },
    });

    const localized = localize(view, messages, { locales: ["de"] });
    expect(localized.message).toBe("Ich bin eine Teekanne.");
    expect(localized.code).toBe("im_a_teapot");
  });
});
