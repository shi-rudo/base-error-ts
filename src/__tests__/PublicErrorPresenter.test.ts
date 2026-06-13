import { describe, it, expect, vi } from "vitest";
import {
  LocalizedMessageSet,
  PublicErrorRegistry,
  PublicErrorPresenter,
} from "../presentation/index.js";

const fallback = {
  publicCode: "internal_error",
  userMessages: new LocalizedMessageSet({
    baseLocale: "en",
    messages: {
      en: "An unexpected error occurred.",
      de: "Ein unerwarteter Fehler ist aufgetreten.",
    },
  }),
};

const paymentMessages = new LocalizedMessageSet({
  baseLocale: "en",
  messages: {
    en: "Your payment could not be processed.",
    de: "Ihre Zahlung konnte nicht verarbeitet werden.",
  },
});

describe("PublicErrorPresenter", () => {
  it("presents a matched definition by code, localized", () => {
    const registry = new PublicErrorRegistry().registerByCode(
      "payment.declined",
      { publicCode: "payment.declined", userMessages: paymentMessages },
    );
    const presenter = new PublicErrorPresenter({ registry, fallback });

    const view = presenter.present(
      { code: "payment.declined" },
      { locales: ["de"] },
    );
    expect(view).toEqual({
      code: "payment.declined",
      message: "Ihre Zahlung konnte nicht verarbeitet werden.",
      locale: "de",
    });
  });

  it("projects details when configured", () => {
    const registry = new PublicErrorRegistry().registerByCode<
      { code: string; reason: string },
      { reason: string }
    >("payment.declined", {
      publicCode: "payment.declined",
      userMessages: paymentMessages,
      projectDetails: (e) => ({ reason: e.reason }),
    });
    const presenter = new PublicErrorPresenter({ registry, fallback });

    const view = presenter.present({
      code: "payment.declined",
      reason: "insufficient_funds",
    });
    expect(view).toMatchObject({
      code: "payment.declined",
      details: { reason: "insufficient_funds" },
    });
  });

  it("delivers the matched view without details when projection throws", () => {
    const onPresent = vi.fn();
    const registry = new PublicErrorRegistry().registerByCode(
      "payment.declined",
      {
        publicCode: "payment.declined",
        userMessages: paymentMessages,
        projectDetails: () => {
          throw new Error("bad projection");
        },
      },
    );
    const presenter = new PublicErrorPresenter({
      registry,
      fallback,
      onPresent,
    });

    const view = presenter.present({ code: "payment.declined" });
    expect(view).toEqual({
      code: "payment.declined",
      message: "Your payment could not be processed.",
      locale: "en",
    });
    expect(view).not.toHaveProperty("details");
    expect(onPresent).toHaveBeenCalledTimes(1);
    expect(onPresent.mock.calls[0]?.[2]).toEqual({
      kind: "matched",
      via: "code",
      publicCode: "payment.declined",
      projection: "failed",
    });
  });

  it("records projection not_configured / succeeded in the outcome", () => {
    const onPresent = vi.fn();
    const registry = new PublicErrorRegistry()
      .registerByCode("a", { publicCode: "a", userMessages: paymentMessages })
      .registerByCode("b", {
        publicCode: "b",
        userMessages: paymentMessages,
        projectDetails: () => ({}),
      });
    const presenter = new PublicErrorPresenter({
      registry,
      fallback,
      onPresent,
    });

    presenter.present({ code: "a" });
    expect(onPresent.mock.calls[0]?.[2]).toMatchObject({
      projection: "not_configured",
    });
    presenter.present({ code: "b" });
    expect(onPresent.mock.calls[1]?.[2]).toMatchObject({
      projection: "succeeded",
    });
  });

  describe("totality over unknown", () => {
    it("falls back, localized, when no definition matches", () => {
      const presenter = new PublicErrorPresenter({
        registry: new PublicErrorRegistry(),
        fallback,
      });
      const view = presenter.present(new Error("boom"), { locales: ["de"] });
      expect(view).toEqual({
        code: "internal_error",
        message: "Ein unerwarteter Fehler ist aufgetreten.",
        locale: "de",
      });
    });

    it("never throws for arbitrary inputs", () => {
      const presenter = new PublicErrorPresenter({
        registry: new PublicErrorRegistry(),
        fallback,
      });
      for (const input of [undefined, null, "string", 42, {}, []]) {
        expect(() => presenter.present(input)).not.toThrow();
        expect(presenter.present(input).code).toBe("internal_error");
      }
    });

    it("reports matcher_failed when a matcher throws and nothing matches", () => {
      const onPresent = vi.fn();
      const registry = new PublicErrorRegistry().register({
        match: (_e: unknown): _e is never => {
          throw new Error("boom");
        },
        definition: { publicCode: "x", userMessages: paymentMessages },
      });
      const presenter = new PublicErrorPresenter({
        registry,
        fallback,
        onPresent,
      });
      presenter.present({});
      expect(onPresent.mock.calls[0]?.[2]).toEqual({
        kind: "fallback",
        reason: "matcher_failed",
      });
    });

    it("reports no_definition for a plain miss", () => {
      const onPresent = vi.fn();
      const presenter = new PublicErrorPresenter({
        registry: new PublicErrorRegistry(),
        fallback,
        onPresent,
      });
      presenter.present({});
      expect(onPresent.mock.calls[0]?.[2]).toEqual({
        kind: "fallback",
        reason: "no_definition",
      });
    });
  });

  describe("observer", () => {
    it("fires once with error, view, and outcome", () => {
      const onPresent = vi.fn();
      const presenter = new PublicErrorPresenter({
        registry: new PublicErrorRegistry(),
        fallback,
        onPresent,
      });
      const err = new Error("boom");
      const view = presenter.present(err);
      expect(onPresent).toHaveBeenCalledTimes(1);
      expect(onPresent).toHaveBeenCalledWith(err, view, expect.anything());
    });

    it("swallows a throwing observer (telemetry must not break totality)", () => {
      const presenter = new PublicErrorPresenter({
        registry: new PublicErrorRegistry(),
        fallback,
        onPresent: () => {
          throw new Error("telemetry down");
        },
      });
      expect(() => presenter.present({})).not.toThrow();
      expect(presenter.present({}).code).toBe("internal_error");
    });
  });
});
