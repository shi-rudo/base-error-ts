import { describe, it, expect } from "vitest";
import { LocalizedMessageSet } from "../presentation/index.js";

describe("LocalizedMessageSet", () => {
  const make = () =>
    new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Your payment could not be processed.",
        de: "Ihre Zahlung konnte nicht verarbeitet werden.",
      },
    });

  describe("construction & read-only API", () => {
    it("exposes the canonical baseLocale", () => {
      expect(make().baseLocale).toBe("en");
    });

    it("resolves exact entries via get/has", () => {
      const set = make();
      expect(set.has("de")).toBe(true);
      expect(set.get("de")).toBe(
        "Ihre Zahlung konnte nicht verarbeitet werden.",
      );
      expect(set.has("en")).toBe(true);
      expect(set.get("en")).toBe("Your payment could not be processed.");
    });

    it("does not parent-fall back: get is an exact (canonical) lookup only", () => {
      // resolution/truncation is the resolver's job, not the set's
      expect(make().get("de-DE")).toBeUndefined();
      expect(make().has("de-DE")).toBe(false);
    });

    it("returns canonical entries", () => {
      const entries = make().entries();
      expect(new Map(entries).get("en")).toBe(
        "Your payment could not be processed.",
      );
      // entries are a copy: mutating the result must not affect the set
      (entries as Array<[string, string]>).push(["fr", "x"]);
      expect(make().has("fr")).toBe(false);
    });
  });

  describe("locale canonicalization (write)", () => {
    it("canonicalizes keys; differently-cased inputs resolve identically", () => {
      const set = new LocalizedMessageSet({
        baseLocale: "EN",
        messages: { EN: "hello", "de-de": "hallo" },
      });
      expect(set.baseLocale).toBe("en");
      expect(set.get("de-DE")).toBe("hallo");
      expect(set.get("de-de")).toBe("hallo");
      expect(set.has("en")).toBe(true);
    });

    it("rejects an invalid baseLocale tag", () => {
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "not a locale",
            messages: { en: "hi" },
          }),
      ).toThrow();
    });

    it("rejects an invalid message key tag", () => {
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "en",
            messages: { en: "hi", de_DE: "bad" },
          }),
      ).toThrow();
    });

    it("rejects keys that collide after canonicalization", () => {
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "en",
            messages: { en: "hi", "de-de": "a", "de-DE": "b" },
          }),
      ).toThrow();
    });

    it("treats a legacy tag as its canonical form (iw -> he)", () => {
      const set = new LocalizedMessageSet({
        baseLocale: "en",
        messages: { en: "hi", iw: "shalom" },
      });
      expect(set.has("he")).toBe(true);
      expect(set.get("iw")).toBe("shalom");
      // iw and he both canonicalize to he: a collision
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "en",
            messages: { en: "hi", iw: "a", he: "b" },
          }),
      ).toThrow();
    });
  });

  describe("base-entry invariant", () => {
    it("rejects a set without an entry for its baseLocale", () => {
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "en",
            messages: { de: "hallo" },
          }),
      ).toThrow();
    });

    it("accepts when the base entry is present under a non-canonical spelling", () => {
      const set = new LocalizedMessageSet({
        baseLocale: "en-us",
        messages: { "EN-US": "hi" },
      });
      expect(set.baseLocale).toBe("en-US");
      expect(set.get("en-US")).toBe("hi");
    });
  });

  describe("message content invariant", () => {
    it("rejects an empty or whitespace-only message", () => {
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "en",
            messages: { en: "" },
          }),
      ).toThrow();
      expect(
        () =>
          new LocalizedMessageSet({
            baseLocale: "en",
            messages: { en: "   \t\n " },
          }),
      ).toThrow();
    });

    it("preserves message contents verbatim (no trimming)", () => {
      const set = new LocalizedMessageSet({
        baseLocale: "en",
        messages: { en: "  spaced out  " },
      });
      expect(set.get("en")).toBe("  spaced out  ");
    });
  });

  describe("read-side locale policy", () => {
    it("treats an invalid requested locale as a miss, not a throw", () => {
      const set = make();
      expect(set.has("not a locale")).toBe(false);
      expect(set.get("de_DE")).toBeUndefined();
      expect(set.get("")).toBeUndefined();
    });
  });

  describe("getCanonical (fast path)", () => {
    it("looks up an already-canonical key without re-canonicalizing", () => {
      const set = make();
      expect(set.getCanonical("de")).toBe(
        "Ihre Zahlung konnte nicht verarbeitet werden.",
      );
      expect(set.getCanonical("en")).toBe(
        "Your payment could not be processed.",
      );
    });

    it("does not canonicalize its argument: a non-canonical spelling misses", () => {
      const set = make();
      expect(set.getCanonical("DE")).toBeUndefined();
      expect(set.getCanonical("de-de")).toBeUndefined();
    });
  });
});
