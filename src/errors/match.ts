import type { StructuredError } from "./StructuredError.js";

/**
 * Narrows a member of an error union to a single `code`: the members whose code
 * type overlaps `K`.
 *
 * When `E` is a real union of structured error types (e.g. produced by a
 * catalog), this resolves to the precise member. Then `details` is the per-code
 * type. When `E` is a single `StructuredError<"A" | "B", string>`, there is
 * nothing to narrow, so it stays `E`. `K` can be wider than a code, because a
 * branded code names every string. The type distributes over `E`, so an `E`
 * typed by a type parameter narrows through its constraint.
 */
type CaseArg<
  E extends StructuredError<string, string>,
  K extends string,
> = E extends { readonly code: infer MemberCode }
  ? K extends MemberCode
    ? E
    : MemberCode extends K
      ? E
      : never
  : never;

/**
 * The errors that reach the `_` catch-all: the members of `E` whose code is not
 * `Handled`. When `E` is a single `StructuredError<"A" | "B", string>`, there
 * is nothing to narrow, so it stays `E`, as in `CaseArg`.
 */
type CatchAllArg<
  E extends StructuredError<string, string>,
  Handled extends string,
> = Exclude<E, { code: Handled }>;

/** The handler names among the keys `Names` of a table, without `_`. */
export type HandledNames<Names extends PropertyKey> = Exclude<
  `${Extract<Names, string | number>}`,
  "_"
>;

/**
 * All handlers, each optional, plus an optional `_` catch-all. Return types are
 * left open so the concrete handler object can drive the result type.
 * `CatchAll` types the catch-all. It stays in this type, so a table of
 * misspelled names and `_` still overlaps it and is checked by name.
 */
type Cases<E extends StructuredError<string, string>, Code extends string> = {
  [K in Code]?: (error: CaseArg<E, K>) => unknown;
} & { _?: unknown };

/**
 * The optional `_` catch-all, typed with the errors whose code has no
 * handler. `Names` holds the keys of the table, and `Handled` the codes that
 * they handle. The compiler infers `Names` from the keys alone, so the type
 * of the catch-all does not depend on the handler table: a type parameter in
 * the parameter type of a handler is fixed when the handler is checked, and
 * the table must stay open until every handler is checked. A key with the value
 * `undefined` holds no handler, and its error reaches `_`, whose type excludes
 * that code. So the type of a key rejects `undefined`.
 */
export type CatchAll<
  E extends StructuredError<string, string>,
  Names extends PropertyKey,
  Handled extends string = HandledNames<Names>,
> = { readonly [N in Names]: NonNullable<unknown> } & {
  readonly _?: (error: CatchAllArg<E, Handled>) => unknown;
};

/** The union of every handler's return type. This is the result of a matcher. */
export type HandlerResult<C> = {
  [K in keyof C]: C[K] extends (...args: never[]) => infer R ? R : never;
}[keyof C];

/**
 * The own handler of `name` in a handler table. A name that collides with an
 * `Object.prototype` member (e.g. "toString", "valueOf", "hasOwnProperty")
 * must route to its explicit case or the `_` catch-all. It must never route
 * to an inherited method.
 */
export function ownCase<H>(
  cases: Readonly<Record<string, H | undefined>>,
  name: string,
): H | undefined {
  return Object.prototype.hasOwnProperty.call(cases, name)
    ? cases[name]
    : undefined;
}

type CatchAllCodeRule =
  "matchErrorCode is unavailable: the code _ is also the catch-all; rename the code";

type UnknownCodeRule<Name extends string> =
  `matchErrorCode: ${Name} is not a code of this error`;

/**
 * The names of a handler table. A numeric object key such as `404` has the
 * name `"404"`.
 */
export type HandlerNames<C> = `${Extract<keyof C, string | number>}`;

/**
 * The codes as handler names: a string enum member names its value. An `any`
 * code and an open code such as `string & { __brand }` or `string & {}` name
 * every string.
 */
type CodeNames<Code extends string> = 0 extends 1 & Code
  ? string
  : Code extends object
    ? string
    : `${Code}`;

/**
 * The names in a handler table that are neither one of `Names` nor `_`. A
 * table typed `Record<string, …>` names every string, so it has unknown names
 * for any closed set of names.
 */
export type UnknownHandlerNames<C, Names extends string> = Exclude<
  HandlerNames<C>,
  Names | "_"
>;

/**
 * True when the compiler replaced a table with the constraint. A table with no
 * property in common with the all-optional handler type fails the weak type
 * check, so the compiler falls back to the constraint for `C`. Then `C` holds
 * `_`, and `TableNames` does not, because the compiler infers `TableNames` from
 * the keys alone. Explicit type arguments leave `TableNames` empty too, so `C`
 * must also hold every key of the constraint.
 */
export type TableLostToConstraint<
  C,
  Constraint,
  TableNames extends PropertyKey,
> = "_" extends TableNames
  ? false
  : "_" extends keyof C
    ? [keyof Constraint] extends [keyof C]
      ? true
      : false
    : false;

/** The type of the handler under `Name`. The key `404` has the name `"404"`. */
type HandlerNamed<C, Name extends string> = {
  [K in Extract<keyof C, string | number>]: `${K}` extends Name ? C[K] : never;
}[Extract<keyof C, string | number>];

/**
 * The type that rejects the handler under an unknown name. A string literal
 * type makes the compiler print `Reason` in its error. `any` passes every type
 * except `never`, so a handler typed `any` gets `never`, and the compiler
 * prints only that.
 */
