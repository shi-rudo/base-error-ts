import type { LocalizedMessageSet } from "./LocalizedMessageSet.js";
import { resolveUserMessage } from "./LocaleResolver.js";
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
  // `messages` is typed non-optional, but `catalog.messagesFor(code)` returns
  // `undefined` for a public code with no userMessages. A caller that forces it
  // through (a `!` assertion) would otherwise hit a cryptic deref inside the
  // resolver; surface a clear contract violation instead.
  if (messages == null) {
    throw new TypeError(
      "localize: a LocalizedMessageSet is required. catalog.messagesFor(code) " +
        "returns undefined for a public code with no userMessages; guard it and " +
        "send the message-free view, or pass a fallback set.",
    );
  }
  const resolved = resolveUserMessage(messages, options);
  // Frozen to match project()'s view: all three stages give the same guarantee.
  return Object.freeze({
    ...view,
    message: resolved.message,
    locale: resolved.locale,
  });
}
