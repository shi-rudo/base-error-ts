import { afterEach, describe, expect, it } from "vitest";
import {
  BaseError as LibraryBaseError,
  defineErrors,
  StructuredError,
  toStructuredError,
} from "../index.js";

function stackLinesOf(error: Error): string[] {
  return String(error.stack).split("\n");
}

class BaseErrorMapper {
  readonly error: StructuredError<string, string>;

  constructor() {
    this.error = new StructuredError({
      code: "MAPPING_FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "no mapping",
    });
  }
}

// A consumer can have its own class with the name of the library class.
class BaseError {
  readonly error: LibraryBaseError<string>;

  constructor() {
    this.error = new LibraryBaseError("no mapping");
  }
}

function callerOfTheConstructor() {
  return new LibraryBaseError("no mapping");
}

describe("the stack of an error on an engine with captureStackTrace", () => {
  it("starts at the frame of a consumer constructor whose name starts with BaseError", () => {
    const [, firstFrame] = stackLinesOf(new BaseErrorMapper().error);

    expect(firstFrame).toContain("new BaseErrorMapper");
  });

  it("starts at the frame of a consumer class that has the name of the library class", () => {
    const [, firstFrame] = stackLinesOf(new BaseError().error);

    expect(firstFrame).toContain("new BaseError");
  });

  it.each([
    "#installLazyStack",
    "installLazyStack_fn",
    "BaseError.constructor",
    "new BaseError",
  ])("starts at the frame of a consumer function named %s", (name) => {
    const consumerFunction = {
      [name]: () => new LibraryBaseError("no mapping"),
    }[name] as () => Error;

    expect(stackLinesOf(consumerFunction())[1]).toContain(name);
  });

  it("keeps the frame of a constructor that converts the message into a nested error", () => {
    let nested: Error | undefined;
    function conversionOfTheMessage() {
      nested = new LibraryBaseError("nested");
      return "converted";
    }

    new LibraryBaseError({
      toString: conversionOfTheMessage,
    } as unknown as string);

    const frames = stackLinesOf(nested as Error).slice(1);

    expect(frames[0]).toContain("conversionOfTheMessage");
    expect(frames.join("\n")).toContain("new BaseError");
  });
});

describe("the stack of an error on an engine without captureStackTrace", () => {
  const captureStackTrace = Object.getOwnPropertyDescriptor(
    Error,
    "captureStackTrace",
  );
  const originalPrepareStackTrace = Error.prepareStackTrace;

  afterEach(() => {
    Error.prepareStackTrace = originalPrepareStackTrace;
  });

  function withoutCaptureStackTrace<T>(create: () => T): T {
    delete (Error as unknown as Record<string, unknown>).captureStackTrace;
    try {
      return create();
    } finally {
      if (captureStackTrace) {
        Object.defineProperty(Error, "captureStackTrace", captureStackTrace);
      }
    }
  }

  const atFormat: typeof Error.prepareStackTrace = (_error, frames) =>
    frames.map((frame) => `    at ${frame.getFunctionName()}`).join("\n");
  const atSignFormat: typeof Error.prepareStackTrace = (_error, frames) =>
    `${frames.map((frame) => `${frame.getFunctionName()}@a.js:1:1`).join("\n")}\n`;

  it("starts at the caller of the constructor in the default format", () => {
    const error = withoutCaptureStackTrace(callerOfTheConstructor);

    const [header, firstFrame] = stackLinesOf(error);

    expect(header).toBe("BaseError: no mapping");
    expect(firstFrame).toContain("callerOfTheConstructor");
  });

  it.each([
    ["the at format", atFormat],
    ["the fn@file format", atSignFormat],
  ])("starts at the caller of the constructor in %s", (_name, format) => {
    Error.prepareStackTrace = format;
    const error = withoutCaptureStackTrace(callerOfTheConstructor);

    const lines = stackLinesOf(error);

    expect(lines[0]).toBe("BaseError: no mapping");
    expect(lines[1]).toContain("callerOfTheConstructor");
  });

  it("drops the empty line at the end of the fn@file format", () => {
    Error.prepareStackTrace = atSignFormat;
    const error = withoutCaptureStackTrace(callerOfTheConstructor);

    expect(stackLinesOf(error)).not.toContain("");
  });

  it("keeps the frame of a consumer constructor whose name starts with BaseError", () => {
    const { error } = withoutCaptureStackTrace(() => new BaseErrorMapper());

    expect(stackLinesOf(error).join("\n")).toContain("new BaseErrorMapper");
  });

  it("starts at the frame of a consumer class that has the name of the library class", () => {
    const { error } = withoutCaptureStackTrace(() => new BaseError());

    expect(stackLinesOf(error)[1]).toContain("new BaseError");
  });
});

