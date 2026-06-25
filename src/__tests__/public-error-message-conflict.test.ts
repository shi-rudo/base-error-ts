import { describe, expect, it } from "vitest";

import { LocalizedMessageSet } from "../presentation/index.js";
import { PublicErrorCatalog } from "../public-error/PublicErrorCatalog.js";

const set = (
  messages: Record<string, string>,
  baseLocale = "en",
): LocalizedMessageSet => new LocalizedMessageSet({ baseLocale, messages });

const base = (): PublicErrorCatalog =>
  new PublicErrorCatalog({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  });

/**
 * One public code is one user-facing message set, mirroring the transport
 * conflict (one public code is one status/type). Many internal codes may map to
 * one public code, but they must agree on the message, or be different public
 * codes. Silent last-write-wins is rejected.
 */
describe("userMessages conflict for one public code", () => {
  it("allows the same set instance shared across internal codes", () => {
    const shared = set({ en: "Busy, please retry." });
    const catalog = base()
      .registerByCode("db.deadlock", {
        publicCode: "temporarily_unavailable",
        status: 503,
        userMessages: shared,
      })
      .registerByCode("db.lock_timeout", {
        publicCode: "temporarily_unavailable",
        status: 503,
        userMessages: shared,
      });

    expect(catalog.messagesFor("temporarily_unavailable")).toBe(shared);
  });

  it("allows content-equal sets that are different instances", () => {
    expect(() =>
      base()
        .registerByCode("db.deadlock", {
          publicCode: "temporarily_unavailable",
          status: 503,
          userMessages: set({ en: "Busy, please retry." }),
        })
        .registerByCode("db.lock_timeout", {
          publicCode: "temporarily_unavailable",
          status: 503,
          userMessages: set({ en: "Busy, please retry." }),
        }),
    ).not.toThrow();
  });

  it("throws on differing message content", () => {
    expect(() =>
      base()
        .registerByCode("db.deadlock", {
          publicCode: "temporarily_unavailable",
          status: 503,
          userMessages: set({ en: "Busy, please retry." }),
        })
        .registerByCode("db.lock_timeout", {
          publicCode: "temporarily_unavailable",
          status: 503,
          userMessages: set({ en: "Hang on a second." }),
        }),
    ).toThrow(/conflicting userMessages/);
  });

  it("throws on a differing set of locales", () => {
    expect(() =>
      base()
        .registerByCode("a", {
          publicCode: "p",
          status: 400,
          userMessages: set({ en: "X" }),
        })
        .registerByCode("b", {
          publicCode: "p",
          status: 400,
          userMessages: set({ en: "X", de: "Y" }),
        }),
    ).toThrow(/conflicting userMessages/);
  });

  it("throws on a differing baseLocale", () => {
    expect(() =>
      base()
        .registerByCode("a", {
          publicCode: "p",
          status: 400,
          userMessages: set({ en: "X", de: "X" }, "en"),
        })
        .registerByCode("b", {
          publicCode: "p",
          status: 400,
          userMessages: set({ en: "X", de: "X" }, "de"),
        }),
    ).toThrow(/conflicting userMessages/);
  });

  it("allows one code to declare messages and another to omit them, either order", () => {
    const withFirst = base()
      .registerByCode("a", {
        publicCode: "p",
        status: 400,
        userMessages: set({ en: "X" }),
      })
      .registerByCode("b", { publicCode: "p", status: 400 });
    expect(withFirst.messagesFor("p")?.get("en")).toBe("X");

    const withoutFirst = base()
      .registerByCode("a", { publicCode: "p", status: 400 })
      .registerByCode("b", {
        publicCode: "p",
        status: 400,
        userMessages: set({ en: "Y" }),
      });
    expect(withoutFirst.messagesFor("p")?.get("en")).toBe("Y");
  });
});
