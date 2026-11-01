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
