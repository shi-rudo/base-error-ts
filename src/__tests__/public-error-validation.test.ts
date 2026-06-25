import { describe, expect, it } from "vitest";

import { PublicErrorCatalog } from "../public-error/PublicErrorCatalog.js";
import type { PublicErrorDescriptor } from "../public-error/types.js";

const ok = (): PublicErrorCatalog =>
  new PublicErrorCatalog({
    fallback: { publicCode: "internal_error", status: 500, retryable: false },
  });

// The descriptors below are deliberately malformed for runtime defense, so the
// static type is bypassed with a cast, mirroring how a config from an untyped
// source could arrive.
const bad = (descriptor: unknown): PublicErrorDescriptor<never, never> =>
  descriptor as PublicErrorDescriptor<never, never>;

describe("registration validates the RFC 9457 transport fields", () => {
  it("rejects a status outside [100, 599]", () => {
    expect(() =>
      ok().registerByCode("x", bad({ publicCode: "x_pub", status: 999 })),
    ).toThrow(/status/);
    expect(() =>
      ok().registerByCode("x", bad({ publicCode: "x_pub", status: 99 })),
    ).toThrow(/status/);
  });

  it("rejects a non-integer status", () => {
    expect(() =>
      ok().registerByCode("x", bad({ publicCode: "x_pub", status: 200.5 })),
    ).toThrow(/status/);
  });

  it("accepts boundary statuses 100 and 599", () => {
    expect(() =>
      ok()
        .registerByCode("a", { publicCode: "a_pub", status: 100 })
        .registerByCode("b", { publicCode: "b_pub", status: 599 }),
    ).not.toThrow();
  });

  it("rejects an empty type when present", () => {
    expect(() =>
      ok().registerByCode(
        "x",
        bad({ publicCode: "x_pub", status: 400, type: "" }),
      ),
    ).toThrow(/type/);
  });

  it("accepts an absent type", () => {
    expect(() =>
      ok().registerByCode("x", { publicCode: "x_pub", status: 400 }),
    ).not.toThrow();
  });

  it("rejects an empty publicCode", () => {
    expect(() =>
      ok().registerByCode("x", bad({ publicCode: "", status: 400 })),
    ).toThrow(/publicCode/);
  });

  it("validates the fallback at construction", () => {
    expect(
      () =>
        new PublicErrorCatalog({
          fallback: bad({ publicCode: "internal_error", status: 700 }),
        }),
    ).toThrow(/status/);
  });

  it("validates predicate-registered descriptors too", () => {
    expect(() =>
      ok().register({
        match: (_e: unknown): _e is never => false,
        descriptor: bad({ publicCode: "p_pub", status: 1 }),
      }),
    ).toThrow(/status/);
  });
});
