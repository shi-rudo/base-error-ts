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
