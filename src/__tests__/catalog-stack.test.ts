import { describe, expect, it } from "vitest";
import { defineErrors, StructuredError } from "../index.js";

const Errors = defineErrors({
  USER_NOT_FOUND: { category: "NOT_FOUND", retryable: false },
});

function callerOfTheFactory() {
  return Errors.create.USER_NOT_FOUND("no user");
}

function stackLinesOf(error: Error): string[] {
  return String(error.stack).split("\n");
}

describe("the stack of a catalog error", () => {
  it("starts at the caller of the factory, below the header", () => {
    const [header, firstFrame] = stackLinesOf(callerOfTheFactory());

    expect(header).toBe("USER_NOT_FOUND: no user");
    expect(firstFrame).toContain("callerOfTheFactory");
  });

  it("holds only the header when the stack trace limit leaves only the factory frame", () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 1;
    let error: Error;
    try {
      error = callerOfTheFactory();
    } finally {
      Error.stackTraceLimit = limit;
    }

    expect(stackLinesOf(error)).toEqual(["USER_NOT_FOUND: no user"]);
  });

  it("removes no second line from a stack in another format", () => {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = () => "first@a.js:1:1\nsecond@b.js:2:2";
    try {
      const lines = stackLinesOf(callerOfTheFactory());

      expect(lines).toEqual(["USER_NOT_FOUND: no user", "second@b.js:2:2"]);
    } finally {
      Error.prepareStackTrace = original;
    }
  });

  it("leaves the first frame of a directly constructed error", () => {
    function callerOfTheConstructor() {
      return new StructuredError({
        code: "USER_NOT_FOUND",
        category: "NOT_FOUND",
        retryable: false,
        message: "no user",
      });
    }

    const [, firstFrame] = stackLinesOf(callerOfTheConstructor());

    expect(firstFrame).toContain("callerOfTheConstructor");
  });

  it("does not format the stack until the first read", () => {
    let formats = 0;
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = (error, frames) => {
      formats += 1;
      return original
        ? original(error, frames)
        : `${String(error)}\n${frames.map((frame) => `    at ${String(frame)}`).join("\n")}`;
    };
    try {
      const error = callerOfTheFactory();
      const formatsBeforeRead = formats;

      void error.stack;

      expect(formatsBeforeRead).toBe(0);
      expect(formats).toBe(1);
    } finally {
      Error.prepareStackTrace = original;
    }
  });

  it("reads as a stack with the caller on an engine without captureStackTrace", () => {
    const original = Error.captureStackTrace;
    delete (Error as unknown as Record<string, unknown>).captureStackTrace;
    let error: Error;
    try {
      error = callerOfTheFactory();
    } finally {
      Error.captureStackTrace = original;
    }

    const lines = stackLinesOf(error);

    expect(lines[0]).toBe("USER_NOT_FOUND: no user");
    expect(lines.join("\n")).toContain("callerOfTheFactory");
  });
});
