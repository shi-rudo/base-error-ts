import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

type Log = Record<string, unknown>;

class Fields extends BaseError<"Fields"> {
  constructor(private readonly fields: Log) {
    super("diagnosis");
  }

  protected override buildOwnLogFields(): Log {
    return this.fields;
  }
}

function hostileFields(): Log {
  return {
    before: 1,
    get failed() {
      throw new Error("PRIVATE");
    },
    after: 2,
  };
}

describe("failed reads in copied log data", () => {
  it("marks a throwing own-field getter", () => {
    const log = new Fields(hostileFields()).toLogObject();

    expect(log).toMatchObject({
      before: 1,
      failed: "[Unserializable value]",
      after: 2,
    });
  });

  it("marks a throwing own-field getter on a cause", () => {
    const error = new BaseError("outer", new Fields(hostileFields()));

    const log = error.toLogObject();

    expect(log.cause).toMatchObject({
      before: 1,
      failed: "[Unserializable value]",
      after: 2,
    });
  });

  it("marks a throwing getter on a plain-object cause", () => {
    const log = new BaseError("outer", hostileFields()).toLogObject();

    expect(log.cause).toEqual({
      before: 1,
      failed: "[Unserializable value]",
      after: 2,
    });
  });

  it("marks a throwing getter inside native cause details", () => {
    const cause = Object.assign(new Error("inner"), {
      details: hostileFields(),
    });

    const log = new BaseError("outer", cause).toLogObject();

    expect((log.cause as Log).details).toEqual({
      before: 1,
      failed: "[Unserializable value]",
      after: 2,
    });
  });

  it("distinguishes failed reads from undefined values and array holes", () => {
    const array = new Array(3);
    array[0] = undefined;
    Object.defineProperty(array, "2", {
      get() {
        throw new Error("PRIVATE");
      },
    });
    const fields = {
      absent: undefined,
      absentConversion: { toJSON: () => undefined },
      data: {
        absent: undefined,
        get failed() {
          throw new Error("PRIVATE");
        },
      },
      array,
    };

    const log = new Fields(fields).toLogObject();

    expect(log).not.toHaveProperty("absent");
    expect(log).not.toHaveProperty("absentConversion");
    expect(log.data).toEqual({ failed: "[Unserializable value]" });
    expect(log.array).toEqual([null, null, "[Unserializable value]"]);
  });

  it("reads a failed property once without serializing its exception", () => {
    let reads = 0;
    const data = {
      get failed() {
        reads++;
        throw { secret: "PRIVATE", toJSON: () => "PRIVATE" };
      },
    };

    const log = new Fields({ data }).toJSON();

    expect(log.data).toEqual({ failed: "[Unserializable value]" });
    expect(reads).toBe(1);
    expect(JSON.stringify(log)).not.toContain("PRIVATE");
  });

  it("marks an array whose length cannot be read", () => {
    const array = new Proxy([1, 2], {
      get(target, key, receiver) {
        if (key === "length") throw new Error("PRIVATE");
        return Reflect.get(target, key, receiver);
      },
    });

    const log = new Fields({
      data: { before: 1, array, after: 2 },
    }).toLogObject();

    expect(log.data).toEqual({
      before: 1,
      array: "[Unserializable value]",
      after: 2,
    });
  });

  it("masks failed reads and failed callbacks by the same key policy", () => {
    const data = {
      get viaGetter() {
        throw new Error("PRIVATE");
      },
      viaToJSON: {
        toJSON() {
          throw new Error("PRIVATE");
        },
      },
      keep: "KEPT",
    };

    const log = new Fields({ data }).redactAllow(["keep"]).toLogObject();

    expect(log.data).toEqual({
      viaGetter: "[REDACTED]",
      viaToJSON: "[REDACTED]",
      keep: "KEPT",
    });
  });
});
