import { expect, it } from "vitest";
import { BaseError } from "../index.js";

it("keeps the existing empty terminal of a serialized plain cause under redaction", () => {
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
  expect(terminal(plain)).toEqual({});
  expect(terminal(redacted)).toEqual({});
});

it("keeps terminal provenance through an inner redaction copy", () => {
  let cause: unknown = { leaf: "secret" };
  for (let i = 0; i < 110; i++) cause = { cause };
  const inner = new BaseError("inner", cause).redact([]);
  let node: unknown = new BaseError("outer", inner)
    .redactAllow([])
    .toLogObject();
  while (typeof node === "object" && node !== null && "cause" in node)
    node = (node as Record<string, unknown>).cause;
  expect(node).toEqual({});
});

it("does not pass data added to a serializer terminal through redaction", () => {
  let cause: unknown = { leaf: "secret" };
  for (let i = 0; i < 110; i++) cause = { cause };
  class Mutating extends BaseError<"Mutating"> {
    protected override buildLogObject(
      buildBase?: () => Record<string, unknown>,
    ): Record<string, unknown> {
      const log = super.buildLogObject(buildBase);
      let terminal = log;
      while (typeof terminal.cause === "object" && terminal.cause !== null)
        terminal = terminal.cause as Record<string, unknown>;
      terminal.secret = "PRIVATE";
      return log;
    }
  }
  const log = new Mutating("outer", cause).redactAllow([]).toLogObject();
  expect(JSON.stringify(log)).not.toContain("PRIVATE");
  let node: unknown = log;
  while (typeof node === "object" && node !== null && "cause" in node)
    node = (node as Record<string, unknown>).cause;
  expect(node).toEqual({});
});
