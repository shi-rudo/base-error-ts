import type { LocalizedMessageSet } from "../presentation/LocalizedMessageSet.js";
import { resolveUserMessage } from "../presentation/LocaleResolver.js";
import type { LocalizedPublicError, PublicError } from "./types.js";

/**
 * Stage 2: localization, deliberately optional and orthogonal. Attaches human
 * text to a {@link PublicError}, resolving `messages` against ordered locale
 * preferences. The `messages` set is keyed on the public code by the caller: a
 * backend passes `catalog.messagesFor(view.code)`, a client passes its own
 * catalog for the same public code. A client-localizing app simply never calls
 * this stage and renders text from `view.code` itself.
 */
export function localize<TDetails, TCode extends string = string>(
  view: PublicError<TDetails, TCode>,
  messages: LocalizedMessageSet,
  options?: { locales?: readonly string[] },
): LocalizedPublicError<TDetails, TCode> {
  const resolved = resolveUserMessage(messages, options);
  // Frozen to match project()'s view: all three stages give the same guarantee.
  return Object.freeze({
    ...view,
    message: resolved.message,
    locale: resolved.locale,
  });
}
