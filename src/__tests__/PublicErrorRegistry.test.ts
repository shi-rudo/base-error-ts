import { describe, it, expect } from "vitest";
import {
  LocalizedMessageSet,
  PublicErrorRegistry,
} from "../presentation/index.js";

const msgs = () =>
  new LocalizedMessageSet({ baseLocale: "en", messages: { en: "x" } });

const def = (publicCode: string) => ({ publicCode, userMessages: msgs() });

describe("PublicErrorRegistry", () => {
  it("throws when the same internal code is registered twice", () => {
    const r = new PublicErrorRegistry().registerByCode(
      "payment.declined",
      def("payment.declined"),
    );
    expect(() =>
      r.registerByCode("payment.declined", def("payment.declined")),
    ).toThrow();
  });

  it("resolves by the error's code", () => {
    const r = new PublicErrorRegistry().registerByCode(
      "payment.declined",
      def("payment.declined"),
    );
    const res = r.resolve({ code: "payment.declined" });
    expect(res).toMatchObject({ found: true, via: "code" });
  });

  it("misses for an error with no matching code and no predicate", () => {
    const r = new PublicErrorRegistry().registerByCode("a", def("a"));
    expect(r.resolve({ code: "other" })).toEqual({
      found: false,
      matcherThrew: false,
    });
    expect(r.resolve("not even an object")).toEqual({
      found: false,
      matcherThrew: false,
    });
  });

  it("lets an exact code match win over a predicate that would also match", () => {
    const r = new PublicErrorRegistry()
      .register({
        match: (e): e is object => typeof e === "object" && e !== null,
        definition: def("predicate.win"),
      })
      .registerByCode("payment.declined", def("code.win"));
    const res = r.resolve({ code: "payment.declined" });
    expect(res).toMatchObject({ found: true, via: "code" });
    if (res.found) expect(res.definition.publicCode).toBe("code.win");
  });

  it("tries predicate matchers in registration order", () => {
    const r = new PublicErrorRegistry()
      .register({ match: (e): e is object => true, definition: def("first") })
      .register({ match: (e): e is object => true, definition: def("second") });
    const res = r.resolve({});
    expect(res).toMatchObject({ found: true, via: "predicate" });
    if (res.found) expect(res.definition.publicCode).toBe("first");
  });

  it("treats a throwing matcher as a miss and continues", () => {
    const r = new PublicErrorRegistry()
      .register({
        match: (_e: unknown): _e is never => {
          throw new Error("boom");
        },
        definition: def("throws"),
      })
      .register({ match: (e): e is object => true, definition: def("ok") });
    const res = r.resolve({});
    expect(res).toMatchObject({ found: true, via: "predicate" });
    if (res.found) expect(res.definition.publicCode).toBe("ok");
  });

  it("reports matcherThrew when a matcher throws and nothing matches", () => {
    const r = new PublicErrorRegistry().register({
      match: (_e: unknown): _e is never => {
        throw new Error("boom");
      },
      definition: def("throws"),
    });
    expect(r.resolve({})).toEqual({ found: false, matcherThrew: true });
  });

  it("carries matcherThrew on a successful match when an earlier matcher threw", () => {
    const r = new PublicErrorRegistry()
      .register({
        match: (_e: unknown): _e is never => {
          throw new Error("boom");
        },
        definition: def("throws"),
      })
      .register({ match: (e): e is object => true, definition: def("ok") });
    const res = r.resolve({});
    expect(res).toMatchObject({
      found: true,
      via: "predicate",
      matcherThrew: true,
    });
    if (res.found) expect(res.definition.publicCode).toBe("ok");
  });

  it("treats a throwing `code` getter as no code, without throwing", () => {
    const r = new PublicErrorRegistry().registerByCode("x", def("x"));
    const err = {
      get code(): string {
        throw new Error("boom");
      },
    };
    expect(() => r.resolve(err)).not.toThrow();
    expect(r.resolve(err)).toEqual({ found: false, matcherThrew: false });
  });
});
