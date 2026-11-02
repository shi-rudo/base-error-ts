import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

import { errorWithRawDetails, rawDetailsOf } from "./raw-log-data.fixture.js";

type Log = Record<string, unknown>;
type Mode = "none" | "deny" | "allow";

const DATA_DEPTH_MARKER = "[Max data depth exceeded]";

/** The depth cut as a policy leaves it: an allow-list masks the marker as data. */
function cutUnder(mode: Mode): string {
  return mode === "allow" ? "[REDACTED]" : DATA_DEPTH_MARKER;
}

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

/** The last container on the path that `endOf` follows. */
function lastContainerOf(value: unknown): Log | unknown[] {
  let container = value as Log | unknown[];
  for (;;) {
    const next = Array.isArray(container) ? container[0] : container.nest;
    if (typeof next !== "object" || next === null) return container;
    container = next as Log | unknown[];
  }
}

function apply(error: BaseError<string>, mode: Mode): BaseError<string> {
  if (mode === "deny") return error.redact([]);
  if (mode === "allow") return error.redactAllow([]);
  return error;
}

const routes = [
  {
    name: "root details",
    build: (data: unknown): BaseError<string> =>
      new StructuredError({
        code: "DEEP",
        category: "TEST",
        retryable: false,
        message: "root details",
        details: data as Log,
      }),
    read: (log: Log): unknown => log.details,
  },
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
    "retains 100 object edges and then the depth cut under %s policy",
    (mode) => {
      const error = apply(build(objects(130)), mode);

      const data = read(error.toLogObject());

      expect(endOf(data)).toEqual({ edges: 100, terminal: cutUnder(mode) });
    },
  );

  it.each<Mode>(["none", "deny", "allow"])(
    "retains 100 array edges and then the depth cut under %s policy",
    (mode) => {
      const error = apply(build(arrays(130)), mode);

      const data = read(error.toLogObject());

      expect(endOf(data)).toEqual({ edges: 100, terminal: cutUnder(mode) });
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

describe("the details of a custom cause policy keep the data depth bound", () => {
  it.each<Mode>(["deny", "allow"])(
    "cuts the details at 100 edges under %s policy",
    (mode) => {
      const error = apply(errorWithRawDetails(objects(130)), mode);

      const data = rawDetailsOf(error.toLogObject());

      expect(endOf(data)).toEqual({ edges: 100, terminal: cutUnder(mode) });
    },
  );

  it("does not read descendants beyond the depth bound of the details", () => {
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
    const error = errorWithRawDetails(data).redact([]);

    const result = rawDetailsOf(error.toLogObject());

    expect(endOf(result)).toEqual({
      edges: 100,
      terminal: DATA_DEPTH_MARKER,
    });
    expect(reads).toBe(100);
  });
});

describe("serializer data cuts through successive policies", () => {
  it.each(["deny", "allow"] as const)(
    "masks the depth cut after an inner %s policy and an outer allow policy",
    (mode) => {
      const inner = apply(new DataError(objects(130)), mode);
      const error = new BaseError("outer", inner).redactAllow([]);

      const log = error.toLogObject();

      expect(endOf((log.cause as Log).data)).toEqual({
        edges: 100,
        terminal: "[REDACTED]",
      });
    },
  );

  it.each(["object", "array"])(
    "masks data that a policy writes in place of the depth cut of an %s",
    (shape) => {
      const inner = new DataError(
        shape === "object" ? objects(130) : arrays(130),
      ).redact([]);
      let replaced: unknown;
      const middle = new BaseError("middle", inner).redactWith((log) => {
        const container = lastContainerOf((log.cause as Log).data);
        if (Array.isArray(container)) {
          replaced = container[0];
          container[0] = "INSERTED-PRIVATE";
        } else {
          replaced = container.nest;
          container.nest = "INSERTED-PRIVATE";
        }
        return log;
      });
      const error = new BaseError("outer", middle).redactAllow([]);

      const log = error.toLogObject();

      expect(replaced).toBe(DATA_DEPTH_MARKER);
      const data = ((log.cause as Log).cause as Log).data;
      expect(endOf(data)).toEqual({ edges: 100, terminal: "[REDACTED]" });
      expect(JSON.stringify(log)).not.toContain("INSERTED-PRIVATE");
    },
  );
});
