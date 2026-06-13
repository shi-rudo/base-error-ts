import { describe, it, expect } from "vitest";
import {
  LocalizedMessageSet,
  resolveUserMessage,
} from "../presentation/index.js";

const set = (messages: Record<string, string>, baseLocale = "en") =>
  new LocalizedMessageSet({ baseLocale, messages });

describe("resolveUserMessage", () => {
  describe("basic matching", () => {
    it("returns an exact match against a supplied preference", () => {
      const r = resolveUserMessage(set({ en: "hi", de: "hallo" }), {
        locales: ["de"],
      });
      expect(r).toEqual({
        locale: "de",
        message: "hallo",
        matchedPreferenceIndex: 0,
        match: "exact",
      });
    });

    it("returns a parent match when only the base language is present", () => {
      const r = resolveUserMessage(set({ en: "hi", de: "hallo" }), {
        locales: ["de-DE"],
      });
      expect(r).toEqual({
        locale: "de",
        message: "hallo",
        matchedPreferenceIndex: 0,
        match: "parent",
      });
    });

    it("honors preference order across the list", () => {
      const r = resolveUserMessage(set({ en: "hi", de: "hallo" }), {
        locales: ["fr", "de"],
      });
      expect(r).toEqual({
        locale: "de",
        message: "hallo",
        matchedPreferenceIndex: 1,
        match: "exact",
      });
    });

    it("skips an invalid requested locale and continues", () => {
      const r = resolveUserMessage(set({ en: "hi", de: "hallo" }), {
        locales: ["not a locale", "de"],
      });
      expect(r.locale).toBe("de");
      expect(r.matchedPreferenceIndex).toBe(1);
      expect(r.match).toBe("exact");
    });
  });

  describe("baseLocale fallback", () => {
    it("falls back to the base when nothing else matches", () => {
      const r = resolveUserMessage(set({ en: "hi", de: "hallo" }), {
        locales: ["fr"],
      });
      expect(r).toEqual({ locale: "en", message: "hi", match: "base" });
      expect(r.matchedPreferenceIndex).toBeUndefined();
    });

    it("falls back to the base when no locales are supplied", () => {
      expect(resolveUserMessage(set({ en: "hi" }))).toEqual({
        locale: "en",
        message: "hi",
        match: "base",
      });
    });

    it("a supplied base locale is an exact match, not a base match", () => {
      const r = resolveUserMessage(set({ en: "hi" }), { locales: ["en"] });
      expect(r).toEqual({
        locale: "en",
        message: "hi",
        matchedPreferenceIndex: 0,
        match: "exact",
      });
    });

    it("matches the base language via a supplied parent rather than as base", () => {
      // requested en-GB, only en present (which is also the base):
      // attributed to the supplied preference as a parent, not "base"
      const r = resolveUserMessage(set({ en: "hi" }), { locales: ["en-GB"] });
      expect(r).toEqual({
        locale: "en",
        message: "hi",
        matchedPreferenceIndex: 0,
        match: "parent",
      });
    });
  });

  describe("dedupe is preference-order-first (pinned vector)", () => {
    it("attributes a duplicate to the earlier preference's truncation chain", () => {
      // locales=[de-CH, fr, de], set={en, de, fr}, baseLocale=en
      // candidates after expansion + dedupe: de-CH, de, fr, en
      // de comes from de-CH's chain (pref 0, parent); the later `de` is dropped
      const r = resolveUserMessage(
        set({ en: "hi", de: "hallo", fr: "salut" }, "en"),
        { locales: ["de-CH", "fr", "de"] },
      );
      expect(r).toEqual({
        locale: "de",
        message: "hallo",
        matchedPreferenceIndex: 0,
        match: "parent",
      });
    });
  });

  describe("RFC 4647 truncation vectors", () => {
    it("zh-Hant-TW falls through zh-Hant to zh", () => {
      expect(
        resolveUserMessage(set({ en: "x", zh: "中文" }), {
          locales: ["zh-Hant-TW"],
        }).locale,
      ).toBe("zh");
      expect(
        resolveUserMessage(set({ en: "x", "zh-Hant": "繁體" }), {
          locales: ["zh-Hant-TW"],
        }),
      ).toMatchObject({ locale: "zh-Hant", match: "parent" });
    });

    it("de-DE-u-co-phonebk falls through to de-DE and de (singleton stripped)", () => {
      expect(
        resolveUserMessage(set({ en: "x", de: "de" }), {
          locales: ["de-DE-u-co-phonebk"],
        }).locale,
      ).toBe("de");
      expect(
        resolveUserMessage(set({ en: "x", "de-DE": "deDE" }), {
          locales: ["de-DE-u-co-phonebk"],
        }).locale,
      ).toBe("de-DE");
    });

    it("en-US-x-private falls through en-US to en", () => {
      expect(
        resolveUserMessage(set({ en: "x" }), {
          locales: ["en-US-x-private"],
        }),
      ).toMatchObject({ locale: "en", match: "parent" });
      expect(
        resolveUserMessage(set({ en: "x", "en-US": "us" }), {
          locales: ["en-US-x-private"],
        }).locale,
      ).toBe("en-US");
    });
  });
});
