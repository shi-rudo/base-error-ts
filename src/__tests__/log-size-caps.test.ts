import { describe, expect, it } from "vitest";

import { StructuredError } from "../index.js";

type LogRecord = Record<string, unknown>;

function detailsLog(details: Record<string, unknown>): LogRecord {
  return new StructuredError({
    code: "UPLOAD_FAILED",
    category: "IO",
    retryable: false,
    message: "upload failed",
    details,
  }).toLogObject().details as LogRecord;
}

describe("the width cap of a data container", () => {
  it("cuts an array at 1000 entries, names the dropped ones, and keeps its sibling", () => {
    const ids = Array.from({ length: 200_000 }, (_, index) => index);

    const details = detailsLog({ orderId: 42, ids });

    const logged = details.ids as unknown[];
    expect(details.orderId).toBe(42);
    expect(logged).toHaveLength(1001);
    expect(logged[999]).toBe(999);
    expect(logged[1000]).toBe("[199000 more items]");
  });

  it("keeps an array of 1000 entries without a marker", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => index);

    const details = detailsLog({ ids });

    expect(details.ids).toEqual(ids);
  });

  it("cuts an object at 1000 keys and names the number of dropped keys", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 5000 }, (_, index) => [`k${index}`, index]),
    );

    const details = detailsLog({ orderId: 42, wide });

    const logged = details.wide as LogRecord;
    expect(details.orderId).toBe(42);
    expect(Object.keys(logged)).toHaveLength(1001);
    expect(logged.k999).toBe(999);
    expect(logged).not.toHaveProperty("k1000");
    expect(logged["[more keys]"]).toBe(4000);
  });
});

describe("the summary of binary data", () => {
  it("writes a typed array, a DataView and an ArrayBuffer as their type and size", () => {
    const details = detailsLog({
      bytes: new Uint8Array([1, 2, 3]),
      floats: new Float64Array(4),
      view: new DataView(new ArrayBuffer(16)),
      buffer: new ArrayBuffer(8),
    });

    expect(details).toEqual({
      bytes: "[Uint8Array(3)]",
      floats: "[Float64Array(4)]",
      view: "[DataView(16)]",
      buffer: "[ArrayBuffer(8)]",
    });
  });

  it("keeps the sibling of a 1 MB typed array", () => {
    const details = detailsLog({
      orderId: 42,
      upload: new Uint8Array(1_000_000),
    });

    expect(details).toEqual({ orderId: 42, upload: "[Uint8Array(1000000)]" });
  });

  it.skipIf(typeof Buffer === "undefined")(
    "writes a Buffer as its type and size instead of its toJSON",
    () => {
      const details = detailsLog({
        orderId: 42,
        upload: Buffer.alloc(1_000_000),
      });

      expect(details).toEqual({ orderId: 42, upload: "[Buffer(1000000)]" });
    },
  );
});

function longMessageError(message: string, cause?: unknown) {
  return new StructuredError({
    code: "IMPORT_FAILED",
    category: "IO",
    retryable: false,
    message,
    ...(cause !== undefined && { cause }),
  });
}

describe("the length cap of a string", () => {
  it("cuts a long message at 10 000 characters and names the dropped ones", () => {
    const log = longMessageError("m".repeat(1_000_000)).toLogObject();

    expect(log.message).toBe(`${"m".repeat(10_000)}[990000 more characters]`);
  });

  it("writes the stack header with the cut message and keeps the frames", () => {
    const log = longMessageError("m".repeat(1_000_000)).toLogObject();

    const stack = log.stack as string;
    expect(stack.startsWith(`IMPORT_FAILED: ${String(log.message)}\n`)).toBe(
      true,
    );
    expect(stack).toContain("\n    at ");
    expect(stack.length).toBeLessThan(25_000);
  });

  it("masks the header of a cut message under a message deny-list and keeps the frames", () => {
    const log = longMessageError("m".repeat(1_000_000))
      .redact(["message"])
      .toLogObject();

    const stack = log.stack as string;
    expect(log.message).toBe("[REDACTED]");
    expect(stack.startsWith("IMPORT_FAILED: [REDACTED]\n")).toBe(true);
    expect(stack).toContain("\n    at ");
  });

  it("cuts a long string in details and keeps its sibling", () => {
    const details = detailsLog({ orderId: 42, payload: "x".repeat(50_000) });

    expect(details).toEqual({
      orderId: 42,
      payload: `${"x".repeat(10_000)}[40000 more characters]`,
    });
  });

  it("cuts the message of a cause", () => {
    const cause = new Error("c".repeat(20_000));

    const log = longMessageError("outer", cause).toLogObject();

    expect((log.cause as LogRecord).message).toBe(
      `${"c".repeat(10_000)}[10000 more characters]`,
    );
  });

  it("does not split a surrogate pair at the cut", () => {
    const log = longMessageError(
      `${"a".repeat(9_999)}😀${"b".repeat(100)}`,
    ).toLogObject();

    expect(log.message).toBe(`${"a".repeat(9_999)}[102 more characters]`);
  });

  it("spends at most 1 000 000 characters on the strings of one log object", () => {
    const strings = Array.from({ length: 200 }, () => "s".repeat(10_000));

    const details = detailsLog({ strings });

    const logged = details.strings as string[];
    expect(JSON.stringify(logged).length).toBeGreaterThan(900_000);
    expect(JSON.stringify(logged).length).toBeLessThan(1_010_000);
    expect(logged[logged.length - 1]).toBe("[Max log size exceeded]");
  });
});
