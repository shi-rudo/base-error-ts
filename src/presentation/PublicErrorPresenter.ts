import type { LocalizedMessageSet } from "./LocalizedMessageSet.js";
import { resolveUserMessage } from "./LocaleResolver.js";
import type { PublicErrorRegistry } from "./PublicErrorRegistry.js";

/**
 * The transport-neutral public representation of an error. Carries public
 * meaning only; a status, header, or exit code is a transport adapter's job.
 * `details` is populated only by an explicit `projectDetails`, never by
 * spreading the raw error.
 */
export type PublicErrorView<TDetails = never> = {
  code: string;
  message: string;
  locale: string;
  details?: TDetails;
};

/**
 * What `present` did, for fire-and-forget telemetry. A matched outcome always
 * records how the details projection went. A broken projection is a matched
 * outcome with `projection: "failed"`, not a fallback.
 */
export type PresentationOutcome =
  | {
      kind: "matched";
      via: "code" | "predicate";
      publicCode: string;
      projection: "not_configured" | "succeeded" | "failed";
      /**
       * Present only when a predicate matcher threw before this match was
       * found. The match is still correct; this surfaces the broken matcher for
       * telemetry (a fallback is reported as `matcher_failed` instead).
       */
      matcherThrew?: true;
    }
  | { kind: "fallback"; reason: "no_definition" | "matcher_failed" };

/** Per-call context for {@link PublicErrorPresenter.present}. */
export type PublicPresentationContext = {
  /** Ordered locale preferences (already parsed; `Accept-Language` is the adapter's job). */
  locales?: readonly string[];
};

/** Construction options for {@link PublicErrorPresenter}. */
export type PublicErrorPresenterOptions = {
  registry: PublicErrorRegistry;
  /** Generic fallback for unmapped errors. Its messages follow the usual invariants. */
  fallback: { publicCode: string; userMessages: LocalizedMessageSet };
  /**
   * Fire-and-forget observer, invoked synchronously exactly once per `present`.
   * If it throws, the presenter swallows it: telemetry must never break totality.
   */
  onPresent?: (
    error: unknown,
    view: PublicErrorView<unknown>,
    outcome: PresentationOutcome,
  ) => void;
};

/**
 * Turns an unknown technical error into a safe, localized {@link PublicErrorView}.
 * Total over `unknown`: every input yields a view, an unmapped error degrading
 * to a localized generic fallback rather than leaking or throwing. The public
 * path never reaches for the technical message.
 */
export class PublicErrorPresenter {
  readonly #registry: PublicErrorRegistry;
  readonly #fallback: { publicCode: string; userMessages: LocalizedMessageSet };
  readonly #onPresent:
    | ((
        error: unknown,
        view: PublicErrorView<unknown>,
        outcome: PresentationOutcome,
      ) => void)
    | undefined;

  public constructor(options: PublicErrorPresenterOptions) {
    this.#registry = options.registry;
    this.#fallback = options.fallback;
    this.#onPresent = options.onPresent;
  }

  /** Present `error` as a public view, resolving messages against `context.locales`. */
  public present(
    error: unknown,
    context?: PublicPresentationContext,
  ): PublicErrorView<unknown> {
    const localeOptions =
      context?.locales !== undefined ? { locales: context.locales } : undefined;
    const resolution = this.#registry.resolve(error);

    let view: PublicErrorView<unknown>;
    let outcome: PresentationOutcome;

    if (resolution.found) {
      const definition = resolution.definition;
      const resolved = resolveUserMessage(
        definition.userMessages,
        localeOptions,
      );
      view = {
        code: definition.publicCode,
        message: resolved.message,
        locale: resolved.locale,
      };

      let projection: "not_configured" | "succeeded" | "failed";
      if (definition.projectDetails === undefined) {
        projection = "not_configured";
      } else {
        try {
          const details = definition.projectDetails(error);
          // Only attach when present, so a projection returning undefined does
          // not leave a stray `details: undefined` own property on the view.
          if (details !== undefined) {
            view = { ...view, details };
          }
          projection = "succeeded";
        } catch {
          // Matched view stands without details; only the projection failed.
          projection = "failed";
        }
      }

      outcome = {
        kind: "matched",
        via: resolution.via,
        publicCode: definition.publicCode,
        projection,
        ...(resolution.matcherThrew && { matcherThrew: true }),
      };
    } else {
      const resolved = resolveUserMessage(
        this.#fallback.userMessages,
        localeOptions,
      );
      view = {
        code: this.#fallback.publicCode,
        message: resolved.message,
        locale: resolved.locale,
      };
      outcome = {
        kind: "fallback",
        reason: resolution.matcherThrew ? "matcher_failed" : "no_definition",
      };
    }

    if (this.#onPresent !== undefined) {
      try {
        this.#onPresent(error, view, outcome);
      } catch {
        // Telemetry must never break totality.
      }
    }

    return view;
  }
}
