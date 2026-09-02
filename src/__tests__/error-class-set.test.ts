import { describe, expect, it } from "vitest";
import { hostileProxy, revokedProxy } from "./hostile-values.fixture.js";

import { defineErrorClassSet } from "../index.js";

class FileError extends Error {
  constructor(readonly path: string) {
    super(`Missing file: ${path}`);
  }
}

class DatabaseError extends Error {
  constructor(readonly query: string) {
    super(`Failed query: ${query}`);
  }
}

class NetworkError extends Error {}
class TimeoutError extends NetworkError {}

const InfrastructureErrors = defineErrorClassSet({
  file: FileError,
  database: DatabaseError,
});

describe("defineErrorClassSet", () => {
  it("dispatches to the handler for the matching class", () => {
    const handle = (error: unknown) =>
      InfrastructureErrors.match(error, {
        file: (matched) => `file:${matched.path}`,
        database: (matched) => `database:${matched.query}`,
      });

    expect(handle(new FileError("config.json"))).toBe("file:config.json");
    expect(handle(new DatabaseError("SELECT 1"))).toBe("database:SELECT 1");
  });

  it("throws when a value is outside the declared class set", () => {
    expect(() =>
      InfrastructureErrors.match("not-an-error", {
        file: () => "file",
        database: () => "database",
      }),
    ).toThrow(/outside the declared error class set/);
  });

  it("rejects an empty class definition", () => {
    expect(() => {
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrorClassSet({});
    }).toThrow(/must not be empty/);
  });

  it("rejects symbol keys at runtime", () => {
    expect(() => {
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrorClassSet({ [Symbol("file")]: FileError });
    }).toThrow(/keys must be strings/);
  });

  it("rejects numeric-looking keys that would reorder matching", () => {
    expect(() => {
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrorClassSet({ "10": TimeoutError, "2": NetworkError });
    }).toThrow(/keys must not be numeric/);
  });

  it("rejects empty and whitespace-only keys", () => {
    expect(() =>
      defineErrorClassSet({ "": FileError, database: DatabaseError }),
    ).toThrow(/keys must not be empty/);
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrorClassSet({ "  ": FileError, database: DatabaseError }),
    ).toThrow(/keys must not be empty/);
  });

  it("rejects a base class listed before its subclass (unreachable handler)", () => {
    expect(() =>
      defineErrorClassSet({
        network: NetworkError,
        timeout: TimeoutError, // instanceof NetworkError → never reached
      }),
    ).toThrow(/"timeout" extends "network"/);
  });

  it("accepts a subclass listed before its base class and dispatches precisely", () => {
    const errors = defineErrorClassSet({
      timeout: TimeoutError,
      network: NetworkError,
    });

    expect(
      errors.match(new TimeoutError(), {
        timeout: () => "timeout",
        network: () => "network",
      }),
    ).toBe("timeout");
    expect(
      errors.match(new NetworkError(), {
        timeout: () => "timeout",
        network: () => "network",
      }),
    ).toBe("network");
  });

  it("rejects duplicate constructor identities", () => {
    expect(() =>
      defineErrorClassSet({
        first: FileError,
        duplicate: FileError,
      }),
    ).toThrow(/constructors must be unique/);
  });

  it("snapshots its definition and freezes the returned set", () => {
    const classes: {
      file: typeof FileError | typeof DatabaseError;
      database: typeof DatabaseError;
    } = {
      file: FileError,
      database: DatabaseError,
    };
    const errors = defineErrorClassSet(classes);
    classes.file = DatabaseError;

    expect(Object.isFrozen(errors)).toBe(true);
    expect(
      errors.match(new FileError("config.json"), {
        file: () => "file",
        database: () => "database",
      }),
    ).toBe("file");
  });
});

describe("defineErrorClassSet().match against a value that cannot be inspected", () => {
  const handlers = {
    file: () => "file",
    database: () => "database",
  };

  it("reports a revoked Proxy as outside the set instead of throwing the Proxy error", () => {
    const set = defineErrorClassSet({
      file: FileError,
      database: DatabaseError,
    });

    expect(() => set.match(revokedProxy(), handlers)).toThrow(
      "value is outside the declared error class set",
    );
  });

  it("reports a Proxy whose getPrototypeOf trap throws as outside the set", () => {
    const set = defineErrorClassSet({
      file: FileError,
      database: DatabaseError,
    });

    expect(() => set.match(hostileProxy(["getPrototypeOf"]), handlers)).toThrow(
      "value is outside the declared error class set",
    );
  });
});
