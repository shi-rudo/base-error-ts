import { describe, it, expect } from "vitest";
import { partialMask, StructuredError } from "../index.js";

const apply = (mask: ReturnType<typeof partialMask>, value: unknown) =>
  typeof mask === "function" ? mask(value, "k") : mask;

describe("partialMask", () => {
  it("reveals the last `keepEnd` chars by default (keepStart 0, keepEnd 4)", () => {
    expect(apply(partialMask(), "abcdefghij")).toBe("…ghij");
  });

  it("reveals a prefix and a suffix around the fill", () => {
    expect(
      apply(
        partialMask({ keepStart: 7, keepEnd: 4 }),
        "sk_live_0123456789AbCd",
      ),
    ).toBe("sk_live…AbCd");
  });

  it("uses a custom fill", () => {
    expect(apply(partialMask({ keepEnd: 2, fill: "***" }), "abcdef")).toBe(
      "***ef",
    );
  });

  it("masks a value entirely when it is too short to reveal safely", () => {
    // length (4) <= keepStart(0) + keepEnd(4) -> full mask, no partial leak
    expect(apply(partialMask({ keepEnd: 4 }), "abcd")).toBe("…");
    expect(apply(partialMask({ keepStart: 2, keepEnd: 2 }), "abcd")).toBe("…");
  });

  it("masks non-string values entirely", () => {
    expect(apply(partialMask(), 12345)).toBe("…");
    expect(apply(partialMask({ fill: "X" }), { a: 1 })).toBe("X");
  });

  it("handles keepEnd: 0 without revealing the whole string (no -0 trap)", () => {
    expect(apply(partialMask({ keepStart: 3, keepEnd: 0 }), "abcdef")).toBe(
      "abc…",
    );
  });

  it("masks a value entirely when keepEnd is negative", () => {
    // 4 + (-4) = 0 passes the too-short guard, and slice(0, 4) is the whole value
    expect(apply(partialMask({ keepStart: 4, keepEnd: -4 }), "abcd")).toBe("…");
  });

  it("masks a value entirely when keepStart is negative", () => {
    // slice(0, -1) reveals all but one char
    expect(
      apply(partialMask({ keepStart: -1, keepEnd: 4 }), "abcdefghij"),
    ).toBe("…");
  });

  it("masks a value entirely when keepStart or keepEnd is NaN", () => {
    expect(apply(partialMask({ keepStart: NaN }), "abcdefghij")).toBe("…");
    expect(apply(partialMask({ keepEnd: NaN }), "abcdefghij")).toBe("…");
  });

  it("masks a value entirely when keepStart or keepEnd is not finite", () => {
    expect(apply(partialMask({ keepStart: Infinity }), "abcdefghij")).toBe("…");
    expect(apply(partialMask({ keepEnd: -Infinity }), "abcdefghij")).toBe("…");
  });

  it("masks a value entirely when keepStart or keepEnd is not an integer", () => {
    expect(
      apply(partialMask({ keepStart: 2.5, keepEnd: 2 }), "abcdefghij"),
    ).toBe("…");
    expect(
      apply(partialMask({ keepStart: 2, keepEnd: 2.5 }), "abcdefghij"),
    ).toBe("…");
  });

  it("uses the custom fill as the full mask for an invalid option", () => {
    expect(apply(partialMask({ keepEnd: -4, fill: "***" }), "abcdefghij")).toBe(
      "***",
    );
  });

  it("plugs into redact as a mask", () => {
    const log = new StructuredError({
      code: "X",
      category: "Y",
      retryable: false,
      message: "m",
      details: { apiKey: "sk_live_0123456789AbCd" },
    })
      .redact(["apiKey"], { mask: partialMask({ keepStart: 7, keepEnd: 4 }) })
      .toLogObject();
    expect((log.details as Record<string, unknown>).apiKey).toBe(
      "sk_live…AbCd",
    );
  });
});
