import { expect, it } from "vitest";
import { BaseError } from "../index.js";

const CAUSE_DEPTH_MARKER = "[Max cause depth exceeded]";

it("ends a plain cause chain with the cause depth marker with and without redaction", () => {
  let cause: unknown = { leaf: "secret" };
  for (let i = 0; i < 110; i++) cause = { cause };
  const plain = new BaseError("outer", cause).toLogObject();
  const redacted = new BaseError("outer", cause).redactAllow([]).toLogObject();
  function terminal(value: unknown): unknown {
    let node = value as Record<string, unknown>;
    while (typeof node === "object" && node !== null && "cause" in node)
      node = node.cause as Record<string, unknown>;
    return node;
  }
  expect(terminal(plain)).toBe(CAUSE_DEPTH_MARKER);
  expect(terminal(redacted)).toBe(CAUSE_DEPTH_MARKER);
});

it("keeps the cause depth marker through an inner redaction copy", () => {
  let cause: unknown = { leaf: "secret" };
  for (let i = 0; i < 110; i++) cause = { cause };
  const inner = new BaseError("inner", cause).redact([]);
  let node: unknown = new BaseError("outer", inner)
    .redactAllow([])
    .toLogObject();
  while (typeof node === "object" && node !== null && "cause" in node)
    node = (node as Record<string, unknown>).cause;
  expect(node).toBe(CAUSE_DEPTH_MARKER);
});

it("masks data that a policy adds at the cut of a cause chain", () => {
  let cause: unknown = { leaf: "secret" };
  for (let i = 0; i < 110; i++) cause = { cause };
  const inner = new BaseError("inner", cause).redactWith((log) => {
    let terminal = log;
    while (typeof terminal.cause === "object" && terminal.cause !== null)
      terminal = terminal.cause as Record<string, unknown>;
    terminal.secret = "PRIVATE";
    return log;
  });
  const log = new BaseError("outer", inner).redactAllow([]).toLogObject();
  expect(JSON.stringify(log)).not.toContain("PRIVATE");
  let node: unknown = log;
  while (typeof node === "object" && node !== null && "cause" in node)
    node = (node as Record<string, unknown>).cause;
  expect(node).toBe(CAUSE_DEPTH_MARKER);
});
