import {
  defineErrorClassSet,
  type ErrorClassMap,
  type ErrorClassSet,
} from "../index.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Assert<T extends true> = T;

class FileError extends Error {
  readonly path = "config.json";
}

class DatabaseError extends Error {
  readonly query = "SELECT 1";
}

class StructurallyIdenticalA extends Error {}
class StructurallyIdenticalB extends Error {}

declare const caught: unknown;

// @ts-expect-error an Error class set must not be empty
defineErrorClassSet({});

const symbolKey = Symbol("symbol-key");
// @ts-expect-error Error class set keys must be strings
defineErrorClassSet({ [symbolKey]: FileError });

// @ts-expect-error Error class set keys must be strings
defineErrorClassSet({ 0: FileError });

// @ts-expect-error numeric-looking string keys cannot preserve definition order
defineErrorClassSet({ "10": FileError, "2": DatabaseError });

declare const widenedClasses: ErrorClassMap;
// @ts-expect-error widened maps lose the finite key set required for exhaustiveness
defineErrorClassSet(widenedClasses);

const reusableClasses = {
  file: FileError,
  database: DatabaseError,
} satisfies ErrorClassMap;
defineErrorClassSet(reusableClasses);

const InfrastructureErrors = defineErrorClassSet({
  file: FileError,
  database: DatabaseError,
});

const typedSet: ErrorClassSet<{
  readonly file: typeof FileError;
  readonly database: typeof DatabaseError;
}> = InfrastructureErrors;
void typedSet;

const result = InfrastructureErrors.match(caught, {
  file: (error) => {
    const path: string = error.path;
    void path;
    // @ts-expect-error file handlers receive only FileError
    const query = error.query;
    void query;
    return "file" as const;
  },
  database: (error) => {
    const query: string = error.query;
    void query;
    // @ts-expect-error database handlers receive only DatabaseError
    const path = error.path;
    void path;
    return 503 as const;
  },
});

const exactResult: "file" | 503 = result;
type ResultIsNotAny = Assert<IsAny<typeof result> extends false ? true : false>;
void exactResult;
void (null as unknown as ResultIsNotAny);

const StructurallyIdenticalErrors = defineErrorClassSet({
  first: StructurallyIdenticalA,
  second: StructurallyIdenticalB,
});

class NotAnError {}
// @ts-expect-error Error class sets accept only Error constructors
defineErrorClassSet({ invalid: NotAnError });

// @ts-expect-error every declared class key requires a handler
StructurallyIdenticalErrors.match(caught, {
  first: () => "first",
});

InfrastructureErrors.match(caught, {
  file: () => "file",
  database: () => "database",
  // @ts-expect-error undeclared handler keys are rejected
  network: () => "network",
});