describe("the consumer frames of an error", () => {
  type CreateError = () => Error;

  const Errors = defineErrors({
    MAPPING_FAILED: { category: "INTERNAL", retryable: false },
  });
  const STRUCTURED_FIELDS = {
    code: "MAPPING_FAILED",
    category: "INTERNAL",
    retryable: false,
    message: "no mapping",
  };
  class SubclassWithDefaultConstructor extends LibraryBaseError<string> {}
  class SubclassWithOwnConstructor extends LibraryBaseError<string> {
    readonly extra: number;

    constructor(message: string) {
      super(message);
      this.extra = 1;
    }
  }

  function consumerInner(create: CreateError) {
    return create();
  }
  function consumerOuter(create: CreateError) {
    return consumerInner(create);
  }
  class ConsumerService {
    readonly error: Error;

    constructor(create: CreateError) {
      this.error = create();
    }
  }
  function consumerThrower(create: CreateError): never {
    throw create();
  }
  function consumerCatcher(create: CreateError) {
    try {
      return consumerThrower(create);
    } catch (error) {
      return error as Error;
    }
  }
  async function consumerAsyncInner(create: CreateError) {
    await null;
    return create();
  }
  async function consumerAsyncOuter(create: CreateError) {
    const error = await consumerAsyncInner(create);
    return error;
  }
  function consumerCallback(create: CreateError) {
    return [0].map(function consumerHandler() {
      return create();
    })[0] as Error;
  }

  // Each function has the same name, so the comparison also holds the top frame:
  // the function that creates the error.
  const ways: ReadonlyArray<readonly [string, CreateError]> = [
    [
      "new BaseError",
      function consumerCreate() {
        return new LibraryBaseError("m");
      },
    ],
    [
      "new StructuredError",
      function consumerCreate() {
        return new StructuredError(STRUCTURED_FIELDS);
      },
    ],
    [
      "a default constructor",
      function consumerCreate() {
        return new SubclassWithDefaultConstructor("m");
      },
    ],
    [
      "an own constructor",
      function consumerCreate() {
        return new SubclassWithOwnConstructor("m");
      },
    ],
    [
      "a catalog factory",
      function consumerCreate() {
        return Errors.create.MAPPING_FAILED("m");
      },
    ],
    [
      "toStructuredError on a string",
      function consumerCreate() {
        return toStructuredError("m");
      },
    ],
    [
      "toStructuredError on an error",
      function consumerCreate() {
        return toStructuredError(new Error("m"));
      },
    ],
    [
      "Reflect.construct with an unrelated class",
      function consumerCreate() {
        return Reflect.construct(LibraryBaseError, ["m"], Object) as Error;
      },
    ],
    [
      "a proxied class",
      function consumerCreate() {
        return new new Proxy(SubclassWithDefaultConstructor, {})("m");
      },
    ],
  ];
  const callPatterns: ReadonlyArray<
    readonly [string, (create: CreateError) => Error | Promise<Error>]
  > = [
    ["a call chain", consumerOuter],
    ["a consumer constructor", (create) => new ConsumerService(create).error],
    ["a throw and a catch", consumerCatcher],
    ["an await chain", consumerAsyncOuter],
    ["an array callback", consumerCallback],
  ];
  const stackFormats: ReadonlyArray<
    readonly [string, typeof Error.prepareStackTrace]
  > = [
    ["the default format", Error.prepareStackTrace],
    ["the call site format", (_error, frames) => frames.join("\n")],
    [
      "the function name format",
      (_error, frames) =>
        frames.map((frame) => frame.getFunctionName()).join("\n"),
    ],
    [
      "the fn@file format",
      (_error, frames) =>
        frames.map((frame) => `${frame.getFunctionName()}@a.js:1:1`).join("\n"),
    ],
  ];

  async function framesIn(
    format: typeof Error.prepareStackTrace,
    run: () => Error | Promise<Error>,
  ): Promise<string[]> {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = format;
    try {
      const error = await run();
      return String(error.stack)
        .split("\n")
        .flatMap((line) => line.match(/\b(?:new )?consumer\w*/i)?.[0] ?? []);
    } finally {
      Error.prepareStackTrace = original;
    }
  }

  it.each(
    ways.flatMap(([way, create]) =>
      callPatterns.flatMap(([callPattern, run]) =>
        stackFormats.map(
          ([formatName, format]) =>
            [way, callPattern, formatName, create, run, format] as const,
        ),
      ),
    ),
  )(
    "%s keeps every consumer frame of new Error in %s, in %s",
    async (_way, _callPattern, _formatName, create, run, format) => {
      const baseline = await framesIn(format, () =>
        run(function consumerCreate() {
          return new Error("m");
        }),
      );

      const frames = await framesIn(format, () => run(create));

      expect(baseline[0]).toBe("consumerCreate");
      expect(frames).toEqual(baseline);
    },
  );
});

