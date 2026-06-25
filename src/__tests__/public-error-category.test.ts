import { describe, expect, it } from "vitest";

import { PublicErrorCatalog } from "../public-error/PublicErrorCatalog.js";
import type { PublicErrorDescriptor } from "../public-error/types.js";

const bad = (descriptor: unknown): PublicErrorDescriptor<never, never> =>
  descriptor as PublicErrorDescriptor<never, never>;

/**
 * Public `category` is an advisory grouping, not an exhaustive branch key
 * (`publicCode` is). To prevent vocabulary drift, a catalog may declare a closed
 * `categories` allowlist, validated at registration. Without it, any non-empty
 * category string is accepted.
 */
describe("category: optional closed vocabulary, validated at registration", () => {
  it("accepts any non-empty category when no allowlist is declared", () => {
    expect(() =>
      new PublicErrorCatalog({
        fallback: { publicCode: "internal_error", status: 500 },
      }).registerByCode("a", {
        publicCode: "a_pub",
        status: 400,
        category: "anything_goes",
      }),
    ).not.toThrow();
  });

  it("accepts a category that is in the declared allowlist", () => {
    expect(() =>
      new PublicErrorCatalog({
        fallback: {
          publicCode: "internal_error",
          status: 500,
          category: "internal",
        },
        categories: ["temporary", "payment", "invalid_input", "internal"],
      }).registerByCode("a", {
        publicCode: "a_pub",
        status: 503,
        category: "temporary",
      }),
    ).not.toThrow();
  });

  it("rejects a category outside the declared allowlist (drift caught)", () => {
    expect(() =>
      new PublicErrorCatalog({
        fallback: {
          publicCode: "internal_error",
          status: 500,
          category: "internal",
        },
        categories: ["temporary", "payment", "internal"],
      }).registerByCode("a", {
        publicCode: "a_pub",
        status: 409,
        category: "CONFLICT", // drift: should be a declared lowercase value
      }),
    ).toThrow(/category "CONFLICT" .*declared categories/);
  });

  it("validates the fallback's category against the allowlist at construction", () => {
    expect(
      () =>
        new PublicErrorCatalog({
          fallback: {
            publicCode: "internal_error",
            status: 500,
            category: "weird",
          },
          categories: ["internal"],
        }),
    ).toThrow(/declared categories/);
  });

  it("rejects an empty category string regardless of allowlist", () => {
    expect(() =>
      new PublicErrorCatalog({
        fallback: { publicCode: "internal_error", status: 500 },
      }).registerByCode(
        "a",
        bad({ publicCode: "a_pub", status: 400, category: "" }),
      ),
    ).toThrow(/empty category/);
  });

  it("allows an absent category on a non-fallback descriptor under an allowlist", () => {
    expect(() =>
      new PublicErrorCatalog({
        fallback: {
          publicCode: "internal_error",
          status: 500,
          category: "temporary",
        },
        categories: ["temporary"],
      }).registerByCode("a", { publicCode: "a_pub", status: 400 }),
    ).not.toThrow();
  });

  it("requires the fallback to carry a category when categories are declared", () => {
    // The fallback is the bucket a client uses for codes it does not recognize,
    // so when a category vocabulary exists the catch-all must be categorized.
    expect(
      () =>
        new PublicErrorCatalog({
          fallback: { publicCode: "internal_error", status: 500 },
          categories: ["temporary", "internal"],
        }),
    ).toThrow(/fallback must declare a category/);
  });

  it("does not require a fallback category when no allowlist is declared", () => {
    expect(
      () =>
        new PublicErrorCatalog({
          fallback: { publicCode: "internal_error", status: 500 },
        }),
    ).not.toThrow();
  });
});
