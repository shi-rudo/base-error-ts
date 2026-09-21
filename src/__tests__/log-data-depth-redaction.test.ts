import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;
type Mode = "none" | "deny" | "allow";

class DataError extends BaseError<"DataError"> {
  constructor(private readonly data: unknown) {
    super("data error");
  }

  protected override buildOwnLogFields(): Log {
    return { data: this.data };
  }
}

function objects(edges: number, leaf: Log = { secret: "PRIVATE" }): Log {
  let value = leaf;
  for (let index = 0; index < edges; index++) value = { nest: value };
  return value;
}

function arrays(edges: number): unknown[] {
  let value: unknown[] = ["PRIVATE"];
  for (let index = 0; index < edges; index++) value = [value];
  return value;
}

// Measure the returned public value without importing a production depth helper.
function endOf(value: unknown): { edges: number; terminal: unknown } {
  let edges = 0;
  let terminal = value;
  while (typeof terminal === "object" && terminal !== null) {
    if (Array.isArray(terminal)) {
      if (terminal.length === 0) break;
      terminal = terminal[0];
    } else {
      if (!Object.prototype.hasOwnProperty.call(terminal, "nest")) break;
      terminal = (terminal as Log).nest;
    }
    edges++;
  }
  return { edges, terminal };
}

function apply(error: BaseError<string>, mode: Mode): BaseError<string> {
  if (mode === "deny") return error.redact([]);
  if (mode === "allow") return error.redactAllow([]);
  return error;
}

const routes = [
  {
    name: "own hook field at root",
    build: (data: unknown): BaseError<string> => new DataError(data),
    read: (log: Log): unknown => log.data,
  },
  {
    name: "own hook field at cause",
    build: (data: unknown): BaseError<string> =>
      new BaseError("outer", new DataError(data)),
    read: (log: Log): unknown => (log.cause as Log).data,
  },
  {
    name: "native Error cause details",
    build: (data: unknown): BaseError<string> =>
      new BaseError(
        "outer",
        Object.assign(new Error("inner"), { details: data }),
      ),
    read: (log: Log): unknown => (log.cause as Log).details,
  },
  {
    name: "plain-object cause data",
    build: (data: unknown): BaseError<string> =>
      new BaseError("outer", { data }),
    read: (log: Log): unknown => (log.cause as Log).data,
  },
];

describe.each(routes)("copied data depth: $name", ({ build, read }) => {
  it.each<Mode>(["none", "deny", "allow"])(
    "retains 100 object edges with an empty serializer cut under %s policy",
    (mode) => {
      const error = apply(build(objects(130)), mode);

      const data = read(error.toLogObject());

      expect(endOf(data)).toEqual({ edges: 100, terminal: {} });
    },
  );

  it.each<Mode>(["none", "deny", "allow"])(
    "retains 100 array edges with an empty serializer cut under %s policy",
    (mode) => {
      const error = apply(build(arrays(130)), mode);

      const data = read(error.toLogObject());

      expect(endOf(data)).toEqual({ edges: 100, terminal: [] });
    },
  );

  it.each(["deny", "allow"])(
    "masks a secret on the last retained object under %s policy",
    (mode) => {
      const error = build(objects(99));
      if (mode === "deny") error.redact(["secret"]);
      else error.redactAllow([]);

      const data = read(error.toLogObject());

      expect(endOf(data)).toEqual({
        edges: 99,
        terminal: { secret: "[REDACTED]" },
      });
    },
  );
});

describe("raw root details keep the redaction depth bound", () => {
  it.each<Mode>(["deny", "allow"])(
    "cuts unprocessed root details at 100 edges under %s policy",
    (mode) => {
      const error = apply(
        new StructuredError({
          code: "DEEP",
          category: "TEST",
          retryable: false,
          message: "raw details",
          details: objects(130),
        }),
        mode,
      );

      const data = error.toLogObject().details;

      expect(endOf(data)).toEqual({
        edges: 100,
        terminal: "[Max redaction depth exceeded]",
      });
    },
  );

  it("does not read descendants beyond the raw details depth bound", () => {
    let reads = 0;
    let data: Log = { secret: "PRIVATE" };
    for (let index = 0; index < 130; index++) {
      const next = data;
      data = {
        get nest() {
          reads++;
          return next;
        },
      };
    }
    const error = new StructuredError({
      code: "DEEP",
      category: "TEST",
      retryable: false,
      message: "raw details",
      details: data,
    }).redact([]);

    const result = error.toLogObject().details;

    expect(endOf(result)).toEqual({
      edges: 100,
      terminal: "[Max redaction depth exceeded]",
    });
    expect(reads).toBe(100);
  });
});

describe("serializer data cuts through successive policies", () => {
  it.each(["deny", "allow"] as const)(
    "keeps the empty object cut after an inner %s policy and outer allow policy",
    (mode) => {
      const inner = apply(new DataError(objects(130)), mode);
      const error = new BaseError("outer", inner).redactAllow([]);

      const log = error.toLogObject();

      expect(endOf((log.cause as Log).data)).toEqual({
        edges: 100,
        terminal: {},
      });
    },
  );

  it.each(["object", "array"])(
    "does not expose data inserted into a serializer %s terminal after an inner policy",
    (shape) => {
      const inner = new DataError(
        shape === "object" ? objects(130) : arrays(130),
      ).redact([]);
      let inserted = false;
      const middle = new BaseError("middle", inner).redactWith((log) => {
        const { terminal } = endOf((log.cause as Log).data);
        if (Array.isArray(terminal)) {
          terminal.push("INSERTED-PRIVATE");
          inserted = true;
        } else if (typeof terminal === "object" && terminal !== null) {
          (terminal as Log).secret = "INSERTED-PRIVATE";
          inserted = true;
        }
        return log;
      });
      const error = new BaseError("outer", middle).redactAllow([]);

      const log = error.toLogObject();

      expect(inserted).toBe(true);
      const data = ((log.cause as Log).cause as Log).data;
      expect(endOf(data)).toEqual({
        edges: 100,
        terminal: shape === "object" ? {} : [],
      });
      expect(JSON.stringify(log)).not.toContain("INSERTED-PRIVATE");
    },
  );
});