describe("the stack of an error whose class constructor did not run", () => {
  class UnrelatedClass {}
  class OtherClass {}
  class SubclassWithOverwrittenConstructor extends LibraryBaseError<string> {}
  Object.defineProperty(
    SubclassWithOverwrittenConstructor.prototype,
    "constructor",
    { value: OtherClass },
  );
  class SubclassBehindProxy extends LibraryBaseError<string> {}
  const ProxiedSubclass = new Proxy(SubclassBehindProxy, {});
  class StructuredSubclassBehindProxy extends StructuredError<string, string> {}
  const ProxiedStructuredSubclass = new Proxy(
    StructuredSubclassBehindProxy,
    {},
  );
  const STRUCTURED_FIELDS = {
    code: "MAPPING_FAILED",
    category: "INTERNAL",
    retryable: false,
    message: "no mapping",
  };

  it.each<readonly [string, () => Error]>([
    [
      "Reflect.construct with an unrelated class",
      () => Reflect.construct(LibraryBaseError, ["m"], UnrelatedClass) as Error,
    ],
    [
      "Reflect.construct of a subclass with an unrelated class",
      () =>
        Reflect.construct(
          StructuredError,
          [STRUCTURED_FIELDS],
          UnrelatedClass,
        ) as Error,
    ],
    [
      "an overwritten prototype constructor",
      () => new SubclassWithOverwrittenConstructor("m"),
    ],
    ["a proxied class", () => new ProxiedSubclass("m")],
  ])("holds the caller after %s", (_name, create) => {
    function callerOfTheCreation() {
      return create();
    }

    const error = callerOfTheCreation();

    expect(String(error.stack)).toContain("callerOfTheCreation");
  });

  it("starts at the caller of a proxied subclass of BaseError", () => {
    function callerOfTheProxiedClass() {
      return new ProxiedSubclass("m");
    }

    const error = callerOfTheProxiedClass();

    expect(String(error.stack).split("\n")[1]).toContain(
      "callerOfTheProxiedClass",
    );
  });

  it("starts at the caller of a proxied subclass of StructuredError", () => {
    function callerOfTheProxiedClass() {
      return new ProxiedStructuredSubclass(STRUCTURED_FIELDS);
    }

    const error = callerOfTheProxiedClass();

    expect(String(error.stack).split("\n")[1]).toContain(
      "callerOfTheProxiedClass",
    );
  });

  it("leaves out the frame of the BaseError constructor after Reflect.construct", () => {
    const error = Reflect.construct(
      LibraryBaseError,
      ["m"],
      UnrelatedClass,
    ) as Error;

    expect(String(error.stack)).not.toContain("new BaseError");
    expect(String(error.stack)).not.toContain("installLazyStack");
  });
});