export type UnknownNameRule<
  C,
  Name extends string,
  Reason extends string,
> = 0 extends 1 & HandlerNamed<C, Name> ? never : Reason;

/**
 * A table with only a `_` catch-all names no code, so it needs no check. That
 * also holds for an open code that depends on a type parameter of the caller,
 * where every check of a name stays deferred.
 */
type Exhaustive<
  E extends StructuredError<string, string>,
  Code extends string,
  C,
> = "_" extends keyof C
  ? [Exclude<HandlerNames<C>, "_">] extends [never]
    ? C
    : NamedHandlerTable<E, CodeNames<Code>, C>
  : NamedHandlerTable<E, CodeNames<Code>, C>;

/**
 * Rejects a union with the code `_`, and a handler for a name outside `Names`,
 * also next to a `_` catch-all. Without a `_` catch-all, every name must have
 * a handler. Missing names are added as required, so an incomplete object
 * fails to type-check. A handler for an unknown name gets `UnknownNameRule`.
 */
type NamedHandlerTable<
  E extends StructuredError<string, string>,
  Names extends string,
  C,
> = [Extract<Names, "_">] extends [never]
  ? [UnknownHandlerNames<C, Names>] extends [never]
    ? "_" extends keyof C
      ? C
      : [Exclude<Names, HandlerNames<C>>] extends [never]
        ? C
        : C & {
            [K in Exclude<Names, HandlerNames<C>>]: (
              error: CaseArg<E, K>,
            ) => unknown;
          }
    : C & {
        [K in UnknownHandlerNames<C, Names>]: UnknownNameRule<
          C,
          K,
          UnknownCodeRule<K>
        >;
      }
  : CatchAllCodeRule;

/**
 * Rejects a table with no code among its names. Every code stays required,
 * because `C` holds no handler that `UnknownNameRule` can inspect for `any`.
 */
type TableOfUnknownCodes<
  E extends StructuredError<string, string>,
  Code extends string,
  C,
  TableNames extends PropertyKey,
> =
  TableLostToConstraint<C, Cases<E, Code>, TableNames> extends true
    ? {
        [
          K in Exclude<HandledNames<TableNames>, CodeNames<Code>>
        ]: UnknownCodeRule<K>;
      } & {
        [K in CodeNames<Code>]: (error: CaseArg<E, K>) => unknown;
      }
    : unknown;

/**
 * Exhaustively dispatch on a structured error's `code`, with type narrowing.
 *
 * Pass a handler per `code`. If `error`'s type is a closed union of structured
 * error types, an omitted handler is a **compile error** (unless you provide
 * a `_` catch-all). A handler for a code that the union does not contain is a
 * compile error too, also next to `_`. So is a handler that can be `undefined`.
 * A table typed `Record<string, …>` does not pass for a closed union. For an
 * error whose code type is a type parameter `Code extends string`, only a table
 * with a single `_` handler that does not read its parameter passes. For a
 * closed constraint on `Code`, assign the error to a variable typed with its
 * codes. A union with the code `_` cannot name a handler next to `_`, because
 * `_` is the catch-all. Each handler receives the error narrowed to its case, so `details` is the precise
 * per-code type. In a function generic over a union of classes, a handler
 * receives only `StructuredError`. The `_` catch-all receives the members of
 * the union whose code has no handler. The return type is the union of the
 * handler return types.
 *
 * Narrow an error caught as `unknown` first (e.g. with `isStructuredError`),
 * and annotate it as the expected union. The compiler cannot derive
 * exhaustiveness from `unknown`.
 *
 * @param error - The structured error to match on
 * @param cases - A handler per `code`, optionally with a `_` catch-all
 * @returns The value returned by the matching handler
 * @throws Error - When no case matches and no `_` catch-all is provided
 *   (only reachable if the static exhaustiveness check is bypassed)
 *
 * @example
 * ```ts
 * const status = matchErrorCode(err, {
 *   USER_NOT_FOUND: () => 404,
 *   EMAIL_TAKEN: () => 409,
 *   RATE_LIMITED: (e) => (e.retryable ? 429 : 503),
 * });
 * ```
 *
 * @example
 * ```ts
 * // Partial handling with a catch-all: e is every error but USER_NOT_FOUND
 * matchErrorCode(err, {
 *   USER_NOT_FOUND: () => render404(),
 *   _: (e) => renderGeneric(e.code),
 * });
 * ```
 */
export function matchErrorCode<
  E extends StructuredError<string, string>,
  const C extends Cases<E, Code>,
  // The compiler infers `Code` from the apparent type of the error. For an
  // error typed by a type parameter, `E["code"]` would defer every check of
  // the table, and the call would accept no table.
  Code extends string = E["code"],
  Names extends PropertyKey = never,
>(
  // For a union of codes that are not literal types, such as `"A" & Brand`,
  // the compiler infers `Code` from one member only. The union with `E`
  // keeps the error assignable then; `E & { code }` is only the inference
  // site of `Code`.
  error: E | (E & { readonly code: Code }),
  cases: Exhaustive<E, Code, C> &
    CatchAll<E, Names> &
    TableOfUnknownCodes<E, Code, C, Names>,
): HandlerResult<C> {
  const table = cases as Record<string, ((error: E) => unknown) | undefined>;
  const handler = ownCase(table, error.code) ?? table._;

  if (!handler) {
    throw new Error(
      `matchErrorCode: unhandled error code "${error.code}" (no matching case and no "_" catch-all)`,
    );
  }

  return handler(error) as HandlerResult<C>;
}
